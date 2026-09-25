---
id: 2026-09-21-005
type: feature
title: Author fill-in-the-blank questions in the question creator
priority: normal
size: large
requires:
area: app
source: claude-md
created: 2026-09-21T15:30:00-07:00
status: done
after:
branch:
merged_into:
---

## Description
Fill-in questions (an open question carrying a `fill_in` spec + a separate `fill_in_answers`
key; graded by `engine/fillIn.ts`) have no authoring UI — HW1 P11 is hand-written in
`app/src/devData/homeworks/hw1.json` (`notes/pset_updates.md` item 10).

## Done when
- `QuestionCreator` can create/edit a fill-in question: labelled blanks (add/remove/reorder),
  digits-only toggle per blank, the answer per blank; round-trips through save/load.
- The server still strips `fill_in_answers` for students (parityCheck pin unchanged).

## Design
- The open-question branch of `instructor/QuestionCreator.tsx` gains a "Fill-in blanks"
  toggle; the type shapes already exist in `types.ts`.
- **deepFix:** treat fill-in as its own `buildMode`-adjacent task kind the way perception is
  a "Task" toggle on CC/SC — one place decides the student panel (`FillInPanel`) and the
  grader branch; today both key off the presence of `fill_in`.
- **surgicalFix:** just the form fields.

## Verify
`pipelineCheck` (author → save → student payload stripped → submit → graded), tsc.

## Progress log

### 2026-09-23 — implemented (work loop)
- **Fill-in is its own task kind (deepFix).** `types.ts` gains `QuestionTask`
  (`function | perception | turbot | open | fill-in`), `QUESTION_TASKS` (the tasks each mode
  offers, default first) and `questionTask(q)` — the ONE classifier, in the grader's
  historical precedence. Every kind decision now asks it: `grader.ts gradeQuestion`,
  `App.tsx` (FillInPanel vs OpenResponsePanel), `store.ts loadCaseInput` (replays only
  function/turbot), `submissionStore.buildSubmission` (blanks vs prose), `GradebookView`
  (only `open` gets the ✎ review stat — fill-in shows its autograded pass rate), and
  `questionModeLabel` (`open - fill-in`). Only behavioural delta: a `fill_in` spec on a
  NON-open question is no longer graded as fill-in (no such data exists; pinned).
- **Per-blank digits-only.** `FillInSpec.numericOnly?: boolean | boolean[]` (true = every
  blank — HW1 P11 unchanged; array = per blank). One reader, `engine/fillIn.ts fillInBlanks`
  (an array is truthy, so nothing may test it bare); one writer, `fillInFields`, canonical:
  all → `true`, none → omitted, mixed → one flag per blank. `FillInPanel` maps over
  `fillInBlanks` (per-blank `inputMode` + `\D` filter, keyed by index, still
  `ref={pasteGuardRef}`). Grading (`gradeFillIn`) untouched, so parity is unchanged.
- **Authoring.** New pure `instructor/fillInAuthoring.ts` (drafts `{key,label,digitsOnly,
  answer}` — one row object, so a move never splits a label from its answer; keys from a
  counter, never a random id; `blankDraftsOf`, `newBlankDraft`, `fillInDefects`/
  `fillInProblems`, `fillInFields` — answers only ever into `fill_in_answers`). New widget
  `instructor/FillInBlanksEditor.tsx` (doc-editor rows: label, answer, digits-only, ↑/↓ via
  `moveItem`, Remove; defects inline). `QuestionCreator`: task state is a `QuestionTask`
  coerced to `QUESTION_TASKS[mode]`; the Task toggle shows wherever a mode offers two
  (Function/Perception, Free response/Fill-in blanks); save is blocked by any defect (no
  blanks, empty/duplicate label, empty answer, non-digits in a digits-only answer). This
  also fixes the creator silently dropping P11's `fill_in`/`fill_in_answers` on edit — a
  no-op edit now reproduces P11 canonicalJson-equal (the homework sync keeps it pristine).
- **Pins.** `pipelineCheck [fill-in authoring]`: P11 round-trip, canonical `numericOnly`,
  reorder, each defect named, the student copy via the server's `stripAnswers` (empty key,
  `fill_in` keys ⊆ {labels, numericOnly}, spec unchanged), submit → graded, the classifier
  over the sample + HW1–HW7 (94 questions), and a grep pin (one reader, one writer of
  `numericOnly`). parityCheck, hw1.json and the server are untouched.
