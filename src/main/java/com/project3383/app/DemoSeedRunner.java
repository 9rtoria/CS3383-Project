package com.project3383.app;

import org.springframework.boot.CommandLineRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Component
public class DemoSeedRunner implements CommandLineRunner {

    private static final ZoneId ZONE = ZoneId.of("Asia/Hong_Kong");
    private static final LocalDate SEED_ANCHOR = LocalDate.parse(
        System.getenv().getOrDefault("SEED_DATE", "2026-10-29"));
    private static final String DEMO_EMAIL = "demo@drift.local";
    private static final String DEMO_PASSWORD = "DriftDemo123!";

    private final JdbcTemplate jdbc;
    private final PasswordEncoder passwordEncoder;

    public DemoSeedRunner(JdbcTemplate jdbc, PasswordEncoder passwordEncoder) {
        this.jdbc = jdbc;
        this.passwordEncoder = passwordEncoder;
    }

    @Override
    public void run(String... args) {
        if (!"true".equalsIgnoreCase(System.getenv().getOrDefault("SEED_DEMO", "false"))) return;
        List<String> existing = jdbc.queryForList("SELECT id FROM app_user WHERE email = ?", String.class, DEMO_EMAIL);
        for (String userId : existing) {
            jdbc.update("DELETE FROM workspace WHERE created_by = ?", userId);
            jdbc.update("DELETE FROM app_user WHERE id = ?", userId);
        }

        String now = Instant.now().toString();
        String userId = id();
        String workspaceId = id();
        jdbc.update("""
            INSERT INTO app_user (id, email, display_name, password_hash, is_guest, timezone, created_at)
            VALUES (?, ?, 'Maya Chen', ?, 0, 'Asia/Hong_Kong', ?)
            """, userId, DEMO_EMAIL, passwordEncoder.encode(DEMO_PASSWORD), now);
        jdbc.update("""
            INSERT INTO workspace (id, name, type, created_by, created_at, public_sharing_enabled)
            VALUES (?, 'Northstar Studio', 'team', ?, ?, 1)
            """, workspaceId, userId, now);
        jdbc.update("""
            INSERT INTO membership (user_id, workspace_id, role, joined_at) VALUES (?, ?, 'OWNER', ?)
            """, userId, workspaceId, now);

        Map<String, String> labels = new LinkedHashMap<>();
        for (String[] label : List.of(
            new String[]{"Strategy", "violet"},
            new String[]{"Writing", "blue"},
            new String[]{"Web", "moss"},
            new String[]{"Research", "amber"},
            new String[]{"Ops", "slate"},
            new String[]{"Video", "rose"})) {
            String labelId = id();
            labels.put(label[0], labelId);
            jdbc.update("""
                INSERT INTO label (id, workspace_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)
                """, labelId, workspaceId, label[0], label[1], now);
        }

        // Keep the demo's board order aligned with the reference build: the
        // private personal board reads first, then the shared launch board.
        String personalBoard = createBoard(workspaceId, userId, "Personal rhythm",
            "A gentle weekly rhythm for life outside the launch.", "private", 0,
            new String[][]{
                {"This week", "7"}, {"Today", "3"}, {"Waiting", ""}, {"Done", ""}
            }, now);
        String launchBoard = createBoard(workspaceId, userId, "Launch runway",
            "Everything between the first draft and a confident launch.", "workspace", 1,
            new String[][]{
                {"Backlog", ""}, {"Next up", "5"}, {"In progress", "3"}, {"Review", "4"}, {"Done", ""}
            }, now);
        List<String> personalColumns = columns(personalBoard);
        List<String> launchColumns = columns(launchBoard);

        LocalDate today = SEED_ANCHOR;
        List<TaskSpec> launchTasks = List.of(
            new TaskSpec("Shape the launch story", "Next up",
                "One sentence for the homepage, three proof points, and the demo path. Keep the promise concrete.",
                "high", at(1, 14, 0), false, 45, null,
                null, true, List.of("Strategy", "Writing"),
                List.of("Write the one-liner", "Choose three proof points", "Read it aloud"),
                "Start from the customer's words, not our feature list."),
            new TaskSpec("Draft the announcement", "In progress",
                "Short, warm, and specific. Link the demo instead of explaining every feature.",
                "medium", at(2, 16, 0), false, 60, today.plusDays(1),
                null, true, List.of("Writing"),
                List.of("Opening paragraph", "What changed", "Call to action"), null),
            new TaskSpec("Review onboarding copy", "Review",
                "Check the first-run screen, empty states, and the guest claim path.",
                "high", at(0, 15, 0), false, 30, null,
                null, true, List.of("Writing"), List.of(), null),
            new TaskSpec("Ship the pricing page", "In progress",
                "Two plans, no fake urgency, and a clear explanation of what stays free.",
                "urgent", at(0, 18, 0), false, 120, null,
                null, false, List.of("Web", "Strategy"),
                List.of("Plan comparison", "FAQ", "Mobile pass"), null),
            new TaskSpec("Collect five customer quotes", "Backlog", "",
                "low", at(5, 17, 0), true, 40, null,
                null, true, List.of("Research"), List.of(), null),
            new TaskSpec("QA mobile quick capture", "Backlog",
                "Test keyboard, offline capture, and the bottom navigation on a small screen.",
                "medium", at(3, 17, 0), true, 35, today.plusDays(2),
                null, false, List.of("Web"), List.of(), null),
            new TaskSpec("Publish the changelog", "Done",
                "The launch notes are live.",
                "medium", null, true, null, null,
                at(-1, 11, 0).atZone(ZONE).toInstant(), true, List.of("Writing"), List.of(), null),
            new TaskSpec("Plan the launch retro", "Backlog", "",
                "none", at(7, 17, 0), true, 30, null,
                null, false, List.of("Ops"), List.of(), null),
            new TaskSpec("Record a 60-second demo", "Next up",
                "Guest start to first task, then a board move. No voiceover perfection needed.",
                "medium", at(4, 10, 0), false, 90, null,
                null, false, List.of("Video"), List.of(), null),
            new TaskSpec("Update support macros", "Backlog", "",
                "low", null, true, 25, null,
                null, true, List.of("Ops"), List.of(), null)
        );
        seedTasks(workspaceId, userId, launchBoard, launchColumns, launchTasks, labels, now);

        List<TaskSpec> personalTasks = List.of(
            new TaskSpec("Book the dentist", "Today", "",
                "medium", at(0, 17, 0), true, null, null,
                null, false, List.of(), List.of(), null),
            new TaskSpec("Long walk without headphones", "This week", "",
                "low", at(2, 17, 0), true, null, null,
                null, false, List.of(), List.of(), null),
            new TaskSpec("Reactivity audit task", "This week", "",
                "none", null, true, null, null,
                null, false, List.of(), List.of(), null),
            new TaskSpec("Renew the library card", "Waiting", "",
                "none", null, true, null, null,
                null, false, List.of(), List.of(), null),
            new TaskSpec("Call Mum", "Done", "",
                "high", null, true, null, null,
                at(-2, 19, 0).atZone(ZONE).toInstant(), false, List.of(), List.of(), null)
        );
        seedTasks(workspaceId, userId, personalBoard, personalColumns, personalTasks, labels, now);

        Map<String, Object> seededTask = jdbc.queryForMap("""
            SELECT id, board_id AS boardId, column_id AS columnId
            FROM task WHERE board_id = ? ORDER BY created_at, id LIMIT 1
            """, launchBoard);
        jdbc.update("""
            INSERT INTO audit_event (id, workspace_id, actor_id, action, entity_type,
                                     entity_id, metadata, request_id, ip_hash, created_at)
            VALUES (?, ?, ?, 'task.created', 'task', ?, ?, 'seed', NULL, ?)
            """, id(), workspaceId, userId, seededTask.get("id"),
            "{\"boardId\":\"" + seededTask.get("boardId") + "\",\"columnId\":\"" + seededTask.get("columnId") + "\"}",
            SEED_ANCHOR.atTime(21, 6).atZone(ZONE).toInstant().toString());

        jdbc.update("""
            INSERT INTO view (id, user_id, workspace_id, name, type, filters_json, is_favorite, created_at, updated_at)
            VALUES (?, ?, ?, 'High priority launch work', 'board', ?, 1, ?, ?)
            """, id(), userId, workspaceId,
            "{\"boardId\":\"" + launchBoard + "\",\"priority\":\"high\"}", now, now);

        jdbc.update("""
            INSERT INTO notification (id, user_id, workspace_id, type, title, body, link, created_at)
            VALUES (?, ?, ?, 'assignment', 'You own “Ship the pricing page”', 'Due today at 6:00 PM.', '/?view=board', ?)
            """, id(), userId, workspaceId, now);
        jdbc.update("""
            INSERT INTO notification (id, user_id, workspace_id, type, title, body, link, created_at)
            VALUES (?, ?, ?, 'mention', 'A comment needs your reply', '“Start from the customer''s words, not our feature list.”', '/?view=today', ?)
            """, id(), userId, workspaceId, now);
    }

