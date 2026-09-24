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
status: done
after:
branch:
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

Pins: `navResetCheck [own submissions]` (seam + store, local; zero fetches; `listAll(` grep
gate), `remoteStoreCheck` (instructor's own-read vs `listAll`; student `listAll` → 403),
`serverCheck` (instructor `GET /submissions` = own; `/submissions/all` = everyone's; 403 for a
student); `parityCheck` reads through `/submissions/all`.

**Owed, not claimed** (PROFILE §7):
- *Browser, local* ("Vite Dev Server"): sign in as Prof. Ada → Dashboard → "Load HW1–HW7" →
  sign out → sign in as John Doe → Home: HW1 shows no "Last submitted"; open HW1 → no
  Submit-chip time; Submit → the chip shows attempt 1 (not 5). Gradebook as Ada still lists the
  seeded students plus John. Ada's "Student view" of HW1 shows no "Last submitted" until Ada
  submits.
- *Browser, remote* ("Vite Remote Mode" + local server on 8199): as the instructor, open the
  Student view of an assignment a student has submitted → no "Last submitted"; the gradebook
  still shows the student's attempts.
- *Release* (`requires: ssh`, human-run): the pilot needs the server restart that
  `deploy/release.sh` does AND the new Pages bundle together — an old bundle's gradebook reads
  the plain route, which now returns only the instructor's own attempts (an empty gradebook
  until the Pages upload lands).

## Progress log

### 2026-09-24 — implemented (work loop)
**Built (deepFix).** Whose submissions a read returns is now part of the seam method.
Students, and an instructor in Student view, see only their own attempts. Only the gradebook
sees everyone's. `SubmissionStore` offers `listOwn(id, email)` / `getLatestOwn(id, email)` for
every student-side read and `listAll(id)` for the gradebook. The old `listSubmissions` /
`getLatest` are gone. Locally the email filters the shared list (trimmed, case-insensitive; a
visitor owns nothing). Attempts now count per (assignment, student), max + 1, as the server
does. `recordManualReview` reviews within that student's records. Remotely the session names
the person. The server's `GET /submissions` returns the caller's own records for every role. A
new instructor-only `GET /submissions/all` feeds `GradebookView` and `InstructorDashboard`.
`store.ts` `hydrateSubmissions`, `openAssignment` and `viewSubmission` pass the principal,
captured before any await. Home, the overview, the Submit chip, Grades and GradedCaseBanner
read that hydrated map. Docs: CLAUDE.md seam table, `remote-stores.md`, `server/README.md`.

**Pins.**
- `navResetCheck [own submissions]`: A, B, an instructor I, a visitor and anonymous records in
  one list. It checks per-student numbering, own reads, trim/case matching, `listAll` = all 5,
  and a manual review that lands on B's record only. Store level: hydrate, `viewSubmission`,
  the past-due freeze (C is not frozen by other people's attempts), the instructor's Student
  view, zero fetches (law 5), and a `listAll(` grep gate (instructor/ + storage/ only).
- `remoteStoreCheck`: the instructor's own read vs `listAll`, and a student's `listAll` → 403.
- `serverCheck`: instructor `GET /submissions` = own; `/submissions/all` = everyone's; a
  student gets 403.
- `parityCheck` reads through `/submissions/all`.

**Gates (exit codes):** app tsc 0, app build 0, app check 0, server tsc 0, server check 0.

**Review.** Fixed Finding 1: the law-6 stale-hydrate pin could never fail, because it started
under B, who never submits. It now starts under A, who submitted. A control check asserts
that a full hydrate under A is non-empty. The mutation test passed: with the epoch guard
removed the pin fails (474/1); with the guard in place it passes (475/0). Skipped: none.
Nits left alone: serverCheck's instructor-own pin only covers the empty case (the non-empty
case is pinned in remoteStoreCheck). The grep gate matches only `listAll(`, not a direct
`listAllSubmissions(` import.

**Owed (PROFILE §7), not claimed:** the browser checks in local and remote mode, and the
release in `## Verify`. The release needs the server restart and the new Pages bundle
together. After the release, hard-reload the instructor's tab: an old bundle's gradebook shows
only the instructor's own attempts.

**NEXT STEP:** loop session: visual check if owed (both browser recipes above), then land
per PROFILE §5.

### 2026-09-24 — loop browser check and land
- **Fixed here, from the review nits:**
  - `serverCheck`'s instructor "own read" pin covered only the empty case. A new block at the
    end of the file has the instructor submit once. The plain route then returns exactly that
    attempt 1, `/all` gains it beside the student's, and the student's own list never shows
    it. It sits last, so no earlier `attempt === 1` lookup meets it.
  - The navResetCheck grep gate matched only `listAll(`. It now also gates the API client's
    `listAllSubmissions`, allowed only in `api/client.ts` and the remote seam under
    `storage/`.
  - serverCheck: all checks passed. navResetCheck: 476 passed. server typecheck: 0.
- **Browser, local mode (dev server restarted on the branch), with the old shared list in
  localStorage (`mm:sub:hw1` = alice#1, alice#2, bob#3, carol#4, john#5).**
  - John's Home: HW1 "✓ Submitted Sep 23, 9:21 PM", his own attempt.
  - Prof. Ada's Student view: **HW1 "Not submitted"**, and no "Submitted" anywhere. Before
    this change (task 015's first screenshot) the same page showed "✓ Submitted Sep 23…" on
    every homework, from other people's attempts.
  - Ada's HW1 gradebook still lists everyone: 4 students, 5 submissions.
- **Owed to Gabriel (release):** hard-reload the instructor tab after `deploy/release.sh`,
  because the plain submissions route changed meaning for instructors (recipe above). Also
  the remote-mode Student view round trip (recipe above).
- Landed via a merge into `main`.
