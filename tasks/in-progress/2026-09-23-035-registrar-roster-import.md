---
id: 2026-09-23-035
type: bug
title: Import the registrar's class list as exported — skip its preamble, read its columns and name format, leave out withdrawn students
priority: urgent
size: small
requires:
area: server
source: chat
created: 2026-09-23T14:00:00-07:00
status: in-progress
after:
branch: task/035-registrar-roster-import
merged_into:
---

## Description
Gabriel (2026-09-23): "the load roster function isn't working properly." He supplied the real
Fall 2026 class list (the registrar's CSV export). It holds student records (FERPA, P3) and is
**never to enter git**. It was read in place, and only aggregate counts appear here. The term
starts 2026-09-24, so students will soon be creating accounts against this roster.

### What the export looks like (structure only)
- Six preamble lines before the header: `Term: …`, `Class: …`, `Title: …`, `SRS: …`,
  `Time & Location: …`, `Students: 87`, then two blank lines. CRLF line endings, no BOM.
- Header: `UID,Name,E-mail,Major,Classification,Grade Type,Status,Section`.
- 87 rows. `Name` is quoted `"LAST, FIRST MIDDLE"`, all capitals; 2 rows add a suffix after a
  second comma (`"LAST, FIRST, III"`). `UID` is `999-999-999`. Emails: 26 contain capitals, and
  37 of the 87 are NOT UCLA addresses (see task 036). `Status`: 80 `E` (enrolled), 7 `W`
  (withdrawn — **wrong: `W` is Wait List**, see the 2026-09-23 Checkpoint). `Section`: 42 in
  `1A`, 45 in `1B`. `Grade Type`: 86 `LG`, 1 `PN`.

### Reproduced (`parseRoster` run on the file, `server/src/roster.ts`)
- **As exported: 0 students imported**, with the one issue "no email column found". The reader
  takes the first non-blank row as the header (`roster.ts:146–153`: `rows[0]`), and that row
  is `Term: 26F`. The dashboard import (`POST /api/roster/import`, `server/src/app.ts:280–299`;
  `instructor/RosterView.tsx:208–214`) and the CLI (`npm run roster -- import`,
  `roster-cli.ts:74`) both go through it.
- **With the preamble removed by hand:** all 87 rows parse, but:
  1. **The role column is misdetected as `Grade Type`.** `findColumn(headers, ['role', 'type'])`
     (`:162`) falls back to substring matching (`:121`), and "grade type" contains "type". The
     values (LG/PN) are not roles, so everyone gets the default today. It is still a trap: the
     containment fallback lets any header that merely contains "type", "id" or "mail" claim a
     column.
  2. **Names stay in registrar form.** "LAST, FIRST MIDDLE" in capitals becomes the display
     name everywhere (gradebook, session chip), and suffix rows put the suffix in the middle.
  3. **Withdrawn students are imported** as roster members who can create accounts: 7 of 87.
  4. **Section is dropped.** It is useful for TA sections in grading (task 031).
- Correct already: CSV quoting and CRLF (`parseCsv`), lowercasing emails (`normalizeEmail`),
  and UID matching at sign-up, where `normalizeId` (`auth.ts:147–150`) strips dashes, spaces
  and leading zeros.

## Done when
1. **Preamble:** the reader finds the header as the first row (within the first ~20 non-blank
   rows) that yields an email column. It reports "skipped N lines before the header". A file
   with no such row still reports "no email column found".
2. **Column matching:** exact header match first, then whole-word match. `type` alone is no
   longer a role alias, and no substring fallback is left that could let `Grade Type` claim
   role or `SRS` claim ID.
3. **Names:** `"LAST, FIRST MIDDLE[, SUFFIX]"` becomes display form `First Middle Last Suffix`
   in title case that handles hyphens and apostrophes, Mc/Mac and particles
   ("De Anda", "Nunez de la O" — best effort). The last name is kept for sorting.
   Names already in display form (or split first/last columns) pass through unchanged.
4. **Status:** rows with a withdrawn status (`W`; recognise a `Status` column with E/W, or
   enrolled/withdrawn/dropped words) are not imported, and the report says "7 withdrawn — not
   imported". A re-import lists people already on the platform whose row is now withdrawn or
   missing, as "no longer on the class list — review". Nobody is removed automatically (the
   import's never-removes rule stands, `app.ts:288–290`).
   _Superseded in part by Gabriel's decision of 2026-09-23 (Progress log, Checkpoint): `W` is
   Wait List and IS imported, reported as "7 waitlisted — imported"; dropped / cancelled /
   withdrawn rows are the ones not imported._
5. **Section** is stored on the user (a new nullable `section` column) and returned by
   `GET /api/roster`. Major, Classification and Grade Type are deliberately NOT stored: the
   data-classification rule is UID, name, email, work and scores, nothing else.
6. **Import report** in `RosterView`: added / updated / skipped-withdrawn / issues / columns
   used / "no longer on the list".
7. **Never commit a class list:** `.gitignore` gains `*.csv` under a new `rosters/`
   convention plus the registrar's naming pattern (`*-csv.csv`); `deploy/README.md` says class
   lists live outside the repo.
8. **Gates:** `authCheck` (or a new `rosterCheck`) pins a SYNTHETIC registrar-shaped fixture,
   with invented names and example.com emails: preamble, CRLF, quoted "LAST, FIRST, SUFFIX",
   `E-mail`, `Grade Type`, E/W status, sections. It asserts the count, the skipped withdrawn
   rows, display names, section, and that role is not taken from Grade Type.

9. **Interim sign-up wording** (Gabriel, 2026-09-23, from task 036): the Create-account pane
   (`app/src/auth/LoginScreen.tsx:294–303`) says to use the email on your class-list record,
   noting it may be a personal address rather than @ucla.edu, and its placeholder stops
   suggesting `you@ucla.edu`. Task 036 later replaces this with sign-up by UID + either email.

## Design
- **deepFix (recommended):** make the reader recognise the registrar's export as a first-class
  format: header discovery, strict column matching, name normalisation, enrollment status. The
  registrar CSV is the one file every term will feed it. The fixture pins the format so it
  cannot regress.
- **surgicalFix:** tell the instructor to delete the preamble lines by hand. Rejected: it
  fails silently (0 imported, one cryptic line), and every other problem above remains.
- Pointers: `server/src/roster.ts:52–110` (`parseCsv`), `:111–125` (`normalizeHeader`,
  `findColumn`), `:146–224` (`parseRoster`); `server/src/app.ts:262–299`;
  `server/src/db.ts:82–85, 165–167, 233` (users table, `listRoster`);
  `server/src/roster-cli.ts:74`; `app/src/instructor/RosterView.tsx:194–270`;
  `server/src/auth.ts:147–150`.

## Verify
Gates: server `npm run typecheck` and `npm run check` (with the new pins); app `tsc` and
`remoteStoreCheck` (roster client). Owed, and done by Gabriel or with him: import the real file
through the dashboard on the pilot (or a local remote-mode server) and confirm 80 imported, 7
withdrawn skipped, and names in display form. _(Per the 2026-09-23 decision: expect all 87
imported, the report reading "7 waitlisted — imported".)_ The real file stays out of the repo and out of
every task file.

## Progress log
- 2026-09-23 — Checkpoint (uncommitted, fix stage). **Gabriel's decision (in chat): import
  wait-listed students.** On UCLA's registrar roster `W` = Wait List, not withdrawn (UCLA KB:
  E Enrolled, D Dropped, W Wait List, H Held; Extension P Pending, A Approved, C Cancelled),
  so the Description's "7 `W` (withdrawn)" and Done-when 4's "7 withdrawn — not imported"
  were a wrong premise. Done-when 4 now reads: `W` rows are imported (they can create
  accounts and start HW1, as UCLA's own course-site sync keeps them), and the report counts
  them as "<n> waitlisted — imported"; D / C / the word "withdrawn" are not imported and
  reported as "<n> dropped — not imported" etc. One table, `STATUS_TABLE` in
  `server/src/roster.ts` (E/enrolled, W/waitlisted/wait list, H/held imported; D, C,
  withdrawn not; any other code imported with the issue `unrecognised status "X" — imported`).
  The re-import review is as specified: a platform student whose row is now dropped /
  cancelled / withdrawn or missing is listed "no longer on the class list — review"; nobody is
  removed; W → E is simply an update. For the owed live check against the real file: expect
  87 imported (80 E + 7 W), "7 waitlisted — imported", no "not imported" line.
  Review fixes this round: a display-form name with a comma suffix ("Martin Luther King, Jr.",
  "Jane Doe, PhD") passes through unchanged (all-caps "RAHMAN, MD" is still registrar form);
  the header scan blanks only preamble rows (first cell "Key: value"), so "Email:" or a
  question-style email header is still found; a not-imported row is counted only when no row
  for that email was imported, once per email; the report's words live once in
  `app/src/instructor/rosterReportText.ts`, used by both the CLI report and `RosterView`, and
  `server/tools/rosterCheck.ts` pins them (plus a grep gate that `RosterView` keeps no copy).

### 2026-09-23 — implemented (work loop)
- **Built.** The roster import now takes the registrar's class list unedited. It skips the
  preamble (the header is the first of 20 non-blank rows with an email column; `Key: value`
  rows can't be the header), matches columns exactly then by whole word (no substring
  fallback, no `type` role alias), turns `"LAST, FIRST MIDDLE[, SUFFIX]"` into `First Middle
  Last Suffix` with a `sort_name` for surname order, and applies Gabriel's decision through
  `STATUS_TABLE`. It stores `section` (a new nullable column, returned by `GET /api/roster`
  and shown in `RosterView`). It lists who a re-import no longer carries and never removes
  them. One import path, `server/src/rosterImport.ts`, serves both the route and the CLI; the
  report's words live once in `app/src/instructor/rosterReportText.ts`. The sign-up pane
  wording and placeholders changed (Done-when 9). `.gitignore` gains `rosters/` and
  `*-csv.csv`, and `deploy/README.md` says class lists stay outside the repo.
- **Pins.** New `server/tools/rosterCheck.ts` (in server `npm run check`): [registrar
  export] [header discovery] [columns] [status] [names] [review] [report], all on a synthetic
  example.com fixture. `authCheck` covers the route: import, status counts, section plus
  surname order in `GET /roster`, re-import review, nobody removed, section kept. The app's
  `remoteStoreCheck` covers the client types against the real server.
- **Gates (exit codes):** app-tsc 0, app-build 0, app-check 0, server-tsc 0, server-check 0.
  Checkpoint re-run: server typecheck 0, server check 0, app tsc 0, budgets 0 (CLAUDE.md
  39943/40000 bytes).
- **Review.** 5 findings fixed: suffix pass-through, report words shared, status counted
  once per left-out email, header scan blanks only preamble rows, and the decision recorded.
  None skipped. Nits left alone: the `listUsers` comment says "instructors first" but the
  order puts students first; `STATUS_TABLE` is a plain object, so a status cell such as
  "constructor" is skipped with no label; `server/README.md` still describes the old roster
  reader.
- **Owed.** (a) Browser, remote mode on a scratch local server: paste the rosterCheck
  fixture, check the report (skipped 8 lines, columns used with role none, status lines),
  the Section column and surname order, then re-import with one row flipped to D and one
  deleted (both listed, both kept), then 375px width. (b) The Create-account pane wording and
  placeholders; local mode's toy picker unchanged with zero `/api` calls. (c) Gabriel, with
  the real file outside the repo: expect the header on line 9, 87 imported (80 E + 7 W),
  "7 waitlisted — imported", sections 42/45, display names including the 2 suffix rows,
  role none; after release, the same import on the pilot.
- **Next step:** loop session: run visual checks (a) and (b), then land per PROFILE §5. Owed
  check (c) goes to Gabriel.
