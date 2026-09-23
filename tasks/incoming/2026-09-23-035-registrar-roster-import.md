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
status: ready
after:
branch:
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
  (withdrawn). `Section`: 42 in `1A`, 45 in `1B`. `Grade Type`: 86 `LG`, 1 `PN`.

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
withdrawn skipped, and names in display form. The real file stays out of the repo and out of
every task file.

## Progress log
