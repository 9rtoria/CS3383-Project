# Project3383

A new implementation of the Drift task planner, built with **Java + Spring Boot + SQLite + plain HTML/CSS/JavaScript**. The existing `ProjectA2` is kept untouched as the reference.

## Current milestone

See `docs/PARITY.md` for the API/model/UI status and `docs/ACCEPTANCE.md` for the build, browser, accessibility, performance, and security acceptance report.

Implemented:

- Spring Boot 3.5 application on port `3383`
- SQLite schema with Flyway versioned migrations
- Guest session creation (`POST /api/auth/guest`)
- Email/password sign-up, sign-in, guest claim, and sign-out
- Passwordless magic-link sign-in and a dedicated `/auth` page with password, signup, magic-link, MFA, and provider buttons
- GitHub, Google, and JWKS-verified Apple OAuth redirect/callback with guest claim and account linking
- Persistent `auth_session` rows with sliding expiry, device/UA visibility, and remote revocation
- Bootstrap payload with workspaces, boards, columns, labels, and the board-template catalog
- Workspace create/switch, including a new team workspace
- Workspace members, invite links, role changes, and member removal
- Board create/read/update/delete, templates, duplicate, archive/restore, and private visibility
- Board column create/edit/delete/reorder, WIP limits/enforcement, done columns, and archived boards in Archive
- Public read-only board share links
- Task create / update / move / soft-delete APIs
- Task assignee, recurrence rules, and automatic next-occurrence creation
- Task detail API with comments, checklist, labels, dependencies, attachments, activity, completion, and reopen
- Attachment upload/download/delete with local storage, MIME allowlist, and 10 MB limit
- Task start date, all-day due date, due time, reminder offsets, and tracked actual minutes
- Task drawer status change, complete/reopen toggle, checklist suggestions/deletion, copy link, archive, dependencies, comments, attachments, and activity
- Version-based 409 conflict handling and field-presence-safe PATCH semantics
- Today list with capacity and accept/dismiss actions
- Plain HTML/CSS/JS UI:
  - Today view
  - Board view
  - Task create/edit modal
  - Drag task between columns
  - Delete task
  - Sign out
- JUnit/MockMvc suite covering auth/sessions, boards/columns/WIP/templates, task patches, invites, idempotency, labels/views/metrics/OpenAPI, Today, archive, enterprise controls, and security
- Reminders, in-app notifications, polling, visible-tab chime, permission-gated browser notifications, and optional SMTP delivery
- Workspace-scoped, per-user Today selection with capacity, reasons, blocked-dependency state, rebalance, and applyPlan
- Day Flow 24-hour time rail with capacity ring, now marker, chosen/suggested blocks, drag-to-Later, and Rebalance
- Focus Mode full-screen timer with pause/resume, complete, early leave, and actual-minutes persistence
- Sound layer and Sound Lab: synthesized interface sounds, three palettes, volume, typing texture, previews, and localStorage persistence
- Quick Capture with natural-language parsing and browser voice input with text fallback
- English / Traditional Chinese locale with settings-driven persistence and translated core surfaces
- Offline/PWA: service worker, manifest, cached views, queued writes with idempotency keys, retry/discard, online replay, explicit 409 failures, and a dedicated `/offline` page
- Day Flow, Smart Plan-style preview, and deterministic Auto-plan apply/clear
- Auto-plan settings integration and five-minute undo (`/api/undo/{id}`)
- Undo toast actions for task create / complete / move / delete and board delete
- Multi-select bulk complete / archive / delete / move with undo
- Command palette with task search, board jumps, theme/settings commands, and keyboard navigation
- Keyboard shortcuts: C, /, ?, G sequences, Shift+N, Ctrl/Cmd+K, Alt+Arrow move/reorder, single-key toggle
- Workspace API tokens with bearer authentication, workspace scoping, expiry, and revocation
- Admin audit log with cursor pagination, actor details, and configurable retention
- Admin webhooks for Slack, Microsoft Teams, and generic JSON with HMAC signing, async delivery, retries, and delivery status
- Admin automations for task created/moved/completed events with priority, label, column, and notify actions, draft impact previews, run history, notifications, and 60-second undo
- Workspace JSON/CSV export and CSV/JSON task import with private-board filtering and CSV formula-injection protection
- Account and workspace deletion with ownership guards, credential anonymization, session/token revocation, audit, and local-cache clearing
- TOTP two-factor authentication with QR setup, encrypted secrets, one-time backup codes, sign-in challenge, and disable guard
- Versioned workspace policies for required MFA, automations, attachments, public sharing, archived-task retention, and audit retention, with MFA and attachment enforcement
- Organization SSO through OIDC discovery/callback with encrypted client secrets, domain allowlists, guest account linking, and MFA handoff
- Auto-plan safe/full/delegated modes, background refresh, task-change invalidation, stale-task archive cleanup, and archive visibility
- Calendar month view with configurable week start and selected-day panel, tokenized task search with status/priority/board filters, rich timeline/workload Insights, and redesigned Upcoming/Archive views with reopen and restore
- ICS download plus a Settings calendar feed row
- Labels, saved views, metrics, OpenAPI, client-error intake, and workspace-list APIs
- `/settings`, `/settings#section`, `/offline`, `/invite/{token}`, `?view=`, `?board=`, and `?task=` deep links
- `SEED_DEMO=true` demo account/workspace seed (`demo@drift.local` / `DriftDemo123!`)
- Reminder, retention, and email workers with in-process scheduling
- Personal Settings workspace: account display name/timezone, appearance, language/region, planning, auto-plan, focus/capture, notifications, features, autosave, and per-section defaults
- Settings storage/API (`/api/settings` GET/PATCH) and account profile update (`/api/account` PATCH)
- Origin-based CSRF protection for cookie-authenticated mutations

