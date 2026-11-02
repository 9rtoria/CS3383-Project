# Project3383 ??Phase 0 Parity Matrix

**Reference:** ProjectA2 `a78abe2`  
**Baseline visuals:** `C:\Users\yanpi\OneDrive\桌面\ProjectA2\docs\screenshots`  
**Baseline demo:** `C:\Users\yanpi\OneDrive\桌面\ProjectA2\docs\DEMO.md`  
**Target:** Spring Boot 3.5 / Java 17 / SQLite / HTML-CSS-vanilla JS  
**Last updated:** 2026-11-02

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
| `/api/archive` | DONE | Completed and explicitly archived tasks plus archived boards with task counts and versions for restore |
| `/api/attachments` | DONE | Top-level multipart upload with `taskId`, `workspaceId`, and `file`; task-scoped upload remains supported |
| `/api/attachments/{id}` | DONE | Download/delete |
| `/api/audit` | DONE | Admin audit feed with cursor pagination and retention purge |
| `/api/auth/guest` | DONE | Guest session |
| `/api/auth/magic` | DONE | Session-bound state, SHA-256 token, 15-minute expiry, queued email with development link |
| `/api/auth/magic/verify` | DONE | One-time atomic consumption, state match, account creation, MFA handoff, safe redirect |
| `/api/auth/mfa/challenge` | DONE | In-memory 5-minute challenge; TOTP or one-time backup code |
| `/api/auth/oauth/{provider}` | DONE | GitHub, Google, and Apple authorisation redirects when the provider env credentials are configured; session-bound state and safe `next` |
| `/api/auth/oauth/{provider}/callback` | DONE | Code exchange, profile mapping, account linking/creation, guest claim, MFA handoff, session rotation |
| `/api/auth/signin` | DONE | Password sign-in |
| `/api/auth/signout` | DONE | Session invalidate |
| `/api/auth/signup` | DONE | Guest claim supported |
| `/api/auth/sso/{workspaceId}` | DONE | OIDC discovery, state/nonce redirect for enabled org configs |
| `/api/auth/sso/{workspaceId}/callback` | DONE | State validation, code exchange, userinfo, domain check, account linking, MFA handoff |
| `/api/auto-plan` | DONE | Reference-equivalent scoring, due-time bounds, week actuals, fixed-block accounting, safe recompute with preserved blocks, delegated cleanup, refresh/invalidation, and undo |
| `/api/automations` | DONE | Admin rule list with runs and preview; create with audit |
| `/api/automations/preview` | DONE | Side-effect-free draft diff with skipped reasons |
| `/api/automations/{id}` | DONE | Enable/disable, edit, delete |
| `/api/boards` | DONE | GET/POST with description, color, and visibility |
| `/api/boards/{id}` | DONE | GET/PATCH/DELETE with version checks and soft delete |
| `/api/boards/{id}/duplicate` | DONE | Copies columns, tasks, labels, assignee, and recurrence |
| `/api/boards/{id}/share` | DONE | Toggle a read-only public link for team workspaces |
| `/api/share/{token}` | DONE | Public read-only board payload and page |
| `/api/bootstrap` | DONE | User, workspaces, boards/columns, labels, and board-template catalog; personal settings load through `/api/settings` |
| `/api/calendar` | DONE | Date-range tasks and plan blocks |
| `/api/calendar/ics` | DONE | Authenticated ICS download |
| `/api/client-errors` | DONE | Public 202 endpoint persists sanitised client errors with user, URL, UA, and request ID |
| `/api/columns` | DONE | Create with optional `afterId`; template boards seed done columns and WIP limits |
| `/api/columns/reorder` | DONE | Complete order validation and persisted positions |
| `/api/columns/{id}` | DONE | Name, WIP limit/enforcement, done flag, position, soft delete with empty-column guard |
| `/api/export` | DONE | JSON workspace export and formula-safe CSV; private-board filtering; audit |
| `/api/health` | DONE | |
| `/api/import` | DONE | CSV/JSON tasks into a board with columns, labels, assignee, due dates, estimates, and skip counts |
| `/api/insights` | DONE | Rich board/member/task/totals payload with 14/30/60-day range, timezone-aware overdue and due-this-week counts |
| `/api/invites/{token}` | DONE | Public GET preview with `canAccept`, POST accept; dedicated `/invite/{token}` page with sign-in handoff |
| `/api/labels` | DONE | List with task counts plus create/upsert and delete |
| `/api/metrics` | DONE | Public process metrics; tenant counts only with an authenticated ADMIN workspace scope |
| `/api/notifications` | DONE | GET, reference-compatible PATCH one/all read, plus convenience read/read-all routes |
| `/api/openapi` | DONE | Serves the checked-in OpenAPI 3 description as YAML |
| `/api/search` | DONE | Tokenized title/description/label search with status, priority, board, label, and date filters; empty query returns recent tasks |
| `/api/security/mfa` | DONE | Status/sessions, TOTP setup with QR, enable with backup codes, disable guard, session revoke rows |
| `/api/settings` | DONE | GET/PATCH personal preferences with the full Settings UI, Reset per section, deep links, and saved-view/board bootstrap integration |
| `/api/share/{token}` | DONE | Public read-only board payload and `/share/{token}` page |
| `/api/subtasks/{id}` | DONE | PATCH and DELETE with membership and board-visibility checks |
| `/api/tasks` | DONE | GET list, POST create |
| `/api/tasks/bulk` | DONE | Complete, archive, delete, and move up to 100 tasks with undo |
| `/api/tasks/{id}` | DONE | GET/PATCH/DELETE; PATCH supports field-presence-safe due dates, completion/reopen, archived, reminder offsets, dependencies, focus date, labels, recurrence, and versioned conflict handling |
| `/api/tasks/{id}/comments` | DONE | POST; detail returns comments |
| `/api/tasks/{id}/move` | DONE | |
| `/api/tasks/{id}/reorder` | DONE | Keyboard order up/down with undo |
| `/api/tasks/{id}/subtasks` | DONE | POST; detail returns checklist |
| `/api/today` | DONE | Workspace-scoped GET, per-user selection, accept/dismiss/rebalance/applyPlan, counts |
| `/api/tokens` | DONE | List/create personal workspace API tokens |
| `/api/tokens/{id}` | DONE | Revoke token |
| `/api/undo/{id}` | DONE | Auto-plan, task create/complete/move/delete, board delete, and bulk action undo hooks |
| `/api/upcoming` | DONE | Due-date groups |
| `/api/views` | DONE | Per-user saved view list, upsert, and delete with filters JSON |
| `/api/webhooks` | DONE | Admin list/create; Slack, Teams, and generic payloads; signing secret shown once |
| `/api/webhooks/{id}` | DONE | Enable/disable, URL/events update, delete |
| `/api/workspaces` | DONE | GET memberships with workspace details and role; POST create |
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
| `POST /api/tasks/{id}/restore` | DONE | Clear `archived_at` with task activity |
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
| Session | DONE | HttpSession is mirrored to `auth_session` with hashed token, IP hash, UA, MFA timestamp, sliding expiry, touch, revoke, and cross-device enforcement |
| Workspace | DONE | Soft delete, policies, version; deleted workspaces are excluded from bootstrap and API access |
| Membership | DONE | |
| Board | DONE | |
| Column | DONE | `board_column` with integer position, WIP limit/enforcement, done flag, and soft delete |
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
| View | DONE | Per-user saved view API and board payload |
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
| IdempotencyKey | DONE | 24-hour idempotency cache with replay header and method/path conflict rejection |
| UndoAction | DONE | Auto-plan and task/board undo records with TTL |
| EmailMessage | DONE | Magic-link and daily-digest queue plus retrying SMTP delivery worker; local development keeps queued rows and surfaces the dev link |
| JobRun | DONE | Housekeeping, retention, and daily-digest runs record name, timestamps, status, and details |
| ClientError | DONE | Public client-error intake with sanitisation and request context |
| OAuthAccount | DONE | Provider/account link table used by GitHub, Google, and Apple callback linking |
| BackupRun | DONE | Table parity with the reference, which also defines it as schema-only |
| FeatureFlag | DONE | Table parity; runtime feature toggles use the reference-equivalent per-user `features_json` |

