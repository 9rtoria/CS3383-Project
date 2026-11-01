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
| `/api/account` | PARTIAL | Profile display name/timezone update; delete not implemented |
| `/api/archive` | DONE | Completed tasks |
| `/api/attachments` | PARTIAL | Upload is `/api/tasks/{id}/attachments`; no top-level list/upload |
| `/api/attachments/{id}` | DONE | Download/delete |
| `/api/audit` | MISSING | Schema only |
| `/api/auth/guest` | DONE | Guest session |
| `/api/auth/magic` | MISSING | Email magic link not implemented |
| `/api/auth/magic/verify` | MISSING | |
| `/api/auth/mfa/challenge` | MISSING | |
| `/api/auth/oauth/{provider}` | MISSING | |
| `/api/auth/oauth/{provider}/callback` | MISSING | |
| `/api/auth/signin` | DONE | Password sign-in |
| `/api/auth/signout` | DONE | Session invalidate |
| `/api/auth/signup` | DONE | Guest claim supported |
| `/api/auth/sso/{workspaceId}` | MISSING | |
| `/api/auth/sso/{workspaceId}/callback` | MISSING | |
| `/api/auto-plan` | PARTIAL | Preview/apply/clear; no undo, full settings, or task-change recompute |
| `/api/automations` | MISSING | Schema only |
| `/api/automations/preview` | MISSING | |
| `/api/automations/{id}` | MISSING | |
| `/api/boards` | PARTIAL | GET/POST; no full update/delete contract |
| `/api/boards/{id}` | PARTIAL | GET only; no PATCH/DELETE |
| `/api/boards/{id}/duplicate` | MISSING | |
| `/api/boards/{id}/share` | MISSING | |
| `/api/bootstrap` | DONE | Core payload; no settings/theme bundle yet |
| `/api/calendar` | DONE | Date-range tasks and plan blocks |
| `/api/calendar/ics` | DONE | Authenticated ICS download |
| `/api/client-errors` | MISSING | Schema only |
| `/api/columns` | MISSING | |
| `/api/columns/reorder` | MISSING | |
| `/api/columns/{id}` | MISSING | |
| `/api/export` | MISSING | |
| `/api/health` | DONE | |
| `/api/import` | MISSING | |
| `/api/insights` | PARTIAL | Basic counts/priority breakdown |
| `/api/invites/{token}` | PARTIAL | POST accept; no public GET preview |
| `/api/labels` | MISSING | Labels are created through task input, no label API |
| `/api/metrics` | MISSING | |
| `/api/notifications` | DONE | GET + mark read/read-all |
| `/api/openapi` | MISSING | |
| `/api/search` | PARTIAL | SQL LIKE search, not FTS |
| `/api/security/mfa` | MISSING | |
| `/api/settings` | PARTIAL | GET/PATCH personal preferences; settings UI ported |
| `/api/share/{token}` | MISSING | |
| `/api/subtasks/{id}` | PARTIAL | PATCH; DELETE not exposed |
| `/api/tasks` | DONE | GET list, POST create |
| `/api/tasks/bulk` | MISSING | |
| `/api/tasks/{id}` | DONE | GET/PATCH/DELETE |
| `/api/tasks/{id}/comments` | DONE | POST; detail returns comments |
| `/api/tasks/{id}/move` | DONE | |
| `/api/tasks/{id}/subtasks` | DONE | POST; detail returns checklist |
| `/api/today` | PARTIAL | Workspace-scoped GET, per-user accept/dismiss, counts; no rebalance/applyPlan actions |
| `/api/tokens` | MISSING | |
| `/api/tokens/{id}` | MISSING | |
| `/api/undo/{id}` | MISSING | Schema only |
| `/api/upcoming` | DONE | Due-date groups |
| `/api/views` | MISSING | Schema only |
| `/api/webhooks` | MISSING | Schema only |
| `/api/webhooks/{id}` | MISSING | |
| `/api/workspaces` | PARTIAL | POST create only; no full list/update/delete |
| `/api/workspaces/{id}` | MISSING | |
| `/api/workspaces/{id}/invites` | DONE | Create invite |
| `/api/workspaces/{id}/members` | DONE | List/change role/remove |
| `/api/workspaces/{id}/sso` | MISSING | Schema only |

### Extra Project3383 endpoints

| Path | Status | Notes |
|---|---|---|
| `GET /api/tasks?workspaceId=...` | DONE | Dependency picker |
| `POST /api/tasks/{id}/complete` | DONE | Move to Done |
| `POST /api/tasks/{id}/reopen` | DONE | Move to first open column |
| `POST /api/tasks/{id}/dependencies` | DONE | Cycle check |
| `DELETE /api/tasks/{id}/dependencies/{dependsOnTaskId}` | DONE | |
| `POST /api/tasks/{id}/reminders` | DONE | In-app reminder |
| `DELETE /api/reminders/{id}` | DONE | |
| `PATCH /api/notifications/{id}/read` | DONE | |
| `PATCH /api/notifications/read-all` | DONE | |

## 2. Data model parity (37 reference models)

