---
id: 2026-09-25-053
type: feature
title: Give the editor one set of run controls in a right-hand Output panel, and retire the toolbar (editor redesign 2 of 6)
priority: normal
size: large
requires: browser
area: app
source: inbox
created: 2026-09-25T16:15:00-07:00
status: done
after: 2026-09-25-052
branch:
merged_into:
---

## Description
Step 2 of the editor workbench redesign. The spec and the chain are in
`docs/buildout/designs/editor-workbench.md` and task 052's Description. This step covers the
memo's §Output panel.

Today the run controls are scattered across the screen:
- a toolbar across the top (`SimulationToolbar`, in `components/SimulationPanel.tsx`) holds a
  Reset, Clear, Rotate and the save indicator;
- the right panel (`DataTable`) holds each mode's own Run/Step/Reset;
- a CC question shows two Resets plus a "clear".

This step does three things:
- **The Output panel.** The right column becomes the memo's Output panel: an "OUTPUT" header
  with a collapse button, one control row (Run · Step · Reset), then the mode's content.
- **The CC table.** CC's I/O table is restyled per the memo.
- **Retiring the toolbar.** Every tool the toolbar still holds gets a new home, and the
  toolbar is deleted.

## Done when
- **One control set.** There is exactly one Run/Step/Reset on screen for CC, FSM, TM and
  turbot questions and sandbox tabs. For SC and perception, the toolbar's extra Reset is
  gone, and the in-panel content is otherwise unchanged (see F8).
- **CC Run, Step and Reset (decision 6).** They keep today's signal-flow animation for the
  current row. Reset returns the canvas to the un-run state and sets every input to 0.
- **The CC table.** It is live, showing every row's outputs, since CC propagation is
  instantaneous. It follows the memo's style, with Plex Sans tabular digits and 1s in the
  signal-1 colour. The row matching the current inputs is highlighted, clicking a row sets
  the inputs, and the note and empty-state lines read as in the memo.
- **Everything else the toolbar held has a home:** Rotate, Clear (with its confirm) and the
  turbot-TM "Swap state type" (F9).
