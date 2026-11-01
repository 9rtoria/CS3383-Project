package com.project3383.app;

import com.project3383.api.ApiException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
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

    private static final int WORKDAY_START = 9 * 60;
    private static final int WORKDAY_END = 18 * 60;
    private static final int LUNCH_START = 12 * 60;
    private static final int LUNCH_END = 13 * 60;
    private static final int REST_MINUTES = 10;
    private static final int DAILY_CAP = 300;
    private static final int WEEKLY_CAP = 1500;

    private final JdbcTemplate jdbc;

    public AutoPlanService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Map<String, Object> preview(String userId, String workspaceId) {
        requireMembership(userId, workspaceId);
        List<PlanTask> tasks = tasks(workspaceId);
        List<String> dates = dates();
        List<Map<String, Object>> options = List.of(
            option("balanced", "Balanced", tasks, dates, userId, workspaceId, 90, false),
            option("focus", "Focus first", tasks, dates, userId, workspaceId, 90, true),
            option("light", "Light day", tasks, dates, userId, workspaceId, 45, false)
        );
        return linked(Map.of("options", options));
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
        String start = LocalDate.now().toString();
        String end = LocalDate.now().plusDays(6).toString();
        jdbc.update("""
            DELETE FROM plan_block WHERE user_id = ? AND workspace_id = ? AND source = 'auto'
              AND date BETWEEN ? AND ?
            """, userId, workspaceId, start, end);
        for (Map<String, Object> block : blocks) {
            jdbc.update("""
                INSERT INTO plan_block (id, user_id, workspace_id, task_id, date, start_minute, minutes, source, locked, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'auto', 0, ?)
                """, UUID.randomUUID().toString(), userId, workspaceId, block.get("taskId"),
                block.get("date"), block.get("startMinute"), block.get("minutes"),
                java.time.Instant.now().toString());
            if (start.equals(block.get("date"))) {
                jdbc.update("UPDATE task SET focus_date = ? WHERE id = ?", start, block.get("taskId"));
            }
        }
        return linked(Map.of("applied", blocks.size(), "optionId", selected,
            "planBlocks", blocksForRange(userId, workspaceId, start, end)));
    }

    public Map<String, Object> clear(String userId, String workspaceId) {
        requireMembership(userId, workspaceId);
        int deleted = jdbc.update("""
            DELETE FROM plan_block WHERE user_id = ? AND workspace_id = ? AND source = 'auto' AND locked = 0
            """, userId, workspaceId);
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

    private Map<String, Object> option(
        String id,
        String label,
        List<PlanTask> tasks,
        List<String> dates,
        String userId,
        String workspaceId,
        int chunkSize,
        boolean focusOnly
    ) {
        List<PlanTask> ordered = new ArrayList<>(tasks);
        ordered.sort(Comparator
            .comparingInt((PlanTask task) -> focusOnly ? (isFocus(task) ? 0 : 1) : 0)
            .thenComparingInt(task -> priorityRank(task.priority))
            .thenComparing(task -> task.dueDate == null ? "9999-12-31" : task.dueDate)
            .thenComparing(task -> task.estimate == null ? 30 : task.estimate));
        Map<String, List<int[]>> busy = existingBusy(userId, workspaceId, dates);
        Map<String, Integer> plannedByDate = new HashMap<>();
        List<Map<String, Object>> blocks = new ArrayList<>();
        List<Map<String, Object>> unscheduled = new ArrayList<>();
        Set<String> blocked = new HashSet<>();
        for (PlanTask task : ordered) {
            if (focusOnly && !isFocus(task)) {
                unscheduled.add(unscheduled(task, "Not urgent enough for Focus first"));
                continue;
            }
            int estimate = Math.max(5, task.estimate == null ? 30 : task.estimate);
            boolean placedAny = false;
            int remaining = estimate;
            while (remaining > 0) {
                int minutes = Math.min(chunkSize, remaining);
                boolean placed = false;
                for (String date : dates) {
                    if (task.startDate != null && date.compareTo(task.startDate) < 0) continue;
                    if (task.dueDate != null && task.dueDate.compareTo(dates.get(0)) >= 0 && date.compareTo(task.dueDate) > 0) {
                        if (!placedAny) unscheduled.add(unscheduled(task, "Due date is before the available horizon"));
                        break;
                    }
                    int planned = plannedByDate.getOrDefault(date, 0);
                    if (planned + minutes > DAILY_CAP) continue;
                    int start = findSlot(date, minutes, busy.getOrDefault(date, List.of()), planned == 0 ? WORKDAY_START : WORKDAY_START);
                    if (start < 0) continue;
                    if (plannedByDate.values().stream().mapToInt(Integer::intValue).sum() + minutes > WEEKLY_CAP && dates.indexOf(date) >= 5) {
                        continue;
                    }
                    busy.computeIfAbsent(date, key -> new ArrayList<>()).add(new int[]{start, start + minutes});
                    plannedByDate.put(date, planned + minutes);
                    blocks.add(linked(Map.of(
                        "taskId", task.id,
                        "title", task.title,
                        "date", date,
                        "startMinute", start,
                        "minutes", minutes
                    )));
                    remaining -= minutes;
                    placed = true;
                    placedAny = true;
                    break;
                }
                if (!placed) break;
            }
            if (!placedAny) {
                boolean already = unscheduled.stream().anyMatch(item -> task.id.equals(item.get("taskId")));
                if (!already) unscheduled.add(unscheduled(task, "No room before the horizon"));
            }
        }
        return linked(Map.of(
            "id", id,
            "label", label,
            "blocks", blocks,
            "unscheduled", unscheduled,
            "scheduledMinutes", blocks.stream().mapToInt(block -> (Integer) block.get("minutes")).sum(),
            "weeks", List.of()
        ));
    }

    private List<PlanTask> tasks(String workspaceId) {
        return jdbc.queryForList("""
            SELECT t.id, t.title, t.priority, t.start_date AS startDate, t.due_date AS dueDate,
                   t.estimate_minutes AS estimate
            FROM task t JOIN board_column c ON c.id = t.column_id
            JOIN board b ON b.id = t.board_id
            WHERE t.workspace_id = ? AND t.deleted_at IS NULL AND c.is_done = 0
              AND b.workspace_id = t.workspace_id
            """, workspaceId).stream().map(row -> new PlanTask(
            (String) row.get("id"),
            (String) row.get("title"),
            (String) row.get("priority"),
            (String) row.get("startDate"),
            (String) row.get("dueDate"),
            number(row.get("estimate"))
        )).toList();
    }

    private List<String> dates() {
        LocalDate today = LocalDate.now();
        List<String> dates = new ArrayList<>();
        for (int i = 0; i < 7; i++) dates.add(today.plusDays(i).toString());
        return dates;
    }

    private Map<String, List<int[]>> existingBusy(String userId, String workspaceId, List<String> dates) {
        Map<String, List<int[]>> busy = new HashMap<>();
        for (Map<String, Object> row : jdbc.queryForList("""
            SELECT date, start_minute AS startMinute, minutes FROM plan_block
            WHERE user_id = ? AND workspace_id = ? AND date BETWEEN ? AND ?
            """, userId, workspaceId, dates.get(0), dates.get(dates.size() - 1))) {
            busy.computeIfAbsent((String) row.get("date"), key -> new ArrayList<>())
                .add(new int[]{number(row.get("startMinute")), number(row.get("startMinute")) + number(row.get("minutes"))});
        }
        return busy;
    }

    private int findSlot(String date, int minutes, List<int[]> busy, int cursor) {
        int start = Math.max(WORKDAY_START, cursor);
        boolean changed = true;
        while (changed) {
            changed = false;
            if (start < LUNCH_END && start + minutes > LUNCH_START) {
                start = LUNCH_END;
                changed = true;
            }
            for (int[] interval : busy) {
                if (start < interval[1] && interval[0] < start + minutes) {
                    start = interval[1] + REST_MINUTES;
                    changed = true;
                }
            }
            if (start + minutes > WORKDAY_END) return -1;
        }
        return start;
    }

    private Map<String, Object> unscheduled(PlanTask task, String reason) {
        return linked(Map.of("taskId", task.id, "title", task.title, "reason", reason));
    }

    private boolean isFocus(PlanTask task) {
        return "urgent".equals(task.priority) || "high".equals(task.priority)
            || (task.dueDate != null && task.dueDate.compareTo(LocalDate.now().plusDays(2).toString()) <= 0);
    }

    private int priorityRank(String priority) {
        return switch (priority == null ? "none" : priority) {
            case "urgent" -> 0;
            case "high" -> 1;
            case "medium" -> 2;
            case "low" -> 3;
            default -> 4;
        };
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

    private record PlanTask(String id, String title, String priority, String startDate, String dueDate, Integer estimate) {
    }
}
