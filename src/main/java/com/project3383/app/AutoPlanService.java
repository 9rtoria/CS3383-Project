package com.project3383.app;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.project3383.api.ApiException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.DateTimeException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service
public class AutoPlanService {

    private static final int HORIZON_DAYS = 7;
    private static final int UNDO_TTL_SECONDS = 300;

    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;

    public AutoPlanService(JdbcTemplate jdbc, ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
    }

    public Map<String, Object> preview(String userId, String workspaceId) {
        requireMembership(userId, workspaceId);
        PlanContext context = context(userId, workspaceId);
        if (!context.autoPlanEnabled) {
            return linked(Map.of(
                "startDate", context.today,
                "horizonDays", HORIZON_DAYS,
                "weeklyCapacityMinutes", context.weeklyMinutes,
                "enabled", false,
                "options", List.of(),
                "generatedAt", Instant.now().toString()
            ));
        }
        List<Map<String, Object>> options = List.of(
            option("balanced", "Balanced", context, "balanced"),
            option("focus", "Focus first", context, "focus"),
            option("light", "Light day", context, "light")
        );
        return linked(Map.of(
            "startDate", context.today,
            "horizonDays", HORIZON_DAYS,
            "weeklyCapacityMinutes", context.weeklyMinutes,
            "enabled", true,
            "options", options,
            "generatedAt", Instant.now().toString()
        ));
    }

    @Transactional
    public Map<String, Object> apply(String userId, String workspaceId, String optionId) {
        requireMembership(userId, workspaceId);
        String selected = optionId == null ? "balanced" : optionId;
        Map<String, Object> preview = preview(userId, workspaceId);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> options = (List<Map<String, Object>>) preview.get("options");
        Map<String, Object> option = options.stream()
            .filter(entry -> selected.equals(entry.get("id")))
            .findFirst()
            .orElseThrow(() -> ApiException.badRequest("Unknown Auto-plan option."));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> blocks = (List<Map<String, Object>>) option.get("blocks");
        PlanContext context = context(userId, workspaceId);
        String start = context.today;
        String end = context.dates.get(context.dates.size() - 1);
        String now = Instant.now().toString();

        List<Map<String, Object>> previousBlocks = jdbc.queryForList("""
            SELECT id, task_id AS taskId, date, start_minute AS startMinute, minutes, source, locked
            FROM plan_block
            WHERE user_id = ? AND workspace_id = ? AND source = 'auto' AND locked = 0
              AND date BETWEEN ? AND ?
            ORDER BY date, start_minute
            """, userId, workspaceId, start, end);
        List<String> previousSelections = jdbc.queryForList("""
            SELECT task_id FROM today_selection
            WHERE user_id = ? AND workspace_id = ? AND date = ?
            ORDER BY task_id
            """, String.class, userId, workspaceId, start);
        List<Map<String, Object>> previousFocus = jdbc.queryForList("""
            SELECT id AS taskId, focus_date AS focusDate FROM task
            WHERE workspace_id = ? AND focus_date = ? AND deleted_at IS NULL
            """, workspaceId, start);

        jdbc.update("""
            DELETE FROM plan_block
            WHERE user_id = ? AND workspace_id = ? AND source = 'auto' AND locked = 0
              AND date BETWEEN ? AND ?
            """, userId, workspaceId, start, end);
        jdbc.update("""
            DELETE FROM today_selection WHERE user_id = ? AND workspace_id = ? AND date = ?
            """, userId, workspaceId, start);

        Set<String> todayTaskIds = new HashSet<>();
        for (Map<String, Object> block : blocks) {
            jdbc.update("""
                INSERT INTO plan_block (id, user_id, workspace_id, task_id, date, start_minute, minutes, source, locked, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'auto', 0, ?)
                """, UUID.randomUUID().toString(), userId, workspaceId, block.get("taskId"),
                block.get("date"), block.get("startMinute"), block.get("minutes"), now);
            if (start.equals(block.get("date"))) {
                todayTaskIds.add(String.valueOf(block.get("taskId")));
            }
        }
        for (String taskId : todayTaskIds) {
            jdbc.update("""
                INSERT OR IGNORE INTO today_selection (user_id, workspace_id, task_id, date, created_at)
                VALUES (?, ?, ?, ?, ?)
                """, userId, workspaceId, taskId, start, now);
        }

        // Keep the legacy field in sync for clients that still read Task.focusDate.
        jdbc.update("""
            UPDATE task SET focus_date = NULL, version = version + 1
            WHERE workspace_id = ? AND focus_date = ? AND deleted_at IS NULL
            """, workspaceId, start);
        for (String taskId : todayTaskIds) {
            jdbc.update("""
                UPDATE task SET focus_date = ?, version = version + 1
                WHERE id = ? AND deleted_at IS NULL
                """, start, taskId);
        }

        Map<String, Object> inverse = new LinkedHashMap<>();
        inverse.put("startDate", start);
        inverse.put("endDate", end);
        inverse.put("previousBlocks", previousBlocks);
        inverse.put("previousSelections", previousSelections);
        inverse.put("previousFocus", previousFocus);
        String undoId = UUID.randomUUID().toString();
        try {
            jdbc.update("""
                INSERT INTO undo_action (id, user_id, workspace_id, action, entity_type, entity_id, inverse_json, expires_at, created_at)
                VALUES (?, ?, ?, 'auto_plan.apply', 'workspace', ?, ?, ?, ?)
                """, undoId, userId, workspaceId, workspaceId,
                objectMapper.writeValueAsString(inverse),
                Instant.now().plusSeconds(UNDO_TTL_SECONDS).toString(), now);
        } catch (Exception exception) {
            throw new IllegalStateException("Could not create the Auto-plan undo record.", exception);
        }

        return linked(Map.of(
            "applied", blocks.size(),
            "appliedBlocks", blocks.size(),
            "optionId", selected,
            "undoId", undoId,
            "planBlocks", blocksForRange(userId, workspaceId, start, end)
        ));
    }

