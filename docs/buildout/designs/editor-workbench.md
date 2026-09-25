# Handoff: the question editor as a workbench (HW1 / CC pass)

Suggested home in the repo: `docs/buildout/designs/editor-workbench.md` (this file, as the design memo), with `inbox-note.md` dropped into `tasks/inbox/` for `/catch` to file as tasks.

## Overview

This redesigns the student's per-question editor (`App.tsx` → `MenuBar` · `TabBar` · `SimulationToolbar` · `ComponentLibrary` · `CircuitCanvas` · `DataTable`). The goals:

- Put the current problem first.
- Let a student see the goal (a table, a figure or prose) and their machine's output side by side.
- Gather run controls into one place.
- Give the editor the site's visual language (Plex, flat, magenta).

The design was settled over three rounds of review with Gabriel. **This pass covers combinational circuits (CC) plus open and fill-in questions (all of HW1).** SC, FSM, TM and turbot must keep working inside the new shell unchanged, and they get their own design session later.

## About the design files

`Editor Prototype.dc.html` is a **design reference built in HTML**. It is a working prototype that shows the intended look and behaviour. It is not code to port. Rebuild it in the app's existing React + TypeScript + Zustand structure, through its seams. In particular:

- **Canvas internals are stand-ins.** The prototype has its own tiny evaluator, wire router, snapping and hit-testing. The real `CircuitCanvas`, `componentGeometry.ts`, `wireRouter.ts` and `engine/` stay the source of truth. Only the *appearance* spec below (gate geometry, symbols, type, colour) is meant to change them.
- **"Box this circuit"** in the prototype boxes the whole canvas. The real app keeps its NEW_BOX draw-a-rectangle tool (see Boxes).
- **Save, submit and grading are faked.** Use the existing `WorkbookStore` and `SubmissionStore` seams and the save indicator states.

Open it in a browser next to `support.js`. The Tweaks panel has a "Fresh / Mid-assignment" start state and a toggle for palette labels. "Reset demo" in the top bar restores the start state.

## Fidelity

**High-fidelity** for layout, type, colour, sizes, and gate geometry and symbols. Pixel values below are final unless marked *(tunable)*. Colours are given as their `--mm-*` token from `theme.css` wherever one exists. The editor should move off its own grey/blue tokens in `index.css` (`--accent: #2a7fff` etc.) onto the page tokens. That retires review item 08, "two visual languages".

## Layout (whole screen)

```
┌ top bar 48px ─────────────────────────────────────────────────────────────┐
├ band 4px (--mm-lav) ──────────────────────────────────────────────────────┤
│ QUESTION PANEL  ┃ CANVAS (flex 1)                          ┃ OUTPUT PANEL │
│ 320px (260–480) ┃  floating palette · undo/redo/delete ·   ┃ 300 (240–480)│
│ collapsible→40  ┃  zoom · hint line                        ┃ collapsible→40
└─────────────────┸───────────────────────────────────────────┸──────────────┘
```

