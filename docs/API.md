# API guide

**Base URL:** `http://localhost:3000`  
**Contract:** [`docs/openapi.yaml`](openapi.yaml), also served at `GET /api/openapi`  
**Version:** 1.0.0  
**Last updated:** 2026-10-23

The API is a JSON REST surface implemented by Next.js route handlers. It is the same surface the web client uses; there is no private browser-only backend.

## 1. Authentication

Two credential types are accepted:

| Credential | Header / cookie | Notes |
|---|---|---|
| Browser session | `drift_session` HttpOnly cookie | Created by guest, sign-up, sign-in, magic link, OAuth, or SSO |
| Personal access token | `Authorization: Bearer drift_pat_…` | Created in Settings → Integrations; bound to one user and workspace |

Rules:

- Cookie-authenticated **mutations** must send `Origin` matching `APP_URL` or the request origin. Missing or foreign origins return `403 CSRF_FAILED`.
- Bearer requests skip the Origin check but still resolve the token owner and workspace. A token for workspace A cannot read or write workspace B.
- API tokens currently inherit the owner’s workspace role. There are **no per-token scopes**; create tokens only for trusted integrations. This is a documented limitation, not a claim of least privilege.
- Workspace-scoped routes require `X-Workspace-Id` (preferred) or `?workspaceId=`.
- Public routes: `/api/health`, `/api/openapi`, `/api/auth/*` endpoints that begin a flow, `/api/share/[token]`, and `/api/calendar/ics` with a valid token.

## 2. Request conventions

```http
GET /api/today?workspaceId=ws_123 HTTP/1.1
Origin: http://localhost:3000
Cookie: drift_session=…
X-Workspace-Id: ws_123
```

- JSON request bodies must use `Content-Type: application/json`.
- JSON bodies are capped at **2 MB**. Attachment upload uses multipart and its own cap.
- Send `Idempotency-Key: <uuid>` on retryable writes (task create/move, comments, imports). A replay returns the original status/body with `Idempotent-Replayed: true`.
- Reusing a key for a different method/path returns `409 CONFLICT`.
- Every response includes `x-request-id`; logs use the same ID.

### Rate limits

Fixed one-minute windows, keyed by IP + path (public routes use an anonymous bucket):

| Scope | Limit |
|---|---|
| Auth routes | 20/min |
| General API | 180/min |
| Health | 300/min |
| Uploads, magic links, client errors | Stricter per-route buckets |

Exceeding a limit returns `429 RATE_LIMITED` with `Retry-After`.

## 3. Response shape

Success bodies are **domain-keyed**, not wrapped in `data`:

```json
{ "task": { "id": "tsk_…", "title": "Shape the launch story", "version": 3 } }
```

Lists use the plural key and, where paginated, a cursor:

```json
{ "results": [], "nextCursor": null }
```

