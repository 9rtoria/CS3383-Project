# SD19 — Undo a Recorded Action

**Covers:** `UndoController.undo` → `UndoService.undo` (dispatch by `action`),
delegating `auto_plan.apply` to `AutoPlanService.undo`.

Source: `api/UndoController.java`, `app/UndoService.java:32`, `app/AutoPlanService.java:263`.

The `alt` fragment is a switch over the recorded action type. A missing or expired entry both
return the **same** 404 `"Undo window expired…"` message (`orElseThrow` for missing, explicit
throw for expired); only the expired path additionally deletes the stale row. `requireMember` is
an `UndoService` self-call. The `auto_plan.apply`
branch is **exclusive**: `AutoPlanService.undo()` restores the plan and consumes the undo record
(deletes the `undo_action` row), then `UndoService` only writes the audit/activity event and
returns — there is no shared final delete on that path. The generic branch deletes its own record
and writes its own activity event.

```mermaid
sequenceDiagram
    autonumber
    actor U as :User
    participant B as :Browser
    participant C as :UndoController
    participant UD as :UndoService
    participant AP as :AutoPlanService
    participant DB as :JdbcTemplate

    U->>B: tap "Undo" toast
    B->>C: POST /api/undo/{id}
    C->>UD: undo(userId, undoId)
    UD->>DB: SELECT undo_action WHERE id & user_id
    alt missing entry
        UD-->>C: throw 404 "Undo window expired. The audit trail is still available."
    end
    break expiresAt < now
        UD->>DB: DELETE undo_action
        UD-->>C: throw 404 "Undo window expired. The audit trail is still available."
    end
    UD->>UD: requireMember(userId, workspace) — GUEST forbidden 403

    alt action = auto_plan.apply
        UD->>AP: undo(userId, undoId)
        AP->>DB: re-select undo_action + re-check expiry/action, requireMembership
        AP->>DB: DELETE auto plan_block, reinsert previousBlocks
        AP->>DB: restore today_selection / focus_date / archived_at
        AP->>DB: DELETE undo_action (consumed here, last)
        AP-->>UD: {undone:true, action:"auto_plan.apply"}
        UD->>DB: INSERT activity_event("action.undone")
        UD-->>C: result (no further delete — already consumed)
    else parse inverse_json
        UD->>UD: objectMapper.readValue(inverseJson)
        alt action in {task.complete, task.move, task.reopen}
            UD->>DB: UPDATE task SET deleted_at = now WHERE id = inverse.nextTaskId (soft-delete, if any)
            UD->>DB: UPDATE task SET column_id = inverse.columnId
        else action = task.create
            UD->>DB: UPDATE task SET deleted_at = now
        else action = task.delete
            UD->>DB: UPDATE task SET deleted_at = NULL
        else action = task.bulk_delete
            loop each taskId in inverse.taskIds
                UD->>DB: UPDATE task SET deleted_at = NULL
            end
        else action = task.bulk_archive
            loop each taskId in inverse.taskIds
                UD->>DB: UPDATE task SET archived_at = NULL
            end
        else action = task.bulk_complete / task.bulk_move
            loop each row in inverse.previous
                UD->>DB: UPDATE task SET column_id (position if present)
            end
        else action = task.reorder
            loop each row in inverse.previous
                UD->>DB: UPDATE task SET position
            end
        else action = automation.run
            UD->>DB: UPDATE task restore priority/column_id (from before)
            UD->>DB: DELETE task_label (after.labelId)
            UD->>DB: UPDATE automation_run SET undone_at = now
        else action = board.delete
            UD->>DB: UPDATE board SET deleted_at=NULL, version+1
            loop each taskId in inverse.taskIds
                UD->>DB: UPDATE task SET deleted_at=NULL (board_id)
            end
        else unsupported
            UD-->>C: throw 409 CONFLICT
        end
        UD->>DB: DELETE undo_action (consumed)
        UD->>DB: INSERT activity_event("action.undone")
        UD-->>C: {undone:true, action}
    end
    C-->>B: 200 JSON
    B-->>U: state restored
```
