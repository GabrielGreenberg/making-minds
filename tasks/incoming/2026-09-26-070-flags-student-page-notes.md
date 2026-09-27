---
id: 2026-09-26-070
type: feature
title: Flag students who need attention, and give each student an instructor page with private notes and grade history
priority: normal
size: large
requires: browser
area: app
source: chat
created: 2026-09-26T21:34:00-07:00
status: ready
after: 2026-09-26-068
branch:
merged_into:
---

## Description
Filed from task 031's accepted design (Gabriel approved 2026-09-26, with its three proposed defaults). Authority: the memo `docs/buildout/designs/grading-interface.md` — its §3 table records every decision; read it before starting. Slice 10 of 11 (memo §12). HW1 is due Oct 4 and is returned about a week later, so slices 1–8 carry the schedule.

Memo §6.5, §8; mockups 1 (Needs attention) and 6
(`tasks/attachments/2026-09-23-031-6-student.png`).

## Done when
- Flags (prompts, never verdicts), thresholds in `course_settings.flagThresholds` (Settings
  on the Grading tab): not submitted by the effective due date; > 14 days late; final < 70 on
  two consecutive counted sets; no account 7 days after the first meeting; group mismatch
  (a listed member doesn't list back once both submitted or the due date passed; group > 3);
  integrity (`SubmissionIntegrity.flagged > 0`, now counted per row) + identical
  open-response text across students (annotated "same group" when a reciprocal group
  explains it).
- The Grading tab's Needs-attention box and flagged list; ⚑ on matrix rows.
- `#/instructor/students/:sid` (from the matrix, Roster & accounts, flags): identity, flags,
  per-assignment rows, average of counted sets so far, **private notes** (`student_notes`,
  dated, append-only, instructors only, P4 placeholder), grade history from `grade_events`,
  extensions.
- Pinned: each flag rule on fixtures; notes never reach a student payload
  (`sanitize`/`gradingCheck`).

## Design
- **deepFix:** flags are pure functions over the 064 summaries + settings; no flag stores
  state.
- Pointers: `provenance/integrity.ts:332`, `types.ts:538-570`, `instructor/RosterView.tsx`.

## Verify
Gates; browser: each flag shows on a toy fixture; a note added appears only to
instructors.

## Progress log
