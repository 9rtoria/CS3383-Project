package com.project3383.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.core.MethodParameter;
import org.springframework.http.MediaType;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyAdvice;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

@ControllerAdvice
public class IdempotencyResponseAdvice implements ResponseBodyAdvice<Object> {

    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;

    public IdempotencyResponseAdvice(JdbcTemplate jdbc, ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
    }

    @Override
    public boolean supports(MethodParameter returnType, Class<? extends HttpMessageConverter<?>> converterType) {
        return true;
    }

    @Override
    public Object beforeBodyWrite(Object body, MethodParameter returnType, MediaType selectedContentType,
                                  Class<? extends HttpMessageConverter<?>> selectedConverterType,
                                  ServerHttpRequest request, ServerHttpResponse response) {
        if (body == null) return null;
        Object userId = request.getAttributes().get(IdempotencyInterceptor.ATTR_USER);
        Object key = request.getAttributes().get(IdempotencyInterceptor.ATTR_KEY);
        if (userId == null || key == null) return body;
        int status = 200;
        if (response instanceof org.springframework.http.server.ServletServerHttpResponse servletResponse) {
            status = servletResponse.getServletResponse().getStatus();
        }
        if (status >= 400) return body;
        try {
            String json = objectMapper.writeValueAsString(body);
            String workspaceId = request.getHeaders().getFirst("X-Workspace-Id");
            String now = Instant.now().toString();
            jdbc.update("""
                INSERT INTO idempotency_key (id, user_id, workspace_id, key, method, path, status,
                                             response_json, created_at, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, key) DO NOTHING
                """, UUID.randomUUID().toString(), userId.toString(), workspaceId,
                key.toString(), request.getMethod().name(), request.getURI().getPath(), status,
                json, now, Instant.now().plus(24, ChronoUnit.HOURS).toString());
        } catch (Exception ignored) {
            // Idempotency is a safety net; a failed cache write must not fail the request.
        }
        return body;
    }
}
