# Autograding pipeline — submit → grade-on-receipt → gradebook

**Status: implemented** (commit `680b4e6`, "Wire autograder to submissions"). This doc is the
**as-built** reference; it was distilled from the original plan
(`CLAUDE_NOTES/wire-autograder-plan.md`) and the SC/FSM/TM engine status note
(`CLAUDE_NOTES/autograde-sc-fsm-tm-plan.md`), both preserved in git history. It describes how
the three independently-built pieces — student submit, the headless grader, the instructor
gradebook — connect into one pipeline.

## The flow

```
student clicks Submit (Home card or workbook)
  → buildSubmission(def, questionCircuits)            storage/submissionStore.ts (pure)
  → localSubmissionStore.submit(id, submission)       the "server" stand-in
        ↳ getAssignment(id) → gradeSubmission(...)     autograde ON RECEIPT
        ↳ result persisted on the SubmissionRecord
  → SubmissionRecord stored at mm:sub:<id> (append-only attempts)
instructor opens the gradebook
  → Gradebook.gradeSubmissions reads record.result (no recompute)
  → scores, per-question pass rates, failed-case drill-down
```

## Grade on receipt (the server model)

`SubmissionStore` **is** the server stand-in, so grading belongs at submit time — the server
holds the test cases and grades the moment a submission lands. In
`storage/submissionStore.ts`, `LocalSubmissionStore.submit` looks up the assignment via
`getAssignment(id)`, calls `gradeSubmission`, and attaches `result` to the record before
persisting. If the assignment is unknown, `result` is left `undefined` (graceful). When a real
server endpoint lands it does exactly this; the UI is unchanged.

`SubmissionRecord.result?: SubmissionResult` (in `types.ts`) is **optional**, so records saved
before autograde-on-receipt still load. `Gradebook.gradeSubmissions` prefers `record.result`
and only falls back to `gradeSubmission(...)` for those legacy records.

### No import cycle

`submissionStore → assignments/index (getAssignment) → AssignmentStore` and `submissionStore →
engine/grader → engine/{cc,sc,fsm}`. Neither `assignments`, `AssignmentStore`, nor `grader`
imports `submissionStore` or `store.ts`, so the grader path stays headless-safe (no `window`).

## What each piece already provided

- **Storage** — `localSubmissionStore.submit` writes an immutable `SubmissionRecord`;
  `store.submitAssignment` calls it and mirrors the latest record. Submit is exposed on the Home
  cards and in the workbook.
- **Grading** — `engine/grader.ts` runs one value-based codec pipeline for **CC, SC, FSM, TM**
  (`validate → encode → run → accept → decode → compare`); turbot is skipped with a reason. See
  `CLAUDE_KB/engines/grading.md` and `pipeline/codec.md`.
- **Engines** — pure SC/FSM simulators (`engine/sc.ts`, `engine/fsm.ts`) and the store delegate
  to the same code the grader uses. See `engines/sc.md`, `engines/fsm.md`.

The gap that this wiring closed: grading was never triggered at submission nor persisted, and
the gradebook re-graded lazily on every open.

## Student feedback

`engine/grader.ts` exports `summarizeResult(result) → { questionsPassed, questionsTotal,
vectorsPassed, vectorsTotal }` — the single definition of "questions passed" (graded + all
vectors matched; skipped questions excluded). `HomeScreen` surfaces this after submit
("autograded N/M questions passed"); the JSON download remains a secondary handoff.

## Sample / dev data

`devData/sampleData.ts` builds a multi-mode (CC + SC + FSM) sample assignment whose `test_cases`
are generated from a `cc_spec` + DSL formula per question (`generateTestCases`): CC `a & b`
(space), SC `2 * x` implemented by a delay register (time), FSM `x` by a pass-through identity
(time). It ships correct and deliberately-broken submissions. `devData/seed.ts` (a "Load sample
data" button on the instructor dashboard) writes the assignment via `localAssignmentStore` and
submits artificial students through the **real** `submit()` path, so they autograde and persist
and the gradebook shows varied scores. `tools/pipelineCheck.ts` (`npx tsx`) asserts correct =
100% / broken < 100% for CC/SC/FSM; `tools/codecCheck.ts` unit-tests the codec + rep core.

## Out of scope

- TM **store + UI** — the TM engine, validation, codec, and value-based grading are built (it
  grades through the unified codec pipeline); the store (`tmStep`) and UI are not (`engines/tm.md`).
- SC/FSM/TM **authoring** in `QuestionCreator` (CC-only today; samples are seeded).
- Real multi-user server / student identity / SSO.
- Authoring SC/FSM questions (samples are seeded; the creator stays CC-only).
