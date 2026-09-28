---
id: 2026-09-28-081
type: feature
title: Make challenge problems their own optional problem — text or an uploaded PDF/file — and flag students who attempt one, in a good way, for review
priority: normal
size: large
requires:
area: app
source: feedback
created: 2026-09-28T11:02:00-07:00
status: blocked
after:
branch:
merged_into:
---

## Description
App Feedback report `fb-mulimt62-vrnomg` (author-role: instructor, category: platform
design; filed from HW1). Gabriel wants every homework's challenge problem:
1. listed as **its own problem**, not a note inside a section;
2. answerable with an **uploaded PDF or file**, as an option;
3. students who worked on it **flagged for review, in a good way**.

**Today.** Challenge problems are not problems at all. They are section callouts
(`kind: 'challenge'`, rendered as a tinted box): HW1 §III "Representations" (`hw1.json`
sections[2].callouts, the general semantics of binary, titled "Challenge problem (optional,
not collected)") and HW2's first section (for any f and n there is a CC computing f on
[0-n]). There is no answer field. Task 046 (HW1 release-ready, done) decided "optional, not
collected", so this reverses that. No other homework has one (HW6's "challenge" is ordinary
prose inside a problem). The app also has no file upload anywhere a student answers. The one
upload is Feedback screenshots, which are downscaled and ride as base64 in the feedback row
(`server/src/db.ts:23–24, 240`).

## Questions
1. **Does a challenge problem count toward the homework grade?** *Recommended: no, never.*
   It sits outside the grade's P (not in `available`, `app/src/engine/score.ts:197–211`). It
   never makes a grade provisional (`:230`, which would otherwise hold every grade
   "provisional" until someone reviews it). It never raises "not submitted". An attempt earns
   only the positive flag. Alternatives: extra credit (on top of P, capped at 100), or
   counted like any problem.
2. **Uploads: where, what and how big?** *Recommended: an authored per-question option
   "Accept an uploaded file", on for challenge problems (usable later by any open
   question). PDF, PNG or JPEG, one file, ≤ 10 MB, replaceable until submit, stored in the
   server database so the daily backup covers it.* An upload brings content from outside the
   assignment. That is the one thing law 8 (the paste/provenance seam) otherwise forbids, so
   this is an authored exception that goes through the seam (`provenance.ts` gets an
   upload verdict), logged in the editing record (hash, size, time). OK?
3. **How is it labelled in the homework?** *Recommended: "Challenge problem (optional)",
   unnumbered, placed at the end of its section in the problem-set document and the
   editor's question list, with its own mark.*

## Design
- **Model:** `AssignmentQuestion.challenge?: true` on an ordinary open question (typed
  answer) plus the upload option. HW1's and HW2's challenge callouts become such questions.
  `questionTask` stays `open`. `problemSet.ts` `problemNumber` skips challenge problems if
  question 3's answer holds.
- **Scoring (if Q1 = no):** `score.ts` filters challenge problems out of `problems`/
  `available` in one place, so every surface (grade sheet, matrix, export, re-grade)
  inherits it. `scoreCheck` pins that a challenge answer changes neither the grade nor
  `provisional`.
- **Upload path:** a separate endpoint (`PUT /api/workbooks/:asg/uploads/:qid`), not inside
  the autosaved workbook JSON, which is saved on every edit. Remote: a `uploads` table
  (blob, mime, size, sha256, owner, question, updated_at). Local mode: a size-capped data
  URL (dev only). The submission snapshot references the upload by hash, so a later
  replacement doesn't rewrite a submitted attempt. Student data never enters git (law 9).
  Instructor surfaces (`StudentSubmissionView`, the viewer) show/download it.
- **Positive flag:** the grading flags (`app/src/storage/gradingFlags.ts:83–91`) are all
  "needs attention", so a challenge attempt is **not** one of them. Recommended: a separate
  pure "highlights" list from the same summaries: attempted = non-empty text or an upload.
  It shows as a star/"Challenge attempted" chip in the Grading matrix, a filter chip, and a
  line on the student page (070). `gradingViewCheck` pins it.
- **Grading queue:** challenge answers are reviewable (a note, a mark) without points, if Q1
  holds.

### Members
- `fb-mulimt62-vrnomg` (instructor): challenge problems as their own problem, file upload,
  positive review flag.

## Done when
(Firmed up on release.) HW1's and HW2's challenge problems are problems with an answer field
and the upload option. A student can type an answer and/or upload a file, and it is saved,
submitted and viewable by the instructor. Every student with a non-empty challenge answer
shows a positive "Challenge attempted" mark in the Grading tab and on their student page.
The grade follows Q1's answer, and gates pin it. The key-free / paste laws hold (`pasteCheck`,
`remoteStoreCheck`).

## Verify
Gates; pins in `scoreCheck`, `gradingViewCheck`, `pipelineCheck` (submit with an upload),
`pasteCheck` (upload through the seam), `remoteStoreCheck` (upload round trip on the real
server). Eyeball owed: the upload control, the instructor's view of the file, the positive
mark.

## Progress log
