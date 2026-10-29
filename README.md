# Drift — ProjectA2 experiment

**Drift** is a calm, keyboard-first personal task planner and Kanban board with real team and enterprise foundations. This working tree is **ProjectA2**, an independent school-demo extension of the Project A v1.3 baseline (`ProjectA` remains untouched at `6876db1`).

- Capture a task without creating an account.
- Plan a realistic day with capacity-aware suggestions.
- See the day's shape in **Day Flow**, preview a local **Smart Plan**, and protect attention in **Focus Mode**.
- Capture by voice or keyboard, with a Sound Lab that stays quiet by default.
- Make the product yours with a real Settings experience: appearance, type, motion, language and region, planning, focus defaults, notifications, sound, keyboard, and feature toggles.
- Move work by mouse or keyboard, with undo and conflict handling.
- Grow into shared boards, roles, audit, SSO, automations, and API tokens without exposing enterprise chrome to solo users.

![Day Flow](docs/screenshots/10-day-flow.png)

> **Honesty note:** Smart Plan is deterministic local rules, explicitly labeled as such — not an AI model. Voice recognition uses the browser's speech service. See [docs/A2_EXPERIMENT.md](docs/A2_EXPERIMENT.md) for the A2 design rationale, verification, and limits.

## Quick start

Requirements: **Node.js 24+** and npm. SQLite is embedded; no Docker or external database is required for the local demo.

```bash
npm run setup -- --seed
npm run dev
```

Open <http://localhost:3000>. `setup` creates `.env` with fresh runtime secrets, applies the checked-in migrations, and seeds a demo workspace when `--seed` (or `SEED_DEMO=true`) is used.

**Demo account:** `demo@drift.local` / `DriftDemo123!`

The first visit without a session creates a real anonymous guest user, a personal workspace, and a “My tasks” board with To do / In progress / Done columns. No signup wall, modal, or tour stands between the visitor and the capture box.

### Production-style local run

```bash
npm run build
npm run start
```

### Useful commands

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Prisma generate + optimized Next.js build |
| `npm run start` | Start the production build |
| `npm run typecheck` | Strict TypeScript check |
| `npm run lint` | ESLint (0 errors; warnings are triaged) |
| `npm test` | 100 Vitest unit tests |
| `npm run test:e2e` | 31 Playwright journeys across Chromium, Firefox, and WebKit (93 executions) |
| `npm run test:a11y` | axe-core serious/critical scan |
| `npm run test:perf` | Authenticated Lighthouse smoke (requires a running server) |
| `npm run screenshots` | Regenerate `docs/screenshots/` |
| `npm run audit` | Production dependency audit |
| `npm run jobs` | Reminders, digests, retention, webhook retries |
| `npm run db:deploy` | Apply migrations without generating a new one |
| `npm run db:seed` | Reset the demo account/workspace and seed fresh fixtures |

## What is delivered

| Area | Capability |
|---|---|
| Capture | Quick capture with natural-language dates, priority, labels, estimates, recurrence; command palette; global shortcuts; **voice input with text fallback** |
| Planning | Today capacity plan with reasons and dismissal, Upcoming, Calendar, Archive, Kanban, List, saved views; **Day Flow rail**; **Smart Plan preview/apply/undo**; capacity, buffer, workday, block spacing, and default view settings |
| Auto-plan | Deterministic weekly scheduler with three plan options, rest intervals, protected lunch, weekly cap, long-task splitting, dependency/deadline awareness, safe/full/delegated automation levels, Today/Day Flow/Calendar writes, and undo |
| Settings | Theme (System/Light/Dark), accent, display type, reading size, density, motion, language/region, live preview, search, section reset, feature toggles |
| Focus | Full-screen timer, pause/resume, complete, early leave, tracked `actualMinutes`, estimate delta; default length and auto-start |
| Sound | Web Audio Sound Lab with three palettes, volume, top-bar mute, six previews, optional typing texture off by default |
| Tasks | Drawer editor, subtasks, comments, attachments, labels, dependencies, activity, reminders, recurrence, undo |
| Collaboration | Personal / team / org workspaces, invites, roles (owner/admin/member/guest), public read-only board links |
| Enterprise | Audit log, retention settings, SSO (OIDC), MFA (TOTP + backup codes), API tokens, webhooks, CSV/JSON import/export, account deletion |
| Automation | Rule builder, side-effect-free preview, apply, audit, 60-second undo |
| Assist | Deterministic quick-add parsing, capacity suggestions, checklist suggestions, **local Smart Plan rules**; opt-in and kill switch; no outbound customer data |
| Offline | PWA install, cached bootstrap, queued capture/move, explicit sync state, conflict 409 and review |
| Operations | Health, metrics, structured logs, request IDs, migrations, seed, background jobs, Docker/CI artifacts |

