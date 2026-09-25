---
id: 2026-09-25-051
type: chore
title: Bring HW1 in the textbook deck (MM.key) up to date with the app's HW1 — handed to the MM class session
priority: normal
size: unknown
requires: human
area: docs
source: chat
created: 2026-09-25T15:30:00-07:00
status: done
after: 2026-09-25-050
branch:
merged_into:
---

## Description
Gabriel (2026-09-25): "update the pdf for its own sake — but don't link it." `problem sets/hw1.pdf`
(and its copy `app/public/problem-sets/hw1.pdf`) is the printed HW1 (textbook pp. 175–176, dated
9.30.25). After task 046 the app's HW1 differs in these ways:
- lettered parts 6a/6b/6c, 9a/9b, 10a/10b/10c, 13a/13b; P13 "show your work" dropped
- P8 asks for two definitions of *different* functions; notation p(⋅), j(⋅)
- P9: "between 0 and 2, inclusive"
- P10b/c say the two definitions differ in form but define the same function; a table counts
- P11 in words
- P12: typable symbols, not the digits 0–9
- P14/P15 use the marks "@" (zero) and "#" (one) in place of ○ and ●; P15's hint says 3-place
- P16/P17: the schematic beside each problem; "I is IN1, O₁ is OUT1 and O₂ is OUT2"
- P5 hint to reuse the boxed XOR
- Challenge problem marked optional

## Done when
The PDF says what the app says: from its source if the problem sets live in the textbook deck
(`MM.key`; see the making-minds-keynote skill), otherwise a faithful regeneration. Both repo copies
replaced. Gabriel approves the result.

## Design
First find the source: the page numbers 175–176 suggest HW1 is part of the textbook deck. Edit
the source rather than the PDF.

## Verify
Gabriel's look at the new PDF.

## Progress log
- 2026-09-25 — Gabriel: don't touch the PDF; the change belongs in the Keynote (MM.key), and his
  MM class session does that. This task's deliverable became the memo below, handed to him in
  chat. Nothing else to do in this repo: the repo PDFs stay as printed (unlinked since task 050);
  swap in a re-export later if wanted.

### Memo — HW1 changes for MM.key (pp. 175–176)
Print changes:
- P8: "p()" → "p(⋅)". After "provide two possible definitions of p(⋅)." add: "Your two
  definitions should define *different* functions: functions that agree on the arguments (1, 2)
  but disagree on some other arguments."
- P9: "j( )" → "j(⋅)"; "equal to or greater than 0, and equal to or less than two" → "between 0
  and 2, inclusive".
- P10b: add "The two definitions should be written differently but define the same function. A
  table counts as a definition." P10c: add "As in (b), the two definitions should be written
  differently but define the same function."
- P13: drop "show your work!" (keep "Use one of the methods of addition from the Petzold reading").
- P14/P15: the symbols ○/● become "@" (zero) and "#" (one); "dots" become "marks" ("a mark is
  either @ or #", "three marks in a row", "string of marks", "for any series of three marks x, y,
  z"); examples g(@, @, #) = one, g(@, #, @) = two.
- P15 hint: "between “●” and the number one" → "between “#” and the number one"; "a 2-place
  representational system" → "a 3-place representational system".
- P5 (optional): under the table, "You can box your XOR circuit from Problem 4 and reuse it here."
- Challenge problem: mark it "(optional)".
- P17: "Design a combinatorial circuit for machine N." → "…for machine N, with the same schematic
  form."
App-only (skip in print): the lettered parts 6a–c / 9a–b / 10a–c / 13a–b; P11's boxes labelled in
words; P12's "use characters you can type"; P16/P17's "On the canvas, I is IN1, O₁ is OUT1 and O₂
is OUT2"; the schematic repeated beside each problem.
Unchanged on purpose: P16's tal(01) = one is correct — the app was fixed to match the book (task 044).
