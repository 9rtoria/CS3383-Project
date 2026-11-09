# SD12 —Public Board Share (toggle + anonymous read)

**Covers:** `AppController.shareBoard` —`AppService.toggleBoardShare`; `SharePageController` (HTML
`/share/{token}`) and `ShareController.sharedBoard` (JSON `/api/share/{token}`) —`AppService.publicBoard`
(FOUND message: no session).

Source: `app/AppService.java:1412`, `app/AppService.java:1440`, `api/ShareController.java`.

Toggle is authenticated and guarded by workspace policy; the read side has **no session**
(found message from an unknown source / a lost message back). This shows the lecture's
found/lost-message idea.

```mermaid
sequenceDiagram
    autonumber
    actor U as :User
    actor V as :PublicVisitor
    participant B as :Browser
    participant C as :AppController
    participant SP as :SharePageController
    participant SC as :ShareController
    participant A as :AppService
    participant DB as :JdbcTemplate

    Note over U,DB: POST /api/boards/{id}/share   (enable/disable)
    U->>B: toggle "Share board"
    B->>C: share(boardId, {enabled})
    C->>A: toggleBoardShare(userId, boardId, input)
    A->>DB: SELECT board
    A->>A: requireMinimumRole(MEMBER), requireBoardVisible
    A->>DB: SELECT workspace.type, public_sharing_enabled
    A-->>A: [sharing disabled] throw 403 forbidden
    alt enabled and no token
        A->>A: token = randomToken()
    else disabled
        A->>A: token = null
    end
    A->>DB: UPDATE board SET share_enabled, share_token, version+1
    A->>DB: INSERT audit_event("board.share_enabled|disabled")
    A-->>C: {enabled, token}
    C->>C: url = base + "/share/" + token (null when disabled)
    C-->>B: {enabled, token, url}

    Note over V,DB: GET /share/{token}  (page) then /api/share/{token}  (JSON, no login)
    V->>SP: open /share/{token}
    SP-->>V: forward:/share.html (no AppService call)
    V->>SC: GET /api/share/{token}
    Note over SC: found message —no authenticated sender
    SC->>A: publicBoard(token)
    A->>DB: SELECT board JOIN workspace WHERE share_token & enabled & not deleted
    alt not found / disabled / workspace sharing off
        A-->>SC: throw 404 NOT_FOUND
        SC-->>V: JSON {code:"NOT_FOUND"}
    end
    A->>DB: SELECT columns, tasks, labels, subtasks
    A->>A: build limited read-only projection (no private fields)
    A-->>SC: {board:{name, description, workspaceName, updatedAt, columns, tasks}}
    SC-->>V: read-only board
```