Errors are uniform:

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Choose a board.",
  "details": { "fieldErrors": { "boardId": ["Required"] } },
  "requestId": "2f1c9b1e-…"
}
```

Common codes: `UNAUTHORIZED`, `FORBIDDEN`, `WORKSPACE_NOT_FOUND`, `TASK_NOT_FOUND`, `VALIDATION_ERROR`, `CONFLICT`, `VERSION_CONFLICT`, `RATE_LIMITED`, `CSRF_FAILED`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `MFA_REQUIRED`, `INTERNAL_ERROR`.

`VERSION_CONFLICT` includes the current server entity in `details.current` so the client can offer “Keep mine / Use server”.

## 4. Endpoint index

All paths are relative to the base URL. `W` means workspace-scoped.

### Auth and account

| Method | Path | Purpose |
|---|---|---|
| POST/GET | `/api/auth/guest` | Create/resume an anonymous guest session |
| POST | `/api/auth/signup` | Claim a guest or create an account |
| POST | `/api/auth/signin` | Password sign-in |
| POST | `/api/auth/magic` | Request a magic link |
| POST | `/api/auth/magic/verify` | Verify a magic-link token |
| POST | `/api/auth/mfa/challenge` | Complete a TOTP challenge |
| POST | `/api/auth/signout` | Revoke the current session |
| GET/POST | `/api/auth/oauth/[provider]` | Start GitHub/Google/Apple OAuth |
| GET | `/api/auth/oauth/[provider]/callback` | OAuth callback |
| GET | `/api/auth/sso/[workspaceId]` | Start workspace OIDC SSO |
| GET | `/api/auth/sso/[workspaceId]/callback` | OIDC callback |
| GET/POST/DELETE | `/api/security/mfa` | MFA status/setup/enable/disable, list sessions, revoke a session |
| PATCH/DELETE | `/api/account` | Update profile or delete account |

### Shell and planning

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/bootstrap` | Viewer, workspaces, boards, labels, settings, inbox, flags |
| GET | `/api/today` | Ranked plan, capacity contract, suggestions |
| GET | `/api/upcoming` | Next 14 days grouped by local date |
| GET | `/api/calendar` | Tasks in a date range |
| GET | `/api/calendar/ics` | Tokenized ICS subscription |
| GET | `/api/insights` | Timeline, workload, board health, focus suggestion |
| GET | `/api/archive` | Archived tasks |
| GET | `/api/search` | Full-text search with filters and cursor |

### Boards and columns

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/api/boards` | List/create boards |
| GET/PATCH/DELETE | `/api/boards/[id]` | Board detail, update, soft delete |
| POST | `/api/boards/[id]/duplicate` | Duplicate with columns and tasks |
| POST/DELETE | `/api/boards/[id]/share` | Enable/disable public read-only link |
| GET/POST | `/api/columns` | List/create columns |
| PATCH/DELETE | `/api/columns/[id]` | Update/delete a column |
| POST | `/api/columns/reorder` | Reorder columns |

### Tasks and collaboration

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/api/tasks` | Filter tasks / create a task |
| GET/PATCH/DELETE | `/api/tasks/[id]` | Task detail, edit, soft delete |
| POST | `/api/tasks/[id]/move` | Move across columns/positions with version check |
| GET/POST | `/api/tasks/[id]/subtasks` | List/add checklist items |
| PATCH/DELETE | `/api/subtasks/[id]` | Update/delete checklist item |
| GET/POST | `/api/tasks/[id]/comments` | List/add comments |
| POST | `/api/tasks/bulk` | Bulk archive, delete, move, or label |
| POST | `/api/undo/[id]` | Apply a stored inverse operation |
| GET/POST | `/api/labels` | List/create labels |
| GET/POST | `/api/views` | Saved views |
| GET/POST | `/api/attachments` | Upload attachment (multipart) |
| GET/DELETE | `/api/attachments/[id]` | Authenticated download / delete |
| GET | `/api/notifications` | Inbox |
| PATCH | `/api/notifications` | Mark read / mark all read |

### Workspace and enterprise

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/api/workspaces` | List/create workspaces |
| GET/PATCH/DELETE | `/api/workspaces/[id]` | Workspace detail, policy, delete |
| GET/POST/PATCH/DELETE | `/api/workspaces/[id]/members` | Membership management |
| GET/POST | `/api/workspaces/[id]/invites` | Invite list/create |
| POST | `/api/invites/[token]` | Accept an invitation |
| GET/PATCH | `/api/workspaces/[id]/sso` | OIDC configuration |
| GET | `/api/audit` | Audit log (admin, `audit:read`) |
| GET/POST | `/api/automations` | Rule list/create |
| PATCH/DELETE | `/api/automations/[id]` | Update/delete rule |
| POST | `/api/automations/preview` | Side-effect-free rule preview |
| GET/POST | `/api/tokens` | List/create personal access tokens |
| DELETE | `/api/tokens/[id]` | Revoke token |
| GET/POST | `/api/webhooks` | List/create webhooks |
| PATCH/DELETE | `/api/webhooks/[id]` | Update/delete webhook |
| GET/POST | `/api/export` | CSV/JSON export |
| POST | `/api/import` | CSV/JSON import (1,000 tasks / 5 MB) |
| GET/PATCH | `/api/settings` | User settings and notification preferences |

### Public and operations

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/share/[token]` | Public read-only board |
| GET | `/api/health` | Liveness + database latency |
| GET | `/api/metrics` | Process/tenant counters |
| GET | `/api/openapi` | This contract as JSON/YAML |
| POST | `/api/client-errors` | Browser error report (rate-limited) |

