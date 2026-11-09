# SD20 —Workspace Export (JSON/CSV) & Task Import

**Covers:** `DataController` —`DataService.export / importData`,
`MfaGuard.requireSatisfied`, private-board filtering, CSV formula-injection protection.

Source: `app/DataService.java`.

Export is a **stair** (fixed order: role —MFA —workspace —boards —format). Import is an
`alt` on format, then a `loop` that creates tasks.

```mermaid
sequenceDiagram
    autonumber
    actor U as :Admin
    participant B as :Browser
    participant C as :DataController
    participant D as :DataService
    participant G as :MfaGuard
    participant DB as :JdbcTemplate

    Note over U,DB: GET /api/export?format=json|csv
    U->>B: Export workspace
    B->>C: export(workspaceId, format)
    C->>D: export(userId, workspaceId, format)
    D->>D: roleFor(userId, workspaceId)
    D->>G: requireSatisfied(userId, workspaceId)
    D-->>D: [required & not satisfied] throw 403 MFA_REQUIRED
    D->>DB: SELECT workspace
    D->>D: canSeePrivate = rank(role) >= ADMIN
    D->>DB: SELECT boards in workspace
    loop each board
        alt private & !canSeePrivate & !creator
            Note over D: skip board
        else
            D->>DB: SELECT columns, tasks, labels, subtasks
            D->>D: exportBoard(...)
        end
    end
    D->>DB: INSERT audit_event("workspace.exported")
    alt format = csv
        D->>D: csvExport(boards)  (formula-injection escape)
        D-->>C: ExportFile(text/csv)
    else format = json
        D->>D: objectMapper.writeValueAsBytes(payload)
        D-->>C: ExportFile(application/json)
    end
    C-->>B: file download

    Note over U,DB: POST /api/import {workspaceId, boardId, format, content}
    U->>B: choose CSV/JSON file
    B->>C: import(input)
    C->>D: importData(userId, input)
    D->>D: validate workspaceId/boardId, role >= MEMBER, MFA guard, content not blank & <= 5MB
    D->>DB: SELECT board (visibility check for private)
    D->>DB: SELECT board columns
    D-->>D: [no columns] throw 400 "That board has no columns."
    alt format = json
        D->>D: jsonTasks(content)
    else format = csv
        D->>D: csvTasks(content)
    end
    D-->>D: [0 candidates] throw 400
    D-->>D: [> 1000] throw 400
    loop each candidate task
        D->>DB: INSERT task (map column by id, else name, else first)
        D->>DB: INSERT task_label (create label if missing)
    end
    D-->>D: [write fails] throw 409 "Import stopped…"
    D->>DB: INSERT audit_event("workspace.imported")
    D-->>C: {imported:n, skipped}
    C-->>B: 200 JSON
```
