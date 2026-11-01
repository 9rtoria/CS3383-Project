package com.project3383.app;

import com.project3383.api.ApiDtos;
import com.project3383.api.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service
public class AppService {

    private static final Set<String> PRIORITIES = Set.of("none", "low", "medium", "high", "urgent");
    private final JdbcTemplate jdbc;

    public AppService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional
    public Map<String, Object> createGuest() {
        String userId = id();
        String workspaceId = id();
        String boardId = id();
        String now = Instant.now().toString();
        jdbc.update("""
            INSERT INTO app_user (id, email, display_name, is_guest, timezone, created_at)
            VALUES (?, NULL, ?, 1, 'Asia/Hong_Kong', ?)
            """, userId, "Guest", now);
        jdbc.update("""
            INSERT INTO workspace (id, name, type, created_by, created_at)
            VALUES (?, ?, 'personal', ?, ?)
            """, workspaceId, "My workspace", userId, now);
        jdbc.update("""
            INSERT INTO membership (user_id, workspace_id, role, joined_at)
            VALUES (?, ?, 'OWNER', ?)
            """, userId, workspaceId, now);
        jdbc.update("""
            INSERT INTO board (id, workspace_id, name, position, created_at)
            VALUES (?, ?, 'My tasks', 0, ?)
            """, boardId, workspaceId, now);
        String[] columns = {"To do", "In progress", "Done"};
        for (int i = 0; i < columns.length; i++) {
            jdbc.update("""
                INSERT INTO board_column (id, board_id, name, position, is_done)
                VALUES (?, ?, ?, ?, ?)
                """, id(), boardId, columns[i], i, i == columns.length - 1 ? 1 : 0);
        }
        return bootstrap(userId);
    }

    public Map<String, Object> bootstrap(String userId) {
        Map<String, Object> user = user(userId);
        List<Map<String, Object>> memberships = jdbc.queryForList("""
            SELECT w.id, w.name, w.type, m.role
            FROM membership m JOIN workspace w ON w.id = m.workspace_id
            WHERE m.user_id = ?
            ORDER BY m.joined_at
            """, userId);
        List<Map<String, Object>> workspaces = new ArrayList<>();
        for (Map<String, Object> membership : memberships) {
            Map<String, Object> workspace = linked(membership);
            workspace.put("boards", boards(userId, (String) membership.get("id")));
            workspaces.add(workspace);
        }
        return linked(Map.of(
            "user", user,
            "workspaces", workspaces
        ));
    }

    public Map<String, Object> board(String userId, String boardId) {
        Map<String, Object> board = boardRow(boardId);
        requireMembership(userId, (String) board.get("workspaceId"));
        List<Map<String, Object>> columns = jdbc.queryForList("""
            SELECT id, name, position, is_done AS isDone
            FROM board_column WHERE board_id = ? ORDER BY position, name
            """, boardId);
        for (Map<String, Object> column : columns) {
            column.put("tasks", tasks(userId, boardId, (String) column.get("id")));
        }
        return linked(Map.of("board", linked(Map.of(
            "id", board.get("id"),
            "workspaceId", board.get("workspaceId"),
            "name", board.get("name"),
            "columns", columns
        ))));
    }

    public Map<String, Object> today(String userId) {
        String today = LocalDate.now().toString();
        List<Map<String, Object>> tasks = jdbc.queryForList("""
            SELECT t.id, t.workspace_id AS workspaceId, t.board_id AS boardId,
                   t.column_id AS columnId, t.title, t.description, t.priority,
                   t.due_date AS dueDate, t.estimate_minutes AS estimateMinutes,
                   t.focus_date AS focusDate, t.version, t.updated_at AS updatedAt
            FROM task t
            JOIN membership m ON m.workspace_id = t.workspace_id AND m.user_id = ?
            JOIN board b ON b.id = t.board_id
            JOIN board_column c ON c.id = t.column_id
            LEFT JOIN today_dismissal d
              ON d.task_id = t.id AND d.user_id = ? AND d.date = ?
            WHERE t.deleted_at IS NULL AND c.is_done = 0
              AND b.workspace_id = t.workspace_id AND d.task_id IS NULL
            ORDER BY CASE WHEN t.focus_date = ? THEN 0 ELSE 1 END,
                     CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1
                                     WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
                     t.due_date IS NULL, t.due_date, t.position
            LIMIT 100
            """, userId, userId, today, today);
        List<Map<String, Object>> suggestions = new ArrayList<>();
        int selectedMinutes = 0;
        for (Map<String, Object> task : tasks) {
            Map<String, Object> suggestion = linked(task);
            boolean selected = suggestion.get("focusDate") != null;
            suggestion.put("selected", selected);
            suggestion.put("accepted", selected);
            suggestion.put("reason", selected
                ? "Chosen for today"
                : suggestion.get("dueDate") != null ? "Has a due date" : "Open work");
            if (selected) selectedMinutes += number(suggestion.get("estimateMinutes"));
            suggestions.add(suggestion);
        }
        int capacity = 300;
        return linked(Map.of(
            "date", today,
            "capacity", linked(Map.of(
                "totalMinutes", capacity,
                "selectedMinutes", selectedMinutes,
                "remainingMinutes", Math.max(0, capacity - selectedMinutes),
                "percent", capacity == 0 ? 0 : Math.min(100, Math.round(selectedMinutes * 100f / capacity)),
                "overbooked", selectedMinutes > capacity
            )),
            "suggestions", suggestions
        ));
    }

