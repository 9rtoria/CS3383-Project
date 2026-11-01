package com.project3383.app;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.project3383.api.ApiException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class AuditService {

    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;

    public AuditService(JdbcTemplate jdbc, ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
    }

    public void record(String workspaceId, String actorId, String action, String entityType,
                       String entityId, Map<String, Object> metadata) {
        try {
            String json;
            try {
                json = objectMapper.writeValueAsString(metadata == null ? Map.of() : metadata);
            } catch (Exception exception) {
                json = "{}";
            }
            jdbc.update("""
                INSERT INTO audit_event (id, workspace_id, actor_id, action, entity_type,
                                         entity_id, metadata, request_id, ip_hash, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
                """, UUID.randomUUID().toString(), workspaceId, actorId, action, entityType,
                entityId, json.length() > 4000 ? json.substring(0, 4000) : json,
                "service", Instant.now().toString());
        } catch (Exception ignored) {
            // Audit logging must not break the operation it describes.
        }
    }

    public Map<String, Object> list(String userId, String workspaceId, int limit, String cursor) {
        String role = jdbc.queryForList("""
            SELECT role FROM membership WHERE user_id = ? AND workspace_id = ?
            """, userId, workspaceId).stream().findFirst()
            .map(row -> String.valueOf(row.get("role")))
            .orElseThrow(() -> ApiException.notFound("Workspace not found."));
        if (!"OWNER".equals(role) && !"ADMIN".equals(role)) {
            throw ApiException.forbidden("You do not have permission to read the audit log.");
        }
        purge(workspaceId);
        int pageSize = Math.max(1, Math.min(200, limit));
        List<Map<String, Object>> events;
        if (cursor != null && !cursor.isBlank()) {
            Map<String, Object> anchor = jdbc.queryForList("""
                SELECT created_at AS createdAt, id FROM audit_event
                WHERE id = ? AND workspace_id = ?
                """, cursor, workspaceId).stream().findFirst().orElse(null);
            if (anchor == null) {
                events = jdbc.queryForList("""
                    SELECT a.id, a.action, a.entity_type AS entityType, a.entity_id AS entityId,
                           a.metadata, a.request_id AS requestId, a.created_at AS createdAt,
                           a.actor_id AS actorId, u.display_name AS actorName, u.email AS actorEmail
                    FROM audit_event a LEFT JOIN app_user u ON u.id = a.actor_id
                    WHERE a.workspace_id = ?
                    ORDER BY a.created_at DESC, a.id DESC LIMIT ?
                    """, workspaceId, pageSize + 1);
            } else {
                events = jdbc.queryForList("""
                    SELECT a.id, a.action, a.entity_type AS entityType, a.entity_id AS entityId,
                           a.metadata, a.request_id AS requestId, a.created_at AS createdAt,
                           a.actor_id AS actorId, u.display_name AS actorName, u.email AS actorEmail
                    FROM audit_event a LEFT JOIN app_user u ON u.id = a.actor_id
                    WHERE a.workspace_id = ?
                      AND (a.created_at < ? OR (a.created_at = ? AND a.id < ?))
                    ORDER BY a.created_at DESC, a.id DESC LIMIT ?
                    """, workspaceId, anchor.get("createdAt"), anchor.get("createdAt"), anchor.get("id"), pageSize + 1);
            }
        } else {
            events = jdbc.queryForList("""
                SELECT a.id, a.action, a.entity_type AS entityType, a.entity_id AS entityId,
                       a.metadata, a.request_id AS requestId, a.created_at AS createdAt,
                       a.actor_id AS actorId, u.display_name AS actorName, u.email AS actorEmail
                FROM audit_event a LEFT JOIN app_user u ON u.id = a.actor_id
                WHERE a.workspace_id = ?
                ORDER BY a.created_at DESC, a.id DESC LIMIT ?
                """, workspaceId, pageSize + 1);
        }
        String nextCursor = null;
        if (events.size() > pageSize) {
            events = events.subList(0, pageSize);
            nextCursor = String.valueOf(events.get(pageSize - 1).get("id"));
        }
        for (Map<String, Object> event : events) {
            Object actorId = event.remove("actorId");
            Object actorName = event.remove("actorName");
            Object actorEmail = event.remove("actorEmail");
            if (actorId == null) {
                event.put("actor", null);
            } else {
                Map<String, Object> actor = new LinkedHashMap<>();
                actor.put("id", actorId);
                actor.put("name", actorName == null ? "" : actorName);
                actor.put("email", actorEmail);
                event.put("actor", actor);
            }
            String metadata = event.get("metadata") == null ? null : String.valueOf(event.get("metadata"));
            event.put("metadata", safeJson(metadata));
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("events", events);
        payload.put("nextCursor", nextCursor);
        return payload;
    }

    private Object safeJson(String value) {
        if (value == null || value.isBlank()) return null;
        try {
            return objectMapper.readValue(value, Object.class);
        } catch (Exception exception) {
            return value;
        }
    }

    private void purge(String workspaceId) {
        List<Integer> days = jdbc.queryForList("""
            SELECT audit_retention_days FROM workspace WHERE id = ?
            """, Integer.class, workspaceId);
        int retention = days.isEmpty() || days.get(0) == null
            ? 365
            : Math.max(7, Math.min(3650, days.get(0)));
        String cutoff = Instant.now().minus(retention, ChronoUnit.DAYS).toString();
        jdbc.update("DELETE FROM audit_event WHERE workspace_id = ? AND created_at < ?", workspaceId, cutoff);
    }
}
