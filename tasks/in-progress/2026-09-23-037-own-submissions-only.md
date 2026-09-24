---
id: 2026-09-23-037
type: bug
title: Show a principal only their own submissions — an instructor's Student view and local mode's shared list can surface another person's attempt as "yours"
priority: normal
size: unknown
requires:
area: app
source: chat
created: 2026-09-23T21:40:00-07:00
status: in-progress
after:
branch: task/037-own-submissions-only
merged_into:
---

## Description
Found by task 003's workflow (work loop, 2026-09-23); filed by the loop session. It was
already true before 003, which left it untouched.

The student-side submission reads (`submissionStore.getLatest`, `listSubmissions`, and the
store's `hydrateSubmissions`, the frozen view and 003's attempt lookup `viewSubmission`)
take whatever the seam returns for an assignment:
- **Remote mode:** an instructor's "Student view" calls the same routes, and for an
  instructor `listSubmissions` returns every student's records. So "Last submitted", the
  frozen past-due view and "Open my submission" can show a student's attempt as the
  instructor's own. Instructors may see every submission, so this isn't a privacy breach, but
  the Student view is wrong.
- **Local mode:** `LocalSubmissionStore` keeps every toy account's records in one list. After
  "Load HW1–HW7", John Doe's HW1 immediately showed a seeded sample student's "Last
  submitted" time (seen in the 002/003 browser passes).

## Done when
- Every student-side read of submissions (Home, the overview, the editor's Submit chip, the
  frozen view, `viewSubmission`, the Grades tab) sees only the current principal's own
  records, in both modes. The instructor gradebook still sees everyone's.
- A pin in the matching check tool: with two principals' records in the seam, each sees only
  their own latest attempt, and an instructor's Student view sees only the instructor's own.
- Local mode stays byte-identical with zero `/api` traffic (law 5).

## Design
- **deepFix (recommended):** filter by principal at the seam. The student-facing
  `SubmissionStore` reads take, or derive, the current principal and return only that
  person's records. The server's student-side route scopes by the session's email for every
  role, and the instructor gradebook keeps its own route. One rule, stated once, and every
  reader inherits it.
- **surgicalFix:** filter in the store's `hydrateSubmissions` and `viewSubmission`. Rejected:
  the next reader of the seam would slip past it.
- Pointers: `app/src/storage/submissionStore.ts` (`LocalSubmissionStore`),
  `app/src/storage/remoteStores.ts`, `server/src/app.ts` (the submissions routes), `store.ts`
  `hydrateSubmissions` / `viewSubmission` / `frozenQuestionCircuit`.

## Verify
Both `tsc`s, build, `npm run check` with the new pin, server `npm run check`. Browser, local
mode: after "Load HW1–HW7", John's HW1 shows no "Last submitted" until he submits.

## Progress log