    @Transactional
    public Map<String, Object> undo(String userId, String undoId) {
        Map<String, Object> undo = jdbc.queryForList("""
            SELECT id, workspace_id AS workspaceId, action, inverse_json AS inverseJson, expires_at AS expiresAt
            FROM undo_action WHERE id = ? AND user_id = ?
            """, undoId, userId).stream().findFirst()
            .orElseThrow(() -> ApiException.notFound("Undo window expired. The audit trail is still available."));
        if (Instant.parse(String.valueOf(undo.get("expiresAt"))).isBefore(Instant.now())) {
            jdbc.update("DELETE FROM undo_action WHERE id = ?", undoId);
            throw ApiException.notFound("Undo window expired. The audit trail is still available.");
        }
        if (!"auto_plan.apply".equals(undo.get("action"))) {
            throw ApiException.badRequest("This action cannot be undone automatically.");
        }
        String workspaceId = String.valueOf(undo.get("workspaceId"));
        requireMembership(userId, workspaceId);
        Map<String, Object> inverse;
        try {
            inverse = objectMapper.readValue(String.valueOf(undo.get("inverseJson")), new TypeReference<>() {});
        } catch (Exception exception) {
            throw new IllegalStateException("Could not read the Auto-plan undo record.", exception);
        }
        String start = String.valueOf(inverse.getOrDefault("startDate", LocalDate.now().toString()));
        String end = String.valueOf(inverse.getOrDefault("endDate", start));
        List<Map<String, Object>> previousBlocks = mapList(inverse.get("previousBlocks"));
        List<String> previousSelections = stringList(inverse.get("previousSelections"));
        List<Map<String, Object>> previousFocus = mapList(inverse.get("previousFocus"));

        jdbc.update("""
            DELETE FROM plan_block
            WHERE user_id = ? AND workspace_id = ? AND source = 'auto' AND locked = 0
              AND date BETWEEN ? AND ?
            """, userId, workspaceId, start, end);
        for (Map<String, Object> block : previousBlocks) {
            jdbc.update("""
                INSERT INTO plan_block (id, user_id, workspace_id, task_id, date, start_minute, minutes, source, locked, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'auto', 0, ?)
                """, UUID.randomUUID().toString(), userId, workspaceId, block.get("taskId"),
                block.get("date"), block.get("startMinute"), block.get("minutes"), Instant.now().toString());
        }
        jdbc.update("""
            DELETE FROM today_selection WHERE user_id = ? AND workspace_id = ? AND date = ?
            """, userId, workspaceId, start);
        for (String taskId : previousSelections) {
            jdbc.update("""
                INSERT OR IGNORE INTO today_selection (user_id, workspace_id, task_id, date, created_at)
                VALUES (?, ?, ?, ?, ?)
                """, userId, workspaceId, taskId, start, Instant.now().toString());
        }
        jdbc.update("""
            UPDATE task SET focus_date = NULL, version = version + 1
            WHERE workspace_id = ? AND focus_date = ? AND deleted_at IS NULL
            """, workspaceId, start);
        for (Map<String, Object> focus : previousFocus) {
            if (focus.get("focusDate") == null) continue;
            jdbc.update("""
                UPDATE task SET focus_date = ?, version = version + 1
                WHERE id = ? AND deleted_at IS NULL
                """, focus.get("focusDate"), focus.get("taskId"));
        }
        jdbc.update("DELETE FROM undo_action WHERE id = ?", undoId);
        return linked(Map.of("undone", true, "action", "auto_plan.apply"));
    }

