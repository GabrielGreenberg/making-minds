---
id: 2026-09-25-055
type: feature
title: Give the canvas the site's look — Plex Sans text, magenta selection, a dot grid, a hint line, an empty-canvas message and a Fit button (editor redesign 4 of 6)
priority: normal
size: large
requires: browser
area: app
source: inbox
created: 2026-09-25T16:15:00-07:00
status: done
after: 2026-09-25-054
branch:
merged_into:
---

## Description
Step 4 of the editor workbench redesign. The spec and the chain are in
`docs/buildout/designs/editor-workbench.md` and task 052. This step covers the memo's
§Canvas and §Canvas appearance, **except gate geometry and the drawn symbols, which are
056.** Nothing here changes a part's size or a port's position, so saved circuits lay out
exactly as before. That is why this step ships without the screenshot hold that 056 carries.

The changes:
- **Text.** Every canvas text moves to IBM Plex Sans 600 with tabular numbers: labels, values,
  box names, MEM values and overlays.
- **Colour.**
  - Selection turns magenta (`--mm-accent` stroke with a `--mm-lav-soft` fill) instead of
    blue.
  - Wires are 2px (black for 0, red for 1), and a selected wire gets a lavender halo.
  - Port dots are r3.5 in the wire's colour.
  - Gate strokes are `#2A2A2A` at 1.5 on white.
- **The canvas surface and overlays.**
  - A dot grid replaces the line grid and follows pan and zoom.
  - A zoom group sits bottom-right: − · % · + · **Fit**.
  - A one-line hint sits bottom-left and changes with the state.
  - A centred message shows when the canvas is empty.

## Done when
- **No monospace or blue left on the canvas.** No text on the canvas is monospace. No
  `#2a7fff` or other blue selection literal remains in `CircuitCanvas.tsx`, and every canvas
  colour comes from a token.
- **The theme gate covers the canvas.** `themeCheck` scans `CircuitCanvas.tsx` for colour
  literals (F2, continued from 052).
- **Fit.** It centres the circuit in the space the palette doesn't cover and never goes
  below 80%: a wider circuit left-aligns instead. It runs on every question change, as the
  canvas's response to the swap (F4 of 052).
- **The zoom range** is one range. The slider's 0.2 and `setZoom`'s 0.25 clamp no longer
  disagree.
- **The hint line** shows the memo's five states (armed tool, part selected, wire selected,
  parts without wires, otherwise). It is absent on an empty canvas.
- **The empty-canvas message** reads as in the memo.
- **Wires.** 0/1 wire colours are unchanged in meaning (black = 0, red = 1, Critical design
  rules).
- **Gates.** `layoutCheck`, `routerCheck`, `bumpCheck` and `coverageCheck` are green and
  unchanged, since no geometry moved. So are `themeCheck` and every gate in PROFILE §6.

## Design
**deepFix.** Canvas colours and type become tokens that the SVG reads, via CSS custom
properties on the canvas root or one `canvasTheme` constant sourced from them. They are no
longer literals scattered through `CircuitCanvas.tsx`, and `themeCheck` then keeps it that way.
This retires the "blue selection in 27 places" class, not just today's colour.

**surgicalFix.** Search-and-replace `#2a7fff` with the magenta literal. That leaves the
same class, recoloured.

**Code as it stands (read 2026-09-25).**
- **Fonts:**
  - `fontFamily="monospace"` at `CircuitCanvas.tsx` :430, :454, :494, :726.
  - `'SF Mono','Fira Code',monospace` at :1062, :1376, :1403, :1410, :1481, :1516.
  - Canvas-related mono in `index.css` at :931, :999, :1083, :1113, :1755, :1802, :1903.
    Check each: some belong to the right panel, whose table fonts 053 owns.
- **Selection:** the literal `#2a7fff` appears 27× (e.g. :410, :422, :510, :537, :564, :588,
  :622, :684, :757, :777, :1006, :1165, :1597, :3614), with the fill `#e3f2fd`.
- **Unused tokens:** `index.css:2-18` declares `--selected-border`, `--wire-0`, `--wire-1`
  and `--port-fill`, but the SVG never uses them. Fold them into the page tokens (052 moved
  the editor onto `--mm-*`).
- **Grid:** an SVG line pattern at `CircuitCanvas.tsx:3179-3202` (`showGrid`,
  `store.ts:760`). `GRID_SIZE` is 20 (`types.ts:885`).
- **Zoom:**
  - The wheel handler is at :1954-1970.
  - `setZoom` clamps to 0.25–3 (`store.ts:1977`), while the slider's min is 0.2
    (:3885-3918).
  - There is no Fit today. A nav arrow only recentres when nothing is visible (:3124-3177,
    :3863).
- **Fit on question change:** zoom and pan are workbook-level fields (`store.ts:757, :1971`).
  Fit writes them.
- **Bounds:** use `getComponentBounds` (`componentGeometry.ts:191-221`) for the circuit's
  bounds, so the INPUT toggle tab is included.
- **Law 6:** Fit is a view change, not a sim reset, so it must not touch undo or the live
  runs.

### Resolved decisions
Gabriel, 2026-09-25 (catch): **2. Plex Sans tabular** for canvas text, like the tables. The
remaining canvas decisions (NOT size, symbols) belong to 056.

## Verify
- **Gates:** everything in PROFILE §6. The layout gates must pass unchanged, which is the
  proof that nothing moved.
