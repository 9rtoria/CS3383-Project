package com.project3383.app;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class NotificationService {

    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;

    public NotificationService(JdbcTemplate jdbc, ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
    }

    public Map<String, Object> notify(String userId, String workspaceId, String taskId, String type,
                                      String title, String body, String link) {
        if (userId == null || title == null || title.isBlank()) return null;
        if (workspaceId != null && !workspaceId.isBlank()) {
            Integer membership = jdbc.queryForObject("""
                SELECT COUNT(*) FROM membership WHERE workspace_id = ? AND user_id = ?
                """, Integer.class, workspaceId, userId);
            if (membership == null || membership == 0) return null;
        }
        Map<String, Object> preferences = new LinkedHashMap<>();
        preferences.put("inApp", true);
        preferences.put("email", true);
        preferences.put("mentions", true);
        List<Map<String, Object>> settings = jdbc.queryForList("""
            SELECT notifications_json AS notificationsJson FROM user_settings WHERE user_id = ?
            """, userId);
        if (!settings.isEmpty() && settings.get(0).get("notificationsJson") != null) {
            try {
                Map<String, Object> parsed = objectMapper.readValue(
                    String.valueOf(settings.get(0).get("notificationsJson")), new TypeReference<>() {});
                preferences.putAll(parsed);
            } catch (Exception ignored) {
                // Invalid legacy JSON falls back to safe defaults.
            }
        }
        String normalized = type == null ? "" : type;
        if ((normalized.contains("mention") || normalized.contains("assign"))
            && Boolean.FALSE.equals(preferences.get("mentions"))) {
            return null;
        }
        if (Boolean.FALSE.equals(preferences.get("inApp"))) return null;
        String notificationId = UUID.randomUUID().toString();
        jdbc.update("""
            INSERT INTO notification (id, user_id, workspace_id, task_id, type, title, body, link, read_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
            """, notificationId, userId, workspaceId, taskId, normalized, title,
            body == null ? "" : body, link, Instant.now().toString());
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", notificationId);
        result.put("userId", userId);
        result.put("type", normalized);
        result.put("title", title);
        return result;
    }

    public Map<String, Object> list(String userId) {
        List<Map<String, Object>> notifications = jdbc.queryForList("""
            SELECT id, type, title, body, link, read_at AS readAt, created_at AS createdAt
            FROM notification
            WHERE user_id = ?
              AND (workspace_id IS NULL OR workspace_id IN (
                SELECT workspace_id FROM membership WHERE user_id = ?
              ))
            ORDER BY created_at DESC LIMIT 50
            """, userId, userId);
        int unread = notifications.stream().filter(row -> row.get("readAt") == null).toList().size();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("notifications", notifications);
        result.put("unreadCount", unread);
        return result;
    }

    public Map<String, Object> markRead(String userId, String id) {
        jdbc.update("""
            UPDATE notification SET read_at = ?
            WHERE id = ? AND user_id = ? AND read_at IS NULL
              AND (workspace_id IS NULL OR workspace_id IN (
                SELECT workspace_id FROM membership WHERE user_id = ?
              ))
            """, Instant.now().toString(), id, userId, userId);
        return list(userId);
    }

    public Map<String, Object> markAllRead(String userId) {
        jdbc.update("""
            UPDATE notification SET read_at = ?
            WHERE user_id = ? AND read_at IS NULL
              AND (workspace_id IS NULL OR workspace_id IN (
                SELECT workspace_id FROM membership WHERE user_id = ?
              ))
            """, Instant.now().toString(), userId, userId);
        return list(userId);
    }

    public Map<String, Object> mark(String userId, Boolean all, Boolean read, String id) {
        if (!Boolean.TRUE.equals(read)) return linked(Map.of("updated", 0));
        int updated;
        if (Boolean.TRUE.equals(all)) {
            updated = jdbc.update("""
                UPDATE notification SET read_at = ?
                WHERE user_id = ? AND read_at IS NULL
                  AND (workspace_id IS NULL OR workspace_id IN (
                    SELECT workspace_id FROM membership WHERE user_id = ?
                  ))
                """, Instant.now().toString(), userId, userId);
        } else {
            if (id == null || id.isBlank()) return linked(Map.of("updated", 0));
            updated = jdbc.update("""
                UPDATE notification SET read_at = ?
                WHERE id = ? AND user_id = ? AND read_at IS NULL
                  AND (workspace_id IS NULL OR workspace_id IN (
                    SELECT workspace_id FROM membership WHERE user_id = ?
                  ))
                """, Instant.now().toString(), id, userId, userId);
        }
        Map<String, Object> result = list(userId);
        result.put("updated", updated);
        return result;
    }

    private Map<String, Object> linked(Map<String, Object> source) {
        return new LinkedHashMap<>(source);
    }
}
