---
id: 2026-09-25-047
type: bug
title: Accept an FSM that leaves out arrows for inputs that can't occur, as the textbook's machines do
priority: normal
size: unknown
requires:
area: app
source: audit
created: 2026-09-25T10:35:00-07:00
status: in-progress
after: 2026-09-25-044
branch: robot/047-fsm-partial-transition-tables
merged_into:
---

## Description
Found in the HW1 audit (2026-09-25) while checking tally orientation. The textbook's +1 T FSM
(p. 101: S₀ 1:1 loop, 0:1 → S₁, S₁ 0:0) has no arrow from S₁ on input 1, because a
well-formed tally input never sends a 1 after its first 0. The book says so: "we'll always
assume that inputs are well-formed", and "a machine halts in a given state, given an input,
if there are no arrows leaving that state for that input". Stage 1 refuses the machine
outright: "state S₁ must have exactly one transition for input 1 (found 0)". So a student who
copies the book's machine into HW4 P3 gets 0/9 before it runs.

## Done when
A missing arrow is allowed. A run that reaches a state with no arrow for the current input
halts: the grader decodes the output so far, and a case fails only if that output is wrong.
Two arrows for one input stay an error. The textbook p. 101 machine, exactly as drawn, passes
HW4 P3. Pinned in the FSM check tool; the student's editor warns (never blocks) on a missing
arrow, per "warn, don't block".

## Design
Where it lives: FSM validation (`validateTransitionTable` / the FSM validator) and the FSM
engine's step (halt on no match). Check what the editor's live run does today on a missing
arrow, and what halting means for the codec's time window (the steps after a halt count as
output 0?). Confirm with the textbook's own halting note (p. 100).

## Verify
Gates; a pin grading the book's machine as drawn.

- 2026-09-27 (robot, implement): app tsc + typecheck:tools + build + `npm run check` green;
  server typecheck + `npm run check` green (parityCheck unchanged). notationCheck
  `[partial tables — 047]` grades the p. 101 machine as drawn 9/9 on HW4 P3; caseRunCheck
  replays a halting machine (store run HALTED, output so far ≡ recorded got).
- **Owed (browser):** in an FSM question, a state missing an arrow shows the dashed amber halo
  (tooltip on hover names the input) and the state table's HALT row reads amber; adding the
  arrow clears both; nothing blocks Run/Submit.

## Progress log
- 2026-09-27 (robot, implement): FSM Stage 1 now `'at-most-one'` (a missing arrow is allowed;
  two arrows for one input stay an error); `caseRun.ts` no longer rejects a halted FSM run —
  the steps taken are decoded, unreached steps read 0 by the codec. New pure
  `notation.ts uncoveredInputs` → `store.ts selectFsmUncoveredInputs` (memoized) → a dashed
  `C.warn` halo + tooltip on the state in `CircuitCanvas`, amber HALT rows in the state
  table. The hw4-p3 reference fixture is now the book machine exactly (S₁ 1:1 dropped).
  Scope note / possible follow-up: turbot FSM brains keep totality (`validateTurbotFSM`
  'total') — an arena brain that halts has no "output so far" to grade; unchanged here.

### 2026-09-27 — implemented (work loop)
- **Built:** an FSM may now leave out arrows, as the textbook's do. A run reaching a state
  with no arrow for the current input halts; the grader decodes the output so far (unreached
  steps read 0), so a case fails only on a wrong output. Two arrows for one input stay a
  Stage-1 error. The editor warns, never blocks: a dashed amber halo + tooltip on the state,
  amber –/HALT rows in the state table. Turbot FSM brains keep totality (no warning shown
  there — review fix).
- **Pins:** notationCheck `[partial tables — 047]` (p. 101 book machine 9/9 on HW4 P3; a
  machine halting in S₁ passes; S₁-less echo fails on output; two arrows stay Stage-1); the
  arity block's missing-symbol case now graded not rejected; caseRunCheck replays a halting
  machine (store HALTED ≡ recorded got) + missing-arrow warning pins (hw4-p3 warns S₀: [0];
  turbot FSM brain with a gap warns nothing). hw4-p3 reference fixture = the book machine.
- **Gates:** app-tsc 0, app-build 0, app-check 0, server-tsc 0, server-check 0.
- **Review:** findings 1+2 fixed (`selectFsmUncoveredInputs` → empty in turbot mode); none
  skipped. Nit left: `notation.ts uncoveredInputs` doc says the 'total' check shares it; it
  doesn't.
- **Owed (browser):** HW4 P3 in local mode — amber marker + tooltip on S₁, –/HALT row, Run 111
  → 4; delete S₁ 0:0 → HALTED with output so far; Submit → 9/9; dark/light glance; sandbox FSM
  tab warns likewise.
- **Next step:** loop session: visual check if owed, then land per PROFILE §5.
