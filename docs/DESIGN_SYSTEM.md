# Design System

**Product:** Drift  
**Theme:** warm editorial calm, deep green accent, content-first density  
**Implementation:** CSS custom properties + Tailwind CSS 4 utilities + first-party primitives

## 1. Design intent

Drift should feel like a well-made paper planner that happens to be software: warm neutrals, generous type, restrained color, and almost no chrome. The board is the visual anchor; Today is the editorial page. Enterprise controls never appear unless the workspace is a team/org and the viewer is an admin.

Three rules drive decisions:

1. **Content over container.** Borders and spacing do the structural work; shadows are rare.
2. **One accent.** Green marks action and selection. Priority/status use semantic tints, not decoration.
3. **Quiet motion.** Movement explains state; it never delays the user.

## 2. Color tokens

### Light

| Token | Value | Use |
|---|---|---|
| `--bg` | `#f5f4ef` | App canvas |
| `--bg-deep` | `#eeece5` | Recessed areas |
| `--surface` | `#fffefa` | Cards, panels |
| `--surface-raised` | `#ffffff` | Dialogs, menus |
| `--surface-2` | `#f0efe9` | Hover, column wells |
| `--surface-3` | `#e8e6de` | Pressed/selected subtle |
| `--text` | `#212723` | Primary text |
| `--text-soft` | `#4b544e` | Secondary text |
| `--muted` | `#565d56` | Metadata (contrast-corrected) |
| `--faint` | `#626962` | Least emphasis, still AA on canvas |
| `--border` | `#e2e0d7` | Default border |
| `--border-strong` | `#cfcdc2` | Hover/focus border |
| `--accent` | `#2f6b56` | Primary action, active nav |
| `--accent-strong` | `#21513f` | Hover/pressed |
| `--accent-soft` | `#e4efe9` | Selected chips |
| `--danger` | `#b3443e` | Destructive/error |
| `--warning` | `#98601a` | Due/attention |
| `--info` | `#32658f` | Informational |
| `--violet` | `#6f5c9a` | Label accent |

### Dark

| Token | Value | Use |
|---|---|---|
| `--bg` | `#141815` | Canvas |
| `--surface` | `#1b211d` | Cards |
| `--surface-raised` | `#212822` | Dialogs |
| `--text` | `#edf2ed` | Primary |
| `--muted` | `#98a29a` | Metadata |
| `--faint` | `#8a948c` | Least emphasis |
| `--border` | `#303830` | Border |
| `--accent` | `#7fc3a5` | Primary action (light green) |
| `--accent-strong` | `#a1d9bf` | Hover |

The theme follows `prefers-color-scheme` until the user chooses light/dark/system in Settings. The choice is stored in `localStorage` and `UserSettings`; `data-theme` on `<html>` avoids a flash.

### Contrast

- Body text `--text` on `--bg`: well above 7:1.
- Metadata `--muted` on `--bg`: ≥ 4.5:1.
- `--faint` was darkened from an earlier value to meet AA for small text.
- Primary buttons use white on `--accent` (light) or dark ink on light green (dark).
- Focus rings are 3 px accent-tinted and visible on both themes.
- Forced-colors mode adds `CanvasText` borders and a `Highlight` fill.

## 3. Typography

| Role | Family | Size / line | Weight |
|---|---|---|---|
| Display / page title | Iowan Old Style, Palatino, Georgia (serif) | `clamp(30px, 3.2vw, 42px)` / 1.05, -1.2px tracking | 550 |
| Section title | UI family | 15–18 px / 1.3 | 650 |
| Body | Segoe UI Variable / system UI | 14 px / 1.5 | 400 |
| Metadata | UI family | 11–12.5 px / 1.35 | 500–600 |
| Monospace | System mono | 12–13 px | 400 |

The serif display is used sparingly: page titles, auth headlines, public share. It gives the product an editorial voice without slowing scanning. Task titles and controls stay in the UI family.

## 4. Spacing and layout

- Base unit: **4 px**; common steps 4, 8, 12, 16, 20, 24, 32, 40.
- 8 px grid for component padding; 12 px card radius; 18 px large radius.
- Sidebar: 246 px fixed on desktop; collapses to icon rail under 1100 px; bottom nav under 760 px.
- Content max width: 1400 px for boards, 980 px for settings/auth, 760 px for reading.
- Board columns: 262–300 px, horizontal scroll with visible edges; no nested scroll traps.
- Card padding: 12–14 px; card gap: 8–10 px.
- Settings rows: label column + control column, stacked under 720 px.

## 5. Elevation and shape

