---
id: 2026-09-26-066
type: feature
title: Build the hand-grading queue — one problem across students, 0 / ½ / 1 keys, hide names, soft claims, changed-since-graded suggestions
priority: high
size: large
requires: browser
area: app
source: chat
created: 2026-09-26T21:34:00-07:00
status: in-progress
after: 2026-09-26-065
branch: robot/066-hand-grading-queue
merged_into:
---

## Description
Filed from task 031's accepted design (Gabriel approved 2026-09-26, with its three proposed defaults). Authority: the memo `docs/buildout/designs/grading-interface.md` — its §3 table records every decision; read it before starting. Slice 6 of 11 (memo §12). HW1 is due Oct 4 and is returned about a week later, so slices 1–8 carry the schedule.

24 paragraph problems across HW1–HW7 ≈ 1,900 hand grades a term. The queue is where they
happen (memo §6.4, mockup 4, `tasks/attachments/2026-09-23-031-4-queue.png`).

## Done when
- `GET /api/assignments/:id/questions/:qid/responses` (the queue feed: per latest attempt the
  answer — text / blanks, a machine by reference — grade, answerKey, claim) and
  `POST /api/grading/claims` (in memory, 5-minute TTL renewed while active).
- `#/instructor/grading/:asg/queue/:qid`: **By problem** — statement (collapsible), one
  response, 0 / ½ / 1 (keys `0`, `h`, `1`), note (optional on a hand grade; placeholder "No
  medical or accommodation details"), **Save & next** (↵), J/K previous/next; it skips graded
  and claimed responses; the side list shows states (to grade, changed, graded, claimed by …).
  **By student** walks one student's pending problems.
- **Hide names** toggle (per-person ui pref in localStorage) shows "Response 39".
- A "changed since graded" response offers its old grade as a one-click suggestion.
- A 409 from a stale version shows the other grader's grade instead of overwriting.
- Pinned: claim TTL and skip logic (pure, in a check tool), responses feed has no answer key
  for autograded parts, 409 path.

## Design
- **deepFix:** the queue is a view over the 064/063 seam; claims are advisory, versions are
  the real guard.
- Pointers: `usePasteGuard.ts` (the note field is not assignment content but must not add a
  clipboard API), `StatementBody` for the prompt.

## Verify
Gates; browser: grade ten toy responses by keyboard alone; two tabs as two instructors
see the claim and the 409.

## Progress log
