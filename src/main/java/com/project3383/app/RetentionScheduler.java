package com.project3383.app;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Component
public class RetentionScheduler {

    private final JdbcTemplate jdbc;
    private final JobRunService jobRunService;

    public RetentionScheduler(JdbcTemplate jdbc, JobRunService jobRunService) {
        this.jdbc = jdbc;
        this.jobRunService = jobRunService;
    }

    @Scheduled(fixedDelay = 6 * 60 * 60 * 1000, initialDelay = 60_000)
    public void purgeExpiredContent() {
        try {
            jobRunService.run("housekeeping", this::housekeeping);
        } catch (Exception ignored) {
            // A later run will retry; jobs must never take the scheduler down.
        }
        try {
            jobRunService.run("retention", this::retention);
        } catch (Exception ignored) {
            // A later run will retry.
        }
    }

    private Map<String, Object> housekeeping() {
        Instant now = Instant.now();
        Instant thirtyDays = now.minus(30, ChronoUnit.DAYS);
        Instant oneDay = now.minus(1, ChronoUnit.DAYS);
        Instant ninetyDays = now.minus(90, ChronoUnit.DAYS);

        Map<String, Object> details = new LinkedHashMap<>();
        details.put("sessions", jdbc.update("""
            DELETE FROM auth_session
            WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)
            """, thirtyDays.toString(), thirtyDays.toString()));
        details.put("magicLinks", jdbc.update("""
            DELETE FROM magic_link_token WHERE expires_at < ?
            """, oneDay.toString()));
        details.put("idempotencyKeys", jdbc.update("""
            DELETE FROM idempotency_key WHERE expires_at < ?
            """, now.toString()));
        details.put("webhookDeliveries", jdbc.update("""
            DELETE FROM webhook_delivery WHERE created_at < ?
            """, thirtyDays.toString()));
        details.put("emailMessages", jdbc.update("""
            DELETE FROM email_message
            WHERE created_at < ? AND status IN ('sent', 'failed', 'preview')
            """, thirtyDays.toString()));
        details.put("clientErrors", jdbc.update("""
            DELETE FROM client_error WHERE created_at < ?
            """, ninetyDays.toString()));
        details.put("undoActions", jdbc.update("""
            DELETE FROM undo_action WHERE expires_at < ?
            """, now.toString()));
        return details;
    }

    private Map<String, Object> retention() {
        List<Map<String, Object>> workspaces = jdbc.queryForList("""
            SELECT id, retention_days AS retentionDays, audit_retention_days AS auditRetentionDays
            FROM workspace WHERE deleted_at IS NULL
            """);
        int archivedTasks = 0;
        int auditEvents = 0;
        for (Map<String, Object> workspace : workspaces) {
            int retention = workspace.get("retentionDays") instanceof Number number ? number.intValue() : 30;
            String taskCutoff = Instant.now().minus(Math.max(1, retention), ChronoUnit.DAYS).toString();
            archivedTasks += jdbc.update("""
                UPDATE task SET deleted_at = ?
                WHERE workspace_id = ? AND archived_at IS NOT NULL AND archived_at < ? AND deleted_at IS NULL
                """, Instant.now().toString(), workspace.get("id"), taskCutoff);
            int auditRetention = workspace.get("auditRetentionDays") instanceof Number number
                ? number.intValue() : 365;
            auditEvents += jdbc.update("""
                DELETE FROM audit_event WHERE workspace_id = ? AND created_at < ?
                """, workspace.get("id"),
                Instant.now().minus(Math.max(30, auditRetention), ChronoUnit.DAYS).toString());
        }
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("archivedTasksSoftDeleted", archivedTasks);
        details.put("auditEventsPurged", auditEvents);
        return details;
    }
}
