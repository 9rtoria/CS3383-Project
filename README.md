# Project3383

A new implementation of the Drift task planner, built with **Java + Spring Boot + SQLite + plain HTML/CSS/JavaScript**. The existing `ProjectA2` is kept untouched as the reference.

## Current milestone

This is the first runnable vertical slice, not the full parity build yet.

Implemented:

- Spring Boot 3.5 application on port `3383`
- SQLite schema and automatic initialization
- Guest session creation (`POST /api/auth/guest`)
- Bootstrap payload with workspace, board, and columns
- Board read API
- Task create / update / move / soft-delete APIs
- Version-based 409 conflict handling
- Today list with capacity and accept/dismiss actions
- Plain HTML/CSS/JS UI:
  - Today view
  - Board view
  - Task create/edit modal
  - Drag task between columns
  - Delete task
  - Sign out
- JUnit/MockMvc smoke test for guest → task → move → Today

Not implemented yet:

- Password sign-up/sign-in and guest claim
- Multiple workspaces / invites / roles
- Task drawer parity (comments, subtasks, labels, attachments, dependencies, reminders)
- Day Flow / Smart Plan / Auto-plan
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
| DELETE | `/api/auth/signout` | Invalidate the session |
| GET | `/api/health` | Health check |
| GET | `/api/bootstrap` | User/workspace/board bootstrap |
| GET | `/api/boards/{id}` | Board with columns and tasks |
| GET | `/api/today` | Open-task list with capacity |
| POST | `/api/today` | Accept or dismiss a task for today |
| POST | `/api/tasks` | Create a task |
| PATCH | `/api/tasks/{id}` | Update a task with version check |
| PATCH | `/api/tasks/{id}/move` | Move a task to another column |
| DELETE | `/api/tasks/{id}` | Soft-delete a task |

## Guardrails

- Do not modify `ProjectA2`.
- This project is intentionally using plain Java/HTML/CSS/JS rather than Next.js/React/Prisma.
- Add features in phases and keep the parity checklist honest.
