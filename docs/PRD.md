# Product Requirements Document

**Product:** Drift  
**Brief:** Project A v1.3  
**Status:** Delivered v1.0.0  
**Owner:** Delivery engineering (single-run build)  
**Last updated:** 2026-10-23

## 1. Product statement

Drift is a calm, keyboard-first task planner for people who think in boards but live in a day. It opens directly into a real workspace, lets a visitor capture a task in seconds without an account, and then offers a capacity-shaped answer to “what should I do next?”. Teams can share boards, invite members, and adopt enterprise controls later without the solo experience ever showing admin chrome.

## 2. Problem and principles

Existing planners force a choice between a frictionless personal list and a configurable team platform. Signup walls, empty onboarding, and admin surfaces slow the first useful action. Drift’s principles:

1. **Capture before configuration.** The first screen is usable; no signup wall or tour.
2. **One obvious next action.** Today ranks work and explains why.
3. **Keyboard is a complete path.** Not a shortcut layer bolted onto pointer UI.
4. **Progressive disclosure.** At most seven primary controls; depth lives in the palette, drawer, and settings.
5. **Enterprise underneath, absent on the surface.** Personal workspaces never show audit/admin controls.
6. **Honest systems.** Every async path has pending, success, failure, offline, and conflict states.
7. **Data belongs to the user.** Export, deletion, retention, and tenant boundaries are product features.

## 3. Personas and jobs

| Persona | Context | Job to be done | Success signal |
|---|---|---|---|
| **Maya, independent designer** | Freelance, switches between personal and client work | Capture a client request before it evaporates; see a realistic day | First task in under 60 seconds; no account needed |
| **Jon, engineering lead** | Runs a small product team | See what is blocked, who owns it, and what changed | Board/list/insights; audit and mentions |
| **Priya, operations admin** | Owns workspace policy | Invite people, set roles, retain audit, connect SSO | Admin settings only in team/org workspaces |
| **Sam, enterprise buyer** | Security/procurement review | Confirm tenancy, data rights, accessibility, deployment | Security pack, VPAT, runbook, OpenAPI |
| **Alex, keyboard-only user** | Repetitive strain / preference | Complete every core flow without a pointer | Keyboard matrix and axe-clean UI |

## 4. Scope

### 4.1 In scope (delivered)

- Guest-first identity, account claim, password/magic-link/OAuth sign-in, TOTP MFA, session management.
- Personal, team, and org workspaces; invites; owner/admin/member/guest roles.
- Boards, columns, tasks, labels, subtasks, comments, attachments, dependencies, activity, reminders.
- Kanban, list, Today, Upcoming, Calendar, Archive, Insights, saved views.
- Full-text search, filters, command palette, keyboard movement, bulk actions, undo.
- Recurrence, notification preferences, email outbox/digest, ICS feed, webhooks.
- Automations with dry-run preview, audit, and undo.
- Deterministic local assist (quick-add parsing, capacity plan, checklist suggestions) with flags.
- Import/export, public read-only board links, account deletion, retention.
- PWA/offline capture and move queue, conflict detection.
- Admin: members, invites, audit, retention, SSO config, API tokens, webhooks.
- Operations: health, metrics, structured logs, migrations, jobs, Docker/CI artifacts.

### 4.2 Explicitly out of scope for v1

- Real-time multi-user presence/co-editing (CRDT).
- Two-way Google/Outlook calendar sync (ICS is delivered).
- SAML SSO (OIDC delivered).
- Native mobile apps.
- External LLM inference.
- Marketplace/template governance.
- Malware scanning of attachments.
- Billing/subscription management.
- Full localization/RTL content (infrastructure is locale-aware; English copy ships).

## 5. Functional requirements

Status legend: **Delivered** = implemented and exercised; **Delivered, limited** = implemented with a documented constraint; **Partial** = meaningful subset; **Not delivered** = absent.

