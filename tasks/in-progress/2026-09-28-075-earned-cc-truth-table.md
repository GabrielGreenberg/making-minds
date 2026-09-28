---
id: 2026-09-28-075
type: feature
title: Make the CC I/O table earned — outputs appear only for rows the student has run
priority: normal
size: large
requires: browser
area: app
source: feedback
created: 2026-09-28T10:00:00-07:00
status: in-progress
after:
branch: robot/075-earned-cc-truth-table
merged_into:
---

## Description
App Feedback report `fb-mulh3xtz-9vsur0` (author-role: instructor, category: platform
design), two points about combinational (CC) circuits:

1. The right-hand I/O table currently shows every row's output the moment the circuit is
   wired — the student never has to work anything out. The table's **input** columns may
   stay pre-filled, but a row's **output** should appear only after the student runs that
   row. Students should earn their table.
2. A circuit should not show 0s and 1s on its inputs or outputs until a row is selected or
   an input is set by clicking.

Today (from the code):
- `app/src/components/DataTable.tsx:663-668` renders `<LiveTruthTable/>` for any CC circuit
  (no MEM); `LiveTruthTable.tsx:21` `useMemo(truthTableCC(components, wires))` recomputes all
  2^n rows on every edit (`engine/cc.ts:340-363`, via the grader's own `evaluateCCInputs`).
  This is task 053's design, pinned by `app/tools/workbenchCheck.ts:239-275`.
- A row click already runs that row: `LiveTruthTable.tsx:32-34,69-74` → `localStepSelect(bits)`
  (`store.ts:3807`) sets the INPUTs; a canvas input toggle auto-selects the matching row
  (`CircuitCanvas.tsx:3001-3004`).
- Point 2 is half true already: a new INPUT starts `value: undefined` and draws blank
  (`store.ts:2100`, `CircuitCanvas.tsx:414-416`); resets blank them (`store.ts:4375/4398/4524`).
  But every other part is created with `value: 0` (`store.ts:2100`), so a fresh or undriven
  OUTPUT prints "0" (`CircuitCanvas.tsx:510`), and an unset wire (-1, `store.ts:2314/3935`)
  is coloured as 0 by `signalColor` (`canvasTheme.ts:74-76`) — "unset" and "0" look alike.

## Done when
- In a CC circuit (sandbox and assignment questions, incl. CC perception), the I/O table
  lists every input row but shows an output cell only for rows the student has run —
  clicked in the table, or reached by setting the canvas inputs to that row. Unrun rows
  show an empty cell (clearly "not run yet", not 0).
- A machine edit (the `gradedMachineKey` change the store already watches) forgets the
  run rows, so a stale output can never stand beside a changed circuit.
- A fresh circuit, and one opened on a question / after a canvas swap, shows no 0/1 on any
  INPUT, OUTPUT, gate or wire until an input is set or a row is run; unset draws visibly
  unlike 0 (blank numeral; the neutral/faint stroke, not the 0 ink).
- Grading is untouched (the table is UI only; `caseRun.ts`/`grader.ts` never read it).
- `workbenchCheck` re-pinned to the new law; `navResetCheck` covers "canvas swap / machine
  edit clears the run set".

## Design
- **deepFix (recommended):** one store-owned notion of *revealed rows* for the CC table:
  a set of input bit-strings the student has run, added by `localStepSelect` and by an
  INPUT toggle that completes a row (the one path both already share), cleared by
  `resetAllSimState()` and by the machine-key subscriber (Critical design rules — never in a
  component). `LiveTruthTable` keeps computing rows with `truthTableCC` but renders an
  output only when its row is revealed. Pair it with one "unset" signal value end to end:
  non-INPUT parts start `undefined` (not 0), `signalColor`/canvasTheme get an explicit
  unset role, OUTPUT prints nothing while unset. This retires the class "the canvas/table
  asserts a value nobody computed", instead of patching the table alone.
- **surgicalFix:** hide the output column in `LiveTruthTable` except for the highlighted
  (current-input) row; start OUTPUT at `undefined`. Loses earned rows the moment inputs
  change — worse for the student, so not recommended.
- Defaults chosen (instructor intent is clear; these are the HOW): no "run all rows"
  button (it would undo the point); revealed rows are per question, UI-only and not
  persisted in the workbook (a resume starts the table un-earned); the sandbox follows the
  same rule. SC tables are untouched (they already run step by step).
- Seams/laws: store only (`store.ts`), `LiveTruthTable.tsx`, `CircuitCanvas.tsx`,
  `canvasTheme.ts`; no engine or grader change (law 2); edit locks unaffected (running is
  simulation, never locked).

### Members
- `fb-mulh3xtz-9vsur0` · instructor · platform design — both points (one disease: the UI
  shows values the student didn't produce).

## Verify
Gates: `npx tsc -p tsconfig.app.json --noEmit`, `npm run build`, `npm run check` in `app/`
(`workbenchCheck` re-pinned, `navResetCheck` extended). Browser (owed eyeball): in the
sandbox and on an HW1 CC question — fresh canvas shows no digits; wire a gate, table shows
inputs only; click a row → that output appears and stays; toggle inputs to another row →
it appears too; move a wire → run rows clear.

## Progress log