- **Browser (DOM-level; the pane was hidden, so no screenshot).** At the dev server as
  Prof. Ada: HW1 P11 chips `open - fill-in`; its editor opens on Open + Fill-in blanks with
  11 rows (label | answer | digits-only ✓); Add blank → row "11", digits-only, "This blank
  needs an answer." and Save disabled; Remove re-enables Save; ↓ swaps rows 0/1; one row
  lays out on a single 880 px line. A new question: CC shows Function/Perception; Open
  shows Free response/Fill-in blanks; Fill-in seeds one blank "1"; CC → Open keeps the
  choice. As John Doe, the student panel of P11 renders 11 numeric boxes. Nothing saved.
  **Owed:** a visual eyeball of the editor, and the student panel of a MIXED-digits
  question (author one, publish, open it as a student: only the digits-only boxes are
  `inputMode=numeric` and drop letters).

### 2026-09-23 — review fix (work loop)
- **Answers by position (review, minor).** Removing/reordering saved blanks silently moved
  students' answers (stored by index; nothing re-maps workbooks or submissions). Now
  `fillInAuthoring.misplacedBlanks(saved, next)` — keyed on the draft `key`, which survives
  edits and moves — names the saved blanks that lose their slot; `FillInBlanksEditor` shows
  `misplacedAnswersWarning` live above the rows and `QuestionCreator.handleSave` confirms
  before saving (also when a fill-in question is switched to another task/mode). Relabel,
  answer/flag edits and appends stay silent. Pinned in `pipelineCheck [fill-in authoring]`
  (3b). Re-mapping saved answers is not attempted (a known trade-off). **Owed:** an eyeball
  of the warning and the confirm in the browser.

### 2026-09-23 — implemented (work loop)
Checkpoint. **Built:** instructors can now author fill-in questions in the question creator
(Open → Task "Fill-in blanks": labelled blanks, add/remove/↑↓ reorder, a digits-only flag and
an answer per blank; save blocked on any defect; a warning + confirm when a saved blank loses
its position). Fill-in is its own task kind (`types.ts questionTask`, the one classifier the
grader, student panel, gradebook, replay and mode chip ask); `numericOnly` may be per blank.
- **Pins:** `pipelineCheck [fill-in authoring]` — P11 round-trip, canonical `numericOnly`,
  reorder, misplaced-answer detection (3b), each defect, the student copy via `stripAnswers`,
  submit → graded, the classifier over sample + HW1–HW7, one-reader/one-writer grep pin.
  parityCheck, `server/` and hw1.json untouched.
- **Gates (exit codes):** app-tsc=0 app-build=0 app-check=0 server-tsc=0 server-check=0.
- **Review:** fixed [minor] answers-by-position (misplacedBlanks + warning + confirm); none
  skipped. Nits left: the submit pin grades the unstripped copy; owed checks live here, not
  in `## Verify`.
- **Owed (browser, local mode, "Vite Dev Server" :5173):** (1) instructor → Load HW1–HW7 →
  HW1 → edit P11: Fill-in blanks, 11 digits-only rows 0–10; save unchanged, reopen identical;
  narrow width + dark mode. (2) new Open → Fill-in question: 3 blanks, one free-text with a
  letters answer; ↑/↓ focus, remove; each defect disables Save; remove/reorder a saved blank
  shows the warning and the confirm; save/reopen round-trips; Free response shows the prose
  panel. (3) student: digits-only box refuses letters, text box accepts; chip `open -
  fill-in`; submit, release; Grades sheet shows verdict + failed labels only; Gradebook
  shows a pass rate, not ✎. Optional remote: GET /api/assignments/:id carries
  `fill_in_answers: []`. Nothing owed to Gabriel (no ssh; the homework sync is a no-op).
- **Next step:** loop session: visual check of the owed items above, then land per PROFILE §5.

### 2026-09-23 — loop browser check and land
- **Browser, local mode (dev server restarted on the branch), Prof. Ada.** HW1 → Edit →
  Problem 11 opens with Mode Open and Task "Fill-in blanks" active (the segmented control),
  with 11 rows labelled 0–10, answers 0 … 1010, all digits-only.
  - Moving row #1 down shows the misplaced-answers warning (role=alert) naming blanks "0" and
    "1".
  - Emptying a label shows "needs a label" and disables Save Question.
  - Cancel leaves the stored blanks unchanged.
- **Fixed here:** the review nit at `pipelineCheck.ts` (6). The fill-in submit → graded pin now
  builds the submission from the stripped student copy (`stripAnswers(authored)`) and grades it
  against the authored key. The Verify chain "author → save → student payload stripped →
  submit → graded" is now one pipeline. pipelineCheck passes and app tsc is 0.
- **Still owed:** a visual eyeball of a new mixed-digits question on the student side (the
  panel's letters-vs-digits boxes). The workflow's DOM-level pass and `pipelineCheck` cover the
  behaviour.
- Landed via a merge into `main`.