    public Map<String, Object> clear(String userId, String workspaceId) {
        requireMembership(userId, workspaceId);
        PlanContext context = context(userId, workspaceId);
        String start = context.today;
        String end = context.dates.get(context.dates.size() - 1);
        int deleted = jdbc.update("""
            DELETE FROM plan_block
            WHERE user_id = ? AND workspace_id = ? AND source = 'auto' AND locked = 0
              AND date BETWEEN ? AND ?
            """, userId, workspaceId, start, end);
        return linked(Map.of("cleared", deleted));
    }

    public List<Map<String, Object>> blocksForDate(String userId, String workspaceId, String date) {
        return jdbc.queryForList("""
            SELECT pb.id, pb.date, pb.start_minute AS startMinute, pb.minutes,
                   pb.task_id AS taskId, t.title, t.priority
            FROM plan_block pb JOIN task t ON t.id = pb.task_id
            WHERE pb.user_id = ? AND pb.workspace_id = ? AND pb.date = ?
              AND t.deleted_at IS NULL
            ORDER BY pb.start_minute
            """, userId, workspaceId, date);
    }

    private List<Map<String, Object>> blocksForRange(String userId, String workspaceId, String start, String end) {
        return jdbc.queryForList("""
            SELECT pb.id, pb.date, pb.start_minute AS startMinute, pb.minutes,
                   pb.task_id AS taskId, t.title, t.priority
            FROM plan_block pb JOIN task t ON t.id = pb.task_id
            WHERE pb.user_id = ? AND pb.workspace_id = ? AND pb.date BETWEEN ? AND ?
              AND t.deleted_at IS NULL
            ORDER BY pb.date, pb.start_minute
            """, userId, workspaceId, start, end);
    }