- **Deletions.** `SimulationToolbar` is deleted and nothing still imports it.
- **The collapse strip.** The Output panel collapses to its 40px strip, and that state
  persists (052's prefs).
- **Gates.** `scWindowCheck`, `caseRunCheck`, `pipelineCheck`, `navResetCheck` and
  `perceptionCheck` are green, along with every gate in PROFILE §6.

## Design
**deepFix.** Each mode exposes its run controls as one small descriptor, e.g.
`{run, step, reset, running, canStep}` from a pure store selector per effective mode, and the
Output header renders that one descriptor. Today every mode builds its own button row inside
`DataTable`. With the descriptor, a later mode (the machine-types design session) gets the
header for free. The mode panels below it keep their content.

**surgicalFix.** Move the toolbar's Reset into each DataTable branch and CSS-hide the
duplicates. That leaves several control rows alive, only hidden.

**Code as it stands (read 2026-09-25).**
- **The toolbar** (`SimulationPanel.tsx`), mounted at `App.tsx:77`:
  - Reset per mode :33-57. In CC it calls `setInputValue(id, undefined)` on every INPUT,
    which blanks them.
  - Clear with its confirm popover :60-80.
  - Rotate the selection :85-100.
  - The turbot-TM "Swap state type".
  - The save indicator :126-140, which moves to 052's top bar.
- **Per-mode controls today:**
  - CC/SC local stepping: `DataTable.tsx:1105-1150`, using `localStepOne` on an interval
    (`store.ts:3392`) and `localStepReset`. `localStepSelect` (`store.ts:3251`) runs on a
    row click (DT:1048) and after an INPUT toggle (`CircuitCanvas.tsx:2966-2971`).
  - The CC table's own "clear" header button: DT:939-958.
  - SC global sequence: DT:1335-1356, with its own clear at DT:1168.
  - FSM: DT:662-670, clear at DT:604. TM: DT:823-831, "clear tape" at DT:815.
  - turbot: `TurbotArenaPanel.tsx:362-372`.
  - perception: `PerceptionFramePlayer.tsx:212-214`.
- **The CC table** (DT:1029-1066): 2^n rows (a message when n > 8, DT:1025). Outputs appear
  only once a row is evaluated. The active row uses `row-active` plus a red dot (DT:914-920,
  key logic :304-323).
- **INPUT values:** `setInputValue` (`store.ts:1868-1879`) is deliberately not locked, since
  INPUT toggles are exploratory. That doesn't change.
- **The machine-edit restart** (law 6): the subscriber at `store.ts:5149-5170` calls
  `restartLiveRuns` (:5101). The header's Run must drive the same run state that subscriber
  restarts; never add a second run loop in a component.

### Resolved decisions
Gabriel, 2026-09-25 (catch):
- **6. CC keeps its signal-flow animation.** This overrides the memo's "Run walks the table
  rows every 700ms; Step advances to the next row".
  - Step and Run animate propagation through the gates for the current row, as today.
  - Clicking a row (or toggling an INPUT) makes that row current.
  - The table itself is live: all rows are computed at once.
- **2. Table digits** are Plex Sans tabular (see 052).

### Where the memo meets the code (flagged at filing)
- **F8. "Exactly one Run/Step/Reset in every mode" versus "SC, FSM, TM and turbot unchanged."**
  - SC has two legitimate run sets today: local row stepping, and the global sequence, which
    is the grader's run (Critical design rules, "Question runs ARE the grader's runs").
  - Perception has its frame player.
  - Redesigning those is the machine-types session's job. So this step:
    - applies "exactly one" to CC, FSM, TM and turbot;
    - for SC, the header drives the global sequence and the local stepper stays in the
      panel;
    - removes only the toolbar's duplicate Reset in SC and perception.
- **F9. The toolbar holds more than the memo re-homes.**
  - Rotate, Clear and turbot-TM Swap join the canvas's top-right action group from the memo
    (§Canvas: "↶ Undo · ↷ · Delete"). That group is built here, since this is where the
    toolbar dies. The resulting order is Undo · Redo · Delete · Rotate · Clear, with Swap
    shown only in turbot-TM.
  - Rotate and Delete are disabled with nothing selected. Clear keeps its confirm.
  - The buttons call the same store actions (`undo` :2087, `redo` :2112, `deleteSelected`,
    `rotateComponent` :2543, `clearWorkspace`), so the locks are unchanged.

## Verify
- **Gates:** everything in PROFILE §6. The fast loop is `scWindowCheck`, `caseRunCheck`,
  `navResetCheck` and `perceptionCheck`.
- **Pin:** if the controls descriptor is a pure selector, pin in `navResetCheck` that
  mode × descriptor always gives exactly one Run/Step/Reset. A machine edit mid-run still
  restarts at t=1.
- **Browser (requires: browser):**
  - HW1 P1: click rows, toggle inputs, then Step, Run and Reset (the animation plays, and
    Reset sets the inputs to 0).
  - The action group: rotate, delete and clear a selection, then undo.
  - Walk one SC, FSM, TM and turbot question, plus an SC perception question: each mode's
    Run/Step/Reset still works from its new place.
  - Collapse the Output panel and reload.
  - Screenshot at 1280 wide.

## Progress log

### 2026-09-25 — built, verified (/work)
- **One control row.** `components/OutputPanel.tsx` renders the store's one descriptor,
  `selectRunControls` (kind, running, canRun/Step/Reset, a status readout such as
  "t=3 · S₁"), and dispatches through `runControl('run'|'step'|'reset'|'stop')`. Run becomes
  "■ Stop" while running. A new mode is added in the store, never as a panel's own button row.
- **Every run loop is the store's.**
  - The CC local step's Run moved out of DataTable's `setInterval` into
    `localStepRun`/`localStepPause`. Every select, reset and clear pauses it, and
    `resetAllSimState` now clears the local step.
  - SC's Global I/O orchestration moved into the store: `scActiveGlobalIndex` plus
    `scSequenceRun`/`Step`/`Reset` (from DataTable's `ensureSequenceLoaded` and the three
    callbacks). `scGlobalReset` forgets the row.
  - The turbot Map's "Edit map" is store-held (`turbotEditingMap`, cleared on every swap),
    so the row stands down while editing.
- **CC (decision 6).**
  - Step and Run play the current row's signal flow. With no row picked they pick the
    current inputs' row; a finished row replays from the top.
  - Reset sets every input to 0 and leaves the canvas un-run on that row.
  - The table is live: `LiveTruthTable` over the new pure `engine/cc.ts truthTableCC` (every
    row is `evaluateCCInputs`, the grader's own evaluation). It uses the memo's style (Plex
    Sans tabular, red 1s, lavender current row, equal columns up to 60px that shrink to
    fit), with a row click or Enter to set the inputs and the memo's note and empty lines.
- **Where each control went.**
  - FSM, TM and turbot panels lost their button rows; the FSM "clear" and TM "clear tape"
    stay.
  - SC plays its Global row from the header; its local stepper stays (F8), and the pace
    control stays in the panel.
  - SC perception has no header row: the frame player keeps its controls.
- **The toolbar retired.**
  - `SimulationPanel.tsx` is deleted.
  - `components/CanvasActions.tsx` is the canvas's top-right group: Undo · Redo · Delete ·
    Rotate · Clear (with a confirm), plus Swap state type for a turbot TM. It has the
    "(shift+click to ↻)" hint (task 024) and calls the store's own locked actions.
  - The "Current state" readout is now the row's status.
  - Dead CSS removed. The themeCheck ratchet went 177 → 174, and the new components are in
    its scan.
- **Docs.** The memo's "One control set" note was updated. CLAUDE.md rows were updated in
  place (39992 → 39972 bytes).
- **Pins.**
  - navResetCheck `[run controls]` (CC step/run/stop/reset, the run ends itself, an edit or
    a swap stops it; FSM/TM step and reset with a status; SC Global row step and reset,
    forgotten on swap; the turbot step, and Map editing stands the row down).
    `checkAllSimFresh` now also asserts no local-step row or run, no Global row, and a
    closed Map editor. The rotate-hint pin moved to CanvasActions.
  - workbenchCheck `[output panel]`: `truthTableCC` against HW1 P3's reference (AND/NAND),
    unwired outputs, the empty and too-many cases; source pins — one row from the
    descriptor, no panel Run/Step for CC/FSM/TM/turbot, no toolbar, the live table, and the
    action group through the store.
- **Verified** in headless Chrome at 1280, local mode:
  - HW1 P3 with its reference circuit: the live table; a row click, 2× Step ("2/7"), a Run
    to "7/7", then Reset (inputs 0, row 00 current); Rotate, Delete, Undo, and Clear's
    confirm.
  - HW3 P1 (SC): the header steps the Global row. HW4 P3 (FSM): "t=1 · S₁". HW5 P1 (TM):
    Run → "HALTED · S₂". HW6 turbot TM: Swap in the group, the Map without buttons.
  - HW3 P11 (SC perception): no header row.
- **Screenshots:** `tasks/attachments/2026-09-25-053-{1..4}.png` (CC stepping, the Clear confirm, SC, turbot TM).
- **Gates** (by exit code): both tsc runs, the build, `npm run check` and the server's `npm run check`.

### 2026-09-25 — landed (/work)
Merged to `main` with `--no-ff`. Next in the chain: 054 (the floating palette).
