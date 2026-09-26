---
id: 2026-09-25-054
type: feature
title: Replace the parts column with a floating, draggable palette and a Boxes pop-out where boxes can be pinned (editor redesign 3 of 6)
priority: normal
size: large
requires: browser
area: app
source: inbox
created: 2026-09-25T16:15:00-07:00
status: done
after: 2026-09-25-053
branch:
merged_into:
---

## Description
Step 3 of the editor workbench redesign. The spec and the chain are in
`docs/buildout/designs/editor-workbench.md` and task 052. This step covers the memo's
§Floating palette and §Boxes: the pop-out and pinning.

The 64px `ComponentLibrary` column on the left becomes a palette that floats inside the
canvas:
- **Moving it:** a grip drags it, and a turn button flips it between vertical and
  horizontal. Both persist.
- **The tiles:** each part has an icon tile, grouped I/O · Gates · Boxes.
- **Placing parts:** drag a tile onto the canvas, or click it to arm it and then click the
  canvas.
- **The Boxes tile:** it opens a pop-out listing the homework's boxes. There they can be
  renamed, deleted, placed, armed, or pinned to the palette as their own tiles.
- **The New box tool:** it keeps the existing draw-a-rectangle behaviour.

## Done when
- **Placing parts.** Every part can be placed both ways: drag with a 55% ghost that drops
  snapped at the pointer, or click to arm and then click. Shift keeps a tool armed, and Esc
  disarms it. Box rows and pinned box tiles can be placed and armed the same way.
- **Disallowed parts (decision 3).** Parts that `allowed_components` excludes are dimmed to
  0.3 with the tooltip "OR is not used in this problem" and do nothing when clicked. The same
  goes for boxes whose insides use an excluded part, which are hidden today.
- **Moving the palette.** Its position (clamped 8px inside the canvas) and orientation
  persist in `uiPrefs`. Mode rules are unchanged: FSM/TM show STATE only, a turbot follows
  its inner mode, and MEM appears only where `selectMayHoldMemory` allows it.
- **Pinning boxes.** A box can be pinned by dragging its row onto the palette, where the
  palette border turns `--mm-accent` while the drop is valid, or with "Add to toolbar". It is
  unpinned from the pop-out. Pins are kept per homework, and a pinned id that doesn't resolve
  is skipped silently.
- **Deleting a box (decision 7).** Deleting from the pop-out removes the box from the library
  and the palette only. Every placed copy, on every question, stays.
- **Closing the pop-out.** × closes it, as do Esc and a click on empty canvas.
- **The box meta line** reads "2 in · 1 out · Problem 1" when the origin is known (F11).
- **Deletions.** The old `ComponentLibrary` column is gone.
- **Gates.** `boxScopeCheck`, `pasteCheck` and `navResetCheck` are green, along with every
  gate in PROFILE §6.

## Design
**deepFix.** The armed tool becomes one tagged value: `selectedTool: ComponentType |
'NEW_BOX' | {box: id} | null` (today `store.ts:963`, set by `setSelectedTool` :3928). With
it, a gate tile, a box row and a pinned tile all place through one path, and the canvas's
click-to-place (`CircuitCanvas.tsx:3069-3075`) and drop handler (:1989-2008) each gain one
branch instead of a special case per source. The pop-out, the palette and the pins read one
pure selector: the library filtered by `selectPlaceableBoxKinds` (`store.ts:512`), annotated
with allowed / disallowed.

**surgicalFix.** Re-skin `ComponentLibrary` in place and keep the box items' fixed-position
click placement. That leaves box arming broken, as it is today (see below).

**Code as it stands (read 2026-09-25).**
- **Arming and placing:**
  - Clicking a palette item arms it (`ComponentLibrary.tsx:293-299`), and clicking it again
    disarms it.
  - Today repeated background clicks keep placing copies without Shift. The memo wants Shift
    to keep the tool armed; follow the memo.
  - Drag uses `dataTransfer 'componentType'` (:261-264).
  - Right-click disarms, on the canvas (:3643-3657) and on the palette (:269-275).
