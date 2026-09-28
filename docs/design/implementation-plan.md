# Kanban Planner - Implementation Plan

## 1. Purpose and Scope
This implementation plan translates confirmed requirements into build milestones for one developer. It covers backend and frontend delivery order, proposed REST API shape, JSON storage model, repository abstraction, and tests.

All endpoint naming, DTO layouts, and folder structure in this document are proposals based on confirmed requirements and can be adjusted during implementation if needed.

## 2. Detected Local Toolchain (Fact)
- Java: `25.0.2` (LTS)
- Maven: `3.9.12`
- Git: `2.45.1.windows.1`

## 2.1 Compatibility Decisions (Confirmed)
- Compile target: Maven `release 17` so teammates on JDK 17 can build and run.
- Dependency selection: choose Spring Boot and JaCoCo versions compatible with both JDK 17 and detected JDK 25.
- Spring Boot parent version pinned: `3.5.16` (latest stable 3.x at planning time).
- JaCoCo Maven plugin version pinned: `0.8.15` (supports Java 25 while project compiles with `release 17`).

## 3. Proposed Architecture

### 3.1 Layers
- **Web/API layer**: Spring MVC controllers exposing REST endpoints and serving static frontend files.
- **Service layer**: business rules, validation, and orchestration.
- **Repository interface layer**: abstraction for plan/bucket/task persistence.
- **JSON repository implementation**: file-backed implementation of repository interfaces.
- **Frontend layer**: vanilla HTML/CSS/JS views consuming REST endpoints.

### 3.2 Data Ownership
- Backend owns validation, business rules, and canonical task state.
- Frontend handles user interaction and rendering logic but relies on backend for persisted rule enforcement.

## 4. Proposed Milestones (Single Developer, Sequential)

### Milestone 1 - Project bootstrap and skeleton
Deliverables:
- Spring Boot Maven project with JUnit 5 test setup.
- Maven compiler plugin configured with `release 17`.
- Spring Boot and JaCoCo versions pinned for JDK 17 and JDK 25 compatibility.
- Basic package structure.
- Static resource serving using Spring Boot default static mapping (`src/main/resources/static`) with no custom MVC config.
- Custom health endpoint: `GET /api/health` returns `{"status":"UP"}` (no Actuator).

Verification:
- `mvn test` runs successfully.
- App starts and serves index page.
- `GET /api/health` returns `200` with `{"status":"UP"}`.

### Milestone 2 - Domain model and repository interfaces
Deliverables:
- Domain entities/records for Plan, Bucket, Task, ChecklistItem.
- Enums for Progress and Priority.
- Repository interfaces (no storage implementation yet).

Verification:
- Unit tests for model-level helper logic (if any).

### Milestone 3 - JSON file persistence implementation
Deliverables:
- JSON storage file schema and read/write adapter.
- `JsonPlannerRepository` implementing repository interfaces.
- Seed file source fixed at `src/main/resources/data/seed-data.json` (read-only).
- Runtime persistence file at `./data/planner-data.json` (project root), path configurable in `application.properties`.
- Runtime `/data/` excluded from Git tracking.

Verification:
- Repository tests for CRUD persistence across app restarts (read-after-write behavior).

### Milestone 4 - Service layer + validation + business rules
Deliverables:
- Services for plans, buckets, tasks.
- Validation and business-rule enforcement:
  - plan name required/trimmed/1-60,
  - title/bucket/progress/priority/checklist constraints,
  - startDate <= dueDate,
  - bucket delete fallback to `Uncategorized`,
  - block deleting non-empty `Uncategorized` with clear validation error,
  - plan delete cascade,
  - new plan default buckets (`To Do`, `Doing`, `Done`),
  - overdue derivation logic.

Verification:
- Service unit tests for success and failure cases.

### Milestone 5 - REST API endpoints and error responses
Deliverables:
- Controllers + DTOs + mapping.
- Consistent validation error format.

