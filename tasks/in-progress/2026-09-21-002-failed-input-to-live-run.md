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
status: in-progress
after:
branch: task/002-failed-input-to-live-run
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

### 2026-09-23 — implemented (work loop)
- **Built.** On the grade sheet every failed value input (`x = 3, y = 5`, plus `(gap n)` for
  a TM case's block separations) and every failed turbot arena carries **Run this input →**,
  which routes to `#/a/:id/q/:i/case/:k`. The route opens the question and calls the new store
  action `loadCaseInput(questionId, k)`. That action reads case k of the latest recorded
  result (results are parallel to their banks), restarts every run slice (intervals stopped,
  MEMs at 0, undo history kept), and loads the grader's own stimulus: CC sets the INPUT toggles
  in engine label order, SC/FSM get the typed-input digits that re-encode to the codec's
  stream, TM gets `encodeTM` with the case's separations, and a turbot gets
  `turbot_cases[k]`'s arena (`turbotCaseIndex`). It then runs to the grader's end. The run
  (component-local SC animation notwithstanding) is shown finished at once; Reset replays it
  from t=1. The new `GradedCaseBanner` sits under the question statement in every mode's
  panel. It shows the recorded verdict (✗ reason / "wrong output", never the key), the live
  verdict of the canvas machine through the grader's own case run (the decoded output, or
  why it was rejected; a turbot's full result), and "Same as when graded" when they match.
  The Map says "arena k of N".
- **Engine.** New pure `engine/caseRun.ts` (`questionLayout`, `gradingCircuit`,
  `validateQuestionMachine`, `caseStimulus`, `runValueCase`, `runTurbotCase`,
  `gradedMachineKey`). The grader is now caseRun plus the comparison, and every reason string
  is byte-identical. `CaseResult.separations` is recorded by the grader and kept by
  `sanitize.ts` (input layout, not the key). Without it, a remote student replaying one of
  HW5 P4's 48 gap cases would get a different tape. `TMEvalResult.finalStateId` is new
  (additive), and `cc.ts sortByLabel` is exported.
- **Grader bug fixed.** The grader now grades from rest. `gradingCircuit` zeroes saved MEM
  contents at `gradeQuestion`'s entry. Before this, an SC machine, an SC turbot brain or an
  SC perception machine started from whatever `storedValue` the student's last UI run left in
  the autosaved and submitted circuit. In-question turbot runs start from rest as well.
- **Settled by the loop session, open to Gabriel's revision.**
  (1) *Divergence.* When grades are released before the due date and the question was edited
  after submitting, "Run this input" runs the CURRENT machine. The banner says so plainly:
  "You've changed this question since you submitted — this runs your current machine." It
  shows both verdicts without claiming they are the same run. The link is not hidden. This
  follows from simulation never being locked, and checking a fix against a failed input is
  the most useful case; task 003's view-submission mode may make it moot.
  (2) *Step budgets.* TM and turbot question runs ALWAYS stop at the grader's budgets
  (`DEFAULT_TM_MAX_STEPS`; the shown arena's `maxSteps`, 'limit'), not only while a case is
  loaded (`selectQuestionStepBudget`). Sandbox Run keeps the 1000 cap (`UI_RUN_STEP_CAP`) and
  sandbox Step stays unbounded. This is the Critical design rule "question runs ARE the
  grader's runs" extended to TM and turbot, updated in CLAUDE.md.
- **Pins.** New `app/tools/caseRunCheck.ts` is in `npm run check`. It pins
  [engine ≡ grader] on every non-perception reference fixture (correct, broken, empty canvas;
  parallel results; separations carried), [MEM scratch] (and that the raw engine would
  differ), [store load] for CC, SC tally and binary, FSM tally and k=2, TM gaps and binary,
  and turbot CC/SC/FSM/TM brains including k > 0 and a never-stopping brain, [remote shape]
  (`stripAnswers` + `studentRecord`: hw5-p4 gap tapes and live verdicts), [same question]
  (a load mid-run, a superseded load, no-op loads) and [step budgets]. `navResetCheck` plants
  `loadedCase`/`turbotCaseIndex` junk and asserts both reset on every canvas swap and on
  sign-out. `routingCheck` [case route] covers parse, round trip, malformed segments, access,
  and apply (load after switch; same question; none without a case). `parityCheck` §7 checks
  that a student's copy keeps `separations` with expected/got blank.
- **Browser (local mode, dev server).** Checked on a throwaway assignment of fixture
  questions (hw2-p1 CC, hw3-p7 SC tally, hw4-p11 FSM, hw5-p4 TM, hw3-p15 SC-turbot, hw6-p2
  TM-turbot), broken machines submitted, grades released, past due. Every link in the
  dropdown opened the question with the grader's stimulus. CC x=3 showed IN 0011 with output
  2. SC x=2 typed 11000000, ran 11 steps and got the recorded malformed output. FSM x=2, y=2
  typed 000000001100. TM y=1, x=3 gap 3 got the initial tape `1___111`. The turbots went to
  arena 3 of 3. Each showed "Same as when graded", and SC Reset+Run replayed the same 11-step
  output. With a future due date, deleting a gate showed the divergence note and the current
  machine's output, and undo brought back "Same as when graded". ✕ drops `/case/k` from the
  URL. **Owed:** a remote-mode eyeball (pinned headlessly by [remote shape]).

### 2026-09-23 — review fixes (work loop)
- **The banner compares against the case's own attempt.** `LoadedCase.gradedKey` is the
  `gradedMachineKey` of the machine THAT attempt submitted, taken at load time. Before, the
  banner compared the canvas with the LATEST record's machine. So after a fix was resubmitted,
  attempt 1's ✗ showed "Same as when graded" beside a different machine's run. The wording now
  lives in the pure `gradeDisplay.gradedCaseView`, which returns one of four notes: same,
  differs, changed (the settled wording, unchanged) or resubmitted ("You've submitted again
  since attempt N was graded — this runs your current machine."). "Run again" moves to the
  latest attempt's case.
- **Older results get their separations.** Results graded before cases carried `separations`
  used to replay HW5 P4 gap cases on a gap-less tape. Now one rule,
  `engine/caseRun.recordedCaseSeparations`, fills them in: bank case k, only when it has the
  same input. The server applies it when it serves a student's own records
  (`studentRecord(record, released, assignment)` on both submission routes). The store and
  the grade sheet apply it locally.
- **✕ puts the Map back on the primary arena.** `clearLoadedCase` also resets
  `turbotCaseIndex` and re-seats the turbot, so it matches the URL it leaves behind.
- **Pins.** `caseRunCheck` gains [older results] (served with and without the assignment, an
  edited bank, remote and local replays of hw5-p4 gap cases), [resubmit] (the four notes,
  Run again, and resubmitting the same machine) and [dismiss]. `parityCheck` §7 gains an
  older stored result, filled through the real student route.

### 2026-09-23 — implemented (work loop)
- **Checkpoint.** A student can now replay a failed input from the grade sheet. Each failed
  value input or turbot arena has **Run this input →**. It opens the question on the grader's
  own stimulus for that case, runs it to the grader's end, and shows the recorded verdict
  beside the live one. This works for CC, SC, FSM and TM, and for turbots, which are put on
  arena k. The mechanism is `engine/caseRun.ts`: the grader is now caseRun plus the
  comparison. The store action is `loadCaseInput`, the route `#/a/:id/q/:i/case/:k`, and the
  banner `GradedCaseBanner` (its wording comes from `gradeDisplay.gradedCaseView`).
  The server keeps each case's `separations`, never the key.
- **Pins.** `caseRunCheck` (new, in `npm run check`) has these sections: [engine ≡ grader],
  [MEM scratch], [store load] (local and remote shape), [same question], [older results],
  [resubmit], [dismiss] and [step budgets]. Also extended: `navResetCheck` (loadedCase and
  turbotCaseIndex reset), `routingCheck` [case route] and `parityCheck` §7 (separations kept,
  expected/got blank, an older result filled through the student route).
- **Gates, re-run at checkpoint, by exit code:** app-tsc=0, app-build=0, app-check=0,
  server-tsc=0, server-check=0.
- **Review findings.** Fixed: 1+3 (the banner compares against the case's own attempt), 2+4
  (older results get their separations: one rule, applied on the server and locally) and 5
  (✕ re-seats the turbot on the primary arena). Skipped: none. Nit left alone: Run keeps
  arena k's step budget after ✕ until the next canvas swap.
- **Settled decisions (divergence note; step budgets always in questions).** These are
  recorded above as settled by the loop session and remain open to Gabriel's revision.
  CLAUDE.md's Critical design rule has been updated in place (39975/40000 bytes).
- **Owed (the loop session does these).** First, a browser pass in local mode on the real
  HW1/3/4/5 questions, after the review fixes: one row per mode through Grades → ▸ failed inputs → Run this input, then
  Reset → Step replay; the new rows and links in light and dark and at phone width; a frozen
  homework showing no note; the divergence note after editing a question that is not frozen.
  Second, remote mode (`api-scratch` on 8199 plus a remote-mode Vite): the HW5 P4 gap case,
  whose record response must carry `separations` and no expected/got. If a launch
  configuration will not start, record that part as owed under Verify.
- **Next step:** loop session: visual check (owed above), then land per PROFILE §5.
