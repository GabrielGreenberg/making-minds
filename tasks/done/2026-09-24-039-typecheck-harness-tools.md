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
status: done
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
- 2026-09-24 — Implement (uncommitted). `server/tools` was already type-checked
  (`server/tsconfig.json` includes `tools`; CI ran `npm run typecheck`) — only `app/tools` sat
  outside every program. New `app/tsconfig.tools.json` extends `tsconfig.app.json` (same
  strictness), `include: ["src","tools"]`, `types: ["vite/client","node"]`, own tsbuildinfo;
  deliberately NOT in `tsconfig.json` references (`tsc -b` would then need server deps).
  Inventory under it: **22 errors in 6 files** — turbotCheck.ts:920 `mkRun` missing
  `tapeCellsUsed`; tmCheck.ts:233/239 missing `finalStateId`; scWindowCheck.ts ×7 passing
  `number | string` FSM symbols as bits (new `bitOf` helper: a string maps to NaN, so the
  store's numeric k=1 history shape stays pinned instead of being coerced); remoteStoreCheck.ts
  ×5 `api.ApiError` as a type off a dynamic-import value (`import type { ApiError }`, erased,
  so the localStorage shim still runs first); navResetCheck.ts:1627 a `detail` its 2-arg
  check() dropped (now printed on failure); server/src/auth.ts ×6 parameter properties under
  `erasableSyntaxOnly` (4 constructors → `private readonly` fields; the NUL in the throttle key
  untouched, `od -c` verified). No casts. Wiring: app `typecheck:tools` script, in `check` right
  after portabilityCheck (~3.5 s); server `check` now starts with `npm run typecheck`, and
  `server/tsconfig.json` gains `erasableSyntaxOnly` / `verbatimModuleSyntax` /
  `noUncheckedSideEffectImports` (no looser than the app — the tools program follows
  remoteStoreCheck into server/src); CI `build-and-deploy` installs server deps then runs
  `typecheck:tools` before Build; `server-checks` runs just `npm run check`. Pin:
  portabilityCheck `[type-check coverage]` — configs parse clean; every .ts tool is in its
  directory's program (30 covered: 25 app / 5 server; 3 JS exempt; a .ts in tasks/tools has no
  program); tools/server at least as strict as the app on 7 flags; the scripts + CI step order;
  an in-memory tripwire (stale TMEvalResult → TS2741, unused parameter → TS6133, corrected
  literal clean). Neuter (working tree, each reverted by backup): turbotCheck `tapeCellsUsed`
  removed → `typecheck:tools` exit 2 naming turbotCheck.ts:920; typecheck:tools unwired from
  `check` → portability exit 1; `erasableSyntaxOnly` dropped from server tsconfig → exit 1
  (names the flag); `tools` dropped from the tools include → exit 1 (25 uncovered); a .ts in
  tasks/tools → exit 1; CI typecheck step removed → exit 1. Gates: app tsc 0,
  `typecheck:tools` 0, build 0, app `npm run check` 0; server typecheck 0, `npm run check` 0.
  Docs in place: PROFILE §6 rows, server/README.md checks block, CLAUDE.md Tools row (net −3 B).
  Owed: CI (the new server `npm ci` on node 20 + the typecheck step) until the push.

### 2026-09-24 — implemented (work loop)
- **Built:** the harness tools are now type-checked. `app/tsconfig.tools.json` (extends
  `tsconfig.app.json`, `include: ["src","tools"]`) runs as `npm run typecheck:tools` in app
  `npm run check` (after the budget guard + portabilityCheck) and in CI `build-and-deploy`
  before Build (server deps installed first). `server/tools` was already covered; server
  `npm run check` now starts with `npm run typecheck`, and `server/tsconfig.json` is no looser
  than the app (`erasableSyntaxOnly`, `verbatimModuleSyntax`, `noUncheckedSideEffectImports`).
  All 22 surfaced errors fixed without casts (turbotCheck `mkRun` `tapeCellsUsed`, tmCheck,
  scWindowCheck `bitOf`, remoteStoreCheck `import type`, navResetCheck, server/src/auth.ts
  parameter properties → fields).
- **Pins:** portabilityCheck `[type-check coverage]` (every .ts tool in its program; tools/server
  ≥ app strictness on 7 flags; scripts + CI step order; in-memory TS2741/TS6133 tripwire).
- **Gates (exit codes):** app tsc 0, build 0, `npm run check` 0 (incl. typecheck:tools);
  server `npm run typecheck` 0, `npm run check` 0; check-budgets 0 (CLAUDE.md 39,989 B).
- **Review fixed:** CLAUDE.md "CI is strict TypeScript" now names both `tsc -p tsconfig.app.json`
  and `npm run typecheck:tools` (room made by pointing the Part 1 Server gate list at the Part 2
  Server row). **Skipped:** none. **Nit left:** tsconfig.tools.json header says "first in
  `npm run check`" (it runs third).
- **Owed (loop session):** neuter tests after this commit — (1) drop `tapeCellsUsed: 0` from
  turbotCheck `mkRun` → `typecheck:tools` non-zero with TS2741, revert → 0; (2) tools include
  `["src"]` → portabilityCheck fails on coverage rows, revert; (3) re-add a parameter property
  in server/src/auth.ts → server `npm run typecheck` fails TS1294, revert; log exit codes.
  Full gates again before landing. After push: `gh run list --limit 1` and the
  "Harness-tool type-check" step log (server `npm ci` on node 20 only warns EBADENGINE).
  No visual check owed; nothing owed to Gabriel.
- **NEXT STEP:** loop session: run the owed neuter tests, then land per PROFILE §5.

### 2026-09-24 — neuter test and land (work loop)
- **Neuter test (loop session, reverted):** removed `tapeCellsUsed: 0` from turbotCheck's
  `mkRun`. `npm run typecheck:tools` then exited **2** with "tools/turbotCheck.ts(920,26):
  error TS2741: Property 'tapeCellsUsed' is missing…". After restoring from a copy it exited
  **0**, and the tree is clean apart from the comment fix below.
- **Fixed here:** the review nit. `tsconfig.tools.json`'s header said the type-check runs
  "first in `npm run check`"; it runs after the budget guard and the portability gate, and in
  CI before Build. The other nit (the CLAUDE.md CI bullet) was already fixed in the Fix stage.
- **Owed after push:** the CI log's "Harness-tool type-check" step passes on a fresh Linux
  runner. That is checked when this merge is pushed.
- Landed via a merge into `main`.
