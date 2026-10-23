# Procurement and security questionnaire

**Product:** Drift v1.0.0  
**Prepared:** 2026-10-23  
**Status:** delivery artifact for the Project A brief; not a commercial offer

This document answers the questions a buyer, security reviewer, or VP of Engineering is likely to ask. It separates **what is implemented and verified** from **what is required before production procurement**. Do not treat proposed commercial terms as a quote.

## 1. Product summary

Drift is a calm, keyboard-first task planner and Kanban board. A solo user can capture a task without an account. Teams can share boards, invite members, assign roles, audit changes, automate rules, and connect SSO. Enterprise chrome is progressive: personal workspaces do not show audit, SSO, or admin surfaces.

## 2. Deployment and data

| Question | Answer |
|---|---|
| Deployment model | Single-tenant self-hosted Node.js app; SaaS multi-tenant is possible with PostgreSQL and object storage |
| Default database | SQLite (demo/small team) |
| Production database | PostgreSQL 16+ (documented rollout, not shipped) |
| File storage | Local `data/attachments` volume; S3-compatible storage is a production requirement |
| Data residency | Wherever the operator deploys; no vendor cloud dependency |
| Subprocessors | None for core app. Optional SMTP relay, OAuth providers, and OIDC IdP are operator-configured |
| AI subprocessors | **None.** Assist is local and deterministic |
| Backups | Operator responsibility; `BackupRun` metadata model exists, automated backup job does not ship |
| Encryption in transit | TLS terminated by the operator’s proxy; HSTS enabled in production |
| Encryption at rest | Database/files rely on the platform volume; app encrypts TOTP/OIDC/webhook secrets with AES-256-GCM |
| Data export | JSON/CSV per workspace; account export |
| Data deletion | Account deletion anonymizes the user and removes credentials; workspace deletion is soft-delete with retention; operator purges backups |

## 3. Identity and access

| Question | Answer |
|---|---|
| SSO | Workspace OIDC (discovery, authorization code + PKCE, nonce/state); routes implemented, live provider round-trip unverified without credentials |
| Social login | GitHub, Google, Apple OAuth routes; live round-trip unverified |
| MFA | TOTP + hashed backup codes; workspace policy can require MFA |
| Roles | OWNER, ADMIN, MEMBER, GUEST; server-side action matrix |
| Tenant isolation | Every object scoped by workspace membership; cross-workspace reads return 404 |
| Session management | Opaque hashed cookies, 30-day expiry, revocation, session list, sign-out everywhere |
| API access | Personal access tokens bound to user + workspace; **no per-token scopes** in v1 |
| SCIM | Not implemented |
| Directory sync | Not implemented; OIDC only |

## 4. Security controls

| Control | Status |
|---|---|
| Password hashing | scrypt with per-user salt |
| Token storage | SHA-256 hashes for sessions, invites, magic links, API tokens, backup codes |
| CSRF | SameSite=Lax + Origin allowlist on cookie mutations |
| Rate limiting | Fixed-window, per-process memory; auth 20/min, general 180/min |
| Input validation | Zod at API boundaries; 2 MB JSON cap |
| SQL injection | Prisma parameterized queries; FTS statements vetted |
| XSS | React escaping; CSP with `unsafe-inline` (documented hardening gap) |
| Clickjacking | `frame-ancestors 'none'`, `X-Frame-Options: DENY` |
| Security headers | CSP, HSTS (prod), nosniff, referrer policy, permissions policy, COOP/CORP |
| Audit log | Admin actions, actor, entity, request ID, hashed IP; retention configurable |
| Idempotency | 24-hour replay store for writes |
| Attachment controls | MIME allowlist, signature check, size cap, randomized name, auth-checked download |
| Malware scanning | **Not implemented** |
| Webhook signing | **Not implemented**; no SSRF allowlist |
| Penetration test | **Not performed** |
| Vulnerability management | `npm audit --omit=dev --audit-level=high` in CI; Dependabot not configured |
| Secret management | Environment variables; no vault integration |

## 5. Reliability and operations

| Question | Answer |
|---|---|
| Health endpoint | `GET /api/health` checks DB and reports latency |
| Metrics | `GET /api/metrics` process/tenant counters (admin) |
| Logs | JSON lines with request ID, method, path, status, duration, user ID; no bodies |
| Background jobs | Reminders, email retry, digests, webhook retry, retention, housekeeping; `JobRun` telemetry |
| Scheduler | External cron/container; no in-process cron |
| Backup/restore | Documented SQLite procedure; automated job not shipped |
| DR | No multi-region or automatic failover |
| Uptime SLA | None offered in this delivery artifact |
| Support | Not offered; this is a project deliverable |

