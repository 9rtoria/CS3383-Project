# Project3383 ??Phase 0 Parity Matrix

**Reference:** ProjectA2 `a78abe2`  
**Baseline visuals:** `C:\Users\yanpi\OneDrive\桌面\ProjectA2\docs\screenshots`  
**Baseline demo:** `C:\Users\yanpi\OneDrive\桌面\ProjectA2\docs\DEMO.md`  
**Target:** Spring Boot 3.5 / Java 17 / SQLite / HTML-CSS-vanilla JS  
**Last updated:** 2026-11-01

Status key:

- **DONE** ??user-visible behavior and API exist in Project3383
- **PARTIAL** ??some behavior/API exists, but parity gaps remain
- **SCHEMA** ??database table exists, service/UI not yet implemented
- **MISSING** ??not implemented

> This is the Phase 0 source of truth. A feature is not considered ported merely because a table or route exists.

## 1. API parity (64 reference paths)

| Reference path | Project3383 status | Notes |
|---|---|---|
| `/api/account` | DONE | Profile update; DELETE anonymizes the user, soft-deletes personal workspaces, revokes tokens/sessions, and audits |
| `/api/archive` | DONE | Completed and explicitly archived tasks with timestamps, labels, board, and account for reopen/restore |
| `/api/attachments` | PARTIAL | Upload is `/api/tasks/{id}/attachments`; no top-level list/upload |
| `/api/attachments/{id}` | DONE | Download/delete |
| `/api/audit` | DONE | Admin audit feed with cursor pagination and retention purge |
| `/api/auth/guest` | DONE | Guest session |
| `/api/auth/magic` | DONE | Session-bound state, SHA-256 token, 15-minute expiry, queued email with development link |
| `/api/auth/magic/verify` | DONE | One-time atomic consumption, state match, account creation, MFA handoff, safe redirect |
| `/api/auth/mfa/challenge` | DONE | In-memory 5-minute challenge; TOTP or one-time backup code |
| `/api/auth/oauth/{provider}` | MISSING | |
| `/api/auth/oauth/{provider}/callback` | MISSING | |
| `/api/auth/signin` | DONE | Password sign-in |
| `/api/auth/signout` | DONE | Session invalidate |
| `/api/auth/signup` | DONE | Guest claim supported |
| `/api/auth/sso/{workspaceId}` | DONE | OIDC discovery, state/nonce redirect for enabled org configs |
| `/api/auth/sso/{workspaceId}/callback` | DONE | State validation, code exchange, userinfo, domain check, account linking, MFA handoff |
| `/api/auto-plan` | PARTIAL | Settings-aware preview/apply/clear, safe mode, delegated stale cleanup, refresh/invalidation, undo; exact reference recompute/UI pending |
| `/api/automations` | DONE | Admin rule list with runs and preview; create with audit |
| `/api/automations/preview` | DONE | Side-effect-free draft diff with skipped reasons |
| `/api/automations/{id}` | DONE | Enable/disable, edit, delete |
| `/api/boards` | DONE | GET/POST with description, color, and visibility |
| `/api/boards/{id}` | DONE | GET/PATCH/DELETE with version checks and soft delete |
| `/api/boards/{id}/duplicate` | DONE | Copies columns, tasks, labels, assignee, and recurrence |
| `/api/boards/{id}/share` | DONE | Toggle a read-only public link for team workspaces |
| `/api/share/{token}` | DONE | Public read-only board payload and page |
| `/api/bootstrap` | DONE | Core payload; no settings/theme bundle yet |
| `/api/calendar` | DONE | Date-range tasks and plan blocks |
| `/api/calendar/ics` | DONE | Authenticated ICS download |
| `/api/client-errors` | MISSING | Schema only |
| `/api/columns` | MISSING | |
| `/api/columns/reorder` | MISSING | |
| `/api/columns/{id}` | MISSING | |
| `/api/export` | DONE | JSON workspace export and formula-safe CSV; private-board filtering; audit |
| `/api/health` | DONE | |
| `/api/import` | DONE | CSV/JSON tasks into a board with columns, labels, assignee, due dates, estimates, and skip counts |
| `/api/insights` | PARTIAL | Basic counts/priority breakdown |
| `/api/invites/{token}` | PARTIAL | POST accept; no public GET preview |
| `/api/labels` | MISSING | Labels are created through task input, no label API |
| `/api/metrics` | MISSING | |
| `/api/notifications` | DONE | GET + mark read/read-all |
| `/api/openapi` | MISSING | |
| `/api/search` | DONE | Tokenized title/description/label search with status, priority, board, label, and date filters; empty query returns recent tasks |
| `/api/security/mfa` | DONE | Status/sessions, TOTP setup with QR, enable with backup codes, disable guard, session revoke rows |
| `/api/settings` | PARTIAL | GET/PATCH personal preferences; settings UI ported |
| `/api/share/{token}` | DONE | Public read-only board payload and `/share/{token}` page |
| `/api/subtasks/{id}` | PARTIAL | PATCH; DELETE not exposed |
| `/api/tasks` | DONE | GET list, POST create |
| `/api/tasks/bulk` | DONE | Complete, archive, delete, and move up to 100 tasks with undo |
| `/api/tasks/{id}` | DONE | GET/PATCH/DELETE |
| `/api/tasks/{id}/comments` | DONE | POST; detail returns comments |
| `/api/tasks/{id}/move` | DONE | |
| `/api/tasks/{id}/reorder` | DONE | Keyboard order up/down with undo |
| `/api/tasks/{id}/subtasks` | DONE | POST; detail returns checklist |
| `/api/today` | DONE | Workspace-scoped GET, per-user selection, accept/dismiss/rebalance/applyPlan, counts |
| `/api/tokens` | DONE | List/create personal workspace API tokens |
| `/api/tokens/{id}` | DONE | Revoke token |
| `/api/undo/{id}` | DONE | Auto-plan, task create/complete/move/delete, board delete, and bulk action undo hooks |
| `/api/upcoming` | DONE | Due-date groups |
| `/api/views` | MISSING | Schema only |
| `/api/webhooks` | DONE | Admin list/create; Slack, Teams, and generic payloads; signing secret shown once |
| `/api/webhooks/{id}` | DONE | Enable/disable, URL/events update, delete |
| `/api/workspaces` | PARTIAL | POST create; no full list/update |
| `/api/workspaces/{id}` | DONE | GET workspace/policies, versioned PATCH policies, and DELETE owner workspace with the only-workspace guard |
| `/api/workspaces/{id}/invites` | DONE | Create invite |
| `/api/workspaces/{id}/members` | DONE | List/change role/remove |
| `/api/workspaces/{id}/sso` | DONE | Admin GET/PUT/DELETE for org OIDC config with encrypted client secret and audit |

