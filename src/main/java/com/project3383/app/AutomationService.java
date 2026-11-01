package com.project3383.app;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.project3383.api.ApiDtos;
import com.project3383.api.ApiException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service
public class AutomationService {

    private static final Logger log = LoggerFactory.getLogger(AutomationService.class);
    private static final Set<String> TRIGGERS = Set.of("task.created", "task.moved", "task.completed");
    private static final Set<String> ACTIONS = Set.of("set_priority", "add_label", "move_to_column", "notify");
    private static final Set<String> PRIORITIES = Set.of("none", "low", "medium", "high", "urgent");
    private static final int PREVIEW_LIMIT = 20;

    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;
    private final AuditService auditService;

    public AutomationService(JdbcTemplate jdbc, ObjectMapper objectMapper, AuditService auditService) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
        this.auditService = auditService;
    }

    public Map<String, Object> list(String userId, String workspaceId) {
        requireAdmin(userId, workspaceId);
        List<Map<String, Object>> rules = rules(workspaceId);
        for (Map<String, Object> rule : rules) {
            rule.put("runs", jdbc.queryForList("""
                SELECT id, rule_id AS ruleId, task_id AS taskId, actor_id AS actorId,
                       before_json AS beforeJson, after_json AS afterJson, request_id AS requestId,
                       undone_at AS undoneAt, created_at AS createdAt
                FROM automation_run WHERE rule_id = ? ORDER BY created_at DESC LIMIT 5
                """, rule.get("id")));
        }
        List<Map<String, Object>> preview = new ArrayList<>();
        try {
            preview = previewForRules(workspaceId, rules, null, 25);
        } catch (Exception exception) {
            log.warn("Could not build automation preview", exception);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("rules", rules);
        result.put("preview", preview);
        return result;
    }

    @Transactional
    public Map<String, Object> create(String userId, ApiDtos.AutomationCreate input) {
        if (input == null || blank(input.workspaceId())) throw ApiException.badRequest("Choose a workspace.");
        requireAdmin(userId, input.workspaceId());
        if (!automationsEnabled(input.workspaceId())) {
            throw ApiException.badRequest("Automations are disabled for this workspace.");
        }
        String name = normalizeName(input.name());
        String trigger = normalizeTrigger(input.trigger());
        String actionType = normalizeActionType(input.actionType());
        String actionValue = normalizeActionValue(input.actionValue());
        String conditionsJson = normalizeConditions(input.conditionsJson());
        String boardId = validateBoard(input.workspaceId(), input.boardId());
        String id = UUID.randomUUID().toString();
        String now = Instant.now().toString();
        jdbc.update("""
            INSERT INTO automation_rule (id, workspace_id, board_id, name, enabled, trigger,
                                         conditions_json, action_type, action_value, last_run_at,
                                         created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
            """, id, input.workspaceId(), boardId, name, input.enabled() == null || input.enabled() ? 1 : 0,
            trigger, conditionsJson, actionType, actionValue, now, now);
        auditService.record(input.workspaceId(), userId, "automation.created", "automation", id,
            linkedMap("trigger", trigger, "actionType", actionType));
        Map<String, Object> rule = ruleRow(id);
        rule.put("runs", List.of());
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("rule", rule);
        return result;
    }

    @Transactional
    public Map<String, Object> update(String userId, String automationId, ApiDtos.AutomationUpdate input) {
        if (input == null || blank(input.workspaceId())) throw ApiException.badRequest("Choose a workspace.");
        requireAdmin(userId, input.workspaceId());
        Map<String, Object> current = ruleRow(automationId);
        if (!input.workspaceId().equals(current.get("workspaceId"))) throw ApiException.notFound("Automation not found.");
        List<String> fields = new ArrayList<>();
        String name = input.name() == null ? String.valueOf(current.get("name")) : normalizeName(input.name());
        String trigger = input.trigger() == null ? String.valueOf(current.get("trigger")) : normalizeTrigger(input.trigger());
        String conditionsJson = input.conditionsJson() == null
            ? String.valueOf(current.get("conditionsJson")) : normalizeConditions(input.conditionsJson());
        String actionType = input.actionType() == null
            ? String.valueOf(current.get("actionType")) : normalizeActionType(input.actionType());
        String actionValue = input.actionValue() == null
            ? String.valueOf(current.get("actionValue")) : normalizeActionValue(input.actionValue());
        String boardId = input.boardId() == null
            ? stringValue(current.get("boardId"))
            : validateBoard(input.workspaceId(), input.boardId());
        boolean enabled = input.enabled() == null ? Boolean.TRUE.equals(current.get("enabled")) : input.enabled();
        if (input.name() != null) fields.add("name");
        if (input.enabled() != null) fields.add("enabled");
        if (input.trigger() != null) fields.add("trigger");
        if (input.conditionsJson() != null) fields.add("conditionsJson");
        if (input.actionType() != null) fields.add("actionType");
        if (input.actionValue() != null) fields.add("actionValue");
        if (input.boardId() != null) fields.add("boardId");
        jdbc.update("""
            UPDATE automation_rule SET board_id = ?, name = ?, enabled = ?, trigger = ?,
                                       conditions_json = ?, action_type = ?, action_value = ?, updated_at = ?
            WHERE id = ? AND workspace_id = ?
            """, boardId, name, enabled ? 1 : 0, trigger, conditionsJson, actionType, actionValue,
            Instant.now().toString(), automationId, input.workspaceId());
        auditService.record(input.workspaceId(), userId, "automation.updated", "automation", automationId,
            linkedMap("fields", fields));
        Map<String, Object> rule = ruleRow(automationId);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("rule", rule);
        return result;
    }

    @Transactional
    public Map<String, Object> delete(String userId, String workspaceId, String automationId) {
        requireAdmin(userId, workspaceId);
        int deleted = jdbc.update("DELETE FROM automation_rule WHERE id = ? AND workspace_id = ?",
            automationId, workspaceId);
        if (deleted == 0) throw ApiException.notFound("Automation not found.");
        auditService.record(workspaceId, userId, "automation.deleted", "automation", automationId, Map.of());
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("deleted", true);
        return result;
    }

    public Map<String, Object> preview(String userId, ApiDtos.AutomationPreviewInput input) {
        if (input == null || blank(input.workspaceId())) throw ApiException.badRequest("Choose a workspace.");
        requireAdmin(userId, input.workspaceId());
        String trigger = normalizeTrigger(input.trigger());
        String conditionsJson = normalizeConditions(input.conditionsJson());
        String actionType = normalizeActionType(input.actionType());
        String actionValue = normalizeActionValue(input.actionValue());
        String boardId = validateBoard(input.workspaceId(), input.boardId());
        Map<String, Object> draft = new LinkedHashMap<>();
        draft.put("boardId", boardId);
        draft.put("trigger", trigger);
        draft.put("conditionsJson", conditionsJson);
        draft.put("actionType", actionType);
        draft.put("actionValue", actionValue);
        return previewDraft(input.workspaceId(), draft);
    }

    public void runForEvent(String workspaceId, String event, String taskId, String actorId) {
        if (workspaceId == null || event == null || taskId == null) return;
        try {
            if (!automationsEnabled(workspaceId)) return;
            TaskSnapshot task = snapshot(taskId);
            if (task == null || !workspaceId.equals(task.workspaceId())) return;
            List<Map<String, Object>> rules = jdbc.queryForList("""
                SELECT id, workspace_id AS workspaceId, board_id AS boardId, name, enabled, trigger,
                       conditions_json AS conditionsJson, action_type AS actionType, action_value AS actionValue,
                       last_run_at AS lastRunAt, created_at AS createdAt, updated_at AS updatedAt
                FROM automation_rule
                WHERE workspace_id = ? AND enabled = 1 AND trigger = ?
                  AND (board_id IS NULL OR board_id = ?)
                ORDER BY created_at ASC, id ASC
                """, workspaceId, event, task.boardId());
            for (Map<String, Object> rule : rules) {
                try {
                    if (!matches(task, String.valueOf(rule.get("conditionsJson")))) continue;
                    applyRule(workspaceId, task, rule, actorId);
                } catch (Exception exception) {
                    log.warn("Automation {} failed for task {}", rule.get("id"), taskId, exception);
                }
            }
        } catch (Exception exception) {
            log.warn("Automation run failed for {}", taskId, exception);
        }
    }

    private void applyRule(String workspaceId, TaskSnapshot task, Map<String, Object> rule, String actorId) {
        Map<String, Object> before = new LinkedHashMap<>();
        before.put("priority", task.priority());
        before.put("columnId", task.columnId());
        before.put("labels", task.labels().stream().map(LabelRef::name).toList());
        before.put("completed", task.completed());

        String actionType = String.valueOf(rule.get("actionType"));
        String actionValue = String.valueOf(rule.get("actionValue"));
        Map<String, Object> after = new LinkedHashMap<>();
        String now = Instant.now().toString();
        if ("set_priority".equals(actionType)) {
            if (!PRIORITIES.contains(actionValue)) return;
            jdbc.update("""
                UPDATE task SET priority = ?, version = version + 1, updated_at = ? WHERE id = ?
                """, actionValue, now, task.id());
            after.put("priority", actionValue);
        } else if ("add_label".equals(actionType)) {
            String labelName = actionValue.trim();
            if (labelName.isEmpty()) return;
            String labelId = jdbc.queryForList("""
                SELECT id FROM label WHERE workspace_id = ? AND name = ?
                """, String.class, workspaceId, labelName).stream().findFirst().orElse(null);
            if (labelId == null) {
                labelId = UUID.randomUUID().toString();
                jdbc.update("""
                    INSERT INTO label (id, workspace_id, name, color, created_at) VALUES (?, ?, ?, 'violet', ?)
                    """, labelId, workspaceId, labelName, now);
            }
            Integer existing = jdbc.queryForObject("""
                SELECT COUNT(*) FROM task_label WHERE task_id = ? AND label_id = ?
                """, Integer.class, task.id(), labelId);
            if (existing != null && existing > 0) return;
            jdbc.update("INSERT INTO task_label (task_id, label_id) VALUES (?, ?)", task.id(), labelId);
            jdbc.update("UPDATE task SET version = version + 1, updated_at = ? WHERE id = ?", now, task.id());
            after.put("labelId", labelId);
            after.put("labelName", labelName);
        } else if ("move_to_column".equals(actionType)) {
            ColumnRef target = task.columns().stream()
                .filter(column -> column.id().equals(actionValue))
                .findFirst().orElse(null);
            if (target == null || target.id().equals(task.columnId())) return;
            Integer last = jdbc.queryForObject("""
                SELECT COALESCE(MAX(position), 0) FROM task WHERE column_id = ? AND deleted_at IS NULL
                """, Integer.class, target.id());
            int position = (last == null ? 0 : last) + 1;
            jdbc.update("""
                UPDATE task SET column_id = ?, position = ?, version = version + 1, updated_at = ? WHERE id = ?
                """, target.id(), position, now, task.id());
            after.put("columnId", target.id());
            after.put("columnName", target.name());
        } else if ("notify".equals(actionType)) {
            String recipient = task.assigneeId() == null ? task.createdById() : task.assigneeId();
            if (recipient == null) return;
            jdbc.update("""
                INSERT INTO notification (id, user_id, workspace_id, task_id, type, title, body, link, read_at, created_at)
                VALUES (?, ?, ?, ?, 'automation', ?, ?, ?, NULL, ?)
                """, UUID.randomUUID().toString(), recipient, workspaceId, task.id(), actionValue,
                "Rule \"" + rule.get("name") + "\" matched \"" + task.title() + "\".", "/?task=" + task.id(), now);
            after.put("notifiedUserId", recipient);
        } else {
            return;
        }

        String runId = UUID.randomUUID().toString();
        String beforeJson = json(before);
        String afterJson = json(after);
        jdbc.update("""
            INSERT INTO automation_run (id, rule_id, task_id, actor_id, before_json, after_json,
                                        request_id, undone_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'automation', NULL, ?)
            """, runId, rule.get("id"), task.id(), actorId, beforeJson, afterJson, now);
        jdbc.update("""
            UPDATE automation_rule SET last_run_at = ?, updated_at = ? WHERE id = ?
            """, now, now, rule.get("id"));

        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("ruleId", rule.get("id"));
        metadata.put("ruleName", rule.get("name"));
        metadata.put("after", after);
        jdbc.update("""
            INSERT INTO activity_event (id, workspace_id, task_id, actor_id, action,
                                        entity_type, entity_id, metadata, request_id, created_at)
            VALUES (?, ?, ?, ?, 'automation.applied', 'automation_run', ?, ?, 'automation', ?)
            """, UUID.randomUUID().toString(), workspaceId, task.id(), actorId, runId, json(metadata), now);
        auditService.record(workspaceId, actorId, "automation.applied", "automation_run", runId, metadata);

        Map<String, Object> inverse = new LinkedHashMap<>();
        inverse.put("taskId", task.id());
        inverse.put("before", before);
        inverse.put("after", after);
        inverse.put("ruleId", rule.get("id"));
        jdbc.update("""
            INSERT INTO undo_action (id, user_id, workspace_id, action, entity_type, entity_id,
                                     inverse_json, expires_at, created_at)
            VALUES (?, ?, ?, 'automation.run', 'automation_run', ?, ?, ?, ?)
            """, UUID.randomUUID().toString(), actorId, workspaceId, runId, json(inverse),
            Instant.now().plusSeconds(60).toString(), now);
    }

    private List<Map<String, Object>> previewForRules(String workspaceId, List<Map<String, Object>> rules,
                                                       String boardId, int limit) {
        List<Map<String, Object>> previews = new ArrayList<>();
        for (Map<String, Object> rule : rules) {
            if (!Boolean.TRUE.equals(rule.get("enabled"))) continue;
            if (boardId != null && rule.get("boardId") != null && !boardId.equals(rule.get("boardId"))) continue;
            List<TaskSnapshot> tasks = tasks(workspaceId,
                stringValue(rule.get("boardId")),
                "task.completed".equals(rule.get("trigger")), 100);
            for (TaskSnapshot task : tasks) {
                if (!matches(task, String.valueOf(rule.get("conditionsJson")))) continue;
                Map<String, Object> preview = new LinkedHashMap<>();
                preview.put("ruleId", rule.get("id"));
                preview.put("ruleName", rule.get("name"));
                preview.put("taskId", task.id());
                preview.put("title", task.title());
                preview.put("change", describeAction(String.valueOf(rule.get("actionType")),
                    String.valueOf(rule.get("actionValue"))));
                previews.add(preview);
                if (previews.size() >= limit) return previews;
            }
        }
        return previews;
    }

    private Map<String, Object> previewDraft(String workspaceId, Map<String, Object> draft) {
        List<TaskSnapshot> tasks = tasks(workspaceId, stringValue(draft.get("boardId")),
            "task.completed".equals(draft.get("trigger")), 500);
        String actionType = String.valueOf(draft.get("actionType"));
        String actionValue = String.valueOf(draft.get("actionValue"));
        List<Map<String, Object>> matches = new ArrayList<>();
        List<String> skipped = new ArrayList<>();
        int total = 0;
        for (TaskSnapshot task : tasks) {
            if (!matches(task, String.valueOf(draft.get("conditionsJson")))) continue;
            String before;
            String after;
            if ("set_priority".equals(actionType)) {
                if (!PRIORITIES.contains(actionValue)) {
                    if (!skipped.contains("Unknown priority value")) skipped.add("Unknown priority value");
                    continue;
                }
                if (task.priority().equals(actionValue)) continue;
                before = "Priority: " + task.priority();
                after = "Priority: " + actionValue;
            } else if ("add_label".equals(actionType)) {
                String labelName = actionValue.trim();
                if (labelName.isEmpty()) continue;
                boolean exists = task.labels().stream()
                    .anyMatch(label -> label.name().equalsIgnoreCase(labelName));
                if (exists) continue;
                List<String> names = task.labels().stream().map(LabelRef::name).toList();
                before = names.isEmpty() ? "Labels: none" : "Labels: " + String.join(", ", names);
                List<String> next = new ArrayList<>(names);
                next.add(labelName);
                after = "Labels: " + String.join(", ", next);
            } else if ("move_to_column".equals(actionType)) {
                ColumnRef target = task.columns().stream()
                    .filter(column -> column.id().equals(actionValue))
                    .findFirst().orElse(null);
                if (target == null) {
                    if (!skipped.contains("The chosen column no longer exists")) {
                        skipped.add("The chosen column no longer exists");
                    }
                    continue;
                }
                if (target.id().equals(task.columnId())) continue;
                before = "Column: " + (task.columnName() == null ? "Unknown" : task.columnName());
                after = "Column: " + target.name();
            } else if ("notify".equals(actionType)) {
                before = "No notification";
                after = task.assigneeId() != null ? "Notify the assignee" : "Notify the task creator";
            } else {
                continue;
            }
            total++;
            if (matches.size() < PREVIEW_LIMIT) {
                Map<String, Object> match = new LinkedHashMap<>();
                match.put("taskId", task.id());
                match.put("title", task.title());
                match.put("boardName", task.boardName());
                match.put("before", before);
                match.put("after", after);
                matches.add(match);
            }
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("total", total);
        result.put("truncated", total > matches.size());
        result.put("matches", matches);
        result.put("skipped", skipped);
        return result;
    }

    private List<Map<String, Object>> rules(String workspaceId) {
        List<Map<String, Object>> rules = jdbc.queryForList("""
            SELECT id, workspace_id AS workspaceId, board_id AS boardId, name, enabled, trigger,
                   conditions_json AS conditionsJson, action_type AS actionType, action_value AS actionValue,
                   last_run_at AS lastRunAt, created_at AS createdAt, updated_at AS updatedAt
            FROM automation_rule WHERE workspace_id = ? ORDER BY created_at DESC, id DESC
            """, workspaceId);
        for (Map<String, Object> rule : rules) {
            rule.put("enabled", number(rule.get("enabled")) == 1);
        }
        return rules;
    }

    private Map<String, Object> ruleRow(String id) {
        Map<String, Object> rule = jdbc.queryForList("""
            SELECT id, workspace_id AS workspaceId, board_id AS boardId, name, enabled, trigger,
                   conditions_json AS conditionsJson, action_type AS actionType, action_value AS actionValue,
                   last_run_at AS lastRunAt, created_at AS createdAt, updated_at AS updatedAt
            FROM automation_rule WHERE id = ?
            """, id).stream().findFirst().orElseThrow(() -> ApiException.notFound("Automation not found."));
        rule.put("enabled", number(rule.get("enabled")) == 1);
        return rule;
    }

    private List<TaskSnapshot> tasks(String workspaceId, String boardId, boolean completedOnly, int limit) {
        StringBuilder sql = new StringBuilder("""
            SELECT t.id FROM task t
            JOIN board b ON b.id = t.board_id
            JOIN board_column c ON c.id = t.column_id
            WHERE t.workspace_id = ? AND t.deleted_at IS NULL AND b.deleted_at IS NULL
            """);
        List<Object> args = new ArrayList<>();
        args.add(workspaceId);
        if (boardId != null && !boardId.isBlank()) {
            sql.append(" AND t.board_id = ?");
            args.add(boardId);
        }
        if (completedOnly) sql.append(" AND c.is_done = 1");
        sql.append(" ORDER BY CASE WHEN t.due_date IS NULL THEN 0 ELSE 1 END, t.due_date ASC, t.position ASC LIMIT ?");
        args.add(limit);
        List<String> ids = jdbc.queryForList(sql.toString(), String.class, args.toArray());
        List<TaskSnapshot> tasks = new ArrayList<>();
        for (String id : ids) {
            TaskSnapshot task = snapshot(id);
            if (task != null) tasks.add(task);
        }
        return tasks;
    }

    private TaskSnapshot snapshot(String taskId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
            SELECT t.id, t.workspace_id AS workspaceId, t.board_id AS boardId, b.name AS boardName,
                   t.column_id AS columnId, c.name AS columnName, c.is_done AS completed,
                   t.title, t.priority, t.estimate_minutes AS estimateMinutes, t.due_date AS dueDate,
                   t.assignee_id AS assigneeId, t.created_by AS createdById
            FROM task t
            JOIN board b ON b.id = t.board_id
            JOIN board_column c ON c.id = t.column_id
            WHERE t.id = ? AND t.deleted_at IS NULL AND b.deleted_at IS NULL
            """, taskId);
        if (rows.isEmpty()) return null;
        Map<String, Object> row = rows.get(0);
        List<LabelRef> labels = jdbc.queryForList("""
            SELECT l.id, l.name FROM task_label tl JOIN label l ON l.id = tl.label_id
            WHERE tl.task_id = ? ORDER BY l.name
            """, taskId).stream()
            .map(label -> new LabelRef(String.valueOf(label.get("id")), String.valueOf(label.get("name"))))
            .toList();
        String boardId = stringValue(row.get("boardId"));
        List<ColumnRef> columns = jdbc.queryForList("""
            SELECT id, name, is_done AS isDone, position FROM board_column
            WHERE board_id = ? ORDER BY position ASC
            """, boardId).stream()
            .map(column -> new ColumnRef(String.valueOf(column.get("id")), String.valueOf(column.get("name")),
                number(column.get("isDone")) == 1, number(column.get("position"))))
            .toList();
        Object estimate = row.get("estimateMinutes");
        Integer estimateMinutes = estimate instanceof Number value ? value.intValue() : null;
        return new TaskSnapshot(
            String.valueOf(row.get("id")),
            stringValue(row.get("workspaceId")),
            boardId,
            stringValue(row.get("boardName")),
            stringValue(row.get("columnId")),
            stringValue(row.get("columnName")),
            String.valueOf(row.get("title")),
            String.valueOf(row.get("priority")),
            estimateMinutes,
            stringValue(row.get("dueDate")),
            number(row.get("completed")) == 1,
            stringValue(row.get("assigneeId")),
            stringValue(row.get("createdById")),
            labels,
            columns
        );
    }

    private boolean matches(TaskSnapshot task, String conditionsJson) {
        Map<String, Object> conditions;
        try {
            conditions = objectMapper.readValue(conditionsJson == null ? "{}" : conditionsJson, new TypeReference<>() {});
        } catch (Exception exception) {
            return false;
        }
        if (conditions.get("priority") != null && !conditions.get("priority").equals(task.priority())) return false;
        if (conditions.get("columnId") != null && !conditions.get("columnId").equals(task.columnId())) return false;
        if (conditions.get("label") != null) {
            String label = String.valueOf(conditions.get("label"));
            boolean found = task.labels().stream().anyMatch(entry -> entry.name().equalsIgnoreCase(label));
            if (!found) return false;
        }
        if (conditions.get("estimateLessThan") != null) {
            Integer threshold = asInteger(conditions.get("estimateLessThan"));
            if (threshold == null || task.estimateMinutes() == null || task.estimateMinutes() >= threshold) return false;
        }
        if (conditions.get("hasDueDate") instanceof Boolean hasDueDate) {
            boolean taskHasDueDate = task.dueDate() != null && !task.dueDate().isBlank();
            if (hasDueDate != taskHasDueDate) return false;
        }
        return true;
    }

    private String describeAction(String actionType, String actionValue) {
        return switch (actionType) {
            case "set_priority" -> "Set priority to " + actionValue;
            case "add_label" -> "Add label \"" + actionValue + "\"";
            case "move_to_column" -> "Move to the configured column";
            case "notify" -> "Notify the assignee";
            default -> "Apply rule";
        };
    }

    private String normalizeName(String value) {
        if (value == null || value.trim().isEmpty()) throw ApiException.badRequest("Give the rule a name.");
        String name = value.trim();
        if (name.length() > 80) throw ApiException.badRequest("Automation name is too long.");
        return name;
    }

    private String normalizeTrigger(String value) {
        String trigger = value == null ? "" : value.trim();
        if (!TRIGGERS.contains(trigger)) throw ApiException.badRequest("Choose a valid automation trigger.");
        return trigger;
    }

    private String normalizeActionType(String value) {
        String action = value == null ? "" : value.trim();
        if (!ACTIONS.contains(action)) throw ApiException.badRequest("Choose a valid automation action.");
        return action;
    }

    private String normalizeActionValue(String value) {
        if (value == null || value.trim().isEmpty()) throw ApiException.badRequest("Give the action a value.");
        String actionValue = value.trim();
        if (actionValue.length() > 200) throw ApiException.badRequest("Automation action value is too long.");
        return actionValue;
    }

    private String normalizeConditions(String value) {
        String conditions = value == null || value.isBlank() ? "{}" : value.trim();
        if (conditions.length() > 2000) throw ApiException.badRequest("Automation conditions are too long.");
        try {
            Map<String, Object> parsed = objectMapper.readValue(conditions, new TypeReference<>() {});
            if (parsed == null) throw new IllegalArgumentException();
        } catch (Exception exception) {
            throw ApiException.badRequest("Automation conditions must be a JSON object.");
        }
        return conditions;
    }

    private String validateBoard(String workspaceId, String boardId) {
        if (boardId == null || boardId.isBlank()) return null;
        Integer count = jdbc.queryForObject("""
            SELECT COUNT(*) FROM board WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
            """, Integer.class, boardId, workspaceId);
        if (count == null || count == 0) throw ApiException.notFound("Board not found.");
        return boardId;
    }

    private boolean automationsEnabled(String workspaceId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
            SELECT automations_enabled AS automationsEnabled FROM workspace
            WHERE id = ? AND deleted_at IS NULL
            """, workspaceId);
        if (rows.isEmpty()) throw ApiException.notFound("Workspace not found.");
        return number(rows.get(0).get("automationsEnabled")) == 1;
    }

    private void requireAdmin(String userId, String workspaceId) {
        String role = jdbc.queryForList("""
            SELECT m.role FROM membership m JOIN workspace w ON w.id = m.workspace_id
            WHERE m.user_id = ? AND m.workspace_id = ? AND w.deleted_at IS NULL
            """, userId, workspaceId).stream().findFirst()
            .map(row -> String.valueOf(row.get("role")))
            .orElseThrow(() -> ApiException.notFound("Workspace not found."));
        if (!"OWNER".equals(role) && !"ADMIN".equals(role)) {
            throw ApiException.forbidden("You do not have permission to manage automations.");
        }
    }

    private Integer asInteger(Object value) {
        if (value instanceof Number number) return number.intValue();
        try {
            return Integer.valueOf(String.valueOf(value));
        } catch (Exception exception) {
            return null;
        }
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

    private boolean blank(String value) {
        return value == null || value.isBlank();
    }

    private Map<String, Object> linkedMap(Object... pairs) {
        Map<String, Object> map = new LinkedHashMap<>();
        for (int index = 0; index + 1 < pairs.length; index += 2) {
            map.put(String.valueOf(pairs[index]), pairs[index + 1]);
        }
        return map;
    }

    private String json(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception exception) {
            return "{}";
        }
    }

    private record LabelRef(String id, String name) {
    }

    private record ColumnRef(String id, String name, boolean done, int position) {
    }

    private record TaskSnapshot(
        String id,
        String workspaceId,
        String boardId,
        String boardName,
        String columnId,
        String columnName,
        String title,
        String priority,
        Integer estimateMinutes,
        String dueDate,
        boolean completed,
        String assigneeId,
        String createdById,
        List<LabelRef> labels,
        List<ColumnRef> columns
    ) {
    }
}
