---
id: 2026-09-24-039
type: chore
title: Type-check the harness tools — app/tools and server/tools are outside every tsconfig, so stale literals and wrong signatures pass silently
priority: low
size: small
requires:
area: app
source: chat
created: 2026-09-24T07:30:00-07:00
status: ready
after:
branch:
merged_into:
---

## Description
Found in the work loop on 2026-09-24 (task 010's review, and again as task 016's follow-up 2);
filed by the loop session. `app/tools/*.ts` sit outside `tsconfig.app.json`, and `tsx` runs
them without type-checking, so CI's strict `tsc` never sees them. A tool can drift from the
types it tests and still "pass". For example, `app/tools/turbotCheck.ts:920` builds a
`TurbotRunResult` literal that is missing the required `tapeCellsUsed` field (the 2026-07 run
helper; task 010 fixed its own copy at the `[goal-less arenas]` section). Check whether
`server/tools` has the same gap.

## Done when
- A `tsconfig.tools.json` (or equivalent) type-checks `app/tools/*.ts` against `src/` under
  the same strictness as the app (`noUnusedLocals`, `noUnusedParameters`). It runs in app
  `npm run check` and in CI. If `server/tools` is uncovered too, it gets the same treatment.
- Every existing type error it surfaces is fixed (turbotCheck.ts:920 at least), with no
  `any`-casts added to paper over them.

## Design
- **deepFix:** one tools tsconfig extending the app's, including `tools/**` and `src/**`
  (tools import src), wired as a step before the harness in `npm run check`. The portability
  gate (task 016, `portabilityCheck.ts`) is the precedent for a first-in-chain tooling gate.
- **surgicalFix:** fix turbotCheck.ts:920 alone. Rejected: the next drift would go unseen.

## Verify
`npx tsc -p tsconfig.tools.json --noEmit` exits 0, app `npm run check` stays green, and a
deliberately wrong literal in a tool fails it (neuter test, reverted).

## Progress log
