package com.project3383.app;

import com.project3383.api.ApiDtos;
import com.project3383.api.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
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
    private final PasswordEncoder passwordEncoder;

    public AppService(JdbcTemplate jdbc, PasswordEncoder passwordEncoder) {
        this.jdbc = jdbc;
        this.passwordEncoder = passwordEncoder;
    }

    @Transactional
    public Map<String, Object> createGuest() {
        String userId = id();
        String now = Instant.now().toString();
        jdbc.update("""
            INSERT INTO app_user (id, email, display_name, is_guest, timezone, created_at)
            VALUES (?, NULL, ?, 1, 'Asia/Hong_Kong', ?)
            """, userId, "Guest", now);
        createStarterWorkspace(userId, "My workspace");
        return bootstrap(userId);
    }

    @Transactional
    public AuthResult signup(String currentUserId, ApiDtos.Signup input) {
        if (input == null || blank(input.email()) || blank(input.password())) {
            throw ApiException.badRequest("Email and password are required.");
        }
        String email = input.email().trim().toLowerCase();
        if (!email.contains("@") || email.length() > 254) throw ApiException.badRequest("Enter a valid email address.");
        if (input.password().length() < 8) throw ApiException.badRequest("Password must be at least 8 characters.");
        String name = blank(input.name()) ? email.substring(0, email.indexOf('@')) : input.name().trim();
        String timezone = blank(input.timezone()) ? "Asia/Hong_Kong" : input.timezone();
        String hash = passwordEncoder.encode(input.password());
        String userId;

        if (currentUserId != null) {
            Map<String, Object> current = userRow(currentUserId);
            if (!((Number) current.get("isGuest")).equals(1)) {
                throw new ApiException(HttpStatus.CONFLICT, "ALREADY_SIGNED_IN", "This session already belongs to an account.");
            }
            Map<String, Object> existing = jdbc.queryForList("SELECT id FROM app_user WHERE email = ?", email)
                .stream().findFirst().orElse(null);
            if (existing != null && !currentUserId.equals(existing.get("id"))) {
                throw new ApiException(HttpStatus.CONFLICT, "EMAIL_IN_USE", "An account already uses this email.");
            }
            jdbc.update("""
                UPDATE app_user SET email = ?, display_name = ?, password_hash = ?, is_guest = 0, timezone = ?
                WHERE id = ?
                """, email, name, hash, timezone, currentUserId);
            userId = currentUserId;
        } else {
            Map<String, Object> existing = jdbc.queryForList("SELECT id FROM app_user WHERE email = ?", email)
                .stream().findFirst().orElse(null);
            if (existing != null) {
                throw new ApiException(HttpStatus.CONFLICT, "EMAIL_IN_USE", "An account already uses this email.");
            }
            userId = id();
            jdbc.update("""
                INSERT INTO app_user (id, email, display_name, password_hash, is_guest, timezone, created_at)
                VALUES (?, ?, ?, ?, 0, ?, ?)
                """, userId, email, name, hash, timezone, Instant.now().toString());
            createStarterWorkspace(userId, name + "'s workspace");
        }
        return new AuthResult(userId, bootstrap(userId));
    }

    public AuthResult signin(ApiDtos.Signin input) {
        if (input == null || blank(input.email()) || blank(input.password())) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Email or password is incorrect.");
        }
        Map<String, Object> row = jdbc.queryForList("""
            SELECT id, password_hash AS passwordHash, is_guest AS isGuest
            FROM app_user WHERE email = ?
            """, input.email().trim().toLowerCase()).stream().findFirst()
            .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Email or password is incorrect."));
        String hash = (String) row.get("passwordHash");
        if (hash == null || !passwordEncoder.matches(input.password(), hash)) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Email or password is incorrect.");
        }
        String userId = row.get("id").toString();
        return new AuthResult(userId, bootstrap(userId));
    }

    public record AuthResult(String userId, Map<String, Object> bootstrap) {
    }

    @Transactional
    public Map<String, Object> createWorkspace(String userId, ApiDtos.WorkspaceCreate input) {
        if (input == null || blank(input.name())) throw ApiException.badRequest("Workspace name is required.");
        String type = "team".equals(input.type()) ? "team" : "personal";
        if ("personal".equals(type)) {
            Integer personal = jdbc.queryForObject("""
                SELECT COUNT(*) FROM workspace w JOIN membership m ON m.workspace_id = w.id
                WHERE m.user_id = ? AND w.type = 'personal' AND w.created_by = ?
                """, Integer.class, userId, userId);
            if (personal != null && personal > 0) throw ApiException.badRequest("You already have a personal workspace.");
        }
        createStarterWorkspace(userId, input.name().trim(), type);
        Map<String, Object> workspace = jdbc.queryForList("""
            SELECT id, name, type FROM workspace WHERE created_by = ? ORDER BY created_at DESC LIMIT 1
            """, userId).stream().findFirst().orElseThrow();
        return linked(Map.of("workspace", workspace));
    }

    public Map<String, Object> members(String userId, String workspaceId) {
        requireMembership(userId, workspaceId);
        return linked(Map.of("members", jdbc.queryForList("""
            SELECT m.user_id AS userId, m.role, m.joined_at AS joinedAt,
                   u.display_name AS name, u.email, u.is_guest AS isGuest
            FROM membership m JOIN app_user u ON u.id = m.user_id
            WHERE m.workspace_id = ? ORDER BY m.joined_at
            """, workspaceId)));
    }

    @Transactional
    public Map<String, Object> invite(String userId, String workspaceId, ApiDtos.InviteCreate input) {
        requireMinimumRole(userId, workspaceId, "ADMIN");
        if (input == null || blank(input.email()) || !input.email().contains("@")) {
            throw ApiException.badRequest("A valid invite email is required.");
        }
        String email = input.email().trim().toLowerCase();
        String role = "ADMIN".equalsIgnoreCase(input.role()) ? "ADMIN" : "MEMBER";
        String token = UUID.randomUUID().toString().replace("-", "") + UUID.randomUUID().toString().replace("-", "");
        String inviteId = id();
        String now = Instant.now().toString();
        String expiresAt = Instant.now().plus(7, ChronoUnit.DAYS).toString();
        jdbc.update("""
            INSERT INTO invite (id, workspace_id, email, role, token_hash, expires_at, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, inviteId, workspaceId, email, role, sha256(token), expiresAt, userId, now);
        return linked(Map.of(
            "invite", Map.of("id", inviteId, "email", email, "role", role, "expiresAt", expiresAt),
            "token", token
        ));
    }

    @Transactional
    public Map<String, Object> acceptInvite(String userId, String token) {
        Map<String, Object> invite = jdbc.queryForList("""
            SELECT id, workspace_id AS workspaceId, email, role, expires_at AS expiresAt, accepted_at AS acceptedAt
            FROM invite WHERE token_hash = ?
            """, sha256(token)).stream().findFirst()
            .orElseThrow(() -> ApiException.notFound("Invitation not found."));
        if (invite.get("acceptedAt") != null) throw ApiException.badRequest("Invitation already accepted.");
        if (Instant.parse((String) invite.get("expiresAt")).isBefore(Instant.now())) {
            throw ApiException.badRequest("Invitation has expired.");
        }
        Map<String, Object> user = userRow(userId);
        String email = (String) user.get("email");
        if (email == null || !email.equalsIgnoreCase((String) invite.get("email"))) {
            throw ApiException.forbidden("Sign in with the invited email address.");
        }
        jdbc.update("""
            INSERT INTO membership (user_id, workspace_id, role, joined_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, workspace_id) DO UPDATE SET role = excluded.role
            """, userId, invite.get("workspaceId"), invite.get("role"), Instant.now().toString());
        jdbc.update("UPDATE invite SET accepted_at = ? WHERE id = ?", Instant.now().toString(), invite.get("id"));
        return bootstrap(userId);
    }

    public Map<String, Object> changeRole(String userId, String workspaceId, String targetUserId, String role) {
        requireMinimumRole(userId, workspaceId, "ADMIN");
        if (!"ADMIN".equals(role) && !"MEMBER".equals(role) && !"GUEST".equals(role)) {
            throw ApiException.badRequest("Invalid member role.");
        }
        Map<String, Object> target = jdbc.queryForList("""
            SELECT role FROM membership WHERE user_id = ? AND workspace_id = ?
            """, targetUserId, workspaceId).stream().findFirst()
            .orElseThrow(() -> ApiException.notFound("Member not found."));
        if ("OWNER".equals(target.get("role"))) throw ApiException.forbidden("The workspace owner role cannot be changed here.");
        jdbc.update("UPDATE membership SET role = ? WHERE user_id = ? AND workspace_id = ?", role, targetUserId, workspaceId);
        return members(userId, workspaceId);
    }

    public Map<String, Object> removeMember(String userId, String workspaceId, String targetUserId) {
        requireMinimumRole(userId, workspaceId, "ADMIN");
        if (targetUserId.equals(userId)) throw ApiException.badRequest("You cannot remove yourself.");
        Map<String, Object> target = jdbc.queryForList("""
            SELECT role FROM membership WHERE user_id = ? AND workspace_id = ?
            """, targetUserId, workspaceId).stream().findFirst()
            .orElseThrow(() -> ApiException.notFound("Member not found."));
        if ("OWNER".equals(target.get("role"))) throw ApiException.forbidden("The workspace owner cannot be removed.");
        jdbc.update("DELETE FROM membership WHERE user_id = ? AND workspace_id = ?", targetUserId, workspaceId);
        return members(userId, workspaceId);
    }

    private void createStarterWorkspace(String userId, String workspaceName) {
        createStarterWorkspace(userId, workspaceName, "personal");
    }

    private void createStarterWorkspace(String userId, String workspaceName, String type) {
        String workspaceId = id();
        String boardId = id();
        String now = Instant.now().toString();
        jdbc.update("""
            INSERT INTO workspace (id, name, type, created_by, created_at)
            VALUES (?, ?, ?, ?, ?)
            """, workspaceId, workspaceName, type, userId, now);
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
    }

    private Map<String, Object> userRow(String userId) {
        return jdbc.queryForList("""
            SELECT id, email, display_name AS name, is_guest AS isGuest
            FROM app_user WHERE id = ?
            """, userId).stream().findFirst()
            .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Session user not found."));
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
            workspace.put("labels", jdbc.queryForList("""
                SELECT id, name, color FROM label WHERE workspace_id = ? ORDER BY name
                """, membership.get("id")));
            workspaces.add(workspace);
        }
        return linked(Map.of(
            "user", user,
            "workspaces", workspaces
        ));
    }

    @Transactional
    public Map<String, Object> createBoard(String userId, ApiDtos.BoardCreate input) {
        if (input == null || blank(input.workspaceId()) || blank(input.name())) {
            throw ApiException.badRequest("Workspace and board name are required.");
        }
        requireMembership(userId, input.workspaceId());
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM board WHERE workspace_id = ?", Integer.class, input.workspaceId());
        if (count != null && count >= 20) throw ApiException.badRequest("This workspace already has the maximum number of boards.");
        int position = jdbc.queryForObject("""
            SELECT COALESCE(MAX(position), -1) + 1 FROM board WHERE workspace_id = ?
            """, Integer.class, input.workspaceId());
        String boardId = id();
        String now = Instant.now().toString();
        jdbc.update("""
            INSERT INTO board (id, workspace_id, name, position, created_at) VALUES (?, ?, ?, ?, ?)
            """, boardId, input.workspaceId(), input.name().trim(), position, now);
        String[] columns = {"To do", "In progress", "Done"};
        for (int i = 0; i < columns.length; i++) {
            jdbc.update("""
                INSERT INTO board_column (id, board_id, name, position, is_done) VALUES (?, ?, ?, ?, ?)
                """, id(), boardId, columns[i], i, i == columns.length - 1 ? 1 : 0);
        }
        return linked(Map.of("board", boardRow(boardId)));
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
                   t.start_date AS startDate, t.due_date AS dueDate,
                   t.due_all_day AS dueAllDay, t.estimate_minutes AS estimateMinutes,
                   t.actual_minutes AS actualMinutes,
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
            suggestion.put("labels", labelsForTask((String) task.get("id")));
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
        boolean dueAllDay = input.dueAllDay() == null || input.dueAllDay();
        jdbc.update("""
            INSERT INTO task (id, workspace_id, board_id, column_id, title, description,
                              priority, start_date, due_date, due_all_day, estimate_minutes,
                              actual_minutes, position, version, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
            """, taskId, workspaceId, input.boardId(), input.columnId(), input.title().trim(),
            input.description() == null ? "" : input.description(), priority, input.startDate(),
            input.dueDate(), dueAllDay ? 1 : 0, normalizeEstimate(input.estimateMinutes()),
            normalizeActual(input.actualMinutes()), position, userId, now, now);
        replaceTaskLabels(taskId, workspaceId, input.labels());
        return linked(Map.of("task", task(userId, taskId)));
    }

    public Map<String, Object> taskDetail(String userId, String taskId) {
        Map<String, Object> task = task(userId, taskId);
        task.put("comments", jdbc.queryForList("""
            SELECT c.id, c.body, c.created_at AS createdAt, c.author_id AS authorId,
                   u.display_name AS authorName
            FROM task_comment c JOIN app_user u ON u.id = c.author_id
            WHERE c.task_id = ? ORDER BY c.created_at ASC
            """, taskId));
        task.put("subtasks", jdbc.queryForList("""
            SELECT id, title, completed, position
            FROM subtask WHERE task_id = ? ORDER BY position, created_at
            """, taskId));
        return linked(Map.of("task", task));
    }

    public Map<String, Object> addComment(String userId, String taskId, ApiDtos.CommentCreate input) {
        Map<String, Object> task = taskRow(taskId);
        requireMembership(userId, (String) task.get("workspaceId"));
        if (input == null || blank(input.body())) throw ApiException.badRequest("Comment text is required.");
        String commentId = id();
        jdbc.update("""
            INSERT INTO task_comment (id, task_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)
            """, commentId, taskId, userId, input.body().trim(), Instant.now().toString());
        return linked(Map.of("comment", jdbc.queryForList("""
            SELECT c.id, c.body, c.created_at AS createdAt, c.author_id AS authorId,
                   u.display_name AS authorName
            FROM task_comment c JOIN app_user u ON u.id = c.author_id
            WHERE c.id = ?
            """, commentId).stream().findFirst().orElseThrow()));
    }

    public Map<String, Object> addSubtask(String userId, String taskId, ApiDtos.SubtaskCreate input) {
        Map<String, Object> task = taskRow(taskId);
        requireMembership(userId, (String) task.get("workspaceId"));
        if (input == null || blank(input.title())) throw ApiException.badRequest("Checklist title is required.");
        int position = jdbc.queryForObject("""
            SELECT COALESCE(MAX(position), -1) + 1 FROM subtask WHERE task_id = ?
            """, Integer.class, taskId);
        String subtaskId = id();
        jdbc.update("""
            INSERT INTO subtask (id, task_id, title, completed, position, created_at)
            VALUES (?, ?, ?, 0, ?, ?)
            """, subtaskId, taskId, input.title().trim(), position, Instant.now().toString());
        return linked(Map.of("subtask", subtaskRow(subtaskId)));
    }

    public Map<String, Object> updateSubtask(String userId, String subtaskId, ApiDtos.SubtaskUpdate input) {
        Map<String, Object> subtask = subtaskRow(subtaskId);
        Map<String, Object> task = taskRow((String) subtask.get("taskId"));
        requireMembership(userId, (String) task.get("workspaceId"));
        String title = input == null || input.title() == null ? (String) subtask.get("title") : input.title().trim();
        if (blank(title)) throw ApiException.badRequest("Checklist title is required.");
        boolean completed = input != null && input.completed() != null
            ? input.completed() : ((Number) subtask.get("completed")).intValue() == 1;
        jdbc.update("UPDATE subtask SET title = ?, completed = ? WHERE id = ?",
            title, completed ? 1 : 0, subtaskId);
        return linked(Map.of("subtask", subtaskRow(subtaskId)));
    }

    private Map<String, Object> subtaskRow(String subtaskId) {
        return jdbc.queryForList("""
            SELECT id, task_id AS taskId, title, completed, position
            FROM subtask WHERE id = ?
            """, subtaskId).stream().findFirst()
            .orElseThrow(() -> ApiException.notFound("Checklist item not found."));
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
        String startDate = input.startDate() == null ? (String) current.get("startDate") : input.startDate();
        String dueDate = input.dueDate() == null ? (String) current.get("dueDate") : input.dueDate();
        boolean dueAllDay = input.dueAllDay() == null
            ? number(current.get("dueAllDay")) == 1
            : input.dueAllDay();
        Integer estimate = input.estimateMinutes() == null
            ? (Integer) current.get("estimateMinutes")
            : normalizeEstimate(input.estimateMinutes());
        Integer actual = input.actualMinutes() == null
            ? (Integer) current.get("actualMinutes")
            : normalizeActual(input.actualMinutes());
        int updated = jdbc.update("""
            UPDATE task SET title = ?, description = ?, priority = ?, start_date = ?,
                            due_date = ?, due_all_day = ?, estimate_minutes = ?,
                            actual_minutes = ?, version = version + 1, updated_at = ?
            WHERE id = ? AND version = ? AND deleted_at IS NULL
            """, title, description, priority, startDate, dueDate, dueAllDay ? 1 : 0,
            estimate, actual, Instant.now().toString(), taskId, version);
        if (updated == 0) throw ApiException.conflict("This task changed elsewhere.", version + 1);
        if (input.labels() != null) replaceTaskLabels(taskId, (String) current.get("workspaceId"), input.labels());
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
        List<Map<String, Object>> tasks = jdbc.queryForList("""
            SELECT t.id, t.workspace_id AS workspaceId, t.board_id AS boardId,
                   t.column_id AS columnId, t.title, t.description, t.priority,
                   t.start_date AS startDate, t.due_date AS dueDate,
                   t.due_all_day AS dueAllDay, t.estimate_minutes AS estimateMinutes,
                   t.actual_minutes AS actualMinutes,
                   t.focus_date AS focusDate, t.version, t.updated_at AS updatedAt
            FROM task t
            JOIN board b ON b.id = t.board_id
            WHERE t.board_id = ? AND t.column_id = ? AND t.deleted_at IS NULL
              AND b.workspace_id = t.workspace_id
            ORDER BY t.position, t.created_at
            """, boardId, columnId);
        for (Map<String, Object> task : tasks) {
            task.put("labels", labelsForTask((String) task.get("id")));
        }
        return tasks;
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
                   title, description, priority, start_date AS startDate, due_date AS dueDate,
                   due_all_day AS dueAllDay, estimate_minutes AS estimateMinutes,
                   actual_minutes AS actualMinutes, version
            FROM task WHERE id = ? AND deleted_at IS NULL
            """, taskId).stream().findFirst()
            .orElseThrow(() -> ApiException.notFound("Task not found."));
    }

    private Map<String, Object> task(String userId, String taskId) {
        Map<String, Object> task = taskRow(taskId);
        requireMembership(userId, (String) task.get("workspaceId"));
        task.put("labels", labelsForTask(taskId));
        return task;
    }

    private List<Map<String, Object>> labelsForTask(String taskId) {
        return jdbc.queryForList("""
            SELECT l.id, l.name, l.color
            FROM task_label tl JOIN label l ON l.id = tl.label_id
            WHERE tl.task_id = ? ORDER BY l.name
            """, taskId);
    }

    private void replaceTaskLabels(String taskId, String workspaceId, List<String> names) {
        jdbc.update("DELETE FROM task_label WHERE task_id = ?", taskId);
        if (names == null) return;
        for (String name : names.stream().map(value -> value == null ? "" : value.trim())
            .filter(value -> !value.isEmpty()).distinct().limit(8).toList()) {
            String labelId = upsertLabel(workspaceId, name);
            jdbc.update("INSERT OR IGNORE INTO task_label (task_id, label_id) VALUES (?, ?)", taskId, labelId);
        }
    }

    private String upsertLabel(String workspaceId, String name) {
        return jdbc.queryForList("SELECT id FROM label WHERE workspace_id = ? AND name = ?", workspaceId, name)
            .stream().findFirst().map(row -> row.get("id").toString()).orElseGet(() -> {
                String labelId = id();
                String[] colors = {"moss", "blue", "amber", "rose", "violet", "slate"};
                String color = colors[Math.floorMod(name.hashCode(), colors.length)];
                jdbc.update("""
                    INSERT INTO label (id, workspace_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)
                    """, labelId, workspaceId, name, color, Instant.now().toString());
                return labelId;
            });
    }

    private void requireMembership(String userId, String workspaceId) {
        Integer count = jdbc.queryForObject("""
            SELECT COUNT(*) FROM membership WHERE user_id = ? AND workspace_id = ?
            """, Integer.class, userId, workspaceId);
        if (count == null || count == 0) throw ApiException.notFound("Workspace not found.");
    }

    private void requireMinimumRole(String userId, String workspaceId, String minimum) {
        String role = jdbc.queryForList("""
            SELECT role FROM membership WHERE user_id = ? AND workspace_id = ?
            """, userId, workspaceId).stream().findFirst()
            .map(row -> row.get("role").toString())
            .orElseThrow(() -> ApiException.notFound("Workspace not found."));
        if (roleRank(role) < roleRank(minimum)) throw ApiException.forbidden("You do not have permission for this action.");
    }

    private int roleRank(String role) {
        return switch (role) {
            case "OWNER" -> 4;
            case "ADMIN" -> 3;
            case "MEMBER" -> 2;
            case "GUEST" -> 1;
            default -> 0;
        };
    }

    private String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder out = new StringBuilder();
            for (byte b : digest) out.append(String.format("%02x", b));
            return out.toString();
        } catch (Exception exception) {
            throw new IllegalStateException("SHA-256 unavailable", exception);
        }
    }

    private String priority(String value) {
        return value != null && PRIORITIES.contains(value) ? value : "none";
    }

    private Integer normalizeEstimate(Integer value) {
        if (value == null) return null;
        return Math.max(5, Math.min(24 * 60, value));
    }

    private Integer normalizeActual(Integer value) {
        if (value == null) return null;
        return Math.max(0, Math.min(24 * 60, value));
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