- **Box items:**
  - A click places the box at a fixed (200,200) (:175-177).
  - `isSelected` compares against `'BOX:'+id` (:358), which nothing ever sets, so it is dead
    code. Retire it with the tagged tool.
  - `ConfirmedBoxItem` (:121-228) holds the rename (✎) and ✕ delete, which has no confirm.
    The canvas has its own library delete at :1735.
- **Allowed parts:** the filter at `ComponentLibrary.tsx:250-251` uses
  `selectAllowedComponents` (`store.ts:183`) and `isComponentTypeAllowed`
  (`engine/machineValidation.ts:72`). Boxes are hidden at :343-347. Switch both from hiding to
  dimming (decision 3). Stage-1 grading and `canvasPasteVerdict` still enforce the rule, so
  dimming is presentation only.
- **The box library:**
  - `ConfirmedBoxDef` (`types.ts:811`) has a stable `id`: `renameBox` (`store.ts:2635-2675`)
    maps only the name. So pins by id survive renames.
  - The library is per homework in an assignment and per tab in the sandbox
    (`store.ts:876-886`).
- **Delete (decision 7):** `removeConfirmedBox` (`store.ts:2603-2635`) strips instances from
  the live canvas only. Its comment ("the library is per-canvas", :2620-2621) is stale: the
  library is per homework. Placed copies carry their own `internalCircuit`, so they keep
  working without the library entry. Make delete library-only and fix the comment. Pin in
  `boxScopeCheck` that deleting a box from the library leaves a placed copy on another
  question, and on this one, intact and still evaluating the same.

### Resolved decisions
Gabriel, 2026-09-25 (catch):
- **3. Disallowed parts:** dim with a tooltip, not hide.
- **7. Deleting a box** from "Your boxes" removes it from the library and the palette only.
  A library action never destroys placed work.

### Where the memo meets the code (flagged at filing)
- **F11. "Problem 1" in the box meta line needs data the library lacks.**
  - `ConfirmedBoxDef` records no origin question, and the memo says "no new domain state
    except pinned boxes".
  - Recommended: an optional `origin?: questionId` on `ConfirmedBoxDef`, stamped at
    `confirmBox`. It is additive and workbook-compatible (old boxes show no suffix). Check that
    `workbookFile.ts` validation accepts it.
  - The alternative is to drop the suffix.
- **F12. Pins are a per-browser cosmetic pref.** They live under
  `uiPrefs['pinnedBoxes:<asgId>']` (see 052 F7) and are never saved in the workbook. A shared
  computer can hold pins that don't resolve for the current person, and those are ignored.

## Verify
- **Gates:** everything in PROFILE §6. The fast loop is `boxScopeCheck`, `pasteCheck` and
  `navResetCheck`.
- **Pins:** delete is library-only (decision 7). A box placed from a pinned tile equals one
  placed from the pop-out (same `boxedCircuitId`, same key).
- **Browser (requires: browser):**
  - On HW1, place every part by drag and by click-arm, with Shift for multiples and Esc to
    stop.
  - Drag the palette, turn it, and reload.
  - On a question with `allowed_components`, check the dimmed tiles and their tooltips.
  - Make a box with New box, then pin it by drag and by button. Rename it (the tile follows),
    delete it (placed copies stay), and check the palette.
  - Check the sandbox and an SC question (SC boxes, MEM).
  - Screenshot at 1280 and 1024 wide.

## Progress log

### 2026-09-25 — built, verified, landed (/work, with 058)
- **The palette** (`components/Palette.tsx`; pure decisions in `src/palette.ts`, pinned by
  `workbenchCheck [palette]`): floats in the canvas at (14,14), grip-dragged and clamped 8px
  inside, turned flat/upright; both in `uiPrefs['editor.palette']`. It runs whichever way
  fits the canvas (`paletteOrientation`), and the turn button stands down when the other
  way wouldn't fit. Found in the 1024px pass: a flat palette in the ~400px canvas clipped
  its own turn button. Tiles are 58px with the memo's 36×26 stroked icons, grouped
  I/O · Gates · Boxes. FSM/TM show State only (no Boxes group). MEM appears only where
  `selectMayHoldMemory`. There is no visible machine label (the aria-label names it).
