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
status: ready
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
