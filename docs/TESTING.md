# Testing

**Status:** all automated suites green on 2026-10-23  
**Last updated:** 2026-10-23

## 1. What is verified

| Layer | Tool | Result | Evidence |
|---|---|---|---|
| Type safety | `tsc --noEmit` (strict) | Pass, 0 errors | `typecheck-output.txt` |
| Lint | ESLint 9 + Next config | Pass, 0 errors, 44 triaged warnings | `lint-output.txt` |
| Unit | Vitest 5 | **78/78** in 10 files | `test-output.txt` |
| Production build | `next build` | Pass, 44 static pages + route table | `build-output.txt` |
| End-to-end | Playwright 1.64 (Chromium) | **12/12** | `e2e-output.txt` |
| Accessibility | axe-core via Playwright | 0 serious/critical on 6 surfaces | included in E2E run |
| Performance | Lighthouse 13.5 | 94/97/95 performance latest; 100 accessibility | `docs/performance/summary.json` |
| Dependencies | `npm audit --omit=dev --audit-level=high` | 0 high/critical | final QA output |
| API contract | `js-yaml` parse + route count | 63 paths, valid YAML | unit/CI check |

## 2. Unit tests

```bash
npm test
```

| File | Focus |
|---|---|
| `tests/unit/time.test.ts` | Timezone day keys, DST transitions, date formatting |
| `tests/unit/fractional.test.ts` | Ordering keys between neighbors, first/last insertion |
| `tests/unit/nlq.test.ts` | Natural-language dates, priorities, estimates, labels, recurrence |
| `tests/unit/recurrence.test.ts` | Daily/weekly/monthly rules, plural units, DST-safe next occurrence |
| `tests/unit/today.test.ts` | Ranking, reasons, capacity contract, overbooking |
| `tests/unit/rbac.test.ts` | Role/action matrix and tenant-safe role fallback |
| `tests/unit/validation.test.ts` | Zod schemas, import cap, field errors |
| `tests/unit/ai-eval.test.ts` | Two deterministic 20-case regression tables |
| `tests/unit/openapi.test.ts` | YAML parse, 60+ path check, every route handler path/method documented |
| `tests/unit/webhooks.test.ts` | Orphaned delivery stops retrying instead of crashing the job |

The AI evaluation is a fixture-based regression test, not a model benchmark. It asserts exact parses and plan ordering for 40 scenarios total. See [AI_GOVERNANCE.md](AI_GOVERNANCE.md).

## 3. End-to-end tests

```bash
# Against the production build (recommended for final QA)
npm run build
$env:E2E="true"; npm run start
$env:E2E_BASE_URL="http://localhost:3000"; npm run test:e2e
```

Playwright starts a dev server on port 3100 only when `E2E_BASE_URL` is unset. Use `localhost`, not `127.0.0.1`, when pointing at the production server: the session cookie is host-scoped and `APP_URL` is `http://localhost:3000`.

### Journeys

| # | Spec | Requirements | Assertion |
|---|---|---|---|
| 1 | `a11y.spec.ts` | NFR-005, SX-2 | axe serious/critical = 0 on Today, Board, Insights, palette, Settings, both auth states |
| 2 | `advanced.spec.ts` | AC-009, AC-005 | Guest work survives claim, sign-out, password sign-in |
| 3 | `advanced.spec.ts` | AC-008, SX-4 | Automation preview writes nothing; apply, audit, undo |
| 4 | `advanced.spec.ts` | AC-007, AC-006, AC-010 | Stale write 409; cross-workspace 404; JSON/CSV export; import |
| 5 | `advanced.spec.ts` | FR-020, FR-021 | Invitee joins a separate team workspace |
| 6 | `advanced.spec.ts` | FR-005 | Insights timeline/workload progressive, scoped, keyboard reachable |
| 7 | `core.spec.ts` | AC-009 | First task in <60s without signup |
| 8 | `core.spec.ts` | AC-001, AC-002 | Keyboard move, undo, persistence, live announcement |
| 9 | `core.spec.ts` | FR-011 | Search scoped and filterable |
| 10 | `core.spec.ts` | FR-024 | Offline capture queues and syncs after reconnect |
| 11 | `core.spec.ts` | FR-022 | Public read-only share opens without a session |
| 12 | `core.spec.ts` | FR-017 | Capacity, digest, quiet hours persist |

