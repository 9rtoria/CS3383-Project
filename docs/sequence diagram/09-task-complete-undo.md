# SD09 —Complete / Reopen Task + Undo

**Covers:** `TaskController.complete / reopen` —`AppService.completeTask(userId, taskId, completed)`,
recurrence via `createNextOccurrence`, plus `UndoController.undo` —`UndoService.undo`.

Source: `app/AppService.java:3153`, `app/UndoService.java`.

`complete` and `reopen` share the same method; the boolean picks the target column. Completing
records an undo entry; reopening does not.

```mermaid
sequenceDiagram
    autonumber
    actor U as :User
    participant B as :Browser
    participant T as :TaskController
    participant A as :AppService
    participant DB as :JdbcTemplate
    participant W as :WebhookService
    participant AU as :AutomationService

    U->>B: tick complete (or reopen)
    B->>T: POST /api/tasks/{id}/complete  (or /reopen)
    T->>A: completeTask(userId, taskId, completed)
    A->>DB: SELECT task
    A->>A: requireMinimumRole(MEMBER), requireTaskBoardVisible
    opt completed = true
        A->>A: openDependencyCount(taskId)
        A-->>A: [count > 0] throw 409 DEPENDENCY_BLOCKED
    end
    A->>DB: SELECT first done (or open) column
    alt none found
        A-->>T: throw 400 "no suitable column"
    end
    A->>DB: UPDATE task SET column_id, completed_at, version+1
    opt completed
        A->>A: clearAutoPlanBlocks(taskId)
        A->>A: createNextOccurrence(...)  (only if not already completed)
        A->>DB: INSERT next task
    end
    A->>DB: INSERT activity_event("task.completed"|"task.reopened")
    A->>DB: INSERT audit_event
    opt completed
        A->>W: dispatch("task.completed")      (sync, delivery async — SD16)
        A->>AU: runForEvent("task.completed")  (sync)
        A->>A: createUndo("task.complete", {columnId, previousCompleted, nextTaskId})
        A->>DB: INSERT undo_action (ttl 10s)
    end
    A-->>T: {task, undo?, nextTaskId?}
    T-->>B: 200 JSON

    Note over U,DB: user taps "Undo" within 10s
    B->>T: POST /api/undo/{id}
    T->>A: UndoService.undo(userId, undoId)
    A->>DB: SELECT undo_action WHERE id & user & not expired
    alt expired / missing
        A-->>T: 404 "Undo window expired"
    end
    A->>A: switch(action)
    alt task.complete / task.move / task.reopen
        A->>DB: UPDATE task SET deleted_at = now WHERE id = inverse.nextTaskId (soft-delete, if any)
        A->>DB: UPDATE task SET column_id = inverse.columnId
    else task.create
        A->>DB: UPDATE task SET deleted_at = now
    else task.delete
        A->>DB: UPDATE task SET deleted_at = NULL
    end
    A->>DB: DELETE undo_action, INSERT activity_event("action.undone")
    A-->>T: {undone:true, action}
    T-->>B: 200 JSON
```
