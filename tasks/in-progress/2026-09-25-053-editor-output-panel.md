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
status: in-progress
after: 2026-09-25-052
branch: task/053-editor-output-panel
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
