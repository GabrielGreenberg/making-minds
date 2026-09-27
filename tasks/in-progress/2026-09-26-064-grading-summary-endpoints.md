---
id: 2026-09-26-064
type: feature
title: Serve slim, roster-joined grading summaries — per assignment (shared with the Activity tab), course-wide, per student — and one attempt's detail on demand
priority: high
size: large
requires: 
area: server
source: chat
created: 2026-09-26T21:34:00-07:00
status: in-progress
after: 2026-09-26-063
branch: robot/064-grading-summary-endpoints
merged_into:
---

## Description
Filed from task 031's accepted design (Gabriel approved 2026-09-26, with its three proposed defaults). Authority: the memo `docs/buildout/designs/grading-interface.md` — its §3 table records every decision; read it before starting. Slice 4 of 11 (memo §12). HW1 is due Oct 4 and is returned about a week later, so slices 1–8 carry the schedule.

The gradebook downloads every attempt's full circuits and cases, unpaginated
(`db.ts:1044-1074`; "a few MB" per submission, `app.ts:93-95`) and never joins the roster, so
students who haven't submitted are invisible (memo F5, F6). This slice serves the summaries the
Grading surfaces (and task 030's Activity tab) read (memo §7.2).

## Done when
- `GET /api/assignments/:id/summary` — THE shared summary: one row per roster student
  (public_id, name, sort name, UID, section, has-account) ∪ submitters not on the roster
  (flagged), with latest-attempt meta (attempt, submittedAt, late — `units`/`deduction`
  fields present but null until 068's calendar fills them through `dueFor`), per-problem
  `{points, source}` from `scoreSubmission`, grade (raw, final, provisional, missing), and
  progress totals (submitted / roster, late, missing, autograded current vs stale by
  `assignment_hash`, hand-graded x / y, released). No circuits; ~50 KB at 80 × 23 on the
  wire (the pilot's Caddy gzips; the raw body measures ~86 KB — re-scoped at fix, see log).
- `GET /api/grading` — every assignment's progress row + course-wide counts (the Grading tab).
- `GET /api/students/:sid` — one student across assignments.
- `GET /api/assignments/:id/submissions/:sid/:attempt` — one attempt in full (circuits,
  result with expected/got, integrity, grades, events), on demand.
- All `requireInstructor`, all through the `GradingStore` seam (local mode computes the same
  over `LocalSubmissionStore` + toy roster). `GET …/submissions/all` stays until 065 retires
  the old gradebook.
- Pinned in `gradingCheck`: roster join (not-submitted rows present, a non-roster submitter
  flagged), latest-only, stale detection, payload has no circuits, students get 403; local ≡
  remote summaries on the same fixture.
- Task 2026-09-22-030 is updated to consume `/summary` (its `after:` points here).

## Design
- **deepFix:** one summary builder (`server/src/gradingSummary.ts`, pure over db rows +
  `engine/score.ts`) that every grading view and the Activity tab share — one join, one number.
- **surgicalFix (rejected):** add filters to the client over `listAll` — keeps the payload and
  the second definition of "submitted".
- Pointers: `server/src/db.ts:1044-1074`, `app.ts:638-640`, `roster.ts`, `identity.ts:5-13`,
  `sanitize.ts`.

## Verify
Gates incl. `gradingCheck`; a timing/size note for 80 × 23 in the progress log.

## Progress log
- 2026-09-27 (robot, implement): one pure builder `app/src/storage/gradingSummary.ts`
  (not `server/src/gradingSummary.ts` as the Design named it — the local store must run it
  too, so it sits beside `gradeWrites.ts`; the server file is the Db adapter). Four routes,
  `GradingStore.summary/course/student/attempt` in both stores. Rows carry per-problem
  `{points, source}` aligned with a summary-level `questionIds` (no id per cell) and no
  notes/emails; a removed submitter is keyed `x` + 12 chars derived from the mint secret.
  Late: `late` boolean only; units/deduction null until 068 (`dueFor` is the hook).
  `sortAssignments` moved to the pure `app/src/assignmentOrder.ts` (re-exported) so the
  server can order the Grading tab. Size (gradingCheck `[size]`, 80 synthetic students ×
  HW1's 23 questions): 85,673 bytes, ~4 ms to build in-process — above the memo's ~50 KB
  estimate (the identity + attempt meta per row), pinned < 100 KB.
- 2026-09-27 (robot, fix): review findings. (1) Late units/deduction: the Done-when now says
  what ships — the fields, null until 068 — and 068 carries the hand-off (fill them through
  `dueFor`, flip the pin). (2) Size: the raw body stays ~86 KB (23 `{points, source}` a row
  is the contract); the ~50 KB budget is re-scoped to the wire, pinned in `[size]`: gzipped
  < 50 KB (2,770 bytes on the synthetic fixture — repetitive, real data compresses less)
  AND raw < 100 KB. (3) The grade writes (`PUT/DELETE …/grades/:sid/:qid`) now resolve
  `:sid` through `gradingSummary.ts studentEmailOf` — the summary's own resolver — so a
  removed submitter's derived key is gradable; pinned (PUT then DELETE on that key).

### 2026-09-27 — implemented (work loop)
- **Built:** the grading views can now read a slim summary instead of every attempt in full.
  There is one row per roster student, whether or not they submitted, plus flagged
  off-roster submitters. Each row carries latest-attempt meta, per-problem
  `{points, source}` and the grade. Four instructor-only routes serve it: `/summary`,
  `/grading`, `/students/:sid` and `…/submissions/:sid/:attempt`. Both implementations sit
  behind `GradingStore.summary/course/student/attempt`. The one pure builder is
  `app/src/storage/gradingSummary.ts`; `server/src/gradingSummary.ts` is its Db adapter and
  the `studentEmailOf` key resolver, which the grade writes now share. `sortAssignments`
  moved to `app/src/assignmentOrder.ts`. Task 030 now reads `/summary`, and 068 carries
  the `dueFor` hand-off. `…/submissions/all` stays until 065.
- **Pins (gradingCheck):** `[summary]` covers the roster join, never-submitted rows,
  latest-only, late (units/deduction null), a removed submitter and an instructor flagged
  and counted apart. `[stale]` checks the content hash. `[no circuits]` scans /summary,
  /grading and /students. `[403]` covers students on all four routes and anonymous 401.
  `[grades flow]`, `[course]`, `[student]` and `[attempt]` include the removed submitter's
  derived key being readable and gradable (PUT/DELETE). `[local ≡ remote]` checks
  `LocalGradingStore.summary` ≡ `/summary`. `[size]` measured 80 × 23 at 85,673 B raw,
  2,778 B gzipped and 4 ms. remoteStoreCheck covers the new client calls.
- **Gates:** app-tsc=0, app-build=0, app-check=0, server-tsc=0, server-check=0. gradingCheck
  was re-run at checkpoint and passed.
- **Review:** 3 findings fixed (late units/deduction scoped to 068, size budget moved to the
  wire, derived keys made gradable) and none skipped. Nit left alone: `server/src/db.ts:96`,
  where the new row interfaces split `EmailAliasSource` from its doc comment.
- **Remains / owed:** no UI in this slice, so no browser check is owed; the surfaces arrive
  in 065. Not measured: `/api/grading` over all 7 HWs at 80 students. It parses every
  latest attempt's full JSON. If it proves slow, the follow-up is to stamp per-question
  answer keys at submit. Optional sanity check: `curl …/api/assignments/hw1/summary | wc -c`
  against a Remote Mode server. Nothing is owed to the pilot beyond the next release,
  because the endpoints are read-only and need no migration.
- **Next step:** loop session: visual check if owed (none), then land per PROFILE §5.