### Extra Project3383 endpoints

| Path | Status | Notes |
|---|---|---|
| `GET /api/tasks?workspaceId=...` | DONE | Dependency picker |
| `POST /api/tasks/{id}/complete` | DONE | Move to Done |
| `POST /api/tasks/{id}/reopen` | DONE | Move to first open column |
| `POST /api/tasks/{id}/restore` | DONE | Clear `archived_at` with activity and audit |
| `POST /api/tasks/{id}/dependencies` | DONE | Cycle check |
| `DELETE /api/tasks/{id}/dependencies/{dependsOnTaskId}` | DONE | |
| `POST /api/tasks/{id}/reminders` | DONE | In-app reminder |
| `DELETE /api/reminders/{id}` | DONE | |
| `PATCH /api/notifications/{id}/read` | DONE | |
| `PATCH /api/notifications/read-all` | DONE | |
| `POST /api/tasks/{id}/focus` | DONE | Atomic actual-minutes logging and optional completion (rewrite addition) |

## 2. Data model parity (37 reference models)

| Model | Project3383 status | Notes |
|---|---|---|
| User | DONE | `app_user`; soft delete, anonymized credentials, MFA fields prepared |
| Session | SCHEMA | `auth_session` table; runtime uses HttpSession, account deletion revokes rows |
| Workspace | DONE | Soft delete, policies, version; deleted workspaces are excluded from bootstrap and API access |
| Membership | DONE | |
| Board | DONE | |
| Column | DONE | `board_column` |
| Task | DONE | |
| Subtask | DONE | |
| Label | DONE | |
| TaskLabel | DONE | |
| TaskDependency | DONE | |
| Comment | DONE | `task_comment` |
| Attachment | DONE | |
| ActivityEvent | DONE | Recorded for task, comment, checklist, attachment, Today, and recurrence changes |
| AuditEvent | DONE | Admin audit log, retention purge, cursor pagination |
| Reminder | DONE | |
| View | SCHEMA | No saved-view UI/API |
| AutomationRule | DONE | Trigger/conditions/action, board scope, enable/disable, last run |
| AutomationRun | DONE | Before/after snapshots, activity, audit, 60-second undo |
| Notification | DONE | |
| UserSettings | DONE | Settings UI + GET/PATCH API |
| PlanBlock | DONE | Auto-plan |
| TodayDismissal | DONE | |
| TodaySelection | DONE | Rewrite-specific per-user selection table; reference uses shared `Task.focusDate` |
| MagicLinkToken | DONE | Hashed one-time token, purpose, 15-minute expiry, IP hash, consumption timestamp |
| Invite | DONE | |
| OidcConfig | DONE | Issuer, client ID/secret, domains, enable/enforce, encrypted secret, audit |
| ApiToken | DONE | Bearer auth, workspace scope, expiry, revocation, audit |
| Webhook | DONE | Kind, URL, enable/disable, event subscriptions, HMAC signing secret |
| WebhookDelivery | DONE | Persisted payload/status/response, async delivery, retry at 5/15/45 min |
| IdempotencyKey | SCHEMA | |
| UndoAction | DONE | Auto-plan and task/board undo records with TTL |
| EmailMessage | SCHEMA | |
| JobRun | SCHEMA | |
| ClientError | SCHEMA | |
| OAuthAccount | SCHEMA | |
| BackupRun | SCHEMA | |
| FeatureFlag | SCHEMA | |

