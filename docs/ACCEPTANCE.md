# Acceptance report

Project: **Project3383 — Drift**
Reference: `ProjectA2` (read-only)
Date: 2026-11-02

## Build and automated tests

| Check | Result |
|---|---|
| `./mvnw test` | 36 tests, 0 failures, 0 errors |
| `./mvnw -DskipTests package` | Passed; executable jar produced |
| `node --check app.js`, `auth.js`, `i18n.js`, `offline.js` | Passed |
| Flyway migrations | V1 to V13 validated and applied, including MFA pending secret, email attempts, task completed_at, and guest starter defaults |
| Static audit | 426 HTML ids / 329 JS id references, 0 missing; 72 SVG symbols, 0 missing |
| i18n audit | 771 keys, 0 missing |
| Cross-app parity audit | `node scripts/parity-audit.cjs`: 0 failures, 0 warnings |
| Git | Clean working tree at the acceptance commit |

The API smoke suite covers guest sessions, persistent/revocable sessions, account claim/sign-in and guest-workspace merge, roles and invite preview/acceptance, board templates/columns/WIP/archived boards, task CRUD and field-presence-safe PATCH, create-time reminders, drag/move/conflict handling, checklist deletion, Today selection and rebalancing, recurrence, comments/dependencies/attachments, notification preferences/read state, calendar/upcoming/search/archive/rich insights, labels/views/metrics/OpenAPI/client errors, idempotent replay and key conflicts, command palette/bulk actions/undo, API tokens/audit, webhooks (signature and delivery retry path), automations (preview, run, undo, enable/disable), import/export, account/workspace deletion, TOTP MFA, workspace policy enforcement, OIDC SSO with a local fake provider, magic links (new account, replay rejection, MFA handoff), security headers/origin rejection, OAuth exchange contracts for GitHub, Google, and JWKS-verified Apple profiles including a tampered-signature rejection, and real SMTP socket delivery of a queued digest message.

## Third full-program audit (2026-11-02)

A third pass audited the whole application rather than only the two most recently touched
views. It covered every main page, Settings, auth/invite/share pages, the task drawer, quick
capture, command palette, notifications, account and board menus, desktop/tablet/mobile
layouts, dark theme, Chinese locale, all API controllers, services, and schema migrations.

Verified fixes in this pass:

- Magic-link development URLs are disabled by the production profile and request throttling
  returns 429 after five attempts while leaving other addresses unaffected.
- API tokens are rejected on another workspace's `X-Workspace-Id` / `workspaceId` (403), and
  bootstrap only lists the token's scoped workspace.
- Task completion records `completed_at`, creates the next recurring occurrence from the
  post-update values, and copies unsent reminders to the shifted due time.
- Search cursor pagination returns non-overlapping pages. A 35-result smoke returned 30 then
  35 rows with Load more disappearing at the end.
- Invalid due dates return 400 instead of producing a 500 from Insights or Auto-plan.
- Archive is newest-first; ICS feeds use valid UTC stamps and real due times.
- MFA setup stages a pending secret instead of disabling an existing factor; SSO requires an
  explicit verified email claim and rotates the session ID on callback.
- Private-board assignment and attachment access apply board visibility.
- Webhook secrets are encrypted at rest; failed email delivery stops after five attempts.
- Imported JSON assignee objects resolve by email/name; imported completed tasks retain a
  completion timestamp.
- `GET /api/boards?workspaceId=...` matches the published OpenAPI contract.

The repeatable cross-application audit is `scripts/parity-audit.cjs`. It logs into both apps,
compares card/list geometry and computed styles by task title, checks completed/reopened drag
transitions, add-column geometry, completed colors in light and dark themes, every main view,
the drawer/palette/capture/settings states, static IDs/SVG/i18n, and 390/768/1024/1440 widths.
Run it with `NODE_PATH` pointing at the reference app's `node_modules`:

```powershell
$env:NODE_PATH="C:\path\to\ProjectA2\node_modules"
node scripts/parity-audit.cjs
```

