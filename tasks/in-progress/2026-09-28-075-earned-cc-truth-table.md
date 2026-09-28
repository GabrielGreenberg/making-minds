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
  run rows, so a stale output can never stand beside a changed circuit. (The one row the
  canvas INPUTs still stand at is re-earned at once, from the NEW circuit: the canvas is
  showing that row's answer, and the table must not contradict it — review, fix stage.)
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
it appears too; move a wire → every other run row clears (the row the inputs stand at
stays, recomputed); one click on a blank INPUT sets only that input (no row until every
input is set); a gate with an unwired input shows "–" on its run rows, not 0.

## Progress log
- 2026-09-28 (robot, implement): store-owned `ccRunRows` (AppState, never saved), recorded ONLY by
  the machine-key subscriber (`recordCcRunRow`: memoryless canvas, every INPUT 0/1 → that row's
  key); a machine edit clears it there before re-recording the row the inputs stand at now;
  `resetAllSimState` clears it (every swap + principal change). `LiveTruthTable` reads it and
  shows an output only for earned rows (`op-unrun` muted cell, "Not run yet"). New parts start
  `value: undefined`; `signalColor` draws unset (undefined/null/-1) with the faint role; WireView
  no longer maps a blank wire to 0. Consequences by design: CC Reset (inputs → 0…0) runs that row;
  after an edit the row the inputs stand at re-earns itself (the canvas is showing it). Pins:
  workbenchCheck [output panel] + [signal colour]; navResetCheck `checkAllSimFresh` (every swap)
  + [earned CC table]. Gates green (tsc, tools typecheck, build, `npm run check`, server
  typecheck). Browser eyeball still owed (see Verify).
- 2026-09-28 (robot, fix): review findings. The cells moved into pure `src/ccTable.ts`
  (`ccOutputCell`/`ccTableView`, `ccRowKey` shared with the store) and workbenchCheck now pins
  the rendered rule (blank until run, the grader's bit once run; mutation-tested). A run row
  the circuit leaves undriven shows "–", not the grader's 0 (table ≡ canvas). The canvas's
  INPUT click is the store's `toggleInput`: it sets that input only and runs the row once
  every input is set (no 0 on an input nobody set); navResetCheck drives that path. A paste
  lands its INPUTs blank; the palette's drag ghost is unset. Done-when 2 / Verify reworded to
  the kept choice: after an edit the row the inputs stand at is re-earned from the new circuit.

### 2026-09-28 — implemented (work loop)
- **Built:** the CC I/O table is earned. Every input row is listed, but a row's output shows
  only once the student has run it (row click, or canvas inputs set to it); unrun cells are
  empty and muted ("Not run yet"), an undriven output on a run row shows "–". The run set is
  store-owned (`ccRunRows`, never saved), cleared on every canvas swap / principal change
  and on a machine edit (the row the inputs stand at is re-earned from the new circuit).
  Unset is not 0 anywhere: new, pasted and palette-ghost parts start `undefined`, unset
  signals draw faint (`signalColor`), and one INPUT click sets only that input
  (`toggleInput`). Cells decided in pure `app/src/ccTable.ts`; no engine or grader change.
- **Pins:** workbenchCheck [output panel] (rendered rule, HW1 P3 `.. 01 .. 10`, undriven
  "––"), [signal colour], [palette] ghosts unset; navResetCheck `checkAllSimFresh` (no row
  earned after any swap) + [earned CC table] (fresh tab, one-click, row click, canvas earn,
  move keeps, edit forgets, Reset, paste blank, SC earns none). Mutation-tested.
- **Gates:** app-tsc=0, tools typecheck=0, app-build=0, app-check=0, server-tsc=0,
  server-check=0; context budgets ok (CLAUDE.md 39,995 / 40,000).
- **Review:** 6 findings fixed (rendered-rule pin, paste carried INPUT values, ghost drew 0,
  Done-when 2 reworded to the kept re-earn, undriven output showed 0, one click filled other
  inputs), 0 skipped. Nits left: `addWire` still creates wires `value: 0` until the deferred
  evaluation; `truthTableCC`'s doc comment still calls the table live; CC Reset earns 0…0
  without a canvas run.
- **Owed:** the browser eyeball in Verify (sandbox CC tab; an HW1 CC question incl. swap and
  back; SC wires start faint, FSM/TM arrows unchanged; dark theme).
- **NEXT STEP:** loop session: visual check (owed), then land per PROFILE §5.