## Architecture at a glance

- **Next.js 16 App Router + React 19 + TypeScript strict** in one deployable unit.
- **Tailwind CSS 4** plus first-party accessible primitives and design tokens.
- **Prisma 7 + better-sqlite3** for a zero-setup demo; tenant-scoped queries and a documented PostgreSQL path.
- **First-party auth**: opaque hashed session cookies, scrypt passwords, TOTP MFA, magic links, OAuth, workspace OIDC SSO, guest claim.
- **Server-authoritative offline** with a version column, idempotency keys, queued mutations, and explicit 409 conflict UX.
- **Deterministic local assist** with evaluation fixtures and a global kill switch.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DATA_MODEL.md](docs/DATA_MODEL.md), and [DECISIONS.md](DECISIONS.md).

## Documentation map

| Start here | |
|---|---|
| [START_HERE.md](START_HERE.md) | Evaluator tour, evidence index, and requirement map |
| [docs/PRD.md](docs/PRD.md) | Personas, requirements, acceptance criteria, scope |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, modules, data flow, tenancy |
| [docs/FLOWS.md](docs/FLOWS.md) | End-to-end flows and failure states |
| [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) | Tokens, type, spacing, components, responsive rules |
| [docs/MOTION.md](docs/MOTION.md) | Motion principles and reduced-motion behavior |
| [docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md) | WCAG 2.2 AA approach, keyboard matrix, gaps |
| [docs/SECURITY.md](docs/SECURITY.md) | Controls, threat model, disclosure, limitations |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Runbook, backup/restore, monitoring, jobs |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Local, Docker, standalone, PostgreSQL, CI |
| [docs/PERFORMANCE.md](docs/PERFORMANCE.md) | Lighthouse method and measured results |
| [docs/TESTING.md](docs/TESTING.md) | Test strategy, evidence, known gaps |
| [docs/API.md](docs/API.md) | REST contract, headers, errors, endpoint index |
| [docs/AI_GOVERNANCE.md](docs/AI_GOVERNANCE.md) | Data boundary, evaluation, oversight, kill switch |
| [docs/PROCUREMENT.md](docs/PROCUREMENT.md) | Security questionnaire and commercial posture |
| [docs/VPAT.md](docs/VPAT.md) | WCAG 2.2 A/AA conformance report |
| [docs/DEMO.md](docs/DEMO.md) | Five-minute ProjectA2 demo script |
| [docs/A2_EXPERIMENT.md](docs/A2_EXPERIMENT.md) | ProjectA2 feature rationale, verification, and limits |
| [docs/SETTINGS.md](docs/SETTINGS.md) | Settings information architecture, behavior, language/type notes, accessibility |
| [docs/AUTO_PLAN.md](docs/AUTO_PLAN.md) | Deterministic Auto-plan contract, levels, constraints, write path, limits |
| [REVIEW.md](REVIEW.md) | Final delivery review, evidence, limitations, time table |

The live API contract is served at `/api/openapi` and stored in [docs/openapi.yaml](docs/openapi.yaml).

