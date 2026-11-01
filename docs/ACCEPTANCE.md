# Acceptance report

Project: **Project3383 — Drift**
Reference: `ProjectA2` (read-only)
Date: 2026-11-01

## Build and automated tests

| Check | Result |
|---|---|
| `./mvnw test` | 26 tests, 0 failures, 0 errors |
| `./mvnw -DskipTests package` | Passed; executable jar produced |
| `node --check app.js`, `auth.js`, `i18n.js`, `offline.js` | Passed |
| Flyway migrations | V1–V8 validated and applied |
| Git | Clean working tree at the acceptance commit |

The API smoke suite covers guest sessions, account claim/sign-in, roles and invites, board and task CRUD, drag/move/conflict handling, Today selection and rebalancing, recurrence, comments/checklist/dependencies/attachments, reminders, calendar/upcoming/search/archive/insights, command palette/bulk actions/undo, API tokens/audit, webhooks (signature and delivery retry path), automations (preview, run, undo, enable/disable), import/export, account/workspace deletion, TOTP MFA, workspace policy enforcement, OIDC SSO with a local fake provider, magic links (new account, replay rejection, MFA handoff), and security headers/origin rejection.

## Browser acceptance

Playwright browser runs verified:

- Guest workspace creation, quick capture, board card creation, task drawer edit/complete/reopen.
- Today selection, capacity card, auto-plan controls, Day Flow, Focus entry point.
- Board grid/list toggle, search/priority/assignee filters, task counts, card metadata.
- Calendar month navigation, dated task rows, draw-from-grid selection.
- Upcoming 7/14/30-day ranges, dated groups, priority/label/time rows, open drawer without losing the view.
- Archive split into archived and completed, reopen, restore.
- Search empty-query recents, tokenized query, status/priority/board filters, result drawer over Search.
- Insights timeline ranges, workload view, unscheduled list.
- Settings navigation groups/search, account, appearance, language, planning, auto-plan, focus, sound, notifications, keyboard, features, security/MFA, workspace, people, policies, automations, integrations, audit, data/export, danger zone.
- Auth page: password sign-in, sign-up, guest claim, magic-link request/sent state, dev link, magic-link sign-in, MFA challenge handoff, and magic-link replay rejection.
- Mobile: Today, Upcoming, Search, single-row topbar, bottom navigation, hidden desktop sidebar.
- Service worker/PWA registration and offline queue render path remain present.
- No browser console errors were observed across the main views and auth flows.

Screenshots are in [`docs/screenshots`](screenshots/):

| View | File |
|---|---|
| Today | `today.png` |
| Board | `board.png` |
| Task drawer | `task-drawer.png` |
| Calendar | `calendar.png` |
| Insights | `insights.png` |
| Command palette | `command-palette.png` |
| Settings | `settings.png` |
| Upcoming | `upcoming.png` |
| Archive | `archive.png` |
| Search | `search.png`, `search-filtered.png` |
| Auth | `auth-signin.png`, `auth-claim.png`, `auth-mfa.png` |
| Mobile | `mobile-today.png`, `mobile-upcoming.png`, `mobile-search.png` |

## Accessibility

- axe-core (WCAG 2 A/AA + 2.1 A/AA) reported **0 violations** on Today, Board, Calendar, Upcoming, Archive, Search, Insights, Settings, Auth, the task drawer, command palette, integrations settings, and dark-theme Today/Settings.
- Lighthouse accessibility: **100**.
- Skip-safe semantic landmarks, labeled controls, visible focus styles, keyboard-operable command palette and dialogs, status announcements, and reduced-motion handling are present in the shared shell.
- Contrast tokens (`--faint`) were darkened to meet 4.5:1 in light and dark themes.

## Performance

Lighthouse mobile profile (simulated slow 4G, 4× CPU):

| Metric | Value | Score |
|---|---|---|
| Performance | 88 | — |
| Accessibility | 100 | — |
| Best practices | 100 | — |
| SEO | 100 | — |
| First Contentful Paint | 1.5 s | 96 |
| Largest Contentful Paint | 3.8 s | 55 |
| Total Blocking Time | 80 ms | 99 |
| Cumulative Layout Shift | 0.016 | 100 |
| Speed Index | 1.5 s | 100 |

Initial bootstrap requests (guest, settings, Today, notifications, board) are issued in parallel, and service-worker precache is deferred until after load. The remaining LCP cost is the first-session workspace creation plus bootstrap payload on a cold Lighthouse run; the shell should be deployed behind HTTP static caching in production.

## Security checks

- Security headers verified: CSP, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, no-store on API responses.
- Session cookie is `HttpOnly`, `SameSite=Lax`, renamed to `DRIFTSESSION`.
- Unauthenticated `/api/bootstrap` returns 401.
- Cross-origin unsafe writes return 403 `CSRF_REJECTED` (origin/fetch-site guard).
- Passwords use BCrypt; API tokens are shown once and stored as SHA-256 hashes; webhook secrets are shown once and delivery payloads are HMAC-signed.
- Magic links use hashed one-time tokens, 15-minute expiry, session-bound state, atomic consumption, and an MFA handoff.
- MFA secrets are AES-GCM encrypted with a local key; backup codes are one-time hashes; workspace `require_mfa` is enforced on access paths.
- Webhook and OIDC outbound URLs reject private/non-HTTPS targets unless local-development private access is explicitly enabled.
- Account/workspace deletion anonymizes credentials, revokes sessions/tokens, hides workspaces from bootstrap, and clears local offline caches.

## Known limitations (documented, not silent)

These are environment-dependent or intentionally deferred items recorded in [`PARITY.md`](PARITY.md):

1. OAuth provider sign-in (GitHub/Google/Apple) is not implemented; the default local reference configuration also hides these providers. Organization SSO via OIDC is implemented and covered by a fake-provider test.
2. Magic-link and invite email delivery queue messages and return a development link; no SMTP transport is configured in local development. Live external SSO/SMTP verification therefore remains a deployment check.
3. A dedicated label manager and reminder editing UI are not present; task drawer label assignment and reminder creation exist.
4. Auto-plan uses settings-aware preview/apply/refresh/undo and safe/delegated cleanup; an exact recomputation of every reference planning heuristic is approximated.
5. Production deployment hardening (HTTPS termination, `Secure` cookies, proxy forwarded headers, scheduled retention workers) is not part of the local run profile.

## Runbook

```powershell
$env:JAVA_HOME='C:\Program Files\Eclipse Adoptium\jdk-17.0.17.10-hotspot'
$env:Path="$env:JAVA_HOME\bin;$env:Path"
.\mvnw.cmd test
.\mvnw.cmd -DskipTests package
java -jar target\project3383-0.0.1-SNAPSHOT.jar
```

Open <http://localhost:3383>. The health endpoint is <http://localhost:3383/api/health>.
