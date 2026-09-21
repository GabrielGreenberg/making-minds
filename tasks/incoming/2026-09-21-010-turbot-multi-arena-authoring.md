---
id: 2026-09-21-010
type: feature
title: Author an arena family (several turbot_cases) in the question creator
priority: normal
size: large
requires:
area: app
source: claude-md
created: 2026-09-21T15:30:00-07:00
status: ready
after:
branch:
merged_into:
---

## Description
`turbot_cases` is already a LIST and grading requires every arena to pass (Mad Max-style
families have teeth since P4.2), but `QuestionCreator` authors exactly one arena; the
reference fixtures with families were built in code.

## Done when
- The creator shows the arena list (add / duplicate / remove / reorder), edits each with the
  existing arena editor (`instructor/arenaEditing.ts`, ≤ 30×30), each with its own
  criterion + max-steps; round-trips through save/load; the gradebook already lists per-arena.

## Design
Lift the single-arena state in `QuestionCreator.tsx` into an array with an active index;
the editor component is unchanged. **surgicalFix** is the same shape.

## Verify
tsc; `pipelineCheck` authoring path with a 2-arena question; browser eyeball owed.

## Progress log
