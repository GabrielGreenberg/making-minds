---
id: 2026-09-26-067
type: feature
title: Show one student's submission to an instructor — full autograde detail, overrides, and the submitted machine in the read-only viewer
priority: high
size: large
requires: browser
area: app
source: chat
created: 2026-09-26T21:34:00-07:00
status: in-progress
after: 2026-09-26-065
branch: robot/067-instructor-submission-page-and-viewer
merged_into:
---

## Description
Filed from task 031's accepted design (Gabriel approved 2026-09-26, with its three proposed defaults). Authority: the memo `docs/buildout/designs/grading-interface.md` — its §3 table records every decision; read it before starting. Slice 7 of 11 (memo §12). HW1 is due Oct 4 and is returned about a week later, so slices 1–8 carry the schedule.

The instructor never sees a student's actual machine today — only failed-case tables
(memo F6, §6.3; mockup 5, `tasks/attachments/2026-09-23-031-5-submission.png`). Task 003 built
a read-only viewer for a student's OWN attempts; this generalises it.

## Done when
- `#/instructor/grading/:asg/student/:sid`: header (name, UID, section, account; counting
  attempt + older attempts read-only; submitted, late units and deduction; group members;
  integrity summary; previous/next student in matrix order), then every problem: full
  autograde incl. expected/got, the ½ rule's count, **Run this input**, and the points control
  (0 · ½ · 1, a required note on an override, Clear).
- **Open in viewer**: `store.ts viewSubmission` accepts a fetched record (from the 064 attempt
  detail) instead of reading `listOwn`; in that mode it never opens, folds or saves the
  instructor's own workbook, frozen logic ignores the instructor's submissions, and the lock
  message names the student. Run/Step work; edits refused (`isCurrentQuestionLocked`).
  `loadCaseInput` replays a case unchanged.
- Pinned: `navResetCheck` (viewing another's attempt never touches the viewer's workbook;
  leaving resets), `caseRunCheck` replay from a fetched record.

## Design
- **deepFix:** one viewer for "a submitted attempt", whoever owns it; ownership decides only
  where the record comes from.
- Pointers: `store.ts:2617-2677` `viewSubmission`, `:2635-2643` (listOwn), `:2658-2667`
  (own workbook), `:5202` (lock message), `:5223` `submittedQuestionCircuit`, `:4882`
  `loadCaseInput`, `routing.ts:74-82, 253-273`.

## Verify
Gates; browser: open a toy student's CC and turbot answers read-only, Run a failed case,
override ½ with a note, see it in the matrix.

## Progress log
