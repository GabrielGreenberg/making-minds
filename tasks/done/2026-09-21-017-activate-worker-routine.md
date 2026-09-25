---
id: 2026-09-21-017
type: chore
title: Activate the hourly worker routine once the heavy lifts are done
priority: low
size: small
requires: human
area: pipeline
source: chat
created: 2026-09-21T15:30:00-07:00
status: merged
after:
branch:
merged_into: 2026-09-22-029
---

## Description
Gabriel's call: the routine (`tasks/WORKER.md`) works best on small changes and is not to be
scheduled until the big items are through. Recipe: `tasks/START.md` §"Activating".

## Done when
One hand-run `/worker` cycle landed end-to-end; the scheduled task exists (hourly, Opus,
repo root, autonomous permissions); the transcript probe after a day shows starting context
< 100k and zero compactions.

## Design
n/a.

## Verify
`tasks/log.md` shows a routine-landed task; probe numbers recorded in the progress log.

## Progress log
- 2026-09-25 (`/work`, Gabriel): merged into 029, the robot pipeline — its hourly work
  routine is this scheduled worker, widened; the transcript probe moved to 043's Verify.
