# ProjectA2 — experimental Drift extension

**Date:** 2026-10-24  
**Status:** working school-demo prototype, built as an independent clone of `ProjectA`  
**Baseline:** `ProjectA` stays at `6876db1` and is not modified by this work.

ProjectA2 keeps Drift's calm, keyboard-first identity and adds a focused set of experiential features around planning, attention, sound, and capture. The goal is not to turn Drift into a different product. The goal is to make the existing promise — *one small next step* — feel more tangible, without adding a second product's gimmicks.

## What changed

| Area | What a visitor sees | Why it exists |
|---|---|---|
| **Day Flow** | A 24-hour rail showing the chosen work as blocks, a “now” marker, capacity ring, focus-next action, and a Later shelf | Makes the day's shape visible before the task list; gives the demo one memorable signature moment |
| **Smart Plan** | A local-rules preview with Before/After columns, added/waiting counts, plan buffer, apply, toast, and Undo | Shows AI-assisted *design thinking* without pretending a model is connected; nothing changes until Apply |
| **Focus Mode** | A full-screen, quiet timer with a breathing orb, pause/complete/log-time controls, estimate delta, default length, and auto-start | Gives the plan a second act and turns tracked time into a first-class, honest record |
| **Settings** | Theme System/Light/Dark, accent, display type, reading size, density, motion, language/region preview, capacity, workday, plan buffer, notifications, sound, keyboard, feature toggles, search, live preview, section reset | Makes every preference real and keeps the calm product configurable without a control-panel feel |
| **Sound Lab** | Three synthesized palettes (Paper & wood, Felt & glass, Hybrid), volume, mute, previews, and optional typing texture | Adds materiality and feedback without alarm beeps, network downloads, or every-keystroke noise |
| **Voice Capture** | Web Speech API input with a listening state, editable transcript, permission/error fallbacks, and a normal text field | Makes capture feel immediate while keeping typing as the reliable path |

### Day Flow

- The rail is laid out from a stable anchor when Today opens. The “now” marker updates, but blocks do not slide down the rail while the user is looking at them.
- Selected work is laid out from the anchor using the task's suggested or estimated duration. Due times push a block later when they are still ahead.
- A block can be dragged to **Later**, which clears `focusDate` for today and records a `TodayDismissal` — the task is not completed.
- Accepted tasks also have a **Later** action in the list below, so touch and keyboard users are not forced to drag.
- The capacity ring reads `selectedMinutes / capacityMinutes`; the rail shows chosen blocks as solid and suggestions as dashed.
- On narrow screens the rail scrolls horizontally and starts centered on the current block, so the first view is not an empty morning.

### Smart Plan

Smart Plan is deliberately **not** labeled AI. It is deterministic local rules:

- priority, due date, estimate, dependency state, and remaining capacity are weighted locally;
- the preview shows the current accepted plan (Before) and the proposed plan (After);
- **Apply this plan** is the only write;
- a toast offers **Undo**, which restores the previous set of `focusDate` values;
- no task text, prompt, or audio is sent to an external model.

The UI states “Preview first — local rules only” and “No model call” in the preview. This is the honest version of the feature when no AI model is connected.

### Focus Mode

- Opens from Day Flow's **Focus next**, the task list, or the task drawer.
- The timer counts up; pause/resume and complete are keyboard reachable.
- Completing writes `actualMinutes` to the task, increments the version, logs activity, and marks the task complete.
- Leaving early writes tracked minutes without completing the task.
- `actualMinutes` is separate from `estimateMinutes`, appears in the task drawer, and is included in JSON/CSV export.
- The done state compares actual and estimated minutes rather than claiming a productivity score.

### Sound

- Web Audio synthesis only; no samples, network request, or downloaded audio.
- Three palettes:
  - **Paper & wood** — short, dry, close to the desk.
  - **Felt & glass** — warmer and slightly more melodic.
  - **Hybrid** — a paper transient with a soft tone. This is the default.
- Default state: enabled, volume `0.32`, typing texture **off**.
- The top-bar volume button and Settings → Sound both mute/unmute. Settings has six previews (capture, complete, reminder, move, error, focus).
- Shortcut taps are throttled; typing texture is the only per-key option and stays off by default.
- Reminders use an in-app chime while the app is visible. If the user allows browser notifications in Notifications, a hidden tab posts a browser notification and lets the operating system decide whether to play its notification sound; the app never tries to play audio from a hidden tab.

