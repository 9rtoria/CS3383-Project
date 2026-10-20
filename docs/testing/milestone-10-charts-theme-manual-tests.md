# Milestone 10 Manual Verification - Charts, Overdue Highlight, Theme Toggle

## Setup

1. Run `mvn spring-boot:run`.
2. Open `http://localhost:8080/`.
3. Select `Sample Plan`.

## Charts view checks

1. Click the `Charts` tab; confirm one panel is visible with four widgets:
   - Progress (donut), Overdue (number), Tasks per bucket (bars), Tasks per priority (bars).
2. Progress donut:
   - Donut is a compact ring (not a giant arc) with the total task count in the center.
   - Legend lists `Not started`, `In progress`, `Completed` with per-state counts.
   - Segment sizes are proportional to counts.
3. Tasks per bucket:
   - One horizontal bar per bucket in plan bucket order, including zero-count buckets.
   - Bar length is proportional to the largest bucket; count label shown at the end.
4. Tasks per priority:
   - Four bars for `Urgent`, `Important`, `Medium`, `Low` with counts.
5. Overdue:
   - Large number equals the count of overdue tasks (rule below).
6. Data accuracy:
   - Manually count tasks by progress/bucket/priority in Grid and confirm the charts match.

## Empty-state checks

1. Create a new plan (default buckets, no tasks) and open Charts.
2. Confirm each widget shows a friendly message (`No tasks to chart yet.`) and Overdue shows `0`.
3. Confirm no broken/giant SVG is rendered.

## Overdue rule + highlight checks

Overdue = due date exists AND progress is not `Completed` AND due date is before local today (date-only).

1. Create a task with a due date in the past and progress `In progress`:
   - Board card shows overdue styling (left accent border + `Overdue` tag).
   - Grid row shows overdue styling and `Overdue` tag in the Due column.
   - Charts overdue count increments.
2. Set that task progress to `Completed`:
   - Overdue styling disappears on board and grid; charts overdue count decrements.
3. Create a task due today:
   - Not treated as overdue anywhere.
4. Create a task with no due date:
   - Not treated as overdue anywhere.

## Theme toggle checks

1. Confirm a theme toggle button is pinned at the bottom of the sidebar content (`Dark mode` label in light theme).
2. Click it:
   - UI switches to dark theme across sidebar, main panel, board, grid, drawer, and charts.
   - Chart colors (donut, bars, overdue, legend) adapt and remain readable.
   - Button label switches to `Light mode`; a short notice appears.
3. Reload the page:
   - The chosen theme persists (loads without a light flash before switching).
4. Toggle back to light:
   - All views return to the light palette; reload persists light.

## Regression checks

1. Board drag-and-drop (task cards, bucket columns, progress columns) still works in both themes.
2. Grid sorting still works; overdue highlight does not break row click/keyboard selection.
3. Task drawer open/save/delete still works in both themes.
4. `mvn test` passes (including `ChartDataScriptTest` and extended `StaticResourceTest`).
