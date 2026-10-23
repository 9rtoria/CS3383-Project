# Five-minute demo

**Audience:** evaluator, VP, or design partner  
**Setup:** `npm run setup -- --seed && npm run build && npm run start`  
**Open:** <http://localhost:3000>  
**Demo account:** `demo@drift.local` / `DriftDemo123!`

The point of the demo is not “look at all the features”. It is: **a solo user gets value in under a minute, and the same product grows into a governed team workspace without changing tools.**

## 0:00–0:40 — Guest capture, no signup

1. Open a private window. There is no marketing page or signup wall.
2. Point at the focused capture box. Type:

   ```
   Draft launch narrative tomorrow 9am high 45m #launch
   ```

3. Press Enter. The task appears in Today with the parsed date, priority, estimate, and label.
4. Say: “That is a real anonymous user, workspace, and board in the database — not a demo overlay. Claiming the account later keeps this work.”

**What to notice:** one primary action, no tour, no modal.

## 0:40–1:30 — Keyboard move and undo

1. Open **My tasks** in the sidebar.
2. Focus a card, press `Alt+ArrowRight` to move it to the next column.
3. Click **Undo** in the toast to reverse it.
4. Press `?` to show shortcuts. Point out the “Single-key shortcuts” toggle.

**What to notice:** the move is optimistic, announced in a live region, version-checked server-side, and undoable. Drag is available but never required.

## 1:30–2:20 — Today plan and capacity

1. Go to **Today** (`G` then `T`).
2. Point at the capacity meter: “285 of 300 min”, remaining, overbooked state.
3. Open the reason on one item: due today, priority, fits remaining time.
4. Use “Not today” on one item; it disappears for this local date only.
5. Change capacity in Settings → Planning, return to Today, show the plan adapt.

**What to notice:** the planner explains itself and respects a realistic day, rather than dumping a backlog.

## 2:20–3:10 — Search, command palette, views

1. Press `/`, search `launch`, filter by priority/label.
2. Press `Ctrl+K`, type “insights”, open **Insights**.
3. Show timeline, workload, and board health. Say: “This is progressive disclosure — one Insights entry, not two more primary nav items.”
4. Press `G` then `C` for Calendar.

**What to notice:** every view is reachable by keyboard and the palette, and search is workspace-scoped.

## 3:10–4:00 — Automation with a preview

1. Sign in as the demo account (or use the claimed guest).
2. Settings → Automations → New rule.
3. Choose trigger “task moved”, condition “to Done”, action “add label `shipped`”.
4. Click **Preview**. Show the side-effect-free diff and affected count.
5. Apply, then open the task activity and show the audit row + 60-second undo.

**What to notice:** automation is not a black box. Preview writes nothing; apply is audited and reversible.

## 4:00–4:40 — Share, export, and offline

1. Open a board → Share → enable the public link. Open it in a private window; it is read-only and needs no session.
2. Settings → Data → export JSON/CSV. Mention the 1,000-task/5 MB import cap.
3. Go offline (DevTools → Network → Offline), capture a task. Show the pending queue. Go online; show it sync.
4. If time: force a stale move in two tabs and show the 409 “Keep mine / Use server” sheet.

**What to notice:** honest states — pending, failed, conflict — instead of silent loss.

## 4:40–5:00 — Enterprise without the clutter

1. Switch to **Northstar Studio** (team workspace).
2. Show Members, Roles, Audit, Retention, SSO, API tokens, Webhooks.
3. Switch back to the personal workspace; those surfaces disappear.
4. Close on the boundary: “Local deterministic assist, no outbound customer data; PostgreSQL/SSO path documented; gaps listed in REVIEW.md.”

## Demo guardrails

- Do not claim Docker was run, OAuth/SSO was live-tested, attachments are malware-scanned, or a 10k-user load test passed. Those are explicitly unverified.
- If the demo DB is dirty, reset with `npm run db:deploy` and re-seed in a fresh database; do not delete a workspace you need.
- Use `localhost`, not `127.0.0.1`, so the session cookie matches `APP_URL`.
- Keep the browser at 100% zoom for screenshots; use a separate pass for zoom/reflow claims.

## Backup demo (if the network or DB is unavailable)

Use the screenshots in `docs/screenshots/` and the recorded evidence in `REVIEW.md`. Walk through Today, Board, drawer, Insights, palette, Settings, mobile, and Auth in that order. Be explicit that these are fixtures, not live customer data.