## 6. Performance and scale

| Question | Answer |
|---|---|
| Measured Lighthouse | Today 94, Board 97, drawer 95 latest; accessibility 100 |
| LCP | 2.43–2.66 s (mobile lab; drawer over 2.5 s) |
| CLS | 0.000–0.070 across three runs |
| TBT | 106–225 ms (latest Today 225 ms, over 200 ms budget) |
| Load test | **Not performed**; no 10k-user claim |
| Horizontal scale | Requires PostgreSQL, shared rate limiter, object storage, sticky-free sessions |
| Search scale | SQLite FTS5 for demo; PostgreSQL `tsvector` for production |

## 7. Privacy and compliance

| Question | Answer |
|---|---|
| GDPR role | Operator is controller; Drift is software, not a data processor service |
| DPA | Not included; operator must execute its own |
| Data minimization | Guest mode requires no email; optional profile fields |
| Retention | Workspace-configurable task/audit retention; job enforces |
| Audit PII | IP addresses hashed; metadata kept non-sensitive |
| AI data use | No outbound AI; no training on customer data |
| Cookies | One HttpOnly session cookie; no analytics/ad cookies |
| Consent banner | Not needed for the core app; operator must assess its own analytics |
| Accessibility | WCAG 2.2 AA target; automated axe clean; manual AT review pending |
| VPAT | See [VPAT.md](VPAT.md) |

## 8. Accessibility procurement answers

- **Conformance target:** WCAG 2.2 Level AA.
- **Current evidence:** axe-core 0 serious/critical across 6 surfaces; keyboard-only core flows; Lighthouse accessibility 100; reduced-motion support; contrast tokens adjusted.
- **Not verified:** NVDA, VoiceOver, 400% zoom, Windows High Contrast, switch/voice control.
- **Known gaps:** no formal audit, no user testing with disabled participants, some icon-only controls rely on accessible names, no captioning (no media).
- **Remediation path:** manual AT audit, then fix and re-test; see [VPAT.md](VPAT.md) §5.

## 9. Commercial posture (proposal, not a quote)

| Item | Proposal |
|---|---|
| Licensing | Private delivery artifact; no redistribution license granted |
| Pricing | Not set; requires productization, support, and hosting cost model |
| Free tier | Guest capture and personal workspace |
| Team tier | Shared boards, roles, invites, audit, automations |
| Enterprise tier | SSO, retention policy, API tokens, webhooks, priority support |
| Support SLA | Not offered in v1 |
| Professional services | Migration/SSO onboarding would be scoped separately |
| Data processing addendum | Required before handling regulated data |

## 10. Buyer checklist before production

- [ ] Replace SQLite with PostgreSQL and run the migration/load tests.
- [ ] Move attachments to object storage with malware scanning.
- [ ] Add automated backups + restore drill.
- [ ] Add a shared rate-limit store and central log/metrics pipeline.
- [ ] Complete a third-party penetration test and remediate findings.
- [ ] Tighten CSP (remove `unsafe-inline`) with a nonce/hash strategy.
- [ ] Add webhook signing and an SSRF egress allowlist.
- [ ] Verify OAuth/SSO with real providers and document the callback setup.
- [ ] Complete manual screen-reader and zoom testing.
- [ ] Add SCIM/directory sync if required by the buyer.
- [ ] Execute a DPA and define data residency/retention.
- [ ] Define an SLA, support model, and incident-response contact.

## 11. Evidence index

| Claim | Evidence |
|---|---|
| Typecheck/lint/build | `typecheck-output.txt`, `lint-output.txt`, `build-output.txt` |
| Unit/E2E | `test-output.txt`, `e2e-output.txt` |
| Accessibility | `tests/e2e/a11y.spec.ts`, Lighthouse JSON |
| Performance | `docs/performance/summary.json` |
| Security posture | [SECURITY.md](SECURITY.md), [THREAT_MODEL.md](THREAT_MODEL.md) |
| Operations | [OPERATIONS.md](OPERATIONS.md) |
| Deployment | [DEPLOYMENT.md](DEPLOYMENT.md) |
| AI boundary | [AI_GOVERNANCE.md](AI_GOVERNANCE.md) |
| Accessibility report | [VPAT.md](VPAT.md) |

All claims are scoped to the delivery environment. Items marked “not implemented”, “not verified”, or “not performed” are genuine gaps, not roadmap promises.
