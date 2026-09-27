---
id: 2026-09-26-069
type: feature
title: Re-grade an assignment against its current version — dry run first, then commit with a snapshot; never touching human grades
priority: normal
size: large
requires: browser
area: server
source: chat
created: 2026-09-26T21:34:00-07:00
status: ready
after: 2026-09-26-065
branch:
merged_into:
---

## Description
Filed from task 031's accepted design (Gabriel approved 2026-09-26, with its three proposed defaults). Authority: the memo `docs/buildout/designs/grading-interface.md` — its §3 table records every decision; read it before starting. Slice 9 of 11 (memo §12). HW1 is due Oct 4 and is returned about a week later, so slices 1–8 carry the schedule.

Results are graded once and go stale when content changes (the homework sync, the editor;
memo F2, §5; mockup 7, `tasks/attachments/2026-09-23-031-7-regrade.png`).

## Done when
- `POST /api/assignments/:id/regrade {dryRun}`: re-runs `gradeSubmission` on each student's
  latest attempt against the current assignment; the dry run returns changed (student,
  problem, before → after, "under an override"), unchanged, totals; commit first writes a DB
  snapshot (`VACUUM INTO` beside the daily backups), then rewrites `result` +
  `assignment_hash` and logs one `regrade` event per changed problem. Human grades untouched.
- Overview: the stale banner's **Re-grade…** opens the dry-run modal; Commit is a second click.
- Pinned in `gradingCheck`: dry run writes nothing; commit changes only stale latest attempts;
  grades table byte-identical before/after; override flagged when the autograde under it
  changes.

## Design
- **deepFix:** re-grade is safe because judgment is not in `result` (063) and staleness is
  explicit (`assignment_hash`).
- Pointers: `server/src/app.ts:581-620`, `homeworks.ts:108`, `deploy/README.md` (backups).

## Verify
Gates; browser on local mode: edit a toy question's bank, see the banner, dry-run, commit.

## Progress log