## 5. Key request examples

### Create a task

```http
POST /api/tasks
Origin: http://localhost:3000
X-Workspace-Id: ws_123
Content-Type: application/json
Idempotency-Key: 5b0d…

{
  "boardId": "brd_123",
  "columnId": "col_todo",
  "title": "Draft launch narrative",
  "priority": "high",
  "estimateMinutes": 45,
  "dueDate": "2026-10-25T09:00:00.000Z",
  "labelIds": []
}
```

`201` returns `{ "task": { … } }`.

### Move a task

```http
POST /api/tasks/tsk_123/move
Origin: http://localhost:3000
Content-Type: application/json

{ "columnId": "col_done", "beforeId": null, "afterId": "tsk_456", "version": 4 }
```

A stale `version` returns `409 VERSION_CONFLICT`; the task is not moved.

### Preview an automation

```http
POST /api/automations/preview
Origin: http://localhost:3000
Content-Type: application/json

{
  "trigger": "task.moved",
  "conditions": { "toColumnIsDone": true },
  "actionType": "add_label",
  "actionValue": "label_shipped",
  "boardId": "brd_123"
}
```

The response reports how many existing tasks would change and a sample diff. Preview writes nothing.

### Export

`GET /api/export?format=csv&workspaceId=ws_123` streams a CSV with a header row. JSON export returns boards, columns, tasks, labels, and comments. Exports are scoped to the caller’s workspace and role.

### Import

`POST /api/import` accepts `{ workspaceId, boardId, format: "json" | "csv", content }`. The cap is **1,000 tasks per request and 5 MB**. Rows are validated before insert; invalid rows are reported with row numbers. Import is not transactional across the whole file: valid rows commit, invalid rows are skipped. Use `Idempotency-Key` to avoid duplicate imports.

## 6. Pagination and filtering

- `GET /api/search` uses `cursor` and `limit` (max 100); response includes `nextCursor`.
- `GET /api/tasks` accepts `boardId`, `columnId`, `assigneeId`, `labelId`, `priority`, `status`, `q`, `cursor`, `limit`.
- `GET /api/audit` accepts `action`, `actorId`, `from`, `to`, `cursor`.
- Dates in filters are ISO 8601; `focusDate` is a `YYYY-MM-DD` local date key.

## 7. Webhooks

Workspace admins can register Slack, Teams, or generic endpoints. Supported events: `task.created`, `task.moved`, `task.completed`, `task.deleted`, `comment.created`.

- First delivery is best-effort and does not block the API request.
- Every attempt is persisted in `WebhookDelivery` with status, response excerpt, attempts, and next attempt time.
- `npm run jobs` retries failed deliveries up to **3 attempts** with 5/15/45-minute backoff.
- Webhook secrets are encrypted at rest; payload signing is **not implemented** in v1. Verify the source by network allowlist or a shared secret header added by your gateway.
- No SSRF allowlist is enforced on webhook URLs. Restrict egress at the network layer before production. This is a documented gap.

## 8. Versioning and compatibility

The API is versioned by the `info.version` field (`1.0.0`). There is no `/v2` yet. Additive fields may appear without a version bump; clients must ignore unknown fields. Breaking changes require a new major version and a migration note.

## 9. Contract validation

`docs/openapi.yaml` documents **63 paths**. It is parsed by `js-yaml` in the test suite and served at `/api/openapi`. The route index above is generated from `app/api/**/route.ts`; if you add a route, update the YAML and this table in the same change.