- One full-height flex column (`100vh`). The top bar and band are fixed. The body row is `flex:1; min-height:0`.
- Both vertical dividers are **drag handles** (resize), and each side panel **collapses** to a 40px strip.
- **Open and fill-in questions:** same shell and same question panel. The canvas area becomes the answer area, and the output panel is not rendered.
- **Sandbox (no assignment):** there is no question panel. The worksheet tabs (`TabBar`'s sandbox branch) stay as a strip above the canvas. Everything else is the same.

### Top bar (replaces `MenuBar` + the question half of `TabBar`)
- Height 48, `--mm-surface`, bottom border 1px `--mm-line`, padding `0 20px`, gap 18, items centred.
- **Brand:** "Making Minds" in `--mm-font-serif` 700 17px, then "PHIL 133" in 11px/600, letter-spacing `.09em`, colour `--mm-accent`, gap 10. `white-space:nowrap; flex-shrink:0`. Links to Home.
- **Breadcrumb:** "Assignments / HW1. Basics: …" at 13.5px `--mm-ink-3`. The current segment is `--mm-ink` 500 and links to the assignment overview (this replaces "‹ Questions"). The separator "/" is `--mm-line-2` with 4px padding. It truncates with an ellipsis; the brand never wraps.
- **Right, pushed with margin-left:auto:**
  - the save state at 12.5px `--mm-ink-3`: "Saving…", "Saved just now", "Saved N min ago", or the remote `'error'` state in `--mm-danger`
  - after a submit, "Submitted 3:42 pm" at 12.5px `--mm-ink-2`
  - the **Submit assignment** primary button (`.mm-btn--primary`, 13px/600, padding `6px 12px`), which reads "Submit again" once submitted
  - the session controls (name ▾, Feedback, Log out), 13.5px `--mm-ink-2`
- Visitor mode keeps its chip, Sign in and `VisitorBanner` under the band.
- Band: 4px `--mm-lav`. The site uses 14px; the editor deliberately uses 4px to save height.

### Question panel (left)
Background `--mm-bg`. Three stacked parts.

**1. Nav strip.**
- 34px tall, background `#F7F5FA`. This needs an app-only token, e.g. `--mm-surface-3`, or use `--mm-surface-2`.
- Bottom border 1px `--mm-line`, padding `0 6px 0 10px`, gap 2.
- **← Prev** and **Next →** are text buttons, 26px tall, padding `0 8px`, 12.5px/500 `--mm-ink`, hover background `--mm-lav-soft`. Disabled: `--mm-ink-3` at 45% opacity, no action.
- Then, right-aligned, "4 of 23" at 12px `--mm-ink-3`, tabular numbers.
- Then the collapse button "«": 28×26, `--mm-ink-3`, hover `--mm-accent` on `--mm-lav-soft`.

**2. Current question.**
- Background `--mm-surface`, padding `16px 20px 22px`, flex column, gap 12, `max-height:64%` with its own scroll.
- **Section eyebrow:** the section heading, e.g. "I. COMBINATORIAL CIRCUITS", 11px/600 uppercase, letter-spacing `.08em`, `--mm-accent`.
- **Title:** "Problem 1 · NAND" (title, or just "Problem 6a"), `--mm-font-serif` 19px/600, line-height 1.25, `--mm-ink`, `text-wrap:balance`, margin-top −6.
- **Statement:** through `StatementBody` / `ProblemBody` at 15px/1.5 `--mm-ink-2`, bold `--mm-ink` 600, 10px paragraph gap. For CC questions whose statement is a profile, show the section intro ("Design **combinatorial circuits** with the following input-output profiles:") followed by the goal table.
- **Goal table:** built from the profile or `test_cases`, headers IN1…INn | OUT (or OUT1…).
  - Cells: fixed 60px wide, centred, padding `8px 0`, 14px.
  - Headers: sans 11px/600, `.08em`, `--mm-ink-3`, padding `6px 0`.
  - Rules: 1px `--mm-line-2` under the header, 1px `--mm-line` between rows, and 1px `--mm-line-2` on the left of the first output column.
  - The digits are Plex Mono today. Gabriel dislikes mono **on the canvas**; tables are unconfirmed. See Open questions.
- **Figures:** `question.figures` at their authored width, max 100%.
- **Caution callouts** (`kind:'caution'`) are **always visible**: a block on `--mm-warn-soft`, padding `10px 12px`, 14px/1.45, with a bold "Caution: " prefix in `--mm-warn`.
- **Hints:** the question `hint` plus `kind:'hint'` question callouts sit behind a link "▸ Hint" / "▾ Hint", 13.5px/500 `--mm-link`. Expanded: a block on `#F7F5FA`, padding `10px 12px`, 14px, "Hint: " bold.
- **Section notes:** the section's callouts sit behind a second link labelled by kind, e.g. "▸ Hint for this section" or "▸ Challenge problem (optional, not collected)". Same expanded style.
  - Both links are closed by default, and both reset closed on question change.
  - This replaces today's "▶ Note for this section".
- **Done mark:** "I'm done with this question", 13.5px `--mm-ink-2`, with a 32px min hit height. The box is 18px square: border `#B9B2C4` when unchecked; when checked, fill and border `--mm-accent` with a white ✓ at 12px. See Open questions on locking.

**3. Question list.**
- **Header band:** 34px, `--mm-surface-2`, top border 1px `#CFC8D8` and bottom border 1px `--mm-line`. It is the visual divider from the current question. Text "HW1 · QUESTIONS" in 11.5px/600 uppercase, `.09em`, `--mm-ink`, padding `0 20px`.
- **The list** takes the remaining height and scrolls. It is grouped by `documentSections`.
- **Section label:** 10.5px/600 uppercase, `.08em`, `--mm-ink-3`, padding `12px 20px 4px`.
- **Rows:**
  - Grid columns `30px minmax(0,1fr) auto 50px`, gap 8, min-height 36, padding `0 20px`, 13.5px. The whole row is clickable and navigates.
  - **Number:** "6a", 12px mono `--mm-ink-3`.
  - **Name:** the title, or "Problem 6a" in `--mm-ink-3` if untitled. Truncates with an ellipsis.
  - **Type tag** (`questionModeLabel`): CC as `.tag--accent` (mono 10.5/600); "Written" or "Number" in sans 10.5/500 `--mm-ink-2` on `--mm-surface-2`.
  - **Status:** "done" at 11.5px/600 `--mm-accent` (the student's mark), or "started" at 11.5px `--mm-warn` (has any part or answer text), else empty.
  - The current row is `--mm-lav-soft` and weight 600. Hover is `--mm-lav-soft`.
  - **Never** show grading or target matches here. Status comes only from the student.

**Collapsed strip:** 40px, `--mm-surface`, right border 1px `--mm-line-2`, clickable. It shows "»" (30×30, `--mm-accent`) at the top, then the question title set vertically (`writing-mode:vertical-rl`) in serif 15px/600.

### Dividers (both)
- 9px hit area with `margin:0 -4px` (so the net layout width is 1px), `cursor:col-resize`, `touch-action:none`, z-index above the panels.
- Visible parts:
  - a 1px `--mm-line-2` line
  - a centred grip: 7×30, `--mm-surface`, border 1px `#CFC8D8`, holding a 1×14 `#B9B2C4` stroke
- Hover background: `rgba(194,85,185,.12)`.
- Clamps: left 260–480, right 240–480 *(tunable)*.

### Canvas
- `--mm-surface` with a dot grid: `radial-gradient(#DAD4E2 1px, transparent 1.2px)`. The spacing is `GRID_SIZE × zoom`, and `background-position` follows the pan.
- **Top-right, 14/12 from the edges:** a joined button group, border 1px `--mm-line-2`, 13px: "↶ Undo" · "↷" · "Delete". Each is padding `6px 12px` with a `--mm-line` divider between them. Disabled items are `--mm-ink-3` at 45%.
- **Bottom-right, 12/12:** zoom group "−" · "100%" (mono 11.5, min-width 48) · "+" · "Fit", 12.5px, same style.
  - Fit centres the circuit in the space not covered by the palette, **never below 80% zoom**. If the circuit is wider than that, it left-aligns and the student pans.
- **Bottom-left, 16/14 (right edge clears the zoom group):** a one-line hint at 12.5px `--mm-ink-3` on `rgba(255,255,255,.85)`, ellipsis, `pointer-events:none`. The text depends on state:
  - a tool is armed: "Click the canvas to place AND. Shift-click to place several. Esc cancels."
  - a part is selected: "Drag to move. Delete removes it."
  - a wire is selected: "Delete removes this wire."
  - there are parts but no wires: "Drag from one dot to another to connect parts."
  - otherwise: "Click an input to switch it between 0 and 1."
  - an empty canvas shows no hint line.
- **Empty canvas:** a centred message, 15px `--mm-ink-3`, max-width 340: "Drag parts from the toolbar onto the canvas, or click a part and then click here."

### Floating palette (replaces the 64px `ComponentLibrary` column)
- Absolutely positioned inside the canvas, default (14,14). `--mm-surface`, border 1px `--mm-line-2`.
- Shadow `0 2px 8px rgba(3,13,36,.08)`; while dragging, `0 10px 28px rgba(3,13,36,.22)`.
- It is a flex column (vertical) or row (horizontal). Its position is clamped 8px inside the canvas.
- **Order of parts:**
  1. **Grip:** a 16px band on `#F7F5FA` with a 5-dot glyph (12×12, dots r1.2 `--mm-ink-3`), `cursor:grab`. Dragging it moves the palette.
  2. **Group I/O:** Input, Output.
  3. 1px `--mm-line` divider.
  4. **Group Gates:** AND, OR, NOT, plus XOR/HA/MEM where the mode allows them (they're not designed yet, so use the same tile).
  5. Divider.
  6. **Group Boxes:** pinned box tiles, then the **Boxes** tile.
  7. Divider.
  8. **Turn button:** 24px band with a rotate glyph. It toggles vertical ⇄ horizontal and re-clamps the position.
- **Tiles:**
  - 58 wide, min-height 44, padding `7px 0 6px`, gap 4. Icon 36×26 above a label at 10.5px/500 `--mm-ink-2`.
  - Hover `--mm-lav-soft`. Armed (click-to-place) `--mm-lav-soft`.
  - A part disallowed by `allowed_components` gets opacity .3, tooltip "OR is not used in this problem", and no action. This follows `selectAllowedComponents`; decide dimming versus hiding (see Open questions).
  - **Two ways to place:**
    - Drag a tile onto the canvas (a ghost preview at 55% opacity follows the pointer, and dropping places the part centred on the pointer and snapped).
    - Click a tile to arm it, then click the canvas. Shift keeps it armed, and Esc disarms.
- **Tile icons** are stroke 1.6 `#2A2A2A`; symbols are drawn with round caps and joins:
  - Input: rect 4,5 16×16, stub to 30,13, dot r2.2
  - Output: mirrored
  - AND: `M8 3 H18 A10 10 0 0 1 18 23 H8 Z` with ∧ `M13 16 L16.5 9.5 L20 16`
  - OR: `M7 3 H15 Q27 4 31 13 Q27 22 15 23 H7 Q11 13 7 3 Z` with ∨ `M14 10 L17.5 16.5 L21 10`
  - NOT: `9,3 30,13 9,23` with ¬ `M12 11.5 H17.5 V15`
  - Box: rect 8,4 20×18 on `#F7F5FA` with two left stubs and one right stub
  - Boxes: two offset rects plus a small ▾ corner mark
- The palette position, orientation, and the panel widths and collapse states persist per student through `uiPrefs.ts` (keys suggested: `editor.leftW`, `editor.rightW`, `editor.leftOpen`, `editor.rightOpen`, `editor.palette = {x,y,horiz}`).

### Boxes: the pop-out and pinning
- The **Boxes** tile shows a count badge: 16px min, `--mm-accent` background, white, mono 10/600, top-right. Clicking the tile toggles the **Boxes pop-out**.
- **Pop-out position and frame:**
  - 8px to the right of the palette (vertical) or 8px below it (horizontal).
  - 260 wide, `--mm-surface`, border 1px `--mm-line-2`, shadow `0 10px 28px rgba(3,13,36,.16)`.
- **Header:** "YOUR BOXES" as an eyebrow, with a close button "×".
- **Empty state:** "Boxes you make are kept here and can be used in later questions."
- **Box rows** list the homework's `confirmedBoxLibrary`:
  - Grid `36px 1fr auto`, padding `8px 12px`.
  - Contents: the icon; the name at 13.5px/600; a meta line at 11.5px `--mm-ink-3` reading "2 in · 1 out · Problem 1" (the question it came from); and a pin button, 12px, padding `4px 8px`, reading "Add to toolbar", or "On toolbar" in `--mm-accent` on a `--mm-lav-line` border.
  - **A row can be:**
    - dragged onto the canvas to place the box
    - dragged onto the palette to **pin** it (the palette border turns `--mm-accent` while it's a valid drop)
    - clicked to arm it
  - Rename and delete stay here, using today's `ConfirmedBoxItem` actions and `renameBox`.
- **Footer:** the **New box** tool button (full width, 34px, border `--mm-line-2`, 13px/600, hover `--mm-lav-soft`). It arms the existing NEW_BOX draw tool. Under it, at 12px `--mm-ink-3`: "Drag a box onto the toolbar to keep it there."
- **Pinned boxes:** a per-homework list of box ids (a cosmetic pref, e.g. `uiPrefs['pinnedBoxes:<asgId>']`). They render as palette tiles showing the box name, truncated at 54px. Unpin from the pop-out. If a pinned box is deleted, it drops off the palette silently.
- Scoping rules are unchanged: `selectPlaceableBoxKinds`, and the per-homework library.

### Output panel (right; replaces `SimulationToolbar` + `DataTable` for CC)
- `--mm-surface`, padding `16px 22px`, flex column, its own scroll.
- **Header row:** "OUTPUT" as an eyebrow (11.5px/600 uppercase `.09em` `--mm-ink-3`), with a collapse button "»" (32×32) on the right. No other title: "Your circuit" and the explainer line were removed on purpose.
- **Controls,** 8px below: Run · Step · Reset.
  - Each is 34px tall, padding `0 12px`, 13px/600, border 1px `--mm-line-2`, hover `--mm-lav-soft`. The ▶ is `--mm-accent`, and Run becomes "■ Stop" while running.
  - For CC: Run walks the table rows (one every 700ms), Step advances to the next row, and Reset sets every input to 0.
  - This is the **only** run-control set on screen. Delete the toolbar Reset and the second Reset under the table.
- **The table,** 14px below: the circuit's live input/output table, styled like the goal table.
  - A value of 1 is `#E53935` at weight 600.
  - The row matching the current inputs is `--mm-lav-soft`.
  - Clicking a row sets the canvas inputs to that row.
- **Note** under the table, 10px below: "Click a row to set the inputs." at 12.5px `--mm-ink-3`.
- **Empty:** "Add at least one Input and one Output to see your circuit's table."
- **Collapsed strip:** 40px, left border 1px `--mm-line-2`, "«" at the top, and "OUTPUT" set vertically at 11.5px/600.
- **SC, FSM, TM and turbot this pass:** the panel keeps today's `DataTable` content for those modes (timeline, Map, tape and so on) inside this frame, under the same header and the one control row. Do not redesign them yet.

### Open and fill-in answer area (replaces the full-width `OpenResponsePanel` / `FillInPanel` layout)
- The centre column becomes `--mm-surface` with padding `40px 48px`, content max-width 640.
- An eyebrow "YOUR ANSWER".
- **Open questions:** a textarea, min-height 260, border 1px `--mm-line-2`, padding `14px 16px`, 16px/1.6, vertical resize only, placeholder "Write your answer here."
- **Fill-in questions:** a grid `repeat(auto-fill, minmax(160px,1fr))`, gap `12px 16px`. Each field is a label (13.5px `--mm-ink-2`) above an input (44px tall, mono 16px, border `--mm-line-2`).
- A footer at 12.5px `--mm-ink-3`: "Saved as you type."
- Keep `usePasteGuard` on every field, and keep the read-only behaviour when locked.

## Canvas appearance (`CircuitCanvas` + `componentGeometry.ts`)

**Type.** Every canvas text becomes `--mm-font-sans` (IBM Plex Sans) at 600 with `font-variant-numeric: tabular-nums`. That covers the IN/OUT labels, values, box names, MEM values and table-like overlays. Replace all `monospace` / `'SF Mono','Fira Code'` stacks (CircuitCanvas lines ~430, 454, 494, 726, 1062, 1376–1516).
- Labels ("IN1"): 11px, `--mm-ink-3`, letter-spacing `.04em`, 10px above the body.
- Values: 17px, 1 = `#E53935`, 0 = `#2A2A2A`.

**Colour.**
- Component stroke `#2A2A2A` at 1.5. White fill.
- **Selection is magenta, not blue:** stroke `--mm-accent` at 2.5, fill `--mm-lav-soft`.
- Wires are 2px: 0 = `#2A2A2A`, 1 = `#E53935`.
- A selected wire gets an 8px `--mm-lav` halo under it.
- Port dots are r3.5 in the wire's colour, with an 11px transparent hit radius.

**Gate geometry, regularized.** One size family, with ports on the 10px half-grid:

| Part | Box (w×h) | Shape | Ports (local) |
|---|---|---|---|
| AND | 60×60 | `M0 0 H30 A30 30 0 0 1 30 60 H0 Z` (true half-circle) | in (0,20) (0,40) · out (60,30) |
| OR | 60×60 | `M0 0 H24 Q50 3 60 30 Q50 57 24 60 H0 Q12 30 0 0 Z` + input stubs `M0 20 H5.3 M0 40 H5.3` | in (0,20) (0,40) · out (60,30) |
| NOT | 50×60 | triangle `0,8 50,30 0,52` | in (0,30) · out (50,30) |
| INPUT / OUTPUT | 40×40 | square | out (40,20) / in (0,20) |
| BOX | 100 × (max(nIn,nOut,2)·20+20) | rect on `#F7F5FA`, name centred 13px/600 | ports 20 apart, centred on each side |

- **Symbols are stroked paths, not glyphs.** This fixes the uneven stroke from the bold+stroked ∧/∨ text. All are 2px, round caps and joins, `#2A2A2A`, relative to (cx, cy):
  - ∧ `M cx−7 cy+6 L cx cy−7 L cx+7 cy+6` — AND centre (28,30)
  - ∨ `M cx−7 cy−6 L cx cy+7 L cx+7 cy−6` — OR centre (30,30)
  - ¬ `M cx−7 cy−3 H cx+6 V cy+4`, scaled 0.85 — NOT centre (16,29)
- XOR, HA, MEM and STATE are out of this pass, but should get the same treatment in the machine-types session.
- **Where it lands:**
  - `types.ts` `COMP_WIDTH/COMP_HEIGHT` (75×70), and `getComponentSize` NOT (55×50)
  - `getPortPositionLocal`: the OR inset (currently `w*0.07`) becomes 5.3, and the spacing rule should give 20/40 on a 60-tall gate
  - the CircuitCanvas `case 'AND' | 'OR' | 'NOT'`
- ⚠ **This geometry change touches saved work.** Wires reference port ids, so connections survive, but every stored AND/OR/NOT redraws smaller and the router re-lays wires. Before shipping, check:
  - `routerCheck` (fallback budget 0)
  - `layoutCheck`
  - `bumpCheck`
  - the reference fixtures (`coverageCheck`)
  - a pass over real HW1 workbooks
  
  HW1 is live.

## Interactions & behaviour (summary)

- **Navigation:** Prev/Next and list rows use `navigate({kind:'assignment', …, questionIndex})` exactly as `TabBar` does today, including `attempt` while viewing a submission. The breadcrumb goes to the overview. On a question change: hints close, the tool disarms, the selection clears, and Fit runs.
- **Canvas gestures:**
  - Drag a part to move it (snapped).
  - Click an INPUT without dragging to toggle it.
  - Drag from a port dot to another port to wire (a dashed `--mm-accent` preview line follows).
  - Click a wire to select it.
  - Drag empty canvas to pan.
  - Delete/Backspace deletes, Esc disarms or closes, and Ctrl/⌘+Z undoes (Shift to redo).
  
  Keep every existing gesture that isn't listed (rotate, shift-click rotate, rename and so on).
- **Palette:** drag it by the grip; the turn button flips its orientation; both persist. The Boxes pop-out closes on ×, Esc, or a click on empty canvas.
- **Dividers:** drag to resize. The collapse buttons, and clicking a collapsed strip, toggle the panels. All of this persists.
- **Save indicator:** from the existing autosave. Map `WorkbookStore` states to "Saving…", "Saved just now", "Saved N min ago" (refreshed every 30 seconds) and the error state.
- **Locks are unchanged:** frozen, viewing a submission, and `isCurrentQuestionLocked` still gate every mutating action in `store.ts`. The UI shows the existing read-only tags in the nav strip, where "4 of 23" sits.

## State

- **No new domain state** except pinned boxes, which are cosmetic and live in a per-homework pref.
- **New UI prefs:** panel widths, the open/closed states, and the palette position and orientation.
- **Transient component state:** whether the hint and section-note links are open, whether the pop-out is open, and the armed tool.
- `done` keeps its current storage (`QuestionCircuit.done`).

## Tokens used

- Everything from `theme.css` `:root`: `--mm-bg`, `--mm-surface`, `--mm-surface-2`, `--mm-ink`, `--mm-ink-2`, `--mm-ink-3`, `--mm-line`, `--mm-line-2`, `--mm-accent`, `--mm-accent-soft`, `--mm-lav`, `--mm-lav-soft`, `--mm-lav-line`, `--mm-link`, `--mm-warn`, `--mm-warn-soft`, `--mm-danger`.
- **App-only literals to add as tokens** (themeCheck only allows literals in `:root`):
  - `#F7F5FA` quiet fill (grip, nav strip, hint box, box fill)
  - `#CFC8D8` panel edge and grip border
  - `#B9B2C4` grip stroke and unchecked box
  - `#DAD4E2` canvas dot
  - `#E53935` / `#2A2A2A` signal 1 / 0 (they exist today as `--wire-1` / `--wire-0`)
- **Type:** Plex Sans, Serif and Mono. The editor sizes are 19 (title), 15 (statement), 14 (tables, callouts), 13.5 (list, labels), 13 (buttons), 12.5 (meta), 11.5 (eyebrows), 11 (canvas labels, section eyebrow) and 10.5 (tiles, tags).
- **Radius:** 0 everywhere, since the site is flat.
- **Shadows:** the palette (8px), palette while dragging (28px), and the pop-out (28px) only.

## Open questions for Gabriel (settle before filing)

1. **Does "done" still lock editing?** Today Mark done is a self-lock (`isCurrentQuestionLocked`, pinned by `navResetCheck`). The prototype treats done as a marker only, with no lock. Keep the lock, drop it, or make it an option?
2. **Tables:** should the goal and output table digits move off Plex Mono to Plex Sans tabular, matching the canvas?
3. **Disallowed parts:** dim them with a tooltip (as in the prototype), or hide them (as today)?
4. **Sandbox:** should the left panel be absent (as proposed), or hold something such as a notes field?

## Assets

`assets/hw1-schematic-mn.svg` is copied from `app/public/problem-sets/` for the prototype's Problem 16/17 figure. The app already has it. No other assets; every icon is inline SVG.

## Files

- `Editor Prototype.dc.html`: the working prototype, all 23 HW1 questions (open with `support.js` beside it)
- `support.js`: the prototype's runtime
- `assets/hw1-schematic-mn.svg`
- `inbox-note.md`: the proposed task breakdown, for `tasks/inbox/`
