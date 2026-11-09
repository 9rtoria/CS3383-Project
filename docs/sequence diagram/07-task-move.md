# SD07 —Move Task between Columns

**Covers:** `TaskController.move` —`AppService.moveTask` —version check, WIP capacity, dependency check, `createNextOccurrence`,
`clearAutoPlanBlocks`, activity/audit/webhook/automation/undo.

Source: `app/AppService.java:2897`.

Inside `moveTask` the checks are performed **in a fixed order** (version —column —WIP —dependency —update —recurrence —effects) —a **delegated "stair"** inside the service, which
the lecture says fits when operations must always run in the same order. Guards are shown as
`[condition]`.

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

    U->>B: drag card to another column
    B->>T: PATCH /api/tasks/{id}/move {columnId, version}
    T->>A: moveTask(userId, taskId, input)
    A->>DB: SELECT task (version, column, board, completed)
    A->>A: requireMinimumRole(MEMBER), requireTaskBoardVisible
    alt version mismatch
        A-->>T: throw 409 CONFLICT(currentVersion)
        T-->>B: 409 —B refetches board
    end
    A->>DB: SELECT target column (board, isDone)
    A-->>A: [column on another board] 400 bad request
    opt moving to a different column
        A->>A: requireWipCapacity(target)
        A->>DB: COUNT open tasks in column
        A-->>A: [count >= wipLimit] throw 409 WIP_LIMIT
    end
    A->>A: movingToDone = target.isDone && !current.completed
    opt moving to done
        A->>A: openDependencyCount(taskId)
        A-->>A: [count > 0] throw 409 DEPENDENCY_BLOCKED
    end
    A->>DB: UPDATE task SET column_id, completed_at, version+1 WHERE version=?
    alt updated = 0 (race)
        A-->>T: throw 409 CONFLICT
    end
    opt completing
        A->>A: createNextOccurrence(userId, task, currentColumn)
        A->>DB: INSERT next task (recurrence)
        A->>A: copyNextOccurrenceReminders
    end
    opt target is done column
        A->>A: clearAutoPlanBlocks(taskId)
        A->>DB: DELETE plan_block(source='auto' AND locked=0)
    end
    A->>DB: INSERT activity_event ("task.moved"/"task.completed")
    A->>DB: INSERT audit_event
    A->>W: dispatch("task.moved"|"task.completed")   (async, SD16)
    A->>AU: runForEvent(...)                          (sync, SD17)
    A->>A: createUndo("task.move", inverse) —INSERT undo_action
    A-->>T: {task, undo, nextTaskId?}
    T-->>B: 200 JSON
    B-->>U: card in new column
```
