package com.project3383.app;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Component
public class ReminderScheduler {

    private final JdbcTemplate jdbc;

    public ReminderScheduler(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Scheduled(fixedDelay = 30_000, initialDelay = 10_000)
    public void deliverDueReminders() {
        String now = Instant.now().toString();
        List<Map<String, Object>> due = jdbc.queryForList("""
            SELECT r.id, r.user_id AS userId, r.task_id AS taskId, t.title, t.workspace_id AS workspaceId
            FROM reminder r
            JOIN task t ON t.id = r.task_id AND t.deleted_at IS NULL
            JOIN membership m ON m.user_id = r.user_id AND m.workspace_id = t.workspace_id
            WHERE r.sent_at IS NULL AND r.remind_at <= ?
            ORDER BY r.remind_at LIMIT 100
            """, now);
        for (Map<String, Object> reminder : due) {
            int claimed = jdbc.update("""
                UPDATE reminder SET sent_at = ? WHERE id = ? AND sent_at IS NULL
                """, now, reminder.get("id"));
            if (claimed != 1) continue;
            jdbc.update("""
                INSERT INTO notification (id, user_id, workspace_id, task_id, type, title, body, link, created_at)
                VALUES (?, ?, ?, ?, 'reminder', ?, ?, ?, ?)
                """, UUID.randomUUID().toString(), reminder.get("userId"), reminder.get("workspaceId"),
                reminder.get("taskId"), "Reminder: " + reminder.get("title"),
                "Your task reminder is due.", "/", now);
        }
    }
}
