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
status: in-progress
after: 2026-09-26-065
branch: robot/069-regrade-dry-run
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
- Pinned (green): `server/tools/gradingCheck.ts` [regrade] + [regrade local];
  `app/tools/gradingViewCheck.ts` [regrade dialog] + the no-view-grades gate over
  `RegradeDialog.tsx`; `app/tools/remoteStoreCheck.ts` (the seam's dry run / conflict / null).
- **Owed (browser, not claimed):** the unattended run could not start a dev server. Recipe:
  Robot Dev Server (local mode) → Dashboard → Load HW1–HW7, submit HW1 as a toy student →
  as the instructor edit one machine question's bank in the question creator and save →
  Grading → HW1 → Overview shows the stale banner with **Re-grade…** → the modal lists the
  changes (Student · Problem · Autograde a → b · Grade g → g′, or the override tag) and the
  summary line → Commit re-grade → Done names `mm:regrade-snapshot:<id>`; the banner is gone.
- **Owed (box):** the first committed re-grade on the pilot writes
  `/srv/making-minds/backups/regrade/regrade-<id>-….sqlite` (mode 600) — check with `sudo ls -l`.

## Progress log
- 2026-09-27 (robot, implement): GradeEvent → union (GradeChangeEvent | RegradeEvent). Pure
  planner `app/src/storage/regrade.ts` (`planRegrade` + `regradeEvents`; stale = the summary's
  own test, so banner count = plan's). Server: `POST /api/assignments/:id/regrade` (sync
  handler; plan recomputed on commit; 409 + fresh plan on `expectHash` mismatch; no-op when
  nothing stale; `server/src/snapshot.ts` VACUUM INTO → `backups/regrade`, `MM_SNAPSHOT_DIR`,
  keep 20; one transaction: `updateSubmissionResult` (+hash) and one `regrade` event per
  change). Seam: `GradingStore.regrade` (local: `rewriteResults` + `mm:regrade-snapshot:<id>`;
  remote: `postRegrade`). UI: `RegradeDialog.tsx` from the Overview banner's Re-grade….
  Docs: CLAUDE.md in place, deploy/README.md backups table.

### 2026-09-27 — implemented (work loop)
- **Built:** an instructor can re-grade an assignment's stale submissions after editing a
  question. The Overview's stale banner has **Re-grade…**, which shows a dry run (who changes,
  which problem, autograde before → after, grade before → after, "under your override");
  **Commit re-grade** is a second click. The server snapshots the DB first (`VACUUM INTO`
  `backups/regrade`, `MM_SNAPSHOT_DIR`, keep 20), then rewrites only `result` +
  `assignment_hash` of stale latest attempts and logs one `regrade` event per changed
  problem; human grades are never touched. One pure planner (`app/src/storage/regrade.ts`)
  serves local store and server.
- **Pins:** `server/tools/gradingCheck.ts` [regrade] (dry run writes nothing; 403/404/400;
  409 + fresh plan on stale `expectHash`; commit changes only stale latest attempts; grades
  table byte-identical; override flagged; second commit no-op; write path touches only
  result + hash) + [regrade local] (local ≡ server dry run); `app/tools/gradingViewCheck.ts`
  [regrade dialog] + no-view-grades gate over `RegradeDialog.tsx`; `remoteStoreCheck.ts`
  seam dry run / conflict / null.
- **Gates:** app-tsc 0, app-build 0, app-check 0, server-tsc 0, server-check 0.
- **Review:** no findings fixed or skipped. Nit left: the CLAUDE.md budget trim dropped two
  unrelated Grades-sheet phrases ("which case failed and why", "recorded vs live verdict").
- **Remains (owed):** browser check in local mode (banner → dry-run modal → commit; override
  label; 375px modal scroll) and remote mode (snapshot file in `MM_SNAPSHOT_DIR`; dry-run
  then commit POSTs); on the box after release, Gabriel checks
  `/srv/making-minds/backups/regrade` (makingminds, mode 600).
- **NEXT STEP:** loop session: visual check if owed, then land per PROFILE §5.
- 2026-09-27 (robot): parked for the owed eyeball. Code complete on `robot/069-regrade-dry-run` (3343211), all five gates green by exit code, review clean. The unattended run can't start a dev server (the harness refuses `preview_start` in scheduled runs), so the `requires: browser` check wasn't done. Recipe: the workflow's owedChecks — local mode: instructor loads HW, publishes; student submits a machine answer; instructor edits that question's bank; Grading → Overview banner → Re-grade… → dry-run table (student, Pn, before → after, grade) → Cancel keeps banner; Commit re-grade → banner gone, Matrix updated; an overridden problem shows "under your override"; 375px: modal table scrolls. Remote mode with `MM_SNAPSHOT_DIR` set: snapshot file appears. After release (ssh): `sudo ls -l /srv/making-minds/backups/regrade`. Nit left alone: the CLAUDE.md trim (to fit 40 KB) dropped "which case failed and why" / "recorded vs live verdict" from the Grades-sheet line.
