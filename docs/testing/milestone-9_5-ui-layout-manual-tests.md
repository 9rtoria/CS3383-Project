# Milestone 9.5 Manual Verification - UI Layout Refinement

## Setup

1. Run `mvn spring-boot:run`.
2. Open `http://localhost:8080/`.
3. Select a plan with tasks (for example `Sample Plan`).

## Sidebar checks

1. Confirm sidebar starts in expanded mode and can be collapsed/expanded with the toggle.
2. Confirm `+ New plan` reveals a name input form.
3. Confirm cancel hides the form.
4. Confirm valid create saves and new plan appears in list.
5. Confirm there is no `Reload` button and no milestone developer subtitle text.

## Header and plan controls checks

1. Confirm plan header contains `Board`, `Grid`, and `Charts` tabs.
2. Confirm only one view panel is visible at a time when switching tabs.
3. Confirm charts tab shows placeholder text only.
4. Click plan title to rename:
   - Enter saves.
   - Escape cancels.
5. Open plan `...` menu and delete plan; confirm deletion dialog appears before delete.

## Board checks

1. In bucket grouping, each column has a `+` add-task button.
2. In progress grouping, each column also has a `+` add-task button.
3. In bucket grouping, verify a terminal `+ Add bucket` column is present.
4. Verify bucket header `...` menu provides Rename and Delete.
5. Verify deleting non-empty non-`Uncategorized` bucket moves tasks to `Uncategorized`.
6. Verify deleting non-empty `Uncategorized` is blocked with a clear validation message.

## Task drawer checks

1. Confirm task details drawer is hidden by default.
2. Click a board card and confirm drawer opens with that task values.
3. Click a grid row and confirm drawer opens with that task values.
4. Confirm drawer closes via:
   - Cancel button,
   - `X` button,
   - successful Save.

## Add-task entry checks

1. Click header `+ Add task` and confirm drawer opens with default values.
2. In board grouped by bucket, click column `+` and confirm drawer bucket is prefilled to that column.
3. In board grouped by progress, click column `+` and confirm drawer progress is prefilled to that column.
4. Save created task and confirm it appears in board and grid.

## Message and bug regression checks

1. Confirm there are no developer status texts like `Grid ready.` or long implementation hints.
2. Confirm user notices are short, temporary (for example `Saved`).
3. Reproduce bucket-value consistency check:
   - Find a task in grid, note bucket column value.
   - Open drawer from that row.
   - Confirm bucket select matches saved bucket value.
   - Repeat after reopening from board card.
