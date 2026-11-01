package com.project3383.app;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;
import java.util.Map;

@Component
public class ReminderScheduler {

    private final JdbcTemplate jdbc;
    private final NotificationService notificationService;

    public ReminderScheduler(JdbcTemplate jdbc, NotificationService notificationService) {
        this.jdbc = jdbc;
        this.notificationService = notificationService;
    }

    @Scheduled(fixedDelay = 30_000, initialDelay = 10_000)
    public void deliverDueReminders() {
        String now = Instant.now().toString();
        List<Map<String, Object>> due = jdbc.queryForList("""
            SELECT r.id, r.user_id AS userId, r.task_id AS taskId, t.title, t.workspace_id AS workspaceId,
                   t.board_id AS boardId, b.name AS boardName
            FROM reminder r
            JOIN task t ON t.id = r.task_id AND t.deleted_at IS NULL AND t.archived_at IS NULL
            JOIN board b ON b.id = t.board_id AND b.deleted_at IS NULL
            JOIN board_column c ON c.id = t.column_id AND c.is_done = 0 AND c.deleted_at IS NULL
            JOIN membership m ON m.user_id = r.user_id AND m.workspace_id = t.workspace_id
            WHERE r.sent_at IS NULL AND r.remind_at <= ?
              AND (b.visibility = 'workspace' OR b.created_by = r.user_id
                   OR m.role IN ('OWNER', 'ADMIN'))
            ORDER BY r.remind_at LIMIT 100
            """, now);
        for (Map<String, Object> reminder : due) {
            int claimed = jdbc.update("""
                UPDATE reminder SET sent_at = ? WHERE id = ? AND sent_at IS NULL
                """, now, reminder.get("id"));
            if (claimed != 1) continue;
            notificationService.notify(
                String.valueOf(reminder.get("userId")),
                String.valueOf(reminder.get("workspaceId")),
                String.valueOf(reminder.get("taskId")),
                "reminder",
                "Reminder: " + reminder.get("title"),
                "Reminder from " + reminder.get("boardName") + ".",
                "/?view=board&board=" + reminder.get("boardId") + "&task=" + reminder.get("taskId")
            );
        }
    }
}
