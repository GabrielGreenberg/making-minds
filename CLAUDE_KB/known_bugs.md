- TM question no longer visible in the test assignment ("load sample data" only loads CC, SC, and FSM questions). Since the TM (and SC, and FSM) question editors are not yet live, this is the only way of accessing the TM canvas.

- **FIXED (2026-07-03): `generateTestCases` wrongly width-truncated TM output values.**
  (`engine/testVectorGen.ts`.) `generateTestCases` now takes the build mode and, on the TM `tape`
  axis (`axisForMode(mode) === 'tape'`), stores the **raw** `evalFormula` result for outputs
  instead of truncating to `outputWidth` — the tape is unbounded, so a correct TM writes the full
  value and `decodeTM` reads it all back. CC/SC/FSM behavior is unchanged (still width-truncated,
  which is correct for the space/time axes). The live authoring preview (`instructor/ccPreview.ts`)
  got the same TM branch and now renders the natural unpadded tape encoding (`formatTMValue`).
  Verified: a `x+1` unary TM question with output width 1 now stores `[1,2,3,4]` (not `[1,1,1,1]`)
  and a correct increment TM grades 4/4.

- **Open design question (still open): does "width" mean anything for FSM (and likely SC)
  inputs/outputs?** The unified question editor (2026-07-03) ships with a per-mode `width` caption
  and a one-line caveat for SC/FSM/TM ("width is only how many steps/values this question tests,
  not a machine capacity"), which is honest about the limitation but does **not** resolve it — the
  deeper question of what authoring knob should replace "width" for streaming machines is still
  deferred. Details below.
  Raised in an earlier review. For CC, `width` is a genuine structural property of the submitted
  circuit — Stage 1 (`machineValidation.ts`) checks `#INPUT wires == Σ inputWidths`, so a
  CC circuit really cannot represent a value outside `0..2^width-1`. For the time axis (SC/FSM),
  Stage 1 does **not** check wire count against width at all (SC only checks one wire per group;
  FSM checks none) — instead FSM's Stage-1 validity requires every state to have **exactly one
  transition per input bit, total and deterministic**, precisely so the machine can never get
  stuck mid-run. That means a valid FSM must, by construction, handle an input stream of **any**
  length — there is no notion of "this FSM was built assuming 3-bit inputs" the way a CC circuit
  is built with exactly 3 input wires. So the per-group `width` used to serialize a test value over
  the time axis (`stepCount = max(inWidths, outWidths)`, `codec.ts`) isn't a capacity limit of the
  machine at all; it's only the test harness's choice of how large a value to try. Testing
  exhaustively up to a declared width therefore does not carry the same completeness guarantee it
  does for CC (where the declared width *is* the entire input domain) — a correct-looking FSM could
  still be wrong for longer streams than any tested width covers. Generation and grading do stay
  internally consistent here (the time-axis decode window is bound to the same declared
  `outputWidth`, unlike the TM case above), so this isn't a grader/generator mismatch bug — it's a
  conceptual gap in what `width` is supposed to mean for a streaming machine. The same reasoning
  plausibly applies to SC (same time axis, same `width`-as-`stepCount` mechanism) — not yet
  confirmed with the user. No fix decided; needs a design call on what (if anything) should replace
  "width" as the authoring knob for FSM/SC input/output groups.
