---
id: 2026-09-25-048
type: feature
title: Multi-part questions — one problem, parts of different kinds (line, paragraph, blanks, table), one Mark done
priority: high
size: large
requires: browser
area: app
source: audit
created: 2026-09-25T10:35:00-07:00
status: done
after: 2026-09-28-079
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
memo in `docs/buildout/designs/`, written as part of this task — no separate approval
(Gabriel, 2026-09-28: see Resolved decisions).

**As built (2026-09-28; memo `docs/buildout/designs/multi-part-problems.md`, decision C).**
The `parts: [{label, kind, prompt, …}]` clause is met by grouping, not nesting: each part
stays its own `AssignmentQuestion` (own id, result, grade, point and signed editing record),
and display-only fields group a run of them into one problem — `partOf` (the first part's
id), `stem` / `closing` (on the first part), `answerField: 'line' | 'paragraph'`. A part's
label is its letter, its prompt its `statement`, its kind `problemSet.ts writtenKind`, and
its verdict its own question's result. Nesting (option A) would have re-keyed every HW1
workbook, attempt and grade and broken every signed editing record, for a change Gabriel
called cosmetic. The table kind is 079's table as it stands: the author sets the row count
(spare rows allowed, so it need not give the domain away); "rows the student adds" is not
built — it would change 079's grader row bound and its parity pin (a follow-up if wanted).

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
  must migrate by id. Decided 2026-09-28: fold HW1 back now (Resolved decisions).
- **Tables come from 079 (robot catch, 2026-09-28).** Task 079 builds a blank
  argument–value table as a fill-in shape, autograded as a function, for HW1 P14 and P9b.
  That retires P9b's fixed blanks noted above. This task's "table" part kind should reuse
  079's renderer, answer shape (row-major `string[]`) and grader, not build a second table.
  Task 080 adds a rule-graded fill-in shape (HW1 P12) through the same dispatch.

Touches the answer model (`types.ts` `QuestionCircuit` responseText / fillAnswers), the
panels (`OpenResponsePanel` / `FillInPanel`), the problem-set document, the grader, the
gradebook and GradeSheet, the provenance seam (every new field wears `usePasteGuard`),
sanitize (answer keys per part) and the homework sync. Route through the seams.

### Resolved decisions (Gabriel, 2026-09-28)
- **Build it without a design approval first.** Write the memo as part of the task and go
  on; Gabriel reviews the result with the browser check before his hand release (it is held
  anyway: sanitize, homework content, the schema). The robot works it (`human` dropped).
- **Stitch HW1 back together now**, not after HW1 is due: HW1's lettered questions (6a–13b)
  fold back into one problem each, with parts. "It just changes the appearance, not the
  actual grading." So students' existing HW1 work on the pilot must carry over — answers,
  attempts and grades migrate by id to the regrouped problems; nobody loses work and no
  grade changes.
- **After 079** (the answer tables): the table part kind reuses 079's renderer, answer shape
  and grader, so 079 lands first; it is raised to `high` so 048 doesn't wait behind it.

## Verify
Gates; pins per part kind; browser.

## Progress log
- 2026-09-26 (catch): Gabriel's interleaved-worksheet requirement added (Done when 0); priority
  raised to high; catch notes added. Next: the design memo, starting from Done when 0 and the notes.
