---
id: 2026-09-28-084
type: feature
title: Fill a CC I/O-table row only when a Run carries its signal to the OUTPUT, and let Reset clear the table
priority: normal
size: large
requires:
area: app
source: feedback
created: 2026-09-28T21:08:27-07:00
status: ready
after:
branch:
merged_into:
---

## Description
App Feedback report `fb-mum4r0c4-suqknj` (author-role: instructor, category: platform
design; context: HW1, problem 1 — the NAND circuit, a CC question). It refines task 075's
"earned" I/O table on two points:

1. **Reset should clear the table's outputs.** Today pressing Reset in the output panel's
   run row wipes nothing: every row already filled stays filled, and the 0…0 row fills in
   as well.
2. **Clicking a row should not fill it in.** Today a row's output appears in the table the
   moment the row is clicked (or the canvas inputs are toggled to it) — while the canvas
   itself still shows a blank OUTPUT, because the click only *readies* the signal-flow
   animation. The instructor wants the table to fill a row only after the student clicks the
   row, presses **Run**, and the signal actually reaches the OUT.

Why it happens (from the code):
- Task 075 made a row "earned" whenever the canvas INPUTs *stand at* it: the store's
  machine-key subscriber calls `recordCcRunRow()` on every state change
  (`app/src/store.ts:6069`, body `:6076-6083`), which adds the current input row to
  `ccRunRows` as soon as every INPUT is 0/1 — no run needed. `LiveTruthTable` renders an
  output for every key in `ccRunRows` (`app/src/components/LiveTruthTable.tsx:27-29`, via
  `ccTableView`, `app/src/ccTable.ts:82-106`).
- A row click is `localStepSelect(bits)` (`LiveTruthTable.tsx:40-42` →
  `store.ts:3921-4061`): it sets the INPUTs, blanks every other part and wire, and readies
  the play (`localStepActive`, `localStepIndex: 0`). The inputs now stand at the row, so the
  subscriber earns it at once — before any Run. A canvas toggle that completes a row takes
  the same path (`toggleInput`, `store.ts:2264-2281`).
- CC Reset is `runControl('reset')` → `localStepSelect(zeros)` (`store.ts:5147-5153`):
  it moves the inputs to 0…0, which the subscriber then earns; nothing ever clears
  `ccRunRows` except a canvas swap (`resetAllSimState`, `store.ts:5428`) or a machine edit
  (`store.ts:6067`).
- The play itself — Run and Step alike — is `localStepOne()` (`store.ts:4063-4257`), driven
  by `localStepRun`'s interval (`:4278-4285`) or by Step (`:5156`). OUTPUT evaluations are
  the play's last steps (`store.ts:4034-4041`), so "the signal reached the OUT" is exactly
  "the play of the selected row ran its last step" (`localStepIndex` reaches
  `localStepSorted.length`).
- 075's progress log records both behaviours as deliberate consequences ("CC Reset (inputs →
  0…0) runs that row"; "after an edit the row the inputs stand at re-earns itself"), and
  `app/tools/navResetCheck.ts:1471-1520` [earned CC table] pins them — so this task
  replaces 075's earning rule, it does not patch around it.

## Done when
- In a CC circuit (sandbox and assignment questions, incl. CC perception questions), a
  table row's output appears only when a play of that row finishes on the canvas — Run, or
  Step pressed through to the end — i.e. the signal has reached every OUTPUT. Clicking a
  row, toggling the canvas inputs to a row, and Reset never fill a row by themselves.
- A play stopped part-way (■ Stop before the signal reaches the OUT) fills nothing; pressing
  Run again finishes it and fills the row.