## 3. UI / behavior parity

| Area | Status | Notes |
|---|---|---|
| Auth / guest / signup / signin / magic link / OAuth | DONE | Dedicated `/auth` split layout with password, signup, magic-link, guest-claim, MFA, and provider buttons that appear only when GitHub/Google/Apple credentials are configured |
| App shell / workspace switcher / deep links | DONE | SPA shell plus `/settings`, `/settings#section`, `/offline`, `/invite/{token}`, `?view=`, `?board=`, and `?task=` links |
| Board / columns / task CRUD | DONE | Board settings, templates, column add/edit/delete/reorder, WIP limits with enforced `WIP_LIMIT` 409s, duplicate, archive/restore, soft delete, visibility |
| Task archive | DONE | Bulk archive, dedicated Archive view for archived and completed work, reopen, restore, activity, and audit |
| Task drawer fields | DONE | Status/column, assignee, due date + time, all-day, estimate, actual time, priority, labels, recurrence, reminder offset, notes, checklist suggestions/deletion, dependencies, attachments, comments, activity, Focus, copy link, archive, complete/reopen |
| Task comments / checklist | DONE | |
| Task activity feed | DONE | Task detail activity trail with actors and relative times |
| Task dependencies | DONE | |
| Attachments | DONE | |
| Task completion / reopen | DONE | |
| Task undo | DONE | Create, complete, move, delete, and board delete with toast actions |
| Bulk task actions | DONE | Multi-select complete, archive, delete, move, with undo |
| Command palette / shortcuts | DONE | Ctrl/Cmd+K palette, search tasks, keyboard navigation, shortcut help, single-key toggle, Alt+Arrow move/reorder |
| Labels | DONE | Label list/create/delete API with task counts, color classes, task-scoped assignment, and board label payload; the reference also has no separate label-manager screen |
| Today / capacity / accept / dismiss | DONE | Workspace-scoped, per-user selection, capacity/reasons/blocked dependencies, rebalance/applyPlan |
| Day Flow | DONE | Signature card, 24-hour rail, now marker, capacity ring, chosen/suggestion styling, drag-to-Later, Focus next, and Rebalance matching the reference structure |
| Focus Mode | DONE | Full-screen timer, ring, pause/resume, complete, early leave, actual-minutes persistence |
| Smart Plan / Auto-plan | DONE | Smart Plan modal plus settings-aware balanced/focus/light options, reference scoring, safe/full/delegated modes, refresh, stale cleanup, and undo |
| Calendar / ICS | DONE | Month calendar, configurable week start, selected-day panel with plan blocks/due items, and ICS download |
| Search / Archive / Upcoming | DONE | Redesigned horizon view with ranges and dated rows; archive shows archived boards plus archived/completed tasks with restore/reopen; search field with status, priority, and board filters |
| Insights | DONE | Timeline Gantt with 14/30/60-day ranges and a workload view with counts and estimated load |
| Quick capture / Voice | DONE | Natural-language capture, browser speech with text fallback |
| Settings / Voice / Sound | DONE | Personal Settings UI, Sound Lab, Voice capture |
| Settings navigation / scrollspy | DONE | One-page Settings keeps click-to-jump, while the desktop sidebar and mobile section picker follow the section actually in view. Scrollspy pauses during search, updates the URL hash, preserves the active section across re-renders, and keeps short sections (Keyboard, Automations, Audit) selectable. |
| Restored rewrite-only admin capabilities | DONE | Kept the reference layout while restoring useful rewrite capabilities: token created/expires/last-used metadata and copy; webhook event selection, one-time signing secret with copy, pause/resume, delivery count/last-delivery status, URL copy; SSO configured badge, enable/require toggles, and Try SSO; invite-link copy, member joined dates, shortcut-sheet entry point, and automation board scope. |
| Workspace settings visibility | DONE | Personal Owner/Admin workspaces expose the newer four-item group: Workspace, Automations, Integrations, and Audit log. Team/org Owners/Admins keep the full six-item group; team members retain the existing People/Policies/Automations entries; personal non-admins see Workspace only. |
| Live updates / mutation feedback | DONE | Display-name changes immediately update the topbar, account menu, Settings identity block, People/Audit sections, board/search assignees, and open task drawers. Workspace-name changes update the sidebar, Settings header, People description, and board header. Task/board mutations refresh the current view plus Board and Today, debounce sidebar/workspace counts, and refresh notifications. Returning to a tab refreshes the visible data. Silent checklist, dependency, reminder, attachment, comment, role, workspace-switch, and invitation actions now report success. |
| Offline / PWA | DONE | Service worker, manifest, cached bootstrap/board/today/settings, offline queue with per-write idempotency keys, replay, retry/discard, explicit 409 failures, dedicated `/offline` page |
| i18n | DONE | English / Traditional Chinese for every statically extracted UI, auth, board, task, calendar, archive, search, settings, and admin string; `t()` audit reports zero missing keys |
| Public board share | DONE | Read-only `/share/{token}` page, team workspace links, revocable tokens |
| Webhooks | DONE | Admin CRUD, Slack/Teams/generic payloads, HMAC signature, async delivery with retries, SSRF/HTTPS guard |
| Automations | DONE | Admin rules for created/moved/completed with priority/column/label/due-date conditions; priority, label, column, and notify actions; dry-run diff, run history, activity/audit, and undo |
| MFA | DONE | TOTP setup with QR, encrypted secret, one-time backup codes, sign-in challenge, disable guard, session list |
| Workspace policies | DONE | Versioned require-MFA, assistant, automations, attachments, sharing, retention, and audit-retention controls; policy enforcement in access/attachment paths |
| SSO | DONE | Organization OIDC config with discovery, state/nonce, domain allowlist, encrypted secret, guest linking, MFA handoff, and local fake-provider test |
| API tokens | DONE | Admin create/list/revoke, bearer auth, workspace scope, expiry |
| Audit / Retention | DONE | Workspace/identity/enterprise audit events (matching the reference scope), admin feed, configurable retention |
| Notifications / Reminders | DONE | In-app inbox with `inApp`/`mentions` preferences, assignment/automation/reminder notifications, unread badge, click-to-open task, polling, quiet hours, visible-tab chime, permission-gated browser notifications, reminder offsets, daily digest queue, and optional SMTP delivery |
| Members / Invites / Roles | DONE | |
| Account / workspace deletion | DONE | Soft delete with ownership/only-workspace guards, session and token revocation, audit, and offline-cache clearing |
| Export / Import | DONE | Workspace JSON/CSV export with visibility filtering and CSV injection guard; CSV/JSON task import into a board |

