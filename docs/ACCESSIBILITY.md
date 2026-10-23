# Accessibility

**Target:** WCAG 2.2 Level AA  
**Verification:** automated axe scan, keyboard journeys, semantic review  
**Not verified:** manual screen-reader testing with NVDA/JAWS/VoiceOver

## 1. Commitment

Drift treats keyboard operation as a complete path, not a shortcut layer. Core journeys — capture, open, edit, move, search, plan, invite, export — must be operable without a pointer. Accessibility is tested in CI on the main surfaces and documented honestly where automated checks cannot prove conformance.

## 2. What was verified

| Check | Method | Result |
|---|---|---|
| Serious/critical axe violations | `@axe-core/playwright` with WCAG 2.0/2.1 A/AA tags on Today, Board, Insights, command palette, Settings, Auth (guest + signed out) | **0** |
| Keyboard move | Playwright `Alt+ArrowRight`, focus + live-region assertion | Pass |
| Keyboard capture | `C`, fill, Enter; dialog closes | Pass |
| Command palette | Open, Arrow navigation, Enter, Escape | Pass |
| Focus restoration | Dialog/menu close returns focus | Implemented; covered by component review |
| Heading order | Board `h1` → column `h2` → card `h3`; Lighthouse heading-order | Pass after fix |
| Accessible name / visible label | Task card name includes visible content; Lighthouse label-content-name-mismatch | Pass after fix |
| Reduced motion | CSS media query disables transitions/animations | Implemented |
| Forced colors | CSS `forced-colors` rules | Implemented |
| Contrast | Token review and Lighthouse contrast audit | Pass on audited surfaces |

Lighthouse accessibility scores on the production build: **100** for Today, Board, and the task drawer. The Board score was 98 before the heading/name fixes; the final run is 100.

## 3. Keyboard matrix

| Context | Keys | Action |
|---|---|---|
| Global | `C` | Open quick capture (single-key shortcuts can be disabled in `?` help) |
| Global | `/` | Open Search |
| Global | `?` | Open shortcut help |
| Global | `Ctrl/Cmd+K` | Toggle command palette |
| Global | `G` then `T/U/C/A/S/I/B` | Today, Upcoming, Calendar, Archive, Search, Insights, Board |
| Global | `Shift+N` | New board |
| Dialog | `Tab` / `Shift+Tab` | Cycle focus inside |
| Dialog | `Escape` | Close and restore focus |
| Dialog | `Ctrl/Cmd+Enter` | Submit where supported |
| Palette | `ArrowUp/Down`, `Enter`, `Escape` | Navigate, run, close |
| Board card | `Enter` / `Space` | Open task drawer |
| Board card | `Alt+ArrowLeft/Right` | Move between columns |
| Board card | `Alt+ArrowUp/Down` | Reorder within column |
| Task drawer | `Tab` through fields; `Ctrl/Cmd+Enter` saves description/comment | Edit |
| Menus | `Enter/Space`, arrows, `Escape` | Open, navigate, close |
| Forms | `Enter` in single-line fields | Submit where appropriate |

Native browser file pickers and OAuth redirects leave the page and are exempt from in-app keyboard control.

## 4. Semantics and ARIA

- Landmarks: `main`, `nav[aria-label="Boards"]`, complementary sidebar, notifications region.
- A skip link targets `#main`.
- Board columns are `section` with an accessible name including count; column headings are `h2`.
- Task cards are `article` with `role="button"`, `tabIndex=0`, `aria-roledescription="Draggable task card"`, and an `aria-describedby` hint for Enter/Alt+Arrow behavior. The accessible name is computed from visible content, satisfying label-in-name.
- Dialogs use native `<dialog>` or a custom dialog with `role="dialog"`, `aria-modal`, labelled title, focus trap, and restore.
- Toasts use `role="status"` for success and `role="alert"` for errors; moves are announced in a dedicated polite live region.
- Form controls have visible labels; icon-only buttons have `aria-label`; errors are linked with `aria-describedby`.
- Decorative icons are `aria-hidden`; icons that carry meaning have text or a label.
- The theme toggle and switches expose `aria-pressed`/`aria-checked` and keyboard operation.
- Tabs (Insights timeline/workload) use `role="tablist"`, `role="tab"`, `aria-selected`, and arrow-key behavior.

