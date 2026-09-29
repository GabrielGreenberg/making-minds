---
id: 2026-09-29-085
type: bug
title: Make boxing work on HW1 P4→P5 through one Box tool in the palette — the dashed "+ BOX" tile back, Box out of the edit strip, one icon set for undo, redo and rotate
priority: high
size: large
requires: browser
area: app
source: feedback
created: 2026-09-29T15:10:00-07:00
status: ready
after:
branch:
merged_into:
---

## Description
Two App Feedback reports from Gabriel, five minutes apart on HW1 (author-role: instructor,
category: platform design):

- `fb-mun6ky35-fsgaz4` (HW1 P4): he doesn't like how boxing is offered now. He wants the
  palette's old box tool back — a dashed square with a **+** in it and **BOX** under it — with
  the **Boxes** library as a separate tile that appears once boxes build up; the Box
  button should leave the canvas's Undo · Redo · Delete · Rotate strip; and the undo, redo
  and rotate arrows should be drawn as one matching set.
- `fb-mun6rftv-2cafxh` (HW1 P5), which points back to the first: the new box feature for
  circuits doesn't seem to work at all.

HW1 P5 ("Combining circuits") is built around boxing: its hint tells the student to box
the XOR from P4 and reuse it. HW1 is due 2026-10-05, so a broken box path breaks that
problem's intended route → `high`.

**How boxing is offered today (from the code).** There are two ways to make a box, and
the palette only reaches one:
1. **Box selection + box editor** (commit `8712f54`, 2026-09-26, outside the task queue):
   select parts, press **▣ Box** in the edit strip (`components/CanvasActions.tsx:57-69`).
   `boxSelection` (`store.ts:3571`) swaps the parts for a black-box copy
   (`boxEditing.ts:227 extractSelection`), then *immediately* opens the box editor
   (`store.ts:3593` → `openBoxEditor`, `store.ts:3457`). The editor swaps the whole canvas
   for the box's insides, with a bar at the top centre (`components/BoxEditorBar.tsx`,
   `workbench.css:593`). The Boxes pop-out's **New box** button now opens an empty editor
   too (`Palette.tsx:489-526`).
2. **Draw a box** (the older tool): arm `NEW_BOX`, drag a rectangle around parts, adjust,
   confirm (`CircuitCanvas.tsx:3061` start, `:2568` finish, `store.ts:3197 confirmBox`). The
   parts stay visible inside a dashed outline and the box joins the library; task 038 made
   it work across wires. **Nothing arms `NEW_BOX` any more**: `8712f54` re-pointed the
   pop-out's New box button from `armToggle('NEW_BOX')` to the editor, so the draw tool,
   its canvas hint (`canvasView.ts:139`) and its crosshair cursor are unreachable. The
   editor memo still says New box "arms the existing NEW_BOX draw tool"
   (`docs/buildout/designs/editor-workbench.md:170`).

The tile Gabriel wants back is the old palette's "New Box" item: a dashed rounded
rectangle with a "+" in it (`git show 687e604^:app/src/components/ComponentLibrary.tsx`,
the "New Box tool" block). The Boxes tile shows whenever the canvas may hold boxes, even
with none built (`Palette.tsx:439-466`, a count badge only when non-empty).

**Why P5 "doesn't work at all": not reproduced — no browser in the catch.** The store
code reads as coherent (`extractSelection`, `boxCircuitProblem`, `saveBoxEditor`,
`closeBoxEditorForSwap` at `store.ts:1886`, the save shield `liveCanvas`), and
`boxEditorCheck` is in `npm run check`. Candidates, most likely first:
1. **Press Box and the circuit vanishes**: the canvas is swapped for the editor with no
   step between. Unless you notice the bar at the top, it looks like your work is gone.
2. **Looking for the draw tool**: someone who knows boxing as "draw a box around it"
   (the textbook's way, and the old palette's) finds no way to do it. New box opens an
   empty canvas instead.
3. **A real failure** in select → Box → Save → place in P5 (a refusal from
   `boxCircuitProblem`, a copy that doesn't compute, a library that doesn't carry from P4
   to P5), found only by running it.
The first step of this task is to run it and name the failure (see Verify).

## Done when
- The palette has a **Box tool tile**: a dashed square with a **+** inside and the label
  **BOX**, drawn in the palette's icon style (`pal-ico`, strokes, theme tokens). It shows
  on every canvas that may hold boxes (`paletteHasBoxes` / `selectPlaceableBoxKinds`) and
  arms the draw-a-box tool (crosshair, the `canvasView.ts:139` hint, Esc disarms).
  Clicking it with parts selected boxes the selection through the same path (Design).
- The **Boxes** tile (library pop-out) shows only once the homework (sandbox: the tab)
  has at least one box that this canvas may place. With none, only the BOX tile shows.
- The edit strip holds **Undo · Redo · Delete · Rotate · Clear** (plus a turbot TM's Swap
  state type) and **no Box button**.
- Undo, redo and rotate use **one icon set**: inline SVGs with the same stroke, size and
  weight (redo mirrors undo; rotate in the same style), each with a label or `aria-label`
  and the shortcut in its title. The "(shift+click to ↻)" hint uses the same rotate icon.
  No text-glyph arrows (↶ ↷ ↻) are left in the strip.
