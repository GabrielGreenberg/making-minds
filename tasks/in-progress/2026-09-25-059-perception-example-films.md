---
id: 2026-09-25-059
type: feature
title: Let an instructor mark an authored perception film "show to students as an example", delivered without exposing the grading bank
priority: low
size: large
requires: browser
area: app
source: chat
created: 2026-09-25T16:15:00-07:00
status: in-progress
after: 2026-09-21-013
branch: robot/059-perception-example-films
merged_into:
---

## Description
This is the follow-up to task 013, which adds instructor-authored frame films to SC
perception questions. Gabriel decided in the 2026-09-25 catch (013 `### Resolved decisions`
2) that each authored film gets a per-film **"show to students as an example"** flag. A
flagged film is visible to students before grading: they can load it into their frame player
and run their machine on it. Unflagged films stay hidden in the grading bank, as 013 builds
them.

## Done when
- **Authoring.** In the question creator's perception editor (013's `PerceptionEditor`),
  each authored film has an "Example for students" toggle.
- **The student side.** Before grading, a student's frame player (`PerceptionFramePlayer`)
  lists the flagged films as examples, and one click loads a film to step and run. Each shows
  its expected output row (see the decision below).
- **Law 1 holds, in both modes.**
  - `perception_cases` is still stripped wholesale for students (`server/src/sanitize.ts`
    :48, :56).
  - Examples travel in their own student-visible field, derived at save time.
  - The grader never reads that field.
  - `parityCheck` and `remoteStoreCheck` are green, with a pin that an unflagged film never
    reaches a student payload.
- **Gates.** `perceptionCheck`, `caseRunCheck` and `pipelineCheck` pin the derivation. Every
  gate in PROFILE §6 is green.

## Design
**deepFix.** Keep the example data out of the answer key:
- At save, derive `perception_examples: {frames, expected}[]` (`types.ts`, next to
  `perception_cases?` at :293 and `PerceptionTestCase` at :1062) from the films flagged
  `example`. It is a separate field, safe by construction.
- The sanitizer keeps stripping `perception_cases` wholesale and never learns about flags.
  So the sanitizer can't un-strip anything by accident, and a bug in flag handling can at
  worst drop an example.

**surgicalFix, rejected.** Teach `sanitize.ts` to keep flagged entries inside
`perception_cases`. That makes the stripper per-entry and puts law 1 at the mercy of a flag.

**Decision the catcher defaulted (Gabriel may overrule at claim).** An example shows its
expected output row. It is a worked example, and the rule is already stated in the question.
Showing one film's answer reveals nothing the statement doesn't. Flag it in `/work` if unsure.

## Verify
- **Gates:** everything in PROFILE §6.
- **Browser (requires: browser):**
  - Author two films on an SC motion question and flag one.
  - As a student, in local and remote mode: only the flagged film appears, it loads and runs,
    and the expected row shows.
  - After grading, both films appear under "Run this input" as 013 built it.

## Progress log
- 2026-09-27 (robot, implement): per-film "Example for students" flag in the perception editor
  (`DraftFilm {frames, example}`); `buildPerceptionCases(spec, films, exampleIdx)` marks
  `example: true` inside the stripped bank, `perceptionExamples` derives the flag-free
  `perception_examples` at save (key omitted when none — HW3 P12's hash stable). The frame
  player lists them (one click → `setScFrames`), showing an `expected` row while the grid is an
  example unedited (`matchingPerceptionExample`). `sanitize.ts` logic untouched (comment only).
  Pins: perceptionCheck [example films] (+ grader/caseRun/score grep gate), caseRunCheck
  [perception example ≡ grader], pipelineCheck [perception films] (served example; tampered
  examples grade the same), parityCheck (scoped `expected` allow-list + self-test; unflagged
  film absent from the student assignment), remoteStoreCheck. Browser checks still owed.

### 2026-09-27 — implemented (work loop)
- **Built:** instructors tick "Example for students" on any authored SC perception film; at
  save the flagged films become `perception_examples` ({frames, expected}), a separate
  student-visible field. The student frame player lists them; one click loads the film, and its
  expected row shows while the grid holds that example unedited. `perception_cases` is still
  stripped wholesale (`sanitize.ts` logic unchanged); the grader never reads the new field.
  Decision kept: an example shows its expected row.
- **Pins:** perceptionCheck [example films] (+ grader/caseRun grep gate), caseRunCheck
  [perception example ≡ grader], pipelineCheck [perception films] (tampered examples grade the
  same), parityCheck (scoped `expected` allow-list; unflagged film absent), remoteStoreCheck
  (student get: one example, unflagged frames nowhere).
- **Gates:** app-tsc=0 app-build=0 app-check=0 server-tsc=0 server-check=0. Review findings
  fixed: none; skipped: none.
- **Owed:** browser checks (local + remote: author/flag/persist; student Examples row loads and
  runs, expected row hides on edit, works on locked questions; network payload shows
  `perception_cases: []`; post-grading "Run this input" lists both films).
- **Next step:** loop session: visual check if owed, then land per PROFILE §5.
