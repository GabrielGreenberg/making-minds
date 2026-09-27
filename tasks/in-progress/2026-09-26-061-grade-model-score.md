---
id: 2026-09-26-061
type: feature
title: Define the grade once — a pure scoreSubmission (1 point per problem, ½, 40 + 60·P, late deduction) and the automatic ½ rule; retire the three score rules
priority: high
size: large
requires: browser
area: app
source: chat
created: 2026-09-26T21:34:00-07:00
status: in-progress
after: 
branch: task/061-grade-model-score
merged_into:
---

## Description
Filed from task 031's accepted design (Gabriel approved 2026-09-26, with its three proposed defaults). Authority: the memo `docs/buildout/designs/grading-interface.md` — its §3 table records every decision; read it before starting. Slice 1 of 11 (memo §12). HW1 is due Oct 4 and is returned about a week later, so slices 1–8 carry the schedule.

Today a student's score is computed three different ways that disagree (memo §2.2:
`instructor/Gradebook.ts:26-61`, `engine/grader.ts:309-321` `summarizeResult`,
`components/GradeSheet.tsx:119-123`), the grader is pass/fail only, and the policy's
0 / ½ / 1 points and 40 + 60·P grade exist nowhere. This slice is the model every later slice
stands on (memo §4).

## Done when
- `app/src/engine/score.ts` (pure; the server imports it): `scoreSubmission`, `answerKey`,
  `lateDeduction` with the signatures of memo §4.8. Precedence human > autograde (1, or ½ by
  the rule) > pending (0 earned, grade provisional); a human grade applies only while its
  `answerKey` matches the latest attempt's answer, else the problem is "changed" with the old
  grade as `suggestion` (§4.2, §4.4). G = 40 + 60·P rounded to 0.1; final = max(0, G − D);
  Missing when past the effective due date with no submission (exports as 0, §4.5).
- `lateDeduction(submittedAt, effectiveDue, policy, calendar)`: 5 once late + 5 per class
  meeting that has ENDED in between (`per-meeting`), or per full 24 h (`per-day`); takes the
  calendar as a parameter (the real one arrives in 2026-09-26-068 — until then callers pass
  none and D = 0).
- `AssignmentQuestion.half_credit_at?: number` (memo §4.3): ½ when ≥ K of the question's N
  cases pass (value / turbot / perception / fill-in case vectors alike); a Stage-1 rejection
  never earns automatic ½. Set in `QuestionCreator` ("½ if ≥ K of N cases pass", N live);
  `validateDocument` rejects K ≥ N or K < 1; the creator re-validates when a bank rebuilds.
- The three old rules are gone: `Gradebook.ts`'s score, `GradesView`/`HomeScreen`'s "N of M
  correct" and `GradeSheet`'s tally all read `scoreSubmission`. Until 2026-09-26-063 stores
  grades, an adapter feeds existing `questions[i].manual` reviews in as human grades.
  Released grades show as **82.5 / 100** on the Grades tab; the sheet shows per-problem points
  (1 · ½ · 0 · awaiting review).
- New `app/tools/scoreCheck.ts` in `npm run check`: precedence, the ½ rule per mode, Stage-1
  zero, carry-forward vs changed, rounding, floor at 0, Missing, provisional, and the late math
  over a fixture calendar (a holiday week, an in-class exam meeting, submitting during a
  lecture = not yet passed, per-day). `server/tools/parityCheck.ts` extended: the server's
  score ≡ the client's.

## Design
- **deepFix:** one pure function owns what a grade is; every surface (gradebook, student
  sheet, export, flags) renders its output. Retires F1 for good.
- **surgicalFix (rejected):** align the three rules by hand — they drift again with the first
  new surface.
- Pointers: `engine/grader.ts` (case vectors per mode; "No partial credit" note `:19-23`
  becomes "partial credit lives in score.ts"), `engine/caseRun.ts:390` `gradedMachineKey`
  (the machine `answerKey`), `types.ts:256-310` `AssignmentQuestion`, `:619-639`
  `QuestionResult`, `problemSet.ts validateDocument`, `instructor/QuestionCreator.tsx`,
  `components/GradesView.tsx`, `GradeSheet.tsx`, `HomeScreen.tsx`, `gradeDisplay.ts`.
- `engine/` stays pure (PROFILE §8.2). Students never see grader identity.

## Verify
Gates (PROFILE §6) + `npx tsx tools/scoreCheck.ts`. Browser: a toy student with a
released, partly reviewed submission shows the same number in the Grades row and its sheet;
the creator's ½ field validates live.

## Progress log
