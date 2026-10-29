# Auto-plan

Auto-plan is ProjectA2's deterministic scheduler. It turns tasks and limits into a realistic schedule without changing the facts of a task.

## Product contract

- It schedules **plan blocks**, not due dates.
- It never marks a task complete, deletes a task, or silently changes a hard deadline.
- It produces **Balanced**, **Focus first**, and **Light day** options.
- The user can preview, apply, and undo. Higher automation levels may apply plan changes, but the same undo path remains.
- It uses local rules only. No model call, external calendar, or email is read.

## Automation levels

| Level | Behavior |
|---|---|
| Suggest only | Generates plans; the user applies one. |
| Safe auto-apply | Adds blocks for unscheduled tasks that do not overlap fixed/manual work. |
| Full plan auto-apply | Replaces future auto blocks and today's auto selection while preserving manual/locked work. |
| Delegated cleanup | Full auto plus optional archiving of stale unscheduled tasks after the configured number of days. Hard due dates do not move. |

## Constraints

- workday start/end
- daily capacity
- weekly capacity (actual completed focus + planned blocks)
- rest between blocks
- protected lunch
- maximum deep-work block
- optional long-task splitting
- weekends
- dependencies
- due dates (weighted, never rewritten)
- existing manual/locked blocks
- current time (past blocks are fixed)

## Settings

Basic controls: enable, level, rest interval, weekly limit, refresh interval.

Advanced controls: longest focus block, split long tasks, weekends, default estimate, cap behavior, protected lunch, stale cleanup.

## Write path

Applying a plan creates `PlanBlock` rows for the target horizon and sets `focusDate` for blocks scheduled today. Day Flow renders exact blocks, and Calendar shows them on their dates. If a plan has no blocks today, existing today selections are preserved.

Undo deletes the applied auto blocks in the horizon, restores the previous auto blocks, restores today's focus values, and unarchives delegated stale tasks.

## Cadence and limits

The client recomputes on open, after task changes, and at the configured interval while the app is open. A browser cannot run a background worker while the app is closed; that requires a server-side worker.

## Verification

- scheduler unit tests cover rest, lunch, fixed blocks, weekly caps, splitting, dependencies, weekends, and variants;
- E2E covers preview/apply/undo, Calendar writes, safe auto-apply, weekly limits, and settings persistence across Chromium, Firefox, and WebKit;
- axe scans the Auto-plan settings section with the other settings sections.