## 4. Known accepted differences / limitations

- Runtime session remains a Spring MVC `HttpSession`, now mirrored to `auth_session` for revocation and device visibility rather than replaced by Spring Security form login.
- Cookie mutations are protected by Origin/Sec-Fetch-Site validation; no separate token-based CSRF scheme is issued.
- SQLite schema is managed by Flyway versioned migrations.
- `Today` is workspace-scoped and uses a per-user `today_selection` table; `Task.focusDate` is mirrored for API compatibility.
- External OAuth, SMTP, and OIDC delivery require real provider credentials. GitHub, Google, and Apple exchange/profile/JWKS contracts are covered by local mock-provider tests, including Apple signature rejection; queued email delivery is covered by a real local SMTP socket test. Live provider/SMTP verification remains an environment check. External OIDC is also covered by a local fake-provider test.
- i18n covers every statically extracted UI, auth, board, task, calendar, archive, search, settings, and admin string. The audit reports zero missing `t()` keys; provider names and user-authored content stay untranslated by design.
- Visual parity uses the reference design language, spacing, type scale, palettes, card structure, and interaction states. Rendering differs at the sub-pixel level because this implementation is native HTML/CSS/JS rather than React/Tailwind.

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
- [x] Offline/PWA core: service worker, manifest, cached views, write queue, retry/discard, idempotent online sync, explicit conflict failures
- [x] Baseline API/unit smoke tests and setup/runbook
- [x] Board columns APIs, WIP limits/enforcement, templates, archived-board restore
- [x] Drawer status/due-time/archive/checklist suggestions/deletion/copy-link/reminder-offset parity
- [x] Calendar selected-day panel and configurable week start
- [x] Persistent `auth_session` rows with device revocation, idempotency key replay, client-error intake, labels/views/metrics/OpenAPI APIs
- [x] OAuth provider redirect/callback with GitHub, Google, and JWKS-verified Apple profiles
- [x] `/settings`, `/settings#section`, `/offline`, `/invite/{token}`, `?view=`, `?board=`, and `?task=` deep links
- [x] In-process reminder/retention/email delivery workers and optional SMTP transport
- [x] `SEED_DEMO=true` demo account/workspace seed