## 3. UI / behavior parity

| Area | Status | Notes |
|---|---|---|
| Auth / guest / signup / signin / magic link | DONE | Dedicated `/auth` split layout with password, signup, magic-link, guest-claim, and MFA states |
| App shell / workspace switcher | DONE | |
| Board / columns / task CRUD | DONE | Board settings, duplicate, archive, soft delete, visibility |
| Task archive | DONE | Bulk archive, dedicated Archive view for archived and completed work, reopen, restore, activity, and audit |
| Task drawer fields | PARTIAL | Assignee and recurrence implemented; reminder display and full label management still partial |
| Task comments / checklist | DONE | |
| Task activity feed | DONE | Task detail activity trail with actors and relative times |
| Task dependencies | DONE | |
| Attachments | DONE | |
| Task completion / reopen | DONE | |
| Task undo | DONE | Create, complete, move, delete, and board delete with toast actions |
| Bulk task actions | DONE | Multi-select complete, archive, delete, move, with undo |
| Command palette / shortcuts | DONE | Ctrl/Cmd+K palette, search tasks, keyboard navigation, shortcut help, single-key toggle, Alt+Arrow move/reorder |
| Labels | PARTIAL | Task-scoped labels; no label manager |
| Today / capacity / accept / dismiss | DONE | Workspace-scoped, per-user selection, capacity/reasons/blocked dependencies, rebalance/applyPlan |
| Day Flow | PARTIAL | 24-hour rail, capacity ring, now marker, chosen/suggested blocks, drag-to-Later, Rebalance; exact visual parity pending |
| Focus Mode | DONE | Full-screen timer, ring, pause/resume, complete, early leave, actual-minutes persistence |
| Smart Plan / Auto-plan | PARTIAL | Settings-aware preview/apply/clear, safe/full/delegated modes, refresh, stale cleanup, undo; exact reference UI/recompute pending |
| Calendar / ICS | DONE | Month calendar and ICS download |
| Search / Archive / Upcoming | DONE | Redesigned horizon view with ranges and dated rows; archive split into archived/completed with reopen/restore; search field with status, priority, and board filters |
| Insights | DONE | Timeline Gantt with 14/30/60-day ranges and a workload view with counts and estimated load |
| Quick capture / Voice | DONE | Natural-language capture, browser speech with text fallback |
| Settings / Voice / Sound | DONE | Personal Settings UI, Sound Lab, Voice capture |
| Offline / PWA | PARTIAL | Service worker, manifest, cached bootstrap/board/today/settings, offline queue, retry/discard, sync banner; no idempotent replay/conflict resolution |
| i18n | PARTIAL | English / Traditional Chinese for shell, Today, planning, capture, Focus, Sound, and Settings; some admin/edge strings remain English |
| Public board share | DONE | Read-only `/share/{token}` page, team workspace links, revocable tokens |
| Webhooks | DONE | Admin CRUD, Slack/Teams/generic payloads, HMAC signature, async delivery with retries, SSRF/HTTPS guard |
| Automations | DONE | Admin rules for created/moved/completed with priority/column/label/due-date conditions; priority, label, column, and notify actions; dry-run diff, run history, activity/audit, and undo |
| MFA | DONE | TOTP setup with QR, encrypted secret, one-time backup codes, sign-in challenge, disable guard, session list |
| Workspace policies | DONE | Versioned require-MFA, assistant, automations, attachments, sharing, retention, and audit-retention controls; policy enforcement in access/attachment paths |
| SSO | DONE | Organization OIDC config with discovery, state/nonce, domain allowlist, encrypted secret, guest linking, MFA handoff, and local fake-provider test |
| API tokens | DONE | Admin create/list/revoke, bearer auth, workspace scope, expiry |
| Audit / Retention | DONE | Core task/board/member/token audit events, admin feed, configurable retention |
| Notifications / Reminders | DONE | In-app only |
| Members / Invites / Roles | DONE | |
| Account / workspace deletion | DONE | Soft delete with ownership/only-workspace guards, session and token revocation, audit, and offline-cache clearing |
| Export / Import | DONE | Workspace JSON/CSV export with visibility filtering and CSV injection guard; CSV/JSON task import into a board |

