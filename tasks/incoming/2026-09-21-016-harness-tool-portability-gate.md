---
id: 2026-09-21-016
type: chore
title: Add the harness-tool portability grep gate (P-TOOLS-1)
priority: low
size: small
requires:
area: app
source: claude-md
created: 2026-09-21T15:30:00-07:00
status: ready
after:
branch:
merged_into:
---

## Description
The one optional hardening item left in the retired build-out queue. Original spec: grep
`P-TOOLS-1` in `docs/buildout/QUEUE.md`.

## Done when
Per that spec: a check in `npm run check` fails if any `app/tools/*.ts` harness tool imports
something non-portable (per the spec's list); all current tools pass.

## Design
A small grep-gate tool in the style of `notationCheck`'s / `remoteStoreCheck`'s gates.

## Verify
`npm run check` green; a deliberately bad import fails it (neuter test, committed after).

## Progress log