Verification:
- Controller integration tests using MockMvc.

### Milestone 6 - Frontend shell and sidebar/plans workflow
Deliverables:
- Base layout with sidebar and main content area.
- Plan switching and plan CRUD flows.

Verification:
- Manual test in browser for plan operations.

### Milestone 7 - Board view + drag/drop
Deliverables:
- Board grouped by bucket/progress with switcher.
- Drag/drop updates only active grouping field.
- No manual card ordering within columns.
- Card order in each board column follows grid default sort.

Verification:
- Manual and API-level checks for update scope.

### Milestone 8 - Grid view + sort behavior
Deliverables:
- Task table with sortable headers.
- Default sorting by due date asc, no due date last, title tie-break.
- Sorting computed in frontend from plan detail response.

Verification:
- Manual tests plus JS unit-style tests for comparator functions (if included).

### Milestone 9 - Task details panel + checklist + forms
Deliverables:
- Task details panel from board card and grid row.
- Create/edit/delete task and checklist interactions.
- Frontend confirmation dialogs for deleting a task and deleting a checklist item.
- No auto-progress change from checklist completion.

Verification:
- Manual test scenarios and backend tests confirming checklist rule.

### Milestone 9.5 - UI layout refinement
Deliverables:
- Sidebar refinement: narrower/collapsible sidebar and `+ New plan` reveal flow.
- Header tab shell: `Board`, `Grid`, `Charts` tabs with one active view at a time.
- Task details converted to side drawer: hidden by default, opens from board/grid, closes on cancel/close/save.
- Add-task entry points:
  - `+ Add task` in plan header for default draft.
  - `+` control on each board column for contextual draft prefill.
- Board-centric bucket controls:
  - `+ Add bucket` terminal column (bucket grouping only).
  - Bucket column menu with Rename/Delete actions.
- Plan header actions:
  - Inline title rename interaction.
  - Plan delete action in header menu with existing confirmation.
- User messaging cleanup: remove developer-oriented status copy and use short temporary notices.
- Bug hardening check: task details drawer always hydrates from saved task values (including bucket/progress).

Verification:
- Manual workflow checks for sidebar, tabs, drawer lifecycle, add-task entry points, and bucket controls.
- Regression check that grid->details and board->details always show persisted task values.

### Milestone 10 - Charts view + theme toggle + hardening
Deliverables:
- Progress donut, tasks per bucket, tasks per priority, overdue count.
- Chart aggregates computed in frontend from plan detail response.
- Light theme default + dark mode toggle.
- Final UX hardening pass (including any remaining deletion confirmation polish outside Milestone 9 scope).
- Final pass on validation messages and UX polish.

Verification:
- Manual chart checks against sample data.
- Full test run and coverage report generation.

## 5. Proposed Folder Structure

```text
/
  pom.xml
  src/
    main/
      java/
        com/example/kanbanplanner/
          KanbanPlannerApplication.java
          config/
          controller/
            PlanController.java
            BucketController.java
            TaskController.java
            ViewController.java
          dto/
            request/
            response/
          domain/
            Plan.java
            Bucket.java
            Task.java
            ChecklistItem.java
            Progress.java
            Priority.java
          repository/
            PlannerRepository.java
            json/
              JsonPlannerRepository.java
              StorageDocument.java
          service/
            PlanService.java
            BucketService.java
            TaskService.java
          validation/
          error/
      resources/
        static/
          index.html
          css/
            app.css
          js/
            app.js
            api.js
            state.js
            views/
              board.js
              grid.js
              charts.js
              details-panel.js
        application.properties
        data/
          seed-data.json
    test/
      java/
        com/example/kanbanplanner/
          repository/
          service/
          controller/
  data/
    planner-data.json
```

## 6. Proposed REST API Design

Base path: `/api`