## 6. Remaining hardening / environment checks

1. Full Spring Security filter-chain migration and token-based CSRF if the deployment requires it.
2. Live OAuth, SMTP, and external OIDC provider verification with real credentials.
3. Terminate TLS at the reverse proxy; the `prod` profile already supplies `Secure` cookies, forwarded headers, HSTS, compression, and static caching.
4. Perform manual NVDA/VoiceOver verification; automated axe checks are clean, and all static Traditional Chinese strings are translated.

## 7. Live side-by-side comparison (2026-11-02)

Ran the reference app (`ProjectA2`, port 3000) and this build (port 3383) side by side
with the same demo account. The comparison covered Today, Board (board/list), Calendar,
Upcoming, Search, Archive, Insights, Settings, Auth, quick capture, task drawer, command
palette, notifications, account menu, and Focus mode, plus console-error checks.

Fixed during the pass:

- Design tokens, base typography, control sizing, border radii, shadows, transitions, hover
  states, and the shared icon set now follow the reference values.
- Sidebar width, brand mark, workspace switcher, nav rhythm, hover/focus states, user footer,
  topbar controls, notification dot, and skip link.
- Auth split layout, quote measure, form rhythm, and vertical centering.
- Board page header, filter row, columns, hover-only column actions, compact counts, relative
  due labels, card density, board/list switch, and quick-capture entry points.
