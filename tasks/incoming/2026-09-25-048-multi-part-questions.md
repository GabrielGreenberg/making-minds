---
id: 2026-09-25-048
type: feature
title: Multi-part questions — one problem, parts of different kinds (line, paragraph, blanks, table), one Mark done
priority: high
size: large
requires: browser, human
area: app
source: audit
created: 2026-09-25T10:35:00-07:00
status: ready
after: 2026-09-25-046
branch:
merged_into:
---

## Description
From the HW1 audit (2026-09-25). A question has ONE answer kind today: a machine, one
textarea (`open`), or labelled blanks (`fill_in`). Real problems have parts: HW1 P6 (two
sentences and a number), P9 (an equation and a table), P10, P13. Task 046 splits them into
lettered questions ("Problem 6a") as a JSON-only workaround. That costs extra screens, one
"Mark done" per part, and a restated stem on each part.

Nothing lets a student answer with a table. HW1 P9b gets fixed blanks, which gives away the
domain; later homeworks ask "define it with a table" too.

LLM grading (task 014) wants one field per gradable part. Script grading wants exact parts
separated from prose.

### Gabriel's requirements (chat, 2026-09-26)
"In the student view of assignments, when it's a written answer: (1) group (a), (b), (c) etc.
in the same page, with multiple fields; (2) restate the text in the problem window,
interleaved with the fields (in the natural way)."

## Done when
0. **The answer area is a worksheet, fixed by Gabriel (2026-09-26).** For a written question the
   centre answer area (today `OpenResponsePanel`/`FillInPanel`: an eyebrow, the field(s), and
   `AnswerFoot` — no problem text at all; the statement lives only in the left
   `QuestionPanel`) shows the problem text itself, interleaved with the fields as a printed
   worksheet would. First the stem, then each part's prompt directly followed by that part's
   field, then any closing text ("Use one of the methods… show your work!"). All parts sit on ONE
   page. A single-field written question reads the same way: its statement, then its field. The
   left question panel keeps the full problem as today, so the text is restated, not moved.
A question may carry `parts: [{label, kind, prompt, …}]`, where each kind is one of:
- a short line
- a paragraph
- fill-in blanks
- a table: rows the student adds, columns the author names

It renders as one problem with its parts, one Mark done, one stem. Each part is graded by its
kind (blanks by script; a line, paragraph or table pending review, or by an LLM), and the
result keeps per-part verdicts. HW1's lettered questions are folded back into parts. Design
memo first (`docs/buildout/designs/`); Gabriel approves.

## Design
### Catch notes (2026-09-26)
- **Take the parts from structured data, not from parsing the statement.** `statementFormat.ts`
  already splits `(a)`/`a.` parts, but only for display (`para.part`, `:49–80`), and it is
  ambiguous where it matters for interleaving:
  - Parts must share ONE paragraph. Blank-line-separated parts are not detected.
  - Text after the last marker is glued to the last part. A closing sentence in its own
    paragraph belongs to no part.
  - A list under a part becomes an unrelated sibling block.
  The interleaved worksheet needs to know which text precedes which field, so the authored
  `parts: [{label, kind, prompt}]` (with the statement as the stem, plus an optional closing)
  is the source. The parser's part splitting stays a display nicety for legacy prose.
- **Renderer:** reuse `StatementBody` for the stem, prompts and closing (KaTeX, tables, lists).
  `ProblemContext` in `components/ProblemSetDocument.tsx:152–170` has no callers, and the file's
  header comment (`:10–13`) still claims the editor panels use it. Retire it or make it this
  worksheet. One `usePasteGuard()` ref can serve every field of the question
  (`usePasteGuard.ts:26–34`; `FillInPanel.tsx:28, 52` already does this).
- **Every consumer of the single answer string** (all must learn per-part answers):
  - `types.ts:479–481, 623, 741`.
  - `store.ts` `openResponse`/`setOpenResponse` (`:896, 2323–2336`), `recordEdit` text key
    (`:1490, 1514`), `foldLiveQuestion`/`loadQuestionFields` (`:1545, 1560`), autosave trigger
    (`:5397`), `submittedQuestionCircuit` (`:5230`).
  - `storage/submissionStore.ts:57–60` `buildSubmission` (one of responseText/fillAnswers).
  - `engine/grader.ts:113–121, 171, 288` `pendingOpen`.
  - `server/src/sanitize.ts:85–93, 117–124`.
  - `instructor/GradebookView.tsx:390–405` (one blockquote), `:602` `ManualReviewControls` and
    `storage/manualReview.ts:20–40` (one verdict per question), `instructor/Gradebook.ts:29–34`.
  - `components/GradeSheet.tsx` (verdict per question), `workbench.ts:64` (started mark),
    `QuestionPanel.tsx:198–205`.
  - `provenance/trace.ts:27–64, 147–165` (`TextContent`, `textDigest`, `textLength`) and
    `provenance/integrity.ts:71–128, 182`.
  - Tools: `provenanceCheck` (25 refs), `navResetCheck` (10), `workbenchCheck`, `pipelineCheck`,
    `server/tools/parityCheck.ts`; sample submissions (`devData/sampleData.ts:790`,
    `devData/homeworks/submissions/hw*.json`).
  - Legacy: a saved single `responseText` must load as the one-part answer.
- **Grading-design coupling:** task 031's memo (in progress, `docs/buildout/designs/
  grading-interface.md`) plans to extend the grade key with a part. Agree the per-part verdict
  shape with it, so manual review, the gradebook and the grade sheet each change once.
- **Content today:** no HW question uses parts (046 split HW1 P6/P9/P10/P13 into lettered
  questions 6a–13b; the ids after each first part are 18–23). Open questions that ask for more
  than one thing in running prose, and are candidates for parts: HW1 8, 10b, 10c, 12; HW4 1, 2;
  HW6 3.
- **Risk, folding HW1 back:** if students already have HW1 work on the pilot, merging the
  lettered questions back into parts changes question ids mid-assignment. Existing answers
  must migrate by id. Timing is Gabriel's call (asked 2026-09-26). Recommended: build the
  feature now, use it for HW2 onwards, and fold HW1 back only after HW1 is due (2026-10-04),
  with that migration.

Touches the answer model (`types.ts` `QuestionCircuit` responseText / fillAnswers), the
panels (`OpenResponsePanel` / `FillInPanel`), the problem-set document, the grader, the
gradebook and GradeSheet, the provenance seam (every new field wears `usePasteGuard`),
sanitize (answer keys per part) and the homework sync. Route through the seams.

## Verify
Gates; pins per part kind; browser.

## Progress log
- 2026-09-26 (catch): Gabriel's interleaved-worksheet requirement added (Done when 0); priority
  raised to high; catch notes added. Next: the design memo, starting from Done when 0 and the notes.
