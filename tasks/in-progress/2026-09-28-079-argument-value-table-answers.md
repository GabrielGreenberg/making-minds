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