- Calendar page header and actions, month navigation, weekday scale, day cells, task dots,
  dated-task copy, and side panel.
- Upcoming page header, range switch, single-line rows, priority/time/label/assignee metadata,
  and Change range footer.
- Search page header, filter chips, search field/keyboard hint, result rows, marker style,
  descriptions, relative due labels, and status hint.
- Archive section headings, grouped list container, completion dates, and reopen actions.
- Insights page header, Timeline/Workload switch, 240px task column, 59px rows, 30-day grid,
  overdue bars vs future milestones, workload metrics, and Unscheduled table.
- Settings navigation, spacing, icons, hover states, and section content for Account,
  Appearance, Language, Planning, Auto-plan, Focus, Notifications, Sound, Keyboard, Features,
  Security, Workspace, People, Policies, Automations, Integrations (tokens, webhooks, SSO),
  Audit, Data, and About. The About runtime copy now mirrors the reference.
- Settings workspace/user hover states, reset buttons, theme icons, preview block, login-state
  health row, search/empty-state behavior, section heights, and mobile layout with a section
  picker instead of the desktop sidebar. The Settings workspace avatar now uses the same soft
  accent treatment as the main sidebar and reference (light mint in the light theme) instead
  of the dark brand-mark treatment; the account and member avatars retain their reference
  identity styling.
- Browser tab and installable-app icons now use the reference Drift swirl mark instead of the
  Project3383 "D" glyph. The icon URL is cache-busted and the service-worker cache version is
  advanced so existing tabs can pick up the replacement.
- Settings navigation now tracks scrolling: the desktop sidebar and mobile picker update as
  each section reaches the reading position, short sections are not skipped, search temporarily
  clears the marker, and click-to-jump remains intact. The URL hash follows the active section,
  and re-rendering a Settings section keeps the current scroll position.
- Personal Owner/Admin workspaces retain the newer four-item Workspace group (Workspace,
  Automations, Integrations, Audit log). Team/org admins keep the full six items, team members
  keep the existing People/Policies/Automations entries, and personal non-admins see Workspace
  only.
