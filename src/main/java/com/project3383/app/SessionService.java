package com.project3383.app;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;

@Service
public class SessionService {

    private final JdbcTemplate jdbc;

    public SessionService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void start(HttpSession session, String userId, HttpServletRequest request, boolean mfaVerified) {
        String now = Instant.now().toString();
        String expires = Instant.now().plus(30, ChronoUnit.DAYS).toString();
        String ipHash = request == null ? null : hash(request.getRemoteAddr());
        String userAgent = request == null ? null : truncate(request.getHeader("User-Agent"), 500);
        jdbc.update("""
            INSERT INTO auth_session (id, token_hash, user_id, ip_hash, user_agent, mfa_verified_at,
                                      last_used_at, expires_at, revoked_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
            ON CONFLICT(id) DO UPDATE SET
                token_hash = excluded.token_hash,
                user_id = excluded.user_id,
                ip_hash = excluded.ip_hash,
                user_agent = excluded.user_agent,
                mfa_verified_at = excluded.mfa_verified_at,
                last_used_at = excluded.last_used_at,
                expires_at = excluded.expires_at,
                revoked_at = NULL
            """, session.getId(), hash(session.getId()), userId, ipHash, userAgent,
            mfaVerified ? now : null, now, expires, now);
    }

    public boolean touch(HttpSession session, String userId) {
        if (session == null || userId == null) return false;
        List<Map<String, Object>> rows = jdbc.queryForList("""
            SELECT revoked_at AS revokedAt, expires_at AS expiresAt
            FROM auth_session WHERE id = ? AND user_id = ?
            """, session.getId(), userId);
        if (rows.isEmpty()) return false;
        Map<String, Object> row = rows.get(0);
        if (row.get("revokedAt") != null) return false;
        try {
            if (Instant.parse(String.valueOf(row.get("expiresAt"))).isBefore(Instant.now())) {
                revoke(session.getId(), userId);
                return false;
            }
        } catch (Exception exception) {
            return false;
        }
        Instant now = Instant.now();
        jdbc.update("""
            UPDATE auth_session SET last_used_at = ?, expires_at = ?
            WHERE id = ? AND user_id = ? AND revoked_at IS NULL
            """, now.toString(), now.plus(30, ChronoUnit.DAYS).toString(), session.getId(), userId);
        return true;
    }

    public void revoke(String sessionId, String userId) {
        if (sessionId == null) return;
        jdbc.update("""
            UPDATE auth_session SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL
            """, Instant.now().toString(), sessionId, userId);
    }

    public void revokeIfPresent(HttpSession session) {
        if (session == null) return;
        Object userId = session.getAttribute("project3383.userId");
        if (userId != null) revoke(session.getId(), userId.toString());
    }

    public void revokeOthers(String userId, String currentSessionId) {
        jdbc.update("""
            UPDATE auth_session SET revoked_at = ?
            WHERE user_id = ? AND id <> ? AND revoked_at IS NULL
            """, Instant.now().toString(), userId, currentSessionId == null ? "" : currentSessionId);
    }

    private String hash(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(String.valueOf(value).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (Exception exception) {
            throw new IllegalStateException("Could not hash session token.", exception);
        }
    }

    private String truncate(String value, int max) {
        if (value == null) return null;
        return value.length() <= max ? value : value.substring(0, max);
    }
}