    private Map<String, Object> option(String id, String label, PlanContext context, String variant) {
        List<PlanTask> ordered = new ArrayList<>(context.tasks);
        ordered.sort(Comparator
            .comparingInt((PlanTask task) -> -score(task, context, variant))
            .thenComparingInt(task -> task.estimate == null ? context.defaultEstimateMinutes : task.estimate));
        Map<String, Integer> plannedByDate = new HashMap<>();
        Map<String, Integer> afterMinuteByDate = new HashMap<>();
        Map<String, MutableWeek> weeks = buildWeeks(context);
        List<Map<String, Object>> blocks = new ArrayList<>();
        List<Map<String, Object>> unscheduled = new ArrayList<>();
        List<String> warnings = new ArrayList<>();
        int needsEstimate = 0;

        for (PlanTask task : ordered) {
            if ("light".equals(variant) && !isLightCandidate(task, context)) continue;
            if (task.openDependencies > 0) {
                unscheduled.add(unscheduled(task, "Waiting on a dependency"));
                continue;
            }
            if (task.estimate == null) needsEstimate++;
            List<Integer> chunks = taskChunks(task, context);
            boolean placedAny = false;
            int placedCount = 0;
            String failedReason = "No room before the horizon";
            for (int chunk : chunks) {
                boolean placedChunk = false;
                for (String date : context.dates) {
                    if (!context.includeWeekends && isWeekend(date)) continue;
                    if (context.dismissedToday.contains(task.id) && date.equals(context.today)) continue;
                    if (task.startDate != null && date.compareTo(task.startDate) < 0) continue;
                    if (task.dueDate != null && task.dueDate.compareTo(context.today) >= 0 && date.compareTo(task.dueDate) > 0) {
                        if ("No room before the horizon".equals(failedReason)) {
                            failedReason = "Due date is before the available horizon";
                        }
                        break;
                    }
                    int dailyCap = Math.min(context.capacityMinutes,
                        Math.max(0, (context.workdayEnd - context.workdayStart) * 60));
                    int planned = plannedByDate.getOrDefault(date, 0);
                    if (planned + chunk > dailyCap) {
                        failedReason = "Daily capacity reached";
                        continue;
                    }
                    String weekKey = weekStartOf(date, context.weekStartsOn);
                    MutableWeek week = weeks.get(weekKey);
                    if (week != null && "stop".equals(context.capBehavior)
                        && week.plannedMinutes + chunk > week.capMinutes) {
                        failedReason = "Weekly capacity reached";
                        continue;
                    }
                    int dayStart = context.workdayStart * 60;
                    int dayEnd = context.workdayEnd * 60;
                    if (date.equals(context.today)) {
                        dayStart = Math.max(dayStart, roundUpToFive(context.nowMinute));
                    }
                    if (dayStart >= dayEnd) {
                        failedReason = "Workday has ended";
                        continue;
                    }
                    int after = afterMinuteByDate.getOrDefault(date, dayStart);
                    List<int[]> free = freeIntervals(dayStart, dayEnd, busyForDate(date, context));
                    int[] chosen = null;
                    int startMinute = -1;
                    for (int[] interval : free) {
                        int candidate = Math.max(interval[0], after);
                        int rounded = roundUpToFive(candidate);
                        if (rounded + chunk <= interval[1]) {
                            chosen = interval;
                            startMinute = rounded;
                            break;
                        }
                    }
                    if (chosen == null || startMinute < 0) continue;
                    blocks.add(linked(Map.of(
                        "taskId", task.id,
                        "title", task.title,
                        "priority", task.priority == null ? "none" : task.priority,
                        "date", date,
                        "startMinute", startMinute,
                        "minutes", chunk,
                        "source", "auto",
                        "locked", false
                    )));
                    afterMinuteByDate.put(date, startMinute + chunk + Math.max(0, context.restMinutes));
                    plannedByDate.put(date, planned + chunk);
                    if (week != null) week.plannedMinutes += chunk;
                    placedAny = true;
                    placedChunk = true;
                    placedCount++;
                    break;
                }
                if (!placedChunk) break;
            }
            if (!placedAny) {
                unscheduled.add(unscheduled(task, failedReason));
            } else if (placedCount < chunks.size()) {
                unscheduled.add(unscheduled(task,
                    "Only " + placedCount + " of " + chunks.size() + " sessions fit before the horizon"));
            }
        }

        List<Map<String, Object>> weekRows = new ArrayList<>();
        boolean overCap = false;
        for (Map.Entry<String, MutableWeek> entry : weeks.entrySet().stream()
            .sorted(Map.Entry.comparingByKey()).toList()) {
            MutableWeek week = entry.getValue();
            boolean over = week.plannedMinutes > week.capMinutes;
            overCap = overCap || over;
            if (over) {
                warnings.add("Week of " + entry.getKey() + " exceeds the weekly capacity by "
                    + (week.plannedMinutes - week.capMinutes) + " minutes.");
            }
            weekRows.add(linked(Map.of(
                "weekStart", entry.getKey(),
                "actualMinutes", week.actualMinutes,
                "plannedMinutes", week.plannedMinutes,
                "capMinutes", week.capMinutes,
                "over", over
            )));
        }
        int scheduledMinutes = blocks.stream().mapToInt(block -> number(block.get("minutes"))).sum();
        return linked(Map.of(
            "id", id,
            "label", label,
            "blocks", blocks,
            "unscheduled", unscheduled,
            "scheduledMinutes", scheduledMinutes,
            "weeks", weekRows,
            "warnings", warnings,
            "overCap", overCap,
            "needsEstimate", needsEstimate
        ));
    }

