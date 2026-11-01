package com.project3383.app;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Component
public class DigestScheduler {

    private final JdbcTemplate jdbc;
    private final JobRunService jobRunService;

    public DigestScheduler(JdbcTemplate jdbc, JobRunService jobRunService) {
        this.jdbc = jdbc;
        this.jobRunService = jobRunService;
    }

    @Scheduled(fixedDelay = 60 * 60 * 1000, initialDelay = 120_000)
    public void queueDailyDigests() {
        try {
            jobRunService.run("daily-digests", this::digests);
        } catch (Exception ignored) {
            // A later hour will retry.
        }
    }

    private Map<String, Object> digests() {
        List<Map<String, Object>> users = jdbc.queryForList("""
            SELECT u.id, u.email, u.display_name AS name, u.timezone,
                   s.email_digest AS emailDigest, s.digest_hour AS digestHour,
                   s.quiet_start AS quietStart, s.quiet_end AS quietEnd
            FROM app_user u JOIN user_settings s ON s.user_id = u.id
            WHERE u.email IS NOT NULL AND u.is_guest = 0 AND u.deleted_at IS NULL
              AND s.email_digest = 1
            ORDER BY u.created_at LIMIT 500
            """);
        int queued = 0;
        for (Map<String, Object> user : users) {
            ZoneId zone;
            try {
                zone = ZoneId.of(String.valueOf(user.get("timezone")));
            } catch (Exception exception) {
                zone = ZoneId.of("UTC");
            }
            ZonedDateTime now = ZonedDateTime.now(zone);
            int digestHour = user.get("digestHour") instanceof Number number ? number.intValue() : 8;
            if (now.getHour() != digestHour) continue;
            Integer quietStart = user.get("quietStart") instanceof Number number ? number.intValue() : null;
            Integer quietEnd = user.get("quietEnd") instanceof Number number ? number.intValue() : null;
            if (quietHour(now.getHour(), quietStart, quietEnd)) continue;
            Integer already = jdbc.queryForObject("""
                SELECT COUNT(*) FROM email_message
                WHERE user_id = ? AND kind = 'digest' AND created_at >= ?
                """, Integer.class, user.get("id"),
                Instant.now().minus(20, ChronoUnit.HOURS).toString());
            if (already != null && already > 0) continue;

            String today = now.toLocalDate().toString();
            String tomorrow = now.toLocalDate().plusDays(1).toString();
            List<Map<String, Object>> tasks = jdbc.queryForList("""
                SELECT t.title, t.due_date AS dueDate, t.priority, b.name AS boardName
                FROM task t
                JOIN board b ON b.id = t.board_id AND b.deleted_at IS NULL
                JOIN board_column c ON c.id = t.column_id AND c.is_done = 0 AND c.deleted_at IS NULL
                JOIN membership m ON m.workspace_id = t.workspace_id AND m.user_id = ?
                WHERE t.deleted_at IS NULL AND t.archived_at IS NULL
                  AND (b.visibility = 'workspace' OR b.created_by = ? OR m.role IN ('OWNER', 'ADMIN'))
                  AND (t.focus_date = ? OR (t.due_date IS NOT NULL AND substr(t.due_date, 1, 10) <= ?))
                ORDER BY CASE t.priority
                    WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2
                    WHEN 'low' THEN 3 ELSE 4 END, t.due_date
                LIMIT 12
                """, user.get("id"), user.get("id"), today, tomorrow);
            if (tasks.isEmpty()) continue;

            StringBuilder body = new StringBuilder();
            body.append("Good morning, ").append(user.get("name")).append(".\n\n");
            body.append("Today\n");
            for (int index = 0; index < Math.min(6, tasks.size()); index++) {
                Map<String, Object> task = tasks.get(index);
                body.append("• ").append(task.get("title"));
                if (task.get("dueDate") != null) {
                    body.append(" — due ").append(String.valueOf(task.get("dueDate")).substring(0, 10));
                }
                body.append("\n");
            }
            if (tasks.size() > 6) {
                body.append("\nAlso on the horizon\n");
                for (int index = 6; index < tasks.size(); index++) {
                    body.append("• ").append(tasks.get(index).get("title")).append("\n");
                }
            }
            body.append("\nOpen Drift to plan the day.\n");
            jdbc.update("""
                INSERT INTO email_message (id, user_id, recipient, subject, body, kind, status,
                                           sent_at, error, created_at)
                VALUES (?, ?, ?, ?, ?, 'digest', 'queued', NULL, NULL, ?)
                """, UUID.randomUUID().toString(), user.get("id"), user.get("email"),
                "Your Drift day", body.toString(), Instant.now().toString());
            queued++;
        }
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("users", users.size());
        details.put("digestsQueued", queued);
        return details;
    }

    private boolean quietHour(int hour, Integer start, Integer end) {
        if (start == null || end == null || start.equals(end)) return false;
        return start < end ? hour >= start && hour < end : hour >= start || hour < end;
    }
}