| ID | Requirement | Delivered behavior | Status | Evidence |
|---|---|---|---|---|
| FR-001 | Authentication and onboarding | Guest bootstrap creates a real anonymous user/workspace; `/auth` claims it with email/password; magic link; GitHub/Google/Apple OAuth routes; TOTP MFA with backup codes; session list and sign-out-everywhere | Delivered (external OAuth live round-trip unverified) | `app/api/auth/*`, `lib/auth-service.ts`, E2E AC-009/AC-005 |
| FR-001b | Tenancy and RBAC | Workspace types personal/team/org; roles OWNER/ADMIN/MEMBER/GUEST; server-side action matrix; every object scoped by membership; invites; workspace switching | Delivered | `lib/authz.ts`, `prisma/schema.prisma`, E2E FR-020/FR-021 |
| FR-002 | Boards and columns | Create/rename/archive/duplicate boards; templates; reorder columns; WIP advisory/enforced; public read-only share; board filters | Delivered | `app/api/boards/*`, `app/api/columns/*`, board UI |
| FR-003 | Tasks | Create/edit/move/archive/delete; title, description, priority, dates, all-day, estimate, assignee, labels, recurrence, dependencies; subtasks; comments; attachments; activity | Delivered (attachment scanning limited) | Task drawer, task APIs, E2E |
| FR-004 | Kanban interaction | Native pointer drag; keyboard `Alt+Arrow`; optimistic move; undo; WIP warning/block; accessible live announcements | Delivered | `components/board-view.tsx`, E2E AC-001/AC-002 |
| FR-005 | Views | Kanban, list, Today, Upcoming, Calendar, Archive, Insights (timeline + workload), saved views | Delivered | `components/*`, E2E FR-005 |
| FR-006 | Search | SQLite FTS5 with LIKE fallback; scoped to accessible workspaces; title/description; priority/status/label filters; palette results; `/` shortcut | Delivered | `app/api/search/route.ts`, E2E search test |
| FR-007 | Recurrence and reminders | Daily/weekly/monthly intervals, weekdays, plural parsing; next occurrence on completion; reminder rows; `jobs` dispatcher; in-app notifications; email digest and quiet hours | Delivered (delivery requires scheduler/SMTP) | `lib/recurrence.ts`, `scripts/jobs.ts`, settings E2E |
| FR-008 | Import, export, deletion | JSON and CSV workspace export; CSV/JSON import (1,000 tasks / 5 MB); typed-confirmation account deletion; retention purge | Delivered | `app/api/export`, `app/api/import`, `app/api/account`, E2E AC-010 |
| FR-009 | Accessibility | Semantic landmarks, focus management, dialog focus trap/restore, keyboard matrix, live regions, contrast tokens, reduced motion, axe scan | Delivered (manual AT review not performed) | [ACCESSIBILITY.md](ACCESSIBILITY.md), `tests/e2e/a11y.spec.ts` |
| FR-010 | Admin and audit | Member management, role changes, invites, audit log, retention 7–3650 days, feature flags, enterprise gating | Delivered | Settings workspace/admin UI, `/api/audit` |
| FR-011 | Integrations | ICS calendar feed, generic/Slack/Teams webhooks with delivery retries, email outbox, API tokens | Delivered (external endpoints not exercised) | `/api/calendar/ics`, `/api/webhooks`, `lib/webhooks.ts` |
| FR-012 | Offline/PWA | Installable manifest, service worker, cached bootstrap, queued create/move, pending/failed queue UI, retry/discard, 409 conflicts | Delivered | `lib/offline.ts`, `public/sw.js`, E2E offline test |

## 6. Non-functional requirements

| ID | Requirement | Target | Delivered posture | Evidence |
|---|---|---|---|---|
| NFR-001 | Security | OWASP-aware auth/session/CSRF/tenant isolation | Opaque hashed sessions, scrypt, SameSite + Origin checks, RBAC, CSP, rate limits, idempotency, audit | [SECURITY.md](SECURITY.md) |
| NFR-002 | Performance | LCP < 2.5 s, CLS < 0.1, Lighthouse ≥ 95 where achievable | Lab: Today 94/100, Board 97/100, drawer 95/100 latest; LCP 2.43–2.66 s (drawer 158 ms over target); CLS ≤ 0.070 across three stable runs; Today TBT 225 ms is over the 200 ms budget and is a written exception | [PERFORMANCE.md](PERFORMANCE.md) |
| NFR-003 | Accessibility | WCAG 2.2 AA target | Axe serious/critical: 0 across 6 surfaces; keyboard flows verified; manual AT pending | [VPAT.md](VPAT.md) |
| NFR-004 | Reliability | No silent data loss; explicit failures | Versioned writes, 409 conflicts, undo, idempotency, offline queue, soft delete | E2E, task service |
| NFR-005 | Privacy | Data minimization and user control | Export/delete, retention, no outbound AI, PII-scoped audit, IP hashes | [SECURITY.md](SECURITY.md) |
| NFR-006 | Multi-tenancy | Strict workspace isolation | Membership-scoped queries; cross-workspace reads return 404 | E2E isolation test |
| NFR-007 | Operability | Health, logs, migrations, jobs, backup | `/api/health`, `/api/metrics`, JSON logs with request IDs, `jobs`, backup/restore runbook (no automated backup job) | [OPERATIONS.md](OPERATIONS.md) |
| NFR-008 | Portability | Local clean checkout; deployable artifact | Node 24 + SQLite one-command setup; standalone/Docker artifacts | README, Dockerfile |
| NFR-009 | Scale | 10k users target path | SQLite for demo/small teams; PostgreSQL + shared limiter + object storage documented | [DEPLOYMENT.md](DEPLOYMENT.md) |
| NFR-010 | Maintainability | Typed boundaries and explicit contracts | TypeScript strict, Zod, OpenAPI, ADRs, migrations, tests | typecheck, OpenAPI |

