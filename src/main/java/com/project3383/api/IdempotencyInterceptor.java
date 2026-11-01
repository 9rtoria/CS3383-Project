package com.project3383.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.project3383.auth.AuthInterceptor;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.time.Instant;
import java.util.List;
import java.util.Map;

@Component
public class IdempotencyInterceptor implements HandlerInterceptor {

    public static final String ATTR_USER = "project3383.idempotencyUser";
    public static final String ATTR_KEY = "project3383.idempotencyKey";
    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public IdempotencyInterceptor(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
        String method = request.getMethod();
        if ("GET".equals(method) || "HEAD".equals(method) || "OPTIONS".equals(method)) return true;
        String key = request.getHeader("Idempotency-Key");
        if (key == null || key.isBlank() || key.length() > 200) return true;
        String userId = userId(request);
        if (userId == null) return true;
        request.setAttribute(ATTR_USER, userId);
        request.setAttribute(ATTR_KEY, key);

        List<Map<String, Object>> rows = jdbc.queryForList("""
            SELECT id, method, path, status, response_json AS responseJson, expires_at AS expiresAt
            FROM idempotency_key WHERE user_id = ? AND key = ?
            """, userId, key);
        if (rows.isEmpty()) return true;
        Map<String, Object> stored = rows.get(0);
        String path = request.getRequestURI();
        if (!method.equals(String.valueOf(stored.get("method")))
            || !path.equals(String.valueOf(stored.get("path")))) {
            response.setStatus(HttpServletResponse.SC_CONFLICT);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.setCharacterEncoding("UTF-8");
            response.getWriter().write(objectMapper.writeValueAsString(Map.of(
                "code", "CONFLICT",
                "message", "This idempotency key was already used for a different request."
            )));
            return false;
        }
        try {
            if (Instant.parse(String.valueOf(stored.get("expiresAt"))).isBefore(Instant.now())) {
                jdbc.update("DELETE FROM idempotency_key WHERE id = ?", stored.get("id"));
                return true;
            }
        } catch (Exception exception) {
            jdbc.update("DELETE FROM idempotency_key WHERE id = ?", stored.get("id"));
            return true;
        }
        response.setStatus(stored.get("status") == null ? 200 : ((Number) stored.get("status")).intValue());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        response.setHeader("Idempotent-Replayed", "true");
        String body = stored.get("responseJson") == null ? "{}" : String.valueOf(stored.get("responseJson"));
        response.getWriter().write(body);
        return false;
    }

    private String userId(HttpServletRequest request) {
        Object tokenUser = request.getAttribute(AuthInterceptor.TOKEN_USER);
        if (tokenUser != null) return tokenUser.toString();
        HttpSession session = request.getSession(false);
        Object sessionUser = session == null ? null : session.getAttribute(AuthInterceptor.SESSION_USER);
        return sessionUser == null ? null : sessionUser.toString();
    }
}