- **One tool, one placement path.** `selectedTool: ArmedTool` (`palette.ts`: a part |
  `'NEW_BOX'` | `{box}`) and the store's `placeTool(tool, x, y)` (centred, snapped) serve
  both the canvas click and the palette drop. A plain click places one and disarms; Shift
  keeps the tool armed; Esc disarms. The drag is pointer-driven: `components/paletteDrag.ts`
  is a tiny store, so only the canvas's `PaletteGhost` re-renders, and it draws the real
  part at 55%. The HTML drag-and-drop path (`handleDrop`, `dataTransfer`) is gone.
- **Decision 3.** An excluded part is dimmed at 0.3 with "OR is not used in this
  problem" and does nothing. A box whose insides use one is dimmed too ("This box uses
  OR, …").
- **Boxes pop-out.** A count badge; rows show "2 in · 1 out · Problem 1" (F11:
  `ConfirmedBoxDef.origin`, stamped by `confirmBox` in an assignment; the workbook file
  already accepted extra fields). A row can be renamed (paste-guarded), deleted, clicked
  to arm, dragged to place, or dragged onto the palette to pin it (the border turns
  accent while over it). The pin button reads "Add to toolbar" / "On toolbar" and
  unpins too. Pins live in `uiPrefs['pinnedBoxes:<asgId>']` (`:tab:<id>` in the sandbox);
  unresolved pins are skipped (F12). The New box button arms the existing draw tool. The
  pop-out closes on ×, Esc, a click on empty canvas, and a canvas swap
  (`boxesPopoutOpen` in the store, reset by `resetAllSimState`).
- **Decision 7.** `removeConfirmedBox` drops only the library entry and its drawn outline
  (it also disarms the box if it was armed). Every placed copy stays. The stale
  "per-canvas" comment is gone. Pinned in `boxScopeCheck [library delete]`: the copy on
  this question and the one on another keep the AND table, the enclosed parts stay, and
  undo restores the entry. `[placing]`: placeTool is centred and snapped, and a box
  placed through it equals placeBoxInstance's (same box id, same graded key). `[origin]`
  is pinned there too.
- **Styles** in `workbench.css` (literal-free): three shadow tokens were added to
  `theme.css`, the old `.component-library`/`.library-*` rules were removed, and the
  `themeCheck` ratchet went from 174 to 168. `Palette.tsx` is in the style gate's list,
  and `pasteCheck` guards `Palette.tsx` in place of `ComponentLibrary.tsx`.
- **Browser (local, 1280 and 1024):**
  - Every part placed by click-arm and by real drag; the ghost at 55%, centred; Shift
    placed several, Esc disarmed.
  - The palette was dragged (clamped), turned, and reloaded (both persisted).
  - HW1 P2: OR dimmed with its tooltip, inert to click and drag. An OR box made on P1
    was dimmed there, with meta "· Problem 1".
  - Pinning by button and by drag (accent border), unpinning, and placing from a row
    and from a pinned tile all worked. Renaming updated the tile and every copy.
    Deleting kept all 3 copies and dropped the pin and the badge.
  - ×, Esc, a canvas click and a question change each closed the pop-out. New box drew.
  - HW3 (SC) shows MEM; HW4 (FSM) shows State only, and a state places.
  - No console errors.
- **Gates green:** app tsc, tools typecheck, build, `npm run check`, server `npm run check`.
- **Owed / for 055–057:** Fit and the hint line (055) are unbuilt. At 1024 the canvas
  column is ~400px, so the 260px pop-out covers the canvas's action group while open
  (it closes on ×, Esc or a canvas click). Existing circuits near the canvas's top-left
  can sit under the palette until Fit lands.
