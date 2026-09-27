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
status: in-progress
after: 2026-09-26-061
branch: task/063-grades-table-and-grading-seam
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
