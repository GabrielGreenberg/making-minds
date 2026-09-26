---
id: 2026-09-25-046
type: feature
title: Make HW1 release-ready — a box per part, autograded parts where the answer is exact, typable symbols, a prominent schematic, and an overview that doesn't clip wide tables
priority: urgent
size: large
requires: browser
area: app
source: audit
created: 2026-09-25T10:35:00-07:00
status: done
after: 2026-09-25-044
branch:
merged_into:
---

## Description
From the HW1 release audit (2026-09-25) and Gabriel's answers in chat. Gabriel wants to
release HW1 today. The goal: as much as possible script-graded; everything else in fields an
LLM can grade (one part per box); fields that suit the answer (a table gets a table).

Findings, each checked in local mode as a student:
- P6, P9, P10, P13 have parts a/b/c but ONE textarea (`OpenResponsePanel`).
- P9b asks for a table and gets a blank textarea.
- P6c ("how many places") and P13's sums have exact answers but are free text.
- P14/P15 need the symbols ○ and ●, which students can't type, and pasting them from the
  statement is refused by design (`provenance.ts` header, Gabriel's decision 2026-09-23).
- P12's invented symbols have the same problem.
- P15's hint says "a 2-place representational system"; it should say 3-place.
- P8 "two possible definitions" is ambiguous. `s(s(a(x,y)))` and `a(s(x),s(y))` define the
  same function; Gabriel wants two different functions.
- P16/P17's schematic is a small section aside, collapsed inside "Notes for this section" on
  the canvas screen. Nothing says which canvas wire is I, O₁, O₂.
- The Challenge problem has no answer field.
- The overview clips P3/P5's 4-column tables (202px in a 184px track;
  `app/src/pages.css:117`).

## Done when
1. `hw1.json` splits the multi-part problems into lettered questions (`problemNumber` renders
   "Problem 6a"):
   - 6a, 6b text; 6c fill-in "3"
   - 9a text; 9b a 3×3 fill-in `j(0, 0)`…`j(2, 2)`
   - 10a, 10b, 10c text
   - 13a, 13b fill-ins `10000`, `100100`, with "show your work" dropped
   
   Unchanged problems keep their ids; the parts are in PDF order.
2. Content:
   - P5 points at reusing P4's boxed XOR.
   - P8 asks for two different functions, with `p(⋅)` notation.
   - P9 uses `j(⋅)` and "between 0 and 2, inclusive".
   - P10b/c say the two definitions differ in form, define the same function, and a table
     counts.
   - P11's boxes are labelled zero…ten.
   - P12 says "any characters you can type, not 0–9".
   - P14/P15 use the typable symbols `@` (zero) and `#` (one), called "marks". P14 is a fill-in
     `f(@)`, `f(#)`. P15's hint says 3-place.
   - P16/P17 each carry the schematic as a problem figure, visible on the canvas screen, and
     say that I is IN1, O₁ is OUT1, O₂ is OUT2.
   - The Challenge problem is marked optional and not collected.
3. The overview's problem grid never clips a table (fixed in CSS, not per problem).
4. `statementFormatCheck` and all gates green. Every HW1 screen screenshotted at 1280 (and
   the overview at 700) into `tasks/attachments/2026-09-25-046-*.png`.

## Design
Content goes in the repo JSON (the source; the release sync refreshes a pristine pilot copy).
Splitting into lettered questions is today's JSON-only answer; the real fix is multi-part
questions (task 048). Numeric ids: parts after the first get fresh ids (18+); the first part
keeps the problem's id.

### Resolved decisions (Gabriel, 2026-09-25)
Keep P3 (circuit practice). Keep P7. P8 must ask for different functions. Drop P13's "show
your work". Split multi-part problems. No per-problem MEM configuration (task 045 fixes it by
mode). Pick better symbols for P14/P15; the hint's "2-place" becomes 3-place. Make the P16/P17
schematic more prominent.

## Verify
`statementFormatCheck` (every HW + figures valid), `pipelineCheck`, `coverageCheck`, all gates.
Browser or `tools/shootProblemSets.mjs`: the overview and all 23 screens.

## Progress log
- 2026-09-25 — claimed after 044 landed; worked in the worktree `.claude/worktrees/hw1-release`. Next: apply the scripted hw1.json + sample-submission rewrite, the overview grid CSS, then screenshots.
- 2026-09-25 — built and landed. `hw1.json` rewritten by a script (the file's own JSON
  format, so the diff is only real changes): 23 questions — 6a/6b text + 6c fill-in "3"; 9a text +
  9b nine blanks j(0, 0)…j(2, 2); 10a/b/c text; 13a/13b fill-ins (10000, 100100), "show your work"
  dropped; P14 fill-in f(@)/f(#); P15 "marks" @/#, hint "3-place"; P8 "two different functions";
  P9 j(⋅), "between 0 and 2, inclusive"; P10b/c say what "different" means; P11 labels zero…ten;
  P12 typable symbols; P5 hint to reuse the boxed XOR; P16/P17 carry the schematic as a problem
  figure (the SVG redrawn at 210pt, capped 280px) plus "On the canvas, I is IN1, O₁ is OUT1 and O₂
  is OUT2"; the section IV figure removed; the challenge box titled "Challenge problem (optional,
  not collected)". Ids: unchanged problems keep theirs; parts after the first take 18–23. The seeded
  sample submissions follow (alice's answers split into parts, her base-6 symbols typable; bob
  gets two wrong fill-ins). Overview grid (`pages.css`): a flex row of cells each `min-content`
  wide (≥ 205px) with an `auto` body column and `min-width: auto` body — a `1fr` track or a
  `min-width: 0` body counts as zero in a min-content size, which is why the first attempt still
  clipped; P3/P5 cells now 247px, nothing clipped at 1280/700/375, no page scroll at 375. Pins
  moved with the content: `pipelineCheck` (P11 word labels; the creator's "next number" rule keeps
  its 0–10 → "11" pin on a numbered copy), `statementFormatCheck` (no HW statement splits into
  parts now). Screenshots: `tasks/attachments/2026-09-25-046-*.png`. Gates: tsc ×2,
  `npm run check`, build, server check — all green. Code commit 279acc6.
