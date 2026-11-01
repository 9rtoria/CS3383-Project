package com.project3383.app;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;

@Component
public class RetentionScheduler {

    private final JdbcTemplate jdbc;

    public RetentionScheduler(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Scheduled(fixedDelay = 6 * 60 * 60 * 1000, initialDelay = 60_000)
    public void purgeExpiredContent() {
        jdbc.update("DELETE FROM idempotency_key WHERE expires_at < ?", Instant.now().toString());
        jdbc.update("DELETE FROM magic_link_token WHERE expires_at < ? OR used_at IS NOT NULL",
            Instant.now().minus(1, ChronoUnit.DAYS).toString());
        List<Map<String, Object>> workspaces = jdbc.queryForList("""
            SELECT id, retention_days AS retentionDays, audit_retention_days AS auditRetentionDays
            FROM workspace WHERE deleted_at IS NULL
            """);
        for (Map<String, Object> workspace : workspaces) {
            int retention = workspace.get("retentionDays") instanceof Number number ? number.intValue() : 30;
            String cutoff = Instant.now().minus(retention, ChronoUnit.DAYS).toString();
            jdbc.update("""
                DELETE FROM task
                WHERE workspace_id = ? AND (deleted_at < ? OR archived_at < ?)
                """, workspace.get("id"), cutoff, cutoff);
            int auditRetention = workspace.get("auditRetentionDays") instanceof Number number
                ? number.intValue() : 365;
            jdbc.update("DELETE FROM audit_event WHERE workspace_id = ? AND created_at < ?",
                workspace.get("id"), Instant.now().minus(auditRetention, ChronoUnit.DAYS).toString());
        }
    }
}
