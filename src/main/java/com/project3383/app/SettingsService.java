package com.project3383.app;

import com.project3383.api.ApiException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

@Service
public class SettingsService {

    private static final Map<String, String> COLUMNS = Map.ofEntries(
        Map.entry("theme", "theme"),
        Map.entry("density", "density"),
        Map.entry("locale", "locale"),
        Map.entry("timeFormat", "time_format"),
        Map.entry("readingSize", "reading_size"),
        Map.entry("displayFont", "display_font"),
        Map.entry("accent", "accent"),
        Map.entry("motion", "motion"),
        Map.entry("startView", "start_view"),
        Map.entry("capacityMinutes", "capacity_minutes"),
        Map.entry("planBufferPercent", "plan_buffer_percent"),
        Map.entry("workdayStart", "workday_start"),
        Map.entry("workdayEnd", "workday_end"),
        Map.entry("blockBufferMinutes", "block_buffer_minutes"),
        Map.entry("focusMinutes", "focus_minutes"),
        Map.entry("focusAutoStart", "focus_auto_start"),
        Map.entry("captureCloseAfterAdd", "capture_close_after_add"),
        Map.entry("autoPlanEnabled", "auto_plan_enabled"),
        Map.entry("autoPlanMode", "auto_plan_mode"),
        Map.entry("autoPlanRestMinutes", "auto_plan_rest_minutes"),
        Map.entry("autoPlanWeeklyMinutes", "auto_plan_weekly_minutes"),
        Map.entry("autoPlanRefreshMinutes", "auto_plan_refresh_minutes"),
        Map.entry("autoPlanDeepWorkMinutes", "auto_plan_deep_work_minutes"),
        Map.entry("autoPlanSplitLongTasks", "auto_plan_split_long_tasks"),
        Map.entry("autoPlanIncludeWeekends", "auto_plan_include_weekends"),
        Map.entry("autoPlanDefaultEstimateMinutes", "auto_plan_default_estimate_minutes"),
        Map.entry("autoPlanCapBehavior", "auto_plan_cap_behavior"),
        Map.entry("autoPlanLunchEnabled", "auto_plan_lunch_enabled"),
        Map.entry("autoPlanLunchStart", "auto_plan_lunch_start"),
        Map.entry("autoPlanLunchEnd", "auto_plan_lunch_end"),
        Map.entry("autoPlanAllowStaleArchive", "auto_plan_allow_stale_archive"),
        Map.entry("autoPlanStaleDays", "auto_plan_stale_days"),
        Map.entry("emailDigest", "email_digest"),
        Map.entry("digestHour", "digest_hour"),
        Map.entry("quietStart", "quiet_start"),
        Map.entry("quietEnd", "quiet_end"),
        Map.entry("weekStartsOn", "week_starts_on"),
        Map.entry("featuresJson", "features_json"),
        Map.entry("notificationsJson", "notifications_json")
    );

    private final JdbcTemplate jdbc;

    public SettingsService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Map<String, Object> get(String userId) {
        ensure(userId);
        return new LinkedHashMap<>(jdbc.queryForMap("SELECT * FROM user_settings WHERE user_id = ?", userId));
    }

    @Transactional
    public Map<String, Object> patch(String userId, Map<String, Object> changes) {
        ensure(userId);
        if (changes == null) return get(userId);
        for (Map.Entry<String, Object> entry : changes.entrySet()) {
            String column = COLUMNS.get(entry.getKey());
            if (column == null) continue;
            if (entry.getValue() == null) {
                if ("quiet_start".equals(column) || "quiet_end".equals(column)) {
                    jdbc.update("UPDATE user_settings SET " + column + " = NULL, updated_at = ? WHERE user_id = ?",
                        Instant.now().toString(), userId);
                }
                continue;
            }
            jdbc.update("UPDATE user_settings SET " + column + " = ?, updated_at = ? WHERE user_id = ?",
                entry.getValue(), Instant.now().toString(), userId);
        }
        return get(userId);
    }

    private void ensure(String userId) {
        jdbc.update("""
            INSERT OR IGNORE INTO user_settings (user_id, updated_at) VALUES (?, ?)
            """, userId, Instant.now().toString());
    }
}
