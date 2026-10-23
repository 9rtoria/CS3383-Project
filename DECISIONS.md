# DECISIONS

Architecture decision records. Each decision includes status, context, choice, alternatives rejected, and rollback. Requirement references are maintained.

## ADR-000 — Delivery model

- **Status:** accepted
- **Date:** 2026-10-23
- **Context:** Brief v1.3 mandates continuous execution with no approval gates.
- **Decision:** Build a complete runnable application and artifacts in one run; record all non-obvious choices here and all uncertainty in `REVIEW.md`.
- **Alternatives rejected:** Milestone-by-milestone delivery (violates §8); mockups only (violates working-app requirement).
- **Rollback:** n/a.

## ADR-001 — Next.js monolith with route handlers

- **Status:** accepted
- **Context:** Need server-rendered shell, APIs, auth, and fast client interactions with minimal operational surface.
- **Decision:** Next.js 16 App Router + TypeScript. Route handlers use a shared wrapper that enforces same-origin checks, auth, Zod, request IDs, error envelopes, idempotency, and structured logs.
- **Alternatives rejected:** Separate Express API (more deploy units, CORS, duplicate types); tRPC (excellent but OpenAPI deliverable and external API requirement favor REST).
- **Rollback:** API handlers are isolated under `app/api`; could lift into an Express/Fastify service with minimal domain changes.

## ADR-002 — Prisma with SQLite for v1 local/CI

- **Status:** accepted; flagged for production review
- **Context:** Docker is unavailable in this environment; the brief prefers PostgreSQL/Prisma but requires a runnable clean checkout.
- **Decision:** Prisma 7 + SQLite via the `better-sqlite3` driver adapter, FTS5 search with LIKE fallback. Avoid SQLite-specific SQL in domain services. Provide `DATABASE_URL` switch, PostgreSQL deployment notes, and migrations.
- **Alternatives rejected:** Require external PostgreSQL (setup failure); JSON files/localStorage only (no tenant security, no concurrency); Postgres via embedded binary (large, platform-specific).
- **Rollback:** Provision PostgreSQL, set `provider="postgresql"`, regenerate a baseline migration, migrate seed; app code already uses Prisma. Switch FTS path to `tsvector`.
- **Why 6.x instead of 8 RC:** 6.19.3 is the latest stable line; prerelease ORM is not appropriate for a deliverable.

## ADR-003 — First-party sessions instead of Auth.js

- **Status:** accepted
- **Context:** Guest-first identity, account claim, MFA, org SSO, workspace switching, and logout-everywhere must all be under product control.
- **Decision:** Opaque 32-byte session tokens in httpOnly, SameSite=Lax cookies; SHA-256 token hashes in DB; absolute 30-day expiry; scrypt password hashes; TOTP; signed/encrypted OIDC secrets with AES-256-GCM. Guest sessions are real users with `isGuest=true`.
- **Alternatives rejected:** Auth.js (provider/session model complicates guest claim and tenant RBAC); JWT-only sessions (revocation/logout everywhere harder); third-party identity PaaS (secret/vendor dependency).
- **Rollback:** Migrate users to OIDC-only and delete password hashes; session table remains useful.
- **Security notes:** Same-origin check on mutations, rate limits, secure cookies in production, token rotation on sign in, CSRF defense via SameSite + Origin validation.

## ADR-004 — Guest-first identity

- **Status:** accepted
- **Context:** AC-009 and SX-5 require first task before signup.
- **Decision:** First request without a valid session is redirected through `/api/auth/guest`, which creates an anonymous user + personal workspace + starter board, sets a session, and returns to app. Signup upgrades that same user row with email/password; existing tasks and workspace are preserved. Sign-in to an existing account starts a separate session; guest data is not auto-merged (recorded as a limitation/rollback path).
- **Alternatives rejected:** Browser-only local store then bulk server sync (duplicate state machine, conflict risk); mandatory signup (violates brief).
- **Rollback:** Disable guest bootstrap and require auth; guest data can still be claimed with a one-time flow.

