# AGENTS

- Project: **Kanban Planner**. Single-user task planner, local/offline only.
- Before any planning or coding, always read:
  - `CONTEXT.md`
  - `docs/requirements/final-requirements.md`
  - `docs/design/implementation-plan.md`
- Tech rules:
  - Frontend: plain `HTML`/`CSS`/`JavaScript` only (no frameworks, no CDN libs).
  - Backend: Spring Boot + Maven.
  - Java target: Maven `release 17`.
  - Storage: JSON behind `PlannerRepository` abstraction.
  - Testing: `JUnit 5` with `JaCoCo` coverage.
- Work rules:
  - Build one milestone at a time.
  - Do **not** implement anything under Future Extensions.
  - Do **not** invent requirements.
  - Run `mvn test` after every change.
  - When a milestone is completed, update the Progress section in `docs/design/implementation-plan.md`.
  - Do not write application code until explicitly requested.
