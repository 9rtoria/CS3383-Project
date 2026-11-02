package com.project3383.app;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.project3383.api.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class UndoService {

    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;
    private final AutoPlanService autoPlanService;

    public UndoService(JdbcTemplate jdbc, ObjectMapper objectMapper, AutoPlanService autoPlanService) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
        this.autoPlanService = autoPlanService;
    }

    @Transactional
    public Map<String, Object> undo(String userId, String undoId) {
        Map<String, Object> undo = jdbc.queryForList("""
            SELECT id, workspace_id AS workspaceId, action, entity_type AS entityType,
                   entity_id AS entityId, inverse_json AS inverseJson, expires_at AS expiresAt
            FROM undo_action WHERE id = ? AND user_id = ?
            """, undoId, userId).stream().findFirst()
            .orElseThrow(() -> ApiException.notFound("Undo window expired. The audit trail is still available."));
        String action = String.valueOf(undo.get("action"));
        if (Instant.parse(String.valueOf(undo.get("expiresAt"))).isBefore(Instant.now())) {
            jdbc.update("DELETE FROM undo_action WHERE id = ?", undoId);
            throw ApiException.notFound("Undo window expired. The audit trail is still available.");
        }
        String workspaceId = String.valueOf(undo.get("workspaceId"));
        requireMember(userId, workspaceId);

        if ("auto_plan.apply".equals(action)) {
            Map<String, Object> result = autoPlanService.undo(userId, undoId);
            recordUndone(workspaceId, null, userId, action,
                String.valueOf(undo.get("entityType")), String.valueOf(undo.get("entityId")));
            return result;
        }

        Map<String, Object> inverse;
        try {
            inverse = objectMapper.readValue(String.valueOf(undo.get("inverseJson")), new TypeReference<>() {});
        } catch (Exception exception) {
            throw new IllegalStateException("Could not read the undo record.", exception);
        }
        String entityId = String.valueOf(undo.get("entityId"));
        String now = Instant.now().toString();
        switch (action) {
            case "task.create" -> jdbc.update("""
                UPDATE task SET deleted_at = ?, version = version + 1
                WHERE id = ? AND workspace_id = ?
                """, now, entityId, workspaceId);
            case "task.delete" -> jdbc.update("""
                UPDATE task SET deleted_at = NULL, version = version + 1
                WHERE id = ? AND workspace_id = ?
                """, entityId, workspaceId);
            case "task.move", "task.complete", "task.reopen" -> {
                String nextTaskId = stringValue(inverse.get("nextTaskId"));
                if (nextTaskId != null) {
                    jdbc.update("""
                        UPDATE task SET deleted_at = ?, version = version + 1
                        WHERE id = ? AND workspace_id = ?
                        """, now, nextTaskId, workspaceId);
                }
                String columnId = stringValue(inverse.get("columnId"));
                if (columnId != null) {
                    jdbc.update("""
                        UPDATE task SET column_id = ?, version = version + 1
                        WHERE id = ? AND workspace_id = ?
                        """, columnId, entityId, workspaceId);
                }
            }
            case "task.bulk_delete" -> {
                for (String taskId : stringList(inverse.get("taskIds"))) {
                    jdbc.update("""
                        UPDATE task SET deleted_at = NULL, version = version + 1
                        WHERE id = ? AND workspace_id = ?
                        """, taskId, workspaceId);
                }
            }
            case "task.bulk_archive" -> {
                for (String taskId : stringList(inverse.get("taskIds"))) {
                    jdbc.update("""
                        UPDATE task SET archived_at = NULL, version = version + 1
                        WHERE id = ? AND workspace_id = ?
                        """, taskId, workspaceId);
                }
            }
            case "task.bulk_complete", "task.bulk_move" -> {
                for (Map<String, Object> row : mapList(inverse.get("previous"))) {
                    String taskId = stringValue(row.get("taskId"));
                    String columnId = stringValue(row.get("columnId"));
                    if (taskId == null || columnId == null) continue;
                    Object position = row.get("position");
                    if (position == null) {
                        jdbc.update("""
                            UPDATE task SET column_id = ?, version = version + 1
                            WHERE id = ? AND workspace_id = ?
                            """, columnId, taskId, workspaceId);
                    } else {
                        jdbc.update("""
                            UPDATE task SET column_id = ?, position = ?, version = version + 1
                            WHERE id = ? AND workspace_id = ?
                            """, columnId, position, taskId, workspaceId);
                    }
                }
            }
            case "task.reorder" -> {
                for (Map<String, Object> row : mapList(inverse.get("previous"))) {
                    String taskId = stringValue(row.get("taskId"));
                    Object position = row.get("position");
                    if (taskId == null || position == null) continue;
                    jdbc.update("""
                        UPDATE task SET position = ?, version = version + 1
                        WHERE id = ? AND workspace_id = ?
                        """, position, taskId, workspaceId);
                }
            }
            case "automation.run" -> {
                String taskId = stringValue(inverse.get("taskId"));
                Map<String, Object> before = mapValue(inverse.get("before"));
                Map<String, Object> after = mapValue(inverse.get("after"));
                if (taskId != null) {
                    String priority = stringValue(before.get("priority"));
                    if (priority != null) {
                        jdbc.update("""
                            UPDATE task SET priority = ?, version = version + 1
                            WHERE id = ? AND workspace_id = ?
                            """, priority, taskId, workspaceId);
                    }
                    String columnId = stringValue(before.get("columnId"));
                    if (columnId != null) {
                        jdbc.update("""
                            UPDATE task SET column_id = ?, version = version + 1
                            WHERE id = ? AND workspace_id = ?
                            """, columnId, taskId, workspaceId);
                    }
                    String labelId = stringValue(after.get("labelId"));
                    if (labelId != null) {
                        jdbc.update("DELETE FROM task_label WHERE task_id = ? AND label_id = ?", taskId, labelId);
                    }
                }
                jdbc.update("UPDATE automation_run SET undone_at = ? WHERE id = ?", now, entityId);
            }
            case "board.delete" -> {
                jdbc.update("""
                    UPDATE board SET deleted_at = NULL, version = version + 1
                    WHERE id = ? AND workspace_id = ?
                    """, entityId, workspaceId);
                for (String taskId : stringList(inverse.get("taskIds"))) {
                    jdbc.update("""
                        UPDATE task SET deleted_at = NULL, version = version + 1
                        WHERE id = ? AND board_id = ? AND workspace_id = ?
                        """, taskId, entityId, workspaceId);
                }
            }
            default -> throw new ApiException(HttpStatus.CONFLICT, "CONFLICT",
                "This action cannot be undone automatically.");
        }
        jdbc.update("DELETE FROM undo_action WHERE id = ?", undoId);
        recordUndone(workspaceId,
            "task".equals(String.valueOf(undo.get("entityType"))) ? entityId : null,
            userId, action, String.valueOf(undo.get("entityType")), entityId);
        return linked(Map.of("undone", true, "action", action));
    }

    private void requireMember(String userId, String workspaceId) {
        com.project3383.auth.AuthInterceptor.requireTokenWorkspace(workspaceId);
        String role = jdbc.queryForList("""
            SELECT role FROM membership WHERE user_id = ? AND workspace_id = ?
            """, userId, workspaceId).stream().findFirst()
            .map(row -> String.valueOf(row.get("role")))
            .orElseThrow(() -> ApiException.notFound("Workspace not found."));
        if ("GUEST".equals(role)) throw ApiException.forbidden("You do not have permission for this action.");
    }

    private void recordUndone(String workspaceId, String taskId, String actorId, String originalAction,
                              String entityType, String entityId) {
        jdbc.update("""
            INSERT INTO activity_event (id, workspace_id, task_id, actor_id, action,
                                        entity_type, entity_id, metadata, created_at)
            VALUES (?, ?, ?, ?, 'action.undone', ?, ?, '{}', ?)
            """, UUID.randomUUID().toString(), workspaceId, taskId, actorId,
            entityType, entityId, Instant.now().toString());
    }

    private String stringValue(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private List<String> stringList(Object value) {
        List<String> values = new ArrayList<>();
        if (value instanceof List<?> list) {
            for (Object item : list) {
                if (item != null) values.add(String.valueOf(item));
            }
        }
        return values;
    }

    private Map<String, Object> mapValue(Object value) {
        Map<String, Object> result = new LinkedHashMap<>();
        if (value instanceof Map<?, ?> map) {
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                result.put(String.valueOf(entry.getKey()), entry.getValue());
            }
        }
        return result;
    }

    private List<Map<String, Object>> mapList(Object value) {
        List<Map<String, Object>> values = new ArrayList<>();
        if (value instanceof List<?> list) {
            for (Object item : list) {
                if (item instanceof Map<?, ?> map) {
                    Map<String, Object> row = new LinkedHashMap<>();
                    for (Map.Entry<?, ?> entry : map.entrySet()) {
                        row.put(String.valueOf(entry.getKey()), entry.getValue());
                    }
                    values.add(row);
                }
            }
        }
        return values;
    }

    private Map<String, Object> linked(Map<String, Object> value) {
        return new LinkedHashMap<>(value);
    }
}
