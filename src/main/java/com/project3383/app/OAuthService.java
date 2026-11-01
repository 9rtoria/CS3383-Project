package com.project3383.app;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class OAuthService {

    private final Environment environment;
    private final ObjectMapper objectMapper;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(12)).build();

    public OAuthService(Environment environment, ObjectMapper objectMapper) {
        this.environment = environment;
        this.objectMapper = objectMapper;
    }

    public record Profile(String providerAccountId, String email, String name) {
    }

    private record Provider(String id, String clientId, String clientSecret, String authorizeUrl,
                            String tokenUrl, String scope, String label) {
    }

    public List<Map<String, Object>> providers() {
        List<Map<String, Object>> result = new java.util.ArrayList<>();
        for (String id : List.of("github", "google", "apple")) {
            Provider provider = provider(id);
            if (provider == null) continue;
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", provider.id());
            item.put("label", provider.label());
            result.add(item);
        }
        return result;
    }

    public boolean enabled(String id) {
        return provider(id) != null;
    }

    public String authorizeUrl(String id, String state, String baseUrl, String next) {
        Provider provider = provider(id);
        if (provider == null) throw new IllegalArgumentException("That sign-in provider is not configured.");
        String redirect = baseUrl + "/api/auth/oauth/" + id + "/callback";
        StringBuilder url = new StringBuilder(provider.authorizeUrl())
            .append(provider.authorizeUrl().contains("?") ? "&" : "?")
            .append("client_id=").append(encode(provider.clientId()))
            .append("&redirect_uri=").append(encode(redirect))
            .append("&response_type=code")
            .append("&scope=").append(encode(provider.scope()))
            .append("&state=").append(encode(state));
        if ("google".equals(id)) {
            url.append("&access_type=online&prompt=select_account");
        }
        if ("apple".equals(id)) {
            url.append("&response_mode=form_post");
        }
        return url.toString();
    }

    public Profile exchange(String id, String baseUrl, String code) {
        Provider provider = provider(id);
        if (provider == null) throw new IllegalStateException("Provider is not configured.");
        Map<String, String> form = new LinkedHashMap<>();
        form.put("client_id", provider.clientId());
        form.put("client_secret", provider.clientSecret());
        form.put("code", code);
        form.put("redirect_uri", baseUrl + "/api/auth/oauth/" + id + "/callback");
        if (!"github".equals(id)) form.put("grant_type", "authorization_code");
        JsonNode token = postForm(provider.tokenUrl(), form);
        if (token == null || token.path("access_token").asText("").isBlank()) {
            if ("apple".equals(id) && !token.path("id_token").asText("").isBlank()) {
                return appleProfile(token.path("id_token").asText(), provider.clientId());
            }
            throw new IllegalStateException("The provider did not return an access token.");
        }
        String accessToken = token.path("access_token").asText();
        if ("github".equals(id)) {
            JsonNode user = getJson(property("OAUTH_GITHUB_USER_URL", "https://api.github.com/user"), accessToken);
            String email = user.path("email").asText(null);
            if (email == null || email.isBlank()) {
                JsonNode emails = getJson(property("OAUTH_GITHUB_EMAILS_URL",
                    "https://api.github.com/user/emails"), accessToken);
                if (emails != null && emails.isArray()) {
                    for (JsonNode item : emails) {
                        if (item.path("verified").asBoolean(false)
                            && (item.path("primary").asBoolean(false) || email == null)) {
                            email = item.path("email").asText(null);
                            if (item.path("primary").asBoolean(false)) break;
                        }
                    }
                }
            }
            String name = user.path("name").asText(null);
            if (name == null || name.isBlank()) name = user.path("login").asText("GitHub user");
            return new Profile(user.path("id").asText(), email, name);
        }
        if ("google".equals(id)) {
            JsonNode profile = getJson(property("OAUTH_GOOGLE_USERINFO_URL",
                "https://openidconnect.googleapis.com/v1/userinfo"), accessToken);
            String email = profile.path("email_verified").asBoolean(false)
                ? profile.path("email").asText(null) : null;
            String name = profile.path("name").asText(null);
            if (name == null || name.isBlank()) {
                name = email == null ? "Google user" : email.substring(0, email.indexOf('@'));
            }
            return new Profile(profile.path("sub").asText(), email, name);
        }
        throw new IllegalStateException("Unsupported provider.");
    }

    private Profile appleProfile(String idToken, String clientId) {
        try {
            com.nimbusds.jwt.SignedJWT signed = com.nimbusds.jwt.SignedJWT.parse(idToken);
            com.nimbusds.jose.jwk.JWKSet jwks = com.nimbusds.jose.jwk.JWKSet
                .load(new java.net.URL(property("OAUTH_APPLE_JWKS_URL",
                    "https://appleid.apple.com/auth/keys")));
            com.nimbusds.jose.jwk.JWK jwk = jwks.getKeyByKeyId(signed.getHeader().getKeyID());
            if (jwk == null || !(jwk instanceof com.nimbusds.jose.jwk.RSAKey rsaKey)) {
                throw new IllegalArgumentException("Unknown Apple signing key.");
            }
            com.nimbusds.jose.JWSVerifier verifier = new com.nimbusds.jose.crypto.RSASSAVerifier(rsaKey);
            if (!signed.verify(verifier)) {
                throw new IllegalArgumentException("The identity token signature is invalid.");
            }
            com.nimbusds.jwt.JWTClaimsSet claims = signed.getJWTClaimsSet();
            if (!"https://appleid.apple.com".equals(claims.getIssuer())) {
                throw new IllegalArgumentException("Unexpected identity token issuer.");
            }
            if (claims.getAudience() == null || !claims.getAudience().contains(clientId)) {
                throw new IllegalArgumentException("Unexpected identity token audience.");
            }
            if (claims.getExpirationTime() != null && claims.getExpirationTime().toInstant().isBefore(Instant.now())) {
                throw new IllegalArgumentException("The identity token has expired.");
            }
            Object emailVerified = claims.getClaim("email_verified");
            String email = (Boolean.TRUE.equals(emailVerified) || "true".equalsIgnoreCase(String.valueOf(emailVerified)))
                ? claims.getStringClaim("email") : null;
            String name = email == null ? "Apple user" : email.substring(0, email.indexOf('@'));
            return new Profile(claims.getSubject(), email, name);
        } catch (Exception exception) {
            throw new IllegalStateException("Could not read the Apple identity token.", exception);
        }
    }

    private Provider provider(String id) {
        if (id == null) return null;
        if ("github".equals(id)) {
            String clientId = environment.getProperty("GITHUB_CLIENT_ID", "");
            String secret = environment.getProperty("GITHUB_CLIENT_SECRET", "");
            if (clientId.isBlank() || secret.isBlank()) return null;
            return new Provider("github", clientId, secret,
                property("OAUTH_GITHUB_AUTHORIZE_URL", "https://github.com/login/oauth/authorize"),
                property("OAUTH_GITHUB_TOKEN_URL", "https://github.com/login/oauth/access_token"),
                "read:user user:email", "GitHub");
        }
        if ("google".equals(id)) {
            String clientId = environment.getProperty("GOOGLE_CLIENT_ID", "");
            String secret = environment.getProperty("GOOGLE_CLIENT_SECRET", "");
            if (clientId.isBlank() || secret.isBlank()) return null;
            return new Provider("google", clientId, secret,
                property("OAUTH_GOOGLE_AUTHORIZE_URL", "https://accounts.google.com/o/oauth2/v2/auth"),
                property("OAUTH_GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com/token"),
                "openid email profile", "Google");
        }
        if ("apple".equals(id)) {
            String clientId = environment.getProperty("APPLE_CLIENT_ID", "");
            String secret = environment.getProperty("APPLE_CLIENT_SECRET", "");
            if (clientId.isBlank() || secret.isBlank()) return null;
            return new Provider("apple", clientId, secret,
                property("OAUTH_APPLE_AUTHORIZE_URL", "https://appleid.apple.com/auth/authorize"),
                property("OAUTH_APPLE_TOKEN_URL", "https://appleid.apple.com/auth/token"),
                "name email", "Apple");
        }
        return null;
    }

    private JsonNode postForm(String url, Map<String, String> fields) {
        try {
            StringBuilder body = new StringBuilder();
            for (Map.Entry<String, String> entry : fields.entrySet()) {
                if (body.length() > 0) body.append('&');
                body.append(encode(entry.getKey())).append('=').append(encode(entry.getValue()));
            }
            HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(20))
                .header("content-type", "application/x-www-form-urlencoded")
                .header("accept", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
                .build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() / 100 != 2) {
                throw new IllegalStateException("Token exchange failed with HTTP " + response.statusCode() + ".");
            }
            return objectMapper.readTree(response.body());
        } catch (Exception exception) {
            throw new IllegalStateException("The provider token exchange failed.", exception);
        }
    }

    private JsonNode getJson(String url, String accessToken) {
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(20))
                .header("authorization", "Bearer " + accessToken)
                .header("accept", "application/json")
                .header("user-agent", "Drift")
                .GET()
                .build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() / 100 != 2) {
                throw new IllegalStateException("Profile request failed with HTTP " + response.statusCode() + ".");
            }
            return objectMapper.readTree(response.body());
        } catch (Exception exception) {
            throw new IllegalStateException("The provider profile could not be read.", exception);
        }
    }

    private String property(String key, String fallback) {
        String value = environment.getProperty(key);
        return value == null || value.isBlank() ? fallback : value;
    }

    private String encode(String value) {
        return URLEncoder.encode(value == null ? "" : value, StandardCharsets.UTF_8);
    }
}
