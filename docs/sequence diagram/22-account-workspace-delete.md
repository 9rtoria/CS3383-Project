# SD22 —Delete Account / Delete Workspace

**Covers:** `AccountController` —`AppService.updateAccount / deleteAccount`;
`WorkspaceController.delete` —`AppService.deleteWorkspace(userId, workspaceId)`.

Source: `app/AppService.java:131`, `147`, `197`.

Both flows guard with ownership checks, soft-delete, clear credentials, and revoke
sessions/tokens —a delegated "stair" inside the service. Note: account/session revocation is done
with direct `UPDATE` statements inside `AppService` (no `SessionService` call), and deleting a
workspace soft-deletes only the workspace row plus its tokens (no cascade to boards/tasks).

```mermaid
sequenceDiagram
    autonumber
    actor U as :Owner
    participant B as :Browser
    participant C as :AccountController
    participant WC as :WorkspaceController
    participant A as :AppService
    participant DB as :JdbcTemplate

    Note over U,DB: PATCH /api/account (profile)
    U->>B: edit display name / timezone
    B->>C: updateAccount(session, input)
    C->>A: updateAccount(userId, input)
    A->>A: validate name length, timezone length
    A->>DB: UPDATE app_user SET display_name
    A->>DB: UPDATE app_user SET timezone
    A-->>C: {user summary}

    Note over U,DB: DELETE /api/account
    U->>B: Delete my account
    B->>C: deleteAccount(session, {confirm})
    C->>A: deleteAccount(userId, input)
    alt confirm != "DELETE"
        A-->>C: throw 400 (type DELETE to confirm)
    end
    A->>DB: SELECT app_user (active?) — not found → 404
    A->>DB: SELECT memberships (role, workspace type, memberCount)
    alt owns a non-personal workspace with other members
        A-->>C: throw 409 (transfer ownership first)
    end
    A->>DB: UPDATE workspace SET deleted_at = now (personal workspaces only)
    A->>DB: UPDATE app_user SET deleted_at, email=NULL, password_hash=NULL, mfa fields cleared
    A->>DB: UPDATE auth_session SET revoked_at (all user sessions)
    A->>DB: UPDATE api_token SET revoked_at (all user tokens)
    A->>DB: INSERT audit_event("account.deleted") per non-personal workspace
    A-->>C: {deleted:true}
    C->>C: session.invalidate()

    Note over U,DB: DELETE /api/workspaces/{id}
    U->>B: Delete workspace
    B->>WC: delete(workspaceId)
    WC->>A: deleteWorkspace(userId, workspaceId)
    A->>A: role != OWNER → 403, then mfaGuard.requireSatisfied
    alt user has no other active workspace
        A-->>WC: throw 409 (create another workspace first)
    end
    A->>DB: UPDATE workspace SET deleted_at = now, version+1
    A->>DB: UPDATE api_token SET revoked_at (workspace tokens)
    A->>DB: INSERT audit_event("workspace.deleted")
    A-->>WC: {deleted:true}
    WC-->>B: 200 JSON
```