    private PlanContext context(String userId, String workspaceId) {
        Map<String, Object> settings = loadSettings(userId);
        ZoneId zone = timezone(userId);
        LocalDate todayDate = LocalDate.now(zone);
        String today = todayDate.toString();
        List<String> dates = new ArrayList<>();
        for (int index = 0; index < HORIZON_DAYS; index++) {
            dates.add(todayDate.plusDays(index).toString());
        }
        String rangeStart = weekStartOf(today, settingInt(settings, "week_starts_on", 1));
        String rangeEnd = dates.get(dates.size() - 1);
        List<BusyBlock> fixedBlocks = new ArrayList<>();
        for (Map<String, Object> row : jdbc.queryForList("""
            SELECT date, start_minute AS startMinute, minutes FROM plan_block
            WHERE user_id = ? AND workspace_id = ? AND date BETWEEN ? AND ?
              AND (locked = 1 OR source = 'manual')
            """, userId, workspaceId, rangeStart, rangeEnd)) {
            fixedBlocks.add(new BusyBlock(
                String.valueOf(row.get("date")),
                number(row.get("startMinute")),
                number(row.get("startMinute")) + number(row.get("minutes"))
            ));
        }
        Set<String> dismissedToday = new HashSet<>(jdbc.queryForList("""
            SELECT task_id FROM today_dismissal WHERE user_id = ? AND date = ?
            """, String.class, userId, today));
        Set<String> selectedToday = new HashSet<>(jdbc.queryForList("""
            SELECT task_id FROM today_selection WHERE user_id = ? AND workspace_id = ? AND date = ?
            """, String.class, userId, workspaceId, today));
        List<PlanTask> tasks = jdbc.queryForList("""
            SELECT t.id, t.title, t.priority, t.start_date AS startDate, t.due_date AS dueDate,
                   t.estimate_minutes AS estimateMinutes, t.actual_minutes AS actualMinutes,
                   (SELECT COUNT(*)
                    FROM task_dependency td
                    JOIN task dep ON dep.id = td.depends_on_task_id
                    JOIN board_column dc ON dc.id = dep.column_id
                    WHERE td.task_id = t.id AND dep.deleted_at IS NULL AND dc.is_done = 0) AS openDependencies
            FROM task t
            JOIN board b ON b.id = t.board_id
            JOIN board_column c ON c.id = t.column_id
            WHERE t.workspace_id = ? AND t.deleted_at IS NULL AND c.is_done = 0
              AND b.workspace_id = t.workspace_id
            """, workspaceId).stream().map(row -> new PlanTask(
            String.valueOf(row.get("id")),
            String.valueOf(row.get("title")),
            row.get("priority") == null ? "none" : String.valueOf(row.get("priority")),
            datePart(row.get("startDate")),
            datePart(row.get("dueDate")),
            row.get("estimateMinutes") == null ? null : number(row.get("estimateMinutes")),
            row.get("actualMinutes") == null ? null : number(row.get("actualMinutes")),
            number(row.get("openDependencies")),
            selectedToday.contains(String.valueOf(row.get("id")))
        )).toList();
        int workdayStart = Math.max(0, Math.min(23, settingInt(settings, "workday_start", 9)));
        int workdayEnd = Math.max(1, Math.min(24, settingInt(settings, "workday_end", 18)));
        if (workdayEnd <= workdayStart) workdayEnd = Math.min(24, workdayStart + 1);
        int lunchStart = Math.max(0, Math.min(23, settingInt(settings, "auto_plan_lunch_start", 12)));
        int lunchEnd = Math.max(1, Math.min(24, settingInt(settings, "auto_plan_lunch_end", 13)));
        if (lunchEnd <= lunchStart) lunchEnd = Math.min(24, lunchStart + 1);
        return new PlanContext(
            today,
            dates,
            zone,
            currentMinute(zone),
            Math.max(15, settingInt(settings, "capacity_minutes", 300)),
            workdayStart,
            workdayEnd,
            settingBool(settings, "auto_plan_lunch_enabled", true),
            lunchStart,
            lunchEnd,
            settingInt(settings, "auto_plan_rest_minutes", 10),
            settingInt(settings, "auto_plan_weekly_minutes", 1500),
            settingInt(settings, "auto_plan_deep_work_minutes", 90),
            settingBool(settings, "auto_plan_split_long_tasks", true),
            settingBool(settings, "auto_plan_include_weekends", false),
            settingInt(settings, "auto_plan_default_estimate_minutes", 30),
            settingString(settings, "auto_plan_cap_behavior", "stop"),
            settingInt(settings, "week_starts_on", 1),
            settingBool(settings, "auto_plan_enabled", true),
            dismissedToday,
            selectedToday,
            tasks,
            fixedBlocks
        );
    }