- Live mutation propagation now updates every visible identity surface. Changing the display
  name updates the topbar, account menu, Settings header/footer, People and Audit reads, board
  and search assignees, and an open task drawer; changing the workspace name updates the
  sidebar, Settings header, People copy, and board header. Task/board mutations refresh the
  current view as well as Board and Today, with debounced workspace/board counts and
  notifications. Returning to the tab refreshes visible data, and previously silent checklist,
  dependency, reminder, attachment, comment, role, workspace-switch, and invitation actions
  now show success toasts.
- Restored rewrite-only admin capabilities without changing the default reference layout:
  API-token metadata/copy, webhook event selection and one-time signing secrets, delivery
  status, pause/resume and URL copy; SSO status, enable/require toggles and Try SSO; invite-link
  copy, joined dates, shortcut-sheet entry, and automation board scope.
- Audit records board/task events again, matching the reference’s audit scope and live feed.
- Task drawer width/padding, header badge row, relative due badge, property grid, Notes,
  Checklist, Waiting On, attachments, footer actions, Escape handling, and autosave.
- Command palette position, search row, focus ring, command set, footer, keyboard hints, and
  clipped first-screen height.
- Quick capture heading, close control, voice icon, options, tip, and Add-task shortcut.
- Notifications now open as an anchored menu (not a modal), with unread highlighting, relative
  dates, Mark read, and Notification settings; the topbar account menu gained its icons,
  dimensions, and Escape/outside-click behavior.
- Keyboard shortcut sheet now uses the reference card container, scroll clipping, row density,
  labels, and close control.
- Board list view uses relative due labels, compact priority tones, no empty-priority badge,
  and the same toolbar grouping on mobile.
- Mobile Today/Board padding, toolbar wrapping, and Settings header/picker/theme alignment.
- Focus mode action icons and task context icon.
- Demo seed is anchored to the reference seed date (`2026-10-29`) and mirrors the reference
  workspace, labels, two boards, WIP limits, tasks, descriptions, checklists, comments, view,
  and notifications.

### Second live-audit reconciliation (same day)

A second side-by-side pass was run after a report that some pages still looked different.
The following gaps were confirmed and fixed rather than treated as data drift:

- **Insights**: New task now opens Quick Capture on Timeline and Workload; the timeline
  requests the selected `days` range, uses start/due dates, excludes completed work, groups
  rows by board, uses the reference empty state, and the Unscheduled card now includes its
  count, subtitle, board/column meta, badge, and 20-item hint. Workload section headings use
  the reference 13px title scale, board/member order icons, and the same metric/list markup.
- **Today**: the first screen again shows eight suggestions, the Show the other/Show less
  toggle is bidirectional, and the footer matches the reference.
- **Upcoming / Calendar**: Upcoming rows use the neutral/today side dot rather than a
  priority-coloured dot, the footer is hidden when empty, and both views now expose inline
  error states with Retry. Calendar's summary copy uses “Undated”, and failed loads report the
  error in the Dated tasks card instead of only a toast.
- **Search**: restored the result meta badges, checklist counts, full empty/error states,
  scoped-workspace footer, Open a board action, query-specific result count, and the reference
  unfiltered “most recently touched” ordering (done items are no longer forced to the bottom).
- **Archive / Board**: Archive has an inline unavailable state with Retry. Board list mode has
  the reference “Nothing on this board yet” and “No tasks match those filters” cards, the
  toolbar/empty-card Clear filters action, and the filtered card spans the full board width.
- **Shell / navigation**: a board stays highlighted in the sidebar only while Board is the
  active view; Board, Upcoming, Calendar, Search, Archive, Insights, and Today no longer keep
  a stale board selection.
- **Quick capture / task drawer**: the voice button keeps its microphone icon after listening;
  Add task is disabled until text is entered and no longer mutates the button’s SVG label;
  the task drawer now loads Status options from the task’s own board (not the previously
  selected board), shows the checklist count, uses borderless checklist rows with X remove
  controls, and keeps the reference notes field.
- **Error feedback**: Today, Board, Upcoming, Calendar, Search, Archive, and Insights now
  all show an in-place error card with a retry action instead of a silent blank area or a
  toast-only failure.

The black circular control in the reference screenshots is the **Next.js development
indicator** (the “N” badge shown when `ProjectA2` runs under `next dev`). It is not a Drift
feature, is absent from both codebases, and is not reproduced in this build. The other
right-side sparkle/translate controls seen in some browser screenshots are browser
extensions, also outside the application.

