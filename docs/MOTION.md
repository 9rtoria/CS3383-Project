# Motion Specification

**Principle:** motion explains a state change, then gets out of the way. Drift is a productivity surface; no animation may delay input or hide a result.

## 1. Timing scale

| Token / use | Duration | Easing |
|---|---:|---|
| Hover, border, opacity | 120 ms | `ease` |
| Button press | 120 ms | `ease` (1 px translate) |
| Menu/popover | 120 ms | `ease-out` |
| Dialog backdrop + panel | 160–180 ms | `ease-out` |
| Task drawer | 220 ms | `cubic-bezier(0.22, 1, 0.36, 1)` |
| Toast | 180 ms | `cubic-bezier(0.22, 1, 0.36, 1)` |
| Progress/capacity width | 300 ms | `ease` |
| Skeleton shimmer | 1.4 s loop | `ease` |
| Spinner | 700 ms linear loop | `linear` |

No task action uses a duration above 220 ms. The 300 ms capacity bar is a data visualization, not an interaction gate.

## 2. Choreography

### Page/view change
Content fades in over 150 ms. The sidebar and top bar do not animate on every navigation; only the content region changes. This avoids a “slideshow” feel when switching Today → Board → Calendar.

### Capture
- `C` opens the dialog with a 180 ms scale/fade from 0.98 → 1.
- The new task appears optimistically with no entrance animation; the toast confirms.
- Closing returns focus to the invoking control.

### Task move
- Dragging reduces card opacity to ~0.55 and raises the drop target border.
- On drop, the card is placed immediately; no flight animation that would lag the pointer.
- Keyboard moves update instantly; the live region announces the destination.
- Undo restores the card without a reverse animation; the toast disappears.

### Drawer
- Slides in from the right over 220 ms with a decelerating curve.
- Backdrop fades in over 160 ms.
- On close, focus returns to the task card; the drawer does not animate out long enough to block the next action.

### Menus and palette
- Menus scale/fade from the trigger edge over 120 ms.
- The command palette uses the dialog timing; results update without per-row animation.
- Selected row uses an instant background change, not a sliding highlight.

### Toasts
- Enter from 8 px below with fade over 180 ms.
- Exit is a 120 ms fade; the undo window remains available for its full duration even if the toast is dismissed by timeout.
- Toasts pause auto-dismiss on hover/focus where implemented.

### Sync and offline
- The sync indicator uses a subtle spinner only while a replay is in flight.
- Offline/pending badges do not pulse; they are static status, not alerts.
- A failed queue item uses a persistent warning color, not a shake.

## 3. Reduced motion

`@media (prefers-reduced-motion: reduce)` sets all animation/transition durations to `0.01 ms`, disables smooth scrolling, and removes card hover translation. State still changes; only the interpolation is removed. No information is conveyed solely by motion.

## 4. Forced colors

In `forced-colors: active`, borders are restored with `CanvasText`, primary buttons/avatars use `Highlight`/`HighlightText`, and progress uses `Highlight`. Motion remains disabled by the OS preference where applicable.

## 5. Performance budget

- Animate only `opacity` and `transform` where possible.
- Avoid layout-triggering animations on lists and boards.
- No animation library is loaded; CSS handles all transitions. This keeps the client bundle small and avoids a runtime cost on low-end devices.
- The service worker and offline shell do not animate.

## 6. What is intentionally absent

- Page transitions between every view.
- Confetti or celebratory bursts on task completion.
- Parallax, autoplay video, or ambient background motion.
- Drag “ghost” physics that lag behind the pointer.
- Animated counters on capacity numbers.

These omissions are deliberate: they protect speed, reduce vestibular risk, and keep the product calm.
