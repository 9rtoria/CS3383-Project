# SD13 — Workspace Invite (create + preview + accept)

**Covers:** `WorkspaceController.invite` → `AppService.invite`;
`InviteController.preview` → `AppService.invitePreview`;
`InviteController.accept` → `AppService.acceptInvite`.

Source: `api/InviteController.java`, `api/WorkspaceController.java`,
`app/AppService.java:503` (invite), `:786` (invitePreview), `:530` (acceptInvite).

Invite creation requires an email and a role; the expiry is fixed at seven days. The service
returns invite metadata and the raw token — it does **not** mint a `/invite/{token}` link.
`requireMinimumRole` is an `AppService` self-call.

```mermaid
sequenceDiagram
    autonumber
    actor U as :Admin
    actor G as :Invitee
    participant B as :Browser
    participant WC as :WorkspaceController
    participant IC as :InviteController
    participant A as :AppService
    participant DB as :JdbcTemplate

    Note over U,DB: POST /api/workspaces/{id}/invites
    U->>B: create invite (email + role)
    B->>WC: invite(workspaceId, {email, role})
    WC->>A: invite(userId, workspaceId, input)
    A->>A: requireMinimumRole(ADMIN)
    A->>A: validate email, normalize role to ADMIN, GUEST or MEMBER
    A->>A: token = UUID + UUID
    A->>A: expiresAt = now + 7 days (fixed)
    A->>DB: INSERT invite(id, workspace, email, role, token_hash, expires_at, accepted_at=NULL)
    A->>DB: INSERT audit_event("invite.created")
    A-->>WC: {invite:{id,email,role,expiresAt}, token}
    WC-->>B: invite metadata + raw token (not a generated link)
    U->>G: shares token out-of-band

    Note over G,DB: GET /api/invites/{token}  — preview (allowed without session)
    G->>IC: preview(token)
    IC->>A: invitePreview(token, viewerId?)
    A->>DB: SELECT invite JOIN workspace WHERE token_hash
    alt not found
        A-->>IC: throw 401 INVALID_TOKEN
    end
    alt accepted or expired
        A-->>IC: throw 401 INVALID_TOKEN
    end
    A->>A: canAccept = viewer email matches invitee (non-guest)
    A-->>IC: {invite:{email,role,workspace,expiresAt}, canAccept}
    IC-->>G: invitation page

    Note over G,DB: POST /api/invites/{token}  — accept (signed in)
    G->>IC: accept(token)
    IC->>A: acceptInvite(userId, token)
    A->>DB: SELECT invite WHERE token_hash
    alt not found
        A-->>IC: throw 404 NOT_FOUND
    end
    alt already accepted
        A-->>IC: throw 400 "already accepted"
    end
    alt expired
        A-->>IC: throw 400 "has expired"
    end
    A->>DB: SELECT app_user (current email)
    alt email != invite.email
        A-->>IC: throw 403 "sign in with invited email"
    end
    A->>DB: INSERT membership ON CONFLICT(user_id,workspace_id) DO UPDATE SET role=excluded.role
    A->>DB: UPDATE invite SET accepted_at = now
    A->>DB: INSERT audit_event("invite.accepted")
    A-->>IC: bootstrap(userId)
    IC-->>G: switch to workspace
```
