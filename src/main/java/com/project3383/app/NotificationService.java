package com.project3383.app;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class NotificationService {

    private final JdbcTemplate jdbc;

    public NotificationService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Map<String, Object> list(String userId) {
        List<Map<String, Object>> notifications = jdbc.queryForList("""
            SELECT id, type, title, body, link, read_at AS readAt, created_at AS createdAt
            FROM notification WHERE user_id = ? ORDER BY created_at DESC LIMIT 50
            """, userId);
        int unread = notifications.stream().filter(row -> row.get("readAt") == null).toList().size();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("notifications", notifications);
        result.put("unreadCount", unread);
        return result;
    }

    public Map<String, Object> markRead(String userId, String id) {
        jdbc.update("UPDATE notification SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL",
            Instant.now().toString(), id, userId);
        return list(userId);
    }

    public Map<String, Object> markAllRead(String userId) {
        jdbc.update("UPDATE notification SET read_at = ? WHERE user_id = ? AND read_at IS NULL",
            Instant.now().toString(), userId);
        return list(userId);
    }
}
