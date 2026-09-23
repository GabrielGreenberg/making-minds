---
id: 2026-09-21-007
type: feature
title: Sync HW1–HW7 from the repo into the server database on every release
priority: high
size: large
requires:
area: server
source: claude-md
created: 2026-09-21T15:30:00-07:00
status: in-progress
after:
branch: task/007-homework-sync
merged_into:
---

## Description
HW1–HW7 exist as `AssignmentData` JSON in `app/src/devData/homeworks/hw{1..7}.json` and can
be seeded in local mode (dashboard "Load HW1–HW7" → `devData/homeworks.ts seedHomeworks`).
The server's `server/src/seed.ts` loads only the toy roster (+ the sample with `--sample`).

**Widened 2026-09-22 (Gabriel chose "option 2" after task 020 landed).** The pilot DB already
holds HW1–HW7 — uploaded 2026-09-14 by the one-time local→remote migration
(`storage/migrateLocal.ts`, fill-empty) — and every one of them is byte-identical, minus
`order`, to the repo's ORIGINAL 2026-07-12 commit (`ec5c1ac`). So the released task-020
renderer draws week-old text on the pilot (no sections, no figures, no PDF link), and the
grading is stale too: HW1 P11 is an open question there instead of the autograded fill-in,
HW2 P6 lacks `component_limits {BOXED: 1}`, HW6 P2 lacks `maxTapeCells: 20`. A plain
fill-empty seed would skip all seven. The class: **seeded homework copies never follow the
repo** — in remote mode (migration + any fill-empty seed) and in local mode (the dashboard
seed is fill-empty too; task 020's session had to delete local keys by hand to see its work).

## Done when
1. A pure planner (`app/src/devData/homeworkSync.ts`) decides per homework: **insert** (not on
   the target), **unchanged** (same content), **refresh** (the copy is pristine — equal to a
   known earlier version), **edited** (anything else: left alone and reported). Content is
   compared as canonical JSON minus the instructor-owned fields `order` and `dueDate`, which a
   refresh carries over. `--force` turns an edited copy into a refresh.
2. The server sync (`server/src/homeworks.ts`, CLI `npm run homeworks -- sync [--dry-run]
   [--force hw1,hw3]` and `-- status`) reads the repo JSON; a copy is pristine iff its hash is
   a committed version of its file (git lineage, computed on the box's clone) or a version the
   sync itself wrote (a `content_sync` table — covers shallow clones). Inserts are
   unpublished. Publish / release flags, submissions and workbooks are never touched.
3. `deploy/release.sh` runs the sync on the box after the pull and before the restart
   (and in the paste-by-hand fallback); `deploy/README.md` §0 says so.
4. Local mode's "Load HW1–HW7" uses the same planner, with a per-homework record of what it
   seeded, so an untouched local copy refreshes and an edited one is reported, not clobbered.
5. `server/tools/homeworkSyncCheck.ts` (in `npm run check`) pins: fresh DB → 7 unpublished
   inserts, a student lists none, a published one arrives with its answer keys stripped;
   re-sync → all unchanged, nothing written; a known older version → refreshed with `order`,
   `dueDate`, flags and submissions intact; an edited copy → skipped, `--force` replaces it;
   `--dry-run` writes nothing; git lineage degrades to the current file in a shallow clone.
6. Released: the pilot's seven copies refresh, and HW1 on https://making-minds.pages.dev shows
   the task-020 document (sections, figures, "Original PDF").

## Design
- **deepFix (chosen):** the repo is the source of homework content; a deployment's copy is a
  cache that refreshes whenever nobody has edited it, decided by content lineage, not by
  "does the id exist". One pure planner, two adapters (server: git lineage + `content_sync`;
  local: a localStorage record), and the release runs the server adapter every time, so a
  content improvement ships the way code does.
- **surgicalFix (rejected):** delete the seven pilot rows and fill-empty seed once. Loses the
  pilot's `order`, and goes stale again on the next content change.
- Seams: the sync writes through `Db.saveAssignment` (upsert updates `data` only, so the
  `student_visible` / `grades_released` columns survive); the student copy is still
  sanitized by `sanitize.ts`; no route, store or engine change. Evidence for lineage: every
  pilot copy matches `ec5c1ac` exactly once `order` is set aside (checked 2026-09-22).
- Pointers: `server/src/db.ts:488` (`saveAssignment`), `server/src/seed.ts`,
  `app/src/devData/homeworks.ts` (`seedHomeworks`), `instructor/InstructorDashboard.tsx:82`
  (the seed alert), `deploy/release.sh` (`BOX_SCRIPT`), `app/src/storage/migrateLocal.ts`.

## Verify
`app`: tsc, build, `npm run check`; `server`: typecheck + check (with the new tool).
Preview the plan against a read-only copy of the pilot DB before releasing; release; confirm
the pilot DB rows carry sections and the site renders them.

## Progress log
- 2026-09-22 — Widened from a fill-empty seed to a repo→deployment sync (see Description);
  claimed by the /work session on `task/007-homework-sync`.
