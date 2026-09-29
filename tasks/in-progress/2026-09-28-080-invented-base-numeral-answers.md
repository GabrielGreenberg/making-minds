---
id: 2026-09-28-080
type: feature
title: Autograde HW1 P12's invented base-6 system — a field per digit symbol, one for thirty-two, checked against the student's own symbols; fields sized to fit
priority: normal
size: large
requires:
area: app
source: feedback
created: 2026-09-28T10:58:00-07:00
status: in-progress
after: 2026-09-28-079
branch: robot/080-invented-base-numeral-answers
merged_into:
---

## Description
App Feedback report `fb-mulijraa-1lz9sd` (author-role: instructor, category: platform
design; context HW1, question 12). HW1 Problem 12 (id 12): invent a base-6 counting system
with new symbols for its six digits (not 0–9), list them with their meanings, then write
thirty-two in it. Today it is an **open** question (one textarea, pending manual review).
Gabriel wants it **machine-graded**, with:
- a field for each invented symbol, one per digit, labelled with its meaning;
- then a field for thirty-two written in that system;
- fields that are legible and sized for what goes in them (a symbol box is small, not a
  full-width line).

**Why today's fill-in can't do it.** Fill-in compares each blank to a fixed key string
(`app/src/engine/fillIn.ts` `gradeFillIn`, `fill_in_answers`). Here the right answer depends
on the student's own choices. Thirty-two = 5·6 + 2, so the correct numeral is *the student's
symbol for five followed by their symbol for two*. No fixed key exists. And every blank
renders the same size: `.wb-fill-grid` columns ≥ 160px, mono 16px
(`app/src/workbench.css:262–268`). Nothing sizes a blank to its content.

## Done when
1. P12 shows six symbol fields labelled by meaning (zero … five), then one field for
   thirty-two. Symbol fields are compact (a few characters wide) with a larger type size, so
   punctuation and emoji are legible. The numeral field is short. None is a full-width line.
2. Graded by rule, one case per field:
   - a **symbol** passes iff it is exactly one character (one grapheme, via `Intl.Segmenter`,
     so an emoji counts as one), is not a digit 0–9, and differs from the other five symbols;
   - the **numeral** passes iff, with whitespace removed, it equals the student's symbols
     spelling 32 in base 6 (symbol-for-5 then symbol-for-2), and those two symbols are
     themselves valid.
   An empty field fails. Result labels name the field ("symbol for five", "thirty-two"),
   never an expected string.
3. This is a new fill-in **shape** through 079's dispatch (`engine/fillIn.ts` the one reader),
   authored as data, not code special to P12: a base, the meaning labels, and the values
   to write (`[32]`). The creator authors it, or at least round-trips it untouched. The
   ½-rule case count comes from the shape (7 for P12).
4. P12 in `hw1.json` moves from open to this shape. Its statement stays, lightly edited only
   if the fields make a sentence wrong. `statementFormatCheck` accepts it.
5. Gates green, with pins as in Verify.

## Design
- **deepFix (recommended):** a rule-graded shape beside 079's table, e.g. `FillInSpec.numeral:
  { base: number; values: number[] }`. The shape's fields are `base` digit-symbol blanks (labels
  derived: "Symbol for zero" …) then one blank per value ("thirty-two in your system", from
  an authored label). `gradeFillIn` dispatches to a pure `gradeInventedNumeral`. It needs no
  secret key, since base and values are in the statement, so `fill_in_answers` stays empty
  for this shape. The grader's key-length guard (`engine/grader.ts` `gradeFillInQuestion`,
  `answers.length !== spec.labels.length` → skip) must go through the shape reader, or this
  question is skipped as "no answer key".
- **Field sizing, in general:** per-field width and type size come from the shape. Symbol →
  compact, numeral → short, a plain blank keeps today's default. An optional authored size
  hint lets existing blanks opt in later. Sizing can't come from the key, because the key is
  stripped in remote mode.
- **surgicalFix:** hard-code P12 in the grader. That breaks the engine's data-driven
  grading, so no.
- **Decision taken by default (Gabriel may overturn):** one character per symbol. The
  statement says "characters", and multi-character symbols would make a numeral ambiguous.
  Case matters ("a" ≠ "A"), since they are different characters. The field can also refuse a
  second character as you type, but the grader enforces the rule either way.
- **Law 8:** the new fields wear `usePasteGuard` like every fill-in box (`pasteCheck` gate).
- Content: the homework sync refreshes the unedited pilot copy. The pilot has only toy data,
  so no migration of old P12 open-text answers is owed. A saved `responseText` for P12 simply
  stops showing once the question is fill-in.

### Members
- `fb-mulijraa-1lz9sd` (instructor): HW1 P12 machine-graded, symbol fields + thirty-two
  field, legible and right-sized.

## Verify
- Pins in `pipelineCheck` (or a fill-in section of `caseRunCheck`): a valid set + the
  right numeral passes 7/7; a repeated symbol fails both copies; a digit symbol fails; a
  two-character symbol fails; the numeral in the wrong order (2 then 5) fails; whitespace
  inside the numeral is ignored; an emoji symbol counts as one character. Also `scoreCheck`
  (N = 7), `statementFormatCheck`, `pasteCheck`, and `server/ npm run check` (parity).
- Full gates.
- Eyeball (owed, not claimed): HW1 P12 in the editor. Six compact, legible symbol boxes and a
  short numeral box, as a worksheet, not a stretched grid.

## Progress log
