---
id: 2026-09-21-013
type: feature
title: Instructor-editable SC perception frame sequences and richer rules
priority: low
size: large
requires:
area: app
source: claude-md
created: 2026-09-21T15:30:00-07:00
status: ready
after: 2026-09-21-012
branch:
merged_into:
---

## Description
SC perception banks are a fixed deterministic battery (`buildPerceptionCases`); rules are
min-run / exact-run / pattern (CC) and change / upward motion (SC). Wanted: custom frame
sequences per question and rules for downward/any-direction motion and multi-object scenes.

## Done when
Instructor can add/edit frame sequences for an SC perception question; new rules exist with
generated banks; `perceptionCheck` covers them; the student panel from 012 plays them.

## Design
Undiagnosed. Rules live in `engine/perception.ts`; authoring in `QuestionCreator`.

## Verify
`perceptionCheck`, `pipelineCheck`.

## Progress log