    private Map<String, MutableWeek> buildWeeks(PlanContext context) {
        Map<String, MutableWeek> weeks = new LinkedHashMap<>();
        for (String date : context.dates) {
            String key = weekStartOf(date, context.weekStartsOn);
            weeks.computeIfAbsent(key, ignored -> new MutableWeek(context.weeklyMinutes));
        }
        for (BusyBlock block : context.existingBlocks) {
            String key = weekStartOf(block.date, context.weekStartsOn);
            MutableWeek week = weeks.get(key);
            if (week != null) week.plannedMinutes += Math.max(0, block.end - block.start);
        }
        return weeks;
    }

    private List<int[]> busyForDate(String date, PlanContext context) {
        List<int[]> busy = new ArrayList<>();
        int start = Math.max(0, context.workdayStart * 60);
        int end = Math.min(24 * 60, context.workdayEnd * 60);
        if (context.lunchEnabled && context.lunchEnd > context.lunchStart) {
            int lunchStart = Math.max(start, context.lunchStart * 60);
            int lunchEnd = Math.min(end, context.lunchEnd * 60);
            if (lunchEnd > lunchStart) busy.add(new int[]{lunchStart, lunchEnd});
        }
        for (BusyBlock block : context.existingBlocks) {
            if (date.equals(block.date)) busy.add(new int[]{block.start, block.end});
        }
        return busy;
    }

    private List<int[]> freeIntervals(int start, int end, List<int[]> busy) {
        List<int[]> merged = new ArrayList<>();
        for (int[] interval : busy.stream()
            .filter(item -> item[1] > item[0])
            .sorted(Comparator.comparingInt(item -> item[0]))
            .toList()) {
            int[] last = merged.isEmpty() ? null : merged.get(merged.size() - 1);
            if (last == null || interval[0] > last[1]) {
                merged.add(new int[]{interval[0], interval[1]});
            } else {
                last[1] = Math.max(last[1], interval[1]);
            }
        }
        List<int[]> free = new ArrayList<>();
        int cursor = start;
        for (int[] interval : merged) {
            if (interval[1] <= cursor) continue;
            if (interval[0] >= end) break;
            if (interval[0] > cursor) free.add(new int[]{cursor, Math.min(end, interval[0])});
            cursor = Math.max(cursor, interval[1]);
            if (cursor >= end) break;
        }
        if (cursor < end) free.add(new int[]{cursor, end});
        return free;
    }