## ADR-005 — Native drag events rather than dnd-kit

- **Status:** accepted; revisit if drag complexity grows
- **Context:** §1.5 prioritizes small JS, instant feel; all moves need keyboard parity.
- **Decision:** Pointer HTML5 drag/drop for mouse/touch-like pointer, with a completed keyboard move path using `Alt+Arrow` and menu actions. All paths call the same optimistic move service. CSS transitions respect reduced motion.
- **Alternatives rejected:** dnd-kit (bundle cost, pointer/touch complexity, still needs keyboard implementation); Framer Motion drag (animations not logic, adds bundle).
- **Rollback:** Introduce dnd-kit behind the same `moveTask` client action; API unchanged.

## ADR-006 — Local heuristic assistant, not outbound LLM

- **Status:** accepted; review for AI roadmap
- **Context:** AI governance requires opt-in, reasons, no autonomous mutation, data boundary, latency budget, cost cap, and kill switch. No model/provider credentials are available.
- **Decision:** Implement explainable capacity suggestions, smart quick-add parsing, and checklist suggestions using deterministic local logic. Label them “Assist” (not deception). Workspace AI flag + global kill switch. No customer data leaves the app. Any suggestion is applied only on explicit accept. Add 20-scenario evaluation fixture/CI test.
- **Alternatives rejected:** External LLM with fake/hardcoded output (unverifiable, data boundary risk); omit AI entirely (fails SX-5).
- **Rollback:** Disable AI flag; core app continues.

## ADR-007 — Offline strategy

- **Status:** accepted
- **Context:** §6.6 requires one chosen strategy and explicit UX.
- **Decision:** Server-authoritative with field-level last-write-wins for queued field edits; optimistic UI; version/ETag on tasks (409 on stale write); operation queue in localStorage for create and move, replay on reconnect. True simultaneous conflicts are shown in a non-blocking sheet with “Keep mine / Use server” choices. Service worker caches app shell and read bootstrap; network-first.
- **Alternatives rejected:** CRDT (overkill); full offline database (IndexedDB complexity, conflict semantics); last-write-wins without UI (violates AC-007).
- **Rollback:** Hide offline queue and show read-only offline mode via feature flag; queued operations persist for manual retry.

## ADR-008 — Fractional ordering

- **Status:** accepted
- **Context:** Invariant requires no full renumbering.
- **Decision:** Lexicographic string keys between neighbors using base-62 midpoint; duplicate/boundary cases fall back to deterministic fractional extension. Server calculates for moves with neighbor IDs, client mirrors for optimistic UI. Tests cover first/last/repeated inserts.
- **Alternatives rejected:** integer positions (renumber races); float midpoints (precision exhaustion).
- **Rollback:** Periodic normalization job can rewrite positions while preserving order.

## ADR-009 — Undo service

- **Status:** accepted
- **Context:** Every destructive action must be undoable within 10s; automation changes too.
- **Decision:** Mutating services create short-lived `UndoAction` rows (actor, action, inverse payload, expiresAt). Client toast calls `/api/undo/[id]`; server authorizes and restores with version bump/audit. Delete uses soft delete. Undo expires after 10 seconds for destructive actions, 60s for moves.
- **Alternatives rejected:** Client-only undo (refresh loses it, not auditable); no expiry (ambiguous races).
- **Rollback:** Shorten/disable via setting; actions remain in audit.

## ADR-010 — Tenancy, roles, and enterprise gating

- **Status:** accepted
- **Context:** Personal is the default; org chrome must never leak to solo; RBAC/audit per workspace.
- **Decision:** `Workspace.type` personal/team/org and `Membership.role` OWNER/ADMIN/MEMBER/GUEST. Every query by object ID joins membership. Roles enforced server-side via action matrix:
  - read: all roles
  - content write: OWNER/ADMIN/MEMBER
  - membership/policy/audit: OWNER/ADMIN
  - ownership transfer/delete workspace: OWNER only
  - SSO config/retention: OWNER/ADMIN (org)
  Audit/policy UI only for team/org. Personal audit data recorded but not surfaced.
