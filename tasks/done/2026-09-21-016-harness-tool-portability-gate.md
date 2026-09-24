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
status: done
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
Owed, not claimed: app `npm run check` exits 1 at `navResetCheck` — red on main since
c6e8a8a (task 038), not this task; the follow-up below owns it. Recipe once it lands: `cd app
&& npm run check` → exit 0.

## Progress log
- 2026-09-24 — Implement (uncommitted). New `app/tools/portabilityCheck.ts`, FIRST in app
  `npm run check` (right after the budget guard) and its own CI step in `deploy.yml`
  `build-and-deploy` (after `npm ci`; `server-checks` has no `app/node_modules`). It lists every
  import with TypeScript's own scanner (`ts.preProcessFile` — the string / comment / regex /
  browser-template "imports" in themeCheck, rosterCheck, workbookFileCheck and
  shootProblemSets.mjs are not imports) over every code file under app/tools, server/tools and
  tasks/tools, and refuses: R1 absolute specifier (`/`, `\`, drive letter, `file:`, any URL
  scheme but `node:`); R2 a relative specifier that walks above the repo root at ANY step
  (catches `../../../<checkout-name>/app/…`, which `path.resolve` would fold back inside),
  judged before existence; R3 unresolved, or resolved only in other letter case — lookups walk
  directory listings, so macOS and Linux agree; R4 a bare package not in the nearest in-repo
  package.json (`node:*` always passes — Node 20's `isBuiltin('node:sqlite')` is false;
  tasks/tools has none → builtins only); R5 a string / template head beginning with
  `/Users/`, `/home/`, `~/`, `X:\|/` (optional `file://`). Repo root from `import.meta.url`,
  never a literal. Pins: `[tripwire]` 17 bites (each names the virtual file) + 15 clean
  controls; `[sweep]` 0 violations over 33 files / 292 specifiers, with vacuity pins (> 25
  files, four named files, > 200 specifiers). Neuter (reverted): bumpCheck.ts line 27 → this
  checkout's absolute path → gate exit 1 naming `app/tools/bumpCheck.ts:27` while bumpCheck
  itself still exits 0 here (the silently-green half); `../src/ComponentGeometry` → case
  message; rosterCheck + `left-pad`, a `../../../makingminds/…` escape and a `/home/ci/…`
  string, next-id.mjs + `typescript` → each named, exit 1; the gate narrowed to app/tools →
  the two server/tasks coverage pins fail; wrong root → crash, exit 1. Re-green exit 0. CI
  step owed at push (YAML parses; runs on the next push to main).
- 2026-09-24 — Fix (uncommitted). Review: `ts.preProcessFile` is a token pre-scan — a
  backtick inside a regex literal blinded it to every later import (static ones too), and it
  never saw an aliased require. Imports now come off the parse tree (`moduleRefs`, over the
  `SourceFile` scanSource already built): import / export … from / `import = require` /
  `import()` types / dynamic `import()` / `require()` under any `createRequire` or `= require`
  alias / `require.resolve` / `import.meta.resolve` / triple-slash references; a template
  argument's head is judged by R1. Same 292 specifiers over today's 33 files (set-diffed
  against the old scanner: identical). `[tripwire]` now 27 bites + 18 clean controls. The
  review's repro (a regex holding a backtick, then `import('/Volumes/…')` + a `../../../elsewhere/…` import; a
  `createRequire` alias on `/opt/…`), planted in a scratch mirror: all three named, exit 1
  (was exit 0).
  **Follow-ups for the loop session to file** (neither widened here):
  1. **navResetCheck red on main** — the law-3 pin "the canvas holds no lock of its own"
     (navResetCheck.ts:1990, regex over CircuitCanvas.tsx) fails since c6e8a8a (task 038, "the
     unbound-box warning stays off locked canvases") put `useStore(selectQuestionLocked)` at
     CircuitCanvas.tsx:1853, so app `npm run check` exits 1 there and the chain never reaches
     the tools after it (each run by hand: all exit 0). Gabriel's call: 038 reads the lock some
     other way, or the pin is narrowed to let a component READ the selector (law 3 forbids
     gating in a component, not displaying the lock).
  2. **Harness tools are not type-checked anywhere** (tools/ is outside tsconfig.app.json;
     e.g. turbotCheck.ts:920 builds a `TurbotRunResult` without `tapeCellsUsed`) — a tools
     typecheck is its own task.

### 2026-09-24 — implemented (work loop)
- **Built.** A gate that fails `npm run check` when a harness tool imports something that only
  works on one machine. `app/tools/portabilityCheck.ts` runs first in app `npm run check`
  (after the budget guard) and as its own CI step in `deploy.yml` `build-and-deploy`. It reads
  every import off TypeScript's parse tree in app/tools, server/tools and tasks/tools and
  refuses absolute or URL specifiers (R1), relative walks above the repo root (R2), unresolved
  or wrong-case paths (R3), undeclared packages (R4), and home/drive-path strings (R5). Each
  violation names file:line. Docs: CLAUDE.md Tools row, PROFILE §2/§6, QUEUE.md P-TOOLS-1 ticked.
- **Pins.** `[tripwire]` 27 bites + 18 clean controls; `[sweep]` 0 violations over 33 files /
  292 specifiers, with vacuity pins (> 25 files, four named files, > 200 specifiers).
- **Gates (exit codes).** app-tsc 0 · app-build 0 · app-check 1 · server-tsc 0 · server-check 0 ·
  check-budgets 0 (CLAUDE.md 39983/40000) · portabilityCheck alone 0. The app-check 1 is the
  navResetCheck law-3 pin, red on main since c6e8a8a (task 038). Every tool after it, run by
  hand, exits 0.
- **Review.** Fixed: the token pre-scan missed imports (a backtick in a regex, aliased
  require), so it was replaced by the parse-tree walk and the repro now exits 1. The navResetCheck
  red now has an owner (follow-up 1 above). Skipped: turning app-check green, because it needs
  Gabriel's decision on 038. Nit left: the gate goes beyond P-TOOLS-1 (R3–R5, tasks/tools).
- **Owed.** (1) The neuter test the loop session runs and logs: an absolute import on line 1 of
  dueDateCheck.ts → exit 1 naming `app/tools/dueDateCheck.ts:1`, and `npm run check` stops at
  the gate; `'./builder'` → `'./Builder'` → a case violation; remove both edits and re-run →
  exit 0. (2) The first CI run on Linux/Node 20 at the next push to main (Gabriel's call):
  `gh run list --limit 1` green, with the portability step ending `PORTABILITY CHECK OK`. No
  visual check is owed. File follow-ups 1 and 2 above.
- **Next step.** Loop session: run and log the neuter test (no visual check owed), file
  follow-ups 1 and 2, then land per PROFILE §5.

### 2026-09-24 — neuter test, follow-ups, land (work loop)
- **Neuter test (run and reverted by the loop session; the tree is clean after).**
  - (1) `import '/Users/nobody/making-minds/app/src/types';` as line 1 of
    `tools/dueDateCheck.ts` → the gate printed "→ app/tools/dueDateCheck.ts:1 imports
    '/Users/nobody/…' — is an absolute path (resolves on one machine only)", then "PORTABILITY
    CHECK FAILED".
  - (2) `'./builder'` → `'./Builder'` in `tools/coverageCheck.ts` → gate exit 1, "→
    app/tools/coverageCheck.ts:68 imports './Builder' — letter case differs from the file on
    disk (resolves on macOS only)".
  - Both files were restored from copies; the gate then printed "PORTABILITY CHECK OK", exit 0.
- **Follow-up 1 (the red on main) is resolved.** It was the loop session's own 038 fix-up
  (c6e8a8a). Rather than narrowing the law-3 pin, the decision moved into the store:
  `selectShowUnboundBoxWarning` (store.ts), and the canvas reads only that. It is committed on
  `main` as `d020e5e` (full app check green there) and merged into this branch.
- **Follow-up 2** (harness tools are not type-checked) is filed as task 039.
- **Gates on the branch (exit codes):** app tsc 0, build 0, `npm run check` **0** (portability
  gate first; COVERAGE OK last); server typecheck 0, check 0.
- **Nit left as is:** the gate is wider than P-TOOLS-1's letter (R3–R5, tasks/tools). Every
  rule is a portability failure of the same family, and all files pass today.
- **Owed at the next CI run:** the "Harness-tool portability gate" step ends `PORTABILITY CHECK
  OK` on Linux/Node 20. That is checked when this merge is pushed.
- Landed via a merge into `main`.
