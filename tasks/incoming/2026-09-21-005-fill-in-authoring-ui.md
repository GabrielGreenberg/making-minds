---
id: 2026-09-21-005
type: feature
title: Author fill-in-the-blank questions in the question creator
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
Fill-in questions (an open question carrying a `fill_in` spec + a separate `fill_in_answers`
key; graded by `engine/fillIn.ts`) have no authoring UI — HW1 P11 is hand-written in
`app/src/devData/homeworks/hw1.json` (`notes/pset_updates.md` item 10).

## Done when
- `QuestionCreator` can create/edit a fill-in question: labelled blanks (add/remove/reorder),
  digits-only toggle per blank, the answer per blank; round-trips through save/load.
- The server still strips `fill_in_answers` for students (parityCheck pin unchanged).

## Design
- The open-question branch of `instructor/QuestionCreator.tsx` gains a "Fill-in blanks"
  toggle; the type shapes already exist in `types.ts`.
- **deepFix:** treat fill-in as its own `buildMode`-adjacent task kind the way perception is
  a "Task" toggle on CC/SC — one place decides the student panel (`FillInPanel`) and the
  grader branch; today both key off the presence of `fill_in`.
- **surgicalFix:** just the form fields.

## Verify
`pipelineCheck` (author → save → student payload stripped → submit → graded), tsc.

## Progress log
