# VPAT-style accessibility conformance report

**Product:** Drift v1.0.0  
**Report date:** 2026-10-23  
**Standard:** WCAG 2.2 Level A/AA  
**Method:** automated axe-core, keyboard journeys, code review, Lighthouse  
**Not performed:** manual NVDA/VoiceOver, 400% zoom, Windows High Contrast, switch/voice control, user testing with disabled participants

> This is a **VPAT-style** report, not a certified VPAT or an independent audit. “Supports” means no known failure in the tested surfaces; it does not mean every page and state has been manually verified. The honest overall status is **Partially Supports**, pending a manual assistive-technology audit.

## 1. Scope

Tested surfaces:

- Today (capacity plan, suggestions, dismissals)
- Board (Kanban, list, drag, keyboard move, WIP)
- Task drawer (fields, checklist, comments, activity, attachments)
- Insights (timeline, workload)
- Command palette
- Settings (notifications, workspace, automations, integrations)
- Auth (guest claim and sign-in)
- Public share page
- Offline page

Not tested: every empty/error state, email templates, ICS output, admin SSO forms with a live IdP, mobile screen readers.

## 2. Evaluation methods

| Method | Tool / evidence |
|---|---|
| Automated rules | axe-core tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`; blocking on critical/serious |
| Keyboard-only | Playwright journeys: capture, move, undo, palette, dialogs, search |
| Screen-reader semantics | Code review of roles, names, live regions, headings, landmarks |
| Contrast | Token review + Lighthouse accessibility 100 |
| Zoom/reflow | Not formally tested; responsive layout reviewed at 390 px and 1600 px |
| Motion | `prefers-reduced-motion` CSS and test review |

Evidence files: `tests/e2e/a11y.spec.ts`, `e2e-output.txt`, `docs/performance/*.json`, [ACCESSIBILITY.md](ACCESSIBILITY.md).

## 3. WCAG 2.2 A/AA conformance

Legend: **S** = Supports, **P** = Partially Supports, **NS** = Does Not Support, **N/A** = Not Applicable.

### 1. Perceivable

| Criterion | Level | Status | Remarks |
|---|---|---|---|
| 1.1.1 Non-text Content | A | S | Icon buttons have accessible names; decorative icons are hidden; avatars expose initials/name |
| 1.2.1 Audio-only/Video-only | A | N/A | No prerecorded media |
| 1.2.2 Captions | A | N/A | No video |
| 1.2.3 Audio Description | A | N/A | No video |
| 1.2.4 Captions (Live) | AA | N/A | No live media |
| 1.2.5 Audio Description (Prerecorded) | AA | N/A | No video |
| 1.3.1 Info and Relationships | A | S | Landmarks, headings, lists, tables, form labels, fieldset/legend where grouped |
| 1.3.2 Meaningful Sequence | A | S | DOM order follows visual order; drawer focus order reviewed |
| 1.3.3 Sensory Characteristics | A | S | Instructions do not rely on shape/color alone; labels accompany color chips |
| 1.3.4 Orientation | AA | S | Responsive layout works portrait/landscape; no orientation lock |
| 1.3.5 Identify Input Purpose | AA | P | Email/name/password use appropriate autocomplete; some custom fields lack a specific token |
| 1.4.1 Use of Color | A | S | Priority/labels include text; focus ring is not color-only; status has text |
| 1.4.2 Audio Control | A | N/A | No autoplay audio |
| 1.4.3 Contrast (Minimum) | AA | S | Muted/faint tokens darkened; Lighthouse 100; manual spot checks |
| 1.4.4 Resize Text | AA | P | Text scales; 200% browser zoom not formally tested |
| 1.4.5 Images of Text | AA | S | No images of text; UI uses real text |
| 1.4.10 Reflow | AA | P | Responsive at 390 px; 320 px/400% reflow not formally tested |
| 1.4.11 Non-text Contrast | AA | S | Borders, focus rings, and controls reviewed against adjacent colors |
| 1.4.12 Text Spacing | AA | P | No fixed line-height clipping found in review; text-spacing bookmarklet not run |
| 1.4.13 Content on Hover or Focus | AA | P | Tooltips/menus dismiss with Esc and are hoverable; not every transient surface manually tested |

### 2. Operable

| Criterion | Level | Status | Remarks |
|---|---|---|---|
| 2.1.1 Keyboard | A | S | Core flows work keyboard-only; drag has `Alt+Arrow` alternative |
| 2.1.2 No Keyboard Trap | A | S | Dialogs trap focus intentionally and release on close/Esc; tested |
| 2.1.4 Character Key Shortcuts | A | S | Single-key shortcuts can be turned off in the shortcuts dialog; Cmd/Ctrl+K remains |
| 2.2.1 Timing Adjustable | A | S | No time limits on core tasks; session expiry is long and re-auth is available |
| 2.2.2 Pause, Stop, Hide | A | S | No auto-playing carousel/marquee; reduced-motion honored |
| 2.3.1 Three Flashes | A | S | No flashing content |
| 2.4.1 Bypass Blocks | A | S | Skip link + landmarks; repeated nav is labeled |
| 2.4.2 Page Titled | A | S | Route titles and document title set |
| 2.4.3 Focus Order | A | S | Dialog focus trap/restore; drawer and palette reviewed |
| 2.4.4 Link Purpose (In Context) | A | S | Links use descriptive text or accessible names |
| 2.4.5 Multiple Ways | AA | S | Nav, command palette, search, and direct URLs |
| 2.4.6 Headings and Labels | AA | S | Board columns are `h2`; page `h1`; form labels present |
| 2.4.7 Focus Visible | AA | S | Visible focus ring on interactive controls |
| 2.4.11 Focus Not Obscured (Minimum) | AA | P | Sticky header could overlap focused content in some scroll positions; not exhaustively tested |
| 2.5.1 Pointer Gestures | A | S | No multipoint/path gestures required; drag has keyboard alternative |
| 2.5.2 Pointer Cancellation | A | S | Actions fire on click/up; drag can be cancelled |
| 2.5.3 Label in Name | A | S | Visible labels match accessible names; task cards use visible content |
| 2.5.4 Motion Actuation | A | N/A | No device-motion controls |
| 2.5.7 Dragging Movements | AA | S | Keyboard move/reorder; pointer drag is not the only path |
| 2.5.8 Target Size (Minimum) | AA | P | Most controls ≥24×24; dense board/list rows and small icon buttons need measurement at 200% |

### 3. Understandable

| Criterion | Level | Status | Remarks |
|---|---|---|---|
| 3.1.1 Language of Page | A | S | `<html lang="en">` |
| 3.1.2 Language of Parts | AA | S | No mixed-language content |
| 3.2.1 On Focus | A | S | Focus does not trigger navigation or submit |
| 3.2.2 On Input | A | S | Inputs do not auto-submit; changes are explicit |
| 3.2.3 Consistent Navigation | AA | S | Same sidebar/topbar order across views |
| 3.2.4 Consistent Identification | AA | S | Same icons/labels for same actions |
| 3.2.6 Consistent Help | A | S | Help/shortcuts control is in the same header position; no per-page help variant |
| 3.3.1 Error Identification | A | S | Field errors announced and associated; API errors shown in toast/inline |
| 3.3.2 Labels or Instructions | A | S | Inputs labeled; hints for ambiguous fields |
| 3.3.3 Error Suggestion | AA | S | Validation messages state the fix; conflict sheet offers choices |
| 3.3.4 Error Prevention (Legal, Financial, Data) | AA | P | Destructive actions require confirmation/typed confirmation; imports can partially commit and are reported |
| 3.3.7 Redundant Entry | A | S | Guest claim reuses session data; invite flow prefills email where available |
| 3.3.8 Accessible Authentication | AA | S | Password paste allowed; magic link; no cognitive puzzle; MFA supports TOTP |

### 4. Robust

| Criterion | Level | Status | Remarks |
|---|---|---|---|
| 4.1.2 Name, Role, Value | A | S | Custom menus/dialogs use native elements or ARIA with names/states |
| 4.1.3 Status Messages | AA | S | Live regions announce moves, undo, sync, and errors |

## 4. Known accessibility gaps

1. **Manual AT audit absent.** NVDA/VoiceOver, zoom, and high-contrast testing were not possible in this environment. This is the largest gap.
2. **Focus not obscured.** Sticky headers may overlap focused rows at some scroll positions; add scroll-padding and test.
3. **Target size.** Dense list rows and a few icon buttons may be below 24×24 CSS px at 200% zoom; measure and enlarge.
4. **Text spacing/reflow.** Bookmarklet and 320 px/400% checks not run.
5. **Custom widgets.** Menus and dialogs are first-party; they pass axe and keyboard tests but need SR-specific verification.
6. **Partial import commits.** Invalid rows are reported but valid rows commit; a user may need to reconcile. The UI explains this.
7. **No accessibility statement page** in the product; this document is the statement.

## 5. Remediation plan

| Priority | Action | Owner | Target |
|---|---|---|---|
| P0 | Manual NVDA + VoiceOver audit of core flows | Accessibility reviewer | Before GA |
| P0 | 400% zoom / 320 px reflow and text-spacing pass | Frontend | Before GA |
| P1 | Fix focus-obscured cases with `scroll-padding-top` and test | Frontend | Next release |
| P1 | Measure/enlarge sub-24 px targets | Design + frontend | Next release |
| P1 | Add an in-product accessibility statement and feedback contact | Product | Next release |
| P2 | Windows High Contrast and reduced-transparency pass | Frontend | Backlog |
| P2 | User testing with disabled participants | Research | Backlog |

## 6. Conformance statement

Drift **partially supports** WCAG 2.2 Level AA based on automated and keyboard evidence. It does not claim full conformance because manual assistive-technology testing, zoom/reflow, and target-size measurement are incomplete. The product is usable keyboard-only for the core journeys, and no serious/critical axe violations were found on the tested surfaces.

For procurement, pair this report with [ACCESSIBILITY.md](ACCESSIBILITY.md) and the raw Lighthouse/axe evidence. Do not represent it as a certified VPAT.
