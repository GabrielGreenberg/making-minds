---
id: 2026-09-25-043
type: chore
title: Set up the robot on the always-on computer from tasks/START.md §"The robot", and watch its first chained runs
priority: high
size: small
requires: human
area: pipeline
source: chat
created: 2026-09-25T10:00:00-07:00
status: in-progress
after: 2026-09-22-029
branch:
merged_into:
---

## Description
The machine-local half of the robot pipeline (029): everything that cannot live in the repo.
Done ON the other computer (Gabriel's always-on Mac — the Mac Studio, to confirm), by a Claude
session there told "set up the robot using `tasks/START.md`", with Gabriel present for the
steps only he can do. **First, 029 must be released by hand** (`deploy/release.sh`
from the laptop): it changes `deploy/`, so the robot's gate holds it and everything after it.
Things only a real routine can show (029's dry run couldn't): the Workflow tool runs inside a
routine and the run waits for its background completion; the browser pane works there; a
push notification reaches the phone; `gh` is signed in for the gate's CI check.

## Done when
1. The recipe in `tasks/START.md` §"The robot" is followed end to end: the robot's two clones
   (`~/making-minds-robot` for work, with dependencies installed; `~/making-minds-robot-catch`
   for catch); the three private files copied by
   Gabriel by hand (never through git or a chat); `gh` signed in; the two scheduled tasks
   created in the Claude app with the robot copy as working folder; tool approvals granted
   once; the app set to stay open and the Mac never to sleep.
2. A watched first run: "Run now" on the catch routine → it pulls feedback, files/marks, and
   chains into the work routine → one task lands, is pushed, and 042's gate releases or
   holds it with a note to Gabriel.
3. After a day: the 017 probe on the robot's transcripts (starting context well under 100k,
   zero `compact_boundary` records, no `isApiErrorMessage` limit errors); no collision with
   a laptop session (no double claims, no rejected pushes left unresolved).
4. Anything the recipe got wrong is fixed in `tasks/START.md` (on the robot's copy, pushed).

## Design
Recipe-driven; nothing to design here. Why this is separate from 029: 029 must be able to
land from this laptop, and this part needs the other machine and Gabriel's hands.

## Verify
Items 2–3, recorded in the progress log.

## Progress log
- 2026-09-25 — Claimed on the robot (Gabriel's Mac Studio, Mac14,14, macOS 26.6.2), in a
  session with Gabriel. No code branch: this task's commits are `tasks/` files only, on `main`,
  pushed at once. Step 1 (tools): Node 22.23.2, git 2.50.1, `gh` 2.88.1 signed in as
  GabrielGreenberg over HTTPS with `gh auth setup-git` already in place. Step 2 (clones):
  `~/making-minds-robot` and `~/making-minds-robot-catch` cloned, each with
  `user.name "Gabriel Greenberg (robot)"` / `user.email gabriel.greenberg@gmail.com` (the
  laptop's current commit email); `npm ci` done in the work clone's `app/` and `server/`.
- 2026-09-25 22:35 — Steps 3–6 done. (3) Gabriel sent the private files as one zip; unzipped
  into both clones, `chmod 600` (dirs 700), all gitignored — never opened, never in git or a
  chat. (4) `.claude/launch.json` "Robot Dev Server": `npm run dev --prefix app -- --port 5190
  --strictPort`, port 5190 — the explicit flags pin the port whatever the launcher exports;
  served (302 → `/making-minds/`). Note: the browser pane reads `launch.json` from the
  session's starting folder, so a session started elsewhere can't `preview_start` it; the work
  routine starts in the clone. (5) catch: `feedback.mjs list --review` → 0 review reports (the
  server has 029's review filter). work: `release.sh --check` → HOLD on 7908005, box runs
  7a7ca33 (029 and 042 are in it, so 029 was released by hand) — held for sign-in (040 pending)
  and quiet hours; ssh + pilot API answer. `npm run check` green in `server/` and `app/`.
  (6) Routines created by Gabriel in the app: `mm-robot-work` (manual only) and
  `mm-robot-catch` (`0 * * * *`), Opus 5.5, folders as the recipe, no worktree. Recipe gap: the
  app created both with no permission mode (the other routines on this Mac are `auto`), so an
  unattended run would stall on prompts; Gabriel set both to Auto. A manual-only routine
  reads `enabled: false` in the task list — the first chain shows whether `run_scheduled_task`
  still starts it.
- 2026-09-27 — Step 7, the watched runs. **Catch** ("Run now", twice: 09-25 22:45 and today
  10:29): sync, pull (nothing pending), inbox (empty) all fine, but its chain step failed —
  `run_scheduled_task` → "This tool is unavailable in unattended sessions (scheduled-task runs
  and remote-dispatched trees)": the app forbids a routine starting a routine, so 029's
  catch → work chain can't exist. (A manual-only routine reading `enabled: false` was a red
  herring.) **Work** ("Run now", 10:34–11:03): Workflow runs in a routine and the run waits
  for its background completion (plan → implement → gates → review, ~28 min); the browser
  pane's tools are present (unused: 064 needs none); claimed, landed and pushed 064
  (`be18016`, CI green), branch deleted, clone left clean on `main`; the gate held (hold list:
  sign-in, grader, schema, sanitize — pending 057, 031, 062, 072, 061, 063, 064). Starting
  context 72.6k (the deferred-tool list is a large share); no compactions, no API errors.
  **Push notification**: not delivered — at the Mac, "not sent, this terminal is active";
  away, "Mobile push not sent (Remote Control inactive)". **Recipe fixed** (this commit):
  work gets its own clock (`30 * * * *`, after catch at :00) and a run lock in
  `ROBOT-WORK.md` §1 (a run that outlasts the hour must not share the clone with the next);
  catch's chain step retired; `START.md` adds Auto permission mode (re-check after saving),
  the explicit dev-server port flags, Remote Control on for notifications, "stop = disable
  both". Owed outside `tasks/` (a laptop session): `CLAUDE.md:26` ("an hourly catch … starts
  one work run") and `.claude/commands/robot-catch.md` / `robot-work.md` still describe the
  chain. Next: Gabriel sets the work schedule, re-enables catch, turns Remote Control on;
  then the first unattended hour and the day-after probe.