Remaining deployment or verification work:

- Live OAuth/SMTP/external OIDC verification with real provider credentials
- Production HTTPS/`Secure` cookies, forwarded-header policy, and static caching
- Optional full Spring Security filter-chain/token-based CSRF migration
- Manual NVDA/VoiceOver pass and the last provider/admin Traditional Chinese strings
- Exact auto-plan scoring-weight tie-break comparison with the reference

The current Phase 0 parity matrix is at:

`docs/PARITY.md`

The full phased checklist is at:

`C:\Users\yanpi\.opencode\plan\Project3383-rewrite-checklist.md`

The final acceptance report, including screenshots and QA results, is at:

`docs/ACCEPTANCE.md`

## Run

JDK 17 is required. On this machine the default `java` command points to Java 8, so set `JAVA_HOME` first:

```powershell
$env:JAVA_HOME='C:\Program Files\Eclipse Adoptium\jdk-17.0.17.10-hotspot'
$env:Path="$env:JAVA_HOME\bin;$env:Path"
.\mvnw.cmd spring-boot:run
```

Open <http://localhost:3383>.

Alternative:

```powershell
.\mvnw.cmd -DskipTests package
java -jar target\project3383-0.0.1-SNAPSHOT.jar
```

The database file is created at `data/project3383.db`. Delete it to reset the local demo data.

## Test

```powershell
$env:JAVA_HOME='C:\Program Files\Eclipse Adoptium\jdk-17.0.17.10-hotspot'
$env:Path="$env:JAVA_HOME\bin;$env:Path"
.\mvnw.cmd test
```

