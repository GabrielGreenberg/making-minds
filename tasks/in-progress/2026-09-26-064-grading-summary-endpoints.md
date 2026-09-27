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
  (flagged), with latest-attempt meta (attempt, submittedAt, late units, deduction), per-problem
  `{points, source}` from `scoreSubmission`, grade (raw, final, provisional, missing), and
  progress totals (submitted / roster, late, missing, autograded current vs stale by
  `assignment_hash`, hand-graded x / y, released). No circuits; ~50 KB at 80 × 23.
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
