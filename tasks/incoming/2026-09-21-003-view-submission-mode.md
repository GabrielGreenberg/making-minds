---
id: 2026-09-21-003
type: feature
title: Let a student view a submitted snapshot read-only at any time, not only once past due
priority: normal
size: unknown
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
The frozen read-only view of the actually-submitted circuit (`frozenQuestionCircuit`,
`selectAssignmentFrozen`, `dueDates.ts isFrozen`) only applies once the due date has passed
AND a submission exists. Grades can be released earlier, and the grade sheet's "Open my
submission" link then lands on the live workbook, which may have diverged.

## Done when
- A student can open "submission N" read-only (Run/Step live, edits refused) from the grade
  sheet regardless of due date, and return to their live workbook.
- Freezing keeps its current semantics (past due + submitted = locked to the submission).

## Design
- **deepFix (recommended):** generalise the frozen path into a store "viewing submission"
  mode (`viewingSubmission: attempt | null`), with the due-date freeze becoming one trigger
  that forces it on. The lock stays in `isCurrentQuestionLocked`. Autosave already refuses
  to write while frozen; reuse that guard.
- **surgicalFix:** a second read-only route that mounts the same components.
- Open decision for Gabriel at claim time: can a student switch back to the live workbook
  while frozen (probably not), and which attempt does the link open (latest, or the graded one).

## Verify
Extend `navResetCheck`'s `[frozen assignment]` section with the non-frozen viewing case.

## Progress log
