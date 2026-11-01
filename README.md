# Project3383

A new implementation of the Drift task planner, built with **Java + Spring Boot + SQLite + plain HTML/CSS/JavaScript**. The existing `ProjectA2` is kept untouched as the reference.

## Current milestone

This is the first runnable vertical slice, not the full parity build yet.

Implemented:

- Spring Boot 3.5 application on port `3383`
- SQLite schema and automatic initialization
- Guest session creation (`POST /api/auth/guest`)
- Email/password sign-up, sign-in, guest claim, and sign-out
- Bootstrap payload with workspace, board, and columns
- Workspace create/switch, including a new team workspace
- Workspace members, invite links, role changes, and member removal
- Board create/read API
- Task create / update / move / soft-delete APIs
- Task detail API with comments, checklist, labels, dependencies, attachments, completion, and reopen
- Attachment upload/download/delete with local storage, MIME allowlist, and 10 MB limit
- Task start date, all-day due date, and tracked actual minutes
- Version-based 409 conflict handling
- Today list with capacity and accept/dismiss actions
- Plain HTML/CSS/JS UI:
  - Today view
  - Board view
  - Task create/edit modal
  - Drag task between columns
  - Delete task
  - Sign out
- JUnit/MockMvc smoke test for guest ??task ??move ??Today
- Reminders, in-app notifications, and background delivery
- Day Flow, Smart Plan-style preview, and deterministic Auto-plan apply/clear

Not implemented yet:

- Calendar, Search, Archive, Insights
- SSO/MFA/API tokens/Webhooks/Automations
- Offline/PWA, Focus Mode, voice, sound, i18n
- Full visual and behavioral parity with `ProjectA2`

The full phased checklist is at:

`C:\Users\yanpi\.opencode\plan\Project3383-rewrite-checklist.md`

## Run

JDK 17 is required. On this machine the default `java` command points to Java 8, so set `JAVA_HOME` first:

```powershell
$env:JAVA_HOME='C:\Program Files\Eclipse Adoptium\jdk-17.0.17.10-hotspot'
$env:Path="$env:JAVA_HOME\bin;$env:Path"
.\mvnw.cmd spring-boot:run
```

Open <http://localhost:3383>.

Alternative:

```powershell
.\mvnw.cmd -DskipTests package
java -jar target\project3383-0.0.1-SNAPSHOT.jar
```

The database file is created at `data/project3383.db`. Delete it to reset the local demo data.

## Test

```powershell
$env:JAVA_HOME='C:\Program Files\Eclipse Adoptium\jdk-17.0.17.10-hotspot'
$env:Path="$env:JAVA_HOME\bin;$env:Path"
.\mvnw.cmd test
```

## API currently available

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/guest` | Create/resume a guest session |
| POST | `/api/auth/signup` | Create an account or claim the current guest |
| POST | `/api/auth/signin` | Sign in with email/password |
| DELETE | `/api/auth/signout` | Invalidate the session |
| GET | `/api/health` | Health check |
| GET | `/api/bootstrap` | User/workspace/board bootstrap |
| POST | `/api/workspaces` | Create a personal/team workspace |
| GET | `/api/workspaces/{id}/members` | List workspace members |
| POST | `/api/workspaces/{id}/invites` | Create an invite link |
| PATCH | `/api/workspaces/{id}/members/{userId}` | Change a member role |
| DELETE | `/api/workspaces/{id}/members/{userId}` | Remove a member |
| POST | `/api/invites/{token}` | Accept an invitation |
| POST | `/api/boards` | Create a board and its starter columns |
| GET | `/api/boards/{id}` | Board with columns and tasks |
| GET | `/api/today` | Open-task list with capacity and day blocks |
| POST | `/api/today` | Accept or dismiss a task for today |
| POST | `/api/auto-plan` | Preview, apply, or clear the deterministic plan |
| POST | `/api/tasks` | Create a task |
| GET | `/api/tasks/{id}` | Task detail with comments and checklist |
| PATCH | `/api/tasks/{id}` | Update a task with version check |
| PATCH | `/api/tasks/{id}/move` | Move a task to another column |
| POST | `/api/tasks/{id}/complete` | Move a task to the Done column |
| POST | `/api/tasks/{id}/reopen` | Move a task back to the first open column |
| DELETE | `/api/tasks/{id}` | Soft-delete a task |
| POST | `/api/tasks/{id}/comments` | Add a comment |
| POST | `/api/tasks/{id}/subtasks` | Add a checklist item |
| PATCH | `/api/subtasks/{id}` | Update a checklist item |
| POST | `/api/tasks/{id}/attachments` | Upload an attachment |
| GET | `/api/attachments/{id}` | Download an attachment |
| DELETE | `/api/attachments/{id}` | Delete an attachment |
| POST | `/api/tasks/{id}/reminders` | Set a reminder |
| DELETE | `/api/reminders/{id}` | Remove a reminder |
| GET | `/api/notifications` | List in-app notifications |
| PATCH | `/api/notifications/{id}/read` | Mark one notification read |
| PATCH | `/api/notifications/read-all` | Mark all notifications read |

## Guardrails

- Do not modify `ProjectA2`.
- This project is intentionally using plain Java/HTML/CSS/JS rather than Next.js/React/Prisma.
- Add features in phases and keep the parity checklist honest.
