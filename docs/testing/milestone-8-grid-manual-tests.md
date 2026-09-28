# Milestone 8 Manual Verification - Grid View

## Setup

1. Run `mvn spring-boot:run`.
2. Open `http://localhost:8080/`.
3. Select `Sample Plan` from the sidebar.

## Core checks

1. Confirm the `Grid` section appears below the `Board` section.
2. Confirm table columns are visible: Title, Bucket, Progress, Priority, Start, Due.
3. Confirm default ordering is:
   - due date ascending,
   - tasks without due date listed last,
   - ties on due date resolved by title A-Z.

## Sort header checks

1. Click `Title` once and verify A-Z order.
2. Click `Title` again and verify Z-A order.
3. Click `Due` once and verify due date ascending with no-due tasks still last.
4. Click `Due` again and verify due date descending with no-due tasks still last.

## Empty/no-plan checks

1. With no plan selected (or after deleting the only plan), verify grid empty text: `Select a plan to view tasks in the grid.`
2. For a selected plan with no tasks, verify empty text: `No tasks to display for this plan.`

## Consistency check with board ordering

1. Keep grid sort on the default (`Due` ascending).
2. Compare tasks in a board column with the same tasks in grid order.
3. Verify board card ordering matches the grid default comparator behavior.