The final run reported 0 failures and 0 warnings. It specifically caught the completed-title
token mismatch (`--text-soft` instead of `--muted`), the missing removal of the extra
metadata opacity, list-row 11px/12px typography, and the Add a task/Add column styling drift;
all were fixed before the passing run. It now also checks every Quick Capture entry point for
a default board and first column, verifies the capture field has a visible border/background,
and opens Auto-plan to assert the 980px reference layout, three option cards, detail pane,
weekly/warning side stack, footer note, local dates, and no raw ISO dates. The latest run
reports 426 HTML ids / 329 JS id references and 771 zh-TW keys, all resolved.

A dedicated Chinese-mode pass now scans every main view, Settings, Auto-plan, and the task
drawer for known untranslated UI phrases. It verifies the Settings descriptions, dynamic
capacity/time examples, audit actions, webhook event labels, Today's "now" marker, Upcoming's
"7 days" label, and backend Auto-plan reasons/warnings. Escape-to-close is asserted for
Auto-plan, board creation, board settings, and column dialogs.

The account/workspace navigation pass additionally verifies that the workspace menu's Create
a team workspace action keeps its plus icon, opens `/settings#workspace`, and lands with the
create form in view. It checks the guest Sign in path opens the auth form, that Settings >
Account exposes Sign out, and that signing out returns to `/auth` after clearing cached
bootstrap, board, Today, and settings data.

A one-page layout pass now asserts that Upcoming, Archive, Board, and Calendar need no vertical
page scroll at 1440×1000, 1440×900, 1366×768, and 1024×900. The board column overhang was
removed and calendar day rows scale between 72px and 108px with the reference 28px bottom
padding. Today, Search, Insights, Settings, and other content-heavy views are intentionally
left scrollable rather than being compressed.

