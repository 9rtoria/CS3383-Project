# Security

**Scope:** Drift web application, API, data, and deployment artifacts  
**Last reviewed:** 2026-10-23  
**Status:** v1 delivery; production hardening items are listed explicitly

## 1. Security posture in one page

Drift uses a first-party, cookie-based session model with server-side authorization on every object. Tenant isolation is enforced in queries, not just UI. Mutations are same-origin checked, rate-limited, validated with Zod, optionally idempotent, and audited. Secrets are encrypted at the application layer. The main residual risks are operational: SQLite single-node scale, local attachment storage without malware scanning, in-memory rate limits, CSP `unsafe-inline`, and external identity flows that cannot be exercised without provider credentials.

## 2. Authentication

| Control | Implementation |
|---|---|
| Guest identity | Real `User(isGuest)` + personal workspace; opaque token in httpOnly cookie; no email required |
| Password storage | Node `scrypt`, N=16384, r=8, p=1, 16-byte salt, per-user parameters stored with hash |
| Session token | 32 random bytes, base64url; only SHA-256 hash stored in DB |
| Cookie | `httpOnly`, `SameSite=Lax`, `path=/`, `Secure` in production, 30-day absolute expiry |
| Rotation | New session on password/magic-link/OAuth sign-in; guest claim keeps user but rotates token |
| Revocation | Sign-out revokes current session; “sign out everywhere” revokes all; session list exposes device/time |
| Magic link | Single-use token hash, short expiry, rate-limited request/verify, `next` restricted to same-site paths |
| MFA | TOTP RFC 6238 (SHA-1, 6 digits, 30 s, ±1 window), encrypted secret, hashed backup codes, challenge token |
| OAuth | Authorization code + state + PKCE; provider allowlist; verified-email linking; no implicit flow |
| OIDC SSO | Issuer discovery, state/nonce, PKCE, signed ID token validation via `jose`, encrypted client secret, org-only config |
| MFA policy | Org can require MFA; login challenge blocks session issuance until verified |
| Production secrets | `AUTH_SECRET` and `APP_ENCRYPTION_KEY` required; no runtime generation in production |

**Limitations:** live OAuth/SSO round-trips are unverified in this environment. Password reset is via magic link; there is no separate reset-token flow. Account recovery for a lost MFA device relies on backup codes.

## 3. Authorization and tenancy

- Workspace is the tenant boundary; every domain row carries `workspaceId`.
- `requireWorkspace(viewer, workspaceId, minRole, action)` resolves membership and role server-side.
- Reads use membership-scoped `findFirst`; a wrong tenant returns **404** to avoid existence disclosure.
- Role matrix: OWNER > ADMIN > MEMBER > GUEST. Content writes require MEMBER+; membership/policy/audit require ADMIN+; ownership transfer/delete requires OWNER.
- UI hiding is cosmetic; every route repeats the check.
- Public share tokens are read-only and cannot be used on mutation endpoints.
- API tokens are bound to one user and workspace with an expiry; they inherit the owner’s role and currently have **no per-token scopes**. Bearer requests bypass cookie CSRF but still pass authz.
- Invites store only a token hash, bind to an email, expire in 7 days, and are single-use.

## 4. Request security

`handleApi` applies, in order:

1. Request ID and structured log context.
2. Fixed-window rate limit (auth 20/min/IP/path; default 180/min; magic request 6; upload/client-error buckets).
3. Session/bearer resolution.
4. Authentication requirement unless `public`.
5. Same-origin check for cookie mutations (`Origin` must match request origin or `APP_URL`).
6. JSON content-type and 2 MB body cap (uploads use multipart with a 10 MB file cap).
7. Zod validation and domain authorization.
8. Idempotency replay for matching actor/key/method/path.
9. Uniform error envelope; no stack traces or SQL in responses.
10. Audit/activity writes for sensitive mutations.

**Rate-limit limitation:** the store is in-memory and per process. A multi-instance deployment must replace it with Redis or a gateway limiter.

## 5. Browser hardening

`next.config.ts` sets on every response:

- `Content-Security-Policy`: `default-src 'self'`; scripts/styles self + `'unsafe-inline'`; images self/data/blob; connect self; object none; base self; form-action self; frame-ancestors none; worker self.
- `Strict-Transport-Security` in production (2 years, includeSubDomains, preload).
- `X-Content-Type-Options: nosniff`.
- `X-Frame-Options: DENY`.
- `Referrer-Policy: strict-origin-when-cross-origin`.
- `Permissions-Policy` denies camera, microphone, geolocation, payment, USB.
- `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`.
- `poweredByHeader: false`.

**CSP limitation:** Next.js inline bootstrap requires `'unsafe-inline'` for scripts/styles in this build. There are no third-party script origins. Nonce/hash hardening is a production follow-up (see `RISKS.md` R-006).

## 6. Data protection

