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
status: in-progress
after:
branch: robot/085-box-tool-back-in-palette
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
- **Remote mode** (Done-when 5), run headless in the robot's clone, 2026-09-29: seed a
  scratch DB (`MM_DB_PATH=<scratch>/mm.sqlite npm run seed -- --homeworks` in `server/`),
  start the server (`MM_AUTH_MODE=dev PORT=8199 MM_CORS_ORIGINS=http://localhost:5192`) and
  Vite (`VITE_API_BASE=http://localhost:8199 npx vite --port 5192`), publish HW1 as the toy
  instructor (`PUT /api/assignments/hw1/visibility`), then as the toy student: sign in by
  the form, build the XOR on P4, rubber-band select → BOX → wait out the autosave (GET
  `/api/workbooks/hw1`: no unnamed box) → Ready to Box → name XOR → reload → P5 → Boxes →
  XOR → click the canvas → wire the half adder → Run each row → Submit; read the grade as
  the instructor (`GET /api/assignments/hw1/submissions/all`). Result in the Progress log.
- **Owed (not claimed):** by hand in "Vite Dev Server", Gabriel's eyeball of the palette
  (standing and flat; no boxes, one box, the box editor open with BOX dimmed) and of the
  strip's Undo · Redo · Rotate at 100% and 200% zoom (light only: the app has no dark
  theme); and the drag feel of drawing a box with the armed BOX tile and of resizing a
  draft by its corners (a real pointer, not CDP events).

## Progress log

### 2026-09-29 — implemented (robot)
- **Repro first, on the unchanged code** (headless Chrome over CDP against a Bash-run Vite on
  :5191, local mode, HW1 seeded and published, as the toy student; circuits built through the
  store, the boxing gestures by real clicks). Select → ▣ Box → Save → P5 → Boxes → place →
  wire → Run → Submit **computes and grades**: P4 4/4, P5 4/4 (the plan stage's headless store
  repro agreed). So the P5 failure is in the UI, not the machine. **Named:**
  (1) ▣ Box swaps the whole canvas for the box editor with no step between, and the editor
  shows the same gates re-laid out with IN/OUT nodes. The bar calls a box made a second ago
  "Editing box" / "Save: update every copy" (`openBoxEditor` found the just-added library
  entry, so `isNew` was false), and it covers the strip's Undo and Redo
  (`attachments/2026-09-29-085-1-before-box-opens-editor.png`). The output panel still shows
  P4's table. Nothing shows that P4 now holds a black box until Save.
  (2) The draw-a-box tool can't be reached: the pop-out's New box opens an empty editor
  canvas. (3) A latent bug in the draw path: `resetAllSimState` never reset `boxDrawing`, so
  a draft's Ready to Box floated over the next problem, where `confirmBox` answered "Box not
  found.", and Esc left an unnamed draft in `boxes`, which was then saved. (4) Found while
  checking the fix: the draft's Ready to Box · Cancel sat to the right of the draft,
  `overflow:hidden` clipped them when the draft reached the canvas's right edge, and a box
  drawn around a whole P4 circuit does reach it.