    private List<Integer> taskChunks(PlanTask task, PlanContext context) {
        int estimate = Math.max(5, task.estimate == null ? context.defaultEstimateMinutes : task.estimate);
        int duration = Math.max(5, estimate - Math.max(0, task.actual == null ? 0 : task.actual));
        int deepWork = Math.max(5, context.deepWorkMinutes);
        if (!context.splitLongTasks || duration <= deepWork) return List.of(duration);
        List<Integer> chunks = new ArrayList<>();
        int remaining = duration;
        while (remaining > 0) {
            chunks.add(Math.min(deepWork, remaining));
            remaining -= deepWork;
        }
        return chunks;
    }

    private int score(PlanTask task, PlanContext context, String variant) {
        int score = switch (task.priority) {
            case "urgent" -> 300;
            case "high" -> 220;
            case "medium" -> 110;
            case "low" -> 40;
            default -> 0;
        };
        score += dueScore(task.dueDate, context.today);
        if (context.selectedToday.contains(task.id)) score += 240;
        if (task.estimate != null && task.estimate >= 60) score += 30;
        if ("focus".equals(variant)) {
            if ("urgent".equals(task.priority) || "high".equals(task.priority)) score += 180;
            if ((task.estimate == null ? 0 : task.estimate) >= 60) score += 100;
            if (context.selectedToday.contains(task.id)) score += 100;
        }
        if ("light".equals(variant) && !isLightCandidate(task, context)) score -= 1000;
        return score;
    }

    private boolean isLightCandidate(PlanTask task, PlanContext context) {
        if (task.openDependencies > 0) return false;
        if (context.selectedToday.contains(task.id)) return true;
        if ("urgent".equals(task.priority) || "high".equals(task.priority)) return true;
        if (task.dueDate == null) return false;
        String tomorrow = LocalDate.parse(context.today).plusDays(1).toString();
        return task.dueDate.compareTo(tomorrow) <= 0;
    }

    private int dueScore(String dueDate, String today) {
        if (dueDate == null) return 0;
        if (dueDate.compareTo(today) < 0) return 900;
        if (dueDate.equals(today)) return 700;
        long days = java.time.temporal.ChronoUnit.DAYS.between(LocalDate.parse(today), LocalDate.parse(dueDate));
        if (days <= 2) return 520;
        if (days <= 7) return 260;
        return 80;
    }

    private String weekStartOf(String date, int weekStartsOn) {
        LocalDate value = LocalDate.parse(date);
        int start = weekStartsOn == 0 ? 0 : weekStartsOn == 6 ? 6 : 1;
        int weekday = value.getDayOfWeek().getValue() % 7;
        int distance = (weekday - start + 7) % 7;
        return value.minusDays(distance).toString();
    }

    private boolean isWeekend(String date) {
        int day = LocalDate.parse(date).getDayOfWeek().getValue();
        return day == 6 || day == 7;
    }

    private int roundUpToFive(int minute) {
        return ((Math.max(0, minute) + 4) / 5) * 5;
    }

    private int currentMinute(ZoneId zone) {
        ZonedDateTime now = ZonedDateTime.now(zone);
        return now.getHour() * 60 + now.getMinute();
    }

    private Map<String, Object> loadSettings(String userId) {
        return jdbc.queryForList("SELECT * FROM user_settings WHERE user_id = ?", userId)
            .stream().findFirst().orElse(Map.of());
    }

