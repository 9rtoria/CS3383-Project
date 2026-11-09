# SD17 —Automation Rule Run (on task events)

**Covers:** `AutomationService.runForEvent / matches / applyRule / preview`,
called by `AppService.createTask / updateTask / moveTask / completeTask` and `bulkTaskAction`.

Source: `app/AutomationService.java`.

Synchronous and best-effort: each rule is wrapped in try/catch so one failing rule never aborts
the task operation. Uses `loop` (rules) + `alt` (condition match) + `alt` (action type). Each
applied run writes an undo entry and audit.

```mermaid
sequenceDiagram
    autonumber
    participant A as :AppService
    participant AU as :AutomationService
    participant N as :NotificationService
    participant DB as :JdbcTemplate
    participant UND as :UndoService

    A->>AU: runForEvent(workspace, event, taskId, actorId)
    AU->>DB: SELECT workspace.automations_enabled
    AU-->>AU: [disabled] return
    AU->>DB: snapshot(taskId) —priority, column, labels, completed
    AU->>DB: SELECT automation_rule WHERE enabled & trigger & board
    loop for each rule
        AU->>AU: matches(task, conditions_json)?
        alt conditions match
            AU->>AU: applyRule(workspace, task, rule, actorId)
            alt action = set_priority
                AU->>DB: UPDATE task SET priority
            else action = add_label
                AU->>DB: find/insert label, INSERT task_label
            else action = move_to_column
                AU->>DB: UPDATE task SET column_id, position
            else action = notify
                AU->>N: notify(recipient, "automation", message)
            end
            AU->>DB: INSERT automation_run(before_json, after_json)
            AU->>DB: UPDATE automation_rule SET last_run_at
            AU->>DB: INSERT activity_event("automation.applied")
            AU->>DB: INSERT audit_event("automation.applied")
            AU->>DB: INSERT undo_action("automation.run", ttl 60s)
        else no match
            Note over AU: skip rule
        end
    end
    AU-->>A: done (never throws)
```
