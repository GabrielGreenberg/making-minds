---
id: 2026-09-21-002
type: feature
title: Load a failed test input from the grade sheet into a live Run on the question canvas
priority: normal
size: large
requires:
area: app
source: claude-md
created: 2026-09-21T15:30:00-07:00
status: ready
after:
branch:
merged_into:
---

## Description
Since 2026-09-17 a student's grade sheet (`GradesPanel.tsx` → `FailedInputs`) lists which
inputs a question failed on, with a link into the frozen question view. Clicking a failing
input does NOT populate it into a live Run — the harder half of `notes/todos.md` item 4,
skipped then because each mode has a different "set this input" mechanism and no browser was
available to verify.

## Done when
- From the failed-inputs dropdown, "Run this input" opens the question and runs it on exactly
  the grader's input stream for that case, in every mode with value cases (CC, SC, FSM, TM)
  and for turbot (select that arena) — verified in the browser for each.
- The run's verdict on screen matches the recorded case result.

## Design
- Mechanisms today: CC = INPUT component toggles; SC/FSM = the typed global input parsed as a
  value per group and laid out by `selectCodecLayout`/`encodeInput` (`store.ts`); TM = tape
  cells via `setTmCell`/`tmTape`; turbot = the arena index in `turbot_cases`.
- **deepFix (recommended):** one store action `loadCaseInput(questionId, caseRef)` that
  dispatches on `selectEffectiveMode` and, for codec modes, reuses the codec's own
  `encodeInput` (the grader's layout) so the on-screen run IS the grader's run — the SC/FSM
  window contract (`scWindowCheck`) already guarantees the rest. Turbot: set the live arena.
- **surgicalFix:** per-mode buttons calling the existing setters directly.
- Undiagnosed detail: CC input group → INPUT component mapping by label order (`sortByLabel`).

## Verify
`navResetCheck`/`scWindowCheck`-style store harness pin: load case → run → decoded output
equals the case's expected. Browser eyeball of all five paths (owed until done).

## Progress log
