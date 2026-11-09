# SD10 —Bulk Task Actions

**Covers:** `TaskController.bulk` —`AppService.bulkTaskAction` (complete / archive / move / delete),
undo recorded as one entry.

Source: `app/AppService.java:2978`.

The lecture's iteration fragment (`loop`) models the per-task work; the whole operation is one
transaction and is **all-or-nothing** — a workspace mismatch, an open dependency (complete), or an
invalid target column aborts the whole call with an exception (no per-task `skip`). One
`activity_event`, one `audit_event`, and one `undo_action` are stored for all tasks.

```mermaid
sequenceDiagram
    autonumber
    actor U as :User
    participant B as :Browser
    participant T as :TaskController
    participant A as :AppService
    participant DB as :JdbcTemplate

    U->>B: select N cards —choose action
    B->>T: POST /api/tasks/bulk {workspaceId, action, taskIds[], columnId?}
    T->>A: bulkTaskAction(userId, input)
    A->>A: requireMinimumRole(MEMBER), validate action, reject blank workspaceId / >100 ids
    loop for each taskId
        A->>DB: SELECT task (workspace, column, position)
        A-->>A: [workspace mismatch] throw 404 "Task not found."
        A->>A: requireTaskBoardVisible
    end
    break tasks span more than one board
        A-->>T: throw 400 "Bulk actions require tasks from one board."
    end
    alt action = complete
        A->>DB: SELECT done column for board (throw 400 if none)
        loop for each task
            A-->>A: [not already done & open deps] throw 409 DEPENDENCY_BLOCKED
            A->>DB: UPDATE task column_id=done, completed_at=now
            opt task was not already completed
                A->>A: createNextOccurrence + clearAutoPlanBlocks + webhook dispatch + runForEvent
            end
        end
    else action = move
        A->>A: [blank columnId] throw 400 "Choose a destination column."
        A->>DB: SELECT target column — missing → 404 and other board → 400
        loop for each task
            A->>DB: UPDATE task SET column_id=target, position, completed_at
        end
    else action = archive
        loop for each task
            A->>DB: UPDATE task archived_at=now
        end
    else action = delete
        loop for each task
            A->>DB: UPDATE task deleted_at=now
        end
    end
    A->>A: collect inverse {taskId, previous columnId, position} (complete/move only)
    A->>DB: INSERT activity_event("task.bulk_<action>") once (entity_id = joined taskIds)
    A->>DB: INSERT audit_event("task.bulk_<action>", {count, action}) once
    A->>DB: INSERT undo_action("task.bulk_<action>", {taskIds, action, previous}, ttl 10s or 60s)
    A-->>T: {affected:n, undo?}
    T-->>B: 200 JSON
    B-->>U: toolbar clears, undo toast shows
```
