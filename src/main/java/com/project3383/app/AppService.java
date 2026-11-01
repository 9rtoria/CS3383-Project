package com.project3383.app;

import com.project3383.api.ApiDtos;
import com.project3383.api.ApiException;
import com.project3383.auth.AuthInterceptor;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.DateTimeException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service
public class AppService {

    private static final Set<String> PRIORITIES = Set.of("none", "low", "medium", "high", "urgent");
    private final JdbcTemplate jdbc;
    private final PasswordEncoder passwordEncoder;
    private final ObjectMapper objectMapper;
    private final AuditService auditService;
    private final WebhookService webhookService;
    private final AutomationService automationService;
    private final MfaService mfaService;
    private final MfaGuard mfaGuard;
    private final NotificationService notificationService;

    public AppService(JdbcTemplate jdbc, PasswordEncoder passwordEncoder, ObjectMapper objectMapper,
                      AuditService auditService, WebhookService webhookService,
                      AutomationService automationService, MfaService mfaService, MfaGuard mfaGuard,
                      NotificationService notificationService) {
        this.jdbc = jdbc;
        this.passwordEncoder = passwordEncoder;
        this.objectMapper = objectMapper;
        this.auditService = auditService;
        this.webhookService = webhookService;
        this.automationService = automationService;
        this.mfaService = mfaService;
        this.mfaGuard = mfaGuard;
        this.notificationService = notificationService;
    }

    @Transactional
    public Map<String, Object> createGuest() {
        String userId = id();
        String now = Instant.now().toString();
        jdbc.update("""
            INSERT INTO app_user (id, email, display_name, is_guest, timezone, created_at)
            VALUES (?, NULL, ?, 1, 'Asia/Hong_Kong', ?)
            """, userId, "Guest", now);
        createStarterWorkspace(userId, "My workspace");
        return bootstrap(userId);
    }

    @Transactional
    public AuthResult signup(String currentUserId, ApiDtos.Signup input) {
        if (input == null || blank(input.email()) || blank(input.password())) {
            throw ApiException.badRequest("Email and password are required.");
        }
        String email = input.email().trim().toLowerCase();
        if (!email.contains("@") || email.length() > 254) throw ApiException.badRequest("Enter a valid email address.");
        if (input.password().length() < 8) throw ApiException.badRequest("Password must be at least 8 characters.");
        String name = blank(input.name()) ? email.substring(0, email.indexOf('@')) : input.name().trim();
        String timezone = blank(input.timezone()) ? "Asia/Hong_Kong" : input.timezone();
        String hash = passwordEncoder.encode(input.password());
        String userId;

        if (currentUserId != null) {
            Map<String, Object> current = userRow(currentUserId);
            if (!((Number) current.get("isGuest")).equals(1)) {
                throw new ApiException(HttpStatus.CONFLICT, "ALREADY_SIGNED_IN", "This session already belongs to an account.");
            }
            Map<String, Object> existing = jdbc.queryForList("SELECT id FROM app_user WHERE email = ?", email)
                .stream().findFirst().orElse(null);
            if (existing != null && !currentUserId.equals(existing.get("id"))) {
                throw new ApiException(HttpStatus.CONFLICT, "EMAIL_IN_USE", "An account already uses this email.");
            }
            jdbc.update("""
                UPDATE app_user SET email = ?, display_name = ?, password_hash = ?, is_guest = 0, timezone = ?
                WHERE id = ?
                """, email, name, hash, timezone, currentUserId);
            userId = currentUserId;
        } else {
            Map<String, Object> existing = jdbc.queryForList("SELECT id FROM app_user WHERE email = ?", email)
                .stream().findFirst().orElse(null);
            if (existing != null) {
                throw new ApiException(HttpStatus.CONFLICT, "EMAIL_IN_USE", "An account already uses this email.");
            }
            userId = id();
            jdbc.update("""
                INSERT INTO app_user (id, email, display_name, password_hash, is_guest, timezone, created_at)
                VALUES (?, ?, ?, ?, 0, ?, ?)
                """, userId, email, name, hash, timezone, Instant.now().toString());
            createStarterWorkspace(userId, name + "'s workspace");
        }
        return new AuthResult(userId, bootstrap(userId));
    }

    public Map<String, Object> updateAccount(String userId, ApiDtos.AccountUpdate input) {
        if (input == null) throw ApiException.badRequest("Account details are required.");
        String name = input.name() == null ? null : input.name().trim();
        if (name != null && (name.isEmpty() || name.length() > 80)) {
            throw ApiException.badRequest("Display name must be between 1 and 80 characters.");
        }
        String timezone = input.timezone() == null ? null : input.timezone().trim();
        if (timezone != null && (timezone.isEmpty() || timezone.length() > 80)) {
            throw ApiException.badRequest("Time zone must be between 1 and 80 characters.");
        }
        if (name != null) jdbc.update("UPDATE app_user SET display_name = ? WHERE id = ?", name, userId);
        if (timezone != null) jdbc.update("UPDATE app_user SET timezone = ? WHERE id = ?", timezone, userId);
        return linked(Map.of("user", user(userId)));
    }

    @Transactional
    public Map<String, Object> deleteAccount(String userId, ApiDtos.AccountDelete input) {
        if (input == null || !"DELETE".equals(input.confirm())) {
            throw ApiException.badRequest("Type DELETE to confirm account deletion.");
        }
        Integer exists = jdbc.queryForObject("""
            SELECT COUNT(*) FROM app_user WHERE id = ? AND deleted_at IS NULL
            """, Integer.class, userId);
        if (exists == null || exists == 0) throw ApiException.notFound("Account not found.");
        List<Map<String, Object>> memberships = jdbc.queryForList("""
            SELECT m.workspace_id AS workspaceId, m.role, w.type, w.deleted_at AS deletedAt,
                   (SELECT COUNT(*) FROM membership x WHERE x.workspace_id = m.workspace_id) AS memberCount
            FROM membership m JOIN workspace w ON w.id = m.workspace_id
            WHERE m.user_id = ?
            """, userId);
        boolean sharedOwner = memberships.stream().anyMatch(membership ->
            "OWNER".equals(membership.get("role"))
                && !"personal".equals(membership.get("type"))
                && number(membership.get("memberCount")) > 1
                && membership.get("deletedAt") == null);
        if (sharedOwner) {
            throw new ApiException(HttpStatus.CONFLICT, "CONFLICT",
                "Transfer ownership of your team workspaces before deleting your account.");
        }
        String now = Instant.now().toString();
        for (Map<String, Object> membership : memberships) {
            if (!"personal".equals(membership.get("type")) || membership.get("deletedAt") != null) continue;
            jdbc.update("""
                UPDATE workspace SET deleted_at = ?, version = version + 1 WHERE id = ? AND deleted_at IS NULL
                """, now, membership.get("workspaceId"));
        }
        jdbc.update("""
            UPDATE app_user SET deleted_at = ?, email = NULL, password_hash = NULL,
                                mfa_secret_enc = NULL, mfa_backup_codes_json = NULL, mfa_enabled = 0
            WHERE id = ?
            """, now, userId);
        jdbc.update("""
            UPDATE auth_session SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL
            """, now, userId);
        jdbc.update("""
            UPDATE api_token SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL
            """, now, userId);
        for (Map<String, Object> membership : memberships) {
            if ("personal".equals(membership.get("type"))) continue;
            auditService.record(String.valueOf(membership.get("workspaceId")), userId,
                "account.deleted", "user", userId, Map.of());
        }
        return linked(Map.of("deleted", true));
    }

    @Transactional
    public Map<String, Object> deleteWorkspace(String userId, String workspaceId) {
        String role = roleFor(userId, workspaceId);
        if (!"OWNER".equals(role)) throw ApiException.forbidden("Only a workspace owner can delete it.");
        mfaGuard.requireSatisfied(userId, workspaceId);
        Integer active = jdbc.queryForObject("""
            SELECT COUNT(*) FROM membership m JOIN workspace w ON w.id = m.workspace_id
            WHERE m.user_id = ? AND m.workspace_id <> ? AND w.deleted_at IS NULL
            """, Integer.class, userId, workspaceId);
        if (active == null || active == 0) {
            throw new ApiException(HttpStatus.CONFLICT, "CONFLICT",
                "Create another workspace before deleting your only one.");
        }
        String now = Instant.now().toString();
        jdbc.update("""
            UPDATE workspace SET deleted_at = ?, version = version + 1
            WHERE id = ? AND deleted_at IS NULL
            """, now, workspaceId);
        jdbc.update("""
            UPDATE api_token SET revoked_at = ? WHERE workspace_id = ? AND revoked_at IS NULL
            """, now, workspaceId);
        audit(workspaceId, userId, "workspace.deleted", "workspace", workspaceId, Map.of());
        return linked(Map.of("deleted", true));
    }

    public Map<String, Object> workspace(String userId, String workspaceId) {
        requireMembership(userId, workspaceId);
        Map<String, Object> workspace = workspaceRow(workspaceId);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("workspace", workspace);
        result.put("role", roleFor(userId, workspaceId));
        result.put("boards", jdbc.queryForObject("""
            SELECT COUNT(*) FROM board WHERE workspace_id = ? AND deleted_at IS NULL
            """, Integer.class, workspaceId));
        return result;
    }

    @Transactional
    public Map<String, Object> updateWorkspacePolicies(String userId, String workspaceId, ApiDtos.WorkspaceUpdate input) {
        requireMinimumRole(userId, workspaceId, "ADMIN");
        if (input == null) throw ApiException.badRequest("Workspace changes are required.");
        Map<String, Object> workspace = workspaceRow(workspaceId);
        if ("personal".equals(workspace.get("type"))
            && (input.requireMfa() != null || input.retentionDays() != null || input.auditRetentionDays() != null)) {
            throw ApiException.badRequest("Enterprise policies apply to team or organization workspaces.");
        }
        int currentVersion = number(workspace.get("version"));
        if (input.version() != null && input.version() != currentVersion) {
            throw ApiException.conflict("These settings changed elsewhere.", currentVersion);
        }
        String name = input.name() == null ? String.valueOf(workspace.get("name")) : input.name().trim();
        if (name.isEmpty() || name.length() > 80) {
            throw ApiException.badRequest("Workspace name must be between 1 and 80 characters.");
        }
        int retentionDays = input.retentionDays() == null
            ? number(workspace.get("retentionDays")) : input.retentionDays();
        int auditRetentionDays = input.auditRetentionDays() == null
            ? number(workspace.get("auditRetentionDays")) : input.auditRetentionDays();
        if (retentionDays < 1 || retentionDays > 3650) {
            throw ApiException.badRequest("Archived task retention must be between 1 and 3650 days.");
        }
        if (auditRetentionDays < 30 || auditRetentionDays > 3650) {
            throw ApiException.badRequest("Audit retention must be between 30 and 3650 days.");
        }
        boolean requireMfa = input.requireMfa() == null
            ? number(workspace.get("requireMfa")) == 1 : input.requireMfa();
        boolean aiEnabled = input.aiEnabled() == null
            ? number(workspace.get("aiEnabled")) == 1 : input.aiEnabled();
        boolean automationsEnabled = input.automationsEnabled() == null
            ? number(workspace.get("automationsEnabled")) == 1 : input.automationsEnabled();
        boolean attachmentsEnabled = input.attachmentsEnabled() == null
            ? number(workspace.get("attachmentsEnabled")) == 1 : input.attachmentsEnabled();
        boolean publicSharingEnabled = input.publicSharingEnabled() == null
            ? number(workspace.get("publicSharingEnabled")) == 1 : input.publicSharingEnabled();
        jdbc.update("""
            UPDATE workspace SET name = ?, retention_days = ?, audit_retention_days = ?, require_mfa = ?,
                                 ai_enabled = ?, automations_enabled = ?, attachments_enabled = ?,
                                 public_sharing_enabled = ?, version = version + 1
            WHERE id = ? AND version = ?
            """, name, retentionDays, auditRetentionDays, requireMfa ? 1 : 0, aiEnabled ? 1 : 0,
            automationsEnabled ? 1 : 0, attachmentsEnabled ? 1 : 0, publicSharingEnabled ? 1 : 0,
            workspaceId, currentVersion);
        List<String> fields = new ArrayList<>();
        if (input.name() != null) fields.add("name");
        if (input.retentionDays() != null) fields.add("retentionDays");
        if (input.auditRetentionDays() != null) fields.add("auditRetentionDays");
        if (input.requireMfa() != null) fields.add("requireMfa");
        if (input.aiEnabled() != null) fields.add("aiEnabled");
        if (input.automationsEnabled() != null) fields.add("automationsEnabled");
        if (input.attachmentsEnabled() != null) fields.add("attachmentsEnabled");
        if (input.publicSharingEnabled() != null) fields.add("publicSharingEnabled");
        audit(workspaceId, userId, "workspace.policies_updated", "workspace", workspaceId,
            Map.of("fields", fields));
        return linked(Map.of("workspace", workspaceRow(workspaceId)));
    }

    private Map<String, Object> workspaceRow(String workspaceId) {
        Map<String, Object> workspace = jdbc.queryForList("""
            SELECT id, name, type, retention_days AS retentionDays, audit_retention_days AS auditRetentionDays,
                   require_mfa AS requireMfa, ai_enabled AS aiEnabled, automations_enabled AS automationsEnabled,
                   attachments_enabled AS attachmentsEnabled, public_sharing_enabled AS publicSharingEnabled,
                   version, created_at AS createdAt
            FROM workspace WHERE id = ? AND deleted_at IS NULL
            """, workspaceId).stream().findFirst()
            .orElseThrow(() -> ApiException.notFound("Workspace not found."));
        for (String field : List.of("requireMfa", "aiEnabled", "automationsEnabled",
            "attachmentsEnabled", "publicSharingEnabled")) {
            workspace.put(field, number(workspace.get(field)) == 1);
        }
        return linked(workspace);
    }