- Rows already earned stay filled as the student moves between rows (075's "keep the
  earlier ones" is unchanged).
- **Reset** empties the table — every earned row goes back to "Not run yet" — and leaves the
  canvas as today (inputs at 0…0, that row selected but un-run, awaiting Run).
- A machine edit still clears the table, but no longer re-fills the row the inputs stand at:
  the student runs it again. (The canvas's live re-evaluation after an edit is unchanged —
  see Design.)
- **Run this input** (a graded case replayed from the Grades sheet, `loadCaseInput`) is a run:
  when it runs the case to the end on a CC canvas, that row fills in.
- The table's hint under it reads true to the new rule (today "Click a row, or set the
  inputs, to run it." — `LiveTruthTable.tsx:97`); e.g. "Click a row, then Run it to fill in
  its output."
- Grading untouched (the table is UI only). `navResetCheck` [earned CC table] and the
  `workbenchCheck` [output panel] comments re-pinned to the new rule.

## Design
- **deepFix (recommended): one earning path — "the play finished".** Remove the
  subscriber's `recordCcRunRow()` call (`store.ts:6069`) and record the row instead at the
  single place a CC play completes: the step in `localStepOne()` that executes the last
  entry of `localStepSorted`, on a memoryless canvas (`!hasMemory`), recording
  `localStepSelectedKey` (the row the play was started from — already the table's key
  spelling, `ccRowKey`). Run and Step both pass through `localStepOne`, so both earn by the
  same code; a paused play simply hasn't reached that step. Route the CC case replay's
  `runToEnd` (`store.ts:5315-5330`, and the CC-perception branch `:5294-5309`) through the
  same play — `localStepSelect(bits)` then `localStepOne()` until it returns false,
  synchronously — instead of `evaluateCircuit()`, so "Run this input" earns by the one path
  too and the canvas ends in the same state. Reset: the CC branch of `runControl('reset')`
  sets `ccRunRows: []` alongside its `localStepSelect(zeros)` — in the store's one run
  control, never in a component. Machine edit: keep the subscriber's clear (`:6067`), drop
  the re-earn. This keeps the table's law a single sentence ("a row is shown once a run of it
  reached the OUT") that every entry point obeys, instead of listing which input paths do
  and don't count.
- **surgicalFix:** keep the subscriber but make `recordCcRunRow` skip while
  `localStepActive && localStepIndex < localStepSorted.length`, and clear on Reset. It
  mostly works, but ties earning to animation bookkeeping from the outside, and the
  toggle/evaluate ordering (`setInputValue` queues an instant `evaluateCircuit` before
  `toggleInput` selects the row, `store.ts:2252-2281`) can leave windows where inputs stand
  at a row with no play active — each such window would earn. Not recommended.
- **The canvas after a machine edit (default chosen, out of scope):** every structural edit
  re-evaluates the CC canvas instantly (`evaluateCircuit`, ~25 call sites), so after an edit
  the OUTPUT may show the new circuit's value while the table row says "Not run yet". The
  report asks only about the table, and 075 deliberately kept the canvas's live
  evaluation; so the canvas is left as it is. (075 re-earned that row to avoid this
  mismatch; the report's rule — the table fills only after Run — overrides that.) If Gabriel
  later wants the canvas to go blank after an edit too, that's the CC form of the machine-edit
  law ("restart the live run at t=1") and a follow-up task, not this one.
- Defaults chosen (HOW, not WHAT): Step-to-the-end counts as a run (it is the same play,
  slower); Reset keeps moving the inputs to 0…0 (existing behaviour) — only the table is
  added to what it clears; the earned set stays UI-only and unsaved (075).
- Seams/laws: `store.ts` only for the state (edit/simulation law: running is simulation,
  never locked — Reset and Run stay available on a locked or viewed question);
  `LiveTruthTable.tsx` only its hint text; no engine or grader change (law 2). The
  machine-key subscriber still owns "a machine edit clears the table" (law 6).

### Members
- `fb-mum4r0c4-suqknj` · instructor · platform design — both points (one disease: the table
  fills without a run reaching the OUT; Reset doesn't un-fill it).

## Verify
Gates in `app/`: `npx tsc -p tsconfig.app.json --noEmit`, `npm run typecheck:tools`,
`npm run build`, `npm run check`. Re-pin `app/tools/navResetCheck.ts` [earned CC table]:
a completing canvas click and a row click earn nothing; Step to the end earns the selected
row; a Run (driven to completion — flush the interval, or call `localStepOne` to the end as
`localStepRun` does) earns it; a Stop mid-play earns nothing; Reset empties `ccRunRows`; a
machine edit empties it and re-earns nothing; `loadCaseInput` on a CC question with run
earns the case's row. Keep the existing paste / fresh-canvas / move-is-not-an-edit pins.
Update the `workbenchCheck.ts:519-529` comment (who records rows). Browser eyeball owed
(Robot Dev Server, or `/work`): HW1 P1 (NAND) — click a row: canvas OUTPUT and table cell
both blank; Run → the signal walks to the OUT, then the row's 1 appears; Reset → the whole
column blanks; toggle inputs on the canvas → nothing fills until Run.

## Progress log
- 2026-09-28 (robot catch): filed from `fb-mum4r0c4-suqknj`.
