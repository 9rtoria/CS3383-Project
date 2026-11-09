# SD06 —Create Task

**Covers:** `TaskController.create` —`AppService.createTask` —`replaceTaskLabels`, `setReminderOffset`, `notificationService.notify`,
`recordActivity`, `audit`, `webhookService.dispatch`, `automationService.runForEvent`,
`createUndo`.

Source: `api/TaskController.java`, `app/AppService.java:2288`.

This is the **centralized "fork"** style from the lecture: one method (`createTask`) drives many
independent operations whose order could change and into which new steps could be inserted
(notification / audit / webhook / automation / undo). The lecture recommends fork structure for
exactly this shape.

```mermaid
sequenceDiagram
    autonumber
    actor U as :User
    participant B as :Browser
    participant T as :TaskController
    participant A as :AppService
    participant N as :NotificationService
    participant W as :WebhookService
    participant AU as :AutomationService
    participant DB as :JdbcTemplate

    U->>B: "Add task" + form
    B->>T: POST /api/tasks  (Idempotency-Key, X-Workspace-Id)
    T->>A: createTask(userId, input)
    A->>A: validate title/ids, requireMinimumRole(MEMBER)
    A->>DB: SELECT board_column (workspace, isDone)
    A->>A: requireBoardVisible + requireWipCapacity(column)
    A->>DB: SELECT MAX(position)+1
    A->>DB: INSERT task (...)
    A->>A: replaceTaskLabels(taskId, labels[])
    A->>DB: INSERT task_label / upsert label
    opt reminder offset set
        A->>A: setReminderOffset(userId, taskId, due, offset)
        A->>DB: INSERT reminder(remind_at)
    end
    A->>DB: SELECT created task row
    opt assignee != creator
        A->>N: notify(assignee, workspace, taskId, "task.assigned", title, body, link)
        N->>DB: INSERT notification
    end
    A->>DB: INSERT activity_event("task.created")
    A->>DB: INSERT audit_event("task.created")
    A->>W: dispatch(workspace, "task.created", {taskId,title,column})
    Note over W: async —see SD16
    W-->>A: (returns immediately)
    A->>AU: runForEvent(workspace, "task.created", taskId, userId)
    Note over AU: sync rule evaluation —see SD17
    AU-->>A: done
    A->>A: createUndo("task.create", inverse)
    A->>DB: INSERT undo_action (ttl 10s)
    A-->>T: {task, undo}
    T-->>B: 201 Created JSON
    B-->>U: card appears + undo toast
```