### Voice Capture

- Uses the browser's `SpeechRecognition`/`webkitSpeechRecognition` when available.
- The transcript is appended to the normal text field and can be edited before saving.
- Permission denial, unsupported browsers, no-speech, and start failures all keep the text fallback available.
- The hint explicitly says the browser's speech service is used, so the demo does not imply on-device recognition.
- Voice is a shortcut, not the only way to capture. The text field remains the primary reliable path.

### Settings

- Preferences are stored in `UserSettings`, applied optimistically, and saved through a merge queue with rollback on failure.
- Theme, accent, display type, reading size, density, and motion are real document-level changes, not static mock controls.
- Dates and times follow the **app language**, not the operating system. An English UI on a Traditional Chinese machine stays English instead of showing `10月24日星期六` beside English labels.
- The Done column count includes completed cards; other columns keep their open-task count for WIP visibility.
- Language is a core-surface preview: app shell, Today, planning, capture, and Settings; workspace admin remains English.

## Verification

Run against the seeded demo workspace on `http://localhost:3000`.

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run lint` | Pass, 0 errors, 40 warnings (baseline warnings) |
| `npm test` | **91/91** in 13 files |
| `npm run build` | Pass |
| Playwright | **27/27 journeys × 3 engines = 81 executions** (12 baseline + 15 A2/settings) |
| axe serious/critical | 0 on Today, Board, Insights, all checked Settings sections, auth |
| Responsive | 390 px Today and mobile Settings checked |
| Dark theme | Today and Settings checked |
| Reduced motion | Global reduced-motion rule and explicit preference checked |
| Screenshots | 14 A2 states in `docs/screenshots/10-*` through `23-*` |

New automated journeys cover:

1. Voice capture with a fake browser speech recognizer, transcript editing, text fallback, and the top-bar mute toggle.
2. Smart Plan preview, apply, and Undo.
3. Focus Mode start, complete, and persisted `actualMinutes`.
4. Dragging a Day Flow block to Later.
5. Appearance controls change document attributes and persist, including real density/reading-size effects.
6. System theme follows `prefers-color-scheme` while keeping the stored preference.
7. Capacity and week start reach Today and Calendar.
8. Language changes core chrome and persists, then returns English.
9. Rapid notification changes are queued and persisted.
10. Feature toggles remove Day Flow/voice without hiding text capture.
11. Focus/capture defaults reach the real screens and save failure rolls back; search and mobile settings navigation work.

The sound timbres were designed for audition, not judged by automation. Use Settings → Sound on laptop speakers and headphones; the palettes are intentionally short and quiet, and the typing texture is off by default.

## Deliberate limits

- Smart Plan is deterministic and local. It is not a language model and does not learn.
- Voice recognition depends on the browser's speech service; availability and language support vary.
- Sound is synthesized and tunable, but this is a prototype, not a mastered audio brand.
- `actualMinutes` is a simple accumulated integer; there is no time-entry ledger or edit history yet.
- Day Flow is a single-day view; it does not yet support manual block resizing or multi-day planning.
- The demo remains SQLite-backed and is not a production-scale deployment.
- The browser-notification permission path for background reminders is implemented and permission-gated, but it is not covered by an automated test; the operating system still decides whether to play a sound.
- No claim is made that the sound or voice paths were tested with every browser, microphone, or audio device.

## Where to look

- `components/day-flow.tsx` — rail, stable anchor, drag-to-Later, focus-next.
- `components/smart-plan.tsx` — preview modal and plan diff.
- `components/focus-mode.tsx` — timer, completion, time logging.
- `components/quick-capture.tsx` — voice input and fallbacks.
- `lib/sound.ts` — Web Audio synthesis, palettes, preferences, throttling.
- `components/sound-settings.tsx` — Sound Lab and previews.
- `components/today-view.tsx` — capacity, plan apply/undo, dismissal.
- `app/api/today/route.ts` — `applyPlan`, accept/dismiss, board-access checks.
- `prisma/migrations/20261024140000_task_actual_minutes/` — tracked-time field.

For the demo script, see [DEMO.md](DEMO.md). For the baseline product review, see [`../REVIEW.md`](../REVIEW.md).
