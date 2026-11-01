package com.project3383.app;

import com.project3383.api.ApiException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class ApiTokenService {

    private static final SecureRandom RANDOM = new SecureRandom();
    private final JdbcTemplate jdbc;
    private final AuditService auditService;

    public ApiTokenService(JdbcTemplate jdbc, AuditService auditService) {
        this.jdbc = jdbc;
        this.auditService = auditService;
    }

    public Map<String, Object> list(String userId, String workspaceId) {
        requireAdmin(userId, workspaceId);
        List<Map<String, Object>> tokens = jdbc.queryForList("""
            SELECT id, name, prefix, last_used_at AS lastUsedAt, expires_at AS expiresAt,
                   created_at AS createdAt
            FROM api_token
            WHERE user_id = ? AND workspace_id = ? AND revoked_at IS NULL
            ORDER BY created_at DESC
            """, userId, workspaceId);
        return linked(Map.of("tokens", tokens));
    }

    @Transactional
    public Map<String, Object> create(String userId, String workspaceId, String name, Integer expiresInDays) {
        requireAdmin(userId, workspaceId);
        String tokenName = name == null ? "" : name.trim();
        if (tokenName.isEmpty() || tokenName.length() > 80) {
            throw ApiException.badRequest("Token name must be between 1 and 80 characters.");
        }
        int days = expiresInDays == null ? 30 : Math.max(1, Math.min(3650, expiresInDays));
        String raw = "drift_pat_" + randomToken();
        String id = UUID.randomUUID().toString();
        String now = Instant.now().toString();
        String expiresAt = Instant.now().plusSeconds(days * 24L * 60L * 60L).toString();
        jdbc.update("""
            INSERT INTO api_token (id, user_id, workspace_id, name, token_hash, prefix,
                                   last_used_at, expires_at, revoked_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?)
            """, id, userId, workspaceId, tokenName, sha256(raw), raw.substring(0, Math.min(18, raw.length())),
            expiresAt, now);
        auditService.record(workspaceId, userId, "api_token.created", "api_token", id,
            Map.of("name", tokenName, "expiresAt", expiresAt));
        Map<String, Object> record = new LinkedHashMap<>();
        record.put("id", id);
        record.put("name", tokenName);
        record.put("prefix", raw.substring(0, Math.min(18, raw.length())));
        record.put("expiresAt", expiresAt);
        record.put("createdAt", now);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("token", raw);
        result.put("record", record);
        return result;
    }

    @Transactional
    public Map<String, Object> revoke(String userId, String workspaceId, String tokenId) {
        requireAdmin(userId, workspaceId);
        int updated = jdbc.update("""
            UPDATE api_token SET revoked_at = ?
            WHERE id = ? AND user_id = ? AND workspace_id = ? AND revoked_at IS NULL
            """, Instant.now().toString(), tokenId, userId, workspaceId);
        if (updated == 0) throw ApiException.notFound("Token not found.");
        auditService.record(workspaceId, userId, "api_token.revoked", "api_token", tokenId, Map.of());
        return linked(Map.of("revoked", true));
    }

    public Map<String, Object> authenticate(String raw) {
        if (raw == null || !raw.startsWith("drift_pat_")) return null;
        List<Map<String, Object>> rows = jdbc.queryForList("""
            SELECT id, user_id AS userId, workspace_id AS workspaceId, expires_at AS expiresAt,
                   revoked_at AS revokedAt
            FROM api_token WHERE token_hash = ?
            """, sha256(raw));
        if (rows.isEmpty()) return null;
        Map<String, Object> row = rows.get(0);
        if (row.get("revokedAt") != null) return null;
        try {
            if (Instant.parse(String.valueOf(row.get("expiresAt"))).isBefore(Instant.now())) return null;
        } catch (Exception exception) {
            return null;
        }
        jdbc.update("UPDATE api_token SET last_used_at = ? WHERE id = ?", Instant.now().toString(), row.get("id"));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("userId", row.get("userId"));
        result.put("workspaceId", row.get("workspaceId"));
        return result;
    }

    private void requireAdmin(String userId, String workspaceId) {
        String role = jdbc.queryForList("""
            SELECT role FROM membership WHERE user_id = ? AND workspace_id = ?
            """, userId, workspaceId).stream().findFirst()
            .map(row -> String.valueOf(row.get("role")))
            .orElseThrow(() -> ApiException.notFound("Workspace not found."));
        if (!"OWNER".equals(role) && !"ADMIN".equals(role)) {
            throw ApiException.forbidden("You do not have permission to manage API tokens.");
        }
    }

    private String randomToken() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
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

    private Map<String, Object> linked(Map<String, Object> value) {
        return new LinkedHashMap<>(value);
    }
}
