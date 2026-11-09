# SD08 —Update Task (PATCH with optimistic locking)

**Covers:** `TaskController.update` —`AppService.updateTask`.
Field-presence-safe PATCH: only fields present in the JSON body are changed; `version` guards
concurrent edits (optimistic concurrency).

Source: `app/AppService.java:2641`.

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
    participant N as :NotificationService

    U->>B: edit fields in the task drawer (autosave)
    B->>T: PATCH /api/tasks/{id} {version, ...present fields}
    T->>A: updateTask(userId, taskId, input)
    A->>DB: SELECT task (currentVersion, ...)
    A->>A: requireMinimumRole(MEMBER), requireTaskBoardVisible
    alt input.version != currentVersion
        A-->>T: throw 409 CONFLICT(currentVersion)
        T-->>B: 409 —toast "changed elsewhere", reload
    end
    A->>A: normalize scalar fields present (assigneeId, dueDate/startDate/time, recurrenceRule)
    Note over A: normalizeAssignee / normalizeDateValue / parseLocalDateTime / normalizeRecurrence / parseRecurrence
    alt completed flips false→true
        A-->>A: [openDependencyCount > 0] throw 409 DEPENDENCY_BLOCKED
        A->>DB: SELECT done column, MAX(position)+1
    else completed flips true→false
        A->>DB: SELECT open column, MAX(position)+1
    end
    A->>DB: UPDATE task SET (only these columns), version+1 WHERE version=?
    alt updated = 0
        A-->>T: throw 409 CONFLICT
    end
    opt input.labels != null
        A->>DB: replaceTaskLabels (delete + upsert)
    end
    opt input.dependencyIds != null
        A->>A: replaceTaskDependencies (wouldCreateCycle?)
    end
    opt input.reminderOffsetMinutes != null
        A->>A: setReminderOffset (DELETE unsent, INSERT if future)
    end
    opt completedNow (false→true)
        A->>A: createNextOccurrence → INSERT next task
        A->>DB: INSERT activity+audit("task.completed")
        A->>W: dispatch("task.completed")   (async)
        A->>AU: runForEvent("task.completed")  (sync)
    end
    opt reopened (true→false)
        A->>DB: INSERT activity+audit("task.reopened")
    end
    opt dueDate/startDate/estimate/priority/completed/archived/dependencyIds changed
        A->>DB: DELETE plan_block WHERE task_id AND source='auto' AND locked=0
    end
    A->>DB: INSERT activity_event("task.updated")
    A->>DB: INSERT audit_event
    opt assignee set and != actor
        A->>N: notify(assignee, "task.assigned", ...)
    end
    A-->>T: {task, nextTaskId?}
    T-->>B: 200 JSON
    B-->>U: updated card
```