    public AuthResult signin(ApiDtos.Signin input) {
        if (input == null || blank(input.email()) || blank(input.password())) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Email or password is incorrect.");
        }
        Map<String, Object> row = jdbc.queryForList("""
            SELECT id, password_hash AS passwordHash, is_guest AS isGuest, mfa_enabled AS mfaEnabled
            FROM app_user WHERE email = ? AND deleted_at IS NULL
            """, input.email().trim().toLowerCase()).stream().findFirst()
            .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Email or password is incorrect."));
        String hash = (String) row.get("passwordHash");
        if (hash == null || !passwordEncoder.matches(input.password(), hash)) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Email or password is incorrect.");
        }
        String userId = row.get("id").toString();
        if (number(row.get("mfaEnabled")) == 1) {
            String code = input.totp() == null ? "" : input.totp().trim();
            if (code.isEmpty()) {
                return new AuthResult(null, null, true, mfaService.createChallenge(userId), false);
            }
            if (!mfaService.verifySecondFactor(userId, code)) {
                throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "That code is not valid.");
            }
            return new AuthResult(userId, bootstrap(userId), false, null, true);
        }
        return new AuthResult(userId, bootstrap(userId), false, null, false);
    }

    public AuthResult verifyMfaChallenge(String challenge, String code) {
        String userId = mfaService.verifyChallenge(challenge, code);
        return new AuthResult(userId, bootstrap(userId), false, null, true);
    }

    @Transactional
    public MagicLink requestMagicLink(String email, String ip, String next, String state, String baseUrl) {
        String normalized = email == null ? "" : email.trim().toLowerCase();
        if (normalized.isEmpty() || !normalized.contains("@") || normalized.length() > 254) {
            throw ApiException.badRequest("Enter a valid email address.");
        }
        String token = randomToken();
        String now = Instant.now().toString();
        String expiresAt = Instant.now().plusSeconds(15 * 60).toString();
        jdbc.update("""
            INSERT INTO magic_link_token (id, token_hash, email, purpose, expires_at, used_at, ip_hash, created_at)
            VALUES (?, ?, ?, 'login', ?, NULL, ?, ?)
            """, id(), sha256(token), normalized, expiresAt,
            sha256(ip == null ? "local" : ip).substring(0, 32), now);
        String safeNext = safeNext(next);
        String link = baseUrl + "/api/auth/magic/verify?token=" + urlEncode(token)
            + "&state=" + urlEncode(state == null ? "" : state)
            + "&next=" + urlEncode(safeNext);
        String body = "Open this one-time link to sign in to Drift. It expires in 15 minutes.\n\n" + link
            + "\n\nIf you did not ask to sign in, you can ignore this email.";
        jdbc.update("""
            INSERT INTO email_message (id, user_id, recipient, subject, body, kind, status, sent_at, error, created_at)
            VALUES (?, NULL, ?, 'Your Drift sign-in link', ?, 'magic', 'queued', NULL, NULL, ?)
            """, id(), normalized, body, now);
        return new MagicLink(token, link);
    }

    @Transactional
    public MagicLogin loginWithMagicToken(String token) {
        if (blank(token)) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_TOKEN", "This sign-in link is incomplete.");
        }
        Map<String, Object> record = jdbc.queryForList("""
            SELECT id, email, used_at AS usedAt, expires_at AS expiresAt
            FROM magic_link_token WHERE token_hash = ?
            """, sha256(token)).stream().findFirst()
            .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_TOKEN",
                "This sign-in link is invalid or has already been used."));
        String now = Instant.now().toString();
        if (record.get("usedAt") != null || Instant.parse(String.valueOf(record.get("expiresAt"))).isBefore(Instant.now())) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_TOKEN",
                "This sign-in link is invalid or has expired.");
        }
        int claimed = jdbc.update("""
            UPDATE magic_link_token SET used_at = ?
            WHERE id = ? AND used_at IS NULL AND expires_at > ?
            """, now, record.get("id"), now);
        if (claimed != 1) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_TOKEN",
                "This sign-in link is invalid or has already been used.");
        }
        String email = String.valueOf(record.get("email"));
        Map<String, Object> existing = jdbc.queryForList("""
            SELECT id, mfa_enabled AS mfaEnabled, deleted_at AS deletedAt
            FROM app_user WHERE lower(email) = ?
            """, email).stream().findFirst().orElse(null);
        String userId;
        boolean mfaEnabled;
        if (existing != null) {
            if (existing.get("deletedAt") != null) {
                throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_TOKEN", "That account is no longer available.");
            }
            userId = String.valueOf(existing.get("id"));
            mfaEnabled = number(existing.get("mfaEnabled")) == 1;
        } else {
            userId = id();
            String displayName = email.substring(0, email.indexOf('@'));
            jdbc.update("""
                INSERT INTO app_user (id, email, display_name, password_hash, is_guest, timezone, created_at)
                VALUES (?, ?, ?, NULL, 0, 'Asia/Hong_Kong', ?)
                """, userId, email, displayName, now);
            createStarterWorkspace(userId, displayName + "'s workspace");
            mfaEnabled = false;
        }
        String challenge = mfaEnabled ? mfaService.createChallenge(userId) : null;
        return new MagicLogin(userId, email, challenge);
    }

    @Transactional
    public Map<String, Object> completeMagicLogin(String userId) {
        return bootstrap(userId);
    }

    private String safeNext(String value) {
        if (value == null || value.isBlank()) return "/";
        String next = value.trim();
        if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
        return next;
    }

    private String urlEncode(String value) {
        return java.net.URLEncoder.encode(value == null ? "" : value, StandardCharsets.UTF_8);
    }

    public record MagicLink(String token, String devUrl) {
    }

    public record MagicLogin(String userId, String email, String mfaChallenge) {
    }

    public record AuthResult(String userId, Map<String, Object> bootstrap, boolean mfaRequired,
                             String challenge, boolean mfaVerified) {
        public AuthResult(String userId, Map<String, Object> bootstrap) {
            this(userId, bootstrap, false, null, false);
        }
    }

    @Transactional
    public Map<String, Object> createWorkspace(String userId, ApiDtos.WorkspaceCreate input) {
        if (input == null || blank(input.name())) throw ApiException.badRequest("Workspace name is required.");
        String type = switch (input.type() == null ? "" : input.type()) {
            case "team" -> "team";
            case "org" -> "org";
            default -> "personal";
        };
        if ("personal".equals(type)) {
            Integer personal = jdbc.queryForObject("""
                SELECT COUNT(*) FROM workspace w JOIN membership m ON m.workspace_id = w.id
                WHERE m.user_id = ? AND w.type = 'personal' AND w.created_by = ? AND w.deleted_at IS NULL
                """, Integer.class, userId, userId);
            if (personal != null && personal > 0) throw ApiException.badRequest("You already have a personal workspace.");
        }
        createStarterWorkspace(userId, input.name().trim(), type);
        Map<String, Object> workspace = jdbc.queryForList("""
            SELECT id, name, type FROM workspace WHERE created_by = ? AND deleted_at IS NULL
            ORDER BY created_at DESC LIMIT 1
            """, userId).stream().findFirst().orElseThrow();
        audit(String.valueOf(workspace.get("id")), userId, "workspace.created", "workspace",
            String.valueOf(workspace.get("id")), Map.of("name", input.name().trim(), "type", type));
        return linked(Map.of("workspace", workspace));
    }

    public Map<String, Object> members(String userId, String workspaceId) {
        requireMembership(userId, workspaceId);
        return linked(Map.of("members", jdbc.queryForList("""
            SELECT m.user_id AS userId, m.role, m.joined_at AS joinedAt,
                   u.display_name AS name, u.email, u.is_guest AS isGuest
            FROM membership m JOIN app_user u ON u.id = m.user_id
            WHERE m.workspace_id = ? ORDER BY m.joined_at
            """, workspaceId)));
    }

    @Transactional
    public Map<String, Object> invite(String userId, String workspaceId, ApiDtos.InviteCreate input) {
        requireMinimumRole(userId, workspaceId, "ADMIN");
        if (input == null || blank(input.email()) || !input.email().contains("@")) {
            throw ApiException.badRequest("A valid invite email is required.");
        }
        String email = input.email().trim().toLowerCase();
        String role = "ADMIN".equalsIgnoreCase(input.role()) ? "ADMIN" : "MEMBER";
        String token = UUID.randomUUID().toString().replace("-", "") + UUID.randomUUID().toString().replace("-", "");
        String inviteId = id();
        String now = Instant.now().toString();
        String expiresAt = Instant.now().plus(7, ChronoUnit.DAYS).toString();
        jdbc.update("""
            INSERT INTO invite (id, workspace_id, email, role, token_hash, expires_at, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, inviteId, workspaceId, email, role, sha256(token), expiresAt, userId, now);
        audit(workspaceId, userId, "invite.created", "invite", inviteId, Map.of("email", email, "role", role));
        return linked(Map.of(
            "invite", Map.of("id", inviteId, "email", email, "role", role, "expiresAt", expiresAt),
            "token", token
        ));
    }

    @Transactional
    public Map<String, Object> acceptInvite(String userId, String token) {
        Map<String, Object> invite = jdbc.queryForList("""
            SELECT id, workspace_id AS workspaceId, email, role, expires_at AS expiresAt, accepted_at AS acceptedAt
            FROM invite WHERE token_hash = ?
            """, sha256(token)).stream().findFirst()
            .orElseThrow(() -> ApiException.notFound("Invitation not found."));
        if (invite.get("acceptedAt") != null) throw ApiException.badRequest("Invitation already accepted.");
        if (Instant.parse((String) invite.get("expiresAt")).isBefore(Instant.now())) {
            throw ApiException.badRequest("Invitation has expired.");
        }
        Map<String, Object> user = userRow(userId);
        String email = (String) user.get("email");
        if (email == null || !email.equalsIgnoreCase((String) invite.get("email"))) {
            throw ApiException.forbidden("Sign in with the invited email address.");
        }
        jdbc.update("""
            INSERT INTO membership (user_id, workspace_id, role, joined_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, workspace_id) DO UPDATE SET role = excluded.role
            """, userId, invite.get("workspaceId"), invite.get("role"), Instant.now().toString());
        jdbc.update("UPDATE invite SET accepted_at = ? WHERE id = ?", Instant.now().toString(), invite.get("id"));
        audit((String) invite.get("workspaceId"), userId, "invite.accepted", "invite",
            String.valueOf(invite.get("id")), Map.of());
        return bootstrap(userId);
    }

    @Transactional
    public void mergeGuestWorkspace(String guestUserId, String targetUserId) {
        if (guestUserId == null || targetUserId == null || guestUserId.equals(targetUserId)) return;
        List<Map<String, Object>> guest = jdbc.queryForList("""
            SELECT id, is_guest AS isGuest FROM app_user WHERE id = ? AND deleted_at IS NULL
            """, guestUserId);
        if (guest.isEmpty() || number(guest.get(0).get("isGuest")) == 0) return;
        String personalWorkspace = jdbc.queryForList("""
            SELECT w.id FROM workspace w JOIN membership m ON m.workspace_id = w.id
            WHERE m.user_id = ? AND w.type = 'personal' AND w.deleted_at IS NULL
            ORDER BY w.created_at LIMIT 1
            """, String.class, guestUserId).stream().findFirst().orElse(null);
        if (personalWorkspace == null) {
            jdbc.update("DELETE FROM membership WHERE user_id = ?", guestUserId);
            jdbc.update("UPDATE app_user SET deleted_at = ? WHERE id = ?", Instant.now().toString(), guestUserId);
            jdbc.update("DELETE FROM auth_session WHERE user_id = ?", guestUserId);
            return;
        }
        String now = Instant.now().toString();
        jdbc.update("""
            INSERT INTO membership (user_id, workspace_id, role, joined_at)
            VALUES (?, ?, 'OWNER', ?)
            ON CONFLICT(user_id, workspace_id) DO UPDATE SET role = 'OWNER'
            """, targetUserId, personalWorkspace, now);
        jdbc.update("""
            UPDATE workspace SET name = 'Imported personal'
            WHERE id = ? AND lower(name) NOT LIKE '%imported%'
            """, personalWorkspace);
        jdbc.update("DELETE FROM membership WHERE user_id = ?", guestUserId);
        jdbc.update("UPDATE app_user SET deleted_at = ? WHERE id = ?", Instant.now().toString(), guestUserId);
        jdbc.update("DELETE FROM auth_session WHERE user_id = ?", guestUserId);
    }

    @Transactional
    public String ensureOAuthUser(String guestUserId, String email, String name) {
        String normalized = email == null || email.isBlank() ? null : email.trim().toLowerCase();
        if (normalized != null) {
            List<Map<String, Object>> existing = jdbc.queryForList("""
                SELECT id, deleted_at AS deletedAt FROM app_user WHERE lower(email) = ?
                """, normalized);
            if (!existing.isEmpty()) {
                if (existing.get(0).get("deletedAt") != null) {
                    throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_TOKEN",
                        "That account is no longer available.");
                }
                return String.valueOf(existing.get(0).get("id"));
            }
        }
        String displayName = name == null || name.isBlank()
            ? (normalized == null ? "Drift user" : normalized.substring(0, normalized.indexOf('@')))
            : name.trim();
        if (displayName.length() > 120) displayName = displayName.substring(0, 120);
        if (guestUserId != null) {
            Map<String, Object> guest = jdbc.queryForList("""
                SELECT id, is_guest AS isGuest FROM app_user WHERE id = ? AND deleted_at IS NULL
                """, guestUserId).stream().findFirst().orElse(null);
            if (guest != null && number(guest.get("isGuest")) == 1) {
                jdbc.update("""
                    UPDATE app_user SET email = ?, display_name = ?, is_guest = 0 WHERE id = ?
                    """, normalized, displayName, guestUserId);
                return guestUserId;
            }
        }
        String userId = id();
        jdbc.update("""
            INSERT INTO app_user (id, email, display_name, password_hash, is_guest, timezone, created_at)
            VALUES (?, ?, ?, NULL, 0, 'Asia/Hong_Kong', ?)
            """, userId, normalized, displayName, Instant.now().toString());
        createStarterWorkspace(userId, displayName + "'s workspace");
        return userId;
    }

    public Map<String, Object> userSummary(String userId) {
        return userRow(userId);
    }

    public Map<String, Object> labels(String userId, String workspaceId) {
        requireMembership(userId, workspaceId);
        List<Map<String, Object>> labels = jdbc.queryForList("""
            SELECT l.id, l.name, l.color,
                   (SELECT COUNT(*) FROM task_label tl WHERE tl.label_id = l.id) AS taskCount
            FROM label l WHERE l.workspace_id = ? ORDER BY l.name
            """, workspaceId);
        for (Map<String, Object> label : labels) {
            label.put("_count", Map.of("tasks", number(label.get("taskCount"))));
        }
        return linked(Map.of("labels", labels));
    }

    @Transactional
    public Map<String, Object> createLabel(String userId, ApiDtos.LabelCreate input) {
        if (input == null || blank(input.workspaceId()) || blank(input.name())) {
            throw ApiException.badRequest("Choose a workspace and label name.");
        }
        requireMinimumRole(userId, input.workspaceId(), "MEMBER");
        String name = input.name().trim();
        if (name.length() > 40) throw ApiException.badRequest("Label names must be 40 characters or fewer.");
        String color = blank(input.color()) ? "slate" : input.color().trim();
        if (color.length() > 30) throw ApiException.badRequest("Label colors must be 30 characters or fewer.");
        jdbc.update("""
            INSERT INTO label (id, workspace_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(workspace_id, name) DO UPDATE SET color = excluded.color
            """, id(), input.workspaceId(), name, color, Instant.now().toString());
        Map<String, Object> label = jdbc.queryForList("""
            SELECT id, name, color FROM label WHERE workspace_id = ? AND name = ?
            """, input.workspaceId(), name).stream().findFirst().orElseThrow();
        return linked(Map.of("label", label));
    }

    @Transactional
    public Map<String, Object> deleteLabel(String userId, ApiDtos.LabelDelete input) {
        if (input == null || blank(input.workspaceId()) || blank(input.labelId())) {
            throw ApiException.badRequest("Choose a label to delete.");
        }
        requireMinimumRole(userId, input.workspaceId(), "MEMBER");
        jdbc.update("DELETE FROM task_label WHERE label_id = ?", input.labelId());
        jdbc.update("DELETE FROM label WHERE id = ? AND workspace_id = ?", input.labelId(), input.workspaceId());
        return linked(Map.of("deleted", true));
    }

    public Map<String, Object> views(String userId, String workspaceId) {
        requireMembership(userId, workspaceId);
        List<Map<String, Object>> views = jdbc.queryForList("""
            SELECT id, name, type, filters_json AS filtersJson, is_favorite AS isFavorite,
                   created_at AS createdAt, updated_at AS updatedAt
            FROM view WHERE user_id = ? AND workspace_id = ? ORDER BY created_at
            """, userId, workspaceId);
        for (Map<String, Object> view : views) {
            view.put("isFavorite", number(view.get("isFavorite")) == 1);
        }
        return linked(Map.of("views", views));
    }

    @Transactional
    public Map<String, Object> createView(String userId, ApiDtos.ViewCreate input) {
        if (input == null || blank(input.workspaceId()) || blank(input.name())) {
            throw ApiException.badRequest("Give the view a name.");
        }
        requireMembership(userId, input.workspaceId());
        String type = input.type() == null ? "board" : input.type().toLowerCase();
        if (!Set.of("board", "list", "calendar", "today").contains(type)) {
            throw ApiException.badRequest("Choose a valid view type.");
        }
        String name = input.name().trim();
        if (name.length() > 60) throw ApiException.badRequest("View names must be 60 characters or fewer.");
        String filters = input.filtersJson() == null ? "{}" : input.filtersJson();
        if (filters.length() > 4000) throw ApiException.badRequest("View filters are too large.");
        String now = Instant.now().toString();
        jdbc.update("""
            INSERT INTO view (id, user_id, workspace_id, name, type, filters_json, is_favorite, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, workspace_id, name) DO UPDATE SET
                type = excluded.type, filters_json = excluded.filters_json,
                is_favorite = excluded.is_favorite, updated_at = excluded.updated_at
            """, id(), userId, input.workspaceId(), name, type, filters,
            Boolean.TRUE.equals(input.isFavorite()) ? 1 : 0, now, now);
        Map<String, Object> view = jdbc.queryForList("""
            SELECT id, name, type, filters_json AS filtersJson, is_favorite AS isFavorite,
                   created_at AS createdAt, updated_at AS updatedAt
            FROM view WHERE user_id = ? AND workspace_id = ? AND name = ?
            """, userId, input.workspaceId(), name).stream().findFirst().orElseThrow();
        view.put("isFavorite", number(view.get("isFavorite")) == 1);
        return linked(Map.of("view", view));
    }

    @Transactional
    public Map<String, Object> deleteView(String userId, ApiDtos.ViewDelete input) {
        if (input == null || blank(input.id())) throw ApiException.badRequest("Choose a view to delete.");
        if (input.workspaceId() != null) requireMembership(userId, input.workspaceId());
        jdbc.update("DELETE FROM view WHERE id = ? AND user_id = ?", input.id(), userId);
        return linked(Map.of("deleted", true));
    }

    public Map<String, Object> workspaces(String userId) {
        List<Map<String, Object>> workspaces = jdbc.queryForList("""
            SELECT w.id, w.name, w.type, w.created_by AS createdBy, w.created_at AS createdAt,
                   w.public_sharing_enabled AS publicSharingEnabled, m.role
            FROM membership m JOIN workspace w ON w.id = m.workspace_id
            WHERE m.user_id = ? AND w.deleted_at IS NULL
            ORDER BY m.joined_at
            """, userId);
        return linked(Map.of("workspaces", workspaces));
    }

    public Map<String, Object> metrics(String userId, String workspaceId) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("process", Map.of(
            "uptimeSeconds", java.lang.management.ManagementFactory.getRuntimeMXBean().getUptime() / 1000,
            "java", System.getProperty("java.version"),
            "memoryMb", (Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory()) / (1024 * 1024)
        ));
        Map<String, Object> tenant = new LinkedHashMap<>();
        tenant.put("tasks", 0);
        tenant.put("boards", 0);
        tenant.put("members", 0);
        tenant.put("emailsLast24h", 0);
        long unread = 0;
        if (userId != null) {
            Integer unreadCount = jdbc.queryForObject(
                "SELECT COUNT(*) FROM notification WHERE user_id = ? AND read_at IS NULL", Integer.class, userId);
            unread = unreadCount == null ? 0 : unreadCount;
        }
        if (userId != null && workspaceId != null && !workspaceId.isBlank()) {
            requireMinimumRole(userId, workspaceId, "ADMIN");
            tenant.put("tasks", jdbc.queryForObject(
                "SELECT COUNT(*) FROM task WHERE workspace_id = ? AND deleted_at IS NULL", Integer.class, workspaceId));
            tenant.put("boards", jdbc.queryForObject(
                "SELECT COUNT(*) FROM board WHERE workspace_id = ? AND deleted_at IS NULL", Integer.class, workspaceId));
            tenant.put("members", jdbc.queryForObject(
                "SELECT COUNT(*) FROM membership WHERE workspace_id = ?", Integer.class, workspaceId));
            tenant.put("emailsLast24h", jdbc.queryForObject("""
                SELECT COUNT(*) FROM email_message WHERE user_id = ? AND created_at >= ?
                """, Integer.class, userId, Instant.now().minus(24, ChronoUnit.HOURS).toString()));
        }
        result.put("tenant", tenant);
        result.put("unreadNotifications", unread);
        return linked(result);
    }

    public Map<String, Object> invitePreview(String token, String viewerId) {
        Map<String, Object> invite = jdbc.queryForList("""
            SELECT i.email, i.role, i.expires_at AS expiresAt, i.accepted_at AS acceptedAt,
                   w.id AS workspaceId, w.name AS workspaceName, w.type AS workspaceType
            FROM invite i JOIN workspace w ON w.id = i.workspace_id
            WHERE i.token_hash = ? AND w.deleted_at IS NULL
            """, sha256(token)).stream().findFirst()
            .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_TOKEN",
                "This invitation is invalid or has expired."));
        if (invite.get("acceptedAt") != null
            || Instant.parse(String.valueOf(invite.get("expiresAt"))).isBefore(Instant.now())) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_TOKEN",
                "This invitation is invalid or has expired.");
        }
        Map<String, Object> workspace = new LinkedHashMap<>();
        workspace.put("id", invite.get("workspaceId"));
        workspace.put("name", invite.get("workspaceName"));
        workspace.put("type", invite.get("workspaceType"));
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("invite", Map.of(
            "email", invite.get("email"),
            "role", invite.get("role"),
            "workspace", workspace,
            "expiresAt", invite.get("expiresAt")
        ));
        boolean canAccept = false;
        if (viewerId != null) {
            Map<String, Object> viewer = userRow(viewerId);
            String viewerEmail = (String) viewer.get("email");
            canAccept = viewerEmail != null && viewerEmail.equalsIgnoreCase(String.valueOf(invite.get("email")))
                && number(viewer.get("isGuest")) == 0;
        }
        payload.put("canAccept", canAccept);
        return linked(payload);
    }

    public void clientError(String userId, String message, String stack, String url, String userAgent, String requestId) {
        if (blank(message)) return;
        jdbc.update("""
            INSERT INTO client_error (id, user_id, message, stack, url, user_agent, request_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, id(), userId, truncate(message.replaceAll("[\\r\\n]+", " "), 2000),
            truncate(stack, 20000), truncate(url, 1000), truncate(userAgent, 500),
            truncate(requestId, 100), Instant.now().toString());
    }

    private String truncate(String value, int max) {
        if (value == null) return null;
        return value.length() <= max ? value : value.substring(0, max);
    }

    private String clip(String value, int max) {
        if (value == null) return "";
        return value.length() <= max ? value : value.substring(0, max);
    }

    public Map<String, Object> changeRole(String userId, String workspaceId, String targetUserId, String role) {
        requireMinimumRole(userId, workspaceId, "ADMIN");
        if (!"ADMIN".equals(role) && !"MEMBER".equals(role) && !"GUEST".equals(role)) {
            throw ApiException.badRequest("Invalid member role.");
        }
        Map<String, Object> target = jdbc.queryForList("""
            SELECT role FROM membership WHERE user_id = ? AND workspace_id = ?
            """, targetUserId, workspaceId).stream().findFirst()
            .orElseThrow(() -> ApiException.notFound("Member not found."));
        if ("OWNER".equals(target.get("role"))) throw ApiException.forbidden("The workspace owner role cannot be changed here.");
        jdbc.update("UPDATE membership SET role = ? WHERE user_id = ? AND workspace_id = ?", role, targetUserId, workspaceId);
        audit(workspaceId, userId, "membership.role_changed", "membership", targetUserId,
            Map.of("role", role));
        return members(userId, workspaceId);
    }

    public Map<String, Object> removeMember(String userId, String workspaceId, String targetUserId) {
        requireMinimumRole(userId, workspaceId, "ADMIN");
        if (targetUserId.equals(userId)) throw ApiException.badRequest("You cannot remove yourself.");
        Map<String, Object> target = jdbc.queryForList("""
            SELECT role FROM membership WHERE user_id = ? AND workspace_id = ?
            """, targetUserId, workspaceId).stream().findFirst()
            .orElseThrow(() -> ApiException.notFound("Member not found."));
        if ("OWNER".equals(target.get("role"))) throw ApiException.forbidden("The workspace owner cannot be removed.");
        jdbc.update("DELETE FROM membership WHERE user_id = ? AND workspace_id = ?", targetUserId, workspaceId);
        audit(workspaceId, userId, "membership.left", "membership", targetUserId, Map.of());
        return members(userId, workspaceId);
    }

    private void createStarterWorkspace(String userId, String workspaceName) {
        createStarterWorkspace(userId, workspaceName, "personal");
    }

    private void createStarterWorkspace(String userId, String workspaceName, String type) {
        String workspaceId = id();
        String boardId = id();
        String now = Instant.now().toString();
        jdbc.update("""
            INSERT INTO workspace (id, name, type, created_by, created_at, public_sharing_enabled)
            VALUES (?, ?, ?, ?, ?, ?)
            """, workspaceId, workspaceName, type, userId, now, "personal".equals(type) ? 0 : 1);
        jdbc.update("""
            INSERT INTO membership (user_id, workspace_id, role, joined_at)
            VALUES (?, ?, 'OWNER', ?)
            """, userId, workspaceId, now);
        jdbc.update("""
            INSERT INTO board (id, workspace_id, name, position, created_at)
            VALUES (?, ?, 'My tasks', 0, ?)
            """, boardId, workspaceId, now);
        String[] columns = {"To do", "In progress", "Done"};
        for (int i = 0; i < columns.length; i++) {
            jdbc.update("""
                INSERT INTO board_column (id, board_id, name, position, is_done)
                VALUES (?, ?, ?, ?, ?)
                """, id(), boardId, columns[i], i, i == columns.length - 1 ? 1 : 0);
        }
    }

    private Map<String, Object> userRow(String userId) {
        return jdbc.queryForList("""
            SELECT id, email, display_name AS name, is_guest AS isGuest
            FROM app_user WHERE id = ? AND deleted_at IS NULL
            """, userId).stream().findFirst()
            .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Session user not found."));
    }

    public Map<String, Object> bootstrap(String userId) {
        Map<String, Object> user = user(userId);
        List<Map<String, Object>> memberships = jdbc.queryForList("""
            SELECT w.id, w.name, w.type, m.role
            FROM membership m JOIN workspace w ON w.id = m.workspace_id
            WHERE m.user_id = ? AND w.deleted_at IS NULL
            ORDER BY m.joined_at
            """, userId);
        List<Map<String, Object>> workspaces = new ArrayList<>();
        for (Map<String, Object> membership : memberships) {
            Map<String, Object> workspace = linked(membership);
            workspace.put("boards", boards(userId, (String) membership.get("id")));
            workspace.put("labels", jdbc.queryForList("""
                SELECT id, name, color FROM label WHERE workspace_id = ? ORDER BY name
                """, membership.get("id")));
            workspaces.add(workspace);
        }
        return linked(Map.of(
            "user", user,
            "workspaces", workspaces,
            "templates", BoardTemplates.catalog()
        ));
    }

    @Transactional
    public Map<String, Object> createBoard(String userId, ApiDtos.BoardCreate input) {
        if (input == null || blank(input.workspaceId()) || blank(input.name())) {
            throw ApiException.badRequest("Workspace and board name are required.");
        }
        if (input.name().trim().length() > 120) {
            throw ApiException.badRequest("Board name must be 120 characters or fewer.");
        }
        requireMinimumRole(userId, input.workspaceId(), "MEMBER");
        BoardTemplates.Template template = BoardTemplates.find(input.template());
        String description = input.description() == null ? template.description() : input.description().trim();
        if (description.length() > 1000) throw ApiException.badRequest("Board description must be 1000 characters or fewer.");
        String visibility = normalizeVisibility(input.visibility());
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM board WHERE workspace_id = ? AND deleted_at IS NULL AND archived_at IS NULL", Integer.class, input.workspaceId());
        if (count != null && count >= 20) throw ApiException.badRequest("This workspace already has the maximum number of boards.");
        int position = jdbc.queryForObject("""
            SELECT COALESCE(MAX(position), -1) + 1 FROM board
            WHERE workspace_id = ? AND deleted_at IS NULL
            """, Integer.class, input.workspaceId());
        String boardId = id();
        String now = Instant.now().toString();
        jdbc.update("""
            INSERT INTO board (id, workspace_id, name, description, position, visibility, version, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
            """, boardId, input.workspaceId(), input.name().trim(), description, position, visibility, userId, now);
        List<BoardTemplates.ColumnTemplate> columns = template.columns();
        for (int i = 0; i < columns.size(); i++) {
            BoardTemplates.ColumnTemplate column = columns.get(i);
            jdbc.update("""
                INSERT INTO board_column (id, board_id, name, position, is_done, wip_limit, wip_enforced)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """, id(), boardId, column.name(), i, column.done() ? 1 : 0,
                column.wipLimit(), column.wipLimit() == null ? 0 : 1);
        }
        audit(input.workspaceId(), userId, "board.created", "board", boardId,
            Map.of("name", input.name().trim(), "template", template.id()));
        return linked(Map.of("board", boardRow(boardId)));
    }

    @Transactional
    public Map<String, Object> createColumn(String userId, ApiDtos.ColumnCreate input) {
        if (input == null || blank(input.workspaceId()) || blank(input.boardId()) || blank(input.name())) {
            throw ApiException.badRequest("Choose a board and give the column a name.");
        }
        Map<String, Object> board = boardRow(input.boardId());
        if (!input.workspaceId().equals(board.get("workspaceId"))) throw ApiException.notFound("Board not found.");
        requireMinimumRole(userId, input.workspaceId(), "MEMBER");
        requireBoardVisible(userId, board);
        String name = normalizeColumnName(input.name());
        List<Map<String, Object>> columns = activeColumns(input.boardId());
        if (columns.size() >= 100) throw ApiException.badRequest("Boards support up to 100 columns.");
        int index = columns.size();
        if (!blank(input.afterId())) {
            int after = -1;
            for (int i = 0; i < columns.size(); i++) {
                if (input.afterId().equals(String.valueOf(columns.get(i).get("id")))) after = i;
            }
            if (after >= 0) index = after + 1;
        }
        String columnId = id();
        String now = Instant.now().toString();
        jdbc.update("""
            INSERT INTO board_column (id, board_id, name, position, is_done, wip_limit, wip_enforced)
            VALUES (?, ?, ?, ?, 0, NULL, 0)
            """, columnId, input.boardId(), name, index);
        for (int i = index; i < columns.size(); i++) {
            jdbc.update("UPDATE board_column SET position = ? WHERE id = ?", i + 1, columns.get(i).get("id"));
        }
        audit(input.workspaceId(), userId, "column.created", "column", columnId,
            Map.of("boardId", input.boardId(), "name", name));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("column", columnRow(columnId));
        return result;
    }

    @Transactional
    public Map<String, Object> updateColumn(String userId, String columnId, ApiDtos.ColumnUpdate input) {
        if (input == null) throw ApiException.badRequest("Column changes are required.");
        Map<String, Object> column = columnRowWithBoard(columnId);
        requireMinimumRole(userId, stringValue(column.get("workspaceId")), "MEMBER");
        requireBoardVisible(userId, boardRowRaw(String.valueOf(column.get("boardId"))));
        String name = input.name() == null ? String.valueOf(column.get("name")) : normalizeColumnName(input.name());
        Integer wipLimit = numberOrNull(column.get("wipLimit"));
        if (input.wipLimit() != null) {
            Integer requested = input.wipLimit().isNull() ? null : input.wipLimit().asInt();
            if (requested != null && (requested < 1 || requested > 999)) {
                throw ApiException.badRequest("WIP limit must be between 1 and 999.");
            }
            wipLimit = requested;
        }
        boolean wipEnforced = input.wipEnforced() == null
            ? number(column.get("wipEnforced")) == 1 : input.wipEnforced();
        boolean isDone = input.isDone() == null
            ? number(column.get("isDone")) == 1 : input.isDone();
        if (!isDone && number(column.get("isDone")) == 1) {
            Integer doneColumns = jdbc.queryForObject("""
                SELECT COUNT(*) FROM board_column
                WHERE board_id = ? AND deleted_at IS NULL AND is_done = 1
                """, Integer.class, column.get("boardId"));
            if (doneColumns != null && doneColumns <= 1) {
                throw new ApiException(HttpStatus.CONFLICT, "CONFLICT",
                    "At least one column must remain a done column.");
            }
        }
        jdbc.update("""
            UPDATE board_column SET name = ?, wip_limit = ?, wip_enforced = ?, is_done = ?
            WHERE id = ? AND deleted_at IS NULL
            """, name, wipLimit, wipEnforced ? 1 : 0, isDone ? 1 : 0, columnId);
        if (input.position() != null) {
            List<Map<String, Object>> columns = activeColumns(String.valueOf(column.get("boardId")));
            int target = Math.max(0, Math.min(columns.size() - 1, input.position()));
            Map<String, Object> moving = columns.stream()
                .filter(item -> columnId.equals(String.valueOf(item.get("id")))).findFirst().orElse(null);
            if (moving != null) {
                columns.remove(moving);
                columns.add(target, moving);
                for (int i = 0; i < columns.size(); i++) {
                    jdbc.update("UPDATE board_column SET position = ? WHERE id = ?", i, columns.get(i).get("id"));
                }
            }
        }
        audit(stringValue(column.get("workspaceId")), userId, "column.updated", "column", columnId,
            Map.of("boardId", column.get("boardId")));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("column", columnRow(columnId));
        return result;
    }

    @Transactional
    public Map<String, Object> deleteColumn(String userId, String columnId, String workspaceId) {
        Map<String, Object> column = columnRowWithBoard(columnId);
        if (workspaceId == null || !workspaceId.equals(column.get("workspaceId"))) {
            throw ApiException.notFound("Column not found.");
        }
        requireMinimumRole(userId, workspaceId, "MEMBER");
        requireBoardVisible(userId, boardRowRaw(String.valueOf(column.get("boardId"))));
        List<Map<String, Object>> columns = activeColumns(String.valueOf(column.get("boardId")));
        if (columns.size() <= 1) {
            throw new ApiException(HttpStatus.CONFLICT, "CONFLICT", "A board needs at least one column.");
        }
        Integer taskCount = jdbc.queryForObject("""
            SELECT COUNT(*) FROM task WHERE column_id = ? AND deleted_at IS NULL
            """, Integer.class, columnId);
        if (taskCount != null && taskCount > 0) {
            throw new ApiException(HttpStatus.CONFLICT, "CONFLICT",
                "Move or delete the " + taskCount + " task" + (taskCount == 1 ? "" : "s")
                    + " in this column first.");
        }
        jdbc.update("UPDATE board_column SET deleted_at = ? WHERE id = ?", Instant.now().toString(), columnId);
        List<Map<String, Object>> remaining = activeColumns(String.valueOf(column.get("boardId")));
        for (int i = 0; i < remaining.size(); i++) {
            jdbc.update("UPDATE board_column SET position = ? WHERE id = ?", i, remaining.get(i).get("id"));
        }
        audit(workspaceId, userId, "column.deleted", "column", columnId,
            Map.of("boardId", column.get("boardId")));
        return linked(Map.of("deleted", true));
    }

    @Transactional
    public Map<String, Object> reorderColumns(String userId, ApiDtos.ColumnReorder input) {
        if (input == null || blank(input.workspaceId()) || blank(input.boardId())
            || input.orderedIds() == null) {
            throw ApiException.badRequest("Choose a board and a complete column order.");
        }
        Map<String, Object> board = boardRow(input.boardId());
        if (!input.workspaceId().equals(board.get("workspaceId"))) throw ApiException.notFound("Board not found.");
        requireMinimumRole(userId, input.workspaceId(), "MEMBER");
        requireBoardVisible(userId, board);
        List<Map<String, Object>> columns = activeColumns(input.boardId());
        if (input.orderedIds().size() != columns.size()) {
            throw ApiException.badRequest("Include every column exactly once.");
        }
        List<String> existing = columns.stream().map(item -> String.valueOf(item.get("id"))).toList();
        for (String id : input.orderedIds()) {
            if (!existing.contains(id)) throw ApiException.badRequest("Unknown column in order.");
        }
        for (int i = 0; i < input.orderedIds().size(); i++) {
            jdbc.update("UPDATE board_column SET position = ? WHERE id = ?", i, input.orderedIds().get(i));
        }
        audit(input.workspaceId(), userId, "column.reordered", "board", input.boardId(),
            Map.of("columns", input.orderedIds().size()));
        return linked(Map.of("reordered", true));
    }

    private List<Map<String, Object>> activeColumns(String boardId) {
        return jdbc.queryForList("""
            SELECT id, name, position, is_done AS isDone, wip_limit AS wipLimit,
                   wip_enforced AS wipEnforced
            FROM board_column WHERE board_id = ? AND deleted_at IS NULL
            ORDER BY position ASC, name ASC
            """, boardId);
    }

    private Map<String, Object> columnRow(String columnId) {
        Map<String, Object> column = jdbc.queryForList("""
            SELECT id, board_id AS boardId, name, position, is_done AS isDone,
                   wip_limit AS wipLimit, wip_enforced AS wipEnforced
            FROM board_column WHERE id = ? AND deleted_at IS NULL
            """, columnId).stream().findFirst()
            .orElseThrow(() -> ApiException.notFound("Column not found."));
        column.put("isDone", number(column.get("isDone")) == 1);
        column.put("wipEnforced", number(column.get("wipEnforced")) == 1);
        return column;
    }

    private Map<String, Object> columnRowWithBoard(String columnId) {
        Map<String, Object> column = jdbc.queryForList("""
            SELECT c.id, c.board_id AS boardId, c.name, c.position, c.is_done AS isDone,
                   c.wip_limit AS wipLimit, c.wip_enforced AS wipEnforced,
                   b.workspace_id AS workspaceId
            FROM board_column c JOIN board b ON b.id = c.board_id
            WHERE c.id = ? AND c.deleted_at IS NULL AND b.deleted_at IS NULL
            """, columnId).stream().findFirst()
            .orElseThrow(() -> ApiException.notFound("Column not found."));
        column.put("isDone", number(column.get("isDone")) == 1);
        column.put("wipEnforced", number(column.get("wipEnforced")) == 1);
        return column;
    }

    private String normalizeColumnName(String value) {
        String name = value == null ? "" : value.trim();
        if (name.isEmpty() || name.length() > 60) {
            throw ApiException.badRequest("Column name must be between 1 and 60 characters.");
        }
        return name;
    }

    private Integer numberOrNull(Object value) {
        return value instanceof Number number ? number.intValue() : null;
    }

    private void requireWipCapacity(String columnId) {
        Map<String, Object> column = jdbc.queryForList("""
            SELECT name, wip_limit AS wipLimit, wip_enforced AS wipEnforced
            FROM board_column WHERE id = ? AND deleted_at IS NULL
            """, columnId).stream().findFirst().orElse(null);
        if (column == null || number(column.get("wipEnforced")) != 1) return;
        Integer limit = numberOrNull(column.get("wipLimit"));
        if (limit == null || limit <= 0) return;
        Integer count = jdbc.queryForObject("""
            SELECT COUNT(*) FROM task
            WHERE column_id = ? AND deleted_at IS NULL AND archived_at IS NULL
            """, Integer.class, columnId);
        if (count != null && count >= limit) {
            throw ApiException.wipLimit("The column " + column.get("name")
                + " is at its WIP limit of " + limit + " open tasks.");
        }
    }

    public Map<String, Object> board(String userId, String boardId) {
        Map<String, Object> board = boardRow(boardId);
        requireMembership(userId, (String) board.get("workspaceId"));
        requireBoardVisible(userId, board);
        String role = roleFor(userId, (String) board.get("workspaceId"));
        List<Map<String, Object>> columns = jdbc.queryForList("""
            SELECT id, name, position, is_done AS isDone, wip_limit AS wipLimit,
                   wip_enforced AS wipEnforced
            FROM board_column
            WHERE board_id = ? AND deleted_at IS NULL
            ORDER BY position, name
            """, boardId);
        for (Map<String, Object> column : columns) {
            column.put("isDone", number(column.get("isDone")) == 1);
            column.put("wipEnforced", number(column.get("wipEnforced")) == 1);
            column.put("tasks", tasks(userId, boardId, (String) column.get("id")));
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("id", board.get("id"));
        payload.put("workspaceId", board.get("workspaceId"));
        payload.put("name", board.get("name"));
        payload.put("description", board.get("description"));
        payload.put("color", board.get("color"));
        payload.put("visibility", board.get("visibility"));
        payload.put("version", board.get("version"));
        payload.put("shareEnabled", board.get("shareEnabled"));
        payload.put("archivedAt", board.get("archivedAt"));
        payload.put("createdById", board.get("createdById"));
        payload.put("columns", columns);
        payload.put("members", jdbc.queryForList("""
            SELECT m.user_id AS id, m.role, u.display_name AS name, u.email, u.is_guest AS isGuest
            FROM membership m JOIN app_user u ON u.id = m.user_id
            WHERE m.workspace_id = ? ORDER BY m.joined_at
            """, board.get("workspaceId")));
        payload.put("labels", labels(userId, String.valueOf(board.get("workspaceId"))).get("labels"));
        payload.put("views", views(userId, String.valueOf(board.get("workspaceId"))).get("views"));
        payload.put("automationCount", jdbc.queryForObject("""
            SELECT COUNT(*) FROM automation_rule WHERE workspace_id = ? AND enabled = 1
            """, Integer.class, board.get("workspaceId")));
        payload.put("permissions", linked(Map.of(
            "canEdit", roleRank(role) >= roleRank("MEMBER"),
            "canManage", roleRank(role) >= roleRank("ADMIN"),
            "canShare", roleRank(role) >= roleRank("MEMBER")
        )));
        payload.put("role", role);
        return linked(Map.of(
            "board", linked(payload),
            "tasks", columns.stream().flatMap(column -> ((List<Map<String, Object>>) column.get("tasks")).stream()).toList(),
            "taskCount", columns.stream().mapToInt(column -> ((List<?>) column.get("tasks")).size()).sum()
        ));
    }

    public Map<String, Object> updateBoard(String userId, String boardId, ApiDtos.BoardUpdate input) {
        Map<String, Object> board = boardRowRaw(boardId);
        requireMinimumRole(userId, (String) board.get("workspaceId"), "MEMBER");
        requireBoardVisible(userId, board);
        if (input == null) throw ApiException.badRequest("Board changes are required.");
        int version = input.version() == null ? number(board.get("version")) : input.version();
        if (input.version() != null && version != number(board.get("version"))) {
            throw ApiException.conflict("This board changed elsewhere.", number(board.get("version")));
        }
        String name = input.name() == null ? (String) board.get("name") : input.name().trim();
        if (name.isEmpty() || name.length() > 120) throw ApiException.badRequest("Board name must be between 1 and 120 characters.");
        String description = input.description() == null ? (String) board.get("description") : input.description().trim();
        if (description.length() > 1000) throw ApiException.badRequest("Board description must be 1000 characters or fewer.");
        String visibility = input.visibility() == null ? (String) board.get("visibility") : normalizeVisibility(input.visibility());
        String archivedAt = (String) board.get("archivedAt");
        if (input.archived() != null) {
            if (input.archived()) {
                Integer active = jdbc.queryForObject("""
                    SELECT COUNT(*) FROM board WHERE workspace_id = ? AND deleted_at IS NULL AND archived_at IS NULL
                    """, Integer.class, board.get("workspaceId"));
                if (active == null || active <= 1) throw ApiException.badRequest("Keep at least one active board.");
                if (archivedAt == null) archivedAt = Instant.now().toString();
            } else {
                archivedAt = null;
            }
        }
        jdbc.update("""
            UPDATE board SET name = ?, description = ?, visibility = ?, archived_at = ?,
                             version = version + 1
            WHERE id = ? AND version = ?
            """, name, description, visibility, archivedAt, boardId, version);
        audit((String) board.get("workspaceId"), userId, "board.updated", "board", boardId, Map.of());
        return linked(Map.of("board", boardRowRaw(boardId)));
    }

    @Transactional
    public Map<String, Object> duplicateBoard(String userId, String boardId) {
        Map<String, Object> source = boardRow(boardId);
        String workspaceId = (String) source.get("workspaceId");
        requireMinimumRole(userId, workspaceId, "MEMBER");
        requireBoardVisible(userId, source);
        Integer count = jdbc.queryForObject("""
            SELECT COUNT(*) FROM board WHERE workspace_id = ? AND deleted_at IS NULL AND archived_at IS NULL
            """, Integer.class, workspaceId);
        if (count != null && count >= 20) throw ApiException.badRequest("This workspace already has the maximum number of boards.");
        int position = jdbc.queryForObject("""
            SELECT COALESCE(MAX(position), -1) + 1 FROM board WHERE workspace_id = ? AND deleted_at IS NULL
            """, Integer.class, workspaceId);
        String newBoardId = id();
        String now = Instant.now().toString();
        jdbc.update("""
            INSERT INTO board (id, workspace_id, name, description, color, position, visibility, version, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            """, newBoardId, workspaceId, source.get("name") + " copy",
            source.get("description") == null ? "" : source.get("description"),
            source.get("color") == null ? "moss" : source.get("color"), position,
            source.get("visibility") == null ? "workspace" : source.get("visibility"), userId, now);
        Map<String, String> columnMap = new LinkedHashMap<>();
        for (Map<String, Object> column : jdbc.queryForList("""
            SELECT id, name, position, is_done, wip_limit, wip_enforced
            FROM board_column WHERE board_id = ? AND deleted_at IS NULL ORDER BY position, name
            """, boardId)) {
            String newColumnId = id();
            columnMap.put((String) column.get("id"), newColumnId);
            jdbc.update("""
                INSERT INTO board_column (id, board_id, name, position, is_done, wip_limit, wip_enforced)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """, newColumnId, newBoardId, column.get("name"), column.get("position"),
                column.get("is_done"), column.get("wip_limit"), column.get("wip_enforced"));
        }
        for (Map<String, Object> task : jdbc.queryForList("""
            SELECT id, column_id AS columnId, title, description, priority, start_date AS startDate,
                   due_date AS dueDate, due_all_day AS dueAllDay, estimate_minutes AS estimateMinutes,
                   assignee_id AS assigneeId, recurrence_rule AS recurrenceRule, recurrence_ends_at AS recurrenceEndsAt,
                   position
            FROM task WHERE board_id = ? AND deleted_at IS NULL AND archived_at IS NULL
            ORDER BY position, created_at
            """, boardId)) {
            String newTaskId = id();
            jdbc.update("""
                INSERT INTO task (id, workspace_id, board_id, column_id, title, description, priority,
                                  start_date, due_date, due_all_day, estimate_minutes, actual_minutes,
                                  assignee_id, recurrence_rule, recurrence_ends_at, position,
                                  version, created_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 1, ?, ?, ?)
                """, newTaskId, workspaceId, newBoardId, columnMap.get(task.get("columnId")),
                task.get("title"), task.get("description"), task.get("priority"),
                task.get("startDate"), task.get("dueDate"), task.get("dueAllDay"), task.get("estimateMinutes"),
                task.get("assigneeId"), task.get("recurrenceRule"), task.get("recurrenceEndsAt"),
                task.get("position"), userId, now, now);
            List<String> labelNames = labelsForTask((String) task.get("id")).stream()
                .map(label -> String.valueOf(label.get("name"))).toList();
            if (!labelNames.isEmpty()) replaceTaskLabels(newTaskId, workspaceId, labelNames);
        }
        audit(workspaceId, userId, "board.duplicated", "board", newBoardId, Map.of("sourceBoardId", boardId));
        return board(userId, newBoardId);
    }

    public Map<String, Object> deleteBoard(String userId, String boardId) {
        Map<String, Object> board = boardRowRaw(boardId);
        requireMinimumRole(userId, (String) board.get("workspaceId"), "ADMIN");
        requireBoardVisible(userId, board);
        Integer active = jdbc.queryForObject("""
            SELECT COUNT(*) FROM board WHERE workspace_id = ? AND deleted_at IS NULL AND archived_at IS NULL
            """, Integer.class, board.get("workspaceId"));
        if (active == null || active <= 1) throw ApiException.badRequest("Keep at least one active board.");
        String now = Instant.now().toString();
        List<String> taskIds = jdbc.queryForList("""
            SELECT id FROM task WHERE board_id = ? AND deleted_at IS NULL
            """, String.class, boardId);
        jdbc.update("UPDATE board SET deleted_at = ? WHERE id = ?", now, boardId);
        jdbc.update("""
            UPDATE task SET deleted_at = ?, version = version + 1
            WHERE board_id = ? AND deleted_at IS NULL
            """, now, boardId);
        Map<String, Object> inverse = new LinkedHashMap<>();
        inverse.put("taskIds", taskIds);
        Map<String, Object> undo = createUndo(userId, (String) board.get("workspaceId"),
            "board.delete", "board", boardId, inverse, 10);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("deleted", true);
        if (undo != null) result.put("undo", undo);
        audit((String) board.get("workspaceId"), userId, "board.deleted", "board", boardId, Map.of());
        return result;
    }

    public Map<String, Object> toggleBoardShare(String userId, String boardId, ApiDtos.ShareToggle input) {
        Map<String, Object> board = boardRow(boardId);
        String workspaceId = (String) board.get("workspaceId");
        requireMinimumRole(userId, workspaceId, "MEMBER");
        requireBoardVisible(userId, board);
        if (input == null || input.enabled() == null) {
            throw ApiException.badRequest("Choose whether to enable sharing.");
        }
        String type = jdbc.queryForObject("SELECT type FROM workspace WHERE id = ?", String.class, workspaceId);
        Integer sharing = jdbc.queryForObject("SELECT public_sharing_enabled FROM workspace WHERE id = ?", Integer.class, workspaceId);
        if (type == null || (sharing != null && sharing == 0)) {
            throw ApiException.forbidden("Public sharing is disabled for this workspace.");
        }
        boolean enabled = input.enabled();
        String token = enabled ? (String) board.get("shareToken") : null;
        if (enabled && blank(token)) token = randomToken();
        jdbc.update("""
            UPDATE board SET share_enabled = ?, share_token = ?, version = version + 1
            WHERE id = ? AND deleted_at IS NULL
            """, enabled ? 1 : 0, token, boardId);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("enabled", enabled);
        result.put("token", token);
        audit(workspaceId, userId, enabled ? "board.share_enabled" : "board.share_disabled",
            "board", boardId, Map.of());
        return result;
    }

    public Map<String, Object> publicBoard(String token) {
        if (blank(token)) throw ApiException.notFound("This shared board is no longer available.");
        Map<String, Object> board = jdbc.queryForList("""
            SELECT b.id, b.name, b.description, b.created_at AS createdAt, w.name AS workspaceName
            FROM board b JOIN workspace w ON w.id = b.workspace_id
            WHERE b.share_token = ? AND b.share_enabled = 1
              AND b.deleted_at IS NULL AND b.archived_at IS NULL
              AND w.public_sharing_enabled = 1 AND w.deleted_at IS NULL
            """, token).stream().findFirst()
            .orElseThrow(() -> ApiException.notFound("This shared board is no longer available."));
        List<Map<String, Object>> columns = jdbc.queryForList("""
            SELECT id, name, position, is_done AS isDone, wip_limit AS wipLimit,
                   wip_enforced AS wipEnforced
            FROM board_column WHERE board_id = ? AND deleted_at IS NULL
            ORDER BY position, name
            """, board.get("id"));
        for (Map<String, Object> column : columns) {
            column.put("isDone", number(column.get("isDone")) == 1);
            column.put("wipEnforced", number(column.get("wipEnforced")) == 1);
        }
        List<Map<String, Object>> tasks = jdbc.queryForList("""
            SELECT t.id, t.column_id AS columnId, t.title, t.description, t.priority,
                   t.due_date AS dueDate, t.due_all_day AS dueAllDay,
                   c.is_done AS completed, t.assignee_id AS assigneeId,
                   u.display_name AS assigneeName
            FROM task t
            JOIN board_column c ON c.id = t.column_id
            LEFT JOIN app_user u ON u.id = t.assignee_id
            WHERE t.board_id = ? AND t.deleted_at IS NULL AND t.archived_at IS NULL
            ORDER BY t.position, t.created_at
            """, board.get("id"));
        for (Map<String, Object> task : tasks) {
            task.put("completed", number(task.get("completed")) == 1);
            task.put("labels", labelsForTask((String) task.get("id")));
            List<Map<String, Object>> subtasks = jdbc.queryForList("""
                SELECT id, title, completed FROM subtask WHERE task_id = ? ORDER BY position, created_at
                """, task.get("id"));
            for (Map<String, Object> subtask : subtasks) {
                subtask.put("completed", number(subtask.get("completed")) == 1);
            }
            task.put("subtasks", subtasks);
            Object assigneeId = task.remove("assigneeId");
            Object assigneeName = task.remove("assigneeName");
            if (assigneeId == null) {
                task.put("assignee", null);
            } else {
                Map<String, Object> assignee = new LinkedHashMap<>();
                assignee.put("name", assigneeName == null ? "" : assigneeName);
                assignee.put("avatarUrl", null);
                task.put("assignee", assignee);
            }
        }
        String updatedAt = jdbc.queryForObject("""
            SELECT COALESCE(MAX(updated_at), ?) FROM task WHERE board_id = ? AND deleted_at IS NULL
            """, String.class, board.get("createdAt"), board.get("id"));
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("name", board.get("name"));
        payload.put("description", board.get("description"));
        payload.put("workspaceName", board.get("workspaceName"));
        payload.put("updatedAt", updatedAt);
        payload.put("columns", columns);
        payload.put("tasks", tasks);
        return linked(Map.of("board", payload));
    }

    public Map<String, Object> calendar(String userId, String workspaceId, String start, String end) {
        requireMembership(userId, workspaceId);
        int canSeePrivate = roleRank(roleFor(userId, workspaceId)) >= roleRank("ADMIN") ? 1 : 0;
        LocalDate from;
        LocalDate to;
        try {
            from = LocalDate.parse(start);
            to = LocalDate.parse(end);
        } catch (Exception exception) {
            throw ApiException.badRequest("Calendar start and end must be dates.");
        }
        if (to.isBefore(from) || ChronoUnit.DAYS.between(from, to) > 366) {
            throw ApiException.badRequest("Calendar range is invalid.");
        }
        List<Map<String, Object>> tasks = jdbc.queryForList("""
            SELECT t.id, t.title, t.priority, t.due_date AS dueDate,
                   substr(t.due_date, 1, 10) AS date, t.board_id AS boardId,
                   b.name AS boardName, c.name AS columnName, c.is_done AS completed
            FROM task t
            JOIN board b ON b.id = t.board_id
            JOIN board_column c ON c.id = t.column_id
            WHERE t.workspace_id = ? AND t.deleted_at IS NULL AND t.archived_at IS NULL
              AND b.workspace_id = t.workspace_id
              AND (b.visibility = 'workspace' OR b.created_by = ? OR ? = 1)
              AND substr(t.due_date, 1, 10) BETWEEN ? AND ?
            ORDER BY t.due_date, t.position
            LIMIT 500
            """, workspaceId, userId, canSeePrivate, from.toString(), to.toString());
        List<Map<String, Object>> blocks = jdbc.queryForList("""
            SELECT pb.date, pb.start_minute AS startMinute, pb.minutes,
                   pb.task_id AS taskId, t.title
            FROM plan_block pb JOIN task t ON t.id = pb.task_id
            WHERE pb.user_id = ? AND pb.workspace_id = ? AND pb.date BETWEEN ? AND ?
              AND t.deleted_at IS NULL AND t.archived_at IS NULL
            ORDER BY pb.date, pb.start_minute
            """, userId, workspaceId, from.toString(), to.toString());
        Map<String, List<Map<String, Object>>> tasksByDate = new HashMap<>();
        Map<String, List<Map<String, Object>>> blocksByDate = new HashMap<>();
        for (Map<String, Object> task : tasks) {
            tasksByDate.computeIfAbsent((String) task.get("date"), key -> new ArrayList<>()).add(task);
        }
        for (Map<String, Object> block : blocks) {
            blocksByDate.computeIfAbsent((String) block.get("date"), key -> new ArrayList<>()).add(block);
        }
        List<Map<String, Object>> days = new ArrayList<>();
        for (LocalDate date = from; !date.isAfter(to); date = date.plusDays(1)) {
            String key = date.toString();
            days.add(linked(Map.of(
                "date", key,
                "tasks", tasksByDate.getOrDefault(key, List.of()),
                "planBlocks", blocksByDate.getOrDefault(key, List.of())
            )));
        }
        return linked(Map.of("days", days, "start", from.toString(), "end", to.toString()));
    }

    public Map<String, Object> archive(String userId, String workspaceId) {
        requireMembership(userId, workspaceId);
        int canSeePrivate = roleRank(roleFor(userId, workspaceId)) >= roleRank("ADMIN") ? 1 : 0;
        List<Map<String, Object>> tasks = jdbc.queryForList("""
            SELECT t.id, t.title, t.description, t.priority, t.due_date AS dueDate,
                   t.due_all_day AS dueAllDay, t.estimate_minutes AS estimateMinutes,
                   t.board_id AS boardId, b.name AS boardName, c.name AS columnName,
                   c.is_done AS completed, t.archived_at AS archivedAt,
                   CASE WHEN c.is_done = 1 THEN t.updated_at ELSE NULL END AS completedAt,
                   t.updated_at AS updatedAt
            FROM task t
            JOIN board b ON b.id = t.board_id
            JOIN board_column c ON c.id = t.column_id
            WHERE t.workspace_id = ? AND t.deleted_at IS NULL AND (c.is_done = 1 OR t.archived_at IS NOT NULL)
              AND b.workspace_id = t.workspace_id
              AND (b.visibility = 'workspace' OR b.created_by = ? OR ? = 1)
            ORDER BY t.updated_at DESC LIMIT 500
            """, workspaceId, userId, canSeePrivate);
        for (Map<String, Object> task : tasks) {
            task.put("completed", number(task.get("completed")));
            task.put("labels", labelsForTask(String.valueOf(task.get("id"))));
        }
        List<Map<String, Object>> archivedBoards = jdbc.queryForList("""
            SELECT b.id, b.name, b.archived_at AS archivedAt, b.version,
                   (SELECT COUNT(*) FROM task t WHERE t.board_id = b.id
                      AND t.deleted_at IS NULL) AS taskCount
            FROM board b
            WHERE b.workspace_id = ? AND b.deleted_at IS NULL AND b.archived_at IS NOT NULL
              AND (b.visibility = 'workspace' OR b.created_by = ? OR ? = 1)
            ORDER BY b.archived_at DESC
            """, workspaceId, userId, canSeePrivate);
        return linked(Map.of("tasks", tasks, "archivedBoards", archivedBoards));
    }

    public Map<String, Object> upcoming(String userId, String workspaceId, int days) {
        requireMembership(userId, workspaceId);
        int canSeePrivate = roleRank(roleFor(userId, workspaceId)) >= roleRank("ADMIN") ? 1 : 0;
        int range = Math.max(1, Math.min(60, days));
        LocalDate startDate = LocalDate.parse(todayForUser(userId));
        String start = startDate.toString();
        String end = startDate.plusDays(range).toString();
        List<Map<String, Object>> tasks = jdbc.queryForList("""
            SELECT t.id, t.title, t.priority, t.due_date AS dueDate, t.due_all_day AS dueAllDay,
                   t.estimate_minutes AS estimateMinutes, substr(t.due_date, 1, 10) AS date,
                   t.board_id AS boardId, b.name AS boardName, c.name AS columnName,
                   (SELECT COUNT(*) FROM subtask s WHERE s.task_id = t.id) AS subtaskCount,
                   (SELECT COUNT(*) FROM subtask s WHERE s.task_id = t.id AND s.completed = 1) AS subtaskDone
            FROM task t
            JOIN board b ON b.id = t.board_id
            JOIN board_column c ON c.id = t.column_id
            WHERE t.workspace_id = ? AND t.deleted_at IS NULL AND t.archived_at IS NULL AND c.is_done = 0
              AND b.workspace_id = t.workspace_id
              AND (b.visibility = 'workspace' OR b.created_by = ? OR ? = 1)
              AND substr(t.due_date, 1, 10) BETWEEN ? AND ?
            ORDER BY t.due_date, t.position LIMIT 500
            """, workspaceId, userId, canSeePrivate, start, end);
        Map<String, List<Map<String, Object>>> byDate = new HashMap<>();
        for (Map<String, Object> task : tasks) {
            task.put("labels", labelsForTask(String.valueOf(task.get("id"))));
            task.put("completed", 0);
            byDate.computeIfAbsent((String) task.get("date"), key -> new ArrayList<>()).add(task);
        }
        List<Map<String, Object>> groups = new ArrayList<>();
        for (LocalDate date = startDate; !date.isAfter(startDate.plusDays(range)); date = date.plusDays(1)) {
            String key = date.toString();
            groups.add(linked(Map.of("date", key, "tasks", byDate.getOrDefault(key, List.of()))));
        }
        return linked(Map.of("days", groups, "start", start, "end", end));
    }

    public String calendarIcs(String userId, String workspaceId) {
        requireMembership(userId, workspaceId);
        int canSeePrivate = roleRank(roleFor(userId, workspaceId)) >= roleRank("ADMIN") ? 1 : 0;
        List<Map<String, Object>> tasks = jdbc.queryForList("""
            SELECT t.id, t.title, t.description, t.due_date AS dueDate,
                   t.due_all_day AS dueAllDay
            FROM task t JOIN board_column c ON c.id = t.column_id
            JOIN board b ON b.id = t.board_id
            WHERE t.workspace_id = ? AND t.deleted_at IS NULL AND t.archived_at IS NULL AND c.is_done = 0
              AND b.workspace_id = t.workspace_id AND t.due_date IS NOT NULL
              AND (b.visibility = 'workspace' OR b.created_by = ? OR ? = 1)
            ORDER BY t.due_date LIMIT 2000
            """, workspaceId, userId, canSeePrivate);
        StringBuilder out = new StringBuilder("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Project3383//Drift//EN\r\nCALSCALE:GREGORIAN\r\n");
        for (Map<String, Object> task : tasks) {
            String raw = String.valueOf(task.get("dueDate"));
            String date = raw.length() >= 10 ? raw.substring(0, 10).replace("-", "") : "";
            if (date.isBlank()) continue;
            boolean allDay = number(task.get("dueAllDay")) == 1;
            out.append("BEGIN:VEVENT\r\n")
                .append("UID:").append(task.get("id")).append("@project3383\r\n")
                .append("DTSTAMP:").append(Instant.now().toString().replaceAll("[-:.]", "").replace("Z", "Z")).append("\r\n");
            if (allDay) out.append("DTSTART;VALUE=DATE:").append(date).append("\r\n");
            else out.append("DTSTART:").append(date).append("T000000Z\r\n");
            out.append("SUMMARY:").append(icsEscape(String.valueOf(task.get("title")))).append("\r\n")
                .append("DESCRIPTION:").append(icsEscape(String.valueOf(task.get("description") == null ? "" : task.get("description")))).append("\r\n")
                .append("END:VEVENT\r\n");
        }
        out.append("END:VCALENDAR\r\n");
        return out.toString();
    }

    private String icsEscape(String value) {
        return value.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replaceAll("\\r?\\n", "\\n");
    }

    public Map<String, Object> search(String userId, String workspaceId, String query, String status,
                                      String priority, String boardId, String label,
                                      String dateFrom, String dateTo) {
        requireMembership(userId, workspaceId);
        int canSeePrivate = roleRank(roleFor(userId, workspaceId)) >= roleRank("ADMIN") ? 1 : 0;
        String term = query == null ? "" : query.trim().toLowerCase();
        String normalizedStatus = status == null ? "all" : status.trim().toLowerCase();
        StringBuilder sql = new StringBuilder("""
            SELECT t.id, t.title, t.description, t.priority, t.due_date AS dueDate,
                   t.due_all_day AS dueAllDay, t.archived_at AS archivedAt,
                   CASE WHEN c.is_done = 1 THEN t.updated_at ELSE NULL END AS completedAt,
                   t.board_id AS boardId, b.name AS boardName, c.name AS columnName,
                   c.is_done AS isDone, t.assignee_id AS assigneeId, u.display_name AS assigneeName,
                   (SELECT COUNT(*) FROM subtask s WHERE s.task_id = t.id) AS subtaskCount,
                   (SELECT COUNT(*) FROM subtask s WHERE s.task_id = t.id AND s.completed = 1) AS subtaskDone
            FROM task t
            JOIN board b ON b.id = t.board_id
            JOIN board_column c ON c.id = t.column_id
            LEFT JOIN app_user u ON u.id = t.assignee_id
            WHERE t.workspace_id = ? AND t.deleted_at IS NULL
              AND b.workspace_id = t.workspace_id
              AND (b.visibility = 'workspace' OR b.created_by = ? OR ? = 1)
            """);
        List<Object> args = new ArrayList<>(List.of(workspaceId, userId, canSeePrivate));
        if ("archived".equals(normalizedStatus)) {
            sql.append(" AND t.archived_at IS NOT NULL");
        } else {
            sql.append(" AND t.archived_at IS NULL");
            if ("open".equals(normalizedStatus)) {
                sql.append(" AND c.is_done = 0");
            } else if ("done".equals(normalizedStatus)) {
                sql.append(" AND c.is_done = 1");
            } else if ("overdue".equals(normalizedStatus)) {
                sql.append(" AND c.is_done = 0 AND t.due_date IS NOT NULL AND substr(t.due_date, 1, 10) < ?");
                args.add(todayForUser(userId));
            }
        }
        if (priority != null && !priority.isBlank()) {
            sql.append(" AND t.priority = ?");
            args.add(priority.trim().toLowerCase());
        }
        if (boardId != null && !boardId.isBlank()) {
            sql.append(" AND t.board_id = ?");
            args.add(boardId.trim());
        }
        if (label != null && !label.isBlank()) {
            sql.append("""
                 AND EXISTS (SELECT 1 FROM task_label tl JOIN label l ON l.id = tl.label_id
                             WHERE tl.task_id = t.id AND lower(l.name) = lower(?))
                """);
            args.add(label.trim());
        }
        if (dateFrom != null && !dateFrom.isBlank()) {
            sql.append(" AND t.due_date IS NOT NULL AND substr(t.due_date, 1, 10) >= ?");
            args.add(dateFrom.trim());
        }
        if (dateTo != null && !dateTo.isBlank()) {
            sql.append(" AND t.due_date IS NOT NULL AND substr(t.due_date, 1, 10) <= ?");
            args.add(dateTo.trim());
        }
        if (!term.isEmpty()) {
            String[] tokens = term.split("\\s+");
            int used = 0;
            for (String token : tokens) {
                if (token.isBlank()) continue;
                if (used >= 8) break;
                String like = "%" + token + "%";
                sql.append("""
                     AND (lower(t.title) LIKE ? OR lower(t.description) LIKE ?
                          OR EXISTS (SELECT 1 FROM task_label tl JOIN label l ON l.id = tl.label_id
                                     WHERE tl.task_id = t.id AND lower(l.name) LIKE ?))
                    """);
                args.add(like);
                args.add(like);
                args.add(like);
                used++;
            }
        }
        sql.append(" ORDER BY c.is_done, t.updated_at DESC LIMIT 50");
        List<Map<String, Object>> results = jdbc.queryForList(sql.toString(), args.toArray());
        for (Map<String, Object> task : results) {
            task.put("completed", number(task.get("isDone")));
            task.put("labels", labelsForTask(String.valueOf(task.get("id"))));
        }
        return linked(Map.of("results", results, "total", results.size(), "query", term));
    }

    public Map<String, Object> insights(String userId, String workspaceId, int requestedDays) {
        requireMembership(userId, workspaceId);
        int canSeePrivate = roleRank(roleFor(userId, workspaceId)) >= roleRank("ADMIN") ? 1 : 0;
        int days = Set.of(14, 30, 60).contains(requestedDays) ? requestedDays : 30;
        String today = todayForUser(userId);
        String end = LocalDate.parse(today).plusDays(days).toString();
        String weekEnd = LocalDate.parse(today).plusDays(7).toString();
        List<Map<String, Object>> boards = jdbc.queryForList("""
            SELECT b.id, b.name, b.visibility
            FROM board b
            WHERE b.workspace_id = ? AND b.deleted_at IS NULL AND b.archived_at IS NULL
              AND (b.visibility = 'workspace' OR b.created_by = ? OR ? = 1)
            ORDER BY b.position, b.created_at
            """, workspaceId, userId, canSeePrivate);
        List<Map<String, Object>> members = jdbc.queryForList("""
            SELECT u.id, u.display_name AS name, u.email, m.role
            FROM membership m JOIN app_user u ON u.id = m.user_id
            WHERE m.workspace_id = ? ORDER BY m.joined_at
            """, workspaceId);
        List<Map<String, Object>> tasks = jdbc.queryForList("""
            SELECT t.id, t.title, t.board_id AS boardId, b.name AS boardName,
                   t.column_id AS columnId, c.name AS columnName, c.is_done AS isDone,
                   t.priority, t.start_date AS startDate, t.due_date AS dueDate,
                   t.due_all_day AS dueAllDay, t.estimate_minutes AS estimateMinutes,
                   CASE WHEN c.is_done = 1 THEN t.updated_at ELSE NULL END AS completedAt,
                   t.assignee_id AS assigneeId
            FROM task t JOIN board b ON b.id = t.board_id
            JOIN board_column c ON c.id = t.column_id
            WHERE t.workspace_id = ? AND t.deleted_at IS NULL AND t.archived_at IS NULL
              AND b.deleted_at IS NULL AND b.archived_at IS NULL
              AND (b.visibility = 'workspace' OR b.created_by = ? OR ? = 1)
            ORDER BY t.due_date, t.position LIMIT 2000
            """, workspaceId, userId, canSeePrivate);
        for (Map<String, Object> task : tasks) {
            task.put("isDone", number(task.get("isDone")) == 1);
            task.put("dueAllDay", number(task.get("dueAllDay")) == 1);
            Map<String, Object> assignee = null;
            Object assigneeId = task.get("assigneeId");
            if (assigneeId != null) {
                for (Map<String, Object> member : members) {
                    if (assigneeId.equals(member.get("id"))) {
                        assignee = new LinkedHashMap<>();
                        assignee.put("id", member.get("id"));
                        assignee.put("name", member.get("name"));
                        assignee.put("email", member.get("email"));
                        break;
                    }
                }
            }
            task.put("assignee", assignee);
            task.put("completedAt", task.get("completedAt"));
        }
        List<Map<String, Object>> byBoard = new ArrayList<>();
        for (Map<String, Object> board : boards) {
            List<Map<String, Object>> boardTasks = tasks.stream()
                .filter(task -> board.get("id").equals(task.get("boardId"))).toList();
            int open = (int) boardTasks.stream().filter(task -> !Boolean.TRUE.equals(task.get("isDone"))).count();
            int done = boardTasks.size() - open;
            int overdue = (int) boardTasks.stream().filter(task -> !Boolean.TRUE.equals(task.get("isDone"))
                && task.get("dueDate") != null
                && String.valueOf(task.get("dueDate")).substring(0, 10).compareTo(today) < 0).count();
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", board.get("id"));
            item.put("name", board.get("name"));
            item.put("visibility", board.get("visibility"));
            item.put("open", open);
            item.put("done", done);
            item.put("overdue", overdue);
            item.put("estimateMinutes", boardTasks.stream().mapToInt(task ->
                task.get("estimateMinutes") instanceof Number number ? number.intValue() : 0).sum());
            byBoard.add(item);
        }
        List<Map<String, Object>> byMember = new ArrayList<>();
        for (Map<String, Object> member : members) {
            byMember.add(memberInsights(member, tasks, today, weekEnd));
        }
        Map<String, Object> unassigned = new LinkedHashMap<>();
        unassigned.put("id", null);
        unassigned.put("name", "Unassigned");
        unassigned.put("email", null);
        unassigned.put("role", null);
        byMember.add(memberInsights(unassigned, tasks, today, weekEnd));
        int open = (int) tasks.stream().filter(task -> !Boolean.TRUE.equals(task.get("isDone"))).count();
        int done = tasks.size() - open;
        int overdue = (int) tasks.stream().filter(task -> !Boolean.TRUE.equals(task.get("isDone"))
            && task.get("dueDate") != null
            && String.valueOf(task.get("dueDate")).substring(0, 10).compareTo(today) < 0).count();
        int dueThisWeek = (int) tasks.stream().filter(task -> !Boolean.TRUE.equals(task.get("isDone"))
            && task.get("dueDate") != null
            && String.valueOf(task.get("dueDate")).substring(0, 10).compareTo(today) >= 0
            && String.valueOf(task.get("dueDate")).substring(0, 10).compareTo(weekEnd) <= 0).count();
        int estimateMinutes = tasks.stream().filter(task -> !Boolean.TRUE.equals(task.get("isDone")))
            .mapToInt(task -> task.get("estimateMinutes") instanceof Number number ? number.intValue() : 0).sum();
        int unestimated = (int) tasks.stream().filter(task -> !Boolean.TRUE.equals(task.get("isDone"))
            && task.get("estimateMinutes") == null).count();
        Instant completedSince = Instant.now().minus(7, ChronoUnit.DAYS);
        int completedLast7 = (int) tasks.stream().filter(task -> {
            if (task.get("completedAt") == null) return false;
            try {
                return Instant.parse(String.valueOf(task.get("completedAt"))).isAfter(completedSince);
            } catch (Exception exception) {
                return false;
            }
        }).count();
        List<Map<String, Object>> byPriority = jdbc.queryForList("""
            SELECT t.priority, COUNT(*) AS count
            FROM task t JOIN board_column c ON c.id = t.column_id
            JOIN board b ON b.id = t.board_id
            WHERE t.workspace_id = ? AND t.deleted_at IS NULL AND t.archived_at IS NULL AND c.is_done = 0
              AND b.workspace_id = t.workspace_id
              AND (b.visibility = 'workspace' OR b.created_by = ? OR ? = 1)
            GROUP BY t.priority
            """, workspaceId, userId, canSeePrivate);
        Map<String, Object> totals = new LinkedHashMap<>();
        totals.put("open", open);
        totals.put("overdue", overdue);
        totals.put("dueThisWeek", dueThisWeek);
        totals.put("completedLast7", completedLast7);
        totals.put("estimateMinutes", estimateMinutes);
        totals.put("unestimated", unestimated);
        totals.put("taskCount", tasks.size());
        totals.put("truncated", tasks.size() >= 2000);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("today", today);
        result.put("end", end);
        result.put("days", days);
        result.put("boards", byBoard);
        result.put("members", byMember);
        result.put("tasks", tasks);
        result.put("totals", totals);
        result.put("open", open);
        result.put("done", done);
        result.put("overdue", overdue);
        result.put("byPriority", byPriority);
        return linked(result);
    }

    private Map<String, Object> memberInsights(Map<String, Object> member, List<Map<String, Object>> tasks,
                                               String today, String weekEnd) {
        List<Map<String, Object>> memberTasks = tasks.stream()
            .filter(task -> member.get("id") == null
                ? task.get("assigneeId") == null
                : member.get("id").equals(task.get("assigneeId")))
            .toList();
        int open = (int) memberTasks.stream().filter(task -> !Boolean.TRUE.equals(task.get("isDone"))).count();
        int dueThisWeek = (int) memberTasks.stream().filter(task -> !Boolean.TRUE.equals(task.get("isDone"))
            && task.get("dueDate") != null
            && String.valueOf(task.get("dueDate")).substring(0, 10).compareTo(today) >= 0
            && String.valueOf(task.get("dueDate")).substring(0, 10).compareTo(weekEnd) <= 0).count();
        int overdue = (int) memberTasks.stream().filter(task -> !Boolean.TRUE.equals(task.get("isDone"))
            && task.get("dueDate") != null
            && String.valueOf(task.get("dueDate")).substring(0, 10).compareTo(today) < 0).count();
        int estimate = memberTasks.stream().filter(task -> !Boolean.TRUE.equals(task.get("isDone")))
            .mapToInt(task -> task.get("estimateMinutes") instanceof Number number ? number.intValue() : 0).sum();
        Map<String, Object> item = new LinkedHashMap<>(member);
        item.put("open", open);
        item.put("dueThisWeek", dueThisWeek);
        item.put("overdue", overdue);
        item.put("estimateMinutes", estimate);
        return item;
    }

    public Map<String, Object> today(String userId) {
        return today(userId, null);
    }

    public Map<String, Object> today(String userId, String workspaceId) {
        String scopedWorkspaceId = resolveWorkspace(userId, workspaceId);
        String today = todayForUser(userId);
        int capacity = capacityForUser(userId);
        int canSeePrivate = roleRank(roleFor(userId, scopedWorkspaceId)) >= roleRank("ADMIN") ? 1 : 0;
        List<Map<String, Object>> tasks = jdbc.queryForList("""
            SELECT t.id, t.workspace_id AS workspaceId, t.board_id AS boardId,
                   t.column_id AS columnId, b.name AS boardName, c.name AS columnName,
                   t.title, t.description, t.priority,
                   t.start_date AS startDate, t.due_date AS dueDate,
                   t.due_all_day AS dueAllDay, t.estimate_minutes AS estimateMinutes,
                   t.actual_minutes AS actualMinutes,
                   t.assignee_id AS assigneeId, t.recurrence_rule AS recurrenceRule,
                   t.recurrence_ends_at AS recurrenceEndsAt,
                   u.display_name AS assigneeName, u.email AS assigneeEmail,
                   CASE WHEN s.task_id IS NULL THEN 0 ELSE 1 END AS selectedFlag,
                   (SELECT COUNT(*)
                    FROM task_dependency td
                    JOIN task dep ON dep.id = td.depends_on_task_id
                    JOIN board_column dc ON dc.id = dep.column_id
                    WHERE td.task_id = t.id AND dep.deleted_at IS NULL AND dc.is_done = 0) AS openDependencies,
                   t.version, t.updated_at AS updatedAt
            FROM task t
            JOIN board b ON b.id = t.board_id
            JOIN board_column c ON c.id = t.column_id
            LEFT JOIN app_user u ON u.id = t.assignee_id
            LEFT JOIN today_dismissal d
              ON d.task_id = t.id AND d.user_id = ? AND d.date = ?
            LEFT JOIN today_selection s
              ON s.task_id = t.id AND s.user_id = ? AND s.date = ?
            WHERE t.workspace_id = ? AND t.deleted_at IS NULL AND t.archived_at IS NULL AND c.is_done = 0
              AND b.workspace_id = t.workspace_id
              AND (b.visibility = 'workspace' OR b.created_by = ? OR ? = 1)
              AND (d.task_id IS NULL OR s.task_id IS NOT NULL)
            ORDER BY selectedFlag DESC,
                     CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1
                                     WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
                     t.due_date IS NULL, t.due_date, t.position
            LIMIT 100
            """, userId, today, userId, today, scopedWorkspaceId, userId, canSeePrivate);
        List<Map<String, Object>> suggestions = new ArrayList<>();
        int selectedMinutes = 0;
        int selectedCount = 0;
        int overdueCount = 0;
        for (Map<String, Object> task : tasks) {
            Map<String, Object> suggestion = linked(task);
            suggestion.put("labels", labelsForTask((String) task.get("id")));
            attachAssignee(suggestion);
            boolean accepted = number(task.get("selectedFlag")) == 1;
            boolean selected = accepted;
            boolean blocked = number(task.get("openDependencies")) > 0;
            String due = task.get("dueDate") == null ? null : String.valueOf(task.get("dueDate"));
            String dueDay = due != null && due.length() >= 10 ? due.substring(0, 10) : null;
            boolean overdue = dueDay != null && dueDay.compareTo(today) < 0;
            boolean dueToday = today.equals(dueDay);
            String priority = String.valueOf(task.get("priority"));
            int estimate = task.get("estimateMinutes") == null ? 30 : number(task.get("estimateMinutes"));
            if (overdue) overdueCount++;
            String reason;
            if (blocked) reason = "Waiting on a task that is not done yet";
            else if (overdue) reason = "Overdue since " + dueDay;
            else if (accepted) reason = "You chose this for today";
            else if (dueToday) reason = "Due today";
            else if ("urgent".equals(priority) || "high".equals(priority)) {
                reason = Character.toUpperCase(priority.charAt(0)) + priority.substring(1) + " priority with no due date";
            } else if (estimate > 0 && estimate <= 20) {
                reason = "A quick win to build momentum";
            } else {
                reason = "Next best use of your available time";
            }
            suggestion.put("selected", selected);
            suggestion.put("accepted", accepted);
            suggestion.put("blocked", blocked);
            suggestion.put("reason", reason);
            suggestion.put("focusDate", accepted ? today : null);
            if (accepted) {
                selectedMinutes += Math.max(0, estimate);
                selectedCount++;
            }
            suggestions.add(suggestion);
        }
        int autoRemaining = Math.max(0, capacity - selectedMinutes);
        for (Map<String, Object> suggestion : suggestions) {
            if (Boolean.TRUE.equals(suggestion.get("selected")) || Boolean.TRUE.equals(suggestion.get("blocked"))) continue;
            int estimate = suggestion.get("estimateMinutes") == null ? 30 : number(suggestion.get("estimateMinutes"));
            if (estimate <= autoRemaining) {
                suggestion.put("selected", true);
                selectedMinutes += Math.max(0, estimate);
                selectedCount++;
                autoRemaining -= Math.max(0, estimate);
            }
        }
        List<Map<String, Object>> planBlocks = jdbc.queryForList("""
            SELECT pb.id, pb.task_id AS taskId, pb.start_minute AS startMinute, pb.minutes,
                   pb.date, t.title, t.priority
            FROM plan_block pb JOIN task t ON t.id = pb.task_id
            WHERE pb.user_id = ? AND pb.workspace_id = ? AND pb.date = ?
              AND t.deleted_at IS NULL AND t.archived_at IS NULL
            ORDER BY pb.start_minute
            """, userId, scopedWorkspaceId, today);
        Map<String, Object> workspace = jdbc.queryForList("""
            SELECT id, name, type FROM workspace WHERE id = ?
            """, scopedWorkspaceId).stream().findFirst()
            .orElseThrow(() -> ApiException.notFound("Workspace not found."));
        int remaining = Math.max(0, capacity - selectedMinutes);
        return linked(Map.of(
            "date", today,
            "capacity", linked(Map.of(
                "totalMinutes", capacity,
                "selectedMinutes", selectedMinutes,
                "remainingMinutes", remaining,
                "percent", capacity == 0 ? 0 : Math.min(100, Math.round(selectedMinutes * 100f / capacity)),
                "overbooked", selectedMinutes > capacity
            )),
            "suggestions", suggestions,
            "planBlocks", planBlocks,
            "counts", linked(Map.of(
                "open", suggestions.size(),
                "selected", selectedCount,
                "overdue", overdueCount
            )),
            "workspace", workspace
        ));
    }

    public Map<String, Object> todayAction(String userId, ApiDtos.TodayAction input) {
        if (input == null || input.action() == null) {
            throw ApiException.badRequest("A Today action is required.");
        }
        String workspaceId;
        Map<String, Object> task = null;
        if (!blank(input.taskId())) {
            task = taskRow(input.taskId());
            workspaceId = blank(input.workspaceId()) ? (String) task.get("workspaceId") : input.workspaceId();
            if (!workspaceId.equals(task.get("workspaceId"))) {
                throw ApiException.notFound("Task not found.");
            }
        } else {
            if (blank(input.workspaceId())) throw ApiException.badRequest("Choose a workspace.");
            workspaceId = input.workspaceId();
        }
        requireMinimumRole(userId, workspaceId, "MEMBER");
        if (task != null) requireTaskBoardVisible(userId, task);
        String today = todayForUser(userId);
        String now = Instant.now().toString();

        if ("accept".equals(input.action())) {
            if (task == null) throw ApiException.badRequest("A task is required.");
            if (number(task.get("completed")) == 1) {
                throw ApiException.badRequest("A completed task cannot be added to today's plan.");
            }
            jdbc.update("""
                INSERT OR IGNORE INTO today_selection (user_id, workspace_id, task_id, date, created_at)
                VALUES (?, ?, ?, ?, ?)
                """, userId, workspaceId, input.taskId(), today, now);
            // Keep the legacy field in sync for API clients that still read focusDate.
            jdbc.update("""
                UPDATE task SET focus_date = ?, version = version + 1, updated_at = ?
                WHERE id = ? AND deleted_at IS NULL
                """, today, now, input.taskId());
            jdbc.update("DELETE FROM today_dismissal WHERE user_id = ? AND task_id = ? AND date = ?",
                userId, input.taskId(), today);
            recordActivity((String) task.get("workspaceId"), input.taskId(), userId,
                "today.accepted", "task", input.taskId());
        } else if ("dismiss".equals(input.action())) {
            if (task == null) throw ApiException.badRequest("A task is required.");
            jdbc.update("""
                DELETE FROM today_selection WHERE user_id = ? AND task_id = ? AND date = ?
                """, userId, input.taskId(), today);
            jdbc.update("""
                UPDATE task SET focus_date = NULL, version = version + 1, updated_at = ?
                WHERE id = ? AND deleted_at IS NULL
                """, now, input.taskId());
            jdbc.update("""
                INSERT OR IGNORE INTO today_dismissal (user_id, task_id, date) VALUES (?, ?, ?)
                """, userId, input.taskId(), today);
            jdbc.update("""
                DELETE FROM plan_block
                WHERE user_id = ? AND workspace_id = ? AND task_id = ? AND date = ?
                  AND source = 'auto' AND locked = 0
                """, userId, workspaceId, input.taskId(), today);
        } else if ("rebalance".equals(input.action())) {
            jdbc.update("""
                DELETE FROM today_selection WHERE user_id = ? AND workspace_id = ? AND date = ?
                """, userId, workspaceId, today);
            jdbc.update("""
                DELETE FROM plan_block
                WHERE user_id = ? AND workspace_id = ? AND date = ?
                  AND source = 'auto' AND locked = 0
                """, userId, workspaceId, today);
            Map<String, Object> payload = today(userId, workspaceId);
            @SuppressWarnings("unchecked")
            Map<String, Object> capacity = (Map<String, Object>) payload.get("capacity");
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> suggestions = (List<Map<String, Object>>) payload.get("suggestions");
            int total = capacity == null ? 300 : number(capacity.get("totalMinutes"));
            int used = 0;
            List<String> selected = new ArrayList<>();
            for (Map<String, Object> suggestion : suggestions) {
                if (Boolean.TRUE.equals(suggestion.get("blocked"))) continue;
                int estimate = suggestion.get("estimateMinutes") == null ? 30 : number(suggestion.get("estimateMinutes"));
                if (used + Math.max(0, estimate) > total) continue;
                selected.add(String.valueOf(suggestion.get("id")));
                used += Math.max(0, estimate);
            }
            replaceTodaySelection(userId, workspaceId, today, selected);
        } else if ("applyPlan".equals(input.action())) {
            List<String> requested = input.taskIds() == null ? List.of() : input.taskIds();
            List<String> taskIds = requested.stream()
                .filter(id -> id != null && !id.isBlank())
                .distinct()
                .limit(50)
                .toList();
            for (String taskId : taskIds) {
                Map<String, Object> selected = taskRow(taskId);
                if (!workspaceId.equals(selected.get("workspaceId"))) {
                    throw ApiException.notFound("Task not found.");
                }
                requireTaskBoardVisible(userId, selected);
                if (number(selected.get("completed")) == 1) {
                    throw ApiException.badRequest("A completed task cannot be added to today's plan.");
                }
                if (selected.get("archivedAt") != null) {
                    throw ApiException.badRequest("An archived task cannot be added to today's plan.");
                }
                if (openDependencyCount(taskId) > 0) {
                    throw ApiException.badRequest("Finish the work this task is waiting on first.");
                }
            }
            jdbc.update("""
                DELETE FROM plan_block
                WHERE user_id = ? AND workspace_id = ? AND date = ?
                  AND source = 'auto' AND locked = 0
                """, userId, workspaceId, today);
            replaceTodaySelection(userId, workspaceId, today, taskIds);
        } else {
            throw ApiException.badRequest("Unknown Today action.");
        }
        return today(userId, workspaceId);
    }

    private void replaceTodaySelection(String userId, String workspaceId, String date, List<String> taskIds) {
        jdbc.update("""
            DELETE FROM today_selection WHERE user_id = ? AND workspace_id = ? AND date = ?
            """, userId, workspaceId, date);
        jdbc.update("""
            UPDATE task SET focus_date = NULL, version = version + 1
            WHERE workspace_id = ? AND focus_date = ? AND deleted_at IS NULL
            """, workspaceId, date);
        String now = Instant.now().toString();
        for (String taskId : taskIds) {
            jdbc.update("""
                INSERT OR IGNORE INTO today_selection (user_id, workspace_id, task_id, date, created_at)
                VALUES (?, ?, ?, ?, ?)
                """, userId, workspaceId, taskId, date, now);
            jdbc.update("""
                UPDATE task SET focus_date = ?, version = version + 1
                WHERE id = ? AND deleted_at IS NULL
                """, date, taskId);
        }
    }

    private int openDependencyCount(String taskId) {
        Integer count = jdbc.queryForObject("""
            SELECT COUNT(*)
            FROM task_dependency td
            JOIN task dep ON dep.id = td.depends_on_task_id
            JOIN board_column c ON c.id = dep.column_id
            WHERE td.task_id = ? AND dep.deleted_at IS NULL AND dep.archived_at IS NULL AND c.is_done = 0
            """, Integer.class, taskId);
        return count == null ? 0 : count;
    }

    private String resolveWorkspace(String userId, String workspaceId) {
        if (!blank(workspaceId)) {
            requireMembership(userId, workspaceId);
            return workspaceId;
        }
        List<String> workspaceIds = jdbc.queryForList("""
            SELECT workspace_id FROM membership WHERE user_id = ? ORDER BY joined_at LIMIT 1
            """, String.class, userId);
        if (workspaceIds.isEmpty()) throw ApiException.notFound("Workspace not found.");
        return workspaceIds.get(0);
    }

    private String todayForUser(String userId) {
        List<String> zones = jdbc.queryForList("""
            SELECT timezone FROM app_user WHERE id = ?
            """, String.class, userId);
        String zone = zones.isEmpty() ? null : zones.get(0);
        try {
            return LocalDate.now(zone == null || zone.isBlank() ? ZoneId.systemDefault() : ZoneId.of(zone)).toString();
        } catch (DateTimeException exception) {
            return LocalDate.now().toString();
        }
    }

    private int capacityForUser(String userId) {
        List<Integer> capacities = jdbc.queryForList("""
            SELECT capacity_minutes FROM user_settings WHERE user_id = ?
            """, Integer.class, userId);
        return capacities.isEmpty() ? 300 : Math.max(15, capacities.get(0));
    }

    public Map<String, Object> createTask(String userId, ApiDtos.TaskCreate input) {
        if (input == null || blank(input.title())) throw ApiException.badRequest("Task title is required.");
        String workspaceId = input.workspaceId();
        requireMinimumRole(userId, workspaceId, "MEMBER");
        Map<String, Object> column = jdbc.queryForList("""
            SELECT c.id, c.board_id AS boardId, b.workspace_id AS workspaceId
            FROM board_column c JOIN board b ON b.id = c.board_id
            WHERE c.id = ? AND c.deleted_at IS NULL
            """, input.columnId()).stream().findFirst()
            .orElseThrow(() -> ApiException.notFound("Column not found."));
        if (!workspaceId.equals(column.get("workspaceId")) || !input.boardId().equals(column.get("boardId"))) {
            throw ApiException.badRequest("Column does not belong to this board.");
        }
        requireBoardVisible(userId, boardRow(input.boardId()));
        requireWipCapacity(input.columnId());
        int position = jdbc.queryForObject("""
            SELECT COALESCE(MAX(position), -1) + 1 FROM task
            WHERE board_id = ? AND column_id = ? AND deleted_at IS NULL
            """, Integer.class, input.boardId(), input.columnId());
        String taskId = id();
        String now = Instant.now().toString();
        String priority = priority(input.priority());
        boolean dueAllDay = input.dueAllDay() == null || input.dueAllDay();
        jdbc.update("""
            INSERT INTO task (id, workspace_id, board_id, column_id, title, description,
                              priority, start_date, due_date, due_all_day, estimate_minutes,
                              actual_minutes, assignee_id, recurrence_rule, recurrence_ends_at,
                              position, version, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
            """, taskId, workspaceId, input.boardId(), input.columnId(), input.title().trim(),
            input.description() == null ? "" : input.description(), priority, input.startDate(),
            input.dueDate(), dueAllDay ? 1 : 0, normalizeEstimate(input.estimateMinutes()),
            normalizeActual(input.actualMinutes()), normalizeAssignee(workspaceId, input.assigneeId()),
            normalizeRecurrence(input.recurrenceRule()), normalizeRecurrenceEnds(input.recurrenceEndsAt()),
            position, userId, now, now);
        replaceTaskLabels(taskId, workspaceId, input.labels());
        if (input.reminderOffsetMinutes() != null) {
            setReminderOffset(userId, taskId, input.dueDate(), input.reminderOffsetMinutes());
        }
        Map<String, Object> createdTask = taskRow(taskId);
        Object createdAssignee = createdTask.get("assigneeId");
        if (createdAssignee != null && !userId.equals(String.valueOf(createdAssignee))) {
            notificationService.notify(String.valueOf(createdAssignee), workspaceId, taskId, "task.assigned",
                "Assigned: " + input.title().trim(),
                String.valueOf(userRow(userId).get("name")) + " assigned you a task.",
                "/?task=" + taskId);
        }
        recordActivity(workspaceId, taskId, userId, "task.created", "task", taskId);
        audit(workspaceId, userId, "task.created", "task", taskId, Map.of("title", input.title().trim()));
        webhookService.dispatch(workspaceId, "task.created",
            Map.of("taskId", taskId, "title", input.title().trim(), "columnId", input.columnId()));
        automationService.runForEvent(workspaceId, "task.created", taskId, userId);
        Map<String, Object> result = linked(Map.of("task", task(userId, taskId)));
        Map<String, Object> undo = createUndo(userId, workspaceId, "task.create", "task", taskId,
            Map.of("columnId", input.columnId()), 10);
        if (undo != null) result.put("undo", undo);
        return result;
    }

    public Map<String, Object> taskDetail(String userId, String taskId) {
        Map<String, Object> task = task(userId, taskId);
        task.put("comments", jdbc.queryForList("""
            SELECT c.id, c.body, c.created_at AS createdAt, c.author_id AS authorId,
                   u.display_name AS authorName
            FROM task_comment c JOIN app_user u ON u.id = c.author_id
            WHERE c.task_id = ? ORDER BY c.created_at ASC
            """, taskId));
        task.put("subtasks", jdbc.queryForList("""
            SELECT id, title, completed, position
            FROM subtask WHERE task_id = ? ORDER BY position, created_at
            """, taskId));
        task.put("dependencies", dependencyList(taskId));
        task.put("attachments", jdbc.queryForList("""
            SELECT id, name, mime_type AS mimeType, size, created_at AS createdAt
            FROM attachment WHERE task_id = ? AND deleted_at IS NULL ORDER BY created_at DESC
            """, taskId));
        task.put("reminders", reminderList(taskId, userId));
        task.put("activity", activityList(taskId));
        return linked(Map.of("task", task));
    }

    private void recordActivity(String workspaceId, String taskId, String actorId,
                                String action, String entityType, String entityId) {
        jdbc.update("""
            INSERT INTO activity_event (id, workspace_id, task_id, actor_id, action,
                                        entity_type, entity_id, metadata, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?)
            """, id(), workspaceId, taskId, actorId, action, entityType, entityId, Instant.now().toString());
    }

    private void audit(String workspaceId, String actorId, String action, String entityType,
                       String entityId, Map<String, Object> metadata) {
        auditService.record(workspaceId, actorId, action, entityType, entityId, metadata);
    }

    private Map<String, Object> createUndo(String userId, String workspaceId, String action,
                                           String entityType, String entityId,
                                           Map<String, Object> inverse, int ttlSeconds) {
        String undoId = id();
        String now = Instant.now().toString();
        String expiresAt = Instant.now().plusSeconds(ttlSeconds).toString();
        try {
            jdbc.update("""
                INSERT INTO undo_action (id, user_id, workspace_id, action, entity_type,
                                         entity_id, inverse_json, expires_at, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, undoId, userId, workspaceId, action, entityType, entityId,
                objectMapper.writeValueAsString(inverse), expiresAt, now);
            Map<String, Object> undo = new LinkedHashMap<>();
            undo.put("id", undoId);
            undo.put("expiresAt", expiresAt);
            undo.put("action", action);
            return undo;
        } catch (Exception exception) {
            return null;
        }
    }

    private List<Map<String, Object>> activityList(String taskId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
            SELECT a.id, a.action, a.actor_id AS actorId, a.created_at AS createdAt,
                   u.display_name AS actorName
            FROM activity_event a
            LEFT JOIN app_user u ON u.id = a.actor_id
            WHERE a.task_id = ?
            ORDER BY a.created_at DESC, a.rowid DESC
            LIMIT 50
            """, taskId);
        for (Map<String, Object> row : rows) {
            Object actorId = row.remove("actorId");
            Object actorName = row.remove("actorName");
            if (actorId == null) {
                row.put("actor", null);
            } else {
                Map<String, Object> actor = new LinkedHashMap<>();
                actor.put("id", actorId);
                actor.put("name", actorName == null ? "" : actorName);
                row.put("actor", actor);
            }
        }
        return rows;
    }

    public Map<String, Object> addComment(String userId, String taskId, ApiDtos.CommentCreate input) {
        Map<String, Object> task = taskRow(taskId);
        requireMinimumRole(userId, (String) task.get("workspaceId"), "MEMBER");
        requireTaskBoardVisible(userId, task);
        if (input == null || blank(input.body())) throw ApiException.badRequest("Comment text is required.");
        String commentId = id();
        jdbc.update("""
            INSERT INTO task_comment (id, task_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)
            """, commentId, taskId, userId, input.body().trim(), Instant.now().toString());
        recordActivity((String) task.get("workspaceId"), taskId, userId, "comment.created", "comment", commentId);
        webhookService.dispatch((String) task.get("workspaceId"), "comment.created",
            Map.of("taskId", taskId, "title", String.valueOf(task.get("title")),
                "preview", input.body().trim().length() > 160 ? input.body().trim().substring(0, 160) : input.body().trim()));
        Set<String> recipients = new HashSet<>();
        if (task.get("assigneeId") != null) recipients.add(String.valueOf(task.get("assigneeId")));
        if (task.get("createdById") != null) recipients.add(String.valueOf(task.get("createdById")));
        recipients.remove(userId);
        for (String recipient : recipients) {
            notificationService.notify(recipient, String.valueOf(task.get("workspaceId")), taskId,
                "comment.mention", "New comment on " + task.get("title"),
                String.valueOf(userRow(userId).get("name")) + ": "
                    + clip(input.body().trim(), 140),
                "/?task=" + taskId);
        }
        return linked(Map.of("comment", jdbc.queryForList("""
            SELECT c.id, c.body, c.created_at AS createdAt, c.author_id AS authorId,
                   u.display_name AS authorName
            FROM task_comment c JOIN app_user u ON u.id = c.author_id
            WHERE c.id = ?
            """, commentId).stream().findFirst().orElseThrow()));
    }

    public Map<String, Object> addSubtask(String userId, String taskId, ApiDtos.SubtaskCreate input) {
        Map<String, Object> task = taskRow(taskId);
        requireMinimumRole(userId, (String) task.get("workspaceId"), "MEMBER");
        requireTaskBoardVisible(userId, task);
        if (input == null || blank(input.title())) throw ApiException.badRequest("Checklist title is required.");
        int position = jdbc.queryForObject("""
            SELECT COALESCE(MAX(position), -1) + 1 FROM subtask WHERE task_id = ?
            """, Integer.class, taskId);
        String subtaskId = id();
        jdbc.update("""
            INSERT INTO subtask (id, task_id, title, completed, position, created_at)
            VALUES (?, ?, ?, 0, ?, ?)
            """, subtaskId, taskId, input.title().trim(), position, Instant.now().toString());
        recordActivity((String) task.get("workspaceId"), taskId, userId, "subtask.created", "subtask", subtaskId);
        return linked(Map.of("subtask", subtaskRow(subtaskId)));
    }

    public Map<String, Object> updateSubtask(String userId, String subtaskId, ApiDtos.SubtaskUpdate input) {
        Map<String, Object> subtask = subtaskRow(subtaskId);
        Map<String, Object> task = taskRow((String) subtask.get("taskId"));
        requireMinimumRole(userId, (String) task.get("workspaceId"), "MEMBER");
        requireTaskBoardVisible(userId, task);
        String title = input == null || input.title() == null ? (String) subtask.get("title") : input.title().trim();
        if (blank(title)) throw ApiException.badRequest("Checklist title is required.");
        boolean completed = input != null && input.completed() != null
            ? input.completed() : ((Number) subtask.get("completed")).intValue() == 1;
        jdbc.update("UPDATE subtask SET title = ?, completed = ? WHERE id = ?",
            title, completed ? 1 : 0, subtaskId);
        return linked(Map.of("subtask", subtaskRow(subtaskId)));
    }

    public Map<String, Object> deleteSubtask(String userId, String subtaskId) {
        Map<String, Object> subtask = subtaskRow(subtaskId);
        Map<String, Object> task = taskRow((String) subtask.get("taskId"));
        requireMinimumRole(userId, (String) task.get("workspaceId"), "MEMBER");
        requireTaskBoardVisible(userId, task);
        jdbc.update("DELETE FROM subtask WHERE id = ?", subtaskId);
        recordActivity((String) task.get("workspaceId"), (String) task.get("id"), userId,
            "subtask.deleted", "subtask", subtaskId);
        return linked(Map.of("deleted", true));
    }

    public Map<String, Object> listTasks(String userId, String workspaceId) {
        requireMembership(userId, workspaceId);
        int canSeePrivate = roleRank(roleFor(userId, workspaceId)) >= roleRank("ADMIN") ? 1 : 0;
        return linked(Map.of("tasks", jdbc.queryForList("""
            SELECT t.id, t.title, t.description, t.priority, t.start_date AS startDate,
                   t.due_date AS dueDate, t.estimate_minutes AS estimateMinutes,
                   c.is_done AS completed, t.board_id AS boardId, b.name AS boardName,
                   c.name AS columnName, t.assignee_id AS assigneeId, u.display_name AS assigneeName
            FROM task t JOIN board_column c ON c.id = t.column_id
            JOIN board b ON b.id = t.board_id
            LEFT JOIN app_user u ON u.id = t.assignee_id
            WHERE t.workspace_id = ? AND t.deleted_at IS NULL AND t.archived_at IS NULL AND b.workspace_id = t.workspace_id
              AND (b.visibility = 'workspace' OR b.created_by = ? OR ? = 1)
            ORDER BY t.title
            """, workspaceId, userId, canSeePrivate)));
    }

    public Map<String, Object> addDependency(String userId, String taskId, ApiDtos.DependencyCreate input) {
        Map<String, Object> task = taskRow(taskId);
        requireMinimumRole(userId, (String) task.get("workspaceId"), "MEMBER");
        requireTaskBoardVisible(userId, task);
        if (input == null || blank(input.dependsOnTaskId())) throw ApiException.badRequest("Choose a task to wait on.");
        if (taskId.equals(input.dependsOnTaskId())) throw ApiException.badRequest("A task cannot depend on itself.");
        Map<String, Object> dependency = taskRow(input.dependsOnTaskId());
        requireTaskBoardVisible(userId, dependency);
        if (!task.get("workspaceId").equals(dependency.get("workspaceId"))) {
            throw ApiException.badRequest("Dependencies must be in the same workspace.");
        }
        if (wouldCreateCycle(taskId, input.dependsOnTaskId())) {
            throw ApiException.badRequest("That dependency would create a cycle.");
        }
        jdbc.update("""
            INSERT OR IGNORE INTO task_dependency (task_id, depends_on_task_id, created_at) VALUES (?, ?, ?)
            """, taskId, input.dependsOnTaskId(), Instant.now().toString());
        return linked(Map.of("dependencies", dependencyList(taskId)));
    }

    public Map<String, Object> removeDependency(String userId, String taskId, String dependsOnTaskId) {
        Map<String, Object> task = taskRow(taskId);
        requireMinimumRole(userId, (String) task.get("workspaceId"), "MEMBER");
        requireTaskBoardVisible(userId, task);
        jdbc.update("""
            DELETE FROM task_dependency WHERE task_id = ? AND depends_on_task_id = ?
            """, taskId, dependsOnTaskId);
        return linked(Map.of("dependencies", dependencyList(taskId)));
    }

    private List<Map<String, Object>> dependencyList(String taskId) {
        return jdbc.queryForList("""
            SELECT t.id, t.title, c.is_done AS completed
            FROM task_dependency d
            JOIN task t ON t.id = d.depends_on_task_id AND t.deleted_at IS NULL
            JOIN board_column c ON c.id = t.column_id
            WHERE d.task_id = ?
            ORDER BY t.title
            """, taskId);
    }

    private boolean wouldCreateCycle(String taskId, String dependsOnTaskId) {
        // Adding task -> dependsOn creates a cycle if dependsOn can already reach task.
        List<Map<String, Object>> edges = jdbc.queryForList("SELECT task_id AS taskId, depends_on_task_id AS dependsOnTaskId FROM task_dependency");
        Map<String, List<String>> graph = new java.util.HashMap<>();
        for (Map<String, Object> edge : edges) {
            graph.computeIfAbsent((String) edge.get("taskId"), key -> new ArrayList<>())
                .add((String) edge.get("dependsOnTaskId"));
        }
        java.util.ArrayDeque<String> queue = new java.util.ArrayDeque<>();
        java.util.HashSet<String> seen = new java.util.HashSet<>();
        queue.add(dependsOnTaskId);
        while (!queue.isEmpty()) {
            String current = queue.removeFirst();
            if (current.equals(taskId)) return true;
            if (!seen.add(current)) continue;
            for (String next : graph.getOrDefault(current, List.of())) queue.add(next);
        }
        return false;
    }

    public Map<String, Object> addReminder(String userId, String taskId, ApiDtos.ReminderCreate input) {
        Map<String, Object> task = taskRow(taskId);
        requireMinimumRole(userId, (String) task.get("workspaceId"), "MEMBER");
        requireTaskBoardVisible(userId, task);
        if (input == null || blank(input.remindAt())) throw ApiException.badRequest("Choose a reminder time.");
        Instant remindAt;
        try {
            remindAt = Instant.parse(input.remindAt());
        } catch (Exception exception) {
            throw ApiException.badRequest("Reminder time must be an ISO instant.");
        }
        if (remindAt.isBefore(Instant.now().plusSeconds(30))) throw ApiException.badRequest("Reminder must be in the future.");
        String reminderId = id();
        jdbc.update("""
            INSERT INTO reminder (id, task_id, user_id, remind_at, channel, created_at)
            VALUES (?, ?, ?, ?, 'in_app', ?)
            """, reminderId, taskId, userId, remindAt.toString(), Instant.now().toString());
        return linked(Map.of("reminders", reminderList(taskId, userId)));
    }

    public Map<String, Object> removeReminder(String userId, String reminderId) {
        Map<String, Object> row = jdbc.queryForList("""
            SELECT r.task_id AS taskId, t.workspace_id AS workspaceId
            FROM reminder r JOIN task t ON t.id = r.task_id
            WHERE r.id = ? AND r.user_id = ?
            """, reminderId, userId).stream().findFirst()
            .orElseThrow(() -> ApiException.notFound("Reminder not found."));
        requireMembership(userId, (String) row.get("workspaceId"));
        jdbc.update("DELETE FROM reminder WHERE id = ? AND user_id = ?", reminderId, userId);
        return linked(Map.of("reminders", reminderList((String) row.get("taskId"), userId)));
    }

    private List<Map<String, Object>> reminderList(String taskId, String userId) {
        return jdbc.queryForList("""
            SELECT id, remind_at AS remindAt, sent_at AS sentAt, channel
            FROM reminder WHERE task_id = ? AND user_id = ? ORDER BY remind_at
            """, taskId, userId);
    }

    private Map<String, Object> subtaskRow(String subtaskId) {
        return jdbc.queryForList("""
            SELECT id, task_id AS taskId, title, completed, position
            FROM subtask WHERE id = ?
            """, subtaskId).stream().findFirst()
            .orElseThrow(() -> ApiException.notFound("Checklist item not found."));
    }

    @Transactional
    public Map<String, Object> updateTask(String userId, String taskId, ApiDtos.TaskUpdate input) {
        Map<String, Object> current = taskRow(taskId);
        String workspaceId = (String) current.get("workspaceId");
        requireMinimumRole(userId, workspaceId, "MEMBER");
        requireTaskBoardVisible(userId, current);
        int version = input.version() == null ? -1 : input.version();
        if (version != ((Number) current.get("version")).intValue()) {
            throw ApiException.conflict("This task changed elsewhere.", ((Number) current.get("version")).intValue());
        }
        String title = input.title() == null ? (String) current.get("title") : input.title().trim();
        if (blank(title)) throw ApiException.badRequest("Task title is required.");
        String description = input.description() == null ? (String) current.get("description") : input.description();
        String priority = input.priority() == null ? (String) current.get("priority") : priority(input.priority());
        String startDate = jsonTextPatch(input.startDate(), (String) current.get("startDate"));
        String dueDate = jsonTextPatch(input.dueDate(), (String) current.get("dueDate"));
        boolean dueAllDay = input.dueAllDay() == null
            ? number(current.get("dueAllDay")) == 1
            : input.dueAllDay();
        Integer estimate = input.estimateMinutes() == null
            ? (Integer) current.get("estimateMinutes")
            : input.estimateMinutes().isNull() ? null : normalizeEstimate(input.estimateMinutes().asInt());
        Integer actual = input.actualMinutes() == null
            ? (Integer) current.get("actualMinutes")
            : input.actualMinutes().isNull() ? null : normalizeActual(input.actualMinutes().asInt());
        String assigneeId = input.assigneeId() == null
            ? (String) current.get("assigneeId")
            : normalizeAssignee(workspaceId, jsonText(input.assigneeId()));
        String recurrenceRule = input.recurrenceRule() == null
            ? (String) current.get("recurrenceRule")
            : normalizeRecurrence(jsonText(input.recurrenceRule()));
        String recurrenceEndsAt = input.recurrenceEndsAt() == null
            ? (String) current.get("recurrenceEndsAt")
            : normalizeRecurrenceEnds(jsonText(input.recurrenceEndsAt()));
        String focusDate = jsonTextPatch(input.focusDate(), (String) current.get("focusDate"));

        boolean wasCompleted = number(current.get("completed")) == 1;
        boolean completed = input.completed() == null ? wasCompleted : input.completed();
        String columnId = (String) current.get("columnId");
        int position = number(current.get("position"));
        boolean completedNow = completed && !wasCompleted;
        if (completedNow) {
            if (openDependencyCount(taskId) > 0) {
                throw ApiException.dependencyBlocked("Finish the work this task is waiting on first.");
            }
            Map<String, Object> doneColumn = jdbc.queryForList("""
                SELECT id FROM board_column
                WHERE board_id = ? AND is_done = 1 AND deleted_at IS NULL ORDER BY position LIMIT 1
                """, current.get("boardId")).stream().findFirst()
                .orElseThrow(() -> ApiException.badRequest("This board has no done column."));
            columnId = (String) doneColumn.get("id");
            Integer next = jdbc.queryForObject("""
                SELECT COALESCE(MAX(position), -1) + 1 FROM task
                WHERE column_id = ? AND deleted_at IS NULL
                """, Integer.class, columnId);
            position = next == null ? 0 : next;
        } else if (!completed && wasCompleted) {
            Map<String, Object> openColumn = jdbc.queryForList("""
                SELECT id FROM board_column
                WHERE board_id = ? AND is_done = 0 AND deleted_at IS NULL ORDER BY position LIMIT 1
                """, current.get("boardId")).stream().findFirst()
                .orElseThrow(() -> ApiException.badRequest("This board has no open column."));
            columnId = (String) openColumn.get("id");
            Integer next = jdbc.queryForObject("""
                SELECT COALESCE(MAX(position), -1) + 1 FROM task
                WHERE column_id = ? AND deleted_at IS NULL
                """, Integer.class, columnId);
            position = next == null ? 0 : next;
        }
        String archivedAt = (String) current.get("archivedAt");
        if (input.archived() != null) archivedAt = input.archived() ? Instant.now().toString() : null;

        int updated = jdbc.update("""
            UPDATE task SET title = ?, description = ?, priority = ?, start_date = ?,
                            due_date = ?, due_all_day = ?, estimate_minutes = ?,
                            actual_minutes = ?, assignee_id = ?, recurrence_rule = ?,
                            recurrence_ends_at = ?, column_id = ?, position = ?,
                            archived_at = ?, focus_date = ?, version = version + 1, updated_at = ?
            WHERE id = ? AND version = ? AND deleted_at IS NULL
            """, title, description, priority, startDate, dueDate, dueAllDay ? 1 : 0,
            estimate, actual, assigneeId, recurrenceRule, recurrenceEndsAt,
            columnId, position, archivedAt, focusDate, Instant.now().toString(), taskId, version);
        if (updated == 0) throw ApiException.conflict("This task changed elsewhere.", version + 1);
        if (input.labels() != null) replaceTaskLabels(taskId, workspaceId, input.labels());
        if (input.dependencyIds() != null) replaceTaskDependencies(userId, taskId, workspaceId, input.dependencyIds());
        if (input.reminderOffsetMinutes() != null) {
            setReminderOffset(userId, taskId, dueDate, jsonInteger(input.reminderOffsetMinutes()));
        }
        String nextTaskId = null;
        if (completedNow) {
            nextTaskId = createNextOccurrence(userId, current, (String) current.get("columnId"));
            recordActivity(workspaceId, taskId, userId, "task.completed", "task", taskId);
            audit(workspaceId, userId, "task.completed", "task", taskId, Map.of());
            webhookService.dispatch(workspaceId, "task.completed",
                Map.of("taskId", taskId, "title", title, "columnId", columnId));
            automationService.runForEvent(workspaceId, "task.completed", taskId, userId);
        } else if (!completed && wasCompleted) {
            recordActivity(workspaceId, taskId, userId, "task.reopened", "task", taskId);
            audit(workspaceId, userId, "task.reopened", "task", taskId, Map.of());
        }
        if (input.dueDate() != null || input.startDate() != null || input.estimateMinutes() != null
            || input.priority() != null || input.completed() != null || input.archived() != null
            || input.dependencyIds() != null) {
            jdbc.update("DELETE FROM plan_block WHERE task_id = ? AND source = 'auto' AND locked = 0", taskId);
        }
        recordActivity(workspaceId, taskId, userId, "task.updated", "task", taskId);
        audit(workspaceId, userId, "task.updated", "task", taskId, Map.of());
        if (assigneeId != null && !userId.equals(assigneeId)) {
            notificationService.notify(assigneeId, workspaceId, taskId, "task.assigned",
                "Assigned: " + title,
                String.valueOf(userRow(userId).get("name")) + " updated your task.",
                "/?task=" + taskId);
        }
        Map<String, Object> result = linked(Map.of("task", task(userId, taskId)));
        if (nextTaskId != null) result.put("nextTaskId", nextTaskId);
        return result;
    }

    private void replaceTaskDependencies(String userId, String taskId, String workspaceId, List<String> dependencyIds) {
        List<String> ids = dependencyIds.stream()
            .filter(value -> value != null && !value.isBlank())
            .map(String::trim).distinct().toList();
        jdbc.update("DELETE FROM task_dependency WHERE task_id = ?", taskId);
        for (String dependsOn : ids) {
            if (taskId.equals(dependsOn)) throw ApiException.badRequest("A task cannot depend on itself.");
            Map<String, Object> dependency = taskRow(dependsOn);
            if (!workspaceId.equals(dependency.get("workspaceId"))) {
                throw ApiException.badRequest("Dependencies must be in the same workspace.");
            }
            requireTaskBoardVisible(userId, dependency);
            if (wouldCreateCycle(taskId, dependsOn)) {
                throw ApiException.badRequest("That dependency would create a cycle.");
            }
            jdbc.update("""
                INSERT OR IGNORE INTO task_dependency (task_id, depends_on_task_id, created_at) VALUES (?, ?, ?)
                """, taskId, dependsOn, Instant.now().toString());
        }
    }

    private void setReminderOffset(String userId, String taskId, String dueDate, Integer offset) {
        jdbc.update("DELETE FROM reminder WHERE task_id = ? AND user_id = ? AND sent_at IS NULL", taskId, userId);
        if (offset == null || dueDate == null) return;
        ZoneId zone = ZoneId.of(zoneForUser(userId));
        LocalDateTime due = parseLocalDateTime(dueDate, zone);
        if (due == null) return;
        Instant remindAt = due.atZone(zone).toInstant().minusSeconds(offset * 60L);
        if (remindAt.isAfter(Instant.now())) {
            jdbc.update("""
                INSERT INTO reminder (id, task_id, user_id, remind_at, channel, created_at)
                VALUES (?, ?, ?, ?, 'in_app', ?)
                """, id(), taskId, userId, remindAt.toString(), Instant.now().toString());
        }
    }

    private String jsonText(JsonNode value) {
        return value == null || value.isNull() ? null : value.asText();
    }

    private Integer jsonInteger(JsonNode value) {
        return value == null || value.isNull() ? null : value.asInt();
    }

    private String jsonTextPatch(JsonNode value, String current) {
        return value == null ? current : jsonText(value);
    }

    @Transactional
    public Map<String, Object> reorderTask(String userId, String taskId, ApiDtos.TaskReorder input) {
        Map<String, Object> current = taskRow(taskId);
        requireMinimumRole(userId, (String) current.get("workspaceId"), "MEMBER");
        requireTaskBoardVisible(userId, current);
        String direction = input == null || input.direction() == null ? "" : input.direction();
        if (!Set.of("up", "down").contains(direction)) {
            throw ApiException.badRequest("Choose a reorder direction.");
        }
        List<Map<String, Object>> columnTasks = jdbc.queryForList("""
            SELECT id, position FROM task
            WHERE column_id = ? AND deleted_at IS NULL AND archived_at IS NULL
            ORDER BY position, created_at
            """, current.get("columnId"));
        int index = -1;
        for (int i = 0; i < columnTasks.size(); i++) {
            if (taskId.equals(String.valueOf(columnTasks.get(i).get("id")))) {
                index = i;
                break;
            }
        }
        int targetIndex = index + ("up".equals(direction) ? -1 : 1);
        if (index < 0 || targetIndex < 0 || targetIndex >= columnTasks.size()) {
            Map<String, Object> result = linked(Map.of("task", task(userId, taskId)));
            result.put("moved", false);
            return result;
        }
        Map<String, Object> target = columnTasks.get(targetIndex);
        int currentPosition = number(columnTasks.get(index).get("position"));
        int targetPosition = number(target.get("position"));
        String now = Instant.now().toString();
        if (currentPosition == targetPosition) {
            currentPosition = targetPosition + ("up".equals(direction) ? -1 : 1);
            jdbc.update("""
                UPDATE task SET position = ?, version = version + 1, updated_at = ?
                WHERE id = ? AND workspace_id = ?
                """, currentPosition, now, taskId, current.get("workspaceId"));
        } else {
            jdbc.update("""
                UPDATE task SET position = ?, version = version + 1, updated_at = ?
                WHERE id = ? AND workspace_id = ?
                """, targetPosition, now, taskId, current.get("workspaceId"));
            jdbc.update("""
                UPDATE task SET position = ?, version = version + 1, updated_at = ?
                WHERE id = ? AND workspace_id = ?
                """, currentPosition, now, target.get("id"), current.get("workspaceId"));
        }
        recordActivity((String) current.get("workspaceId"), taskId, userId, "task.reordered", "task", taskId);
        List<Map<String, Object>> previous = new ArrayList<>();
        for (String id : List.of(taskId, String.valueOf(target.get("id")))) {
            Map<String, Object> row = new LinkedHashMap<>();
            int oldPosition = id.equals(taskId)
                ? number(columnTasks.get(index).get("position"))
                : targetPosition;
            row.put("taskId", id);
            row.put("position", oldPosition);
            previous.add(row);
        }
        Map<String, Object> inverse = new LinkedHashMap<>();
        inverse.put("previous", previous);
        Map<String, Object> undo = createUndo(userId, (String) current.get("workspaceId"),
            "task.reorder", "task", taskId, inverse, 60);
        Map<String, Object> result = linked(Map.of("task", task(userId, taskId)));
        result.put("moved", true);
        if (undo != null) result.put("undo", undo);
        return result;
    }

    public Map<String, Object> moveTask(String userId, String taskId, ApiDtos.TaskMove input) {        Map<String, Object> current = taskRow(taskId);
        requireMinimumRole(userId, (String) current.get("workspaceId"), "MEMBER");
        requireTaskBoardVisible(userId, current);
        int version = input.version() == null ? -1 : input.version();
        if (version != ((Number) current.get("version")).intValue()) {
            throw ApiException.conflict("This task changed elsewhere.", ((Number) current.get("version")).intValue());
        }
        Map<String, Object> target = jdbc.queryForList("""
            SELECT id, board_id AS boardId, is_done AS isDone FROM board_column
            WHERE id = ? AND deleted_at IS NULL
            """, input.columnId()).stream().findFirst()
            .orElseThrow(() -> ApiException.notFound("Column not found."));
        if (!current.get("boardId").equals(target.get("boardId"))) {
            throw ApiException.badRequest("Column does not belong to this board.");
        }
        if (!input.columnId().equals(current.get("columnId"))) {
            requireWipCapacity(input.columnId());
        }
        int updated = jdbc.update("""
            UPDATE task SET column_id = ?, version = version + 1, updated_at = ?
            WHERE id = ? AND version = ? AND deleted_at IS NULL
            """, input.columnId(), Instant.now().toString(), taskId, version);
        if (updated == 0) throw ApiException.conflict("This task changed elsewhere.", version + 1);
        boolean completing = number(target.get("isDone")) == 1 && number(current.get("completed")) == 0;
        String nextTaskId = completing
            ? createNextOccurrence(userId, current, (String) current.get("columnId"))
            : null;
        recordActivity((String) current.get("workspaceId"), taskId, userId,
            completing ? "task.completed" : "task.moved", "task", taskId);
        audit((String) current.get("workspaceId"), userId,
            completing ? "task.completed" : "task.moved", "task", taskId, Map.of());
        webhookService.dispatch((String) current.get("workspaceId"),
            completing ? "task.completed" : "task.moved",
            Map.of("taskId", taskId, "title", String.valueOf(current.get("title")), "columnId", input.columnId()));
        automationService.runForEvent((String) current.get("workspaceId"),
            completing ? "task.completed" : "task.moved", taskId, userId);
        Map<String, Object> result = linked(Map.of("task", task(userId, taskId)));
        Map<String, Object> inverse = new LinkedHashMap<>();
        inverse.put("columnId", current.get("columnId"));
        inverse.put("previousCompleted", number(current.get("completed")));
        if (nextTaskId != null) inverse.put("nextTaskId", nextTaskId);
        Map<String, Object> undo = createUndo(userId, (String) current.get("workspaceId"),
            "task.move", "task", taskId, inverse, 60);
        if (undo != null) result.put("undo", undo);
        if (nextTaskId != null) result.put("nextTaskId", nextTaskId);
        return result;
    }

    public Map<String, Object> deleteTask(String userId, String taskId) {
        Map<String, Object> current = taskRow(taskId);
        requireMinimumRole(userId, (String) current.get("workspaceId"), "MEMBER");
        requireTaskBoardVisible(userId, current);
        jdbc.update("""
            UPDATE task SET deleted_at = ?, version = version + 1 WHERE id = ? AND deleted_at IS NULL
            """, Instant.now().toString(), taskId);
        recordActivity((String) current.get("workspaceId"), taskId, userId, "task.deleted", "task", taskId);
        audit((String) current.get("workspaceId"), userId, "task.deleted", "task", taskId,
            Map.of("title", String.valueOf(current.get("title"))));
        webhookService.dispatch((String) current.get("workspaceId"), "task.deleted",
            Map.of("taskId", taskId, "title", String.valueOf(current.get("title"))));
        Map<String, Object> inverse = new LinkedHashMap<>();
        inverse.put("columnId", current.get("columnId"));
        Map<String, Object> undo = createUndo(userId, (String) current.get("workspaceId"),
            "task.delete", "task", taskId, inverse, 10);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("deleted", true);
        if (undo != null) result.put("undo", undo);
        return result;
    }

    @Transactional
    public Map<String, Object> bulkTaskAction(String userId, ApiDtos.TaskBulkAction input) {
        if (input == null || blank(input.workspaceId())) {
            throw ApiException.badRequest("Choose a workspace.");
        }
        requireMinimumRole(userId, input.workspaceId(), "MEMBER");
        List<String> taskIds = input.taskIds() == null ? List.of() : input.taskIds().stream()
            .filter(taskId -> taskId != null && !taskId.isBlank())
            .distinct()
            .toList();
        if (taskIds.isEmpty()) throw ApiException.badRequest("Choose at least one task.");
        if (taskIds.size() > 100) throw ApiException.badRequest("Bulk actions support up to 100 tasks.");
        String action = input.action() == null ? "" : input.action();
        if (!Set.of("complete", "delete", "archive", "move").contains(action)) {
            throw ApiException.badRequest("Unknown bulk action.");
        }
        List<Map<String, Object>> tasks = new ArrayList<>();
        for (String taskId : taskIds) {
            Map<String, Object> task = taskRow(taskId);
            if (!input.workspaceId().equals(task.get("workspaceId"))) {
                throw ApiException.notFound("Task not found.");
            }
            requireTaskBoardVisible(userId, task);
            tasks.add(task);
        }
        String boardId = (String) tasks.get(0).get("boardId");
        for (Map<String, Object> task : tasks) {
            if (!boardId.equals(task.get("boardId"))) {
                throw ApiException.badRequest("Bulk actions require tasks from one board.");
            }
        }
        String now = Instant.now().toString();
        List<Map<String, Object>> previous = new ArrayList<>();
        if ("complete".equals(action)) {
            Map<String, Object> doneColumn = jdbc.queryForList("""
                SELECT id FROM board_column WHERE board_id = ? AND is_done = 1 AND deleted_at IS NULL ORDER BY position LIMIT 1
                """, boardId).stream().findFirst()
                .orElseThrow(() -> ApiException.badRequest("This board has no done column."));
            String doneId = (String) doneColumn.get("id");
            for (Map<String, Object> task : tasks) {
                Map<String, Object> before = new LinkedHashMap<>();
                before.put("taskId", task.get("id"));
                before.put("columnId", task.get("columnId"));
                before.put("position", task.get("position"));
                previous.add(before);
                jdbc.update("""
                    UPDATE task SET column_id = ?, version = version + 1, updated_at = ?
                    WHERE id = ? AND workspace_id = ?
                    """, doneId, now, task.get("id"), input.workspaceId());
            }
        } else if ("archive".equals(action)) {
            for (Map<String, Object> task : tasks) {
                jdbc.update("""
                    UPDATE task SET archived_at = ?, version = version + 1, updated_at = ?
                    WHERE id = ? AND workspace_id = ?
                    """, now, now, task.get("id"), input.workspaceId());
            }
        } else if ("delete".equals(action)) {
            for (Map<String, Object> task : tasks) {
                jdbc.update("""
                    UPDATE task SET deleted_at = ?, version = version + 1, updated_at = ?
                    WHERE id = ? AND workspace_id = ?
                    """, now, now, task.get("id"), input.workspaceId());
            }
        } else {
            if (blank(input.columnId())) throw ApiException.badRequest("Choose a destination column.");
            Map<String, Object> target = jdbc.queryForList("""
                SELECT id, board_id AS boardId FROM board_column WHERE id = ? AND deleted_at IS NULL
                """, input.columnId()).stream().findFirst()
                .orElseThrow(() -> ApiException.notFound("Column not found."));
            if (!boardId.equals(target.get("boardId"))) {
                throw ApiException.badRequest("That column is not on this board.");
            }
            Integer lastPosition = jdbc.queryForObject("""
                SELECT COALESCE(MAX(position), -1) FROM task
                WHERE column_id = ? AND deleted_at IS NULL
                """, Integer.class, input.columnId());
            int position = (lastPosition == null ? 0 : lastPosition + 1);
            for (Map<String, Object> task : tasks) {
                Map<String, Object> before = new LinkedHashMap<>();
                before.put("taskId", task.get("id"));
                before.put("columnId", task.get("columnId"));
                before.put("position", task.get("position"));
                previous.add(before);
                jdbc.update("""
                    UPDATE task SET column_id = ?, position = ?, version = version + 1, updated_at = ?
                    WHERE id = ? AND workspace_id = ?
                    """, input.columnId(), position++, now, task.get("id"), input.workspaceId());
            }
        }
        String entityId = String.join(",", taskIds);
        recordActivity(input.workspaceId(), null, userId, "task.bulk_" + action, "task", entityId);
        audit(input.workspaceId(), userId, "task.bulk_" + action, "task", entityId,
            Map.of("count", taskIds.size(), "action", action));
        Map<String, Object> inverse = new LinkedHashMap<>();
        inverse.put("taskIds", taskIds);
        inverse.put("action", action);
        inverse.put("previous", previous);
        Map<String, Object> undo = createUndo(userId, input.workspaceId(),
            "task.bulk_" + action, "task", entityId, inverse, "delete".equals(action) ? 10 : 60);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("affected", taskIds.size());
        if (undo != null) result.put("undo", undo);
        return result;
    }

    public Map<String, Object> focusTask(String userId, String taskId, ApiDtos.FocusLog input) {
        Map<String, Object> current = taskRow(taskId);
        requireMinimumRole(userId, (String) current.get("workspaceId"), "MEMBER");
        requireTaskBoardVisible(userId, current);
        int minutes = input == null || input.minutes() == null ? 0 : Math.max(0, Math.min(1440, input.minutes()));
        boolean complete = input != null && Boolean.TRUE.equals(input.complete());
        if (complete && openDependencyCount(taskId) > 0) {
            throw ApiException.badRequest("Finish the work this task is waiting on first.");
        }
        int actual = (current.get("actualMinutes") == null ? 0 : number(current.get("actualMinutes"))) + minutes;
        String columnId = (String) current.get("columnId");
        if (complete) {
            Map<String, Object> doneColumn = jdbc.queryForList("""
                SELECT id FROM board_column
                WHERE board_id = ? AND is_done = 1 AND deleted_at IS NULL ORDER BY position LIMIT 1
                """, current.get("boardId")).stream().findFirst()
                .orElseThrow(() -> ApiException.badRequest("This board has no done column."));
            columnId = (String) doneColumn.get("id");
        }
        jdbc.update("""
            UPDATE task SET actual_minutes = ?, column_id = ?, version = version + 1, updated_at = ?
            WHERE id = ? AND deleted_at IS NULL
            """, actual, columnId, Instant.now().toString(), taskId);
        String nextTaskId = complete && number(current.get("completed")) == 0
            ? createNextOccurrence(userId, current, (String) current.get("columnId"))
            : null;
        if (complete && number(current.get("completed")) == 0) {
            recordActivity((String) current.get("workspaceId"), taskId, userId, "task.completed", "task", taskId);
        }
        Map<String, Object> result = linked(Map.of("task", task(userId, taskId)));
        if (complete && number(current.get("completed")) == 0) {
            Map<String, Object> inverse = new LinkedHashMap<>();
            inverse.put("columnId", current.get("columnId"));
            inverse.put("previousCompleted", number(current.get("completed")));
            if (nextTaskId != null) inverse.put("nextTaskId", nextTaskId);
            Map<String, Object> undo = createUndo(userId, (String) current.get("workspaceId"),
                "task.complete", "task", taskId, inverse, 10);
            if (undo != null) result.put("undo", undo);
        }
        if (nextTaskId != null) result.put("nextTaskId", nextTaskId);
        return result;
    }

    public Map<String, Object> completeTask(String userId, String taskId, boolean completed) {
        Map<String, Object> current = taskRow(taskId);
        requireMinimumRole(userId, (String) current.get("workspaceId"), "MEMBER");
        requireTaskBoardVisible(userId, current);
        if (completed && openDependencyCount(taskId) > 0) {
            throw ApiException.dependencyBlocked("Finish the work this task is waiting on first.");
        }
        Map<String, Object> column = jdbc.queryForList("""
            SELECT id FROM board_column
            WHERE board_id = ? AND is_done = ? AND deleted_at IS NULL ORDER BY position LIMIT 1
            """, current.get("boardId"), completed ? 1 : 0).stream().findFirst()
            .orElseThrow(() -> ApiException.badRequest("This board has no suitable column."));
        jdbc.update("""
            UPDATE task SET column_id = ?, version = version + 1, updated_at = ?
            WHERE id = ? AND deleted_at IS NULL
            """, column.get("id"), Instant.now().toString(), taskId);
        String nextTaskId = completed && number(current.get("completed")) == 0
            ? createNextOccurrence(userId, current, (String) current.get("columnId"))
            : null;
        recordActivity((String) current.get("workspaceId"), taskId, userId,
            completed ? "task.completed" : "task.reopened", "task", taskId);
        audit((String) current.get("workspaceId"), userId,
            completed ? "task.completed" : "task.reopened", "task", taskId, Map.of());
        if (completed) {
            webhookService.dispatch((String) current.get("workspaceId"), "task.completed",
                Map.of("taskId", taskId, "title", String.valueOf(current.get("title")), "columnId", column.get("id")));
            automationService.runForEvent((String) current.get("workspaceId"), "task.completed", taskId, userId);
        }
        Map<String, Object> result = linked(Map.of("task", task(userId, taskId)));
        if (completed) {
            Map<String, Object> inverse = new LinkedHashMap<>();
            inverse.put("columnId", current.get("columnId"));
            inverse.put("previousCompleted", number(current.get("completed")));
            if (nextTaskId != null) inverse.put("nextTaskId", nextTaskId);
            Map<String, Object> undo = createUndo(userId, (String) current.get("workspaceId"),
                "task.complete", "task", taskId, inverse, 10);
            if (undo != null) result.put("undo", undo);
        }
        if (nextTaskId != null) result.put("nextTaskId", nextTaskId);
        return result;
    }

    public Map<String, Object> restoreTask(String userId, String taskId) {
        Map<String, Object> current = taskRow(taskId);
        requireMinimumRole(userId, (String) current.get("workspaceId"), "MEMBER");
        requireTaskBoardVisible(userId, current);
        if (current.get("archivedAt") == null) {
            throw ApiException.badRequest("This task is not archived.");
        }
        String now = Instant.now().toString();
        jdbc.update("""
            UPDATE task SET archived_at = NULL, version = version + 1, updated_at = ?
            WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
            """, now, taskId, current.get("workspaceId"));
        recordActivity((String) current.get("workspaceId"), taskId, userId, "task.restored", "task", taskId);
        audit((String) current.get("workspaceId"), userId, "task.restored", "task", taskId, Map.of());
        return linked(Map.of("task", task(userId, taskId)));
    }

    private List<Map<String, Object>> boards(String userId, String workspaceId) {
        String role = roleFor(userId, workspaceId);
        boolean canSeePrivate = roleRank(role) >= roleRank("ADMIN");
        List<Map<String, Object>> boards = canSeePrivate
            ? jdbc.queryForList("""
                SELECT b.id, b.name, b.description, b.color, b.visibility, b.version,
                       b.share_enabled AS shareEnabled, b.archived_at AS archivedAt,
                       (SELECT COUNT(*) FROM task t WHERE t.board_id = b.id
                          AND t.deleted_at IS NULL AND t.archived_at IS NULL) AS taskCount
                FROM board b
                WHERE b.workspace_id = ? AND b.deleted_at IS NULL AND b.archived_at IS NULL
                ORDER BY b.position, b.created_at
                """, workspaceId)
            : jdbc.queryForList("""
                SELECT b.id, b.name, b.description, b.color, b.visibility, b.version,
                       b.share_enabled AS shareEnabled, b.archived_at AS archivedAt,
                       (SELECT COUNT(*) FROM task t WHERE t.board_id = b.id
                          AND t.deleted_at IS NULL AND t.archived_at IS NULL) AS taskCount
                FROM board b
                WHERE b.workspace_id = ? AND b.deleted_at IS NULL AND b.archived_at IS NULL
                  AND (b.visibility = 'workspace' OR b.created_by = ?)
                ORDER BY b.position, b.created_at
                """, workspaceId, userId);
        for (Map<String, Object> board : boards) {
            List<Map<String, Object>> columns = jdbc.queryForList("""
                SELECT id, name, position, is_done AS isDone, wip_limit AS wipLimit,
                       wip_enforced AS wipEnforced
                FROM board_column WHERE board_id = ? AND deleted_at IS NULL
                ORDER BY position, name
                """, board.get("id"));
            for (Map<String, Object> column : columns) {
                column.put("isDone", number(column.get("isDone")) == 1);
                column.put("wipEnforced", number(column.get("wipEnforced")) == 1);
            }
            board.put("columns", columns);
        }
        return boards;
    }

    private List<Map<String, Object>> tasks(String userId, String boardId, String columnId) {
        List<Map<String, Object>> tasks = jdbc.queryForList("""
            SELECT t.id, t.workspace_id AS workspaceId, t.board_id AS boardId,
                   t.column_id AS columnId, t.title, t.description, t.priority,
                   t.start_date AS startDate, t.due_date AS dueDate,
                   t.due_all_day AS dueAllDay, t.estimate_minutes AS estimateMinutes,
                   t.actual_minutes AS actualMinutes,
                   t.focus_date AS focusDate, t.version, t.updated_at AS updatedAt,
                   t.archived_at AS archivedAt,
                   t.assignee_id AS assigneeId, t.recurrence_rule AS recurrenceRule,
                   t.recurrence_ends_at AS recurrenceEndsAt,
                   u.display_name AS assigneeName, u.email AS assigneeEmail,
                   c.is_done AS completed,
                   (SELECT COUNT(*) FROM subtask s WHERE s.task_id = t.id) AS subtaskCount,
                   (SELECT COUNT(*) FROM subtask s WHERE s.task_id = t.id AND s.completed = 1) AS subtaskDone,
                   (SELECT COUNT(*) FROM task_comment tc WHERE tc.task_id = t.id) AS commentCount
            FROM task t
            JOIN board b ON b.id = t.board_id
            JOIN board_column c ON c.id = t.column_id
            LEFT JOIN app_user u ON u.id = t.assignee_id
            WHERE t.board_id = ? AND t.column_id = ? AND t.deleted_at IS NULL AND t.archived_at IS NULL
              AND b.workspace_id = t.workspace_id
            ORDER BY t.position, t.created_at
            """, boardId, columnId);
        for (Map<String, Object> task : tasks) {
            task.put("labels", labelsForTask((String) task.get("id")));
            attachAssignee(task);
        }
        return tasks;
    }

    private Map<String, Object> user(String userId) {
        return jdbc.queryForList("""
            SELECT id, email, display_name AS name, is_guest AS isGuest, timezone
            FROM app_user WHERE id = ?
            """, userId).stream().findFirst()
            .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Session user not found."));
    }

    private Map<String, Object> boardRow(String boardId) {
        return jdbc.queryForList("""
            SELECT b.id, b.workspace_id AS workspaceId, b.name, b.description, b.color,
                   b.visibility, b.share_enabled AS shareEnabled, b.share_token AS shareToken, b.version,
                   b.created_by AS createdById, b.archived_at AS archivedAt
            FROM board b JOIN workspace w ON w.id = b.workspace_id
            WHERE b.id = ? AND b.deleted_at IS NULL AND b.archived_at IS NULL
            """, boardId).stream().findFirst()
            .orElseThrow(() -> ApiException.notFound("Board not found."));
    }

    private Map<String, Object> boardRowRaw(String boardId) {
        return jdbc.queryForList("""
            SELECT b.id, b.workspace_id AS workspaceId, b.name, b.description, b.color,
                   b.visibility, b.share_enabled AS shareEnabled, b.share_token AS shareToken, b.version,
                   b.created_by AS createdById, b.archived_at AS archivedAt, b.deleted_at AS deletedAt
            FROM board b JOIN workspace w ON w.id = b.workspace_id
            WHERE b.id = ? AND b.deleted_at IS NULL
            """, boardId).stream().findFirst()
            .orElseThrow(() -> ApiException.notFound("Board not found."));
    }

    private Map<String, Object> taskRow(String taskId) {
        return jdbc.queryForList("""
            SELECT t.id, t.workspace_id AS workspaceId, t.board_id AS boardId, t.column_id AS columnId,
                   b.name AS boardName, c.name AS columnName,
                   t.title, t.description, t.priority, t.start_date AS startDate, t.due_date AS dueDate,
                   t.due_all_day AS dueAllDay, t.estimate_minutes AS estimateMinutes,
                   t.actual_minutes AS actualMinutes, t.archived_at AS archivedAt, t.version, c.is_done AS completed,
                   t.position AS position, t.focus_date AS focusDate, t.created_by AS createdById,
                   t.assignee_id AS assigneeId, t.recurrence_rule AS recurrenceRule,
                   t.recurrence_ends_at AS recurrenceEndsAt,
                   u.display_name AS assigneeName, u.email AS assigneeEmail
            FROM task t
            JOIN board b ON b.id = t.board_id
            JOIN board_column c ON c.id = t.column_id
            LEFT JOIN app_user u ON u.id = t.assignee_id
            WHERE t.id = ? AND t.deleted_at IS NULL
            """, taskId).stream().findFirst()
            .orElseThrow(() -> ApiException.notFound("Task not found."));
    }

    private Map<String, Object> task(String userId, String taskId) {
        Map<String, Object> task = taskRow(taskId);
        requireMembership(userId, (String) task.get("workspaceId"));
        requireTaskBoardVisible(userId, task);
        task.put("labels", labelsForTask(taskId));
        attachAssignee(task);
        return task;
    }

    private void attachAssignee(Map<String, Object> task) {
        Object assigneeId = task.remove("assigneeId");
        Object name = task.remove("assigneeName");
        Object email = task.remove("assigneeEmail");
        task.put("assigneeId", assigneeId);
        if (assigneeId == null) {
            task.put("assignee", null);
            return;
        }
        Map<String, Object> assignee = new LinkedHashMap<>();
        assignee.put("id", assigneeId);
        assignee.put("name", name == null ? "" : name);
        assignee.put("email", email == null ? "" : email);
        assignee.put("avatarUrl", null);
        task.put("assignee", assignee);
    }

    private List<Map<String, Object>> labelsForTask(String taskId) {
        return jdbc.queryForList("""
            SELECT l.id, l.name, l.color
            FROM task_label tl JOIN label l ON l.id = tl.label_id
            WHERE tl.task_id = ? ORDER BY l.name
            """, taskId);
    }

    private void replaceTaskLabels(String taskId, String workspaceId, List<String> names) {
        jdbc.update("DELETE FROM task_label WHERE task_id = ?", taskId);
        if (names == null) return;
        for (String name : names.stream().map(value -> value == null ? "" : value.trim())
            .filter(value -> !value.isEmpty()).distinct().limit(8).toList()) {
            String labelId = upsertLabel(workspaceId, name);
            jdbc.update("INSERT OR IGNORE INTO task_label (task_id, label_id) VALUES (?, ?)", taskId, labelId);
        }
    }

    private String upsertLabel(String workspaceId, String name) {
        return jdbc.queryForList("SELECT id FROM label WHERE workspace_id = ? AND name = ?", workspaceId, name)
            .stream().findFirst().map(row -> row.get("id").toString()).orElseGet(() -> {
                String labelId = id();
                String[] colors = {"moss", "blue", "amber", "rose", "violet", "slate"};
                String color = colors[Math.floorMod(name.hashCode(), colors.length)];
                jdbc.update("""
                    INSERT INTO label (id, workspace_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)
                    """, labelId, workspaceId, name, color, Instant.now().toString());
                return labelId;
            });
    }

    private void requireMembership(String userId, String workspaceId) {
        requireTokenWorkspace(workspaceId);
        Integer count = jdbc.queryForObject("""
            SELECT COUNT(*) FROM membership m JOIN workspace w ON w.id = m.workspace_id
            WHERE m.user_id = ? AND m.workspace_id = ? AND w.deleted_at IS NULL
            """, Integer.class, userId, workspaceId);
        if (count == null || count == 0) throw ApiException.notFound("Workspace not found.");
        mfaGuard.requireSatisfied(userId, workspaceId);
    }

    private void requireTokenWorkspace(String workspaceId) {
        try {
            if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes) {
                Object scoped = attributes.getRequest().getAttribute(AuthInterceptor.TOKEN_WORKSPACE);
                if (scoped != null && !workspaceId.equals(String.valueOf(scoped))) {
                    throw ApiException.forbidden("This API token is scoped to another workspace.");
                }
            }
        } catch (ApiException exception) {
            throw exception;
        } catch (Exception ignored) {
            // No request context.
        }
    }

    private void requireMinimumRole(String userId, String workspaceId, String minimum) {
        requireTokenWorkspace(workspaceId);
        String role = roleFor(userId, workspaceId);
        if (roleRank(role) < roleRank(minimum)) throw ApiException.forbidden("You do not have permission for this action.");
        mfaGuard.requireSatisfied(userId, workspaceId);
    }

    private int roleRank(String role) {
        return switch (role) {
            case "OWNER" -> 4;
            case "ADMIN" -> 3;
            case "MEMBER" -> 2;
            case "GUEST" -> 1;
            default -> 0;
        };
    }

    private String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder out = new StringBuilder();
            for (byte b : digest) out.append(String.format("%02x", b));
            return out.toString();
        } catch (Exception exception) {
            throw new IllegalStateException("SHA-256 unavailable", exception);
        }
    }

    private String priority(String value) {
        return value != null && PRIORITIES.contains(value) ? value : "none";
    }

    private String normalizeAssignee(String workspaceId, String assigneeId) {
        if (blank(assigneeId)) return null;
        Integer count = jdbc.queryForObject("""
            SELECT COUNT(*) FROM membership WHERE workspace_id = ? AND user_id = ?
            """, Integer.class, workspaceId, assigneeId);
        if (count == null || count == 0) throw ApiException.badRequest("Assignee must belong to this workspace.");
        return assigneeId;
    }

    private String normalizeVisibility(String visibility) {
        String value = blank(visibility) ? "workspace" : visibility.trim().toLowerCase();
        if (!Set.of("workspace", "private").contains(value)) {
            throw ApiException.badRequest("Board visibility must be workspace or private.");
        }
        return value;
    }

    private void requireTaskBoardVisible(String userId, Map<String, Object> task) {
        Map<String, Object> board = jdbc.queryForList("""
            SELECT workspace_id AS workspaceId, visibility, created_by AS createdById
            FROM board WHERE id = ?
            """, task.get("boardId")).stream().findFirst()
            .orElseThrow(() -> ApiException.notFound("Board not found."));
        requireBoardVisible(userId, board);
    }

    private void requireBoardVisible(String userId, Map<String, Object> board) {
        if (!"private".equals(board.get("visibility"))) return;
        String role = roleFor(userId, (String) board.get("workspaceId"));
        if (roleRank(role) >= roleRank("ADMIN")) return;
        if (userId.equals(board.get("createdById"))) return;
        throw ApiException.notFound("Board not found.");
    }

    private String roleFor(String userId, String workspaceId) {
        return jdbc.queryForList("""
            SELECT m.role FROM membership m JOIN workspace w ON w.id = m.workspace_id
            WHERE m.user_id = ? AND m.workspace_id = ? AND w.deleted_at IS NULL
            """, userId, workspaceId).stream().findFirst()
            .map(row -> row.get("role").toString())
            .orElseThrow(() -> ApiException.notFound("Workspace not found."));
    }

    private String normalizeRecurrence(String rule) {
        if (blank(rule)) return null;
        String value = rule.trim().toUpperCase();
        if (value.length() > 200 || parseRecurrence(value) == null) {
            throw ApiException.badRequest("Recurrence rule is invalid.");
        }
        return value;
    }

    private String normalizeRecurrenceEnds(String value) {
        if (blank(value)) return null;
        String text = value.trim();
        try {
            if (text.length() == 10) {
                LocalDate.parse(text);
            } else if (text.endsWith("Z") || text.matches(".*[+-]\\d{2}:\\d{2}$")) {
                OffsetDateTime.parse(text);
            } else {
                LocalDateTime.parse(text);
            }
        } catch (Exception exception) {
            throw ApiException.badRequest("Recurrence end must be a date or ISO instant.");
        }
        return text;
    }

    private record RecurrenceSpec(String frequency, int interval, List<Integer> byDay) {
    }

    private RecurrenceSpec parseRecurrence(String rule) {
        if (blank(rule)) return null;
        Map<String, String> fields = new HashMap<>();
        for (String part : rule.split(";")) {
            String[] pieces = part.split("=", 2);
            if (pieces.length == 2) fields.put(pieces[0].trim().toUpperCase(), pieces[1].trim().toUpperCase());
        }
        String frequency = fields.get("FREQ");
        if (!Set.of("DAILY", "WEEKLY", "MONTHLY").contains(frequency)) return null;
        int interval;
        try {
            interval = Math.max(1, Math.min(52, Integer.parseInt(fields.getOrDefault("INTERVAL", "1"))));
        } catch (NumberFormatException exception) {
            interval = 1;
        }
        List<Integer> byDay = new ArrayList<>();
        if (fields.containsKey("BYDAY")) {
            for (String code : fields.get("BYDAY").split(",")) {
                int day = switch (code.trim()) {
                    case "SU" -> 0;
                    case "MO" -> 1;
                    case "TU" -> 2;
                    case "WE" -> 3;
                    case "TH" -> 4;
                    case "FR" -> 5;
                    case "SA" -> 6;
                    default -> -1;
                };
                if (day >= 0 && !byDay.contains(day)) byDay.add(day);
            }
        }
        return new RecurrenceSpec(frequency, interval, byDay);
    }

    private String zoneForUser(String userId) {
        try {
            List<String> zones = jdbc.queryForList("SELECT timezone FROM app_user WHERE id = ?", String.class, userId);
            String zone = zones.isEmpty() ? null : zones.get(0);
            return blank(zone) ? ZoneId.systemDefault().getId() : zone;
        } catch (Exception exception) {
            return ZoneId.systemDefault().getId();
        }
    }

    private LocalDateTime parseLocalDateTime(String value, ZoneId zone) {
        if (blank(value)) return null;
        String text = value.trim();
        try {
            if (text.length() == 10) return LocalDate.parse(text).atStartOfDay();
            if (text.endsWith("Z") || text.matches(".*[+-]\\d{2}:\\d{2}$")) {
                return OffsetDateTime.parse(text).atZoneSameInstant(zone).toLocalDateTime();
            }
            return LocalDateTime.parse(text);
        } catch (Exception exception) {
            return null;
        }
    }

    private LocalDateTime parseRecurrenceBoundary(String value, ZoneId zone) {
        LocalDateTime parsed = parseLocalDateTime(value, zone);
        if (parsed == null) return null;
        return value.trim().length() == 10 ? parsed.toLocalDate().atTime(23, 59, 59) : parsed;
    }

    private String nextRecurrenceDue(String rule, String dueDate, boolean dueAllDay, String endsAt, String timeZone) {
        RecurrenceSpec spec = parseRecurrence(rule);
        if (spec == null) return null;
        ZoneId zone;
        try {
            zone = ZoneId.of(timeZone);
        } catch (DateTimeException exception) {
            zone = ZoneId.systemDefault();
        }
        LocalDateTime current = parseLocalDateTime(dueDate, zone);
        if (current == null) return null;
        LocalDate date = current.toLocalDate();
        LocalDate nextDate;
        if ("DAILY".equals(spec.frequency())) {
            nextDate = date.plusDays(spec.interval());
        } else if ("MONTHLY".equals(spec.frequency())) {
            nextDate = date.plusMonths(spec.interval());
        } else if (!spec.byDay().isEmpty()) {
            nextDate = null;
            int limit = 14 * spec.interval();
            for (int offset = 1; offset <= limit; offset++) {
                LocalDate candidate = date.plusDays(offset);
                int weekday = candidate.getDayOfWeek().getValue() % 7;
                int weekOffset = offset / 7;
                if (spec.byDay().contains(weekday) && weekOffset % spec.interval() == 0) {
                    nextDate = candidate;
                    break;
                }
            }
            if (nextDate == null) nextDate = date.plusWeeks(spec.interval());
        } else {
            nextDate = date.plusWeeks(spec.interval());
        }
        LocalTime time = dueAllDay ? LocalTime.NOON : current.toLocalTime();
        LocalDateTime next = LocalDateTime.of(nextDate, time);
        LocalDateTime boundary = parseRecurrenceBoundary(endsAt, zone);
        if (boundary != null && next.isAfter(boundary)) return null;
        return dueAllDay ? next.toLocalDate().toString() : next.format(DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss"));
    }

    private String createNextOccurrence(String userId, Map<String, Object> task, String columnId) {
        String rule = (String) task.get("recurrenceRule");
        String dueDate = (String) task.get("dueDate");
        if (blank(rule) || blank(dueDate) || blank(columnId)) return null;
        boolean dueAllDay = number(task.get("dueAllDay")) == 1;
        String nextDue = nextRecurrenceDue(rule, dueDate, dueAllDay,
            (String) task.get("recurrenceEndsAt"), zoneForUser(userId));
        if (nextDue == null) return null;
        String nextId = id();
        String now = Instant.now().toString();
        Integer nextPosition = jdbc.queryForObject("""
            SELECT COALESCE(MAX(position), -1) + 1 FROM task
            WHERE board_id = ? AND column_id = ? AND deleted_at IS NULL
            """, Integer.class, task.get("boardId"), columnId);
        jdbc.update("""
            INSERT INTO task (id, workspace_id, board_id, column_id, title, description,
                              priority, start_date, due_date, due_all_day, estimate_minutes,
                              actual_minutes, assignee_id, recurrence_rule, recurrence_ends_at,
                              position, version, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?, ?, ?, 1, ?, ?, ?)
            """, nextId, task.get("workspaceId"), task.get("boardId"), columnId,
            task.get("title"), task.get("description") == null ? "" : task.get("description"),
            task.get("priority"), nextDue, dueAllDay ? 1 : 0, task.get("estimateMinutes"),
            task.get("assigneeId"), rule, task.get("recurrenceEndsAt"),
            nextPosition == null ? 0 : nextPosition, userId, now, now);
        List<String> labelNames = labelsForTask((String) task.get("id")).stream()
            .map(label -> String.valueOf(label.get("name"))).toList();
        if (!labelNames.isEmpty()) replaceTaskLabels(nextId, (String) task.get("workspaceId"), labelNames);
        recordActivity((String) task.get("workspaceId"), String.valueOf(task.get("id")), userId,
            "task.recurred", "task", String.valueOf(task.get("id")));
        return nextId;
    }

    private Integer normalizeEstimate(Integer value) {
        if (value == null) return null;
        return Math.max(5, Math.min(24 * 60, value));
    }

    private Integer normalizeActual(Integer value) {
        if (value == null) return null;
        return Math.max(0, Math.min(24 * 60, value));
    }

    private int number(Object value) {
        if (value instanceof Boolean flag) return flag ? 1 : 0;
        return value instanceof Number number ? number.intValue() : 0;
    }

    private String randomToken() {
        return (UUID.randomUUID().toString() + UUID.randomUUID().toString()).replace("-", "");
    }

    private String id() {
        return UUID.randomUUID().toString();
    }

    private String stringValue(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private boolean blank(String value) {
        return value == null || value.trim().isEmpty();
    }

    private Map<String, Object> linked(Map<String, Object> source) {
        return new LinkedHashMap<>(source);
    }
}