| Token | Use |
|---|---|
| `--shadow-sm` | Buttons, subtle card lift |
| `--shadow-md` | Menus, popovers, hovered cards |
| `--shadow-lg` | Modal/drawer |
| `--radius-sm` | Inputs, buttons, chips (8 px) |
| `--radius` | Cards, columns (12 px) |
| `--radius-lg` | Dialogs, large panels (18 px) |

Borders are preferred over shadows for structure. Hover lift is 1 px, not a bounce.

## 6. Components

### Buttons
- Height 36 px (small 28–30 px); 7×13 px padding; 8 px radius.
- Variants: default (surface), primary (accent), ghost (transparent), danger.
- Disabled opacity 0.48; active translates 1 px; focus ring always visible.
- Icon-only buttons require an accessible name; 28 px minimum target in dense rows.

### Inputs
- 36–38 px height; 1 px border; 8 px radius; focus ring; inline error text with `aria-describedby`.
- Labels are always visible except search/palette, which use a visually hidden label.
- Selects use native elements for platform accessibility.

### Cards
- Task card: priority/labels top line, title, optional description (2-line clamp), metadata footer.
- Draggable cards are `role="button"`, `tabIndex=0`, and describe keyboard movement via `aria-describedby`.
- Selected card uses accent border and soft tint; dragging reduces opacity and shows a drop target.

### Columns
- Header is an `h2` (fixing heading order under the board `h1`); count and WIP badge are inline.
- Column well uses `--surface-2`; drop target uses a dashed accent border.
- Add-task affordance is a 28 px icon button with an explicit label.

### Dialogs and drawer
- Native `<dialog>` for capture, palette, shortcuts, board dialogs; custom drawer for tasks.
- Focus is moved in, trapped, and restored; Escape closes; backdrop click closes non-destructive dialogs.
- The drawer is a right-side panel on desktop and a full-height sheet on mobile.
- Destructive confirmation requires an explicit verb, not just “OK”.

### Menus and toasts
- Menus use a trigger + popover with roving focus and Escape.
- Toasts are `role="status"` (polite) or `role="alert"` for errors; undo is a real button, not a link.
- Toasts stack bottom-right on desktop, above the bottom nav on mobile.

### Data display
- Capacity bar: selected vs total, percent, overbooked label; numbers are always paired with units.
- Badges: priority, status, WIP, role; color plus text, never color alone.
- Avatars: initials fallback with an accessible name; decorative when the name is adjacent.

## 7. Iconography

Lucide icons at 13–18 px, 1.5–1.75 px stroke. Icons are decorative when paired with text (`aria-hidden`); icon-only controls carry a label. No emoji as functional iconography.

## 8. Responsive behavior

| Breakpoint | Layout |
|---|---|
| ≥ 1280 px | Sidebar + board + drawer overlay |
| 1100–1279 px | Sidebar narrows; board remains horizontal |
| 760–1099 px | Icon rail; page actions wrap; drawer full-width |
| < 760 px | Bottom nav (Today, Upcoming, Capture, Search, More); board columns snap-scroll; settings single column |
| < 420 px | Reduced page title, stacked filters, full-width dialogs |

Touch targets are at least 44 px for primary mobile actions; dense desktop controls may be 28–36 px but retain spacing.

## 9. Content and voice

- Short, concrete verbs: “Add task”, “Move to Done”, “Save changes”.
- No fake urgency or gamification.
- Empty states say what to do next, not just “No data”.
- Errors state what happened and the next action; they do not blame the user.
- “Assist” labels deterministic suggestions; never call them “AI magic”.

## 10. Accessibility rules baked into the system

1. Every interactive element is reachable by Tab and operable by Enter/Space.
2. Focus is never removed without an alternative; `:focus-visible` uses a 3 px ring.
3. Color is never the only signal; text labels accompany status.
4. Live regions announce moves, sync, and errors.
5. Motion respects `prefers-reduced-motion` and forced-colors mode is supported.
6. Dialogs use native semantics and restore focus.
7. Heading order is sequential; boards use `h1` → column `h2` → card title `h3`.
8. Form errors are linked with `aria-describedby`; required fields are marked in text.

See [ACCESSIBILITY.md](ACCESSIBILITY.md) for the full matrix and [VPAT.md](VPAT.md) for conformance.

## 11. What not to add

- A second accent color for decoration.
- Dashboard widgets on Today.
- A permanent admin panel in personal workspaces.
- Confetti, streaks, or artificial urgency.
- Icon-only controls without labels.
- Motion longer than 220 ms for task-level actions.