- **`themeCheck`:** extend it to `CircuitCanvas.tsx`.
- **Browser (requires: browser):**
  - HW1: select parts and wires (magenta, with the halo) and toggle inputs (Plex Sans
    values).
  - Walk the hint line through its five states. Empty the canvas to see the message.
  - Fit a wide HW3 circuit: it left-aligns at 80%.
  - Pan and zoom: the dots follow.
  - Check an SC question and a turbot CC brain.
  - Screenshot before and after at 1280.

## Progress log

### 2026-09-26 — built, verified, landed (/work)
- **Colours are roles, read off the tokens** (`app/src/canvasTheme.ts`): 19 roles, each
  naming a `theme.css` token (`--mm-ink`, `--mm-accent`, `--mm-lav-soft`, `--mm-signal-0/1`,
  a new `--mm-signal-1-soft`…). `canvasColors()` resolves them once from the document,
  because SVG presentation attributes can't be trusted to honour `var()` in every browser
  (Safari). HTML inside the canvas (the transition editor, the box-name field) uses
  `canvasVar()`, i.e. `var()`. `CircuitCanvas.tsx` has no colour literal left (about 140
  before); `themeCheck` now scans it (hex, rgb/hsl, quoted colour names, no monospace) and
  requires every role's token to exist.
- **The look** (memo §Canvas appearance, minus 056's geometry and symbols):
  - All canvas text is Plex Sans 600 with tabular digits (the SVG root's CSS; the
    per-element mono stacks are gone).
  - Labels are 11px `--mm-ink-3`, 0.04em. Input and output values are 17px, and at 1
    they take the soft red wash.
  - Selection is magenta: `--mm-accent` at 2.5 on `--mm-lav-soft`.
  - Wires are 2px in their signal colour. A selected wire keeps that colour over an 8px
    `--mm-lav` halo. Port dots (r3.5) wear their wire's signal.
  - Boxes and MEM sit on `--mm-surface-3`, and FSM's current state is `--mm-ok`.
  - Every other overlay (drafts, box select, guides, violations) is on a role too.
- **Dot grid.** The container's CSS background (radial gradient, cell = GRID_SIZE × zoom,
  offset half a cell so the dots sit on the snap points) follows pan and zoom and never
  ends. The old line pattern stopped at ±4000.
- **Zoom** (`app/src/canvasView.ts`, pure). There is one range, `ZOOM_MIN`–`ZOOM_MAX`
  (0.25–3), used by the store's `setZoom` (`clampZoom`); the slider and its 0.2 minimum
  are gone. The group is − · % · + · Fit: ± step ×1.2 about the canvas centre, and % goes
  back to 100.
- **Fit.** `circuitBounds` covers every footprint (an INPUT's tab included) and drawn box,
  padded. `freeArea` is the side of the palette with more room, less the corner furniture.
  `fitView` centres the circuit at 80–140%; a wider one left-aligns, and an empty canvas
  shows at 100% from the free area's corner. It runs on every canvas swap: the store's
  `resetAllSimState` bumps `canvasSwapSeq`, and the canvas answers with Fit two frames
  later. It is a view change only: `navResetCheck [view: …]` pins that zoom and pan leave
  the circuit, undo, redo and the counter alone, and that setZoom clamps.
- **Hint line and empty message** (`components/CanvasGuide.tsx` over `canvasHint`): the
  memo's five states, plus the New box tool, state machines (transitions) and a locked
  question (what still works). There is no hint on an empty canvas, which shows the
  memo's centred message instead. The lock is only read for display (law 3).
- **CSS.** The canvas furniture moved to `workbench.css` on tokens: the zoom group, hint,
  empty message, nav arrow, Ready to Box buttons, validation warnings (now above the hint
  line) and the paste notice. Nine dead `index.css` tokens were dropped, along with the
  zoom slider, `.toolbar-btn` and some rules already without users (the machine-type
  selector, turbo toggle and an overridden `.paste-notice`). The `index.css` ratchet
  went from 168 to 133.
- **Pins.**
  - `workbenchCheck [canvas]`: range, zoom step, bounds, free area, Fit (small / fits /
    wide / empty), the hint states, the message, and the wiring (group with Fit and no
    slider, dot grid, halo, the swap counter).
  - `themeCheck`: the canvas scan and the roles.
  - `navResetCheck [view: Fit is a view change, never a reset]`.
- **Browser (local, 1280).**
  - HW1: inputs toggled to 1 and run show red wires, dots and values in Plex Sans. A
    selected OR is magenta; a selected wire gets the halo.
  - Hint states were walked on the real canvas; the empty question shows the message.
  - HW3 (SC): MEM on the quiet fill, and a wide circuit fits at 80% left-aligned, with
    dots at 16px following the pan.
  - A sandbox turbot tab with a CC brain renders on the roles.
  - The pane was hidden for the swap test (a hidden page holds its animation frames), so
    `Fit` on every question change was proven in headless Chrome: empty Q2 at 100% from
    (90,48), Q1 fitted at 105%, and the wide Q2 at 80% left-aligned. Screenshots are in
    the session scratchpad (not committed).
- **Gates:** app tsc, tools typecheck, build, `npm run check` (layout, router, bump and
  coverage unchanged — nothing moved) and server check.
- **Found, for 057 (memo pass):** a flat palette across a ~660px canvas (the 1280 layout)
  covers the top-right Undo/Redo group; the palette's clamp knows the canvas but not the
  action group.