## Screenshots

| Today | Board | Task drawer |
|---|---|---|
| ![](docs/screenshots/01-today.png) | ![](docs/screenshots/02-board.png) | ![](docs/screenshots/03-task-drawer.png) |

| Calendar | Insights | Command palette |
|---|---|---|
| ![](docs/screenshots/04-calendar.png) | ![](docs/screenshots/05-insights.png) | ![](docs/screenshots/06-command-palette.png) |

### ProjectA2 states

| Day Flow | Smart Plan | Focus Mode |
|---|---|---|
| ![](docs/screenshots/10-day-flow.png) | ![](docs/screenshots/11-smart-plan.png) | ![](docs/screenshots/12-focus-mode.png) |

| Sound Lab | Voice Capture | Mobile / dark |
|---|---|---|
| ![](docs/screenshots/14-sound-settings.png) | ![](docs/screenshots/15-voice-capture.png) | ![](docs/screenshots/16-mobile-today.png) |

| Appearance | Language & region | Planning |
|---|---|---|
| ![](docs/screenshots/18-appearance.png) | ![](docs/screenshots/19-language-region.png) | ![](docs/screenshots/20-planning.png) |

| Notifications | Mobile settings | Dark settings |
|---|---|---|
| ![](docs/screenshots/21-notifications.png) | ![](docs/screenshots/22-mobile-settings.png) | ![](docs/screenshots/23-dark-appearance.png) |

| Auto-plan Today | Auto-plan review | Auto-plan settings |
|---|---|---|
| ![](docs/screenshots/24-auto-plan.png) | ![](docs/screenshots/26-auto-plan-modal.png) | ![](docs/screenshots/25-auto-plan-settings.png) |

See [docs/screenshots/README.md](docs/screenshots/README.md) for the full manifest.

## Honest limits

- Docker is not installed in the delivery environment. The Dockerfile and Compose file are provided and syntax-reviewed, but the image was **not executed** here.
- OAuth (GitHub/Google/Apple) and OIDC SSO require external provider credentials. Their routes and state/PKCE handling exist; live provider round-trips are **unverified**.
- Attachments use MIME/size checks and authenticated download, but **malware scanning is not implemented**. Disable attachments for untrusted uploads.
- Email uses SMTP when configured; otherwise a persisted development outbox is used. Invite/magic-link delivery in production requires SMTP.
- Automated axe and keyboard testing pass; **manual NVDA/VoiceOver testing was not possible** in this environment.
- SQLite is appropriate for the demo and small teams, not the 10k-user target. See the PostgreSQL rollout in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
- “AI” in v1 is deterministic, explainable assistance, not an external LLM. **Smart Plan is local rules and is labeled that way**; it does not learn or call a model. See [docs/AI_GOVERNANCE.md](docs/AI_GOVERNANCE.md).
- Voice capture depends on the browser's speech service; text capture is always available. Automated coverage uses a fake browser recognizer; a real-microphone pass across browsers/devices remains a manual check.
- The Sound Lab is a designed prototype, not a mastered audio identity. Audition it on the target speakers/headphones; automated checks cannot judge timbre. Sound preferences are intentionally device-local.
- Focus Mode tracks accumulated `actualMinutes`; it is not a time-entry ledger with edit history.
- Language is a **preview**: the app shell, Today, planning surfaces, capture, and Settings are translated. Workspace admin, audit, and some enterprise copy remain English.
- Type choices use system font stacks, not downloaded web fonts. Chinese typography depends on the fonts available on the demo machine.
- Browser notification permission is controlled by the browser; the OS decides whether a background notification makes a sound.
- Auto-plan uses the tasks and settings already inside Drift. It does not read external calendars, email, or a hidden model. Background execution while the app is closed requires an external worker.

## License / status

Private delivery artifact for the Project A brief. No license is granted for redistribution. Product name, data, and screenshots are fictional demo content.
