---
id: 2026-09-21-011
type: feature
title: Reset or flag a live run when the machine is edited mid-run (turbot and TM)
priority: normal
size: unknown
requires:
area: app
source: claude-md
created: 2026-09-21T15:30:00-07:00
status: in-progress
after:
branch: task/011-invalidate-run-on-edit
merged_into:
---

## Description
Editing the brain/table while an arena run or TM run is in progress leaves stale sim state
on screen; the student must Reset manually. Same gap in both modes (and possibly SC/FSM).

## Done when
One policy, applied in every mode: a structural edit during a run either resets the run to
t=1 or visibly marks it stale, and the harness pins it.

## Design
- **deepFix (recommended):** the mutating store actions already funnel through
  `isCurrentQuestionLocked`; add a sibling hook there — "an edit invalidates the live run" —
  that calls the existing `resetAllSimState()` (or a per-mode reset), so no component decides.
- **surgicalFix:** per-mode checks in the turbot and TM panels.
- Members: turbot arena stepping; TM tape run; check whether SC/FSM Run has the same leak.

## Verify
`navResetCheck` gets an `[edit during run]` section.

## Progress log