The suite is serial (`workers: 1`) because it shares one SQLite database and creates workspaces. Tests use unique names/emails to avoid collisions.

## 4. Accessibility testing

Automated:

- axe-core tags: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`.
- Blocking threshold: `critical` or `serious`.
- Lighthouse accessibility category: 100 on Today, Board, and task drawer.
- Keyboard journeys cover capture, move (`Alt+ArrowRight`), undo, palette, dialogs, and focus return.

Manual, **not performed**:

- NVDA on Windows and VoiceOver on macOS.
- Browser zoom to 400% and Windows High Contrast.
- Switch control / voice control.
- Cognitive walkthrough with real users.

The automated pass is necessary but not sufficient for a WCAG 2.2 AA claim. See [VPAT.md](VPAT.md) for the clause-by-clause status and [ACCESSIBILITY.md](ACCESSIBILITY.md) for the design rationale.

## 5. Performance testing

```bash
npm run test:perf   # requires a running server with demo data
```

`scripts/perf.mjs` creates a guest session through the API, navigates Today, Board, and a task drawer, and runs Lighthouse mobile emulation. Results are written to `docs/performance/summary.json` plus raw HTML/JSON reports. See [PERFORMANCE.md](PERFORMANCE.md).

## 6. Screenshot generation

```bash
npm run screenshots
```

Uses Playwright with locale `en-US`, a seeded demo account, and the production server. Output is deterministic fixture data in `docs/screenshots/`. Set `APP_URL` to target a different server; the script does not enforce a local-only check.

## 7. CI

`.github/workflows/ci.yml` runs on push/PR:

1. `npm ci`
2. `npx prisma generate`
3. `npx prisma migrate deploy`
4. `npm run typecheck`
5. `npm run lint`
6. `npm test`
7. `npm run build`
8. `npm run test:e2e` with `E2E=true` against a production server
9. `npm audit --omit=dev --audit-level=high`

The workflow uses SQLite and a disposable database file. It does not run Docker, live OAuth/SSO, SMTP, or a 10k-user load test. Docker execution is unverified locally because Docker is not installed in the delivery environment.

## 8. Known gaps and flake risks

| Gap | Impact | Mitigation |
|---|---|---|
| No live OAuth/SSO round-trip | Provider-specific bugs possible | Unit-level state/PKCE review; document as unverified |
| No malware scanner | Uploaded files are not scanned | MIME/size checks + disable attachments for untrusted users |
| No manual screen-reader pass | Unknown SR-specific issues | axe + keyboard tests; schedule manual audit |
| No 10k-user load test | SQLite write contention untested at scale | PostgreSQL rollout; k6 plan in BACKLOG |
| One browser engine | WebKit/Firefox regressions possible | Chromium only in CI; expand matrix |
| Shared SQLite in E2E | Serial execution required | Unique fixtures; workers=1 |
| Time-dependent Today tests | Clock edges can flake near midnight | Tests compute local day keys; rerun if near midnight |

## 9. Reproducing a clean run

```bash
npm run setup -- --seed
npm run typecheck
npm run lint
npm test
npm run build
$env:E2E="true"; npm run start
# in a second terminal
$env:E2E_BASE_URL="http://localhost:3000"; npm run test:e2e
npm run test:perf
npm run audit
```

Expected: typecheck clean, lint 0 errors, 78 unit tests pass, build succeeds, 12 E2E pass, Lighthouse accessibility 100, audit 0 high/critical.
