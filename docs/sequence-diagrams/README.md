# Sequence Diagrams — Drift (Project3383)

UML sequence diagrams for the Drift task planner, drawn following the guidelines in
*Topic 5 — Designing Object Interactions (UML Sequence Diagram)*.

## Notation used (from the lecture)

- **Frame**: every diagram is inside a frame labelled `sd <Name>`.
- **Lifelines**: one vertical line per object, named `object : Class`.
- **Messages**: horizontal arrows from sender to receiver.
  - Solid arrow = **synchronous** message (caller blocks until the callee returns).
  - Dashed arrow = **return** / reply message (value shown only when not obvious).
  - Open/top arrow = **asynchronous** message (caller does not block).
- **Execution occurrence**: the thin bar on a lifeline while an object is executing.
- **Object creation**: a message whose arrow-head points **at** the object box (`<<create>>`).
- **Labels**: `[condition]` guard in front of a message (3-arg `alt`/`opt` fragments are used
  for if/else; `loop` for iteration; `break` for early exit).
- **ref** fragments are used to reuse sub-flows defined in other diagrams.
- Control style (centralized "fork" vs delegated "stair") is noted per diagram where relevant.

## Layering (objects in these diagrams)

| Layer | Object | Responsibility |
|---|---|---|
| UI | Browser (app.js) | Sends `fetch` requests, renders views |
| Web | `XxxController : XxxController` | Maps HTTP, reads `HttpSession`, delegates |
| Cross-cutting | `AuthInterceptor`, `IdempotencyInterceptor` | Session/token auth, CSRF, idempotency |
| Domain | `AppService`, `AutoPlanService`, `DataService`, … | Business rules, transactions, SQL |
| Integration | `NotificationService`, `WebhookService`, `EmailDeliveryService`, `OAuthService`, `SsoService` | External side-effects |
| Scheduler | `ReminderScheduler`, `DigestScheduler`, `RetentionScheduler` | Time-triggered jobs |
| Persistence | `JdbcTemplate`, SQLite `data/project3383.db` | Storage |

All persistence is reached through `JdbcTemplate` (a `<Database>` participant). To keep the
diagrams readable, individual SQL statements are collapsed into the service call that issues them.

## Inventory of diagrams (functions that need a SD)

| # | File | Function / flow | Control style |
|---|---|---|---|
| 01 | `01-authentication-session.md` | Guest sign-in, password sign-in, MFA challenge, sign-out, session touch | Centralized (Controller) |
| 02 | `02-oauth-signin.md` | GitHub / Google / Apple OAuth redirect + callback | Centralized |
| 03 | `03-magic-link-signin.md` | Passwordless magic-link request + verify | Centralized |
| 04 | `04-sso-oidc-signin.md` | Organization OIDC discovery + callback | Centralized |
| 05 | `05-mfa-setup.md` | TOTP setup / enable / disable, session revoke | Centralized |
| 06 | `06-task-create.md` | Create task (+ labels, reminder, notify, audit, webhook, automation, undo) | Centralized "fork" (side-effects fan out) |
| 07 | `07-task-move.md` | Move between columns (WIP, version, dependency, recurrence) | Delegated "stair" inside service |
| 08 | `08-task-update.md` | Patch task with optimistic version check | Delegated |
| 09 | `09-task-complete-undo.md` | Complete / reopen + undo | Centralized |
| 10 | `10-task-bulk.md` | Bulk complete / archive / move / delete | Centralized (loop) |
| 11 | `11-board-create.md` | Create board from template + starter columns | Delegated "stair" |
| 12 | `12-board-share.md` | Toggle public share + anonymous public board read | Centralized |
| 13 | `13-workspace-invite.md` | Create invite + accept invite | Centralized |
| 14 | `14-attachment.md` | Upload / download attachment to local FS | Delegated |
| 15 | `15-notification-reminder.md` | Notification creation + reminder scheduler | Centralized |
| 16 | `16-webhook-dispatch.md` | Async webhook dispatch + retry | Asynchronous / decentralized |
| 17 | `17-automation-run.md` | Automation rule evaluation on task events | Centralized (loop + alt) |
| 18 | `18-auto-plan.md` | Auto-plan preview / apply / clear | Delegated |
| 19 | `19-undo.md` | Undo a recorded action | Centralized (alt switch) |
| 20 | `20-export-import.md` | Workspace export (JSON/CSV) + task import | Delegated |
| 21 | `21-api-token-idempotency.md` | Bearer API-token auth + idempotent replay | Centralized (interceptors) |
| 22 | `22-account-workspace-delete.md` | Delete account / workspace (ownership, anonymize, revoke) | Centralized |
| 23 | `23-scheduled-jobs.md` | Housekeeping / retention / digest / email delivery | Time-driven loops |
| 24 | `24-settings.md` | Load + autosave personal settings | Delegated |

## How to render

Each file contains a [Mermaid](https://mermaid.js.org/syntax/sequenceDiagram.html) code block.
Mermaid supports every element required by the lecture: `participant`, `actor`, solid/dashed
arrows, `activate`/`deactivate`, `alt`/`opt`/`loop`/`break`, and `Note`. Paste a block into
<https://mermaid.live> or a Markdown viewer to get the picture, or import the `.md` into
Visual Paradigm (it can parse Mermaid sequence syntax) for the deliverable format.

Message arrow syntax used:

```
A->>B : synchronous message           (solid, filled head)
B-->>A : return value                  (dashed open head)
A-)B  : asynchronous message           (open head, non-blocking)
A->>B : [guard] guarded message        (condition in square brackets)
alt ... else ... end / opt ... end / loop ... end / break ... end
```
