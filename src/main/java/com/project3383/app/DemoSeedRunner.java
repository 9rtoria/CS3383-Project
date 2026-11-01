package com.project3383.app;

import org.springframework.boot.CommandLineRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@Component
public class DemoSeedRunner implements CommandLineRunner {

    private final JdbcTemplate jdbc;
    private final PasswordEncoder passwordEncoder;

    public DemoSeedRunner(JdbcTemplate jdbc, PasswordEncoder passwordEncoder) {
        this.jdbc = jdbc;
        this.passwordEncoder = passwordEncoder;
    }

    @Override
    public void run(String... args) {
        if (!"true".equalsIgnoreCase(System.getenv().getOrDefault("SEED_DEMO", "false"))) return;
        String email = "demo@drift.local";
        List<String> existing = jdbc.queryForList("SELECT id FROM app_user WHERE email = ?", String.class, email);
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
            """, userId, email, passwordEncoder.encode("DriftDemo123!"), now);
        jdbc.update("""
            INSERT INTO workspace (id, name, type, created_by, created_at, public_sharing_enabled)
            VALUES (?, 'Studio', 'team', ?, ?, 1)
            """, workspaceId, userId, now);
        jdbc.update("""
            INSERT INTO membership (user_id, workspace_id, role, joined_at) VALUES (?, ?, 'OWNER', ?)
            """, userId, workspaceId, now);
        for (String[] label : List.of(
            new String[]{"Strategy", "moss"},
            new String[]{"Writing", "blue"},
            new String[]{"Personal", "amber"})) {
            jdbc.update("""
                INSERT INTO label (id, workspace_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)
                """, id(), workspaceId, label[0], label[1], now);
        }

        String launchBoard = createBoard(workspaceId, userId, "Studio launch",
            "A shared place to see what is moving.", now,
            List.of("Backlog", "Next up", "In progress", "Review", "Done"),
            List.of(0, 5, 3, 4, 0));
        String personalBoard = createBoard(workspaceId, userId, "Personal week",
            "A gentle weekly rhythm.", now,
            List.of("This week", "Today", "Waiting", "Done"),
            List.of(7, 3, 0, 0));
        List<String> launchColumns = columns(launchBoard);
        List<String> personalColumns = columns(personalBoard);
        seedTask(workspaceId, userId, launchBoard, launchColumns.get(1), "Shape the launch narrative",
            "Make the promise concrete and short.", "high", LocalDate.now().plusDays(1), 45, now);
        seedTask(workspaceId, userId, launchBoard, launchColumns.get(2), "Write the pricing page",
            "Three plans, one honest recommendation.", "urgent", LocalDate.now().plusDays(2), 90, now);
        seedTask(workspaceId, userId, launchBoard, launchColumns.get(3), "Review the release checklist",
            "Confirm owners, dates, and rollback notes.", "medium", LocalDate.now().plusDays(3), 30, now);
        seedTask(workspaceId, userId, launchBoard, launchColumns.get(0), "Collect customer quotes",
            null, "low", null, 60, now);
        seedTask(workspaceId, userId, launchBoard, launchColumns.get(0), "Draft the follow-up email",
            null, "none", LocalDate.now().plusDays(7), 20, now);
        seedTask(workspaceId, userId, launchBoard, launchColumns.get(4), "Set the launch room",
            "Done. Keep the notes.", "medium", LocalDate.now().minusDays(1), 25, now);
        seedTask(workspaceId, userId, personalBoard, personalColumns.get(1), "Book the dentist",
            "Morning appointment if possible.", "medium", LocalDate.now(), 10, now);
        seedTask(workspaceId, userId, personalBoard, personalColumns.get(0), "Plan the weekend walk",
            null, "low", LocalDate.now().plusDays(4), 30, now);
        seedTask(workspaceId, userId, personalBoard, personalColumns.get(2), "Wait for the repair quote",
            null, "none", null, 15, now);
        seedTask(workspaceId, userId, personalBoard, personalColumns.get(3), "Renew the library card",
            null, "low", LocalDate.now().minusDays(2), 10, now);
        linkLabel(workspaceId, "Shape the launch narrative", "Strategy");
        linkLabel(workspaceId, "Shape the launch narrative", "Writing");
        linkLabel(workspaceId, "Write the pricing page", "Writing");
        linkLabel(workspaceId, "Review the release checklist", "Writing");
        linkLabel(workspaceId, "Collect customer quotes", "Strategy");
        linkLabel(workspaceId, "Draft the follow-up email", "Writing");
        linkLabel(workspaceId, "Book the dentist", "Personal");
        linkLabel(workspaceId, "Plan the weekend walk", "Personal");
        linkLabel(workspaceId, "Renew the library card", "Personal");
    }

    private void linkLabel(String workspaceId, String title, String label) {
        jdbc.update("""
            INSERT OR IGNORE INTO task_label (task_id, label_id)
            SELECT t.id, l.id FROM task t JOIN label l ON l.workspace_id = t.workspace_id
            WHERE t.workspace_id = ? AND t.title = ? AND l.name = ?
            """, workspaceId, title, label);
    }

    private String createBoard(String workspaceId, String userId, String name, String description,
                               String now, List<String> columns, List<Integer> wipLimits) {
        String boardId = id();
        jdbc.update("""
            INSERT INTO board (id, workspace_id, name, description, position, created_at, created_by)
            VALUES (?, ?, ?, ?, 0, ?, ?)
            """, boardId, workspaceId, name, description, now, userId);
        for (int index = 0; index < columns.size(); index++) {
            Integer limit = index < wipLimits.size() ? wipLimits.get(index) : null;
            jdbc.update("""
                INSERT INTO board_column (id, board_id, name, position, is_done, wip_limit, wip_enforced)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """, id(), boardId, columns.get(index), index,
                index == columns.size() - 1 ? 1 : 0, limit == 0 ? null : limit,
                limit != null && limit > 0 ? 1 : 0);
        }
        return boardId;
    }

    private List<String> columns(String boardId) {
        return jdbc.queryForList("SELECT id FROM board_column WHERE board_id = ? ORDER BY position",
            String.class, boardId);
    }

    private void seedTask(String workspaceId, String userId, String boardId, String columnId, String title,
                          String description, String priority, LocalDate due, int estimate, String now) {
        Integer position = jdbc.queryForObject("""
            SELECT COALESCE(MAX(position), -1) + 1 FROM task WHERE column_id = ? AND deleted_at IS NULL
            """, Integer.class, columnId);
        jdbc.update("""
            INSERT INTO task (id, workspace_id, board_id, column_id, title, description, priority,
                              due_date, due_all_day, estimate_minutes, position, version, created_by,
                              created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
            """, id(), workspaceId, boardId, columnId, title, description == null ? "" : description,
            priority, due == null ? null : due.toString(), 1, estimate,
            position == null ? 0 : position, userId, now, now);
    }

    private String id() {
        return UUID.randomUUID().toString();
    }
}
