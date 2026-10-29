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

- workday start/end and configured week start
- daily capacity
- weekly capacity (actual completed focus + planned blocks, including fixed blocks earlier in the current week)
- rest between blocks
- protected lunch
- maximum deep-work block
- optional long-task splitting
- weekends
- dependencies
- start dates and timed due dates (the scheduler never moves a deadline)
- already-tracked time (the remaining estimate is scheduled)
- Today dismissals (a task dismissed for today is considered for a later day)
- existing manual/locked blocks
- current time (past blocks are fixed)

## Settings

Basic controls: enable, level, rest interval, weekly limit, refresh interval.

Advanced controls: longest focus block, split long tasks, weekends, default estimate, cap behavior, protected lunch, stale cleanup.

## Write path

Applying a plan creates `PlanBlock` rows for the target horizon and sets `focusDate` for blocks scheduled today. Day Flow renders exact blocks for selected tasks and falls back to the existing Today order for chosen tasks without a block; Calendar shows blocks on their dates. If a plan has no blocks today, existing today selections are preserved.

Manual Today actions take precedence: accepting a task does not hide it behind a stale block, dismissing a task removes its today block, and Smart Plan/rebalance clear today's auto blocks before writing a new selection. The Auto-plan card also exposes **Clear plan** for removing scheduled blocks without deleting tasks or changing due dates.

Undo deletes the applied auto blocks in the horizon for the affected tasks, restores the previous auto blocks, restores today's focus values (including clearing focus that apply newly added), and unarchives delegated stale tasks. Safe auto-apply recomputes with existing auto blocks treated as fixed, so it cannot silently exceed the weekly cap.

## Cadence and limits

The client recomputes on open, after task changes, and at the configured interval while the app is open. Task edits that affect scheduling (start/due/estimate/priority/completion/dependencies) invalidate that task's auto blocks immediately. A browser cannot run a background worker while the app is closed; that requires a server-side worker.

## Current limitations

- `Task.focusDate` is workspace-global, so Today's chosen tasks are shared by team members even though `PlanBlock` and dismissals are per-user. For team use, treat Today/Auto-plan as one planner per workspace until the per-user selection migration lands.
- There is no UI yet for creating manual or locked plan blocks; the scheduler already preserves them when present.
- The horizon is bounded and capped at 1,000 tasks; tasks beyond the cap are not silently scheduled.

## Verification

- scheduler unit tests cover rest, lunch, fixed blocks, weekly caps, splitting, dependencies, weekends, and variants;
- E2E covers preview/apply/undo, Calendar writes, safe auto-apply, weekly limits, Today overbooking, and settings persistence across Chromium, Firefox, and WebKit;
- axe scans the Auto-plan settings section with the other settings sections.
