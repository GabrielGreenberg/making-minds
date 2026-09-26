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
status: in-progress
after: 2026-09-25-053
branch: task/054-editor-floating-palette
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
