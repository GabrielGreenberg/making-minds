# Grading — autograder, test vectors, formula DSL, representation

Covers `engine/grader.ts`, `engine/testVectorGen.ts`, `engine/formulaEval.ts`, and
`engine/representation.ts`. Read `overview.md` first; the per-mode evaluation details are in
`cc.md` / `sc.md` / `fsm.md` / `tm.md`.

## The pipeline

```
instructor authors a question (CCSpec + formula)
   → testVectorGen.generateCCTestVectors  → question.test_vectors  (stored on the assignment)
student submits a circuit
   → grader.gradeSubmission → per-question grader.gradeQuestion → engine evaluation per vector
   → SubmissionResult (persisted on the SubmissionRecord at receipt; see CLAUDE.md)
   → summarizeResult → headline counts for student feedback + instructor gradebook
```

The formula is an **authoring-time** artifact only. Once `test_vectors` are generated, the
grader never sees the formula again — it grades bit-exactly against the stored vectors.

## Test-vector format

Each vector is `{ input_sequence: number[], expected_output: number[] }` — flat bit arrays.
Interpretation is **per build mode**:

| Mode | `input_sequence` meaning | adapter |
|------|--------------------------|---------|
| CC | one full input combination; `evaluateCCInputs` runs it once | (none — used directly) |
| SC | a flat concatenation of per-cycle inputs; chunked into steps | `parseSCTestVector` (infers step width from the circuit's INPUT/OUTPUT counts) |
| FSM | one input bit per step | `parseFSMTestVector` (pass-through) |
| TM | — | not implemented (`tm.md`) |

The **format adapters** at the top of `grader.ts` are the most likely thing to change as the
question-design workflow evolves — they are deliberately isolated so the engines stay
untouched. When grading looks wrong for SC/FSM, suspect the adapter before the engine.

## `grader.ts` API

- `gradeQuestion(question, circuit) → QuestionResult` — dispatches on `question.buildMode`. CC
  / SC / FSM are graded; **TM and turbot return `status: 'skipped'`** with a reason (never
  throw, never silently pass). Missing circuit or empty `test_vectors` also `skip`.
- `gradeSubmission(assignment, submission) → SubmissionResult` — matches each question to its
  answer by `questionId`, grades all, rolls up `passed`/`total` across test vectors.
- `summarizeResult(result) → { questionsPassed, questionsTotal, vectorsPassed, vectorsTotal }`
  — a question counts as passed only when **graded and all its vectors matched**; **skipped
  questions are excluded** from the totals so they don't penalise the student. This is the one
  place "questions passed" is defined — reuse it for both student feedback and instructor
  rollups.

Result types (`CaseResult`, `QuestionResult`, `SubmissionResult`) live in `types.ts` (so
`SubmissionRecord` can carry a `result` without a types→engine dependency) and are re-exported
from `grader.ts`.

## Test-vector generation (CC): `testVectorGen.ts`

`generateCCTestVectors(spec: CCSpec)` enumerates the **entire** CC input space (Cartesian
product over input groups), evaluates each output formula, and serialises to vectors.

- `decodeBits(bits, encoding)` / `encodeBits(n, width, encoding)` convert between bit arrays and
  integers. **binary** = MSB first; **unary** = count of 1-bits (`k` ones ⇒ `k`), clamped to
  width on encode. Binary encode masks to the least-significant `width` bits → this truncation
  is the **implicit modulus** (see DSL below).
- Input group value ranges: `0..2ⁿ−1` (binary) or `0..n` (unary).
- Bit layout matches `evaluateCCInputs` exactly: groups in declaration order, MSB first within
  a group. **Changing one side without the other corrupts grading.**

## The reference-function DSL (`formulaEval.ts`)

The instructor specifies the correct output with a small affine/bitwise arithmetic language;
the system generates the vectors. Full reference is in **`CLAUDE.md` → Part 2 → "Reference-
function DSL"**. Essentials:

- `evalFormula(expr, vars) → number` (non-negative integer) or throws `FormulaError`.
- Language: variables (input-group names), non-negative integer literals, `+ - *`, bitwise
  `& | ^ ~`, parentheses. No division/modulo/conditionals/calls.
- Output group **width is the implicit modulus** — e.g. `x + y` into a 1-bit output is XOR; into
  a 2-bit output it also yields the carry. No explicit `% 2`.
- Safety: a strict token whitelist runs before `new Function()` evaluation; acceptable because
  formulas are instructor-authored, never student-supplied.
- **CC only today.** SC/FSM/TM authoring is not wired to the DSL; those sample assignments are
  seeded directly in `app/src/devData/` from known-correct circuits.

## Representation systems (`representation.ts`)

How bit strings are shown to students in the data tables (display, not grading):
- `bitsToTally(bits)` — valid tally is consecutive 1's then 0's; returns the count, or `null`
  (rendered `/`) if a 1 follows a 0.
- `bitsToBinary(bits)` — standard base-2, MSB left.
- `interpretBits(bits, rep)` — `'tally'` → count or `/`; otherwise binary.

Shared by the UI table and the grader/CLI report so both interpret bits identically.

## Design constraint to respect

**Students cannot grade their own work.** Today the bundled assignment JSON ships
`test_vectors` (the answers) to the client — fine for the prototype because grading happens
inside the `SubmissionStore` seam. In the real product, split the assignment into a client part
(statements, modes) and a server-only part (test vectors); the server grades on submit. Don't
build features that assume the client may keep the vectors.
