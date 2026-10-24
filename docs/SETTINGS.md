# Settings experience

ProjectA2 treats settings as part of the product, not a graveyard of controls. Every visible control has a real effect, a sane default, and a tested persistence path.

## Information architecture

Settings stays a single page with deep links (`/settings#appearance`) and a sticky section list. The sidebar is grouped into **You**, **Workspace**, and **Data**.

### You

| Section | Controls |
|---|---|
| **Account** | Display name, account status, security entry points |
| **Appearance** | Theme (System / Light / Dark), accent (Moss / Ink / Clay), display type (Editorial / Modern / Classic), reading size, density, motion, live preview |
| **Language & region** | Language (English / 繁體中文 preview), time zone, time format, week start, localized date preview |
| **Planning** | Daily capacity, Smart Plan buffer, workday window, buffer between Day Flow blocks, default view |
| **Focus & capture** | Default focus length, auto-start, close capture after adding |
| **Notifications** | In-app, mentions, email reminders, browser reminders, digest, quiet hours, test notification |
| **Sound** | Master toggle, palettes, volume, typing texture, six previews (device-local) |
| **Keyboard** | Single-key shortcuts (device-local) |
| **Features** | Day Flow, Smart Plan, and voice capture toggles |
| **Security** | MFA, sessions, account controls |

### Workspace and Data

Workspace settings, people, policies, automations, integrations, audit, export, and account deletion remain available behind the same role checks. Enterprise controls only appear where the workspace type and role allow them.

## Behavior worth knowing

- **Autosave** writes through a queue. Rapid changes are merged instead of dropped, and `keepalive` keeps a save alive if the page is navigating.
- **Optimistic UI** applies the change immediately. A failed save shows `Could not save`, rolls the document back, and re-reads the server state.
- **Restore defaults** is scoped to the section and offers Undo in the toast.
- **Theme System** follows `prefers-color-scheme` live; the stored preference stays `system`.
- **Theme, accent, display type, reading size, density, and motion** are applied to `<html>` data attributes so the whole app changes without a reload.
- **Language** updates the app shell, Today, the planning surfaces, capture, and Settings. Workspace admin and audit remain English during this preview.
- **Sound preferences** are device-local; account preferences are stored in `UserSettings` and survive reload and browsers.
- **Background reminders** require browser notification permission. The OS owns the sound; Drift never plays a hidden-tab chime.
- **Browser notification permission** is displayed honestly as default, granted, or blocked. `Send test` is manual.

## Language and type notes

- The Traditional Chinese font stack prefers `Noto Sans TC`, `Microsoft JhengHei`, and `PingFang TC` for UI, with serif fallbacks for display headings.
- No web fonts are downloaded. Type choices use system stacks, so the app stays fast and offline-friendly.
- Reading size is a real typographic change, not a zoom hack. It targets reading surfaces while browser zoom remains available for everything else.
- Display type changes the voice of headings and preview samples; body copy keeps the interface face.

## Accessibility

- Every theme card, swatch, font card, segmented control, and toggle has an accessible name and pressed state.
- The settings search is keyboard reachable; Enter jumps to the first matching section and Escape clears the query.
- Mobile uses a section picker rather than a 20-item horizontal scroll.
- Axe serious/critical is checked across Today, Board, Insights, Settings sections, and auth.
- Reduced motion can be forced by preference or inherited from the OS.

## Verification

- `npm test`: 90 unit tests.
- Playwright: 26 journeys across Chromium, Firefox, and WebKit (78 executions).
- The settings journey checks appearance, theme system, density/reading size, capacity, week start, language, notification queueing, feature toggles, focus/capture defaults, workday/buffer/start view, save failure rollback, search, and mobile navigation.
- Production build and strict TypeScript pass.
