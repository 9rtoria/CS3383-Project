# Performance

**Measured:** 2026-10-23, production build, seeded demo workspace  
**Tool:** Lighthouse 13.5, mobile emulation, headless Chromium  
**Last updated:** 2026-10-23

## 1. Results

| Page | Performance | Accessibility | Best practices | LCP | CLS | TBT | Transfer |
|---|---:|---:|---:|---:|---:|---:|---:|
| Today | **94** | **100** | **100** | 2,432 ms | 0.000 | 225 ms | 222 KB |
| Board | **97** | **100** | **100** | 2,438 ms | 0.038 | 135 ms | 225 KB |
| Task drawer | **95** | **100** | **100** | 2,658 ms | 0.044 | 111 ms | 231 KB |

These are the latest of three stable repeat runs on the final build. Across those runs, performance was 94–97, accessibility and best practices were 100 on every page, LCP was 2.41–2.66 s, CLS was 0.000–0.070, and TBT was 106–225 ms. Raw reports: `docs/performance/{today,board,task-drawer}.{json,html}`, summary: `docs/performance/summary.json`; stable repeat-run logs: `perf-run-1.txt`, `perf-run-2.txt`. An earlier outlier run (`perf-run-early-outlier.txt`) scored 83 on the task drawer with 569 ms TBT; it is retained for transparency and excluded from the final range.

Lighthouse SEO is not reported: the authenticated workspace is intentionally `noindex`, so an SEO score would be misleading. The public share page is indexable but was not part of the scored set.

## 2. Method

`scripts/perf.mjs`:

1. Verifies the server is reachable.
2. Creates a guest session through `POST /api/auth/guest` and keeps the cookie.
3. Opens Today, the first board, and the first task drawer.
4. Passes the session cookie to Lighthouse as an `extraHeaders` request header. It does not hold a Playwright CDP connection open during the audit.
5. Runs Lighthouse with `formFactor: "mobile"`, default mobile throttling, and `onlyCategories: performance, accessibility, best-practices`.
6. Writes the LHR JSON/HTML and a compact summary.

The run used the **production** server (`next start`), not `next dev`, to avoid the development badge, HMR client, and unminified bundles. It ran with `E2E=true` only because the local link-preview seam is enabled for test harnesses; that flag does not change production bundles. The host had a separate interactive Chrome session open, so repeat runs were used to separate app performance from host scheduling noise.

## 3. Budgets

| Metric | Budget | Result | Status |
|---|---:|---:|---|
| Performance score | ≥ 90 release gate; ≥ 95 target | 94–97 | Pass gate; target missed by 1 on Today latest |
| Accessibility | 100 | 100 | Pass |
| Best practices | 100 | 100 | Pass |
| LCP | ≤ 2,500 ms | 2,432–2,658 ms | Miss on task drawer |
| CLS | ≤ 0.10 | 0.000–0.070 | Pass |
| TBT | ≤ 200 ms | 106–225 ms | Miss on Today latest |
| Transfer | ≤ 300 KB | 222–231 KB | Pass |

The task-drawer LCP (2,658 ms in the latest run) is 158 ms over the 2.5 s “good” threshold. The task-drawer performance score is still 95, but treat LCP as an open optimization item, not a clean pass.

**Written exceptions:** the latest Today TBT is 225 ms, 25 ms over the 200 ms budget; the two preceding stable runs measured 185 ms and 191 ms. The latest Today performance score is 94, one point below the 95 target but above the 90 release gate. Both are accepted for this evaluation with the understanding that they are optimization items, not clean passes.

## 4. What is fast, and why

- **One bootstrap round trip.** The shell fetches viewer, workspaces, boards, labels, settings, and inbox together. Views then fetch only their own read model.
- **Server-rendered shell, small client islands.** The board, Today, drawer, and palette are client components, but icons are tree-shaken Lucide imports and there is no charting or drag-and-drop library in the bundle.
- **Fractional ordering avoids renumbering.** A move writes one row and one position key; it does not rewrite a column.
- **Optimistic UI with server reconciliation.** Capture and move render immediately; the server response replaces the optimistic row. Failures roll back with a visible message.
- **No web fonts.** The type system uses a system stack, eliminating font download and FOIT/FOUT.
- **Cached bootstrap for offline.** The service worker serves the last bootstrap payload when the network is unavailable, so the shell is usable rather than a blank error page.

## 5. Known costs

| Cost | Evidence | Plan |
|---|---|---|
| LCP near or over 2.5 s on mobile | Today 2.43 s, Board 2.44 s, drawer 2.66 s | Preload the shell payload, trim initial board payload, evaluate streaming the drawer |
| CLS on board/drawer | 0.038 / 0.044 latest; 0.070 observed | Reserve drawer header height; avoid late badge insertion |
| TBT 225 ms on Today | 225 ms latest; 106–225 ms across stable repeats | Split the Today suggestion list; defer non-critical ranking UI |
| SQLite single writer | Not load-tested | PostgreSQL + connection pooling before horizontal scale |
| Bootstrap payload grows with boards | 222 KB transfer today | Paginate board summaries or lazy-load task counts |
| No image optimization pipeline | Avatars are remote/initial-based | Add `next/image` and sized avatar URLs |

## 6. Scale expectations

The measured workload is a demo workspace with 14 tasks. It does **not** validate:

- 10,000 concurrent users.
- A workspace with 100,000 tasks.
- Search latency at millions of rows.
- Webhook fan-out to hundreds of endpoints.
- Attachment throughput.

SQLite is a deliberate demo choice. The PostgreSQL path and the load-test plan are in [DEPLOYMENT.md](DEPLOYMENT.md) and `BACKLOG.md`. Do not cite these Lighthouse numbers as a capacity claim.

## 7. Reproduce

```bash
npm run build
$env:E2E="true"; npm run start
# second terminal
npm run test:perf
```

Results overwrite `docs/performance/`. Machine, network, and background load affect scores; compare medians of three runs before making a regression claim.

## 8. Regression policy

- Any performance score below 90, accessibility below 100, or best-practices below 100 blocks a release.
- LCP above 2,500 ms, CLS above 0.1, or TBT above 200 ms requires a written exception.
- Bundle growth above 10% requires identifying the dependency and a removal plan.
- Re-run Lighthouse on the same machine and production build; dev-server numbers are not accepted as evidence.
