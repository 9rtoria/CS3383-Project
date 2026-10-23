# START HERE

This is the evaluator entry point for the Project A v1.3 delivery. The application is **Drift**, a working full-stack planner/Kanban app. Everything below was produced in one continuous run and is backed by the evidence linked here.

## 1. Run it in two commands

```bash
npm run setup -- --seed
npm run dev
```

Open <http://localhost:3000>. No signup is required; the first request creates a guest workspace. To see the seeded team workspace, sign in with:

- **Email:** `demo@drift.local`
- **Password:** `DriftDemo123!`

Production-style check:

```bash
npm run build
npm run start
```

## 2. Ten-minute evaluator tour

| Minute | Do this | What to look for |
|---:|---|---|
| 0 | Open `/` signed out | Guest workspace appears; capture is the first focusable action; no signup wall |
| 1 | Press `C`, type `Draft launch note tomorrow 2pm !high #Work ~30m`, Enter | Natural-language parsing; task appears in Today/board; toast confirms |
| 2 | Open **My tasks**, focus a card, press `Alt+ArrowRight` | Keyboard move, live-region announcement, undo toast |
| 3 | Press `Ctrl/Cmd+K`, type “insights” | Command palette; keyboard navigation; `G I` also opens Insights |
| 4 | Open **Insights** | Timeline, workload by person, board health, one suggested focus |
| 5 | Press `/`, search a task, filter by priority/status | Instant scoped search and filters |
| 6 | Open a task drawer | Inline title/description, dates, estimate, priority, labels, checklist, comments, attachments, activity |
| 7 | Sign in as demo, open **Settings → Workspace** | Members, invites, retention, audit (team/org only) |
| 8 | **Settings → Automations** | Draft a rule, preview matches, apply, inspect audit, undo |
| 9 | **Settings → Integrations** | Webhooks, API tokens, SSO for org workspaces, ICS feed |
| 10 | Go offline in DevTools, capture a task, reconnect | Queued locally, explicit sync state, replay; stale writes show a conflict |

A longer script with exact expected text is in [docs/DEMO.md](docs/DEMO.md).

## 3. Evidence index

| Evidence | Location |
|---|---|
| Final review and limitations | [REVIEW.md](REVIEW.md) |
| Build output | `build-output.txt` |
| Typecheck output | `typecheck-output.txt` |
| Lint output (0 errors, warnings triaged) | `lint-output.txt` |
| Unit test output (78/78) | `test-output.txt` |
| E2E output (12/12) | `e2e-output.txt` |
| Lighthouse summary and reports | `perf-output.txt`, `perf-run-1.txt`, `perf-run-2.txt`, `perf-run-early-outlier.txt`, `docs/performance/` |
| Screenshots (9) | `docs/screenshots/` |
| Dependency audit | `audit-output.txt` |
| Background jobs | `jobs-output.txt` |
| Health/OpenAPI/metrics smoke | `smoke-output.txt` |
| OpenAPI contract | [docs/openapi.yaml](docs/openapi.yaml), served at `/api/openapi` |
| Requirement traceability | [docs/PRD.md](docs/PRD.md) |
| Time log | [PROGRESS.md](PROGRESS.md), consolidated in [REVIEW.md](REVIEW.md) |

Verified commands and observed results are pasted in [REVIEW.md](REVIEW.md) §3. Nothing in that table is inferred.

## 4. Requirement map (short form)

| ID | Requirement | Primary evidence |
|---|---|---|
| FR-001 | Guest-first auth, account claim, sessions, MFA, OAuth/SSO | Guest bootstrap, `/auth`, `/api/security/mfa`, E2E AC-009/AC-005 |
| FR-001b | Workspaces, tenancy, RBAC, invites | `lib/authz.ts`, workspace APIs, E2E FR-020/FR-021, cross-workspace 404 test |
| FR-002 | Boards and columns | Board CRUD/duplicate/share, templates, archive, board UI |
| FR-003 | Tasks | Drawer, labels, dates, estimates, checklist, comments, attachments, activity, dependencies |
| FR-004 | Kanban interaction | Pointer drag, `Alt+Arrow` keyboard move, optimistic update, undo, WIP |
| FR-005 | Views | Kanban, list, Today, Upcoming, Calendar, Archive, Insights, saved views |
| FR-006 | Search | FTS5/LIKE fallback, filters, palette, `/` search |
| FR-007 | Recurrence and reminders | RRULE subset, completion roll-forward, `jobs`, notification preferences |
| FR-008 | Import/export and deletion | CSV/JSON export, CSV/JSON import, account delete with typed confirmation |
| FR-009 | Accessibility | Keyboard matrix, focus management, axe scan, VPAT |
| FR-010 | Admin and audit | Members, roles, retention, audit, feature flags, enterprise gating |
| FR-011 | Integrations | ICS feed, webhooks with retries, email outbox/digest |
| FR-012 | Offline/PWA | Service worker, cached bootstrap, queued writes, conflict UI |
| NFR-001…009 | Security, performance, reliability, privacy, operability | [docs/SECURITY.md](docs/SECURITY.md), [docs/PERFORMANCE.md](docs/PERFORMANCE.md), [docs/OPERATIONS.md](docs/OPERATIONS.md) |
| AC-001…AC-010 | Acceptance criteria | E2E test titles and PRD acceptance table |
| SX-1…SX-6 | Experience qualities | PRD, design system, demo script |

The full table with status and caveats is in [docs/PRD.md](docs/PRD.md) §7.

## 5. What is intentionally not claimed

- Docker image execution: **unverified** (Docker unavailable).
- Live OAuth/SSO provider round-trips: **unverified** (no credentials).
- Attachment malware scanning: **not implemented**.
- Manual screen-reader review: **not performed**.
- 10k-user load test: **not performed**; SQLite is the demo database.

These are repeated in [REVIEW.md](REVIEW.md) with mitigations. They are not hidden in prose.

## 6. Reading order

1. This file.
2. [REVIEW.md](REVIEW.md) — outcome, evidence, limitations, time.
3. [docs/PRD.md](docs/PRD.md) — what was required and how it maps.
4. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how it works.
5. [docs/DEMO.md](docs/DEMO.md) — reproduce the experience.
6. [docs/SECURITY.md](docs/SECURITY.md), [docs/OPERATIONS.md](docs/OPERATIONS.md), [docs/PROCUREMENT.md](docs/PROCUREMENT.md), [docs/VPAT.md](docs/VPAT.md) — diligence artifacts.
