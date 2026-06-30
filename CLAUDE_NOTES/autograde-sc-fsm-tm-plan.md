# Autograding SC, FSM, TM — Status and Next Steps

## Status

**The engine layer is complete and merged to `main` (commit `2038a42`).**

SC and FSM simulation engines exist, the grader dispatches on `buildMode`, and the
store delegates to the same engine code the grader uses. The remaining work is
connecting the grader to real submission data — see "What's left" below.

---

## What was built

### `app/src/engine/sc.ts` (new)

Two exported functions:

**`evaluateSCSingleStep(components, wires, inputBitVector, sortedInputs, sortedOutputs, sortedMems, memStoredValues)`**
→ `{ outputBits, newMemValues, portValues }`

Runs one clock cycle. Caller provides pre-sorted component lists and the current
MEM stored values; the function returns the output bit-vector, the new MEM values
(ready for the next cycle), and the full portValues map (used by the store to
update wire display values). No side effects.

**`evaluateSCSequence(components, wires, inputSteps, initialMemValues?)`**
→ `number[][]`

Loops over `inputSteps` calling `evaluateSCSingleStep` each cycle. Returns one
output bit-vector per time step. This is what the grader calls.

Both functions are framework-agnostic (no React, no Zustand, no DOM).

---

### `app/src/engine/fsm.ts` (new)

Three exported functions:

**`sortStateComponents(components)`** — sorts STATE components by numeric suffix
of their label (S₀ < S₁ < …), using Unicode subscript digits.

**`evaluateFSMSingleStep(wires, currentStateId, inputBit)`**
→ `{ output, nextStateId } | null`

Looks up the outgoing transition wire from `currentStateId` whose `transitionLabel`
matches `inputBit`. Returns `null` if no match (machine halts). Transition labels
are `"X:Y"` where X is the input bit and Y is the output bit.

**`evaluateFSMSequence(components, wires, inputBits)`**
→ `{ outputBits, halted, haltedAt? }`

Runs the full sequence from S₀. Stops early if no matching transition is found.

---

### `app/src/engine/grader.ts` (updated)

`gradeQuestion` now dispatches on `question.buildMode`:

| buildMode | behaviour |
|-----------|-----------|
| `'CC'`    | existing logic unchanged |
| `'SC'`    | `parseSCTestVector` chunks flat arrays by `numInputs`/`numOutputs` (inferred from the circuit), then calls `evaluateSCSequence` |
| `'FSM'`   | `parseFSMTestVector` passes flat arrays through as-is (one bit per step), calls `evaluateFSMSequence`; a halted FSM returns `pass: false` with partial `got` for feedback |
| `'TM'`    | skipped with reason |
| `'turbot'`| skipped with reason |

The format adapters (`parseSCTestVector`, `parseFSMTestVector`) are small isolated
helpers at the top of `gradeQuestion`. They are the most likely thing to change
as the test-vector format evolves — update them without touching the engines.

---

### `app/src/engine/index.ts` (updated)

New exports:
```ts
export { evaluateSCSingleStep, evaluateSCSequence } from './sc';
export type { SCSingleStepResult } from './sc';
export { sortStateComponents, evaluateFSMSingleStep, evaluateFSMSequence } from './fsm';
export type { FSMStepResult, FSMEvalResult } from './fsm';
```

---

### `app/src/store.ts` (refactored)

- `scStep` no longer contains its own propagation loop. It builds the sorted
  component lists and current input/MEM values, calls `evaluateSCSingleStep`,
  then applies the results to Zustand state (components, wires, history,
  tableRows, scGlobalSequences). The observable behaviour is identical.
- `fsmStep` no longer contains its own transition-matching loop. It calls
  `sortStateComponents` and `evaluateFSMSingleStep` from the engine, then
  applies results to Zustand state.

---

## What's left: connecting the grader to submissions

The grader pipeline (`gradeSubmission` / `gradeQuestion` in `grader.ts`) is
complete. The missing piece is **wiring it to actual submission data** so results
surface in the UI or an export.

### Entry points to understand

- **`app/tools/grade.ts`** — CLI grader. Reads an assignment JSON and a
  submission JSON from disk, calls `gradeSubmission`, prints results. Good for
  smoke-testing with sample data. Run with:
  ```
  npx ts-node app/tools/grade.ts <assignment.json> <submission.json>
  ```
- **`gradeSubmission(assignment, submission)`** in `grader.ts` — the main
  programmatic entry point. Takes `AssignmentData` and `SubmissionData` from
  `types.ts`; returns `SubmissionResult`.

### What "connecting to submissions" means

1. **Where do submissions live?** Find where `SubmissionData` objects are stored
   or fetched (database, Supabase table, local file, etc.) and read the schema.
   The type is in `app/src/types.ts`.

2. **Where does grading get triggered?** Decide whether grading happens:
   - On demand (teacher clicks "Grade" in the UI)
   - Automatically on submission
   - Via the CLI tool against exported data

3. **How do results get surfaced?** `SubmissionResult` has `passed`/`total` and
   per-question `CaseResult[]` (with `input`, `expected`, `got`, `pass` for each
   test vector). Decide where these are stored and how they're displayed.

4. **Test with real data.** The SC and FSM format adapters (`parseSCTestVector`,
   `parseFSMTestVector` in `grader.ts`) make assumptions about flat array encoding
   that may need adjustment once real test vectors exist. Check them first.

### Key files to read before starting

- `app/src/types.ts` — `AssignmentData`, `AssignmentQuestion`, `SubmissionData`,
  `CircuitData` shapes
- `app/src/engine/grader.ts` — full grading pipeline (short, ~165 lines)
- `app/tools/grade.ts` — CLI entry point and example of how to call `gradeSubmission`

### TM

TM has no simulation engine yet — grading TM questions is blocked on that.
`gradeQuestion` already returns `skipped` for `buildMode === 'TM'` so it won't
throw.