    public Map<String, Object> todayAction(String userId, ApiDtos.TodayAction input) {
        if (input == null || blank(input.taskId()) || input.action() == null) {
            throw ApiException.badRequest("A task and action are required.");
        }
        Map<String, Object> task = taskRow(input.taskId());
        requireMembership(userId, (String) task.get("workspaceId"));
        String today = LocalDate.now().toString();
        if ("accept".equals(input.action())) {
            jdbc.update("""
                UPDATE task SET focus_date = ?, version = version + 1, updated_at = ?
                WHERE id = ? AND deleted_at IS NULL
                """, today, Instant.now().toString(), input.taskId());
            jdbc.update("DELETE FROM today_dismissal WHERE user_id = ? AND task_id = ? AND date = ?",
                userId, input.taskId(), today);
        } else if ("dismiss".equals(input.action())) {
            jdbc.update("""
                UPDATE task SET focus_date = NULL, version = version + 1, updated_at = ?
                WHERE id = ? AND deleted_at IS NULL
                """, Instant.now().toString(), input.taskId());
            jdbc.update("""
                INSERT OR IGNORE INTO today_dismissal (user_id, task_id, date) VALUES (?, ?, ?)
                """, userId, input.taskId(), today);
        } else {
            throw ApiException.badRequest("Unknown Today action.");
        }
        return today(userId);
    }

    public Map<String, Object> createTask(String userId, ApiDtos.TaskCreate input) {
        if (input == null || blank(input.title())) throw ApiException.badRequest("Task title is required.");
        String workspaceId = input.workspaceId();
        requireMembership(userId, workspaceId);
        Map<String, Object> column = jdbc.queryForList("""
            SELECT c.id, c.board_id AS boardId, b.workspace_id AS workspaceId
            FROM board_column c JOIN board b ON b.id = c.board_id
            WHERE c.id = ?
            """, input.columnId()).stream().findFirst()
            .orElseThrow(() -> ApiException.notFound("Column not found."));
        if (!workspaceId.equals(column.get("workspaceId")) || !input.boardId().equals(column.get("boardId"))) {
            throw ApiException.badRequest("Column does not belong to this board.");
        }
        int position = jdbc.queryForObject("""
            SELECT COALESCE(MAX(position), -1) + 1 FROM task
            WHERE board_id = ? AND column_id = ? AND deleted_at IS NULL
            """, Integer.class, input.boardId(), input.columnId());
        String taskId = id();
        String now = Instant.now().toString();
        String priority = priority(input.priority());
        jdbc.update("""
            INSERT INTO task (id, workspace_id, board_id, column_id, title, description,
                              priority, due_date, due_all_day, estimate_minutes, position,
                              version, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 1, ?, ?, ?)
            """, taskId, workspaceId, input.boardId(), input.columnId(), input.title().trim(),
            input.description() == null ? "" : input.description(), priority, input.dueDate(),
            normalizeEstimate(input.estimateMinutes()), position, userId, now, now);
        return linked(Map.of("task", task(userId, taskId)));
    }

    public Map<String, Object> updateTask(String userId, String taskId, ApiDtos.TaskUpdate input) {
        Map<String, Object> current = taskRow(taskId);
        requireMembership(userId, (String) current.get("workspaceId"));
        int version = input.version() == null ? -1 : input.version();
        if (version != ((Number) current.get("version")).intValue()) {
            throw ApiException.conflict("This task changed elsewhere.", ((Number) current.get("version")).intValue());
        }
        String title = input.title() == null ? (String) current.get("title") : input.title().trim();
        if (blank(title)) throw ApiException.badRequest("Task title is required.");
        String description = input.description() == null ? (String) current.get("description") : input.description();
        String priority = input.priority() == null ? (String) current.get("priority") : priority(input.priority());
        String dueDate = input.dueDate() == null ? (String) current.get("dueDate") : input.dueDate();
        Integer estimate = input.estimateMinutes() == null
            ? (Integer) current.get("estimateMinutes")
            : normalizeEstimate(input.estimateMinutes());
        int updated = jdbc.update("""
            UPDATE task SET title = ?, description = ?, priority = ?, due_date = ?,
                            estimate_minutes = ?, version = version + 1, updated_at = ?
            WHERE id = ? AND version = ? AND deleted_at IS NULL
            """, title, description, priority, dueDate, estimate, Instant.now().toString(), taskId, version);
        if (updated == 0) throw ApiException.conflict("This task changed elsewhere.", version + 1);
        return linked(Map.of("task", task(userId, taskId)));
    }