### 6.1 Plan endpoints
- `GET /api/plans` -> list plans (for sidebar).
- `POST /api/plans` -> create plan.
- `GET /api/plans/{planId}` -> get full plan data.
- `PUT /api/plans/{planId}` -> update plan metadata.
- `DELETE /api/plans/{planId}` -> cascade delete plan.

### 6.2 Bucket endpoints
- `POST /api/plans/{planId}/buckets` -> create bucket.
- `PUT /api/plans/{planId}/buckets/{bucketId}` -> rename/update bucket.
- `DELETE /api/plans/{planId}/buckets/{bucketId}` -> delete bucket (with fallback behavior).

### 6.3 Task endpoints
- `POST /api/plans/{planId}/tasks` -> create task.
- `PUT /api/plans/{planId}/tasks/{taskId}` -> full update task.
- `PATCH /api/plans/{planId}/tasks/{taskId}` -> partial update (used by drag/drop).
- `DELETE /api/plans/{planId}/tasks/{taskId}` -> delete task.

Note: grid sorting and chart aggregates are computed in frontend code from `GET /api/plans/{planId}` response. No helper endpoints for grid/charts are included.

## 7. Proposed DTO Shapes

### 7.1 Plan summary
```json
{
  "id": "pln_001",
  "name": "Semester Tasks"
}
```

### 7.2 Plan detail
```json
{
  "id": "pln_001",
  "name": "Semester Tasks",
  "buckets": [
    { "id": "bkt_001", "name": "To Do" }
  ],
  "tasks": [
    {
      "id": "tsk_001",
      "title": "Draft report",
      "bucketId": "bkt_001",
      "progress": "Not started",
      "priority": "Important",
      "startDate": "2026-09-28",
      "dueDate": "2026-10-03",
      "notes": "First draft",
      "checklist": [
        { "id": "chk_001", "text": "Outline", "completed": false }
      ]
    }
  ]
}
```

### 7.3 Error response
```json
{
  "code": "VALIDATION_ERROR",
  "message": "Validation failed",
  "details": [
    { "field": "title", "reason": "must be between 1 and 120 characters" }
  ]
}
```

## 8. JSON Storage and Repository Interface Design

### 8.1 Repository abstraction (proposal)
Use one aggregate repository for simplicity in local file mode:

- `List<PlanSummary> findAllPlans()`
- `Optional<Plan> findPlanById(String planId)`
- `Plan savePlan(Plan plan)`
- `void deletePlan(String planId)`
- `Bucket saveBucket(String planId, Bucket bucket)`
- `void deleteBucket(String planId, String bucketId)`
- `Task saveTask(String planId, Task task)`
- `void deleteTask(String planId, String taskId)`

Database migration path:
- Keep interface stable.
- Add `DatabasePlannerRepository` implementing the same interface.
- Switch implementation using Spring profile/config.

### 8.2 JSON document shape (proposal)
```json
{
  "plans": [
    {
      "id": "pln_001",
      "name": "Semester Tasks",
      "buckets": [
        { "id": "bkt_001", "name": "To Do" },
        { "id": "bkt_002", "name": "Uncategorized" }
      ],
      "tasks": [
        {
          "id": "tsk_001",
          "title": "Draft report",
          "bucketId": "bkt_001",
          "progress": "Not started",
          "priority": "Important",
          "startDate": "2026-09-28",
          "dueDate": "2026-10-03",
          "notes": "First draft",
          "checklist": [
            { "id": "chk_001", "text": "Outline", "completed": false }
          ]
        }
      ]
    }
  ]
}
```

### 8.3 File handling strategy (proposal)
- Read full JSON into memory on each mutating request, apply change, write full file atomically.
- Use temporary file + replace to reduce corruption risk.
- Seed data is loaded from `src/main/resources/data/seed-data.json` as read-only baseline.
- Runtime data writes go to `./data/planner-data.json` by default.
- Runtime path is configurable in `application.properties`.
- Keep `/data/` in `.gitignore`.