Three intentional rewrite-only additions remain visible in Settings: the Keyboard
"Shortcut sheet" link row, the collapsed "Events" selector under Webhooks, and the four-item
Workspace group in personal Owner/Admin workspaces (the reference hides Automations and Audit
log there). They expose previously removed capabilities while leaving team/org and member
layouts unchanged.

Apart from the deliberate capability restorations above, the remaining visible differences are
**state/data drift and timing, not missing UI or behavior**:

- The reference database has additional historical activity (for example, a task created by
  an earlier evaluation and later edited). Search’s “most recently touched” order, the board
  list row order, the audit event count, and notification timestamps can therefore differ
  from a freshly seeded database. Filters, row design, audit writes, and notification actions
  behave the same.
- Opening `/settings#security` directly loads active sessions immediately in this build; the
  reference shows its “Open Security to load active sessions” hint until Security is selected.
  Selecting Security or Refresh produces the same session list in both.
- Health latency is measured live and can differ by a few milliseconds.
- Tiny sub-pixel differences remain from font rasterization and browser text metrics.

Live third-party OAuth/SMTP/OIDC verification and manual screen-reader sign-off remain
environmental checks as listed above.

### Third full-program audit (2026-11-02)

A further end-to-end audit covered every page, the task drawer, quick capture, command palette,
notifications, account and board menus, auth/invite/share pages, Settings, responsive layouts,
dark theme, Chinese locale, all API controllers, and the SQLite data paths.

Backend and data-integrity changes in this pass:

- Magic-link development URLs are gated by `project3383.dev-email-preview` and disabled by the
  production profile; repeated requests are throttled per address and email.
- API tokens are constrained in the request interceptor and in workspace-scoped services;
  `bootstrap` and `/api/workspaces` only expose the token's workspace.
- MFA enforcement requires an actually enrolled factor, not just a session flag. New TOTP
  setup is staged in a pending secret until the first code is confirmed, so an abandoned reset
  cannot disable or replace a working factor.
- Invite creation preserves the `GUEST` role. Pending invites are admin-only. A member can
  leave a workspace, with last-owner transfer protection.
- Board visibility changes are limited to the creator or an admin, with optimistic-version
  conflicts surfaced instead of silently returning another writer's row.
- Cross-workspace label deletion is rejected. Task labels accept the reference limit of 20
  labels and enforce the 40-character label name limit.
- Task create/update/delete/move/complete/focus, comments, Today actions, and data import are
  transactional. Completion paths consistently clear auto-plan blocks, dispatch completion
  hooks, and create the next recurrence. Next occurrences now use the post-update task values
  and copy unsent reminders at the shifted due time.
- Today selection is per user through `today_selection`; accepted work counts toward capacity,
  and completed plan blocks are excluded from Today and Calendar.
- All-day reminders anchor at 17:00 local, matching the reference's all-day convention.
- ICS output uses valid UTC timestamps and real due times instead of midnight placeholders.
- Archive is newest-first. Task `completed_at` is persisted and used by Archive, Insights, and
  Auto-plan instead of treating later edits as completion.
- Date and date-time inputs are validated as 400 errors; malformed legacy dates no longer
  throw 500s from Insights or Auto-plan.
- Private-board assignees must be able to read the board. Attachment download, delete, and
  upload apply the same private-board check.
- Webhook signing secrets are encrypted at rest with the local AES-GCM key and decrypted only
  for signing. Failed email delivery is capped at five attempts.
- SSO requires an explicit `email_verified: true` claim, rejects account collisions instead of
  overwriting a guest email, and rotates the session ID on callback.
- `GET /api/boards?workspaceId=...` now matches the published OpenAPI contract.
- Imported JSON assignee objects round-trip by email/name.

Frontend and interaction changes in this pass:

- Board cards now render the metadata row and footer only when they have content, restoring the
  reference's compact single-line card height; titles clamp at three lines and description
  spacing matches the reference. Card footers also expose open dependencies, attachments, and
  tracked focus minutes.
