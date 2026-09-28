---
id: 2026-09-28-079
type: feature
title: Answer "define it with a table" problems in a blank argument–value table, autograded as a function (HW1 P14, P9b)
priority: high
size: large
requires:
area: app
source: feedback
created: 2026-09-28T10:55:00-07:00
status: in-progress
after:
branch: robot/079-argument-value-table-answers
merged_into:
---

## Description
App Feedback report `fb-muliv317-49lfvv` (author-role: instructor, category: platform
design; context HW1, question 14). HW1 Problem 14 asks the student to define f (the symbol
@ ↦ zero, # ↦ one) "by giving its table". Today the answer area shows two labelled boxes,
`f(@)` and `f(#)`. That hands the student the arguments and asks only for the values, and it
doesn't look like a table. Gabriel wants a **blank argument–value table**: the student writes
both the arguments and the values.

**Same problem in P9b (id 20, "Problem 9b").** It asks the student to define j (x·y for
x, y ∈ {0, 1, 2}) "with a table". It shows nine boxes labelled `j(0, 0)` … `j(2, 2)`, which
gives away the domain. Task 048's audit notes flagged this ("HW1 P9b gets fixed blanks,
which gives away the domain"). It is the same fix, so it is included.

**Cause.** Fill-in has one shape: a list of labelled blanks, each compared to a fixed string
by position.
- `app/src/types.ts:175–182` `FillInSpec { labels; numericOnly }`, answers in `fill_in_answers`.
- `app/src/engine/fillIn.ts` `gradeFillIn`: blank i vs key i, after trimming and stripping
  leading zeros.
- `app/src/components/FillInPanel.tsx`: a `.wb-fill-grid` of labelled inputs.
- `app/src/engine/score.ts:308` `questionCaseCount`: `labels.length`.
- The creator's `instructor/FillInBlanksEditor.tsx` + `fillInAuthoring.ts`.
Nothing can show a table, or grade an answer whose arguments the student supplies.

## Done when
1. A fill-in question can be a **table**. The author gives column headers, how many leading
   columns are arguments (≥ 1) and the rest values, a row count, digits-only per column, and
   the key rows. The student sees a real table: the headers, then that many rows of empty
   cells. Every cell wears the paste guard, and digits-only columns take only digits.
2. Graded **as a function, order-free**: each key row is one case. A case passes iff exactly
   one student row has that row's argument cells, and that row's value cells match. Cells are
   normalised as blanks are today. Two student rows with the same arguments fail that case
   (not a function). Empty rows are ignored. Row order never matters.
3. HW1 P14 becomes a 2-row table (headers along the lines of "Argument" | "Value").
   P9b becomes a 9-row table (two argument columns x, y and the value j(x, y)). Both are
   still autograded. The statement text stays (the PDF's wording). `statementFormatCheck`'s
   every-HW validation accepts them.
4. The key never reaches a student. The table's key rides in the already-stripped
   `fill_in_answers` (row-major), or anything new is added to `sanitize.ts stripAnswers`
   and parity-pinned. A result's per-row `label` names the key row's arguments, never its
   value.
5. The answer is stored where fill-in answers already live (`fillAnswers: string[]`,
   row-major), so persistence, autosave, the editing record and provenance need no new path.
   Stale positional answers (the old `f(@)`/`f(#)` shape) load harmlessly, as a row that
   simply fails. The sample submissions (`devData/homeworks/submissions/hw1.json`, P14/P9b
   entries) are updated to the table shape.
6. The question creator authors a table (headers, argument-column count, rows, key). An
   instructor's save round-trips a table question without loss. The grade sheet's failed
   inputs name the failed rows. Gates green, with pins as in Verify.

## Design
- **deepFix (recommended): fill-in gets shapes, read through one engine function.**
  `FillInSpec` gains an optional `table: { columns: string[]; argColumns: number; rows:
  number }`. Its absence means today's blanks, unchanged. `engine/fillIn.ts` becomes the one
  reader of a spec's shape: the cells to render (`fillInBlanks` already plays this role for
  `numericOnly`), the case count (move `score.ts:308` to call it, so the ½ rule's N is the key
  row count), and grading (`gradeFillIn` dispatches blanks | table). The grader
  (`engine/grader.ts:131–148` `gradeFillInQuestion`, whose key-length check assumes
  `labels`), `workbench.ts` (imports `fillInBlanks` for the started mark),
  `FillInPanel`, the creator and `GradeSheet.tsx:83–116` all ask it, so none reads
  `spec.labels` bare for a table. Task 080 then adds a second rule-based shape through the
  same dispatch.
- **surgicalFix:** relabel P14's boxes "Argument 1 / Value 1 …" and grade positionally. Order
  would still matter and a swapped pair would fail, so it isn't a function table.
- **Relation to 048 (multi-part questions).** 048's "table" part kind (rows the student adds)
  should reuse this table's renderer, answer shape and grader, not build a second table. A
  note is added to 048. This task does not need 048: P14 and P9b are single-part questions.
- `sanitize.ts:43–62` strips `fill_in_answers` wholesale, `stripFillInCaseResult` (`:85`)
  keeps `label` + `pass`, and `parityCheck` pins server ≡ engine. Keep the key inside that
  field and nothing new leaks.
- Content: the homework sync refreshes unedited pilot copies on the next release (content
  hash changes). The pilot has only toy data, so no answer migration is owed.

### Members
- `fb-muliv317-49lfvv` (instructor): HW1 P14 should be a blank argument–value table.
- (048 audit, 2026-09-25) HW1 P9b's fixed blanks give away j's domain.

## Verify
- Pins: `pipelineCheck` (submit → grade for a table question: rows in any order pass; a
  swapped value fails one case; a duplicated argument fails; an empty table fails every
  case), `scoreCheck` (the ½ rule's N = key rows), `statementFormatCheck` (every HW valid),
  `remoteStoreCheck` + `server/ npm run check` (parity, stripped key), `pasteCheck` (the new
  cells are guarded).
- Full gates in `app/` and `server/`.
- Eyeball (owed, not claimed): HW1 P14 and P9b in the editor. The table reads as a table,
  cells are legible, and digits-only columns refuse letters. Also the creator's table
  authoring.

## Progress log
- 2026-09-28 — Raised to `high` (Gabriel's 043 session): 048, the interleaved worksheet he asked
  for, now builds on this task's table and waits on it.

### 2026-09-28 — implemented (work loop)
- **Built (deepFix).** A fill-in question can now be a blank argument–value table. The
  student writes the arguments too, and the table is graded as a function with row order
  ignored. `FillInSpec` gains an optional `table {columns, argColumns, rows}`; with no
  `table` it is the old blanks, unchanged. `engine/fillIn.ts` is the one reader of the shape
  (`fillInShape`, `fillInCaseCount`, `fillInKeyProblem`, `gradeFillIn` → blanks | table). The
  grader, `score.ts questionCaseCount` (the ½ rule's N = key rows), `workbench.ts` ("Table"
  tag), `problemSet.ts validateDocument`, `FillInPanel` (a real `mm-table`, each cell
  paste-guarded, digits-only per column), `GradeSheet` ("row @"), the instructor's
  submission page ("rows correct"), and the Grading Queue (read-only table) all go through it. The key stays row-major in
  `fill_in_answers` (already stripped). The answer stays row-major in `fillAnswers`, so there
  is no new persistence or provenance path. The creator has a Blanks | Table switch with
  `FillInTableEditor.tsx` (headers, argument count, rows, key grid, reorder) over pure
  `fillInAuthoring.ts` (`tableDraftOf`/`fillInTableFields`/`fillInTableDefects`/
  `misplacedTableWarning`). HW1 P14 is now a 2-row Argument | Value table, and P9b a 9-row
  x | y | j(x, y) table. The PDF wording is kept; P14's app-added "In the boxes" line now says
  "In the table". The sample submissions are updated to the table shape.
- **Pins.** `pipelineCheck [fill-in tables]` covers: rows in any order pass, a swapped value
  fails, a duplicated argument fails, an empty table grades 0/N (never pending), stale
  positional answers grade 0/2 without throwing, labels are arguments only, stripped HW1
  submit → grade, creator round-trip byte-for-byte, defects and misplace warnings, the
  100-row cap, and a grep pin that only `fillIn.ts` reads `.labels`. Also: `scoreCheck`
  (N = key rows, ½ at 8/9), `statementFormatCheck` (validateDocument on tables, every HW
  valid), `workbenchCheck` ("Table" tag, started mark, and FillInPanel added to the list of
  key-free renderers), `pasteCheck` (FillInPanel ≥ 2 guarded fields), and `parityCheck` (the
  student copy keeps the layout with no key, rows are named by arguments only, and the table
  grades the same server-side). `homeworkSyncCheck` only gained the optional-`labels` type
  fix.
- **Gates:** app-tsc=0 app-build=0 app-check=0 server-tsc=0 server-check=0; context budgets ok.
- **Review:** fixed [minor] no cap on a table's authored rows. `FILL_IN_TABLE_MAX_ROWS = 100`
  is enforced in `fillInKeyProblem` and the creator, and `fillInShape` clamps to it. The
  grader builds only the rows the answer reaches. Skipped: none. Nits left alone:
  `fillInAuthoring.ts`'s header still says "React-free" but it now imports `moveItem` from
  `dragReorder` (the file is instructor-side, so law 2 is unaffected), and duplicate React
  keys can occur on key-row defect messages when two columns share a header.
- **Owed (eyeball, not claimed).** (1) Local mode: Load HW1–HW7 → publish HW1 → P14 shows a
  2-row Argument | Value table, where '@'/'#' can be typed and Value refuses letters. P9b
  shows 9 × x | y | j(x, y), digits only. Mark done makes the cells read-only, and an
  outside paste is refused. (2) Submit P14 with the values swapped, release, and check that
  the Grades sheet shows "row @" / "row #", the submission page shows "rows correct" with
  expected/got, and the Queue shows the read-only table. (3) Creator: edit P14 as a table
  and save with no change; a re-run of Load HW1–HW7 should still show HW1 unedited. Then
  create a new 2-argument table. (4) After release: the sync lists hw1 refreshed, P14/P9b
  show on the pilot, and old HW1 results show as stale until a re-grade.
- **NEXT STEP:** loop session: the visual check owed above, then land per PROFILE §5.
