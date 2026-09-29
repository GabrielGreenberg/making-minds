# Multi-Part Problems: Group Questions, Don't Nest Them
_Status: accepted · 2026-09-28 · Task: 2026-09-25-048_

## Problem family

A printed problem often has parts: HW1 P6 asks for two sentences and a number, P9 for an
equation and a table, P10 for three equations, P13 for two sums. Task 046 split each into
lettered questions ("Problem 6a", "6b", …) as a JSON-only workaround. That costs a screen
per part, a Mark done per part, a stem restated on every part ("the function *m*(⋅) from
6a"), and a question list of 23 rows for a 17-problem homework. And the answer area showed
no problem text at all: the statement lived only in the left panel, beside an eyebrow and a
bare field.

Gabriel's requirements (2026-09-26): in a written problem, (1) group (a), (b), (c) on the
same page, with several fields; (2) restate the text in the answer area, interleaved with
the fields "in the natural way" — the stem, each part's prompt followed by its field, the
closing. And (2026-09-28): folding HW1 back "just changes the appearance, not the actual
grading" — students' existing work, attempts and grades carry over, no grade changes.

Instances: HW1 P6, P9, P10, P13 (folded here). Candidates left as they are (a content
call, not this task's): HW1 P8 and P12, HW4 P1–P2, HW6 P3 — each asks for more than one
thing in running prose; turning that prose into parts means new question ids, new grading
units and a new point count, which is Gabriel's decision per problem.

## Options

**A. Nested parts inside one question** — `AssignmentQuestion.parts: [{label, kind,
prompt}]`, the question the grading unit, per-part answers inside its container. The shape
the task file sketched. It changes the grading unit: the grade key needs a part
(`grades`, `grade_events`, the queue's claims and the summaries all key by question), the
score needs a roll-up rule, every stored workbook, immutable attempt and human grade for
6a–13b must be rewritten under the merged id, and every HMAC-signed editing record
(provenance/trace.ts signs over the question id) would fail to verify under the new id —
raising false integrity flags on exactly the students who already worked HW1. A DB
migration of immutable records, for a change Gabriel called cosmetic.

**B. Parse the parts out of the statement** — `statementFormat.ts` already splits
`(a)`/`a.` for display. Ambiguous where it matters (the catch notes: blank-line-separated
parts, a closing glued to the last part, a list under a part), and still one answer per
question.

**C. Group questions at the document level** — each part stays an `AssignmentQuestion`,
the grading unit, with its own id, result, grade, point and editing record; four
display-only fields group a run of them into one problem. This is the problem-set memo's
own rule applied once more: "`questions[]` stays flat and stays the grading unit;
everything here is display-only" (problem-set-document.md §2).

## Decision

**C.** The phenomenon is a display grouping; the grading was always per part (046 made
every part a question, and Gabriel asked that nothing about grading change). With ids
unchanged, nothing migrates: workbooks, attempts, human grades and signed records are keyed
exactly as before.

- **Schema** (`types.ts`, display-only, never read by the grader, `score.ts` or
  `sanitize.ts` — which passes them through as it does statements; none carries an answer):
  `partOf?` (the id of the problem's first part), `stem?` and `closing?` (on the first
  part: the problem's text before and after its parts), `answerField?: 'line' |
  'paragraph'` (an open question's field; absent = paragraph). A part's label is its
  letter, its prompt is its `statement`, its kind is `problemSet.ts writtenKind` — a line,
  a paragraph, fill-in blanks, or 079's table (same spec, renderer, row-major answer and
  grader). This replaces the task's literal `parts: [{label, kind, prompt}]` (option A).
- **Table rows are the author's, not added by the student.** The task sketched "rows the
  student adds"; 079's table, reused unchanged as its catch note asked, draws exactly the
  authored row count, and its grader reads only those rows. The author may give spare rows
  (a key may be shorter than the table), so the count need not give the domain away. An
  "Add row" control would change the grader's row bound and its parity pin — a follow-up
  if Gabriel wants it, not built here.
- **Grouping** (`problemSet.ts problemGroups`, memoized per assignment object, no statement
  parsing, so selectors and every lock check may read it): a question joins the problem
  just before it iff its `partOf` is that problem's first-part id, in the same section,
  directly after its last part, both written questions, the first part no part itself.
  Anything else stands alone — a broken group degrades to separate problems, and
  `validateDocument` names it. A machine question is never a part, so a page has at most
  one canvas, owned by its first question.
- **The page** (`store.ts`): the live question becomes the live problem. A problem opens at
  its first part's index (`pageIndexOf`; `switchQuestion`, `openAssignment` and routing
  canonicalize; the page already open is no swap). `liveText` / `liveTraces` (by question
  id, every part of the page) replace `openResponse` / `fillAnswers` / `questionTrace`;
  `setOpenResponse(qid, …)` / `setFillAnswer(qid, i, …)` ask `isCurrentQuestionLocked`
  first (law 3), then refuse a part not on the page. `foldLiveProblem` /
  `loadProblemFields` are the one fold and the one load. `recordEdit` signs each part's
  record under its own id. One Mark done: done iff every part is done
  (`selectProblemDone`), and the toggle writes every part. The editor's global
  `lastEditAt` stays shared, so a part's `activeMs` is approximate — acceptable (the
  record is flags to look at, never a verdict).
- **The worksheet** (`components/Worksheet.tsx`, replacing `OpenResponsePanel` and
  `FillInPanel`): the stem, each part's letter and prompt followed by its field, the
  closing, the save line; one `usePasteGuard` ref for every field (law 8). A single written
  question reads the same way: its statement, then its field. `Worksheet` is a connector
  over the store-free `WorksheetSheet`, which the harness renders (`navResetCheck
  [worksheet]`). A line part whose text already holds a line break keeps a paragraph field
  — HW1's pilot answers to 6b, 9a and 10a–c were written in a textarea, and an `<input>`
  would flatten the breaks and save that on the next keystroke. The left panel renders the
  whole problem through `ProblemBody` (which now takes a resolved problem); `ProblemContext`
  (no callers) is retired. Prev / Next, "k of M", the question list and the overview count
  problems.
- **Points: parts don't roll up.** Each part keeps its 1 point, which answers
  grading-interface.md §10 ("048 decides how parts roll up"): the grade key needs no part.
  HW1 stays 23 grading units under 17 printed problems — as it has been since 046.
- **Review tables.** A fill-in table authored with no key is graded by hand: the grader
  returns it `pending` (`engine/fillIn.ts isReviewTable`), `isHandQuestion` counts it, the
  queue offers it, its cells stay on the submission. Only ever asked of the instructor's
  copy — a student's copy has no key, so to it every table looks like one.
- **Lines and paragraphs** are `pending` like any open question; LLM grading (task 014)
  reads one field per part, as it wanted.

## Blast radius

`types.ts` (four fields), `problemSet.ts` (grouping, `ResolvedProblem.parts` / `label`,
`writtenKind`, validation), `store.ts` (the live problem), `routing.ts` (page comparison),
`components/Worksheet.tsx` (new), `ProblemSetDocument.tsx`, `QuestionPanel.tsx`,
`workbench.ts`, `AssignmentOverview.tsx`, `GradingQueue.tsx` (a part's prompt under its
stem), `engine/fillIn.ts` + `grader.ts` (review table), `instructor/gradingViews.ts`,
`QuestionCreator.tsx` (answer field, part of, stem, closing — the creator rebuilds the
question from its form, so every new field is carried), `fillInAuthoring.ts` (zero key
rows allowed), `AssignmentEditor.tsx` (parts marked), `hw1.json` (display fields only).
Unchanged: the grader's dispatch for every other kind, `score.ts`, `sanitize.ts`, the
parity pins, the homework sync, the workbook / submission / grade shapes.

**HW1 content hash changes** (display fields are content), so the release's sync refreshes
a pristine pilot copy, and HW1 attempts read as stale in the Grading tab until a re-grade —
which changes 0 points (the grading projection is pinned byte-equal in `pipelineCheck
[multi-part problems]`).

**A tab loaded before the release** runs the old bundle, which renders only `statement`
and never reads `stem` or `closing`: opening HW1 there shows 6a, 9a and 10a without their
setup text, 13a without its "methods of addition" instruction, and 6b, 6c and 9b without
their "from 6a / 9a" references, until the page reloads — the app has no build-version
check to force one. Grading is unaffected. Say so in the release note, or release when few
students are mid-HW1.

Harness: `statementFormatCheck [multi-part problems]`,
`pipelineCheck [multi-part problems]`, `navResetCheck [multi-part problem]` + `[worksheet]`
(the sheet rendered: stem, each prompt directly followed by its field by kind, closing),
`provenanceCheck [parts]`, `workbenchCheck [question list]`, `routingCheck [multi-part
route: applied]`, `gradingViewCheck [queue]`, `pasteCheck` (the Worksheet's four guarded
fields), `themeCheck` (its page component).
