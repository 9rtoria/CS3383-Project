# SD11 —Create Board (from template)

**Covers:** `AppController.createBoard` —`AppService.createBoard`,
`BoardTemplates.find`, per-column insert, audit.

Source: `app/AppService.java:965`, `app/BoardTemplates.java`.

This is a **delegated "stair"**: the operations form a fixed procedural sequence
(board —columns in order —audit) that always runs the same way; the lecture says stair layout
is appropriate for that shape.

```mermaid
sequenceDiagram
    autonumber
    actor U as :User
    participant B as :Browser
    participant C as :AppController
    participant A as :AppService
    participant TPL as :BoardTemplates
    participant DB as :JdbcTemplate

    U->>B: New board —name + template
    B->>C: POST /api/boards {workspaceId, name, template, visibility}
    C->>A: createBoard(userId, input)
    A->>A: validate name length, requireMinimumRole(MEMBER)
    A->>TPL: find(input.template)
    TPL-->>A: Template(description, columns[])
    A->>DB: COUNT boards in workspace  [>=20] —400
    A->>DB: SELECT MAX(position)+1
    A->>DB: INSERT board (...)
    loop for i in template.columns
        A->>DB: INSERT board_column (name, position=i, is_done, wip_limit, wip_enforced)
    end
    A->>DB: INSERT audit_event("board.created")
    A-->>C: {board}
    C-->>B: 200 JSON
    B-->>U: board opens with starter columns
```
