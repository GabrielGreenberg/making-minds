---
id: 2026-09-21-009
type: other
title: Review the transcribed open-question statements, especially HW4 P1–P2
priority: normal
size: small
requires: human
area: docs
source: claude-md
created: 2026-09-21T15:30:00-07:00
status: blocked
after:
branch:
merged_into:
---

## Description
The 28 prose problems in `app/src/devData/homeworks/hw*.json` were transcribed from the PDFs.
HW4 P1–P2 reference circuit diagrams that exist only in the PDF, so their statements describe
the drawn machines in words and point at the handout. Gabriel's content review is pending.

## Done when
Gabriel has read them and either corrected the JSON (or dictated corrections to `/catch`) or
said "reviewed".

## Design
Not a code task. If corrections come in, they're one edit to the JSON + `statementFormatCheck`.
Note (catch 2026-09-21): task 2026-09-21-020 re-transcribes HW1–HW7 to the PDFs' structure
and restores the HW4 P1–P2 diagrams as figures, so the worded descriptions become captions;
this review then matters for the transcription, not the layout.

## Verify
`statementFormatCheck` still parses every statement.

## Questions
1. Please read HW4 P1 and P2 in `hw4.json` (search `"hw4-p1"`, `"hw4-p2"`). Do the worded
   descriptions of the diagrams match the PDF? Give corrections, or say "reviewed".

## Progress log

_2026-09-22 (task 020):_ HW4 P1–P2 now show the PDF's own diagrams (SVG crops,
`app/public/problem-sets/hw4-state-abstraction.svg`, `hw4-multiple-realizability.svg`) and
the statements follow the PDF text; the worded descriptions survive only as the figures'
alt text. The review is now just: does each alt text describe its diagram correctly?