- **Fix at the root: one way to make a box** (the Design's option (b)). There is now one
  **BOX** tile (dashed box with a +) in the palette's box group, a click and never a drag,
  that calls the store's `boxTool`. With parts selected, `boxTool` drafts a box around them
  (the union of `getComponentBounds` plus `BOX_DRAFT_PAD`) and goes straight to adjusting.
  With nothing selected, it arms or disarms NEW_BOX. The canvas's drawn rectangle goes to
  `startBoxDraft` too; the store mints the id and takes the undo snapshot. Esc and Cancel
  call `cancelBoxDraft`. `boxSelection` and `extractSelection` are retired, and the editor no
  longer opens by itself: `openBoxEditor(boxId: string)` only edits (row Edit, double-click).
  Law 6: `closeBoxEditorForSwap`, called first by every swap, drops an unnamed draft before
  the fold, and `resetAllSimState` idles `boxDrawing`. Undo and redo restore the draft that
  goes with the restored boxes (`draftIn`). The Boxes tile shows only once a placeable box
  exists (`palette.ts paletteBoxTiles`), and an open pop-out closes when its last row goes.
  New box is gone. The draft's buttons are placed by `canvasView.ts draftActionsAt`, which
  keeps them inside the canvas. The editor bar moved under the strip, so Undo and Redo stay
  in reach while a box is edited. The strip is Undo · Redo · Delete · Rotate · Clear, with
  undo, redo and rotate drawn from one inline-SVG set (`CanvasIcons.tsx`; Redo is Undo's own
  path, mirrored), and the "(shift+click to …)" hint uses the same Rotate icon.
- **Pins.** `boxEditorCheck` (61): [the BOX tool] (draft around a selection that includes
  wires, adjusting, no editor, no entry until confirm, 2 in · 1 out, loose parts plus a named
  outline still computing 0110, one undo per edit, arm/disarm, draw/cancel, undo while
  adjusting), [refusals] (done, editor open, FSM), edit reaches every copy (a drawn outline is
  not a copy), done copy kept, [refusals and swaps] (free end, taken name, self-containment, a
  switch mid-draft leaves no draft and saves none; mutation-tested: dropping the swap cancel
  fails 3 pins), and **[hw1 p4→p5]** on the real hw1.json (P4 boxed with the tool 4/4, P5 half
  adder 00,10,10,01, `gradeQuestion` 4/4, Submit P5 and P4 4/4). `workbenchCheck`: the box
  group's tiles, the BOX tile's source, no New box, the editor only edits, the canvas drafts
  only through the store, the store's lock first, the strip's icon set, the drafting hint and
  `draftActionsAt`. `navResetCheck`: no box draft after every swap, and the rotate hint's
  icon. `themeCheck`: `CanvasIcons.tsx`. `provenanceCheck`: the box id is `startBoxDraft`'s
  mint, and the canvas mints none.
- **Gates.** app-tsc=0 tools-tsc=0 app-build=0 app-check=0 server-typecheck=0 server-check=0;
  `check-budgets` ok (CLAUDE.md 39,980 bytes).
- **Headless check after the fix** (same setup; the screenshots are the attachments): on P4
  with no boxes the palette ends in **BOX** alone, and after the first box it ends in
  BOX · Boxes (1), both standing and flat (`-6-palette-no-boxes-200.png`,
  `-7-palette-with-boxes-popout.png`, `-8-palette-flat.png`). BOX with nothing selected arms
  NEW_BOX: aria-pressed, crosshair, and the hint "Drag a rectangle around the parts to box
  them. Esc cancels."; Esc disarms. A rubber band over the whole XOR followed by BOX gives a
  draft, the hint "Drag the corners to fit the box, then press Ready to Box. Esc cancels.",
  no editor and no entry yet, with Ready to Box inside the canvas
  (`-2-draft-around-selection.png`). Ready to Box gives a 2 in · 1 out entry and focuses the
  name field. Typing XOR + Enter names the outline and the library entry
  (`-3-named-outline.png`). P4 grades 4/4. On P5 the pop-out has no New box. Clicking the XOR
  row and then the canvas places a copy. After wiring, Run on each output-panel row fills
  00→00, 01→10, 10→10, 11→01 (`-4-p5-half-adder-run.png`), and Submit records P5 4/4 and P4
  4/4. A rectangle drawn on P5 becomes a draft with its ports highlighted. Going to P4
  mid-draft leaves no draft and no Ready to Box, and P5's saved boxes stay empty. The row's
  Edit opens "Editing box XOR" with the bar under the strip. The strip at 200% is in
  `-5-strip-200.png`. No console errors, no alerts.
- **Owed (not claimed):** Gabriel's eyeball of the palette and strip at 100%/200% by hand. The
  app has no dark theme, so "light and dark" is light only. Also owed: the drag feel of
  drawing and adjusting a draft, and the same P4 → P5 path in **remote mode** ("Vite Remote
  Mode" + the local server on 8199). No remote-specific code changed: the store is
  mode-agnostic, law 5 adds no /api traffic, `remoteStoreCheck` and the server's parityCheck
  are in the gates. Recipe: HW1 as a student, build the XOR on P4, select all → BOX → Ready
  to Box → name it XOR → P5 → Boxes → XOR → click the canvas → wire the half adder → Run
  each row → Submit.
- **Out of scope, seen in passing:** a pop-out row cuts a short name to "X…" beside "Add to
  toolbar" (it did this before too, `-7-…`). The editor bar still says "New box" for a placed
  copy whose library entry was removed (saving puts it back).

### 2026-09-29 — review fixes (robot)
- **An unnamed draft is never saved, loaded or revived** (review 1 and 5). The review
  reproduced it: the debounced autosave folded the live draft into the workbook, and after a
  reload the first undo after any edit turned it back into a stale 'Ready to Box'. Now
  `store.ts namedBoxes` keeps unnamed boxes out of every save and fold (`liveCanvas`, so
  `foldLiveProblem`, `sandboxTabCircuits`, the unload flush and the crash journal), the
  sandbox's own tab saves and its file export, and out of every load (`loadProblemFields`,
  the autosaved sandbox tabs, an imported file). That also drops the unnamed boxes that
  workbooks saved before 085 may hold. A history snapshot now records the draft it was taken
  with (`HistoryEntry.draftId`, `historyEntryOf`). Undo and redo bring back that draft and no
  other unnamed box, and they drop any orphan (`restoredBoxes`, which replaces `draftIn`).
- **Cancel leaves no no-op undo** (review 6). `cancelBoxDraft` also pops the snapshot
  `startBoxDraft`'s `addBox` took, while it is still on top. Every snapshot pushed after it
  holds the draft, so a top without the draft is that one. This covers Esc, Cancel and every
  swap.
- **The BOX tile shows in the box editor, dimmed** (review 3). It uses `pal-tile--off`,
  `aria-disabled`, and the refusal "Save or cancel the box you are editing first." as its
  title, and a click does nothing. That is how a disallowed part is shown (dimmed, never
  hidden), so the Done-when's "shows on every canvas that may hold boxes" holds as written.
  `palette.ts BOX_TOOL_EDITING_REFUSAL` is the one string: `paletteBoxTiles` returns it, and
  the store's `boxTool` answers with it (`-9-editor-box-tile-dimmed.png`).
- **Ports: one per cut wire end, recorded as the chosen rule** (review 4). This is the
  textbook's Rule 3, as `confirmBox` has applied it since task 038. The retired ▣ Box merged
  cut ends by source, so boxing the XOR's four gates without its IN nodes now gives 4 inputs.
  Boxing it with them, as P5's hint ("box your XOR circuit") reads, gives 2. That is now in
  `editor-workbench.md` §Making and editing a box and in the BOX tile's tooltip.
- **Remote mode run end to end, and no longer owed** (review 2). Recipe in `## Verify`.
  Server on :8199 (dev auth, scratch DB, HW1 seeded and published), Vite remote on :5192,
  headless Chrome, as the toy student:
  - Signed in through the form. The student copy has no `test_cases`.
  - On P4 the palette ends in BOX alone. Rubber-band select → BOX gives a draft (adjusting,
    no editor).
  - The autosave during the draft reached the server ('saved'), and the server's workbook
    held no boxes for P4.
  - Ready to Box → XOR gives a 2 in · 1 out entry and the outline XOR:7, both saved to the
    server.
  - A reload brought back the 7 parts, the outline, the library and no draft. The palette
    now ends in BOX · Boxes 1.
  - On P5 the pop-out's XOR row plus a canvas click placed the copy. After wiring, Run on
    each row filled 00→00, 01→10, 10→10, 11→01. The render is pixel-identical to the local
    `-4-p5-half-adder-run.png`.
  - Submit recorded attempt 1. The server graded P4 4/4 and P5 4/4, read as the instructor.
  - In the box editor (Edit from the pop-out), the BOX tile was dimmed with the refusal, and
    clicking it armed nothing.
  - No console errors, no alerts.
- **Pins.** `boxEditorCheck` (71):
  - the first undo after Cancel is a real one;
  - an orphan unnamed box is dropped by an undo and never revived;
  - **[ports: one per cut end]**: gates-only XOR is 4 in · 1 out;
  - **[a draft is never saved]**: the autosave during a draft saves no unnamed box; a
    workbook saved with one loads without it, and no undo brings it back.

  Each new pin was mutation-tested: undoing its fix fails exactly that pin. `workbenchCheck`
  now pins the dimmed BOX tile in the editor, its markup, and the one refusal string.
- **Gates.** app-tsc=0 app-build=0 app-check=0 server-typecheck=0 server-check=0.

### 2026-09-29 — implemented (work loop)
- **Built.** Boxing has one way in: the palette's **BOX** tile (a dashed box with a +). With
  parts selected it drafts a box around them; with nothing selected it arms the draw tool
  (crosshair, hint, Esc). Ready to Box names it in place, and the editor only edits a library
  box (pop-out Edit, double-click a copy). The Boxes tile appears once a placeable box
  exists. The strip is Undo · Redo · Delete · Rotate · Clear, with one inline-SVG icon set
  (`CanvasIcons.tsx`). **The failure behind `fb-mun6rftv-2cafxh`** was the UI, not the
  machine: ▣ Box swapped the canvas for an editor that called the new box "Editing box",
  the draw tool had no entry, and a draft leaked across problems and into saves. Retired
  `boxSelection`/`extractSelection`; unnamed drafts never save, load or come back by undo.
- **Pins.** `boxEditorCheck` 71 ([the BOX tool], [refusals and swaps], [ports: one per cut
  end], [a draft is never saved], [hw1 p4→p5] on the real hw1.json); `workbenchCheck`
  (box group tiles, dimmed BOX in the editor, one refusal string, strip with no Box, icon
  set); `navResetCheck` (no draft after every swap); `themeCheck` (`CanvasIcons.tsx`);
  `provenanceCheck` (the box id is `startBoxDraft`'s mint).
- **Gates.** app-tsc=0 app-build=0 app-check=0 server-tsc=0 server-check=0. Re-run at
  checkpoint: app-tsc=0 tools-tsc=0, boxEditorCheck 71/0, workbenchCheck ok, navResetCheck
  773/0, boxScopeCheck 236/0, check-budgets ok (CLAUDE.md 39,980 bytes).
- **Review.** Fixed 6 of 6 (1 major: drafts saved; 5 minor: undo revives drafts, no-op
  undo after Cancel, BOX dimmed not hidden in the editor, port rule recorded, remote run
  done). Skipped none.
- **Owed.** Local and remote P4 → P5 runs are done headless (entries above). Still owed, by
  hand: Gabriel's eyeball of the palette (standing, flat; 0 boxes, 1 box, editor open) and
  the strip at 100%/200% (light only: the app has no dark theme), and the real-pointer drag
  feel of drawing and resizing a draft (recipes in `## Verify`).
- **Next step:** loop session: visual check if owed, then land per PROFILE §5.
