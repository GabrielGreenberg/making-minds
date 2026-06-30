# Plan: Wire autograder ↔ submissions ↔ instructor frontend

## Goal

Connect the three pieces that already exist independently so they form one pipeline:

```
student submits
   ↓  (store on the "server" — localStorage today)
SubmissionStore.submit
   ↓  (autograde on receipt — the server grades, holds the test vectors)
gradeSubmission  →  SubmissionResult persisted on the record
   ↓
Instructor gradebook reads the stored grade  →  scores / pass rates
```

Plus: seed **artificial CC / SC / FSM submissions** so the whole pipeline is
exercised and visibly demonstrated in the instructor UI.

---

## Current state (findings)

- **Storage already works.** `localSubmissionStore.submit(id, submission)` writes
  an immutable `SubmissionRecord` to `mm:sub:<id>`; `store.submitAssignment`
  calls it and mirrors the latest record in `store.submissions`. The Home screen
  (and, per meeting notes, the workbook) exposes a Submit button.
- **Grading already works** for CC, SC, FSM. `grader.ts` dispatches on
  `buildMode`; `gradeSubmission(assignment, submission) → SubmissionResult`
  (per-question `CaseResult[]` with `input/expected/got/pass`). TM/turbot are
  skipped with a reason.
- **The gap:** grading is never triggered at submission and never persisted. The
  instructor `Gradebook.ts` re-grades lazily every time the view opens. There is
  no SC/FSM sample assignment anywhere (bundled `cc-basics.json` is CC-only; the
  QuestionCreator only authors CC), and no end-to-end test of submit→store→grade.

---

## Design: grade on receipt (server model)

The `SubmissionStore` *is* the server stand-in. The existing comment in
`submissionStore.ts` already states the intended model: "the server holds the
test vectors and grades on receipt." So grading belongs in `submit()`, and the
grade is persisted as part of the stored record. When a real server lands, the
endpoint does exactly this and the UI is unchanged.

No import cycle: `submissionStore → assignments/index (getAssignment) → AssignmentStore`
and `submissionStore → engine/grader → engine/{cc,sc,fsm}`. Neither
`assignments`, `AssignmentStore`, nor `grader` imports `submissionStore` or
`store.ts`, so the grader path stays headless-safe (no `window`).

---

## Changes

1. **`types.ts`** — `SubmissionRecord` gains `result?: SubmissionResult`
   (the autograde computed at receipt). Optional, so old records still load.
   Define `SubmissionResult`/`QuestionResult`/`CaseResult` as shared types in
   `types.ts` and have `grader.ts` re-export them, so `types.ts` need not depend
   on the engine.

2. **`engine/grader.ts`** — add `summarizeResult(result): { questionsPassed,
   questionsTotal, vectorsPassed, vectorsTotal }`. Reused for student feedback
   and instructor rollups so the "questions passed" definition lives in one place.

3. **`storage/submissionStore.ts`** — `LocalSubmissionStore.submit` autogrades on
   receipt: look up the assignment via `getAssignment(id)`, call
   `gradeSubmission`, attach `result` to the record before persisting. If the
   assignment is unknown, store with `result` undefined (graceful).

4. **`instructor/Gradebook.ts`** — `gradeSubmissions` prefers `record.result`
   when present; falls back to computing via `gradeSubmission` for legacy records.
   The instructor frontend now *reflects the stored autograde* instead of
   recomputing blindly.

5. **`components/HomeScreen.tsx`** — after submitting, surface the autograde
   summary to the student (e.g. "Submitted — autograded N/M questions passed")
   using `summarizeResult(record.result)`. Keep the JSON download as a secondary.

6. **Sample data + tests** (the "artificial submissions"):
   - **`devData/sampleData.ts`** (pure, no storage): builders for a sample
     multi-mode assignment with **CC, SC, and FSM** questions, where each
     question's `test_vectors` are generated from a known-correct circuit
     (CC via `generateCCTestVectors`; SC via `evaluateSCSequence`; FSM via
     `evaluateFSMSequence`). Plus builders for **correct** and **incorrect**
     submissions per mode (the incorrect ones mutate a wire/transition).
   - **`tools/pipelineCheck.ts`** (run with `npx tsx`): grade the correct
     submission (expect 100%) and the incorrect submission (expect <100%) for
     each of CC/SC/FSM; assert and print. This validates the grader + the SC/FSM
     format adapters against real circuits.
   - **`devData/seed.ts`** + a **"Load sample data (dev)"** button on the
     instructor dashboard: writes the sample assignment via `localAssignmentStore`
     and submits several artificial students through the *real* `submit()` path
     (so they autograde and persist), then re-renders. This makes the full
     pipeline visible in the gradebook (varied scores, per-question pass rates).

---

## Verification

- `npx tsx tools/pipelineCheck.ts` — CC/SC/FSM correct = pass, incorrect = fail.
- `npm run build` (tsc + vite) and `npm run lint` clean on changed files.
- Manual: instructor dashboard → "Load sample data" → sample assignment appears
  with N submissions; open Submissions → grades, mean score, and per-question
  pass rates render; expanding a failing row shows the failed test vectors.

## Out of scope

- TM grading (no simulation engine yet — already skipped).
- Real multi-user server / student identity / SSO.
- Authoring SC/FSM questions in the QuestionCreator (sample data is seeded
  directly; the creator stays CC-only).