    private void seedTasks(String workspaceId, String userId, String boardId, List<String> columns,
                           List<TaskSpec> tasks, Map<String, String> labels, String now) {
        Map<String, Integer> positions = new LinkedHashMap<>();
        for (TaskSpec task : tasks) {
            String columnId = columns.get(columnIndex(task.column(), columns));
            int position = positions.merge(columnId, 1, Integer::sum) - 1;
            String taskId = id();
            String due = task.due() == null ? null : task.due().toString();
            String updatedAt = task.completedAt() == null ? now : task.completedAt().toString();
            jdbc.update("""
                INSERT INTO task (id, workspace_id, board_id, column_id, title, description, priority,
                                  due_date, due_all_day, estimate_minutes, focus_date, position,
                                  completed_at, version, created_by, created_at, updated_at, assignee_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
                """, taskId, workspaceId, boardId, columnId, task.title(), task.description(),
                task.priority(), due, task.allDay() ? 1 : 0, task.estimate(),
                task.focus() == null ? null : task.focus().toString(), position,
                task.completedAt() == null ? null : task.completedAt().toString(),
                userId, now, updatedAt, task.assignee() ? userId : null);
            for (String label : task.labels()) {
                String labelId = labels.get(label);
                if (labelId != null) {
                    jdbc.update("INSERT OR IGNORE INTO task_label (task_id, label_id) VALUES (?, ?)",
                        taskId, labelId);
                }
            }
            for (int index = 0; index < task.subtasks().size(); index++) {
                jdbc.update("""
                    INSERT INTO subtask (id, task_id, title, completed, position, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """, id(), taskId, task.subtasks().get(index), index == 0 ? 1 : 0,
                    index, now);
            }
            if (task.comment() != null) {
                jdbc.update("""
                    INSERT INTO task_comment (id, task_id, author_id, body, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """, id(), taskId, userId, task.comment(), now);
            }
        }
    }

