---
id: 2026-09-25-045
type: bug
title: A combinatorial-circuit canvas never offers or accepts a memory (MEM) block
priority: urgent
size: large
requires: browser
area: app
source: audit
created: 2026-09-25T10:35:00-07:00
status: ready
after:
branch:
merged_into:
---

## Description
From the HW1 release audit (2026-09-25). Every CC question — and every CC turbot brain and CC
perception question — shows a "Memory" section with MEM in its palette:
`app/src/components/ComponentLibrary.tsx` uses one `CC_LIBRARY_ITEMS` list (MEM included) for
CC and SC alike, filtered only by the question's `allowed_components`. The grader runs a MEM
as a constant 0 (`caseRun.gradingCircuit`), so in HW1 P16 `NOT(MEM)` passes as the constant 1
the problem needs. Gabriel (2026-09-25): "all of these problems should be combinatorial
circuits — not sequential circuits — so the MEM should automatically not show up, and we
shouldn't have to do anything bespoke for specific problems here."

Boxes already follow the right rule: `types.ts placeableBoxKinds` lets a sequential box (one
holding a MEM) onto SC canvases and the sandbox's Logic Circuit tab only, and `store.paste`
refuses a sequential box on a CC canvas. A bare MEM slips past all of it — the palette,
`addComponent`, `paste` and Stage 1.

## Done when
1. One rule: a canvas may hold memory iff it may place a sequential box
   (`placeableBoxKinds(mode)` includes `'SC'`; the sandbox's Logic Circuit tab keeps both).
2. On every canvas without memory: the palette hides MEM, `addComponent('MEM')` refuses, and a
   paste carrying a MEM (bare or inside a box) is refused with a plain message.
3. Stage 1 (`caseRun.questionComponentRules`, the head of every grading branch) refuses a CC
   machine — buildMode CC, a turbot's CC brain, CC perception — that holds a MEM at any
   depth, with a plain reason.
4. Pins for the selector, placement, paste and the grader; all gates green.
5. No per-question configuration is needed for it: HW1 keeps `allowed_components` only where
   the problem itself restricts gates (P2 no OR; P4).

## Design
- **deepFix (chosen):** derive "may hold memory" from the existing box-kind rule, so the
  palette, the store, the paste seam and the grader all ask one function.
- **surgicalFix (rejected by Gabriel):** `allowed_components` on each HW1 CC problem.

## Verify
Gates plus the new pins. Browser: an HW1 CC question's palette has no Memory section; an HW3
SC question's and the sandbox's still do.

## Progress log