Browser checks in this pass: all seven main views plus Settings, the drawer, command palette,
and quick capture rendered with zero horizontal overflow, zero unnamed visible controls, no
undefined/NaN/placeholder text, and no console errors. Board title-only cards measured 42px
(the reference's 11px padding plus 12.5px/1.42 title line), metadata cards expanded only when
content existed, and the dashed Add column label aligned to the top-left. A fresh guest showed
"You / Personal / My tasks", the reference board description, and Personal/Work labels. The
black circular control in the reference remains the Next.js dev-tools indicator
(`#devtools-indicator` inside `nextjs-portal`), not Drift UI, so it is intentionally absent. Search Reset/pagination, board drag and
keyboard move, bulk move, duplicate/archive/restore board, URL refresh, comments, dependencies,
attachment actions, dark drawer, and Chinese locale were exercised. Static ID/SVG audits report
zero missing references; the translation audit reports 771 keys with zero missing.

Honest residuals are recorded in `PARITY.md`: live OAuth/SMTP/OIDC credentials are still
required for final provider checks, the legacy single `focus_date` field remains for old API
clients while per-user planning uses `today_selection`, offset cursors can shift under
concurrent edits, webhook secret rotation requires re-entering secrets, and browser speech/
notifications/sound remain browser-dependent.

## Browser acceptance

Playwright browser runs verified:

- Guest workspace creation, quick capture, board card creation, task drawer edit/complete/reopen.
- Today selection, capacity card, auto-plan controls, Day Flow, Focus entry point.
- Board grid/list toggle, search/priority/assignee filters, task counts, card metadata.
- Board templates (`blank`, `personal-week`, `project-sprint`, `content-calendar`), column create/edit/delete, WIP badges, enforced WIP create/move errors, and archived-board restore from Archive.
- Task drawer status/column move, due date + time, all-day toggle, reminder offset, checklist suggestions and deletion, complete/reopen toggle, copy-link fallback, archive, and activity.
- Calendar day selection panel with plan/due rows, configurable Monday/Sunday/Saturday week start, and `?view=calendar` deep link.
- `/settings` and `/settings#notifications` deep links, `/invite/{token}` preview/sign-in handoff, `/offline` fallback page, and `?board=` / `?task=` deep links.
- Real persisted sessions with cross-device revoke, idempotent replay header, duplicate-write suppression, and method/path conflict rejection.
- Calendar month navigation, dated task rows, draw-from-grid selection.
- Upcoming 7/14/30-day ranges, dated groups, priority/label/time rows, open drawer without losing the view.
- Archive split into archived and completed, reopen, restore.
- Search empty-query recents, tokenized query, status/priority/board filters, result drawer over Search.
- Insights timeline ranges, workload view, unscheduled list.
- Settings navigation groups/search, workspace/user hover states, account, appearance, language, planning, auto-plan, focus, sound, notifications, keyboard, features, security/MFA, workspace, people, policies, automations, integrations, audit, data/export, danger zone, About, and mobile section picker/header.
- Settings scrollspy: every section reaches the desktop sidebar and mobile picker at the correct reading position, including the short Keyboard, Automations, Audit, and Data sections. Click-to-jump still aligns each section, the URL hash follows the active section, search clears the marker, and re-rendering preserves the current scroll position.
- Restored rewrite-only capabilities: API-token created/expires/last-used metadata and copy, webhook event selection, one-time signing secret with copy, pause/resume, delivery metadata and URL copy; SSO configured badge, enable/require toggles, persistence after reload and removal; invite-link copy, member joined dates, shortcut-sheet entry point, and automation board scope.
- Workspace settings gating: guest/personal Owner/Admin workspaces show Workspace, Automations, Integrations, and Audit log; the team Owner/Admin workspace keeps the full six-item group. The added sections render, scrollspy includes them, and the mobile picker matches on both desktop and 390 px layouts.
- Settings workspace avatar: uses the soft `workspace-avatar` treatment, matching the main sidebar and the reference light-mint avatar instead of the dark brand mark. Computed colors and dimensions were checked in light and dark themes; account and member avatars remain unchanged.
- Favicon/PWA icon: `/icon.svg?v=2` and `/icon-maskable.svg` now serve the reference Drift swirl mark instead of the new “D” glyph. The service-worker cache advanced to `project3383-v6`; the icon was fetched and rendered in-browser with no console errors.
- Notifications anchored dropdown (unread styling, relative timestamps, Mark read, settings link), account menu with icons/theme/sign-out, and Escape/outside-click closing.
- Keyboard shortcut sheet card layout, scroll clipping, row labels, single-key toggle, and close button.
- Board list view with relative due labels, compact priority tones, and mobile toolbar grouping.
- Auth page: password sign-in, sign-up, guest claim, magic-link request/sent state, dev link, magic-link sign-in, MFA challenge handoff, and magic-link replay rejection.
- Mobile: Today, Board, Settings, Upcoming, Search, single-row topbar, bottom navigation, hidden desktop sidebar, and settings section picker.
- Service worker/PWA registration and offline queue render path remain present.
- No browser console errors were observed across the main views and auth flows.
- Final scrollspy/feature pass: all Settings sections synced on desktop and at 390 px mobile width, desktop views reported zero horizontal overflow (mobile Upcoming keeps the reference's own horizontal scroll), and the token, webhook, SSO, invite-link, joined-date, shortcut-sheet, and workspace-gating flows completed with zero console errors.
- Second parity pass: New task opens Quick Capture on Board, Upcoming, Calendar, and both Insights tabs; Today shows eight initial suggestions and toggles Show less; Upcoming rows use neutral/today dots and hide the footer when empty; Calendar says “Undated” and exposes Retry on failure; Search restored result badges, checklist counts, full empty/error states, footer scope, Open a board, and recent ordering; Archive and Board expose the reference empty/error cards; the sidebar board highlight is limited to Board view; Quick Capture keeps its microphone icon and disables Add until text is entered; the task drawer loads Status from the task’s own board, shows the checklist count, and uses X remove controls.
- Responsive checks: 390 px Today, Board, Calendar, Search, Archive, Insights, and Settings have zero horizontal overflow; Upcoming matches the reference’s horizontal scroll behavior rather than hiding it silently.
- Reference-only chrome: the black “N” circle in the reference screenshots was identified as the Next.js development indicator, not Drift UI. It is absent from both source trees and is intentionally not recreated in the Spring Boot build.
- Live-update pass: changing a display name updated the topbar, Settings header/footer, People member row, board assignee data, task-drawer assignee options, and board filter without a reload. Changing a workspace name updated the Settings header, topbar, sidebar, People description, and board eyebrow. A task title edited in the drawer updated Search results in place; comment and checklist actions showed their success toasts; a simulated external task edit appeared after the tab-visibility refresh. No console errors were observed.

Screenshots are in [`docs/screenshots`](screenshots/):

| View | File |
|---|---|
| Today | `today.png` |
| Board | `board.png` |
| Board templates | `board-templates.png` |
| Task drawer | `task-drawer.png` |
| Calendar | `calendar.png` |
| Insights | `insights.png` |
| Command palette | `command-palette.png` |
| Settings | `settings.png` |
| Sound settings | `sound-settings.png` |
| Auto-plan | `auto-plan.png` |
| Focus mode | `focus-mode.png` |
| Upcoming | `upcoming.png` |
| Archive | `archive.png` |
| Search | `search.png`, `search-filtered.png` |
| Auth | `auth-signin.png`, `auth-claim.png`, `auth-mfa.png` |
| Offline page | `offline.png` |
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
- Session cookie is `HttpOnly`, `SameSite=Lax`, renamed to `DRIFTSESSION`; each session is mirrored to `auth_session` with a hashed token, UA/IP hash, sliding expiry, and revocation checks on every authenticated API request.
- Unauthenticated `/api/bootstrap` returns 401.
- Cross-origin unsafe writes return 403 `CSRF_REJECTED` (origin/fetch-site guard).
- Passwords use BCrypt; API tokens are shown once and stored as SHA-256 hashes; webhook secrets are shown once and delivery payloads are HMAC-signed.
- Magic links use hashed one-time tokens, 15-minute expiry, session-bound state, atomic consumption, and an MFA handoff.
- MFA secrets are AES-GCM encrypted with a local key; backup codes are one-time hashes; workspace `require_mfa` is enforced on access paths.
- Webhook and OIDC outbound URLs reject private/non-HTTPS targets unless local-development private access is explicitly enabled.
- Account/workspace deletion anonymizes credentials, revokes sessions/tokens, hides workspaces from bootstrap, and clears local offline caches.
- Offline mutations carry per-write idempotency keys; the server replays the stored response, rejects key reuse on a different method/path, and expired keys are purged.
- Apple OAuth identity tokens are verified against Apple's JWKS; GitHub and Google use provider profile endpoints over TLS.

## Known limitations (documented, not silent)

These are environment-dependent or intentionally deferred items recorded in [`PARITY.md`](PARITY.md):

1. OAuth provider buttons appear only when `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, or `APPLE_CLIENT_ID`/`APPLE_CLIENT_SECRET` are configured. GitHub, Google, and Apple exchange/profile/JWKS contracts are covered by local mock-provider tests; a final live-provider smoke test still needs real credentials.
2. Magic-link mail is queued and the development link is returned. `spring.mail.*` delivery is implemented and covered by a real local SMTP socket test; a live external SMTP account is still needed for production delivery.
3. A dedicated standalone label-manager screen is not present; label APIs, label assignment, task-scoped labels, and label counts are implemented. Reminder offsets and custom reminder timestamps are available in the drawer.
4. Auto-plan is deterministic and settings-aware, with reference-equivalent scoring, due-time bounds, week actuals, fixed-block accounting, safe apply, refresh/undo, and delegated stale cleanup. It never calls an external model.
5. A `prod` profile is included with `Secure` cookies, forwarded-header handling, HSTS, compression, and static caching; TLS termination itself remains the reverse proxy's responsibility. Reminder delivery, retrying email delivery, daily-digest queueing, housekeeping, and retention soft-deletion run in-process and record `job_run` history.
6. Traditional Chinese covers all statically extracted UI strings; provider names and user-authored content stay untranslated by design.

## Runbook

```powershell
$env:JAVA_HOME='C:\Program Files\Eclipse Adoptium\jdk-17.0.17.10-hotspot'
$env:Path="$env:JAVA_HOME\bin;$env:Path"
.\mvnw.cmd test
.\mvnw.cmd -DskipTests package
java -jar target\project3383-0.0.1-SNAPSHOT.jar
```

Open <http://localhost:3383>. The health endpoint is <http://localhost:3383/api/health>.
