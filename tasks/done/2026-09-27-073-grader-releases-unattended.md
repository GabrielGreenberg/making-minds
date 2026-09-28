---
id: 2026-09-27-073
type: chore
title: Let the robot release grading changes on its own — take the grader off the release gate's hold list
priority: high
size: small
requires:
area: pipeline
source: chat
created: 2026-09-27T17:22:00-07:00
status: done
after:
branch:
merged_into:
---

## Description
Gabriel, 2026-09-27 (in the 043 session on the robot): the robot should put its grading work
live on its own. Today every grading task (063–069, 047) touched `app/src/engine/`, which is
on the release gate's hold list, so each one waited for a hand release.

The line drawn: hold only what a bad release can't undo. A wrong grader is undone by a fix
and a re-grade (069 adds the re-grade), and the gates pin grading hard (parity, coverage,
the broken-machine banks). Answer keys reaching a student, a sign-in hole, a lost write
after a schema rollback, and the gate editing itself can't be undone — those stay held.

## Done when
1. `app/src/engine/` is off `HOLD_PATHS` in `deploy/release-gate.mjs`, with the reason in a
   comment; every other entry unchanged.
2. `server/tools/releaseGateCheck.ts` pins it: a change under `app/src/engine/` alone →
   `release`; the hold examples use a path still held.
3. `deploy/README.md`'s list of what the gate holds no longer says grading.
4. Landed, pushed, released by hand (the change is under `deploy/`, which stays held).

## Design
Data change in the one place the rules live (`HOLD_PATHS`); no new mechanism. The deadline
freeze (24 h before a due date), release hours and the CI rule still apply to grading
changes.

## Verify
Gates: the full PROFILE §6 table (the pin is `releaseGateCheck`, in `server/ npm run check`).

## Progress log
- 2026-09-27 17:22 — Minted and claimed on the robot (Mac Studio), in the 043 session with
  Gabriel, who asked for the change to be made here. The robot's run lock is held for the
  duration, so no work run shares the clone.
- 2026-09-27 17:25 — Landed. `app/src/engine/` is off `HOLD_PATHS` (the reason in its doc
  comment); `releaseGateCheck` pins a grader-only change → `release`, and its hold examples
  (the verdict, the note key, the test repo in [facts]) moved to `server/src/sanitize.ts`;
  `deploy/README.md` updated. Gates, full PROFILE §6 table, by exit code: app tsc, build,
  `npm run check`; server `npm run check` — all 0. Released by hand from the robot after
  the merge (this change is under `deploy/`, which stays held).