## API currently available

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/guest` | Create/resume a guest session |
| POST | `/api/auth/signup` | Create an account or claim the current guest |
| POST | `/api/auth/signin` | Sign in with email/password |
| POST | `/api/auth/magic` | Email a one-time sign-in link and return the development link |
| GET | `/api/auth/magic/verify` | Consume a magic link and start a session or MFA challenge |
| DELETE | `/api/auth/signout` | Invalidate the session |
| POST | `/api/auth/mfa/challenge` | Complete a sign-in challenge with TOTP or a backup code |
| GET | `/api/auth/sso/{workspaceId}` | Start organization OIDC sign-in |
| GET | `/api/auth/sso/{workspaceId}/callback` | OIDC callback, linking, and MFA handoff |
| GET | `/api/security/mfa` | MFA status and active-session list |
| POST | `/api/security/mfa` | Setup, enable, or disable TOTP |
| DELETE | `/api/security/mfa` | Revoke another session record |
| GET | `/api/health` | Health check |
| GET | `/api/bootstrap` | User/workspace/board bootstrap |
| DELETE | `/api/account` | Anonymize and soft-delete the current account |
| POST | `/api/workspaces` | Create a personal/team workspace |
| GET | `/api/workspaces/{id}` | Workspace details, policies, role, and board count |
| PATCH | `/api/workspaces/{id}` | Versioned workspace policy update |
| DELETE | `/api/workspaces/{id}` | Soft-delete an owner workspace |
| GET | `/api/workspaces/{id}/sso` | Organization SSO configuration |
| PUT | `/api/workspaces/{id}/sso` | Save/enable/disable organization OIDC config |
| DELETE | `/api/workspaces/{id}/sso` | Remove organization SSO |
| GET | `/api/workspaces/{id}/members` | List workspace members |
| POST | `/api/workspaces/{id}/invites` | Create an invite link |
| PATCH | `/api/workspaces/{id}/members/{userId}` | Change a member role |
| DELETE | `/api/workspaces/{id}/members/{userId}` | Remove a member |
| POST | `/api/invites/{token}` | Accept an invitation |
| POST | `/api/boards` | Create a board and its starter columns |
| GET | `/api/boards/{id}` | Board with columns and tasks |
| PATCH | `/api/boards/{id}` | Rename, describe, set visibility, archive/restore |
| DELETE | `/api/boards/{id}` | Soft-delete a board |
| POST | `/api/boards/{id}/duplicate` | Duplicate a board with tasks |
| POST | `/api/boards/{id}/share` | Enable/disable a public read-only link |
| GET | `/api/share/{token}` | Public read-only board payload |
| GET | `/api/today` | Open-task list with capacity and day blocks |
| POST | `/api/today` | Accept or dismiss a task for today |
| POST | `/api/auto-plan` | Preview, apply, or clear the deterministic plan |
| GET | `/api/tokens` | List personal workspace API tokens |
| POST | `/api/tokens` | Create an API token and return the raw token once |
| DELETE | `/api/tokens/{id}` | Revoke an API token |
| GET | `/api/audit` | Admin audit feed with cursor pagination |
| GET | `/api/automations` | Admin automation rules with recent runs and a live preview |
| POST | `/api/automations` | Create an automation rule |
| POST | `/api/automations/preview` | Dry-run a draft rule and return the diff |
| PATCH | `/api/automations/{id}` | Update or enable/disable a rule |
| DELETE | `/api/automations/{id}` | Delete a rule |
| GET | `/api/webhooks` | Admin webhook list with delivery counts and last status |
| POST | `/api/webhooks` | Create a webhook and return the signing secret once |
| PATCH | `/api/webhooks/{id}` | Enable/disable or update a webhook |
| DELETE | `/api/webhooks/{id}` | Delete a webhook |
| GET | `/api/export` | Download workspace JSON or task CSV |
| POST | `/api/import` | Import tasks from CSV or JSON into a board |
| POST | `/api/tasks` | Create a task |
| POST | `/api/tasks/bulk` | Bulk complete, archive, delete, or move tasks |
| GET | `/api/tasks/{id}` | Task detail with comments and checklist |
| PATCH | `/api/tasks/{id}` | Update a task with version check |
| PATCH | `/api/tasks/{id}/move` | Move a task to another column |
| POST | `/api/tasks/{id}/complete` | Move a task to the Done column |
| POST | `/api/tasks/{id}/reopen` | Move a task back to the first open column |
| POST | `/api/tasks/{id}/restore` | Restore an archived task |
| DELETE | `/api/tasks/{id}` | Soft-delete a task |
| GET | `/api/search` | Tokenized title/description/label search with status, priority, board, label, and date filters |
| GET | `/api/upcoming` | Due-date groups for a 1–60 day horizon |
| GET | `/api/archive` | Archived and completed tasks with timestamps |
| POST | `/api/tasks/{id}/comments` | Add a comment |
| POST | `/api/tasks/{id}/subtasks` | Add a checklist item |
| PATCH | `/api/subtasks/{id}` | Update a checklist item |
| POST | `/api/tasks/{id}/attachments` | Upload an attachment |
| GET | `/api/attachments/{id}` | Download an attachment |
| DELETE | `/api/attachments/{id}` | Delete an attachment |
| POST | `/api/tasks/{id}/reminders` | Set a reminder |
| DELETE | `/api/reminders/{id}` | Remove a reminder |
| GET | `/api/notifications` | List in-app notifications |
| PATCH | `/api/notifications/{id}/read` | Mark one notification read |
| PATCH | `/api/notifications/read-all` | Mark all notifications read |

## Guardrails

- Do not modify `ProjectA2`.
- This project is intentionally using plain Java/HTML/CSS/JS rather than Next.js/React/Prisma.
- Add features in phases and keep the parity checklist honest.
