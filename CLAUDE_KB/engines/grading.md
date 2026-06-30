# Grading — autograder, codec, test cases, formula DSL, representation

Covers `engine/grader.ts`, `engine/codec.ts`, `engine/machineValidation.ts`,
`engine/testVectorGen.ts`, `engine/formulaEval.ts`, and `engine/representation.ts`. Read
`overview.md` first; the per-mode evaluation details are in `cc.md` / `sc.md` / `fsm.md` /
`tm.md`. **`pipeline/codec.md` is the authority** for the pipeline structure and data model; this
doc is the as-is, kept in sync with it.

> **The codec is BUILT.** All four modes (CC/SC/FSM/TM) grade the same way: value-based
> `test_cases`, a mode-agnostic **codec** (value↔bits per axis), and one
> `validate → encode → run → accept → decode → compare` path. The old bit-based `test_vectors`
> and per-mode format adapters are **gone**.

## The pipeline

```
instructor authors a question (CCSpec + formula + representation)
   → testVectorGen.generateTestCases(spec, rep)  → question.test_cases  (numeric (x, f(x)) pairs)
student submits a circuit
   → grader.gradeSubmission → per-question grader.gradeQuestion:
        Stage 1  validateMachine(circuit, mode, layout)        → invalid ⇒ every case fails
        Stage 2  per case: encode → run engine → accept → decode → compare values
   → SubmissionResult (persisted on the SubmissionRecord at receipt; see CLAUDE.md)
   → summarizeResult → headline counts for student feedback + instructor gradebook
```

The formula is an **authoring-time** artifact only. Once `test_cases` are generated, the grader
never sees the formula again — it grades each submission against the stored numeric cases.

**Test cases are numbers, not bits.** A `TestCase` is `{ inputs: number[], outputs: number[] }`
— input *values* (one per input group) and `f(x)` values. Bits/tape exist only transiently at
grade time; the codec is the only thing that knows how a number maps to/from a mode's wires /
time steps / tape. So one machine-agnostic bank grades every mode.

## The codec (`engine/codec.ts`) — value ↔ bits per axis

`axisForMode`: CC → `space`, SC/FSM → `time`, TM → `tape`. A `CodecLayout` carries the axis, the
question `rep`, and the per-group `inputWidths`/`outputWidths` (from `cc_spec`).

- **space (CC):** one step; each value's bits across wires **MSB-first**; groups concatenated in
  declaration order. `encodeInput → {bits}`; `decodeOutput` slices the flat output by
  `outputWidths` and decodes each.
