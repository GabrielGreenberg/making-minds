---
id: 2026-09-25-042
type: feature
title: Release guardrails for unattended releases — a hold list, quiet hours, a deadline freeze, and a one-line note to Gabriel per release
priority: high
size: large
requires: ssh, human
area: deploy
source: chat
created: 2026-09-25T10:00:00-07:00
status: ready
after: 2026-09-25-041
branch:
merged_into:
---

## Description
Gabriel (2026-09-25, `/work`): the robot pipeline (029) goes **straight to release**, given
the pace of production and the focus on the class. `deploy/release.sh` releases whatever is
on `main` whenever it is run; that is right for a human, not for an hourly routine. This task
makes a release safe to run unattended. It is also useful by hand, as a `--check` that says
"would release / would hold, and why".

## Done when
1. **One decision point:** `deploy/release-gate.mjs` (pure logic + thin I/O) answers
   `release | hold | wait` with reasons, and `release.sh --unattended` runs it first and obeys
   it (exit status distinguishes the three). Run by hand, `release.sh` is unchanged
   (`--unattended` is opt-in); `release.sh --check` prints the verdict without releasing.
2. **Hold list (deterministic, from the diff, never the model's judgment):** if the commits
   since the last released one (the box's `HEAD`, the site's served build) touch any of
   `app/src/engine/`, `app/src/devData/homeworks/`, `server/src/sanitize.ts`,
   `server/src/auth.ts`, `server/src/password.ts`, `server/src/db.ts`, `app/src/auth/`,
   `deploy/` → **hold**: land and push happen, the release does not, and Gabriel is told what
   is waiting and why. The list lives in one constant with a comment per entry. Gabriel's
   explicit "release" (a hand run) is the override.
3. **Quiet hours:** no unattended release outside **07:00–22:00 Pacific** → **wait** (the next
   run in the window releases everything pending).
4. **Deadline freeze:** no unattended release within **24 h before** a published
   assignment's due date → **wait**. Due dates come from the pilot API (instructor sign-in,
   `secrets/feedback.env`, the same helper `tasks/tools/feedback.mjs` uses), because the
   instructor sets them in the dashboard, not in the repo. The API unreachable → **wait**
   (never release blind).
5. **Backups present:** 041's daily backup timer must exist on the box → otherwise **hold**.
6. **A note per outcome:** every unattended release sends Gabriel one line (what shipped: task
   ids + titles, the commit); every hold sends one line (what is waiting, which rule). Channel
   decided at build (the desktop app's push notification is the default; an email via the
   Gmail connector needs a standing approval) and written into the routine.
7. **After the release:** the existing proof (API health + the site serves the build) plus a
   smoke check that the sign-in page renders; on failure, the note says so loudly and names
   the previous good commit to go back to. (Automatic rollback is a follow-up, not this task.)
8. **Gates:** a headless check (`deploy/tools/releaseGateCheck.mjs`, or under `server/tools/`
   if it needs the TS toolchain) pins the verdict table: a hold-list path → hold; out of hours
   → wait; 23 h before a due date → wait; 25 h → release; API down → wait; no backup timer →
   hold; several rules at once → the strictest wins (hold > wait > release). Wired into CI or
   a package `check`.

## Design
- **deepFix (chosen):** one gate, pure and pinned, in front of the one release procedure;
  the rules are data (paths, hours, freeze window) with the reasons printed. The robot never
  decides whether something is risky; the diff does.
- **surgicalFix:** ask the routine prompt to "avoid risky releases". Rejected: an unpinned
  judgment call, and exactly the wrong place to trust a model reading student-derived tasks.
- Defaults are Gabriel's to tune (hours, freeze length, list); record changes in
  `### Resolved decisions`.
- Pointers: `deploy/release.sh` (preflight, box step, site step, the `live:` proof at
  `:147`), `deploy/README.md` §0, `tasks/tools/feedback.mjs` (`readEnv`, `withSession` — move
  them to a shared module rather than copying).

### Resolved decisions (Gabriel, 2026-09-25)
1. Unattended releases, yes: the pipeline goes straight to release.
2. With: backups first (041), quiet hours, a deadline freeze, a hold list for grading /
   answer keys / sign-in / database, and a one-line note per release. The defaults above are
   Claude's proposal, accepted with "I like the whole plan".

## Verify
The gate check (item 8). By hand: `release.sh --check` on a commit touching
`app/src/engine/` → hold with the path named; on a docs-only commit at 23:00 → wait; the
same at 10:00 → release. One real unattended-mode release watched by Gabriel.

## Progress log
