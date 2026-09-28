# Milestone 9 Manual Verification - Task Details, Forms, Checklist

Note: layout/navigation interactions were refined in Milestone 9.5. Use `docs/testing/milestone-9_5-ui-layout-manual-tests.md` for current UI flow checks.

## Setup

1. Run `mvn spring-boot:run`.
2. Open `http://localhost:8080/`.
3. Select `Sample Plan` from the sidebar.

## Task details opening checks

1. In the board, click a task card.
2. Verify the `Task details` section switches from empty message to populated task form.
3. In the grid, click the same task row.
4. Verify the same task is shown in the details form.

## Create task checks

1. Click `New task` in the `Task details` section.
2. Enter valid values for title, bucket, progress, priority; leave dates/notes optional.
3. Add two checklist items and save.
4. Verify:
   - success message appears,
   - the task appears in board and grid,
   - checklist items are persisted when re-opening task.

## Edit task checks

1. Open an existing task from board or grid.
2. Update title, bucket, progress, priority, dates, notes, and checklist text.
3. Toggle checklist completion and save.
4. Verify updates are reflected in board and grid.

## Checklist interaction checks

1. Open a task, click `Add item`, enter text, and save.
2. Re-open and verify added item persists.
3. Delete one checklist item and verify confirmation dialog appears.
4. Confirm deletion and save; verify removed item is no longer present.

## Delete task checks

1. Open a task and click `Delete task`.
2. Verify confirmation dialog appears.
3. Confirm deletion.
4. Verify task disappears from board and grid.

## Validation boundary checks

1. Title length `0` (blank/whitespace only) -> save rejected with validation error.
2. Title length `121` -> save rejected with validation error.
3. Title length `1` and `120` -> save accepted.
4. Checklist item text length `0` -> save rejected.
5. Checklist item text length `121` -> save rejected.
6. Checklist item text length `1` and `120` -> save accepted.
7. Date rule: set `startDate > dueDate` -> save rejected.
8. Date rule: set `startDate == dueDate` -> save accepted.

## Checklist-progress rule check

1. Set task progress to `Not started`.
2. Mark all checklist items completed and save.
3. Verify progress remains `Not started` (no auto-change to `Completed`).
