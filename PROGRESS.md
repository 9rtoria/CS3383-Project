# PROGRESS

> Start: **2026-10-23 19:11 +08:00**. Actuals are wall-clock effort reconstructed from artifact timestamps and command logs, rounded to 0.01 h; they are not stopwatch measurements. Estimates are in `PLAN.md`. Categories: BUILD / DESIGN / VERIFY / OPTIMIZE / OVERHEAD.

## Current state

- **Phase:** M7 complete — final QA and delivery review.
- **Application status:** runnable; production build verified; guest, board, Today, Insights, search, offline, sharing, automation, and settings flows browser-tested.
- **Last verified commands:** `npm run typecheck`, `npm test` (78/78), `npm run lint` (0 errors, 44 warnings), `npm run build`, Playwright (12/12), Lighthouse (94/97/95 latest; 94–97 across three stable runs), `npm audit --omit=dev` (0 vulnerabilities), `npm run jobs` (all jobs exit 0), `/api/health`, `/api/openapi`, and `/api/metrics` smoke.
- **Open items:** Docker image unverified; live OAuth/SSO unverified; malware scanning absent; manual screen-reader audit pending; 10k-user load test not run.
- **Delivery:** `REVIEW.md` contains the final evidence index, limitations, and consolidated time table.

## Time log

| Milestone | Scope | Start | End | BUILD | DESIGN | VERIFY | OPTIMIZE | OVERHEAD | Notes |
|---|---|---|---:|---:|---:|---:|---:|---:|---|
| M0 | Plan, assumptions, risks, backlog, decisions | 19:11 | 19:20 | 0.05 | 0.05 | 0.02 | 0.00 | 0.03 | Artifacts authored before code. |
| M1 | Scaffold, tokens, Prisma 7 schema/migrations, auth, guest bootstrap, seed | 19:20 | 19:55 | 0.35 | 0.10 | 0.05 | 0.02 | 0.06 | Prisma 7 adapter; four migrations. |
| M2 | Boards/columns/tasks, APIs, shell, drawer, comments/checklist | 19:55 | 20:25 | 0.30 | 0.08 | 0.06 | 0.02 | 0.04 | Single-page shell + task service. |
| M3 | Kanban drag, keyboard move, optimistic UI, undo, bulk | 20:25 | 20:40 | 0.12 | 0.04 | 0.05 | 0.02 | 0.02 | Native DnD + Alt+Arrow parity. |
| M4 | Today/Upcoming/Calendar/Archive, search, views, recurrence, reminders, notifications | 20:40 | 21:00 | 0.18 | 0.05 | 0.06 | 0.02 | 0.02 | Capacity contract fixed; FTS5 search. |
| M5 | Tenancy, RBAC, invites, audit, retention, SSO/OIDC, MFA, export/delete, tokens | 21:00 | 21:10 | 0.10 | 0.02 | 0.03 | 0.01 | 0.01 | OAuth/SSO routes unverified externally. |
| M6 | Automations, local assist, integrations, offline/PWA, motion, a11y, performance | 21:10 | 21:25 | 0.10 | 0.04 | 0.06 | 0.03 | 0.02 | Axe fixes, Lighthouse 94–97, webhook retry. |
| M7 | Full QA, docs, screenshots, deployment artifacts, review | 21:25 | 22:15 | 0.20 | 0.08 | 0.30 | 0.12 | 0.13 | Docker/CI authored; Docker not executed; orphaned-webhook job bug fixed. |
| **Total** | | | | **1.40** | **0.46** | **0.63** | **0.24** | **0.33** | **3.06 h** |

OVERHEAD is **10.8%**, under the 15% ceiling. The 78-hour estimate in `PLAN.md` was a human-effort estimate; this run is a compressed agent execution. The gap is disclosed rather than presented as equivalent effort.

## Milestone retro log

### M0 — plan

The plan chose a single Next.js deployable, real tenant boundaries, and local deterministic assist rather than unverifiable external AI. Highest uncertainty was external SSO/OAuth and attachment scanning; both were flagged early and remain flagged.

### M1 — foundation

Prisma 7 required the `better-sqlite3` driver adapter and a `prisma-client` generator at `generated/prisma`; `migrate dev` complains about FTS5 shadow tables, so migrations are manual and applied with `migrate deploy`. Guest bootstrap creates a real user/workspace/board, which made the claim flow and E2E isolation tests possible.

### M2 — core work

The task service became the single mutation path for create, edit, move, recurrence, activity, and undo. That reduced drift between UI paths but made version handling critical; the 409 conflict contract and idempotency replay were added before the board UI.

### M3 — interaction

Native drag/drop avoided a heavy dependency and kept the keyboard path first-class. The cost is less polished touch physics; acceptable for v1. The board heading and task-card accessible-name fixes came from Lighthouse/axe, not from a design review.

### M4 — planning

The first Today capacity contract returned a total but the UI displayed “285 of 0 min”; the API now returns `totalMinutes`, `selectedMinutes`, `remainingMinutes`, `percent`, and `overbooked`, and the E2E test asserts the shape. Recurrence plural parsing was also fixed here.

### M5 — enterprise

Enterprise features are gated by workspace type in the UI but enforced server-side. SSO/OAuth routes are standards-based but cannot be called “verified” without a live IdP. API tokens are workspace-bound but have no per-token scopes; that is documented rather than implied.

### M6 — polish

The largest late fixes were accessibility: board column headings became `h2`, task cards stopped overriding their accessible name, and contrast tokens were darkened. Lighthouse accessibility reached 100. The webhook retry job and due-reminder job were added after a gap review; both were exercised with real database fixtures.

### M7 — delivery

Documentation now covers architecture, flows, design, motion, accessibility, security, threat model, operations, deployment, performance, testing, API, data model, AI governance, procurement, VPAT, and demo. Docker/CI artifacts are delivered but Docker execution is unverified. Final QA caught a real job failure: an orphaned webhook delivery crashed `webhook-retry`; the service now stops retrying it, with a regression test. Lighthouse was re-measured after removing the Playwright CDP attachment from the audit browser; the three stable final runs scored 94–97 performance with 100 accessibility/best practices. An earlier outlier run (83 drawer, 569 ms TBT) is retained separately. The final review states what passed, what did not, and what a buyer must do before production.

## Evidence files

| File | Contents |
|---|---|
| `build-output.txt` | Production build route table |
| `typecheck-output.txt` | Strict TypeScript result |
| `lint-output.txt` | ESLint result and warnings |
| `test-output.txt` | Vitest 78/78 |
| `e2e-output.txt` | Playwright 12/12 |
| `perf-output.txt` | Latest Lighthouse run log; `perf-run-1.txt`/`perf-run-2.txt` stable repeats; `perf-run-early-outlier.txt` earlier outlier |
| `screenshots-output.txt` | Screenshot capture log |
| `migrate-output.txt` | Prisma migrate deploy result |
| `audit-output.txt` | Production dependency audit |
| `jobs-output.txt` | Background job dispatcher result |
| `smoke-output.txt` | Health, OpenAPI, metrics, and header smoke |
| `docs/performance/summary.json` | Lighthouse metrics |
| `docs/screenshots/` | Nine production screenshots |
