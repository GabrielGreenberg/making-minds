---
id: 2026-09-21-013
type: feature
title: Instructor-editable SC perception frame sequences and richer rules
priority: low
size: large
requires:
area: app
source: claude-md
created: 2026-09-21T15:30:00-07:00
status: in-progress
after: 2026-09-21-012
branch: robot/013-perception-custom-sequences
merged_into:
---

## Description
SC perception banks are a fixed deterministic battery (`buildPerceptionCases`); rules are
min-run / exact-run / pattern (CC) and change / upward motion (SC). Wanted: custom frame
sequences per question and rules for downward/any-direction motion and multi-object scenes.

## Done when
Instructor can add/edit frame sequences for an SC perception question; new rules exist with
generated banks; `perceptionCheck` covers them; the student panel from 012 plays them.

## Design
Diagnosed by the work loop's Plan stage (2026-09-24); nothing is coded yet. Once the questions
below are answered, the plan is:
- **Types:** `MotionDirection`, `MotionScene`; the motion rule becomes `{kind:'motion';
  objectLength; direction?; scene?}` (absent = up/single, today's stored HW3 P12 form);
  `PerceptionTestCase.authored?: true`.
- **Engine (`engine/perception.ts`, pure):**
  - `objectStarts(bits,k)` and one motion branch in `expectedPerceptionOutputs`: up q=p+1,
    down q=p−1, either |q−p|=1; single = today's whole-frame match, multi = any start pair.
  - `motionSequences` keeps today's upward battery byte-for-byte (same seed and draw order,
    or the committed HW3 bank drifts). Other variants append deterministic films afterwards
    (mirrored, bounce, two-object and clutter scenes).
  - `MAX_FILM_FRAMES=24`. `buildPerceptionCases(spec, films=[])` appends authored films
    `{frames, expected, authored:true}`, with expected always computed from the rule.
- **Grading:** `validateQuestionMachine` gets a perception branch; a new
  `runPerceptionFilm`; `gradePerception` uses them, with results identical (caseRunCheck +
  parityCheck).
- **UI:**
  - The frame grid is extracted from 012's `PerceptionFramePlayer` into `FrameFilmGrid`.
  - New `instructor/perceptionAuthoring.ts` (pure drafts, problems, fields, film ops, bank
    summary) and `PerceptionEditor.tsx`: the rule row with direction/scene selects, a films
    list, the active film with an "expected" row, and the bank summary.
  - `QuestionCreator` uses one `perceptionDraft`.
- **Replay:** `loadCaseInput` gains a 'perception' kind that reads the result's frames. The
  GradeSheet gets "Run this input" per failed film (SC: `setScFrames` + step; CC: INPUT
  toggles).
- **Samples:** `perceptionMotionDetector({width,k,direction,scene})` in `sampleData`, with no
  new sample questions.
- **Pins:** perceptionCheck → caseRunCheck → pipelineCheck.
- **CLAUDE.md:** net ≤ 0 bytes.
- **Pitfalls:** never touch hw2/hw3.json. `buildPerceptionCases(spec)` output stays identical
  for today's specs.

### Resolved decisions
Gabriel, 2026-09-25 (catch):
1. **Authored films ADD to the generated battery** (as recommended). Expected bits always
   come from the rule, never typed by hand.
2. **A per-film "show to students as an example" flag** (not the recommendation). It is a new
   student-visible field, so it is its own follow-up task (see the progress log); THIS task
   keeps every authored film in the stripped grading bank (law 1) and adds no student-visible
   field.
3. **Multi-object motion as recommended:** output 1 iff SOME object image (a maximal run of
   exactly k 1s) in the current frame sits one unit up / down / either from an object image in
   the previous frame, whatever else is in view; today's single-object rule stays, chosen by a
   "scene: single object / any number of objects" switch on the motion rule.

## Verify
`perceptionCheck` ([motion variants], [bank identity], [authored films], [grading new
rules], [store: new rules + authored films ≡ grader], [replay]), `caseRunCheck`
([perception engine ≡ grader]), `pipelineCheck` ([perception films]), server `parityCheck`.

