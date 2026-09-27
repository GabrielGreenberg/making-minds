---
id: 2026-09-26-065
type: feature
title: Add the Grading tab — assignment list with progress, and each assignment's Overview and Matrix — and retire the old gradebook page into it
priority: high
size: large
requires: browser
area: app
source: chat
created: 2026-09-26T21:34:00-07:00
status: in-progress
after: 2026-09-26-064
branch: robot/065-grading-tab-overview-matrix
merged_into:
---

## Description
Filed from task 031's accepted design (Gabriel approved 2026-09-26, with its three proposed defaults). Authority: the memo `docs/buildout/designs/grading-interface.md` — its §3 table records every decision; read it before starting. Slice 5 of 11 (memo §12). HW1 is due Oct 4 and is returned about a week later, so slices 1–8 carry the schedule.

The surfaces of memo §6.1–§6.2, drawn in mockups 1–3
(`docs/buildout/designs/grading-interface/mockups.html`, screenshots
`tasks/attachments/2026-09-23-031-{1-grading-tab,2-overview,3-matrix}.png`).

## Done when
- Dashboard tabs: Assignments · **Grading** · Roster & accounts · Feedback · Notes
  (`InstructorLayout.tsx:11-20`). Routes `#/instructor/grading`,
  `#/instructor/grading/:asg[/matrix|/queue[/:qid]]`, `…/student/:sid`,
  `#/instructor/students/:sid` in `routing.ts` (public_id in every path, never an email/UID);
  `routingCheck` pins them and the redirect of `#/instructor/assignments/:id/submissions` →
  `#/instructor/grading/:id`.
- Grading tab (mockup 1): assignments with due, submitted / roster bar, autograde (current /
  n stale), hand grading bar, mean, released; HW7-style `countsTowardGrade: false` rows dimmed.
  The Needs-attention box and flagged list appear once 2026-09-26-070 lands (hidden until
  then).
- Overview (mockup 2): the four progress tiles, the stale banner (its Re-grade… button arrives
  in 069), the per-problem table; Export and Release actions (Release warns while pending).
- Matrix (mockup 3): roster rows, filter chips, section select, search, cells 1 / ½ / 0 / ✎ /
  ↻ / — with the human-grade underline and ⚑, late and grade columns, sticky name/grade; a row
  opens the student submission route (page built in 067 — until then it opens today's detail).
- The dashboard's "Submissions" button → "Grading", its column counts students submitted, not
  attempts (`InstructorDashboard.tsx:26-29`). `GradebookView` is deleted.
- New idioms (progress bar, matrix cell, filter chip) join `theme.css`/`pages.css` in tokens
  only; `themeCheck` green; `docs/buildout/VISUAL_VOCAB.md` §Page surfaces names them.

## Design
- **deepFix:** every view renders the 064 summary; no view computes a grade.
- Pointers: `instructor/InstructorApp.tsx:30-42`, `InstructorLayout.tsx`,
  `InstructorDashboard.tsx:184-189`, `GradebookView.tsx` (to retire), `routing.ts:26-32`,
  `useInstructorRoute.ts`, `theme.css`, `pages.css`; the mockup's `gr-*` CSS is the starting
  point.

## Verify
Gates; browser against local mode with HW1–HW7 loaded and the sample submissions: each
screen matches its mockup; screenshots into the progress log.

## Progress log