    private int columnIndex(String name, List<String> columns) {
        // Columns resolve by their well-known seed order rather than ids.
        return switch (name) {
            case "Backlog", "This week" -> 0;
            case "Next up", "Today" -> 1;
            case "In progress", "Waiting" -> 2;
            case "Review" -> 3;
            case "Done" -> columns.size() - 1;
            default -> 0;
        };
    }

    private String createBoard(String workspaceId, String userId, String name, String description,
                               String visibility, int position, String[][] columns, String now) {
        String boardId = id();
        jdbc.update("""
            INSERT INTO board (id, workspace_id, name, description, position, created_at, created_by, visibility)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, boardId, workspaceId, name, description, position, now, userId, visibility);
        for (int index = 0; index < columns.length; index++) {
            String limit = columns[index][1];
            // Seed WIP limits are advisory, matching the reference demo. Enforcement
            // remains available through column settings.
            jdbc.update("""
                INSERT INTO board_column (id, board_id, name, position, is_done, wip_limit, wip_enforced)
                VALUES (?, ?, ?, ?, ?, ?, 0)
                """, id(), boardId, columns[index][0], index,
                index == columns.length - 1 ? 1 : 0,
                limit == null || limit.isBlank() ? null : Integer.parseInt(limit));
        }
        return boardId;
    }

    private List<String> columns(String boardId) {
        return jdbc.queryForList("SELECT id FROM board_column WHERE board_id = ? ORDER BY position",
            String.class, boardId);
    }

    private static LocalDateTime at(int daysFromNow, int hour, int minute) {
        return SEED_ANCHOR.plusDays(daysFromNow).atTime(hour, minute);
    }

    private String id() {
        return UUID.randomUUID().toString();
    }

    private record TaskSpec(String title, String column, String description, String priority,
                            LocalDateTime due, boolean allDay, Integer estimate, LocalDate focus,
                            Instant completedAt, boolean assignee, List<String> labels,
                            List<String> subtasks, String comment) {
    }
}
