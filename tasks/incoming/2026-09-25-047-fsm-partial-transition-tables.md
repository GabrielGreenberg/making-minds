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
status: ready
after: 2026-09-25-044
branch:
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

## Progress log
