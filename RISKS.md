# RISKS

Scoring: probability × impact (1–5). Owner is the delivery engineer for this run. Status reviewed at M7 and carried into `REVIEW.md`.

| ID | Risk | P | I | Score | Mitigation | Rollback / contingency | Status |
|---|---|---:|---:|---:|---|---|---|
| R-001 | Scope is larger than a single-run build; some should-deliver features may be shallow. | 4 | 4 | 16 | Milestone traceability; core flows first; explicit cuts in REVIEW; no fake controls. | Remove a shallow capability from UI and record cut rather than ship a lie. | Mitigated — all FRs delivered; limitations listed |
| R-002 | SQLite deviates from PostgreSQL and may not meet 10k-user targets. | 3 | 4 | 12 | Prisma abstraction, tenant-scoped queries, pagination; PostgreSQL path documented. | Switch provider and run migrations on PostgreSQL with encrypted volume. | Open — demo/small team only |
| R-003 | OAuth/SSO cannot be end-to-end verified without external IdP credentials. | 5 | 3 | 15 | Standards-based flows, state/PKCE/nonce review; labelled unverified. | Configure test IdP with buyer; run acceptance script before production. | Open — routes exist, live round-trip unverified |
| R-004 | Email/reminder delivery depends on scheduler and SMTP. | 4 | 3 | 12 | Outbox + jobs CLI; due-reminder job verified with a real DB fixture; dev preview. | Use external cron/queue; docs. | Mitigated in code; scheduler/SMTP external |
| R-005 | Attachment malware scanning is not implemented. | 4 | 5 | 20 | MIME/size allowlist, auth checks, no inline SVG execution, `Content-Disposition: attachment`. | Disable attachments in production until scanner wired; feature flag. | Open |
| R-006 | CSP with `unsafe-inline` is weaker than target. | 5 | 3 | 15 | No third-party scripts, strict frame/object/base, short allowlists. | Add nonce-based CSP with Next middleware and re-run E2E. | Open |
| R-007 | In-memory rate limiting fails under multiple instances. | 4 | 3 | 12 | Document single-instance limitation; auth/search/upload buckets. | Use Redis/Upstash limiter before horizontal scale. | Open |
| R-008 | Lighthouse may not reach 95 in this environment. | 4 | 4 | 16 | Small bundle, server-first shell, no heavy UI libs, measure production. | Optimize or report exact misses; do not fake. | Mitigated — 94/97/95 latest; LCP 2.66 s and 225 ms Today TBT remain open |
| R-009 | Automated accessibility cannot replace manual NVDA/VoiceOver review. | 5 | 4 | 20 | Semantic controls, focus capture, announcements; axe matrix; single-key shortcut toggle. | Schedule assistive-tech review; VPAT marks items partial/not tested. | Open — manual AT pending |
| R-010 | DST recurrence bugs around boundaries. | 3 | 4 | 12 | Local date arithmetic with timezone, unit vectors; next occurrence server-authoritative. | Suspend recurrence per workspace if defect; fix forward. | Mitigated — unit tests pass |
| R-011 | Offline conflict merge may lose intent. | 3 | 4 | 12 | Version checks, 409, explicit conflict UI; no silent overwrite. | Disable offline edits through kill switch; preserve queue for retry. | Mitigated — E2E offline + 409 tests |
| R-012 | Audit is not tamper-evident (no hash chain). | 3 | 4 | 12 | Append-only application path, immutable DB permissions, configurable retention. | Add hash-chain/WORM export for regulated buyers. | Open |
| R-013 | Docker not available in the build environment. | 5 | 2 | 10 | Dockerfile/Compose/CI delivered; local npm production path verified. | Validate on target; adjust base image. | Open — image not built/run |
| R-014 | Data export/delete completeness risk across related tables. | 2 | 5 | 10 | Transactional delete service; export/import E2E; account-delete route. | Restore from backup; fix deletion job; disclose residual audit retention. | Partially mitigated — export/import tested; full deletion matrix not audited |
| R-015 | Third-party dependency vulnerabilities. | 3 | 4 | 12 | Lockfile, `npm audit --omit=dev`, pinned versions, minimal deps. | Patch/override; no critical release until fixed. | Mitigated — 0 high/critical at final audit |
| R-016 | Service worker stale cache after deploy. | 3 | 3 | 9 | Versioned cache, network-first navigation, activate cleanup. | Unregister via kill script; bump cache version. | Mitigated |
| R-017 | Time budget cannot honestly meet 78 estimated BUILD hours in this execution. | 4 | 3 | 12 | Track actual wall time; cut scope not verification; report actual. | State actuals; user can commission extension for unverified/cut items. | Closed — actual wall-clock table in REVIEW |
| R-018 | Search at 1,000+ tasks may be slower on SQLite. | 3 | 3 | 9 | FTS5 index, server pagination, LIKE fallback. | Move to PostgreSQL FTS/Elastic. | Open — not load-tested |
| R-019 | Magic links and invites could leak via dev outbox. | 2 | 4 | 8 | Preview guarded by `NODE_ENV !== production` or explicit `E2E=true`; tokens hashed, single use, expiry. | Disable dev preview in production; SMTP required. | Mitigated |
| R-020 | Secret generation on first boot might produce divergent secrets for multiple replicas. | 2 | 4 | 8 | Production requires env secrets; runtime generation only dev. | Rotate/auth reset; all sessions invalidated by design. | Mitigated |
| R-021 | Webhooks have no payload signature and no SSRF allowlist. | 4 | 4 | 16 | Persisted delivery records, bounded retries, encrypted secret field. | Restrict egress at network layer; add HMAC signing + URL allowlist. | Open |
| R-022 | Import commits valid rows while skipping invalid rows. | 3 | 3 | 9 | Row-level validation and error report; idempotency key support. | Add all-or-nothing staging import for regulated migrations. | Open — documented |
| R-023 | Automated E2E uses a shared SQLite DB and one worker. | 3 | 2 | 6 | Unique fixtures, serial execution, production server. | Move CI to PostgreSQL and parallelize. | Mitigated for delivery; scale gap remains |

## Ongoing risk protocol

- Any blocker over 2 hours gets a spike note in `DECISIONS.md` (question, options, recommendation).
- Any feature that cannot be verified is either labelled unverified or cut in `REVIEW.md`.
- Security or data-loss risk defaults to the conservative behavior, even if it makes a feature less convenient.
- Risk status is not “closed” merely because code exists; it closes when evidence exists or the limitation is accepted in writing.
