# Five-minute demo — ProjectA2

- **Audience:** evaluator, teacher, or design partner
- **Setup:** `npm run setup -- --seed && npm run build && npm run start` (or `npm run dev`)
- **Open:** <http://localhost:3000>
- **Demo account:** `demo@drift.local` / `DriftDemo123!`

The point is not “look at all the features”. It is: **a calm planner can make the day visible, help choose a realistic plan, protect attention, and get out of the way — with honest labels where the intelligence is local.**

The new work is in Day Flow, Smart Plan, Focus Mode, Settings, the Sound Lab, and voice capture. The baseline product is still underneath: guest capture, keyboard movement, boards, search, Insights, sharing, offline, and team controls.

## 0:00–0:30 — Start with the shape of the day

1. Sign in as the demo account and open **Today**.
2. Point at **Day Flow**: the 24-hour rail, the “now” line, solid chosen blocks, dashed suggestions, and the capacity ring (`4h 45m of 5h` after the seed).
3. Hover a block and point at **Focus next** in the list below.

**What to notice:** this is the signature moment. It is not another list — it shows when the chosen work will actually happen. The rail's anchor is stable when Today opens; only the “now” marker moves.

## 0:30–1:20 — Smart Plan: preview, apply, undo

1. Click **Smart Plan**.
2. Read the modal aloud: **“Preview first — local rules only”**, Before/After counts, added/waiting chips, and the capacity numbers.
3. Say: “No model is connected. This is deterministic local rules over priority, due date, estimate, dependencies, and remaining capacity. It is labeled Smart Plan, not AI.”
4. Click **Apply this plan**. Show the new blocks breathing into Day Flow.
5. Click **Undo** in the toast. Show the previous plan return.

**What to notice:** nothing changes until Apply, the diff is legible, and the write is reversible. This is the AI-assisted design story without pretending a model exists.

## 1:20–2:00 — Focus Mode and honest time

1. Click **Focus next** on the first block (or **Focus** in the task drawer).
2. Point at the breathing orb, the estimate (`of 2h estimated`), and the privacy line.
3. Click **Begin focus**. Let it run for a few seconds, then **Pause** and **Resume**.
4. Click **Complete task** (or **Log time and leave** after a short run).
5. Open the task drawer and show **Tracked time** / `actualMinutes`.

**What to notice:** completion writes tracked minutes separately from the estimate. The done state compares actual and estimated time; it does not invent a productivity score. Leaving early still records honest time without completing the task.

## 2:00–2:40 — Settings that actually change the product

1. Go to **Settings → Appearance**.
2. Point at the live preview. Switch between **System / Light / Dark**, try the **Ink** accent, switch display type to **Modern**, and choose **Large** reading text. Set density to **Compact** and motion to **Reduced**.
3. Go to **Language & region**, switch to **繁體中文**, and show the settings labels and Today copy change. Switch back to English.
4. Go to **Planning**, change daily capacity, add a **20% plan buffer**, set a workday window, and add a 10-minute buffer between Day Flow blocks.
5. Go to **Notifications** and show the email reminder, browser permission, quiet hours, and **Send test**. Say: “Background reminders are permission-gated; the OS owns the sound.”
6. Use **Restore defaults** on one section and **Undo** from the toast.

**What to notice:** every control has a visible effect. Theme, accent, type, reading size, density, motion, capacity, week start, workday, plan buffer, focus defaults, notification channels, sound, keyboard, and feature toggles are backed by real preferences. Rapid changes are queued, not dropped.

## 2:40–3:10 — Sound Lab, not notification noise

1. Go to **Settings → Sound**.
2. Play two or three previews. Switch between **Paper & wood**, **Felt & glass**, and **Hybrid**.
3. Point at the defaults: enabled, volume `0.32`, **typing texture off**.
4. Use the top-bar volume button to mute and unmute.
5. Say: “Shortcuts are throttled. There is no every-keystroke sound unless you explicitly turn it on. Everything is synthesized locally with Web Audio; no samples or network audio.”

**What to notice:** the sound is material and quiet, not an alarm. Reminders use an in-app chime while the app is visible; backgrounded tabs use a browser notification after permission, and the operating system decides whether to play its notification sound.

## 3:10–3:40 — Voice capture with a real fallback

1. Press `C` to open **Quick Capture**.
2. Click **Speak a task**. If the browser supports speech, say: “Draft voice note tomorrow 20 minutes.”
3. Edit the transcript in the text field. Point at the disclosure: the browser's speech service is used.
4. If permission is denied or speech is unavailable, type the same task and add it. The text path never disappears.
5. Press **Add task**.

**What to notice:** voice is a shortcut, not the only highlight. The transcript is editable, and the normal text field remains the reliable path.

## 3:40–4:10 — The baseline is still real

1. Open a private window for **guest capture**: type `Draft launch narrative tomorrow 9am high 45m #launch`, press Enter. No signup, no tour.
2. In **My tasks**, focus a card and press `Alt+ArrowRight`; click **Undo** in the toast.
3. Press `/` and search `launch`; press `Ctrl+K` and open **Insights**.
4. Say: “The new experience sits on a real anonymous workspace, real boards, version-checked moves, and an audit trail — not a clickable overlay.”

**What to notice:** the experimental layer did not break the keyboard-first product underneath.

## 4:10–4:40 — One boundary, one honest ending

1. Switch to the team workspace and show **Members / Roles / Audit**.
2. Switch back to the personal workspace; the enterprise chrome disappears.
3. Close on the boundary: “Smart Plan is local rules, voice uses the browser's speech service, and this remains a SQLite-backed school demo. The baseline review lists the production gaps.”

## Demo guardrails

- Do **not** call Smart Plan AI, a model, or a recommendation engine that learns. It is local deterministic rules.
- Do **not** claim voice recognition is on-device. It uses the browser's speech service.
- Do **not** claim the language preview covers every admin/enterprise string. It covers the app shell, Today, planning, capture, and Settings.
- Do **not** claim the sound was professionally mastered or tested on every speaker/headphone. It was designed for audition in the Sound Lab.
- Do **not** claim Docker, live OAuth/SSO, malware scanning, or a 10k-user load test was verified. Those remain unverified in the baseline review.
- If the demo DB is dirty, reset it with `npm run db:seed` (demo account only). Use `localhost`, not `127.0.0.1`, so the session cookie matches `APP_URL`.
- Keep the browser at 100% zoom for screenshots.

## Backup demo

Use the screenshots in `docs/screenshots/` and the evidence in [`A2_EXPERIMENT.md`](A2_EXPERIMENT.md). The A2 sequence is:

1. `10-day-flow.png`
2. `11-smart-plan.png`
3. `12-focus-mode.png` / `13-focus-running.png`
4. `18-appearance.png` / `23-dark-appearance.png`
5. `19-language-region.png` / `20-planning.png` / `21-notifications.png`
6. `14-sound-settings.png`
7. `15-voice-capture.png`
8. `16-mobile-today.png` / `17-dark-today.png` / `22-mobile-settings.png`

Be explicit that these are fixtures, not customer data.
