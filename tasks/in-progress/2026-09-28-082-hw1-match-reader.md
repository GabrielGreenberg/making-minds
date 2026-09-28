---
id: 2026-09-28-082
type: chore
title: Bring the app's HW1 wording up to date with the reader's revised HW1 (makingminds.org book, pp. 181–182)
priority: normal
size: small
requires:
area: app
source: chat
created: 2026-09-28T11:20:00-07:00
status: in-progress
after:
branch: task/082-hw1-match-reader
merged_into:
---

## Description
Gabriel (2026-09-28, chat): "i've modified the textbook's wording of a few problems in HW1. i'd
like you to update the current in-app HW1 to match the reader (see the official pdf or reader)."

The reader is the published book, `https://www.makingminds.org/book/making-minds.pdf` (local copy:
the MM publish folder's `MM.pdf`, build 20260928-175445). HW1 is on pp. 181–182. Task 051 carried
the app's HW1 changes into the deck. Gabriel has since rewritten more (against the 2026-09-24
build):
- **P6a** — "Define the function in English, with no mathematical symbolism, using the terms
  “function”, “argument”, “value”, “apply”, and “return” correctly."
- **P6b** — no comma before "using the phrase".
- **P8** — "the 1-place **successor function**", "the 2-place **addition function**"; "Given
  that" (not "Given only that"); "different" no longer italic.
- **P10** — the "opposites" clause is gone. a/b/c each ask for one equation defining a 1-place
  Boolean function: (a) maps 1’s to 0’s and 0’s to 1’s; (b) the identity function; (c) a
  constant function. That drops "two different definitions" and the app's added "written
  differently but define the same function" sentences.
- **P14** — "Use a table or an equation."
- **P15** — "Let’s call these symbols “marks”. A mark is either @ or #."
- **Challenge problem** — "(optional)".
- **P16/P17** — "Consider a machine M which takes as input a single atomic symbol I, and produces
  two-place symbol O₁O₂ as output (in the form of two atomic symbols O₁ and O₂), such that, for
  any input, successor(tal(I)) = tal(O₁O₂). For example, 1 → M → 11." (N: bin, 1 → N → 10).
  Both now end "with the schematic form below."

## Done when
1. Every HW1 statement, section intro and callout reads as the reader does, word for word and
   with the reader's bold and italics. The only exceptions are the app-only adaptations task 051
   recorded: the lettered parts (6a–c, 9a–b, 10a–c, 13a–b) and the back-references they need
   ("from 6a"); P9b's, P11's and P13a's fill-in instructions; P12's typable symbols; P16/P17's
   canvas mapping. One more joins them: P14 keeps its value boxes, with a line saying what
   goes in them.
2. No answer format, test bank or grading field changes.
3. `workbenchCheck`'s pin on the challenge title follows the new title.
4. Gates green.

## Design
Content only: `app/src/devData/homeworks/hw1.json` (statements + the challenge callout's title),
the pin in `app/tools/workbenchCheck.ts`, and the comment quoting the title in `app/src/workbench.ts`.
The release's homework sync refreshes an unedited pilot copy (content hash changes; `order`,
`dueDate` etc. are instructor-owned and untouched).

Related queue: 079 (P14/P9b table answers) and 048 (multi-part questions; its audit named "HW1 8,
10b, 10c, 12" as multi-answer prose). P10b/c now ask for one equation each, so they drop off that list.

## Verify
`npx tsx tools/statementFormatCheck.ts` + `workbenchCheck.ts` (every HW parses and validates), both
`tsc`s, `npm run check`, server `npm run check` (homeworkSyncCheck). Eyeball: the HW1 overview and
the P10/P16 editor panels in the dev server.

## Progress log
- 2026-09-28 — Filed and claimed from chat. Diffed the reader's HW1 (builds 20260924 → 20260928)
  and the app's `hw1.json`. Next: edit on `task/082-hw1-match-reader`.