- Completed card titles use `var(--muted)` with the reference line-through treatment, and the
  extra metadata opacity that the reference does not have was removed. The same state was
  verified in light and dark themes.
- Board list rows now use the reference 12px row type, 11px dim columns, 550 title weight, and
  surface-2 hover.
- The "Add a task" control matches the reference dimensions, transparent border, 11.5px type,
  bottom-only radius, and hover reveal. The "Add column" dashed column uses the reference's
  14px label and top-left inline alignment instead of centring it in the full-height column.
- Board creation now matches the reference 560px modal, "A new board" heading, workspace
  eyebrow, single-line optional description (200 chars), visibility wording, and template
  column counts. The column editor is 420px and the board-settings private option uses
  "Only me and workspace admins" while creation uses "Private to me".
- Quick Capture always selects a default board and first column, including the topbar, Today,
  Board, Upcoming, Calendar, Insights, sidebar and keyboard entry points. Board-column entry
  points still preselect the clicked column.
- Quick Capture's primary text field now has a visible border, subtle surface fill, placeholder
  colour, and a clearer focus ring. This is a deliberate new-version usability improvement;
  the reference leaves the field borderless until focus.
- The Auto-plan preview modal was rebuilt to the reference structure: 980px dialog, three
  horizontal option cards with check/active state and summaries, grouped day rows with local
  dates and time ranges, duration labels, priority pills, a right-hand Weekly load / Not placed
  / Warnings stack, and the reference footer note plus Cancel/Apply actions. Raw ISO dates and
  duplicated default-estimate warnings were removed.
- `scripts/parity-audit.cjs` now provides a repeatable cross-application audit: static IDs/SVG/
  i18n, every main view, card and list-row geometry/state, completed transitions, light/dark
  completed colors, task drawer, palette, capture defaults/field styling, auto-plan structure,
  settings, and responsive widths. Any mismatch exits non-zero.
- New guest workspaces now use the reference defaults: user "You", workspace "Personal",
  starter board description "A calm place for everything on your plate.", and Personal/Work
  labels. V13 normalises existing guest starter data.
- The service worker cache version advanced to v5; static assets remain network-first with an
  offline cache fallback.
- Search gained Reset, cursor pagination with Load more, stale-response protection, and stable
  paging; the command palette gained Keyboard shortcuts, theme toggle, Settings, and board
  commands; board filters gained Assigned to me / Unassigned and label chips in list view.
- Board actions show icons, close after selection, and expose Share read-only link,
  Duplicate board, Archive board, and Delete board with the reference wording.
- URL state now tracks view, board, and open task; `?board=` opens Board; refresh restores the
  same state.
- Today's empty state, Next 14 days destination, per-day calendar layout, dependency rows,
  comments, attachment actions, activity Undo, and disabled-state feedback were completed.
- Bulk selection remains a rewrite-only desktop capability and now appears on hover instead
  of being permanently hidden.
- The task drawer uses theme surfaces in dark mode, and Chinese translations cover the new UI
  strings (`i18n` audit: 757 keys, 0 missing).

Verification for this pass: `mvnw test` 36/36, `mvnw package -DskipTests`, JavaScript syntax
checks, static ID/SVG audits (0 missing), i18n audit (0 missing), API pagination/rate-limit/
token-scope/recurrence/reminder/date-validation smoke tests, and Playwright checks across all
views, Settings, drawer, palette, capture, mobile, tablet, dark theme, and Chinese locale.

Honest remaining limitations:

- OAuth, SMTP, and OIDC still require real external credentials for a final live-provider
  smoke test; the repository tests use local mock providers and a local SMTP socket.
- `focus_date` remains as a single legacy field for API compatibility. Today planning reads the
  per-user `today_selection` table, but an old client that only reads `focusDate` can see the
  last writer's value in a shared workspace.
- Cursor pagination is offset-based inside an opaque cursor; concurrent edits can shift a page
  boundary, although responses never mix stale search generations in the UI.
- Webhook secret encryption depends on the local MFA key. Rotating that key requires
  re-entering existing secrets.
- Browser speech, notifications, and sound remain browser-dependent.
- Mobile Upcoming intentionally keeps the reference's own horizontal scroll.
