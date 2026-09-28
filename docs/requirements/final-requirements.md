# Kanban Planner - Final Requirements

## Project Overview
Kanban Planner is a single-user task planner web app inspired by Microsoft Planner, with its own look and interaction style. It runs locally without internet dependency and supports organizing work across multiple plans, buckets, and tasks.

The system uses:
- Frontend: plain HTML, CSS, JavaScript.
- Backend: Java Spring Boot (Maven) REST API that also serves frontend assets.
- Storage: local JSON file through a repository interface so a future database implementation can be introduced by adding a new repository class.
- Seed file: `src/main/resources/data/seed-data.json` (read-only).
- Runtime file: `./data/planner-data.json` in project root, configurable in `application.properties`.
- Java build target: Maven `release 17`.
- Spring Boot and JaCoCo versions must be compatible with both JDK 17 and the detected JDK 25 environment.

## Functional Requirements

### 1) Plans
1. The app shall support creating, editing, listing, and deleting plans.
2. Plans shall be displayed in a sidebar and can be selected to load their data in main views.
3. Deleting a plan shall permanently cascade-delete all buckets, tasks, and checklist items within that plan.
4. Plan name rules:
   - Required.
   - Trimmed.
   - Length 1-60 characters.
5. A newly created plan shall include default buckets: `To Do`, `Doing`, `Done`.

### 2) Buckets
1. The app shall support creating, editing, listing, and deleting buckets within a plan.
2. Bucket name rules:
   - Required.
   - Trimmed.
   - Length 1-60 characters.
   - Unique within a plan, case-insensitive.
3. If a non-empty bucket is deleted, its tasks shall be moved to `Uncategorized` in the same plan, and then the original bucket is deleted.
4. If `Uncategorized` does not exist when needed as fallback, it shall be auto-created.
5. Deleting `Uncategorized` while it contains tasks shall be blocked with a clear validation error.
6. An empty `Uncategorized` bucket can be deleted.

### 3) Tasks and Task Details
1. The app shall support creating, editing, listing, and deleting tasks within a plan.
2. Task details panel shall open from board cards and grid rows.
3. Task fields:
   - title
   - bucket
   - progress (`Not started`, `In progress`, `Completed`)
   - priority (`Urgent`, `Important`, `Medium`, `Low`)
   - start date
   - due date
   - notes
   - checklist
4. Task validation rules:
   - `title`: required, trimmed, 1-120 characters.
   - `bucket`: required, must exist in same plan.
   - `progress`: required enum.
   - `priority`: required enum.
   - `startDate`: optional.
   - `dueDate`: optional.
   - `notes`: optional.
   - `checklist`: optional.
   - Each checklist item text: required, 1-120 characters.
5. Date consistency rule:
   - If both `startDate` and `dueDate` are present, `startDate <= dueDate`.
6. Checklist completion shall not automatically change task progress.

### 4) Board View
1. The app shall provide a board view with column grouping by:
   - bucket, or
   - progress.
2. A switcher shall allow changing grouping mode.
3. Drag-and-drop behavior:
   - Group by bucket: dropping updates only the task bucket.
   - Group by progress: dropping updates only the task progress.
   - No other task field is changed by drag-and-drop.
4. Manual card ordering within a board column is not supported.
5. Card order inside each board column shall follow the grid default sort order.

### 5) Grid View
1. The app shall provide a sortable table view for tasks.
2. Clicking a row shall open task details.
3. Default grid sort shall be:
   - due date ascending,
   - tasks with no due date placed last,
   - tie-breaker by title A-Z.

### 6) Charts View
1. The app shall provide a charts view containing:
   - progress donut,
   - tasks per bucket,
   - tasks per priority,
   - overdue count.
2. Charts shall be rendered using plain JavaScript with SVG or Canvas.
3. Chart aggregates shall be computed in frontend code from the plan detail response.

### 7) Overdue Rule
1. A task is overdue when all conditions are true:
   - due date exists,
   - progress is not `Completed`,
   - due date is earlier than local today (date-only comparison).

### 8) Runtime and Data
1. The app shall run locally, single-user only, no login/accounts.
2. The app shall not depend on internet access or paid APIs.
3. The app shall use sample seed data.
4. The backend shall read sample seed data from `src/main/resources/data/seed-data.json`.
5. The backend shall persist runtime data to `./data/planner-data.json`.
6. Runtime data path shall be configurable in `application.properties`.

### 9) Deletion Confirmation UX
1. Frontend shall show a confirmation dialog before deleting:
   - a plan,
   - a bucket,
   - a task,
   - a checklist item.

## Quality Requirements
1. Backend shall be covered by JUnit 5 tests.
2. Test execution shall include a coverage report.
3. Validation failures shall return clear, consistent API error responses for frontend display.
4. Data updates shall remain consistent with confirmed business rules across board, grid, charts, and storage.
5. Frontend and backend should remain implementation-decoupled through REST contracts and DTOs.
6. Runtime data directory (`/data/`) shall be excluded from version control.

## Usage Scenario (Single Example)
1. User opens app and selects a plan from sidebar.
2. User creates a bucket named `Design`.
3. User adds a task with title `Create wireframes`, priority `Important`, progress `Not started`, and due date.
4. User switches board grouping to progress and drags the task from `Not started` to `In progress`.
5. User opens task details from grid row and checks one checklist item.
6. Task progress remains `In progress` until user manually changes it.
7. If due date passes and progress is not `Completed`, charts overdue count includes this task.
8. User attempts to delete a bucket and sees a confirmation dialog before deletion is executed.

## Acceptance Examples
1. **Bucket deletion fallback**
   - Given bucket `Backlog` has tasks
   - When user deletes `Backlog`
   - Then tasks move to `Uncategorized` and `Backlog` is removed.

2. **Plan deletion cascade**
   - Given a plan has buckets and tasks
   - When user deletes the plan
   - Then all associated buckets/tasks/checklists are permanently removed.

3. **Date validation**
   - Given task has start date `2026-09-10`
   - When due date is set to `2026-09-09`
   - Then save is rejected with validation error.

4. **Overdue classification**
   - Given due date is yesterday and progress is `In progress`
   - Then task is overdue.
   - Given progress is `Completed`
   - Then task is not overdue.

5. **Grid default sort**
   - Given mixed due dates and no-due-date tasks
   - Then initial grid order is earliest due date first, no-due-date last, title A-Z as tie-breaker.

6. **Drag-and-drop update scope**
   - Given board grouped by progress
   - When user drags task into `Completed` column
   - Then only progress changes; bucket stays same.

7. **Uncategorized deletion blocked when non-empty**
   - Given bucket `Uncategorized` has tasks
   - When user tries to delete `Uncategorized`
   - Then the operation is rejected with a clear validation error and no tasks are deleted.

8. **Plan name validation**
   - Given user enters a blank plan name or a name longer than 60 characters
   - When user submits create or update
   - Then save is rejected with a validation error.

9. **New plan default buckets**
   - Given user creates a new plan with a valid name
   - When creation succeeds
   - Then the plan contains buckets `To Do`, `Doing`, and `Done`.

## Future Extensions (Out of Scope Now)
- Calendar view.
- Labels/tags and tag hierarchy.
- Filters.
- Multi-user and assignees.
- Attachments.
- Comments.
- AI features (priority scoring, task generation, auto-tagging, agent).
- Git integration.
- CI/CD pipelines.
- Email/Discord notifications.
- Database storage implementation.