Owed (browser eyeball, PROFILE §7): in the dev server, Dashboard → an assignment → New
question → SC → Perception → Motion detector: the direction / scene selects appear; Add film
draws the student's frame grid with an "expected" row that follows the rule as bits are
clicked (t1 rightmost, IN1 on top); ↑/↓/duplicate/delete work on a picked frame; the bank
summary counts generated + authored; a width change flags the films with "Fit to N
inputs". Save, reopen: the films come back. As a student, submit a wrong motion detector,
release grades: the Grades sheet's failed film has "Run this input →", which opens the
question with the film in the frame player, played to its end, and the banner under it.

## Progress log

### 2026-09-24 — planned and parked (work loop)
Claimed, and the Plan stage ran (design above). It stopped on three product and pedagogy
questions that the task file doesn't settle (## Questions). There is no code: the empty
branch `task/013-perception-custom-sequences` was deleted. Next step: answer the questions,
then `/work` or the loop claims 013 again and implements the plan above.

### 2026-09-25 — released (catch)
Gabriel answered the three questions (### Resolved decisions). Decision 2 spawned a follow-up
task for the per-film example flag, filed after this one. Next step: `/work` or the loop claims
013 and implements the plan in ## Design unchanged.

### 2026-09-27 — implemented (robot, Implement stage)
Built the plan in ## Design: motion `direction`/`scene` (absent = up/single), `objectStarts`,
the extra deterministic films appended only for new variants (today's banks byte-identical,
pinned against hw2/hw3.json), `MAX_FILM_FRAMES`, `filmProblem`, `buildPerceptionCases(spec,
films)`; `validateQuestionMachine`'s perception branch + `runPerceptionFilm`, used by
`gradePerception`; `FrameFilmGrid` extracted from the player; `perceptionAuthoring.ts` +
`PerceptionEditor.tsx` in the creator; the `perception` replay kind (store, banner,
GradeSheet, the instructor's submission page); `perceptionMotionDetector` in sampleData
(HW3 P12's detector graph-identical). Next: checkpoint, gates, review.

### 2026-09-27 — implemented (work loop)
Built: an instructor can now author films for a perception question (the creator's
`PerceptionEditor`: rule row with motion direction up/down/either and scene single/any number,
a films list drawn in the student's grid with a live "expected" row, a bank summary). Authored
films add to the generated battery, expected always from the rule. Engine: `objectStarts`,
direction/scene motion, `motionExtras` (only for non-up/single rules), `MAX_FILM_FRAMES`=24,
`buildPerceptionCases(spec, films)`, `runPerceptionFilm` + a perception branch in
`validateQuestionMachine`. Replay: a `perception` kind in `loadCaseInput`; "Run this input" on
failed films in the Grades sheet and the instructor's submission page.
Pins: perceptionCheck [motion variants], [bank identity] (HW2/HW3 banks byte-identical;
every non-up/single bank at w8k3/w5k1/w10k2/w4k2 passes only its own detector of six),
[authored films], [grading new rules], [store ≡ grader], [replay]; caseRunCheck [perception
engine ≡ grader]; pipelineCheck [perception films].
Gates: app-tsc 0, app-build 0, app-check 0, server-tsc 0, server-check 0.
Review: fixed Finding 1 (w4 k2 banks could not separate scenes: two stray-bit films added to
`motionExtras`, gated on bottom ≥ 2). Skipped: up/single at w4 k2 still cannot separate scenes
— it is HW3 P12's frozen battery (commented in the pin). Nit left: `gradeDisplay.ts:121`
labels a one-frame SC film like a CC frame.
Remains (owed, PROFILE §7): browser eyeball per ## Verify — creator (selects, films,
expected row, save/reopen, width flag, phone width), student replay from the Grades sheet (SC
and CC perception), 012 frame-player regression (n / 24 frames).
NEXT STEP: loop session: visual check if owed, then land per PROFILE §5.