## 7. Acceptance criteria

| ID | Criterion | Result | Evidence |
|---|---|---|---|
| AC-001 | A task can be moved between columns by keyboard alone | Pass | E2E “keyboard move, undo, persistence” |
| AC-002 | Every move is announced and undoable | Pass | Live region assertion + undo toast |
| AC-003 | Board state survives reload | Pass | E2E reload assertion |
| AC-004 | Search returns scoped results with filters | Pass | E2E search test |
| AC-005 | Guest work survives account claim and later sign-in | Pass | E2E AC-009/AC-005 |
| AC-006 | Cross-workspace access is denied | Pass | E2E isolation test (404) |
| AC-007 | Stale writes are rejected with 409, not overwritten | Pass | E2E version conflict test |
| AC-008 | Automation changes are previewable, audited, and undoable | Pass | E2E automation test |
| AC-009 | First task can be captured in under 60 seconds without signup | Pass | E2E measures elapsed time; guest bootstrap assertions |
| AC-010 | User can export their data and import it into a new board | Pass | E2E JSON/CSV export + import |
| AC-011 | Offline capture queues and syncs after reconnect | Pass | E2E offline test |
| AC-012 | Public share is read-only and works without a session | Pass | E2E public share test |
| AC-013 | Settings persist across reload | Pass | E2E quiet hours/capacity test |
| AC-014 | Invited member joins only the intended team | Pass | E2E invite test |
| AC-015 | Today capacity contract is coherent | Pass | E2E asserts `totalMinutes`, `selectedMinutes`, `remainingMinutes`, `percent`, `overbooked` |

## 8. Experience qualities (SX)

| ID | Quality | How it is met |
|---|---|---|
| SX-1 | Calm visual system | Warm neutral canvas, one accent, restrained borders, no dashboard noise; [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) |
| SX-2 | Fast capture | `C` opens capture; natural-language parsing; optimistic add; ≤ 2 interactions to first task |
| SX-3 | Keyboard parity | Global shortcuts, roving focus, `Alt+Arrow` move, palette, dialog traps, visible focus |
| SX-4 | Honest automation | Preview diff before apply; audit row; 60-second undo; explicit “Assist” labeling |
| SX-5 | Progressive enterprise | Team/org settings appear only when relevant; personal workspace hides audit/SSO/admin |
| SX-6 | Graceful degradation | Offline banner, queued writes, retry/discard, 409 conflict sheet, skeleton/error states |

## 9. Success metrics

| Metric | Target | Instrumentation |
|---|---|---|
| Time to first task (guest) | < 60 s | E2E measurement; client timing event can be added to analytics |
| Keyboard task completion | 100% of core flows | Manual matrix + E2E |
| Serious/critical axe violations | 0 | CI `test:a11y` |
| LCP on key screens | < 2.5 s | Lighthouse lab |
| Cross-tenant leakage | 0 | E2E + authorization review |
| Undo availability | 100% of destructive/move actions | Service-level tests and UI toast |
| Offline replay success | 100% with no conflict; explicit 409 otherwise | E2E + queue tests |

## 10. Open product questions

These are recorded rather than silently resolved:

1. Should guest data merge into an existing account on sign-in, or remain a separate workspace? v1 keeps it separate and offers claim-on-signup. (`ASSUMPTIONS.md` A-004)
2. Should WIP limits default to advisory or enforcing? v1 defaults advisory, per-column enforcement opt-in.
3. Should “AI” remain local deterministic assistance or adopt an external provider? v1 local only; external adapter is backlog.
4. Should public share links support passwords/expiry? Backlog.
5. Should team guests be able to comment? v1 guest is read-only.

## 11. Traceability maintenance

Every requirement ID in this document appears in at least one of: a route/service, a test title, a settings surface, or a documented limitation. When a requirement changes, update this table, the relevant test, and `REVIEW.md` in the same change.
