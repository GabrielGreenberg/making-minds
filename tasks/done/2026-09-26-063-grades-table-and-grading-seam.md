---
id: 2026-09-26-063
type: feature
title: Store human grades apart from autograde output — grades table, append-only change log, the GradingStore seam, and migration of today's reviews
priority: high
size: large
requires: browser
area: server
source: chat
created: 2026-09-26T21:34:00-07:00
status: done
after: 2026-09-26-061
branch:
merged_into:
---

## Description
Filed from task 031's accepted design (Gabriel approved 2026-09-26, with its three proposed defaults). Authority: the memo `docs/buildout/designs/grading-interface.md` — its §3 table records every decision; read it before starting. Slice 3 of 11 (memo §12). HW1 is due Oct 4 and is returned about a week later, so slices 1–8 carry the schedule.

A hand verdict lives inside one attempt's result JSON (`questions[i].manual`,
`types.ts:606-610, 624`): a resubmission strands it, a re-grade would wipe it, and nobody is
recorded as the grader (memo F2–F4). This slice gives human grades their own table, logs every
change, and routes it through a new seam (memo §7.1–§7.3, §7.6).

## Done when
- Server tables (`db.ts` migrations): `grades` (PK assignment, student, question; points ∈
  {0, 0.5, 1}, note, grader, graded_at, attempt, answer_key, version), `grade_events`
  (append-only: id, at, actor, assignment_id, student, question_id?, kind, before, after — no
  update or delete path), `users.public_id` (ALREADY BUILT by 2026-09-26-062 — random,
  stable, backfilled, `db.publicIdOf`/`listStudentKeys`; reuse it), `submissions`
  gains `assignment_hash` stamped at submit (`homeworkContentHash`,
  `devData/homeworkSync.ts:56`).
- `PUT /api/assignments/:id/grades/:sid/:qid` `{points, note, version}` → 409 with the current
  row on a stale version; `DELETE` clears; an override of an autograded problem requires a
  note; every write logs a `grade_events` row with `req.user` as actor. Instructor-only.
- `GradingStore` seam (`storage/`), `LocalGradingStore` + `RemoteGradingStore`, exported only
  by `storage/backend.ts`; the remote module graph stays grader-free.
- Migration (server start + local init): every `manual` on a student's latest attempt becomes
  a `grades` row (points 1/0, note, grader null, graded_at = reviewedAt, answer_key) + a
  `grade` event with actor "migration"; idempotent.
- `POST …/submissions/:attempt/review` and `recordManualReview` are retired; today's
  `GradebookView` review controls become 0 / ½ / 1 + note through the seam (the full queue is
  2026-09-26-066). `scoreSubmission` now reads stored grades (the 061 adapter is removed).
- Students: `sanitize.ts` drops `manual`, serves released grades' points + note only (never
  grader or events). `removeAssignment` refuses an assignment that has submissions (F6).
- Pinned: a new `server/tools/gradingCheck.ts` in `server npm run check` (version 409,
  required override note, events append-only, migration idempotent, students can't read or
  write); `remoteStoreCheck`, `parityCheck`, `navResetCheck` green.

## Design
- **deepFix:** judgment and machine output are different records with different lifecycles;
  anchoring the grade to an `answerKey` makes resubmission and re-grade safe by construction.
- **surgicalFix (rejected):** keep `manual` in the JSON and copy it forward on resubmit —
  still wiped by any re-grade, still no actor.
- Pointers: `server/src/db.ts:161-169, 1083-1094`, `app.ts:651-690` (the review route to
  retire), `app/src/storage/manualReview.ts`, `submissionStore.ts`, `remoteStores.ts`,
  `api/client.ts:510-519`, `server/src/sanitize.ts:86`, `db.ts:885-887` (removeAssignment).
- P3 (memo §9): no ids/emails in API paths — `public_id` only.

## Verify
Gates incl. the new `gradingCheck`; browser: grade a toy open question ½ with a note in the
gradebook, resubmit unchanged as the student → the grade holds; change the answer → shown as
changed.

## Progress log
- 2026-09-26 (work session, Opus 5.5) — Built. **Types**: `HumanGrade`/`Points`/`GradeEvent` in
  types.ts; `SubmissionRecord.grades` (delivered WITH the records — full to instructors,
  student-safe after release), `.studentKey` (instructor copies: `public_id` / local email),
  `.assignmentHash` (stamped at submit, both stores). **The planner**:
  `storage/gradeWrites.ts` `planGradeWrite` (version check → conflict carrying the current
  grade, incl. "someone already cleared it"; 0/½/1 and override-needs-a-note via
  `engine/score.ts gradeWriteProblem`; anchored to the LATEST answer; one log event per write)
  + `legacyGradesByStudent` (latest attempt's ✓/✗ only) + `studentGrade`. **Seam**:
  `storage/gradingStore.ts` `GradingStore` (setGrade/clearGrade → ok | conflict | refusal),
  `LocalGradingStore` (persists through the local SubmissionStore: `mm:grades:<id>`,
  append-only `mm:grade-log:<id>`, lazy one-time legacy migration), `RemoteGradingStore`
  (409/400 → the seam's outcomes; `ApiError.body` now carries the JSON). **Server**: tables
  `grades` + append-only `grade_events`, `submissions.assignment_hash`, one-time migration
  (server_meta `grades_migrated`, one transaction), `PUT`/`DELETE
  /api/assignments/:id/grades/:sid/:qid` (public_id; an email is a 404), `submissions/all`
  attaches grades + studentKey, own submissions attach released student-safe grades,
  `sanitize.ts` strips `manual`, `DELETE /api/assignments/:id` → 409 once submitted (local
  store too; the dashboard's Delete is disabled with a tooltip). **Retired**: the review
  route, `recordManualReview` (seam + both stores + client), `app/src/storage/manualReview.ts`,
  score.ts's review adapter (scoreRecord reads `record.grades`). **Gradebook**: 0 / ½ / 1 +
  note + Clear through the seam, latest attempt only; "graded ½ / changed since graded (was
  …) / needs a grade". **Pins**: new `server/tools/gradingCheck.ts` (in server `npm run
  check`), serverCheck + parityCheck (grade route ≡ in-process planner; result untouched;
  student sees the grade student-safe and it scores the same), remoteStoreCheck (seam end to
  end: key not email, version, refusal, conflict, release), navResetCheck (local seam),
  pipelineCheck `[human grades]` (the planner, migration latest-only, student-safe copy).
  Browser (local, after a dev-server restart — it had cached a stale score.ts): graded John's
  HW1 P6a ½ with a note → stored v1 + logged, detail "graded ½", row 40 → 41.3*. Owed: on
  the pilot, the one-time migration runs on the next release's boot (toy data only).
- 2026-09-26 — Gates green (app tsc, build, app check, server check incl. gradingCheck).
  Landed. Next in the grading build: 2026-09-26-064 (summary endpoints — through the
  GradingStore seam; records already carry grades + studentKey).
