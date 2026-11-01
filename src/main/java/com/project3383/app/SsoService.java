package com.project3383.app;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.project3383.api.ApiDtos;
import com.project3383.api.ApiException;
import com.project3383.auth.AuthInterceptor;
import jakarta.servlet.http.HttpSession;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.net.InetAddress;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class SsoService {

    public static final String SSO_STATE = "project3383.sso.state";
    public static final String SSO_WORKSPACE = "project3383.sso.workspace";
    public static final String SSO_EXPIRES = "project3383.sso.expires";
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Duration TIMEOUT = Duration.ofSeconds(8);

    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;
    private final AuditService auditService;
    private final MfaService mfaService;
    private final MfaGuard mfaGuard;
    private final boolean allowPrivate;
    private final HttpClient httpClient = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(5))
        .followRedirects(HttpClient.Redirect.NEVER)
        .build();

    public SsoService(JdbcTemplate jdbc, ObjectMapper objectMapper, AuditService auditService,
                      MfaService mfaService, MfaGuard mfaGuard,
                      @Value("${project3383.webhook.allow-private:false}") boolean allowPrivate) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
        this.auditService = auditService;
        this.mfaService = mfaService;
        this.mfaGuard = mfaGuard;
        this.allowPrivate = allowPrivate;
    }

    public Map<String, Object> config(String userId, String workspaceId) {
        requireAdmin(userId, workspaceId);
        Map<String, Object> config = configRow(workspaceId);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("configured", config != null);
        result.put("config", config == null ? null : publicConfig(config));
        return result;
    }

    @Transactional
    public Map<String, Object> saveConfig(String userId, String workspaceId, ApiDtos.SsoConfigRequest input) {
        requireAdmin(userId, workspaceId);
        Map<String, Object> workspace = workspaceRow(workspaceId);
        if (!"org".equals(workspace.get("type"))) {
            throw ApiException.badRequest("Single sign-on is available for organization workspaces.");
        }
        if (input == null) throw ApiException.badRequest("SSO configuration is required.");
        String issuer = validateIssuer(input.issuer());
        String clientId = input.clientId() == null ? "" : input.clientId().trim();
        if (clientId.isEmpty() || clientId.length() > 300) throw ApiException.badRequest("Enter a valid client ID.");
        String domains = input.allowedDomains() == null ? "" : input.allowedDomains().trim().toLowerCase();
        if (domains.isEmpty() || domains.length() > 1000) {
            throw ApiException.badRequest("Enter at least one allowed email domain.");
        }
        Map<String, Object> existing = configRow(workspaceId);
        String secret = input.clientSecret() == null ? "" : input.clientSecret().trim();
        if (secret.isEmpty() && existing != null) {
            secret = mfaService.decryptSecret(String.valueOf(existing.get("clientSecretEnc")));
        }
        if (secret.isEmpty()) throw ApiException.badRequest("A client secret is required for the first configuration.");
        boolean enabled = input.enabled() == null || input.enabled();
        boolean enforceSso = input.enforceSso() != null && input.enforceSso();
        String now = Instant.now().toString();
        if (existing == null) {
            jdbc.update("""
                INSERT INTO oidc_config (id, workspace_id, issuer, client_id, client_secret_enc,
                                         enabled, allowed_domains, enforce_sso, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, UUID.randomUUID().toString(), workspaceId, issuer, clientId,
                mfaService.encryptSecret(secret), enabled ? 1 : 0, domains, enforceSso ? 1 : 0, now, now);
        } else {
            jdbc.update("""
                UPDATE oidc_config SET issuer = ?, client_id = ?, client_secret_enc = ?, enabled = ?,
                                       allowed_domains = ?, enforce_sso = ?, updated_at = ?
                WHERE workspace_id = ?
                """, issuer, clientId, mfaService.encryptSecret(secret), enabled ? 1 : 0,
                domains, enforceSso ? 1 : 0, now, workspaceId);
        }
        auditService.record(workspaceId, userId, "sso.configured", "oidc_config", workspaceId,
            Map.of("issuer", issuer, "enforceSso", enforceSso));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("config", publicConfig(configRow(workspaceId)));
        return result;
    }

    @Transactional
    public Map<String, Object> removeConfig(String userId, String workspaceId) {
        requireAdmin(userId, workspaceId);
        jdbc.update("DELETE FROM oidc_config WHERE workspace_id = ?", workspaceId);
        auditService.record(workspaceId, userId, "sso.removed", "oidc_config", workspaceId, Map.of());
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("removed", true);
        return result;
    }

    public String start(String workspaceId, String baseUrl, HttpSession session) {
        Map<String, Object> config = configRow(workspaceId);
        if (config == null || number(config.get("enabled")) != 1) {
            return baseUrl + "/?ssoError=sso_unavailable";
        }
        Discovery discovery;
        try {
            discovery = discover(validateIssuer(String.valueOf(config.get("issuer"))));
        } catch (Exception exception) {
            return baseUrl + "/?ssoError=sso_discovery_failed";
        }
        String state = randomToken();
        session.setAttribute(SSO_STATE, state);
        session.setAttribute(SSO_WORKSPACE, workspaceId);
        session.setAttribute(SSO_EXPIRES, Instant.now().plusSeconds(600).toString());
        String redirectUri = baseUrl + "/api/auth/sso/" + workspaceId + "/callback";
        String url = discovery.authorizationEndpoint()
            + (discovery.authorizationEndpoint().contains("?") ? "&" : "?")
            + "response_type=code"
            + "&client_id=" + encode(String.valueOf(config.get("clientId")))
            + "&redirect_uri=" + encode(redirectUri)
            + "&scope=" + encode("openid email profile")
            + "&state=" + encode(state)
            + "&nonce=" + encode(randomToken());
        return url;
    }

    @Transactional
    public Completion complete(String workspaceId, String code, String state, String baseUrl, HttpSession session) {
        if (state == null || state.isBlank()) return Completion.error("state_mismatch");
        Object storedState = session.getAttribute(SSO_STATE);
        Object storedWorkspace = session.getAttribute(SSO_WORKSPACE);
        Object expires = session.getAttribute(SSO_EXPIRES);
        session.removeAttribute(SSO_STATE);
        session.removeAttribute(SSO_WORKSPACE);
        session.removeAttribute(SSO_EXPIRES);
        if (storedState == null || !constantTimeEquals(String.valueOf(storedState), state)
            || storedWorkspace == null || !workspaceId.equals(String.valueOf(storedWorkspace))) {
            return Completion.error("state_mismatch");
        }
        try {
            if (expires == null || Instant.parse(String.valueOf(expires)).isBefore(Instant.now())) {
                return Completion.error("state_expired");
            }
        } catch (Exception exception) {
            return Completion.error("state_invalid");
        }
        Map<String, Object> config = configRow(workspaceId);
        if (config == null || number(config.get("enabled")) != 1) return Completion.error("sso_unavailable");
        if (code == null || code.isBlank()) return Completion.error("missing_code");
        try {
            Discovery discovery = discover(validateIssuer(String.valueOf(config.get("issuer"))));
            Map<String, Object> tokens = exchangeCode(discovery,
                String.valueOf(config.get("clientId")),
                mfaService.decryptSecret(String.valueOf(config.get("clientSecretEnc"))),
                code, baseUrl, workspaceId);
            String accessToken = string(tokens.get("access_token"));
            if (accessToken == null || accessToken.isBlank()) return Completion.error("sso_failed");
            Map<String, Object> profile = userInfo(discovery, accessToken);
            String email = string(profile.get("email"));
            if (email == null || email.isBlank()) return Completion.error("email_required");
            email = email.trim().toLowerCase();
            Object verified = profile.get("email_verified");
            if (verified != null && !Boolean.TRUE.equals(verified) && !"true".equals(String.valueOf(verified))) {
                return Completion.error("email_unverified");
            }
            List<String> domains = new ArrayList<>();
            for (String domain : String.valueOf(config.get("allowedDomains")).split(",")) {
                if (!domain.isBlank()) domains.add(domain.trim().toLowerCase());
            }
            final String finalEmail = email;
            if (!domains.isEmpty() && domains.stream().noneMatch(domain -> finalEmail.endsWith("@" + domain))) {
                return Completion.error("domain_not_allowed");
            }
            String name = string(profile.get("name"));
            String avatarUrl = string(profile.get("picture"));
            Object currentUserIdValue = session.getAttribute(AuthInterceptor.SESSION_USER);
            String currentUserId = currentUserIdValue == null ? null : String.valueOf(currentUserIdValue);
            String guestId = currentUserId != null && isGuest(currentUserId) ? currentUserId : null;
            Map<String, Object> existing = jdbc.queryForList("""
                SELECT id, deleted_at AS deletedAt FROM app_user WHERE lower(email) = ?
                """, email).stream().findFirst().orElse(null);
            if (existing != null && existing.get("deletedAt") != null) return Completion.error("account_unavailable");
            String userId;
            if (existing != null) {
                String existingId = String.valueOf(existing.get("id"));
                if (currentUserId != null && currentUserId.equals(existingId)) {
                    userId = existingId;
                } else if (guestId != null) {
                    jdbc.update("""
                        UPDATE app_user SET email = ?, display_name = COALESCE(NULLIF(?, ''), display_name),
                                            is_guest = 0 WHERE id = ?
                        """, email, name == null ? "" : name, guestId);
                    userId = guestId;
                } else {
                    return Completion.error("account_link_required");
                }
            } else if (guestId != null) {
                jdbc.update("""
                    UPDATE app_user SET email = ?, display_name = COALESCE(NULLIF(?, ''), display_name),
                                        is_guest = 0 WHERE id = ?
                    """, email, name == null ? "" : name, guestId);
                userId = guestId;
            } else {
                userId = createSsoUser(email, name, avatarUrl);
            }
            jdbc.update("""
                INSERT OR IGNORE INTO membership (user_id, workspace_id, role, joined_at)
                VALUES (?, ?, 'MEMBER', ?)
                """, userId, workspaceId, Instant.now().toString());
            auditService.record(workspaceId, userId, "sso.login", "user", userId,
                Map.of("issuer", config.get("issuer"), "email", email));
            Integer mfaEnabled = jdbc.queryForObject("""
                SELECT mfa_enabled FROM app_user WHERE id = ?
                """, Integer.class, userId);
            if (mfaEnabled != null && mfaEnabled == 1) {
                return Completion.mfa(userId, mfaService.createChallenge(userId));
            }
            return Completion.success(userId);
        } catch (ApiException exception) {
            return Completion.error(exception.code().toLowerCase());
        } catch (Exception exception) {
            return Completion.error("sso_failed");
        }
    }

    private String createSsoUser(String email, String name, String avatarUrl) {
        String userId = UUID.randomUUID().toString();
        String displayName = name == null || name.isBlank() ? email.substring(0, email.indexOf('@')) : name.trim();
        String now = Instant.now().toString();
        jdbc.update("""
            INSERT INTO app_user (id, email, display_name, password_hash, is_guest, timezone, created_at)
            VALUES (?, ?, ?, NULL, 0, 'UTC', ?)
            """, userId, email, displayName, now);
        String workspaceId = UUID.randomUUID().toString();
        jdbc.update("""
            INSERT INTO workspace (id, name, type, created_by, created_at, public_sharing_enabled)
            VALUES (?, 'My workspace', 'personal', ?, ?, 0)
            """, workspaceId, userId, now);
        jdbc.update("""
            INSERT INTO membership (user_id, workspace_id, role, joined_at) VALUES (?, ?, 'OWNER', ?)
            """, userId, workspaceId, now);
        String boardId = UUID.randomUUID().toString();
        jdbc.update("""
            INSERT INTO board (id, workspace_id, name, position, created_at, created_by)
            VALUES (?, ?, 'My tasks', 0, ?, ?)
            """, boardId, workspaceId, now, userId);
        String[] columns = {"To do", "In progress", "Done"};
        for (int index = 0; index < columns.length; index++) {
            jdbc.update("""
                INSERT INTO board_column (id, board_id, name, position, is_done) VALUES (?, ?, ?, ?, ?)
                """, UUID.randomUUID().toString(), boardId, columns[index], index,
                index == columns.length - 1 ? 1 : 0);
        }
        return userId;
    }

    private Map<String, Object> exchangeCode(Discovery discovery, String clientId, String clientSecret,
                                              String code, String baseUrl, String workspaceId) throws Exception {
        String redirectUri = baseUrl + "/api/auth/sso/" + workspaceId + "/callback";
        String form = "grant_type=authorization_code"
            + "&code=" + encode(code)
            + "&client_id=" + encode(clientId)
            + "&client_secret=" + encode(clientSecret)
            + "&redirect_uri=" + encode(redirectUri);
        HttpRequest request = HttpRequest.newBuilder(URI.create(discovery.tokenEndpoint()))
            .timeout(TIMEOUT)
            .header("content-type", "application/x-www-form-urlencoded")
            .header("accept", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(form))
            .build();
        return json(httpClient.send(request, HttpResponse.BodyHandlers.ofString()).body());
    }

    private Map<String, Object> userInfo(Discovery discovery, String accessToken) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create(discovery.userinfoEndpoint()))
            .timeout(TIMEOUT)
            .header("accept", "application/json")
            .header("authorization", "Bearer " + accessToken)
            .GET()
            .build();
        return json(httpClient.send(request, HttpResponse.BodyHandlers.ofString()).body());
    }

    private Discovery discover(String issuer) throws Exception {
        String base = issuer.endsWith("/") ? issuer.substring(0, issuer.length() - 1) : issuer;
        HttpRequest request = HttpRequest.newBuilder(URI.create(base + "/.well-known/openid-configuration"))
            .timeout(TIMEOUT).header("accept", "application/json").GET().build();
        Map<String, Object> document = json(httpClient.send(request, HttpResponse.BodyHandlers.ofString()).body());
        String authorization = string(document.get("authorization_endpoint"));
        String token = string(document.get("token_endpoint"));
        String userinfo = string(document.get("userinfo_endpoint"));
        if (authorization == null || token == null || userinfo == null) {
            throw ApiException.badRequest("The OIDC discovery document is missing required endpoints.");
        }
        validateEndpoint(authorization);
        validateEndpoint(token);
        validateEndpoint(userinfo);
        return new Discovery(authorization, token, userinfo);
    }

    private Map<String, Object> configRow(String workspaceId) {
        return jdbc.queryForList("""
            SELECT c.id, c.workspace_id AS workspaceId, c.issuer, c.client_id AS clientId,
                   c.client_secret_enc AS clientSecretEnc, c.enabled, c.allowed_domains AS allowedDomains,
                   c.enforce_sso AS enforceSso, c.created_at AS createdAt, c.updated_at AS updatedAt
            FROM oidc_config c JOIN workspace w ON w.id = c.workspace_id AND w.deleted_at IS NULL
            WHERE c.workspace_id = ?
            """, workspaceId).stream().findFirst().orElse(null);
    }

    private Map<String, Object> publicConfig(Map<String, Object> config) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("issuer", config.get("issuer"));
        result.put("clientId", config.get("clientId"));
        result.put("allowedDomains", config.get("allowedDomains"));
        result.put("enabled", number(config.get("enabled")) == 1);
        result.put("enforceSso", number(config.get("enforceSso")) == 1);
        result.put("updatedAt", config.get("updatedAt"));
        return result;
    }

    private Map<String, Object> workspaceRow(String workspaceId) {
        return jdbc.queryForList("""
            SELECT id, name, type FROM workspace WHERE id = ? AND deleted_at IS NULL
            """, workspaceId).stream().findFirst()
            .orElseThrow(() -> ApiException.notFound("Workspace not found."));
    }

    private String validateIssuer(String value) {
        if (value == null || value.isBlank()) throw ApiException.badRequest("Enter an OIDC issuer URL.");
        URI uri;
        try {
            uri = URI.create(value.trim());
        } catch (Exception exception) {
            throw ApiException.badRequest("Enter a valid OIDC issuer URL.");
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        if (!"https".equals(scheme) && !(allowPrivate && "http".equals(scheme))) {
            throw ApiException.badRequest("Use an HTTPS OIDC issuer URL.");
        }
        if (uri.getHost() == null || uri.getUserInfo() != null) {
            throw ApiException.badRequest("Enter a valid OIDC issuer URL.");
        }
        if (!allowPrivate) {
            try {
                for (InetAddress address : InetAddress.getAllByName(uri.getHost())) {
                    if (address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress()
                        || address.isSiteLocalAddress() || address.isMulticastAddress()) {
                        throw ApiException.badRequest("The OIDC issuer cannot target a private address.");
                    }
                }
            } catch (ApiException exception) {
                throw exception;
            } catch (Exception exception) {
                throw ApiException.badRequest("The OIDC issuer could not be resolved.");
            }
        }
        return uri.toString();
    }

    private void validateEndpoint(String value) {
        URI uri;
        try {
            uri = URI.create(value);
        } catch (Exception exception) {
            throw ApiException.badRequest("The OIDC provider returned an invalid endpoint.");
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        if (!"https".equals(scheme) && !(allowPrivate && "http".equals(scheme))) {
            throw ApiException.badRequest("The OIDC provider returned a non-HTTPS endpoint.");
        }
        if (uri.getHost() == null || uri.getUserInfo() != null) {
            throw ApiException.badRequest("The OIDC provider returned an invalid endpoint.");
        }
    }

    private void requireAdmin(String userId, String workspaceId) {
        String role = jdbc.queryForList("""
            SELECT m.role FROM membership m JOIN workspace w ON w.id = m.workspace_id
            WHERE m.user_id = ? AND m.workspace_id = ? AND w.deleted_at IS NULL
            """, userId, workspaceId).stream().findFirst()
            .map(row -> String.valueOf(row.get("role")))
            .orElseThrow(() -> ApiException.notFound("Workspace not found."));
        if (!"OWNER".equals(role) && !"ADMIN".equals(role)) {
            throw ApiException.forbidden("You do not have permission to manage SSO.");
        }
        mfaGuard.requireSatisfied(userId, workspaceId);
    }

    private boolean isGuest(String userId) {
        Integer guest = jdbc.queryForObject("""
            SELECT is_guest FROM app_user WHERE id = ? AND deleted_at IS NULL
            """, Integer.class, userId);
        return guest != null && guest == 1;
    }

    private Map<String, Object> json(String body) throws Exception {
        return objectMapper.readValue(body == null || body.isBlank() ? "{}" : body, new TypeReference<>() {});
    }

    private String encode(String value) {
        return URLEncoder.encode(value == null ? "" : value, StandardCharsets.UTF_8);
    }

    private String randomToken() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private boolean constantTimeEquals(String left, String right) {
        return MessageDigest.isEqual(left.getBytes(StandardCharsets.UTF_8), right.getBytes(StandardCharsets.UTF_8));
    }

    private int number(Object value) {
        if (value instanceof Number number) return number.intValue();
        if (value instanceof Boolean bool) return bool ? 1 : 0;
        try {
            return Integer.parseInt(String.valueOf(value));
        } catch (Exception exception) {
            return 0;
        }
    }

    private String string(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private record Discovery(String authorizationEndpoint, String tokenEndpoint, String userinfoEndpoint) {
    }

    public record Completion(String userId, String mfaChallenge, String error) {
        public static Completion success(String userId) {
            return new Completion(userId, null, null);
        }

        public static Completion mfa(String userId, String challenge) {
            return new Completion(userId, challenge, null);
        }

        public static Completion error(String error) {
            return new Completion(null, null, error);
        }
    }
}
