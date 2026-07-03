- TM question no longer visible in the test assignment ("load sample data" only loads CC, SC, and FSM questions). Since the TM (and SC, and FSM) question editors are not yet live, this is the only way of accessing the TM canvas.

- **`generateTestCases` wrongly width-truncates TM output values.** (`engine/testVectorGen.ts`,
  found while inventorying the question editor for the CC/SC/FSM/TM unification.)

  `generateTestCases` computes every mode's expected output the same way: `truncate(evalFormula(...),
  outputWidth, rep)` — i.e. it stores `f(x)` reduced to what `outputWidth` bits/tally-marks can
  hold (the "width is the implicit modulus" rule from `CLAUDE.md`'s DSL section). That's correct
  for CC (the circuit has exactly that many output wires — it *cannot* represent anything past
  `outputWidth`) and consistent for SC/FSM (the time-axis decode itself only reads `outputWidth`
  steps of the output wire, so generation and grading agree on the same bound).

  It's wrong for TM. `encodeTM`/`decodeTM` (`engine/tmCodec.ts`) take **no width parameter at
  all** — the tape is unbounded, so a TM computing `x + 1` just writes however many strokes/digits
  the true value needs, and `decodeTM` reads all of them back with no truncation. If a question's
  declared `outputWidth` is smaller than what `f(x)` actually needs for some tested `x`, a
  genuinely correct (unbounded) TM will produce the untruncated value, which will then be compared
  against a wrongly-truncated "expected" value in the test case — failing a correct machine (or
  passing an incorrect one that happens to match the truncated remainder).

  Not yet visible in practice because the one hand-authored TM sample question
  (`devData/sampleData.ts`, `x + 1` with input width 3 / output width 4) happens to have a wide
  enough declared output width to avoid the mismatch. It will surface as soon as a TM question is
  generated where `f(x)` can exceed the declared output width. Fix: `generateTestCases` needs a
  TM branch that stores the raw `evalFormula` result for outputs, untruncated — output width
  should not apply as a modulus for the tape axis. (Input width can still legitimately bound which
  `x` values get enumerated at authoring time; that part isn't the bug.)

- **Open design question: does "width" mean anything for FSM (and likely SC) inputs/outputs?**
  Raised in the same review. For CC, `width` is a genuine structural property of the submitted
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
