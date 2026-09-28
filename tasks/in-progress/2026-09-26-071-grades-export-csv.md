---
id: 2026-09-26-071
type: feature
title: Export problem-set grades as a CSV — one row per student, HW1–HW6 out of 100 and their average
priority: normal
size: large
requires: browser
area: server
source: chat
created: 2026-09-26T21:34:00-07:00
status: in-progress
after: 2026-09-26-068
branch: robot/071-grades-export-csv
merged_into:
---

## Description
Filed from task 031's accepted design (Gabriel approved 2026-09-26, with its three proposed defaults). Authority: the memo `docs/buildout/designs/grading-interface.md` — its §3 table records every decision; read it before starting. Slice 11 of 11 (memo §12). HW1 is due Oct 4 and is returned about a week later, so slices 1–8 carry the schedule.

Memo §3 decisions 12/12b, §7.5. Problem sets only; exams and participation stay outside
the app.

## Done when
- `GET /api/grading/export.csv` (instructor-only, logged as an `export` event): `UID, name,
  email, section, HW1…HW6` (final grade out of 100 incl. late deduction; Missing = 0 after the
  effective due date, blank before), `average` (mean of counted sets due so far).
  `countsTowardGrade: false` assignments excluded. Buttons on the Grading tab and each
  Overview (that one exports the single assignment's column).
- Pinned: CSV shape and values on a fixture equal the summary's grades; students get 403.
- The file is a download; nothing writes it into the repo (PROFILE §8.9).

## Design
- **deepFix:** the export is a rendering of the 064 summary — no third grade computation.

## Verify
Gates; open the CSV from local mode in a spreadsheet.

## Progress log
- 2026-09-27 (robot, implement): the export as a rendering of the 064 summaries. New pure
  `app/src/storage/gradesExport.ts` (`buildGradesExport`, `csvCell`, `exportColumnLabel`,
  `exportFilename`) — cells are `row.grade.final`, the average `countedAverage`; no scorer
  (grep-gated). Server: `gradesExport()` adapter (Directory key→email map, no per-row
  query) + `GET /api/grading/export.csv` (instructor-only; text/csv, attachment, no-store;
  `?assignment=`; 404 unknown). `ExportEvent` (types.ts; no `student` field) logged under
  COURSE_LOG_ID both modes (`logNote` → `logCourseEvent`). Seam: `GradingStore.exportGrades`
  (local builds + logs; remote `getGradesExport` via a new `requestText` that keeps the BOM).
  UI: `ExportCsvButton` (GradingParts) on the Grading tab header and each assignment header
  (replacing the disabled placeholder); `download.ts downloadText`.
  Decisions (technical, noted): columns = counted AND published sets (a hidden set never
  counts, as the student page's average rules); single-assignment export = that one column,
  no average, any set; provisional grades export as their current number; UTF-8 BOM + CRLF +
  formula guard (= + - @ tab CR → leading apostrophe); duplicate labels get " (2)"; filename
  date in the course zone (America/Los_Angeles).
  Pins: gradingViewCheck [export] (pure), gradingCheck [export] + [local ≡ remote] export,
  remoteStoreCheck exportGrades line. Gates green: app tsc, typecheck:tools, build,
  `npm run check`; server `npm run check`. Browser (local mode, robot dev server started by
  hand on 5190): Grading tab Export CSV → `making-minds-grades-2026-09-27.csv` =
  `UID,name,email,section,HW1,HW2,average` (HW1+HW2 published, HW7 published but excluded,
  rest hidden; nothing due yet → blanks); HW1 Overview → one column; both logged as
  `export` events. Owed: opening the file in a real spreadsheet app (Excel/Numbers) — the
  BOM/CRLF/quoting are pinned, the eyeball in a spreadsheet is not.

### 2026-09-27 — implemented (work loop)
- **Built:** instructors can download the course grades as a spreadsheet file — one row per
  roster student (UID, name, email, section), a column per counted, published problem set
  (final grade /100 with late deduction; Missing = 0 once past due, blank before), and the
  average. An "Export CSV" button sits on the Grading tab header and on each assignment's
  header (that one exports the single column). It is a rendering of the 064 summaries
  (`app/src/storage/gradesExport.ts`), served at `GET /api/grading/export.csv`
  (instructor-only, logged as a course-wide `export` event), downloaded, never written to disk
  server-side or into the repo.
- **Pins:** gradingViewCheck [export] (pure shape, csvCell guard, labels, filename);
  server gradingCheck [export] (headers, BOM/CRLF, cells ≡ summary `grade.final` +
  `countedAverage`, event, `?assignment=`, 404/403/401 unlogged) + local ≡ remote export;
  remoteStoreCheck exportGrades; serverCheck "CORS exposes Content-Disposition to an allowed
  origin".
- **Gates:** app-tsc=0 app-build=0 app-check=0 server-tsc=0 server-check=0.
- **Review fixed:** CORS now exposes `Content-Disposition`, so the cross-origin pilot client
  reads the dated per-assignment filename (fixed server-side to keep gradesExport.ts out of
  the remote-store graph). Skipped: none. Nits left: CLAUDE.md Server line lost "latest" in
  the 069 re-grade wording; an assignment-less course exports a header only.
- **Owed:** browser local mode (both downloads, open in Numbers/Excel, busy/error states,
  375px header wrap); browser remote mode (bearer 200 text/csv attachment; student never sees
  the button, direct fetch 403); Gabriel after release — export on the pilot, spot-check two
  students and the average, leading-zero UIDs, file saved outside the repo.
- **NEXT STEP:** loop session: visual check if owed, then land per PROFILE §5.