- **Alternatives rejected:** Global roles (violates workspace-level rule); hiding UI only (IDOR risk).
- **Rollback:** Any workspace can downgrade to team; membership matrix is centralized for updates.

## ADR-011 — Search implementation

- **Status:** accepted
- **Context:** 10k tasks per user, <300ms target at v1 data volumes.
- **Decision:** SQLite FTS5 virtual table maintained via triggers for title/description; query sanitized prefix tokens + structured filters. LIKE fallback on platforms lacking FTS5. Cursor pagination 100/page.
- **Alternatives rejected:** Client-only search (doesn't scale); external index (ops overhead).
- **Rollback:** Feature-detect and always LIKE; schedule migration to PostgreSQL.

## ADR-012 — Email, reminders, digests

- **Status:** accepted
- **Context:** Need functional notification path without vendor credentials.
- **Decision:** `EmailMessage` outbox is persisted. Nodemailer sends when `SMTP_URL` exists and marks messages. Development mode exposes a tokenized preview only to the signed-in account. `npm run jobs` processes reminders and daily digests; idempotent by reminder/message keys. In-app notifications always stored. Quiet hours suppress email/digest only.
- **Alternatives rejected:** Blocking email in request path (latency/failure); mandatory vendor (secret).
- **Rollback:** Disable email channels, keep in-app.

## ADR-013 — Theming and design language

- **Status:** accepted
- **Context:** Calm, enterprise-credible, accessible, minimal; max 7 primary controls.
- **Decision:** Warm neutral canvas, white surfaces, deep green accent, one typographic family, 8px grid, 12px card radius, subtle borders more than shadows. Theme stored in settings + localStorage; system preference default; reduced-motion respected; class-based dark mode. Mobile bottom nav. Tokens documented in `docs/DESIGN_SYSTEM.md`.
- **Alternatives rejected:** shadcn component set (default look, client JS); multiple typefaces (noise).
- **Rollback:** Tokens are CSS custom properties; visual changes don't affect behavior.

## ADR-014 — Sharing model

- **Status:** accepted
- **Context:** Read-only board sharing is a should-deliver; security is paramount.
- **Decision:** Unpredictable 32-byte token stored; `/share/[token]` renders read-only server page with no sensitive IDs beyond displayed content. Revocation rotates and disables. No mutation endpoints accept share tokens.
- **Alternatives rejected:** Public board IDs (guessable); full public API token (overbroad).
- **Rollback:** Revoke tokens; add password/expiry backlog.

## ADR-015 — Timezone and recurrence

- **Status:** accepted
- **Context:** UTC storage, DST-safe reminders.
- **Decision:** Store UTC instants; all date-only fields stored as `yyyy-MM-dd` strings plus user timezone for display/planning. RRULE subset (`DAILY`, `WEEKLY`, `MONTHLY` with interval, weekdays) calculated using local calendar parts and serialized at user timezone; server computes next due. Reminder job uses absolute UTC reminders generated at task save/complete.
- **Alternatives rejected:** Storing local times (ambiguous DST); full rrule dependency (subset needed).
- **Rollback:** Disable recurrence for affected tasks; keep existing dates.

## ADR-016 — Idempotency

- **Status:** accepted
- **Context:** Offline replay and retries can duplicate tasks.
- **Decision:** Optional `Idempotency-Key` header; DB `IdempotencyKey` stores actor+key+method+path+status+body for 24h. Replay returns stored response with `Idempotent-Replayed: true`. All client mutations generate keys.
- **Alternatives rejected:** No keys (duplicate offline creates); mandatory keys (external API friction).
- **Rollback:** Clients retry manually; keys ignored after TTL.

## ADR-017 — Test boundaries

- **Status:** accepted
- **Context:** Avoid duplicate coverage while proving core behavior.
- **Decision:** Unit tests for pure logic/security primitives (fractional ordering, NLQ, recurrence, TOTP, encryption, RBAC, today ranking). Playwright for user journeys, tenant isolation, keyboard move, undo, offline queue simulation, axe smoke. API integration behavior exercised through E2E via browser fetch and direct request where faster. Performance via Lighthouse and explicit JS bundle budget. No coverage theater.
- **Alternatives rejected:** Only E2E (slow, poor diagnosis); only unit (doesn't prove flows).
- **Rollback:** n/a.

## ADR-018 — Feature flags and kill switches

- **Status:** accepted
- **Context:** AI and risky paths need flags.
- **Decision:** Workspace flags (`aiEnabled`, `automationsEnabled`, `attachmentsEnabled`, `publicSharingEnabled`) plus env kill switches (`AI_KILL_SWITCH`, `DISABLE_ATTACHMENTS`). Flags checked server-side on mutations and reflected in UI. Default: AI on for demo workspace, attachments on local, public sharing on, automations on.
- **Alternatives rejected:** Client-only toggles (security theater).
- **Rollback:** Set env flag off; server rejects with feature-disabled error.

## ADR-019 — Audit scope and PII

- **Status:** accepted
- **Context:** Audit required, privacy required.
- **Decision:** Audit stores actor, action, entity IDs, requestId, IP hash (not raw), metadata restricted to changed field names/values for non-sensitive content. No passwords, tokens, or attachment contents. Audit readable only in team/org admin UI. Account deletion pseudonymizes actor references; audit rows may remain for legal retention without direct user identifiers.
- **Alternatives rejected:** Logging raw payloads (PII leakage); no IPs (weak investigations).
- **Rollback:** Retention job can purge audit beyond policy.

## ADR-020 — Attachments implementation

- **Status:** accepted; production limitation
- **Context:** Brief requires attachments, with scanning; no virus scanner available.
- **Decision:** Store on local filesystem with random name under `data/uploads`, metadata in DB. Allow PDF, plain text, Markdown, CSV, PNG, JPEG, WebP; 10MB max; scan file signatures; force download with safe headers; auth + workspace check. Document malware-scan limitation and production flag. No inline HTML/SVG.
- **Alternatives rejected:** Base64 in DB (bloat, backup pain); public object URLs (IDOR); fake scanner (dishonest).
- **Rollback:** Disable uploads via env; metadata can remain with “file unavailable” UI.

## ADR-021 — Workspace deletion and data export

- **Status:** accepted
- **Context:** GDPR/CCPA data rights.
- **Decision:** Export zip-free JSON bundle (profile, settings, personal workspace boards/tasks/comments/activity, org memberships without others’ content), plus CSV tasks. Account delete requires typed confirmation and password if present; immediately removes PII/session/memberships and soft-deletes owned workspaces; retention purge job hard-deletes after configured window. Audit actor pseudonymized.
- **Alternatives rejected:** Async-only export (complex); immediate hard delete (no recovery); no export on guest (violates data ownership).
- **Rollback:** Retention window and backups per ops doc.

## ADR-022 — Deployment footprint

- **Status:** accepted
- **Context:** Single-run Docker unavailable.
- **Decision:** Node standalone Next server plus SQLite volume, or PostgreSQL managed service. Health/readiness, graceful shutdown. Dockerfile multi-stage and Compose for local Postgres optional; `docker-compose.yml` provides app + volume + SMTP placeholder. Docs include rollback and backup/restore. Job process separate command.
- **Alternatives rejected:** Serverless-only (cron/filesystem issues, Prisma + SQLite unusable); Kubernetes (overkill).
- **Rollback:** `git revert` + DB restore from last verified backup; migrations forward-only.
