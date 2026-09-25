---
id: 2026-09-25-048
type: feature
title: Multi-part questions — one problem, parts of different kinds (line, paragraph, blanks, table), one Mark done
priority: normal
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

## Done when
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
Touches the answer model (`types.ts` `QuestionCircuit` responseText / fillAnswers), the
panels (`OpenResponsePanel` / `FillInPanel`), the problem-set document, the grader, the
gradebook and GradeSheet, the provenance seam (every new field wears `usePasteGuard`),
sanitize (answer keys per part) and the homework sync. Route through the seams.

## Verify
Gates; pins per part kind; browser.

## Progress log