## 4. Known accepted differences / limitations

- Runtime session is a custom Spring MVC `HttpSession` interceptor, not full Spring Security form login.
- Full token-based CSRF remains hardening; cookie mutations are protected by Origin validation.
- SQLite schema is managed by Flyway versioned migrations.
- `Today` is workspace-scoped and uses a per-user `today_selection` table; `Task.focusDate` is still mirrored for API compatibility but is no longer the source of truth.
- Today rebalance/applyPlan are implemented; exact reference ranking and visual parity still need comparison.
- Auto-plan is settings-aware, mode-aware, refreshable, delegated-cleanup capable, and undoable; safe/delegated recomputation is an approximation of the reference and exact UI parity is still pending.
- UI is functionally close but not pixel-parity with ProjectA2.
- No live SMTP or live external OIDC provider verification; SSO is covered by a local fake-provider test.

## 5. Phase gate

### Phase 0 ??complete when
- [x] API inventory exists
- [x] Model inventory exists
- [x] UI/feature inventory exists
- [x] Status/known differences recorded
- [x] Baseline screenshots and demo script linked from ProjectA2
- [x] Each PARTIAL/MISSING item is assigned to a later phase in §6

### Phase 1 ??complete when
- [x] Spring Boot + JDK17 + Maven Wrapper
- [x] SQLite + schema bootstrap
- [x] Static HTML/CSS/JS served
- [x] Session/guest/signup/signin
- [x] Workspace/membership/board/task core
- [x] Board settings, duplicate, archive, soft delete, and private visibility
- [x] Task assignee and recurrence with next-occurrence generation
- [x] Public read-only board share links with token revocation
- [x] Task activity trail for task, comment, checklist, attachment, Today, and recurrence events
- [x] Undo for task create/complete/move/delete and board delete
- [x] Bulk complete/archive/delete/move with multi-select and undo
- [x] Command palette, keyboard navigation, shortcuts help, and Alt+Arrow card move/reorder
- [x] Phase 2 board/task scope complete
- [x] Workspace API tokens with bearer auth, expiry, revocation, and audit
- [x] Admin audit log with retention purge and cursor pagination
- [x] Admin webhooks (Slack/Teams/generic) with signed async delivery, retries, and audit
- [x] Automations with task-event triggers, condition matching, four actions, draft preview, notifications, run history, and undo
- [x] Workspace JSON/CSV export and CSV/JSON task import with audit records
- [x] Account and workspace deletion with ownership guards, anonymization, access revocation, and audit
- [x] TOTP MFA with QR setup, encrypted secrets, one-time backup codes, sign-in challenge, disable guard, and audit-ready fields
- [x] Versioned workspace policies with MFA access guard and attachment-policy enforcement
- [x] Organization SSO via OIDC discovery/callback with encrypted client secret and MFA handoff
- [x] Magic-link sign-in with session-bound state, one-time tokens, account creation, and MFA handoff, plus the dedicated `/auth` page
- [x] Redesigned Upcoming horizon, Archive (archived/completed with reopen/restore), and Search (status/priority/board filters) views
- [x] Timeline and workload Insights views, redesigned Today, Board, Calendar, task drawer, and grouped Settings navigation
- [x] CSP, referrer, frame, nosniff, and HttpOnly/SameSite session hardening with cross-origin write rejection
- [x] axe WCAG 2 A/AA + 2.1 A/AA scans with zero violations across all views, dark mode, dialogs, and auth states
- [x] Lighthouse mobile: 100 accessibility, 100 best practices, 100 SEO, 88 performance (CLS 0.016, TBT 80 ms)
- [x] Browser acceptance screenshots and the final QA report in `docs/ACCEPTANCE.md`
- [x] Complete model table inventory (37 mapped)
- [x] Session/authorization interceptor and guest/auth flow
- [x] Origin-based CSRF protection for cookie mutations (token-based CSRF remains hardening)
- [x] Session-based authentication and role authorization (full Spring Security filter-chain migration listed as hardening)
- [x] Member/guest write-role enforcement on task, board, attachment, reminder, and workspace-admin paths
- [x] Flyway versioned baseline migration
- [x] Settings table + GET/PATCH `/api/settings`
- [x] Account profile update + personal Settings UI (appearance, language, planning, auto-plan, focus, notifications, features)
- [x] Auto-plan consumes capacity/workday/lunch/rest/week/deep-work/estimate settings and supports undo
- [x] Auto-plan safe/full/delegated modes, refresh, task-change invalidation, and stale cleanup
- [x] Today rebalance and applyPlan actions
- [x] Day Flow 24-hour rail, chosen/suggested blocks, drag-to-Later, and Rebalance
- [x] Focus Mode timer, pause/resume, complete, early leave, and actual-minutes persistence
- [x] Sound layer, palettes, volume, typing texture, previews, and localStorage persistence
- [x] Quick capture natural-language parsing, browser voice capture, and text fallback
- [x] English / Traditional Chinese translation layer with settings-driven locale
- [x] Offline/PWA core: service worker, manifest, cached views, write queue, retry/discard, online sync
- [x] Baseline API/unit smoke tests and setup/runbook

## 6. Next work after Phase 0/1

1. Full Spring Security filter-chain migration and token-based CSRF hardening.
2. Remaining drawer parity for a label manager and reminder editing.
3. Auto-plan exact safe/delegated recompute and scheduled retention cleanup.
4. OAuth provider sign-in (GitHub/Google/Apple) if required by the reference scope.
5. Live-provider SSO/SMTP verification and production deployment hardening.
6. Keep the acceptance suite current as the remaining limitations are closed.