| Model | Project3383 status | Notes |
|---|---|---|
| User | DONE | `app_user` |
| Session | SCHEMA | `auth_session` table; runtime uses HttpSession |
| Workspace | DONE | |
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
| ActivityEvent | SCHEMA | No activity UI/API yet |
| AuditEvent | SCHEMA | No audit API/jobs yet |
| Reminder | DONE | |
| View | SCHEMA | No saved-view UI/API |
| AutomationRule | SCHEMA | No automation service |
| AutomationRun | SCHEMA | |
| Notification | DONE | |
| UserSettings | DONE | Settings UI + GET/PATCH API |
| PlanBlock | DONE | Auto-plan |
| TodayDismissal | DONE | |
| TodaySelection | DONE | Rewrite-specific per-user selection table; reference uses shared `Task.focusDate` |
| MagicLinkToken | SCHEMA | |
| Invite | DONE | |
| OidcConfig | SCHEMA | SSO not implemented |
| ApiToken | SCHEMA | API-token service not implemented |
| Webhook | SCHEMA | |
| WebhookDelivery | SCHEMA | |
| IdempotencyKey | SCHEMA | |
| UndoAction | SCHEMA | No undo service yet |
| EmailMessage | SCHEMA | |
| JobRun | SCHEMA | |
| ClientError | SCHEMA | |
| OAuthAccount | SCHEMA | |
| BackupRun | SCHEMA | |
| FeatureFlag | SCHEMA | |

## 3. UI / behavior parity

| Area | Status | Notes |
|---|---|---|
| Auth / guest / signup / signin | DONE | |
| App shell / workspace switcher | DONE | |
| Board / columns / task CRUD | DONE | |
| Task drawer fields | PARTIAL | Missing recurrence, assignee, reminders display parity, full labels management |
| Task comments / checklist | DONE | |
| Task dependencies | DONE | |
| Attachments | DONE | |
| Task completion / reopen | DONE | |
| Labels | PARTIAL | Task-scoped labels; no label manager |
| Today / capacity / accept / dismiss | PARTIAL | Workspace-scoped, per-user selection, capacity/reasons/blocked dependencies; rebalance/applyPlan still missing |
| Day Flow | PARTIAL | Vertical list; not the full reference rail/drag/visual parity |
| Smart Plan / Auto-plan | PARTIAL | Preview/apply/clear; no undo, no full settings |
| Calendar / ICS | DONE | Month calendar and ICS download |
| Search / Archive / Upcoming | PARTIAL | Search uses LIKE; Archive/Upcoming implemented |
| Insights | PARTIAL | Basic counts; full reference views missing |
| Settings / Focus / Voice / Sound | PARTIAL | Personal settings UI (account, appearance, language, planning, auto-plan, focus, notifications, features); Focus/Voice/Sound surfaces missing |
| Offline / PWA | MISSING | |
| i18n | MISSING | |
| Public board share | MISSING | |
| Automations / Webhooks | MISSING | |
| SSO / MFA / API tokens | MISSING | |
| Audit / Retention | MISSING | |
| Notifications / Reminders | DONE | In-app only |
| Members / Invites / Roles | DONE | |
| Export / Import | MISSING | |

## 4. Known accepted differences / limitations

- Runtime session is a custom Spring MVC `HttpSession` interceptor, not full Spring Security form login.
- Full token-based CSRF remains hardening; cookie mutations are protected by Origin validation.
- SQLite schema is managed by Flyway versioned migrations.
- `Today` is workspace-scoped and uses a per-user `today_selection` table; `Task.focusDate` is still mirrored for API compatibility but is no longer the source of truth.
- Today does not yet implement the reference `rebalance` and `applyPlan` actions.
- Auto-plan is a deterministic first pass; it does not yet support undo, full user settings, task-change invalidation, or exact reference UI.
- UI is functionally close but not pixel-parity with ProjectA2.
- No live SMTP, OAuth/SSO, or production deployment verification.

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
- [x] Complete model table inventory (37 mapped)
- [x] Session/authorization interceptor and guest/auth flow
- [x] Origin-based CSRF protection for cookie mutations (token-based CSRF remains hardening)
- [x] Session-based authentication and role authorization (full Spring Security filter-chain migration listed as hardening)
- [x] Member/guest write-role enforcement on task, board, attachment, reminder, and workspace-admin paths
- [x] Flyway versioned baseline migration
- [x] Settings table + GET/PATCH `/api/settings`
- [x] Account profile update + personal Settings UI (appearance, language, planning, auto-plan, focus, notifications, features)
- [x] Baseline API/unit smoke tests and setup/runbook

## 6. Next work after Phase 0/1

1. Full Spring Security filter-chain migration and token-based CSRF hardening.
2. Remaining workspace/security/audit/data settings; Today rebalance/applyPlan.
3. Task recurrence/assignee and full drawer parity.
4. Auto-plan undo, task-change invalidation, full constraints.
5. Calendar, Search, Insights.
6. Focus, Voice, Settings, i18n, Offline.
7. Automations, webhooks, SSO/MFA, tokens, audit/retention.
8. Full E2E, screenshots, performance, and final parity sign-off.