## 5. Focus management

- Opening a dialog/drawer moves focus to the first meaningful control (or the dialog itself).
- Closing restores focus to the invoking element.
- Menus close on Escape and outside click; focus returns to the trigger.
- After a task move, focus stays on the moved card so repeated moves work.
- After deleting/archiving the open task, focus moves to a sensible fallback (board heading or next card), never to `<body>`.
- In-app view changes keep focus on the activated navigation control (no focus loss); the skip link targets the new main content. Automatic focus-to-heading on every view switch is a backlog refinement.

## 6. Color and contrast

- Text tokens were adjusted after an audit: light `--muted: #565d56`, `--faint: #626962`; dark `--faint: #8a948c`.
- Priority/status badges use text plus color; no meaning relies on hue alone.
- Focus rings are 3 px and visible against both themes.
- Disabled controls remain legible (opacity 0.48 on a high-contrast base); disabled text is not used for essential information.
- Charts/timeline use labels and counts, not color-only encoding.

## 7. Motion and vestibular safety

All non-essential motion is removed under `prefers-reduced-motion: reduce`; smooth scrolling is disabled. No parallax, autoplay, or looping decorative animation exists. See [MOTION.md](MOTION.md).

## 8. Forms and errors

- Labels are programmatic and visible.
- Required fields are marked in text, not only with an asterisk.
- Validation errors appear inline and in a summary where multiple fields fail.
- Errors identify the field and the fix; they do not clear user input.
- Destructive actions require explicit confirmation text (for example typing `DELETE`).

## 9. Responsive and zoom

- Responsive layouts were reviewed at 390 px and 1600 px; the board intentionally scrolls horizontally as a spatial canvas. Formal 200%/400% zoom and 320 px reflow tests are still pending.
- Primary mobile actions are designed around 44 px targets; dense desktop icon buttons need measurement at 200% zoom (VPAT marks 2.5.8 partial).
- No fixed-height text containers were found to clip content in review, but the text-spacing bookmarklet was not run.
- The mobile bottom nav labels every destination; it is not icon-only.

## 10. Known gaps and honest limits

| Gap | Impact | Mitigation / next step |
|---|---|---|
| No manual NVDA/JAWS/VoiceOver session | Automated checks cannot prove screen-reader UX, especially drag announcements and complex drawer flows | Schedule manual AT review before an enterprise accessibility commitment; VPAT marks affected criteria “Partially Supports” |
| Native HTML5 drag has limited touch affordance | Touch users rely on card menus / keyboard alternatives | Card menu exposes move actions; mobile layout keeps menus reachable |
| Some charts are visual | Timeline/workload may be harder to parse without sight | Text summaries and counts accompany charts; table alternative is backlog |
| No user-facing density/font-size setting | Low-vision users rely on browser zoom | Zoom works; a density setting is backlog |
| No captions/transcripts | No audio/video content exists in v1 | N/A |
| Reduced-motion testing is CSS-level | OS/browser variations not exhaustively tested | Manual matrix in the next QA pass |

## 11. Testing commands

```bash
npm run test:a11y
npx playwright test tests/e2e/a11y.spec.ts
```

The scan fails on `critical` or `serious` violations and prints selectors. It covers Today, Board, Insights, command palette, Settings, guest claim, and signed-out sign-in. The command palette scan waits 400 ms for its entrance animation.

## 12. Accessibility acceptance checklist

- [x] Skip link and landmarks
- [x] Keyboard capture, search, palette, move, undo
- [x] Dialog focus trap and restore
- [x] Visible focus ring
- [x] Sequential headings
- [x] Accessible names for icon-only controls
- [x] Live announcements for moves and sync
- [x] Reduced motion and forced colors
- [x] Axe serious/critical = 0 on six surfaces
- [ ] Manual screen-reader sign-off
- [ ] User testing with disabled participants
