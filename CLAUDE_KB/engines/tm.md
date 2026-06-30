# TM — Turing machines engine

> **Status: NOT YET IMPLEMENTED.** There is no `engine/tm.ts`. `buildMode: 'TM'` exists in
> `types.ts`, but `grader.ts` returns `skip(question.id, 'TM grading not yet implemented')` for
> it, and the instructor `QuestionCreator` shows TM as "coming soon". This doc is a **design
> spec** for the engine to be built — it describes intended behaviour, not existing code. Treat
> every "should" below as a decision to confirm against the spec, not a fact about the repo.

Read `overview.md`, `cc.md`, and `grading.md` first; the TM engine should mirror their shape.

## Source of truth

The behavioural spec lives in `spec/PHIL_133_Platform_Spec_v2.md` (Phase 5: Turing Machines)
and the course textbook `spec/mm_textbook.pdf`. The original brief (`CLAUDE_CODE_PROMPT.md`)
summarises it: an infinite tape, a read/write head, TM transition labels, and a TM operation
cycle. Build against the spec, not against this summary.

## Why TM grading is harder than CC

CC has a **finite** input space, so `testVectorGen.ts` enumerates it exhaustively. A TM's input
is an **arbitrary-length tape** — the input space is infinite, so exhaustive enumeration is
impossible. Grading must therefore be **sampling-based**: pick representative tapes (short,
long, all-zeros, all-ones, boundary cases like carry propagation / tape edges) and check the
machine's output on each. The instructor reviews/supplements the sample at authoring time. This
is the same problem SC/TM share (noted in the instructor-frontend design); the autograde is a
**correctness-by-sampling** approximation, since semantic properties of TMs are undecidable in
general (you cannot decide whether a given TM computes addition).

## Proposed engine shape (to build)

Follow the CC/SC/FSM pattern — pure, framework-agnostic, side-effect-free, importable from Node:

```ts
// engine/tm.ts  (to be created)
evaluateTMSingleStep(...): { writeSymbol, move: 'L'|'R', nextStateId } | null   // null = halt
evaluateTMSequence(machine, inputTape, opts?): { tape, halted, steps, haltedAt? }
```

- Model the tape as a sparse/grow-on-demand structure (infinite in both directions) with a head
  position. All blank cells read as the blank symbol (0 in a binary alphabet).
- Reuse `STATE` components for control states if the canvas represents TMs that way; carry the
  TM transition (`read : write , move`) on the wire `transitionLabel`, analogous to FSM's
  `"X:Y"`. **Confirm the exact label grammar against the spec before parsing.**
- Add a **step bound** so a non-halting machine terminates grading with a halt/timeout instead
  of looping forever (undecidability of halting → you must cap steps).

## Wiring it into grading (to build)

1. Add a `parseTMTestVector` adapter in `grader.ts` (alongside `parseSCTestVector` /
   `parseFSMTestVector`) that maps the flat `test_vectors` encoding to input/output tapes.
2. Add a `buildMode === 'TM'` branch in `gradeQuestion` that calls `evaluateTMSequence` and
   compares the output tape (decoded under the question's encoding) — **replace** the current
   `skip`.
3. For authoring, add a TM path to `testVectorGen.ts` that **samples** (not enumerates) tapes,
   plus TM support in `QuestionCreator`. Encoding (binary/unary over a variable-length tape)
   follows the same group model as CC — see the DSL section in `grading.md` / `CLAUDE.md`.

## Working-on notes

- Phase 6 ("TM Turbots") layers a TM as a turbot's internal circuitry; it depends on this
  engine plus the (also-unbuilt) turbot workspace.
- Until the engine exists, leave the grader's `skip` in place so TM questions never throw.
- When you build it, add the real spec to this file (signatures, label grammar, sampling
  strategy) and remove the "NOT YET IMPLEMENTED" banner.