| Data | At rest | In transit | Notes |
|---|---|---|---|
| Passwords | scrypt hash | TLS at proxy | Never logged |
| Session/invite/magic/API tokens | SHA-256 hash | TLS; httpOnly cookie | Raw token shown once |
| TOTP seeds, OIDC secrets | AES-256-GCM | TLS | Key from env; rotation requires re-encryption |
| Tasks/comments | DB storage | TLS | Host disk encryption recommended |
| Attachments | Local volume | TLS | Random names; auth-checked download |
| Audit | DB | TLS | Actor pseudonymized on account deletion; IP hashed |
| Backups | Operator-controlled | Operator-controlled | Must be encrypted; restore tested by operator |

No outbound AI calls exist. The only outbound traffic is SMTP and configured webhooks, both operator-controlled.

## 7. Attachments

- Max 10 MB; allowlist includes PNG/JPEG/GIF/WebP/SVG, PDF, text/CSV/Markdown/JSON, ZIP, and Office Open XML documents.
- Storage name is random; original name is metadata only.
- Download requires authentication and workspace membership; response uses `Content-Disposition: attachment` and `nosniff`.
- SVG is served as a download, not inline, to avoid script execution in the app origin.
- **No malware scanner is integrated.** Do not accept untrusted uploads in production until a scanner/AV service is wired. `DISABLE_ATTACHMENTS=true` is the kill switch.
- MIME is client-supplied plus a signature sniff for common types; this is not a substitute for content disarm/AV.

## 8. Audit and logging

- Audit rows include actor, action, entity type/ID, request ID, timestamp, and bounded metadata.
- IP addresses are hashed with a server secret; raw IPs are not stored in audit.
- No passwords, session tokens, API tokens, TOTP secrets, or attachment bytes are logged.
- Structured request logs include method, path, status, duration, user ID, request ID; query strings are not logged with sensitive values.
- Client errors are bounded and do not include task content or credentials.
- Audit is append-only through the application path; DB-level immutability/WORM is an operational hardening item.

## 9. Data rights and retention

- Export: JSON bundle and CSV tasks, scoped to the viewer.
- Delete: typed `DELETE` confirmation; revokes sessions, soft-deletes personal workspaces, removes credentials, and retains shared-workspace content with a pseudonymized actor. Shared-workspace owners must transfer ownership first.
- Retention: org admins can set 7–3650 days; jobs purge expired trash/audit/idempotency/undo/session rows.
- Backups: operator must define retention and secure deletion consistent with policy.
- Org-owned content is not deleted by a member’s account deletion; ownership transfer is an admin action.

## 10. Dependency and supply chain

- Lockfile committed; direct dependencies pinned.
- `npm audit --omit=dev --audit-level=high` is part of the release checklist; the final run reported 0 vulnerabilities.
- A full `npm audit` reports 5 high advisories in the dev-only `eslint-config-next → @next/eslint-plugin-next → fast-glob → braces` chain. There is no patched `braces` release; the suggested fix downgrades `eslint-config-next` to 14 and is not acceptable. Production dependencies are unaffected; track the upstream advisory.
- No postinstall scripts beyond Prisma/better-sqlite3 native build requirements.
- CI should run `npm ci`, not `npm install`, and fail on high/critical production advisories.
- Docker base image should be pinned by digest in a regulated environment.

## 11. Threat summary

See [THREAT_MODEL.md](THREAT_MODEL.md) for STRIDE analysis. Highest residual risks:

1. **Attachment malware** — no scanner; disable for untrusted users.
2. **Rate limiting at scale** — in-memory; use a shared store.
3. **CSP inline allowance** — nonce hardening.
4. **SQLite availability/scale** — single writer; move to PostgreSQL.
5. **External IdP correctness** — flows implemented but not live-verified.
6. **Manual accessibility/AT** — not a security risk but a compliance gap.

## 12. Incident response (minimum)

1. **Detect:** alert on 5xx rate, auth failures, audit anomalies, webhook failures, disk usage.
2. **Contain:** rotate `AUTH_SECRET`/`APP_ENCRYPTION_KEY` only with a re-encryption plan; revoke sessions; disable attachments/AI/webhooks via env; take the app out of rotation.
3. **Eradicate:** patch dependency or code; rebuild image; redeploy.
4. **Recover:** restore DB/volume from verified backup; run migrations; verify health and smoke tests.
5. **Notify:** follow contractual/legal timelines; preserve audit/log evidence.
6. **Learn:** blameless review; add regression test and ADR.

## 13. Disclosure

Security reports should go to the delivery owner through the procurement channel. Do not open public issues containing exploit details. A production deployment should publish a security contact and PGP key.

## 14. Production go-live checklist

- [ ] Replace SQLite with PostgreSQL and run migrations.
- [ ] Set strong `AUTH_SECRET` and `APP_ENCRYPTION_KEY` from a secret manager.
- [ ] Put TLS termination and HSTS in front of the app.
- [ ] Replace in-memory rate limiting with a shared store.
- [ ] Wire SMTP and verify magic link/invite/digest delivery.
- [ ] Configure OAuth/SSO credentials and run a real round-trip.
- [ ] Enable malware scanning or disable attachments.
- [ ] Move attachments to object storage with private ACLs.
- [ ] Configure backups, restore drill, and retention job schedule.
- [ ] Replace CSP `unsafe-inline` with nonces/hashes.
- [ ] Run manual NVDA/VoiceOver review.
- [ ] Load test at the target concurrency.
- [ ] Configure log/metrics retention and alerting.
