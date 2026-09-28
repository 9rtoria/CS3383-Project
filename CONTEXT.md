# Kanban Planner - Context

## Scope of this document
This file captures what is confirmed in this session and what is still proposed (inferred) for implementation.

## Confirmed project idea
- Build a single-user task planner web app inspired by Microsoft Planner, with its own visual style.
- Working name: `Kanban Planner` (placeholder; easy to rename later).

## Confirmed technology and runtime decisions
- Frontend: plain `HTML`, `CSS`, and `JavaScript` (no frameworks, no CDN libraries).
- Backend: Java Spring Boot (Maven) REST API that also serves frontend assets.
- Storage: local JSON file behind a repository interface so a database can later be added as a new implementation class.
- Storage paths:
  - Seed data file: `src/main/resources/data/seed-data.json` (read-only).
  - Runtime data file: `./data/planner-data.json` in project root.
  - Runtime path is configurable in `application.properties`.
- Java compilation target: Maven `release 17` for teammate compatibility.
- Dependency compatibility: choose Spring Boot and JaCoCo versions that run on both JDK 17 and detected JDK 25.
- Users: single user only; no login/accounts.
- Runtime mode: local/offline; no internet dependency, no paid APIs, no real email.
- Data seed: sample data only.
- Testing: backend tests with JUnit 5; coverage report required.

## Confirmed local environment facts (detected)
- Java: `25.0.2` (LTS)
- Maven: `3.9.12`
- Git: `2.45.1.windows.1`

## Confirmed product capabilities
- Multiple plans listed in a sidebar.
- Task fields: title, bucket, progress, priority, start date, due date, notes, checklist.
- Core actions: create/edit/delete plans, buckets, and tasks; open a task details panel.
- Frontend shows a confirmation dialog before deleting a plan, bucket, task, or checklist item.
- Board view: group by bucket or by progress, with a switcher; drag-and-drop moves a task.
- Grid view: sortable table; clicking a row opens task details.
- Charts view: progress donut, tasks per bucket, tasks per priority, overdue count (plain JavaScript SVG/Canvas).
- Theme: light by default with dark mode toggle.

## Confirmed business rules from grilling
1. Deleting a non-empty non-`Uncategorized` bucket moves its tasks to auto-created `Uncategorized`, then deletes the bucket.
2. Deleting a plan cascades permanently to all contained buckets/tasks/checklist items.
3. Checklist completion does not auto-change task progress; progress is user-controlled.
4. Overdue rule: task is overdue when due date exists, progress is not `Completed`, and `dueDate < today` (local date-only).
5. Drag-and-drop updates only the current board grouping field:
   - Group by bucket -> update bucket only.
   - Group by progress -> update progress only.
6. No manual card ordering within a board column; cards follow the grid default sort order.
7. Task validation:
   - `title`: required, trimmed, 1-120 chars.
   - `bucket`: required and must exist in the same plan.
   - `progress`: required enum (`Not started`, `In progress`, `Completed`).
   - `priority`: required enum (`Urgent`, `Important`, `Medium`, `Low`).
   - `startDate`, `dueDate`, `notes`: optional.
   - `checklist`: optional; each item text required, 1-120 chars.
8. Date consistency: if both dates are set, `startDate <= dueDate` (same day allowed).
9. Grid default sort: `dueDate` ascending, no-due-date tasks last, tie-breaker title A-Z.
10. Bucket names: required, trimmed, 1-60 chars, unique within a plan (case-insensitive).
11. Plan name: required, trimmed, 1-60 chars.
12. `Uncategorized` behavior:
   - Auto-created when needed as fallback target.
   - If it contains tasks, deleting it is blocked with a clear validation error.
   - If it is empty, it can be deleted.
13. New plan default buckets: `To Do`, `Doing`, `Done`.
14. Grid sorting and chart aggregates are computed in frontend from plan detail response; no helper API endpoints for these views.

## Confirmed out of scope (future only)
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
- Database.

## Proposed (inferred) items
- API path naming, DTO shape, dependency version choices, and exact frontend file layout are defined in `docs/design/implementation-plan.md` as proposals for execution.