- 2026-09-28 (robot): built per the memo, decision C (Done when's As-built note): the
  Worksheet (stem → each part's prompt and field → closing), one page and one Mark done per
  problem, per-part answers and records under unchanged ids, key-less tables pending for hand
  grading, HW1 6/9/10/13 folded by display fields only. Review fixes: `Worksheet` is now a
  connector over the store-free `WorksheetSheet`, rendered for real in `navResetCheck
  [worksheet]` (Done when 0: order and field kind per part, 9b's table set through the store,
  read-only when done); a line part whose saved text holds a line break keeps a paragraph
  field (HW1's pilot answers to 6b, 9a, 10a–c were written in a textarea); the memo records
  the author-set table rows and the stale-tab gap. **Release note:** a tab loaded before the
  release shows HW1 6a/9a/10a without their setup text, 13a without its closing and 6b/6c/9b
  without "from 6a / 9a", until reloaded — grading unaffected. **Owed, not claimed** (no dev
  server in an unattended run): Gabriel's browser eyeball — `npm run dev` in `app/`; as the
  toy instructor, Load HW1–HW7 (publish HW1 if hidden); as John Doe, open HW1 problems 6, 9,
  10 and 13: each reads stem → a. prompt + its field → b. … → closing on one page, one Mark
  done, fields of the right kind (6a paragraph, 6b line, 6c blank, 9b a 9-row table).

### 2026-09-28 — implemented (work loop)
- **Built.** A written problem now reads as a worksheet: the stem, each part's prompt with
  its own field right under it (a line, a paragraph, blanks or 079's table), then the
  closing. All the parts sit on one page, with one Mark done and one row in the problem list.
  Prev/Next step by problem. The answer area is `components/Worksheet.tsx` (a connector over
  the store-free `WorksheetSheet`), which replaces `OpenResponsePanel`/`FillInPanel`. The
  grouping is display-only (memo decision C: `partOf`, `stem`, `closing`, `answerField`).
  Every part keeps its id, result, grade, point and signed record, and live answers/records
  are kept per part in the store. A table with no key grades `pending` for a person. HW1
  6/9/10/13 are folded back: the 23 questions now read as 17 problems.
- **Pins.**
  - `navResetCheck [multi-part problem]` + `[worksheet]`: a real render with part order and
    field kinds; an old save on 18/19 opens problem 6's page; one Mark done locks every part;
    a legacy line answer that contains a line break keeps a textarea.
  - `pipelineCheck [multi-part problems]`: ids, grading projection hash and sections are
    unchanged from 3949bc9; the new fields carry no answer; the review table is pending.
  - `statementFormatCheck [multi-part problems]`, `workbenchCheck` (one row/page per problem;
    connector → sheet), `routingCheck` (a later part's route opens its page),
    `provenanceCheck [parts]`, `pasteCheck`, `gradingViewCheck` (the review table is a hand
    problem).
- **Gates:** app-tsc=0, app-build=0, app-check=0, server-tsc=0, server-check=0.
- **Review:** 5 findings fixed, 0 skipped:
  - an As-built note (grouping, not nesting);
  - table rows are set by the author (recorded as a follow-up);
  - a real render pin for Done when 0;
  - a multi-line line answer keeps its textarea;
  - the stale-tab release note.
- **Nit left:** in the assignment editor's preview, clicking a multi-part problem opens only
  its first part.
- **Owed, not claimed:**
  - The browser eyeball in local and remote mode, by the recipe above (problems 6/9/10/13,
    persist, done-lock, paste refusal, the Grades sheet, the Queue by problem, the creator's
    "Part of", a narrow-width shot).
  - After the hand release, on the box: `npm run homeworks -- status` should show HW1
    refreshed, not edited. Then a Re-grade… dry run should show 0 point changes → Commit.
- **Next step:** loop session: the visual check (owed), then land per PROFILE §5 (held for
  Gabriel's hand release: schema, sanitize, homework content).

### 2026-09-28 (robot, land)
- **Visual check, headless** (the browser pane can't start a dev server unattended): headless
  Chrome over CDP (the shootProblemSets recipe) on a scratch Vite (:5190), local mode, HW1
  seeded and published. As John Doe: the overview reads "17 problems", numbered 1–17, with no
  lettered labels; 6, 9, 10 and 13 each show one stem, their a./b./c. parts and the closing (9
  and 13). Problem 6's page shows the stem, then a. with a paragraph, b. with a line and c.
  with a blank, then "Saved as you type.". Problem 9 shows a. with a line, b. with a 9-row
  x | y | j(x, y) table (27 cells, no key), then the closing. Problem 13 shows two blanks and
  the closing. Problem 7 shows its statement and then a paragraph.
  - Typed answers persist after going Home and reopening through 6b's route (`q/6`).
  - "I'm done with this problem" makes all three fields read-only, and typing then doesn't
    land. Unchecking it unlocks them.
  - A synthetic outside paste into 6b is refused with the provenance notice.
  - Next goes from 6 to 7 (`q/5` → `q/8`) and Prev comes back. The list has one row per
    problem (17).
  - At 700 px there is no horizontal scroll on problems 6 and 9, and nothing overflows the
    sheet.
  - Submitting records attempt 1. As Prof. Ada, Grading → HW1 → Queue for 6b shows the stem
    and the (b) prompt over John's answer. The Matrix keeps a column per part (6a–6c, 9a–9b,
    10a–10c, 13a–13b). The assignment editor tags 6b, 6c, 9b, 10b, 10c and 13b as "part of
    Problem …".
  - No console errors.
- **Still owed, not claimed:**
  - Gabriel's own eyeball in local mode: the recipe above, plus the Grades sheet after release
    and the question creator on question 18.
  - All of remote mode: Vite Remote Mode with a local server on :8199, including the frozen
    view and "Open in viewer".
  - The box step after the hand release: `npm run homeworks -- status` should show HW1
    refreshed, not edited. Then run a Re-grade… dry run on HW1; it should show 0 point
    changes, then Commit.
- Landed; no conflict with `origin/main` (nothing new since the claim), so the workflow's
  gates stand (all five exited 0).

### 2026-09-28 (follow-up, Gabriel's ask)
- **The nit is fixed.** In the assignment editor's preview, a click on a lettered part now
  opens that part's question. A click on the stem, the closing or the problem number still
  opens the first part. `ProblemBody` marks each `.ps-part` with `data-part-index`, and
  `ProblemView` opens the index the click landed in. A student's click still routes to the
  problem's page.
- **Pinned:** `navResetCheck [worksheet]` renders the document and checks each lettered part's
  index for 6, 9, 10 and 13, plus the click resolution. The pin fails without the fix.
- **Headless check** (real mouse events, scratch Vite, local mode):
  - Clicks on 6a, 6b, 6c, 9b, 10c and 13b each open "Edit Problem …" for that part.
  - The 6 stem and the number open 6a; problem 7 opens 7.
  - A student's click on 6b goes to `q/5`.
- **Gates:** app-tsc, tools-tsc, app-build, app-check, server-tsc and server-check all exited 0.