- **time (SC/FSM):** a `[step][wire]` grid, **LSB-first** along time, `stepCount =
  max(...inWidths, ...outWidths)` (extra steps drain carries). One wire per value; FSM is the
  `n=1` case (the grader flattens the single wire to the engine's `inputBits`). Sanity check: a
  1-step delay register decodes to **2x** — a legal DSL formula, so the model closes on itself.
- **tape (TM):** delegated to the TM-owned helper `tmCodec.ts` (`encodeTM`/`acceptTM`/`decodeTM`);
  block/separator/`*` layout is irreducibly TM-specific (see `tm.md`). `codec.ts` stays
  space/time-only; the grader routes the tape axis straight to `tmCodec`.

Why LSB-first in time but MSB-first in space: the SC/FSM table runs right-to-left (t1 on the
right), so LSB-at-t1 renders as a normal numeral; space matches the "IN1 is MSB" A/V convention.

**Accept before decode.** `outputAccepted` is the rep-level acceptor — each output group must be a
valid codeword (`isValidCodeword`); binary always accepts, tally rejects e.g. a `101` slice.
`decodeOutput` is **TOTAL** and assumes acceptance. Mode-level acceptance (TM halt/step-limit via
`acceptTM`; a defensive FSM mid-run halt) is the grader's job.

## Stage 1 — machine validation (`engine/machineValidation.ts`)

`validateMachine(circuit, mode, layout, rep) → { ok, reason? }`. An invalid machine **fails every
case** (`graded`, 0/total, the reason on each case) — never `skipped`.

| Mode | check |
|------|-------|
| CC | `#INPUT == Σ inputWidths`, `#OUTPUT == Σ outputWidths` |
| SC | `#INPUT == #input groups`, `#OUTPUT == #output groups` (one wire per value; per-value width is the step count, not structural) |
| FSM | ≥1 state and every STATE has exactly one transition per input bit `{0,1}` (total + deterministic ⇒ no mid-run halt) |
| TM | delegated to `validateTMTable` (≤ one transition per read symbol; labels parse) — `tm.md` |

## `grader.ts` API

- `gradeQuestion(question, circuit) → QuestionResult` — one path for all modes. Reads
  `question.test_cases`, `question.representation` (grading rep; TM notation), and
  `question.cc_spec` (group widths for the space/time codec — TM needs none). **turbot returns
  `status: 'skipped'`**; missing circuit, empty `test_cases`, or (space/time) missing `cc_spec`
  also `skip`. A Stage-1-invalid machine is `graded` with every case failed.
- `gradeSubmission(assignment, submission) → SubmissionResult` — matches each question to its
  answer by `questionId`, grades all, rolls up `passed`/`total` across cases.
- `summarizeResult(result) → { questionsPassed, questionsTotal, vectorsPassed, vectorsTotal }`
  — a question counts as passed only when **graded and every case matched**; **skipped questions
  are excluded** from the totals. The one place "questions passed" is defined — reuse it for both
  student feedback and instructor rollups.

Scoring is **all-or-nothing at the question level**: a question passes iff the machine is valid
and every case passes. No partial credit — a rejected output and a wrong value fail identically.
`CaseResult` is **value-oriented and instructor-only** (students never see failed cases): per
failing case `input` (x), `expected` (f(x)), and either the decoded `got` values or a `reason`
(malformed output / no halt / invalid table). Result types live in `types.ts` (so
`SubmissionRecord` can carry a `result` without a types→engine dependency); re-exported from
`grader.ts`.

## Test-case generation: `testVectorGen.ts`

`generateTestCases(spec: CCSpec, rep: RepSystem) → TestCase[]` enumerates the **entire** input
space (Cartesian product; ranges `0..2ⁿ−1` binary, `0..n` tally), evaluates each output formula,
and stores **numbers** — the output truncated to its group width (the implicit modulus). The mode
never enters generation. (TMs **sample** rather than enumerate — same numeric `TestCase` shape;
TM authoring isn't wired to the DSL yet, so TM samples are hand-authored.)

## value ↔ bits core (`representation.ts`)

The codec's primitives, plus the display helpers:
- `valueToBits(n, width, rep)` — binary MSB-first masked to width (the **implicit modulus**);
  tally `n` ones then zeros, clamped 0..width.
- `isValidCodeword(bits, rep)` — tally requires 1's-then-0's; binary always true.
- `bitsToValue(bits, rep)` — **TOTAL** inverse; precondition `isValidCodeword`. binary base-2;
  tally = count of 1-bits.
- Display (data table + CLI report): `bitsToTally` (count or `null`→`/`), `bitsToBinary`,
  `interpretBits(bits, rep)`.

## The reference-function DSL (`formulaEval.ts`)

The instructor specifies the correct output with a small affine/bitwise arithmetic language; the
system generates the cases. Full reference is in **`CLAUDE.md` → Part 2 → "Reference-function
DSL"**. Essentials:

- `evalFormula(expr, vars) → number` (non-negative integer) or throws `FormulaError`.
- Language: variables (input-group names), non-negative integer literals, `+ - *`, bitwise
  `& | ^ ~`, parentheses. No division/modulo/conditionals/calls.
- Output group **width is the implicit modulus** — e.g. `x + y` into a 1-bit output is XOR; into
  a 2-bit output it also yields the carry. No explicit `% 2`.
- Safety: a strict token whitelist runs before `new Function()` evaluation; acceptable because
  formulas are instructor-authored, never student-supplied.
- **CC authoring only in the UI.** SC/FSM express functions via the same DSL (e.g. SC delay =
  `2 * x`, FSM identity = `x`) and the sample assignment is generated that way (`devData/`), but
  the `QuestionCreator` still emits CC questions only.

## Design constraint to respect

**Students cannot grade their own work.** Today the bundled assignment JSON ships `test_cases`
(the answers) to the client — fine for the prototype because grading happens inside the
`SubmissionStore` seam. In the real product, split the assignment into a client part (statements,
modes) and a server-only part (test cases); the server grades on submit. Don't build features
that assume the client may keep the cases.