    private ZoneId timezone(String userId) {
        List<String> zones = jdbc.queryForList("""
            SELECT timezone FROM app_user WHERE id = ?
            """, String.class, userId);
        String zone = zones.isEmpty() ? null : zones.get(0);
        try {
            return zone == null || zone.isBlank() ? ZoneId.systemDefault() : ZoneId.of(zone);
        } catch (DateTimeException exception) {
            return ZoneId.systemDefault();
        }
    }

    private int settingInt(Map<String, Object> settings, String key, int fallback) {
        Object value = settings.get(key);
        if (value instanceof Number number) return number.intValue();
        try {
            return value == null ? fallback : Integer.parseInt(String.valueOf(value));
        } catch (NumberFormatException exception) {
            return fallback;
        }
    }

    private boolean settingBool(Map<String, Object> settings, String key, boolean fallback) {
        Object value = settings.get(key);
        if (value instanceof Number number) return number.intValue() != 0;
        if (value instanceof Boolean bool) return bool;
        if (value == null) return fallback;
        return "true".equalsIgnoreCase(String.valueOf(value)) || "1".equals(String.valueOf(value));
    }

    private String settingString(Map<String, Object> settings, String key, String fallback) {
        Object value = settings.get(key);
        return value == null || String.valueOf(value).isBlank() ? fallback : String.valueOf(value);
    }

    private Map<String, Object> unscheduled(PlanTask task, String reason) {
        return linked(Map.of("taskId", task.id, "title", task.title, "reason", reason));
    }

    private List<Map<String, Object>> mapList(Object value) {
        if (!(value instanceof List<?> list)) return List.of();
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Object item : list) {
            if (item instanceof Map<?, ?> map) {
                Map<String, Object> row = new LinkedHashMap<>();
                for (Map.Entry<?, ?> entry : map.entrySet()) row.put(String.valueOf(entry.getKey()), entry.getValue());
                rows.add(row);
            }
        }
        return rows;
    }

    private List<String> stringList(Object value) {
        if (!(value instanceof List<?> list)) return List.of();
        return list.stream().map(String::valueOf).toList();
    }

    private String datePart(Object value) {
        if (value == null) return null;
        String raw = String.valueOf(value);
        return raw.length() >= 10 ? raw.substring(0, 10) : raw;
    }

    private int number(Object value) {
        return value instanceof Number number ? number.intValue() : 0;
    }

    private void requireMembership(String userId, String workspaceId) {
        Integer count = jdbc.queryForObject("""
            SELECT COUNT(*) FROM membership WHERE user_id = ? AND workspace_id = ?
            """, Integer.class, userId, workspaceId);
        if (count == null || count == 0) throw ApiException.notFound("Workspace not found.");
    }

    private Map<String, Object> linked(Map<String, Object> value) {
        return new LinkedHashMap<>(value);
    }

    private record PlanTask(
        String id,
        String title,
        String priority,
        String startDate,
        String dueDate,
        Integer estimate,
        Integer actual,
        int openDependencies,
        boolean selectedToday
    ) {
    }

    private record BusyBlock(String date, int start, int end) {
    }

    private static final class MutableWeek {
        private int actualMinutes;
        private int plannedMinutes;
        private final int capMinutes;

        private MutableWeek(int capMinutes) {
            this.capMinutes = capMinutes;
        }
    }

    private record PlanContext(
        String today,
        List<String> dates,
        ZoneId zone,
        int nowMinute,
        int capacityMinutes,
        int workdayStart,
        int workdayEnd,
        boolean lunchEnabled,
        int lunchStart,
        int lunchEnd,
        int restMinutes,
        int weeklyMinutes,
        int deepWorkMinutes,
        boolean splitLongTasks,
        boolean includeWeekends,
        int defaultEstimateMinutes,
        String capBehavior,
        int weekStartsOn,
        boolean autoPlanEnabled,
        Set<String> dismissedToday,
        Set<String> selectedToday,
        List<PlanTask> tasks,
        List<BusyBlock> existingBlocks
    ) {
    }
}
