package com.project3383.app;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.project3383.api.ApiDtos;
import com.project3383.api.ApiException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service
public class DataService {

    private static final Set<String> PRIORITIES = Set.of("none", "low", "medium", "high", "urgent");
    private static final DateTimeFormatter LOCAL_DATE_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss");
    private static final int MAX_IMPORT_TASKS = 1000;

    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;
    private final AuditService auditService;

    public DataService(JdbcTemplate jdbc, ObjectMapper objectMapper, AuditService auditService) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
        this.auditService = auditService;
    }

    public ExportFile export(String userId, String workspaceId, String format) {
        String role = roleFor(userId, workspaceId);
        Map<String, Object> workspace = jdbc.queryForList("""
            SELECT id, name, type FROM workspace WHERE id = ? AND deleted_at IS NULL
            """, workspaceId).stream().findFirst()
            .orElseThrow(() -> ApiException.notFound("Workspace not found."));
        boolean canSeePrivate = rank(role) >= rank("ADMIN");
        List<Map<String, Object>> boardRows = jdbc.queryForList("""
            SELECT id, name, description, visibility, archived_at AS archivedAt,
                   created_by AS createdById, created_at AS createdAt
            FROM board WHERE workspace_id = ? AND deleted_at IS NULL
            ORDER BY created_at ASC, id ASC
            """, workspaceId);
        List<Map<String, Object>> boards = new ArrayList<>();
        for (Map<String, Object> board : boardRows) {
            String visibility = String.valueOf(board.get("visibility"));
            if ("private".equals(visibility) && !canSeePrivate && !userId.equals(board.get("createdById"))) {
                continue;
            }
            boards.add(exportBoard(String.valueOf(board.get("id")), board));
        }
        String csv = "csv".equalsIgnoreCase(format) ? "csv" : "json";
        auditService.record(workspaceId, userId, "workspace.exported", "workspace", workspaceId,
            mapOf("format", csv, "boards", boards.size()));
        if ("csv".equals(csv)) {
            return csvExport(boards);
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("exportedAt", Instant.now().toString());
        payload.put("schemaVersion", 1);
        Map<String, Object> workspaceInfo = new LinkedHashMap<>();
        workspaceInfo.put("id", workspace.get("id"));
        workspaceInfo.put("name", workspace.get("name"));
        workspaceInfo.put("type", workspace.get("type"));
        payload.put("workspace", workspaceInfo);
        payload.put("boards", boards);
        try {
            byte[] body = objectMapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(payload);
            return new ExportFile(body, "application/json", "drift-" + LocalDate.now() + ".json");
        } catch (Exception exception) {
            throw new IllegalStateException("Could not build the export.", exception);
        }
    }

    public Map<String, Object> importData(String userId, ApiDtos.ImportRequest input) {
        if (input == null || input.workspaceId() == null || input.boardId() == null) {
            throw ApiException.badRequest("Choose a workspace and a board.");
        }
        String role = roleFor(userId, input.workspaceId());
        if (rank(role) < rank("MEMBER")) {
            throw ApiException.forbidden("You do not have permission to import tasks.");
        }
        String format = "json".equalsIgnoreCase(input.format()) ? "json" : "csv";
        String content = input.content() == null ? "" : input.content();
        if (content.isBlank()) throw ApiException.badRequest("Choose a CSV or JSON file to import.");
        if (content.length() > 5_000_000) throw ApiException.badRequest("Import files are limited to 5 MB.");
        Map<String, Object> board = jdbc.queryForList("""
            SELECT id, workspace_id AS workspaceId, visibility, created_by AS createdById
            FROM board WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
            """, input.boardId(), input.workspaceId()).stream().findFirst()
            .orElseThrow(() -> ApiException.notFound("Board not found."));
        if ("private".equals(String.valueOf(board.get("visibility")))
            && rank(role) < rank("ADMIN") && !userId.equals(board.get("createdById"))) {
            throw ApiException.notFound("Board not found.");
        }
        List<Map<String, Object>> columns = jdbc.queryForList("""
            SELECT id, name, position, is_done AS isDone FROM board_column
            WHERE board_id = ? ORDER BY position ASC, name ASC
            """, input.boardId());
        if (columns.isEmpty()) throw ApiException.badRequest("That board has no columns.");

        List<Map<String, Object>> candidates;
        if ("json".equals(format)) {
            candidates = jsonTasks(content);
        } else {
            candidates = new ArrayList<>(csvTasks(content));
        }
        if (candidates.isEmpty()) throw ApiException.badRequest("No tasks were found in that file.");
        if (candidates.size() > MAX_IMPORT_TASKS) {
            throw ApiException.badRequest("Import at most 1,000 tasks at a time.");
        }
        int imported = 0;
        int skipped = 0;
        for (Map<String, Object> candidate : candidates) {
            String title = stringValue(candidate.get("title"));
            title = title == null ? "" : title.trim();
            if (title.isEmpty()) {
                skipped++;
                continue;
            }
            if (title.length() > 500) title = title.substring(0, 500);
            Map<String, Object> column = chooseColumn(columns, candidate);
            String labelValue = stringValue(candidate.get("completedAt"));
            if (stringValue(candidate.get("columnId")) == null
                && stringValue(candidate.get("column")) == null
                && labelValue != null && !labelValue.isBlank()) {
                column = columns.stream().filter(item -> number(item.get("isDone")) == 1)
                    .findFirst().orElse(column);
            }
            String priority = stringValue(candidate.get("priority"));
            priority = priority == null ? "none" : priority.trim().toLowerCase();
            if (!PRIORITIES.contains(priority)) priority = "none";
            String description = stringValue(candidate.get("description"));
            if (description == null) description = "";
            if (description.length() > 50_000) description = description.substring(0, 50_000);
            DueValue due = parseDue(candidate.get("dueDate"));
            Integer estimate = parseEstimate(candidate.get("estimateMinutes"));
            String assigneeId = resolveAssignee(input.workspaceId(), stringValue(candidate.get("assignee")));
            Integer lastPosition = jdbc.queryForObject("""
                SELECT COALESCE(MAX(position), -1) FROM task WHERE column_id = ? AND deleted_at IS NULL
                """, Integer.class, column.get("id"));
            int position = (lastPosition == null ? -1 : lastPosition) + 1;
            String taskId = UUID.randomUUID().toString();
            String now = Instant.now().toString();
            try {
                jdbc.update("""
                    INSERT INTO task (id, workspace_id, board_id, column_id, title, description, priority,
                                      start_date, due_date, due_all_day, estimate_minutes, actual_minutes,
                                      assignee_id, recurrence_rule, recurrence_ends_at, position,
                                      version, created_by, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, NULL, NULL, ?, 1, ?, ?, ?)
                    """, taskId, input.workspaceId(), input.boardId(), column.get("id"), title,
                    description, priority, due == null ? null : due.value(), due == null || due.allDay() ? 1 : 0,
                    estimate, assigneeId, position, userId, now, now);
            } catch (Exception exception) {
                throw ApiException.conflict("Import stopped because a task could not be written.", imported + 1);
            }
            List<String> labels = importLabels(candidate.get("labels"));
            for (String labelName : labels) {
                String labelId = jdbc.queryForList("""
                    SELECT id FROM label WHERE workspace_id = ? AND name = ?
                    """, String.class, input.workspaceId(), labelName).stream().findFirst().orElse(null);
                if (labelId == null) {
                    labelId = UUID.randomUUID().toString();
                    jdbc.update("""
                        INSERT INTO label (id, workspace_id, name, color, created_at)
                        VALUES (?, ?, ?, 'slate', ?)
                        """, labelId, input.workspaceId(), labelName, now);
                }
                jdbc.update("INSERT OR IGNORE INTO task_label (task_id, label_id) VALUES (?, ?)", taskId, labelId);
            }
            imported++;
        }
        auditService.record(input.workspaceId(), userId, "workspace.imported", "board", input.boardId(),
            mapOf("format", format, "imported", imported, "skipped", skipped));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("imported", imported);
        result.put("skipped", skipped);
        return result;
    }

    private Map<String, Object> exportBoard(String boardId, Map<String, Object> board) {
        List<Map<String, Object>> columns = jdbc.queryForList("""
            SELECT id, name, position, is_done AS isDone FROM board_column
            WHERE board_id = ? ORDER BY position ASC, name ASC
            """, boardId);
        List<Map<String, Object>> taskRows = jdbc.queryForList("""
            SELECT t.id, t.column_id AS columnId, t.title, t.description, t.priority,
                   t.start_date AS startDate, t.due_date AS dueDate, t.due_all_day AS dueAllDay,
                   t.estimate_minutes AS estimateMinutes, t.actual_minutes AS actualMinutes,
                   t.archived_at AS archivedAt, t.recurrence_rule AS recurrenceRule,
                   t.recurrence_ends_at AS recurrenceEndsAt, t.position,
                   t.created_at AS createdAt, t.updated_at AS updatedAt,
                   c.is_done AS completed,
                   t.assignee_id AS assigneeId, u.display_name AS assigneeName, u.email AS assigneeEmail
            FROM task t
            JOIN board_column c ON c.id = t.column_id
            LEFT JOIN app_user u ON u.id = t.assignee_id
            WHERE t.board_id = ? AND t.deleted_at IS NULL
            ORDER BY t.position ASC, t.id ASC
            """, boardId);
        List<Map<String, Object>> tasks = new ArrayList<>();
        for (Map<String, Object> row : taskRows) {
            Map<String, Object> task = new LinkedHashMap<>();
            task.put("id", row.get("id"));
            task.put("columnId", row.get("columnId"));
            task.put("title", row.get("title"));
            task.put("description", row.get("description"));
            task.put("priority", row.get("priority"));
            task.put("startDate", row.get("startDate"));
            task.put("dueDate", row.get("dueDate"));
            task.put("dueAllDay", number(row.get("dueAllDay")) == 1);
            task.put("estimateMinutes", row.get("estimateMinutes"));
            task.put("actualMinutes", row.get("actualMinutes"));
            task.put("completedAt", number(row.get("completed")) == 1 ? row.get("updatedAt") : null);
            task.put("archivedAt", row.get("archivedAt"));
            task.put("recurrenceRule", row.get("recurrenceRule"));
            task.put("recurrenceEndsAt", row.get("recurrenceEndsAt"));
            Object assigneeId = row.get("assigneeId");
            if (assigneeId == null) {
                task.put("assignee", null);
            } else {
                Map<String, Object> assignee = new LinkedHashMap<>();
                assignee.put("name", row.get("assigneeName"));
                assignee.put("email", row.get("assigneeEmail"));
                task.put("assignee", assignee);
            }
            task.put("labels", jdbc.queryForList("""
                SELECT l.name FROM task_label tl JOIN label l ON l.id = tl.label_id
                WHERE tl.task_id = ? ORDER BY l.name
                """, String.class, row.get("id")));
            task.put("subtasks", jdbc.queryForList("""
                SELECT title, completed FROM subtask WHERE task_id = ? ORDER BY position ASC, created_at ASC
                """, row.get("id")));
            task.put("comments", jdbc.queryForList("""
                SELECT c.body, c.created_at AS createdAt, u.display_name AS author
                FROM task_comment c LEFT JOIN app_user u ON u.id = c.author_id
                WHERE c.task_id = ? ORDER BY c.created_at ASC
                """, row.get("id")));
            task.put("createdAt", row.get("createdAt"));
            task.put("updatedAt", row.get("updatedAt"));
            tasks.add(task);
        }
        Map<String, Object> exported = new LinkedHashMap<>();
        exported.put("id", board.get("id"));
        exported.put("name", board.get("name"));
        exported.put("description", board.get("description"));
        exported.put("visibility", board.get("visibility"));
        exported.put("archivedAt", board.get("archivedAt"));
        List<Map<String, Object>> exportedColumns = new ArrayList<>();
        for (Map<String, Object> column : columns) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", column.get("id"));
            item.put("name", column.get("name"));
            item.put("position", column.get("position"));
            item.put("isDone", number(column.get("isDone")) == 1);
            item.put("wipLimit", null);
            exportedColumns.add(item);
        }
        exported.put("columns", exportedColumns);
        exported.put("tasks", tasks);
        return exported;
    }

    private ExportFile csvExport(List<Map<String, Object>> boards) {
        List<String> header = List.of("board", "column", "title", "description", "priority", "dueDate",
            "completedAt", "assignee", "labels", "estimateMinutes", "actualMinutes", "archivedAt", "createdAt");
        StringBuilder body = new StringBuilder("\uFEFF").append(String.join(",", header)).append("\r\n");
        boolean firstRow = true;
        for (Map<String, Object> board : boards) {
            List<Map<String, Object>> columns = mapList(board.get("columns"));
            Map<String, String> columnNames = new LinkedHashMap<>();
            for (Map<String, Object> column : columns) {
                columnNames.put(String.valueOf(column.get("id")), String.valueOf(column.get("name")));
            }
            for (Map<String, Object> task : mapList(board.get("tasks"))) {
                Object assignee = task.get("assignee");
                String assigneeValue = "";
                if (assignee instanceof Map<?, ?> map) {
                    Object email = map.get("email");
                    Object name = map.get("name");
                    assigneeValue = email == null ? (name == null ? "" : String.valueOf(name)) : String.valueOf(email);
                }
                List<String> labels = new ArrayList<>();
                for (Object label : listValue(task.get("labels"))) labels.add(String.valueOf(label));
                List<String> cells = List.of(
                    text(board.get("name")),
                    columnNames.getOrDefault(text(task.get("columnId")), ""),
                    text(task.get("title")),
                    text(task.get("description")),
                    text(task.get("priority")),
                    text(task.get("dueDate")),
                    text(task.get("completedAt")),
                    assigneeValue,
                    String.join("|", labels),
                    text(task.get("estimateMinutes")),
                    text(task.get("actualMinutes")),
                    text(task.get("archivedAt")),
                    text(task.get("createdAt"))
                );
                if (!firstRow) body.append("\r\n");
                firstRow = false;
                List<String> escaped = new ArrayList<>();
                for (String cell : cells) escaped.add(csvCell(cell));
                body.append(String.join(",", escaped));
            }
        }
        return new ExportFile(body.toString().getBytes(StandardCharsets.UTF_8),
            "text/csv; charset=utf-8", "drift-" + LocalDate.now() + ".csv");
    }

    private List<Map<String, Object>> jsonTasks(String content) {
        Map<String, Object> parsed;
        try {
            parsed = objectMapper.readValue(content, new TypeReference<>() {});
        } catch (Exception exception) {
            throw ApiException.badRequest("The JSON file could not be parsed.");
        }
        if (parsed == null) return List.of();
        if (parsed.get("tasks") instanceof List<?> tasks) {
            return mapList(tasks);
        }
        if (parsed.get("boards") instanceof List<?> boards) {
            List<Map<String, Object>> tasks = new ArrayList<>();
            for (Object board : boards) {
                if (board instanceof Map<?, ?> map && map.get("tasks") instanceof List<?> nested) {
                    tasks.addAll(mapList(nested));
                }
            }
            return tasks;
        }
        return List.of();
    }

    private List<Map<String, Object>> csvTasks(String content) {
        List<List<String>> rows = parseCsv(content);
        if (rows.isEmpty()) return List.of();
        List<String> headers = new ArrayList<>();
        for (String header : rows.get(0)) headers.add(header.trim().toLowerCase());
        List<Map<String, Object>> tasks = new ArrayList<>();
        for (int rowIndex = 1; rowIndex < rows.size(); rowIndex++) {
            List<String> cells = rows.get(rowIndex);
            Map<String, Object> entry = new LinkedHashMap<>();
            for (int index = 0; index < headers.size(); index++) {
                entry.put(headers.get(index), index < cells.size() ? cells.get(index) : "");
            }
            Map<String, Object> task = new LinkedHashMap<>();
            task.put("title", entry.get("title"));
            task.put("description", entry.get("description"));
            task.put("priority", entry.get("priority"));
            task.put("columnId", entry.get("columnid"));
            task.put("column", entry.get("column"));
            task.put("dueDate", firstNonBlank(entry.get("duedate"), entry.get("due_date")));
            task.put("estimateMinutes", firstNonBlank(entry.get("estimateminutes"), entry.get("estimate")));
            task.put("labels", entry.get("labels"));
            task.put("completedAt", firstNonBlank(entry.get("completedat"), entry.get("completed_at")));
            task.put("assignee", entry.get("assignee"));
            tasks.add(task);
        }
        return tasks;
    }

    private List<List<String>> parseCsv(String content) {
        List<List<String>> rows = new ArrayList<>();
        List<String> row = new ArrayList<>();
        StringBuilder field = new StringBuilder();
        boolean quoted = false;
        String text = content.startsWith("\uFEFF") ? content.substring(1) : content;
        for (int index = 0; index < text.length(); index++) {
            char character = text.charAt(index);
            if (quoted) {
                if (character == '"' && index + 1 < text.length() && text.charAt(index + 1) == '"') {
                    field.append('"');
                    index++;
                } else if (character == '"') {
                    quoted = false;
                } else {
                    field.append(character);
                }
            } else if (character == '"') {
                quoted = true;
            } else if (character == ',') {
                row.add(field.toString());
                field.setLength(0);
            } else if (character == '\n' || character == '\r') {
                if (character == '\r' && index + 1 < text.length() && text.charAt(index + 1) == '\n') index++;
                row.add(field.toString());
                field.setLength(0);
                if (row.stream().anyMatch(cell -> !cell.isBlank())) rows.add(row);
                row = new ArrayList<>();
            } else {
                field.append(character);
            }
        }
        row.add(field.toString());
        if (row.stream().anyMatch(cell -> !cell.isBlank())) rows.add(row);
        return rows;
    }

    private Map<String, Object> chooseColumn(List<Map<String, Object>> columns, Map<String, Object> candidate) {
        String requestedId = stringValue(candidate.get("columnId"));
        if (requestedId != null) {
            for (Map<String, Object> column : columns) {
                if (requestedId.equals(String.valueOf(column.get("id")))) return column;
            }
        }
        String requestedName = stringValue(candidate.get("column"));
        if (requestedName != null && !requestedName.isBlank()) {
            for (Map<String, Object> column : columns) {
                if (requestedName.trim().equalsIgnoreCase(String.valueOf(column.get("name")))) return column;
            }
        }
        return columns.get(0);
    }

    private String resolveAssignee(String workspaceId, String value) {
        if (value == null || value.isBlank()) return null;
        String needle = value.trim().toLowerCase();
        return jdbc.queryForList("""
            SELECT u.id FROM membership m JOIN app_user u ON u.id = m.user_id
            WHERE m.workspace_id = ? AND (lower(u.email) = ? OR lower(u.display_name) = ?)
            LIMIT 1
            """, String.class, workspaceId, needle, needle).stream().findFirst().orElse(null);
    }

    private List<String> importLabels(Object value) {
        List<String> names = new ArrayList<>();
        if (value instanceof String text) {
            for (String part : text.split("[|,]")) {
                String name = part.trim();
                if (!name.isEmpty() && !names.contains(name)) names.add(name);
            }
        } else if (value instanceof List<?> list) {
            for (Object item : list) {
                if (item == null) continue;
                String name = String.valueOf(item).trim();
                if (!name.isEmpty() && !names.contains(name)) names.add(name);
            }
        }
        return names.stream().limit(20).toList();
    }

    private DueValue parseDue(Object value) {
        String text = stringValue(value);
        if (text == null || text.isBlank()) return null;
        text = text.trim();
        if (text.matches("\\d{4}-\\d{2}-\\d{2}")) return new DueValue(text, true);
        try {
            return new DueValue(OffsetDateTime.parse(text).toLocalDateTime().format(LOCAL_DATE_TIME), false);
        } catch (Exception ignored) {
            // Try the next supported shape.
        }
        try {
            return new DueValue(Instant.parse(text).atZone(ZoneId.systemDefault())
                .toLocalDateTime().format(LOCAL_DATE_TIME), false);
        } catch (Exception ignored) {
            // Try the next supported shape.
        }
        try {
            return new DueValue(LocalDateTime.parse(text).format(LOCAL_DATE_TIME), false);
        } catch (Exception ignored) {
            // Fall through to the date prefix.
        }
        if (text.length() >= 10 && text.substring(0, 10).matches("\\d{4}-\\d{2}-\\d{2}")) {
            return new DueValue(text.substring(0, 10), true);
        }
        return null;
    }

    private Integer parseEstimate(Object value) {
        if (value == null || String.valueOf(value).isBlank()) return null;
        try {
            double number = Double.parseDouble(String.valueOf(value));
            if (number <= 0) return null;
            return (int) Math.min(1440, Math.round(number));
        } catch (Exception exception) {
            return null;
        }
    }

    private String roleFor(String userId, String workspaceId) {
        return jdbc.queryForList("""
            SELECT m.role FROM membership m JOIN workspace w ON w.id = m.workspace_id
            WHERE m.user_id = ? AND m.workspace_id = ? AND w.deleted_at IS NULL
            """, userId, workspaceId).stream().findFirst()
            .map(row -> String.valueOf(row.get("role")))
            .orElseThrow(() -> ApiException.notFound("Workspace not found."));
    }

    private int rank(String role) {
        return switch (role) {
            case "OWNER" -> 4;
            case "ADMIN" -> 3;
            case "MEMBER" -> 2;
            case "GUEST" -> 1;
            default -> 0;
        };
    }

    private int number(Object value) {
        if (value instanceof Number number) return number.intValue();
        if (value instanceof Boolean bool) return bool ? 1 : 0;
        try {
            return Integer.parseInt(String.valueOf(value));
        } catch (Exception exception) {
            return 0;
        }
    }

    private String stringValue(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private String text(Object value) {
        return value == null ? "" : String.valueOf(value);
    }

    private String firstNonBlank(Object... values) {
        for (Object value : values) {
            if (value != null && !String.valueOf(value).isBlank()) return String.valueOf(value);
        }
        return null;
    }

    private List<Object> listValue(Object value) {
        return value instanceof List<?> list ? new ArrayList<>(list) : List.of();
    }

    private List<Map<String, Object>> mapList(Object value) {
        List<Map<String, Object>> rows = new ArrayList<>();
        if (value instanceof List<?> list) {
            for (Object item : list) {
                if (item instanceof Map<?, ?> map) {
                    Map<String, Object> row = new LinkedHashMap<>();
                    for (Map.Entry<?, ?> entry : map.entrySet()) {
                        row.put(String.valueOf(entry.getKey()), entry.getValue());
                    }
                    rows.add(row);
                }
            }
        }
        return rows;
    }

    private Map<String, Object> mapOf(Object... pairs) {
        Map<String, Object> map = new LinkedHashMap<>();
        for (int index = 0; index + 1 < pairs.length; index += 2) {
            map.put(String.valueOf(pairs[index]), pairs[index + 1]);
        }
        return map;
    }

    private String csvCell(String value) {
        String raw = value == null ? "" : value;
        String text = raw.matches("^[=+\\-@].*") ? "'" + raw : raw;
        if (text.contains("\"") || text.contains(",") || text.contains("\r") || text.contains("\n")) {
            text = "\"" + text.replace("\"", "\"\"") + "\"";
        }
        return text;
    }

    public record ExportFile(byte[] body, String contentType, String filename) {
    }

    private record DueValue(String value, boolean allDay) {
    }
}