    public Map<String, Object> moveTask(String userId, String taskId, ApiDtos.TaskMove input) {
        Map<String, Object> current = taskRow(taskId);
        requireMembership(userId, (String) current.get("workspaceId"));
        int version = input.version() == null ? -1 : input.version();
        if (version != ((Number) current.get("version")).intValue()) {
            throw ApiException.conflict("This task changed elsewhere.", ((Number) current.get("version")).intValue());
        }
        Map<String, Object> target = jdbc.queryForList("""
            SELECT id, board_id AS boardId FROM board_column WHERE id = ?
            """, input.columnId()).stream().findFirst()
            .orElseThrow(() -> ApiException.notFound("Column not found."));
        if (!current.get("boardId").equals(target.get("boardId"))) {
            throw ApiException.badRequest("Column does not belong to this board.");
        }
        int updated = jdbc.update("""
            UPDATE task SET column_id = ?, version = version + 1, updated_at = ?
            WHERE id = ? AND version = ? AND deleted_at IS NULL
            """, input.columnId(), Instant.now().toString(), taskId, version);
        if (updated == 0) throw ApiException.conflict("This task changed elsewhere.", version + 1);
        return linked(Map.of("task", task(userId, taskId)));
    }

    public Map<String, Object> deleteTask(String userId, String taskId) {
        Map<String, Object> current = taskRow(taskId);
        requireMembership(userId, (String) current.get("workspaceId"));
        jdbc.update("""
            UPDATE task SET deleted_at = ?, version = version + 1 WHERE id = ? AND deleted_at IS NULL
            """, Instant.now().toString(), taskId);
        return Map.of("deleted", true);
    }

    private List<Map<String, Object>> boards(String userId, String workspaceId) {
        List<Map<String, Object>> boards = jdbc.queryForList("""
            SELECT b.id, b.name, b.position FROM board b
            WHERE b.workspace_id = ? ORDER BY b.position, b.created_at
            """, workspaceId);
        for (Map<String, Object> board : boards) {
            board.put("columns", jdbc.queryForList("""
                SELECT id, name, position, is_done AS isDone
                FROM board_column WHERE board_id = ? ORDER BY position, name
                """, board.get("id")));
        }
        return boards;
    }

    private List<Map<String, Object>> tasks(String userId, String boardId, String columnId) {
        return jdbc.queryForList("""
            SELECT t.id, t.workspace_id AS workspaceId, t.board_id AS boardId,
                   t.column_id AS columnId, t.title, t.description, t.priority,
                   t.due_date AS dueDate, t.estimate_minutes AS estimateMinutes,
                   t.focus_date AS focusDate, t.version, t.updated_at AS updatedAt
            FROM task t
            JOIN board b ON b.id = t.board_id
            WHERE t.board_id = ? AND t.column_id = ? AND t.deleted_at IS NULL
              AND b.workspace_id = t.workspace_id
            ORDER BY t.position, t.created_at
            """, boardId, columnId);
    }

    private Map<String, Object> user(String userId) {
        return jdbc.queryForList("""
            SELECT id, email, display_name AS name, is_guest AS isGuest, timezone
            FROM app_user WHERE id = ?
            """, userId).stream().findFirst()
            .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Session user not found."));
    }

    private Map<String, Object> boardRow(String boardId) {
        return jdbc.queryForList("""
            SELECT b.id, b.workspace_id AS workspaceId, b.name
            FROM board b JOIN workspace w ON w.id = b.workspace_id
            WHERE b.id = ?
            """, boardId).stream().findFirst()
            .orElseThrow(() -> ApiException.notFound("Board not found."));
    }

    private Map<String, Object> taskRow(String taskId) {
        return jdbc.queryForList("""
            SELECT id, workspace_id AS workspaceId, board_id AS boardId, column_id AS columnId,
                   title, description, priority, due_date AS dueDate,
                   estimate_minutes AS estimateMinutes, version
            FROM task WHERE id = ? AND deleted_at IS NULL
            """, taskId).stream().findFirst()
            .orElseThrow(() -> ApiException.notFound("Task not found."));
    }

    private Map<String, Object> task(String userId, String taskId) {
        Map<String, Object> task = taskRow(taskId);
        requireMembership(userId, (String) task.get("workspaceId"));
        return task;
    }

    private void requireMembership(String userId, String workspaceId) {
        Integer count = jdbc.queryForObject("""
            SELECT COUNT(*) FROM membership WHERE user_id = ? AND workspace_id = ?
            """, Integer.class, userId, workspaceId);
        if (count == null || count == 0) throw ApiException.notFound("Workspace not found.");
    }

    private String priority(String value) {
        return value != null && PRIORITIES.contains(value) ? value : "none";
    }

    private Integer normalizeEstimate(Integer value) {
        if (value == null) return null;
        return Math.max(5, Math.min(24 * 60, value));
    }

    private int number(Object value) {
        return value instanceof Number number ? number.intValue() : 0;
    }

    private String id() {
        return UUID.randomUUID().toString();
    }

    private boolean blank(String value) {
        return value == null || value.trim().isEmpty();
    }

    private Map<String, Object> linked(Map<String, Object> source) {
        return new LinkedHashMap<>(source);
    }
}
