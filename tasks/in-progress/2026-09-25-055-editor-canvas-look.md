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
status: in-progress
after: 2026-09-25-054
branch: task/055-editor-canvas-look
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