## 9. Business Rule Mapping to Backend
- Bucket delete with tasks -> ensure fallback bucket exists, reassign tasks, then delete bucket.
- Attempt to delete non-empty `Uncategorized` -> reject with clear validation error.
- Empty `Uncategorized` -> allow delete.
- Plan delete -> remove plan aggregate directly.
- New plan creation -> auto-create buckets `To Do`, `Doing`, `Done`.
- Checklist updates -> do not derive progress changes.
- Overdue -> computed from dueDate and progress against local date.
- Drag/drop patch -> allow updates only to `bucketId` or `progress` based on request usage.
- Board column ordering -> no manual order, always uses grid default sort order.
- Bucket uniqueness -> case-insensitive compare among bucket names in same plan.
- Plan name validation -> required, trimmed, 1-60 chars.
- Date rule -> reject when startDate > dueDate.

## 10. Test Plan (Including Boundary Cases)

### 10.1 Unit tests - validation and rules
- Plan name boundaries: length 0, 1, 60, 61.
- Title boundaries: length 0, 1, 120, 121.
- Bucket name boundaries: length 0, 1, 60, 61.
- Checklist item boundaries: length 0, 1, 120, 121.
- Enum validation for progress/priority invalid values.
- Date consistency: start before due, same day, start after due.
- Case-insensitive bucket uniqueness (`Todo` vs `todo`).

### 10.2 Service tests - workflow rules
- Delete non-empty bucket -> tasks reassigned to `Uncategorized`.
- Delete bucket when `Uncategorized` missing -> auto-create fallback.
- Delete non-empty `Uncategorized` -> rejected with clear validation error.
- Delete empty `Uncategorized` -> succeeds.
- Delete plan -> all nested data removed.
- Create plan -> default buckets `To Do`, `Doing`, `Done` exist.
- Checklist completion toggles do not affect progress.
- Overdue computation matrix:
  - no due date,
  - due today,
  - due yesterday + not completed,
  - due yesterday + completed.

### 10.3 Repository tests - JSON persistence
- Save/read round-trip for plan with nested buckets/tasks/checklist.
- Multiple sequential updates preserve unrelated fields.
- Missing data file initializes sample seed data.
- Atomic write behavior (simulate interrupted write where feasible).

### 10.4 Controller/integration tests
- CRUD endpoints success cases.
- Validation failures return structured error response.
- Drag/drop patch updates only requested grouping field.
- Plan create/update with invalid name length returns validation error.

### 10.5 Coverage reporting
- Configure JaCoCo Maven plugin.
- Generate report via `mvn test jacoco:report`.
- Track rule-heavy service classes for high coverage.

### 10.6 Frontend behavior tests (manual)
- Deletion confirmation dialogs appear for plan, bucket, task, and checklist item.
- Grid default sort comparator and board column card ordering produce matching order.
- Grid sorting and chart aggregates are computed from plan detail API response data.
- Milestone 9.5 UI checks:
  - Sidebar collapse and `+ New plan` reveal flow work.
  - Board/Grid/Charts tabs show one panel at a time.
  - Task drawer opens/closes via all defined triggers.
  - Board add-bucket and bucket menu actions preserve bucket business rules.
  - Details drawer fields always match saved values when opened.

## 11. Non-goals in Current Build
Do not implement detailed designs for:
- calendar view,
- tags/labels,
- filters,
- multi-user/accounts,
- attachments/comments,
- AI features,
- Git integrations,
- CI/CD,
- notifications,
- database persistence.

These remain future extensions only.

## 12. Progress
- Milestone 1 - Completed
- Milestone 2 - Completed
- Milestone 3 - Completed
- Milestone 4 - Completed
- Milestone 5 - Completed
- Milestone 6 - Completed
- Milestone 7 - Completed
- Milestone 8 - Completed
- Milestone 9 - Completed
- Milestone 9.5 - Completed
- Milestone 10 - Not started