- **HW1 P4 → P5 works end to end**, local mode and remote mode alike: build the XOR in P4,
  box it with the BOX tool, name it, go to P5, place it from the palette, wire the
  half-adder, Run: the outputs match the truth table, and Submit grades P5 correct. The
  failure behind `fb-mun6rftv-2cafxh` is named in the Progress log and fixed at its root.
- The box editor stays reachable where it edits an existing box (the pop-out's **Edit**,
  double-clicking a placed copy), and editing a box still updates every copy.
- `editor-workbench.md` §Boxes describes what was built; `CLAUDE.md` Part 1's palette
  line is updated in place if it changes.

## Design
- **The class:** two ways to make a box, with different results. The draw tool
  (`confirmBox`) gives a dashed outline around live parts. Box selection
  (`extractSelection`) gives a black-box copy, then the editor. The palette reaches
  neither directly and the strip reaches only the second. When one gesture's UI entry was
  re-pointed, the other path lost its entry without anyone noticing. This task makes one
  entry, the BOX tile, and one way of making a box behind it.
- **deepFix (recommended):** the BOX tile is the one way to make a box. With nothing
  selected it arms `NEW_BOX` (draw → adjust → confirm, exactly as task 038 left it). With
  parts selected, clicking it (or pressing its shortcut, if one is added to `shortcuts.ts`)
  boxes the selection **through the same path**: draft a rectangle from the selection's
  bounds (`getComponentBounds`, plus the draw tool's padding), go straight to
  `'adjusting'`, and confirm as usual. Then `extractSelection` is either (a) folded in as
  the drawn box's "collapse to a single part" step, if the drawn-outline flow needs it, or
  (b) retired along with the ▣ Box button, with its pins in `boxEditorCheck` moved to the
  draw path. Which one is a HOW for the worker. Choose by what `confirmBox` already
  produces, and keep one path either way. Remove the editor's automatic open after
  boxing: a new box shows on the canvas where it was made. The editor is for **editing**
  a library box (the pop-out's Edit, double-click), not for making one. The pop-out's New
  box button either arms the draw tool or goes away (the BOX tile does that job).
  Everything that mutates keeps the lock at the top of the store action (law 3), and box
  names keep the paste guard (law 8).
- **surgicalFix:** add a BOX tile that arms `NEW_BOX`, hide the Boxes tile when empty,
  delete the strip's ▣ Box button, and swap the three glyphs for SVGs. This leaves two ways
  to make a box (selection-boxing is then unreachable, as the draw tool is now) and doesn't
  touch the P5 failure. Not recommended.
- **Icons:** `Palette.tsx:58-160` already draws its icons as small inline SVGs
  (`pal-ico`, `viewBox 0 0 36 26`). Draw undo, redo and rotate the same way, in one
  component used by `CanvasActions` and the hint, with `currentColor` so `themeCheck`'s
  colour-literal rule holds. Redo is undo mirrored (`transform="scale(-1,1)"`), so the
  pair can't drift apart.
- **The Boxes tile gate:** `rows.length > 0` (`Palette.tsx:333` `boxRows` already
  filters out boxes this canvas can't place) decides whether the tile renders. Pinned boxes
  still show. An open pop-out closes if its last row goes.
- **Pointers:** `CanvasActions.tsx:20-25, 57-69` (Box button, `hasBoxable`) ·
  `Palette.tsx:439-466` (Boxes tile), `:489-528` (pop-out footer) · `palette.ts:19`
  (`ArmedTool` still has `'NEW_BOX'`), `:62 paletteHasBoxes`, `:239-242` · `store.ts:3197`
  confirmBox, `:3457-3594` editor + boxSelection · `CircuitCanvas.tsx:3061`, `:2568`,
  `:3655`, `:3679`, `:3721-3730` (double-click a copy opens the editor) ·
  `canvasView.ts:139` · `workbench.css:390-400` (strip), `:593` (editor bar).

### Members
- `fb-mun6ky35-fsgaz4` (instructor, platform design, HW1 P4): BOX tile back, Boxes
  separate once boxes exist, Box out of the strip, one icon set for the arrows.
- `fb-mun6rftv-2cafxh` (instructor, platform design, HW1 P5): the new box feature for
  circuits doesn't seem to work.

## Verify
- **First, reproduce** in the robot's dev server ("Robot Dev Server"; or "Vite Dev Server"
  / "Vite Remote Mode" interactively). Load HW1, then on P4: build the XOR, box it
  (today: select → ▣ Box), save, go to P5, open Boxes, place it, wire, Run, Submit.
  Record in the Progress log where it breaks, then fix that root cause.
- Gates: both `tsc`s, `npm run build`, `npm run check` (app), `npm run check` (server).
- Pins: `boxEditorCheck` gets a **[hw1 p4→p5]** scenario driving the store as a student
  would: build the XOR on P4, box it through the BOX tool's store path, switch to P5,
  place it, wire the half-adder, `gradeQuestion` P5 = correct. `boxScopeCheck` keeps its
  confirmBox pins, and the selection-boxing pins move to the one path. `workbenchCheck
  [palette]` pins the BOX tile (present wherever boxes are, arms `NEW_BOX`), the Boxes
  tile's gate (absent at 0 boxes, present at 1), and the strip's buttons (no Box).
  `themeCheck` covers the new icon component.
- **Eyeball (owed if the run can't take it):** the palette, standing and laid flat, with
  and without boxes; the strip's icons side by side at 100% and 200% zoom, light and dark;
  the draw tool's crosshair and hint. Screenshots in the Progress log.

## Progress log
