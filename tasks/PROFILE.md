# PROFILE — shared operating context (every role reads this first)

## 1. Design principle — depth over patches

Prefer **unified, deep solutions that retire a whole class of problems** over surgical
patches, *scoped to the real phenomenon*: verify a problem is general before generalising the
fix. Name the family, state the shallow fix and the deep fix, choose the deepest one the
evidence warrants that also improves the app, and route it through the seams (`CLAUDE.md`
Part 2 — "Architecture principle: seams"). Full text: `docs/buildout/NORTH_STAR.md`
§"Central design principle". A queue collision or a busy checkout is never a reason to go
shallow — relocate the change, don't shrink it.

## 2. The repo

`/Users/gabriel/Programming/making-minds` — two npm packages, `app/` (Vite + React + TS)
and `server/` (Express 5 + `node:sqlite`; it imports `app/src/engine/*` directly). **One
long-lived branch, `main`**, not protected; every landing is a **merge commit, never a
squash**. CI (`.github/workflows/deploy.yml`) runs on every push to `main`: server
typecheck + check, the context-budget guard, the harness-tool portability gate, app build →
GitHub Pages. The pilot (Cloudflare Pages + Lightsail) is released by `deploy/release.sh`
(`deploy/README.md`): by Gabriel's hand, or hourly by the robot through task 042's gate.
**Land = push, on every machine** (Gabriel, 2026-09-25): a claim is pushed at once and a
land is pushed at once, so `main` never holds unpushed work. **Pushing to GitHub `main` is
shipping** — the robot releases it within the hour unless the gate holds it. After any push
confirm `gh run list --limit 1` is green before reporting done.

## 3. Two machines, one queue — and a live, shared checkout

Gabriel's laptop and the **robot** (his always-on Mac: its own clones, `START.md` §"The
robot") both work the queue, and git on GitHub is the only thing they share. So every role
**fetches before it looks at the queue** (`git -C <repo> fetch origin`, then
`merge --ff-only origin/main` on `main`) and **pushes its queue commits at once** (claims,
filings, parks): a pushed claim is the lock; a rejected push means someone else moved —
fetch, re-check, retry. The robot pushes to `main` every hour.

Gabriel's checkout is live: he edits it, and parallel Claude sessions may be working in it
at the same time. So:
verify `HEAD` and `git status --porcelain` before and between writes; use `git -C <repo> …`,
never `cd && git`; **explicit `git add <paths>`, never `git add -A`**; never remove a branch
or worktree you didn't create; never sweep untracked files; treat foreign modified files as
someone else's work in flight — don't stage them, don't revert them, don't gate on them.
Absolute paths for every edit (a failed command can reset cwd and a relative edit then hits
the wrong tree).

## 4. Branches and worktrees

- `/work` (interactive): `task/NNN-slug`, cut from `main` **in the main checkout**, so the
  dev server, the browser preview and Gabriel are all right there. One task branch at a
  time in the main checkout.
- The robot's work routine (`ROBOT-WORK.md`): `robot/NNN-slug` in **its own clone**
  (`~/making-minds-robot`), with its own dev server; an unfinished branch is pushed so the
  next run resumes it. Each role touches only its own prefix.
- A worktree, when a session wants isolation inside Gabriel's checkout:
  `git -C <repo> worktree add <repo>/.claude/worktrees/NNN-slug -b <branch> main`, then
  symlink `app/node_modules` and `server/node_modules` into it. `.claude/` is gitignored and
  `~/.claude/settings.json` keeps its `CLAUDE.md` from loading twice; a dev server generally
  can't run there, so a visual check is owed against `main` after the merge.

## 5. Landing (the one procedure; README.md §Lifecycle explains the why)

1. On the branch, all gates green (§6). Then in the task file: `status: done`, clear
   `branch:`, final `## Progress log` entry; `git mv` it `in-progress/` → `done/`; append the
   `tasks/log.md` line; `git add` those paths; commit `tasks: land NNN — <title>`.
2. The checkout must be **on `main` and clean** (Gabriel mid-edit → tell him and wait), and
   `main` current: `git -C <repo> fetch origin`, `merge --ff-only origin/main`.
3. `git -C <repo> merge --no-ff <branch> -m "Merge <branch>: <title>"`. Must be
   conflict-free; a real conflict is a human call — abort the merge and escalate.
4. **Push `main` at once** (§2), then confirm CI. Rejected → fetch, merge `origin/main`,
   push. Then `git -C <repo> branch -d <branch>` (and the remote branch, if it was pushed).

## 6. Gates (verify tooling)

| From | Command | What it proves |
| --- | --- | --- |
| `app/` | `npx tsc -p tsconfig.app.json --noEmit` | strict types (`noUnusedLocals/Parameters` — CI is strict) |
| `app/` | `npm run build` | the production bundle builds |
| `app/` | `npm run check` | the budget guard, the tools type-check (`tsconfig.tools.json`) + 22 headless harness tools (`app/tools/*Check.ts`; several boot a real server — minutes, not seconds) |
| `server/` | `npm run typecheck` | server types |
| `server/` | `npm run check` | typecheck + serverCheck + feedbackCheck + rosterCheck + authCheck + parityCheck (server ≡ engine grading) + homeworkSyncCheck |

Fast loop while working: both `tsc`s plus the ONE harness tool that pins the area you're
touching (`npx tsx tools/<name>Check.ts` from `app/`). Before landing: everything in the
table. When a task names a contract, add or extend a pin in the matching check tool — the
harness is the project's test suite; "green" means these, by exit code, not by assertion.
Deps missing → `npm ci` in that package (never commit lockfile churn).

## 7. What the dev environment cannot prove — "owed, not claimed"

- **Visual/layout** — only a browser eyeball proves it. Interactive sessions verify with
  the browser tools against the dev server (`.claude/launch.json` → "Vite Dev Server",
  port 5173; "Vite Remote Mode" pairs with a local server on 8199). The robot's work
  routine checks in its own clone ("Robot Dev Server") and parks when it can't; a task
  needing an eyeball carries `requires: browser`.
- **The Lightsail box / Cloudflare Pages** — needs ssh keys / tokens in gitignored
  `secrets/`, `ssh/`: a task doing box work by hand carries `requires: ssh` (human-run; the
  robot only releases, through the gate).
- **Real UCLA SSO** — no test IdP exists yet.
State each such gap in the task's `## Verify` as owed, with the recipe.

## 8. Load-bearing laws (what an unattended agent must never break silently)

1. **Students never receive answer keys.** `test_cases` / `perception_cases` /
   `fill_in_answers` are stripped server-side (`server/src/sanitize.ts`); the remote-store
   module graph contains no grader (grep gate in `app/tools/remoteStoreCheck.ts`); parity is
   pinned by `server/tools/parityCheck.ts`. Never wire the grader (or any answer-carrying
   JSON) into remote code.
2. **`app/src/engine/` is pure TypeScript** — no React, Zustand, or DOM. The server imports
   it directly.
3. **All edit locking goes through `isCurrentQuestionLocked` in `app/src/store.ts`**, at the
   top of every mutating action — never gate in a component. Simulation is never locked.
4. **Transition-label syntax lives only in `app/src/engine/notation.ts`** (grep gate in
   `notationCheck`).
5. **Local mode stays byte-identical** with zero `/api` traffic when `VITE_API_BASE` is unset.
6. **Every canvas swap resets sim state AND undo/redo** via `resetAllSimState()`; **every
   principal change resets the whole editor store** and the provenance clipboard (and loads
   that person's sandbox) via `resetForPrincipal()`, called by the auth provider in both modes
   (`navResetCheck`). A canvas swap never clears that clipboard (copy in P1, paste in P2).
   A machine edit (`gradedMachineKey` changes) restarts every live run at t=1 keeping its
   input and undo — the store's machine-key subscriber, never an action or a component
   (`navResetCheck [edit during run]`).
7. **`CLAUDE.md` stays ≤ 40 KB** and is never appended to (§9).
8. **Assignment content enters only through the provenance seam** (`app/src/provenance.ts`
   `canPaste` + `app/src/usePasteGuard.ts`): a paste into an assignment takes only what this
   user copied inside an assignment in this window; no clipboard API outside the hook, every
   answer field guarded (grep gate in `app/tools/pasteCheck.ts`). A new input or import path
   asks the seam — never its own rule.
9. **Student data never enters git — the repo is public.** Class lists live in gitignored
   `rosters/`; app feedback reports stay on the server and in `tasks/tools/feedback.mjs`'s
   working copy outside the repo; a task distilled from one cites the report id and role,
   never its author's name or email, their words, or their screenshots (`CATCHER.md` §3).
Full rules: `CLAUDE.md` Part 2 "Critical design rules" and "Things to watch".

## 9. Context budget (a lesson from the Virgil pipeline — read twice)

`CLAUDE.md` is loaded into **every** session and every subagent except `Explore`. Left to
grow, it starts sessions half-full and makes unattended runs thrash and die. Rules:
- `CLAUDE.md` is an **index** ≤ 40 KB, enforced by `tasks/tools/check-budgets.mjs` in CI and
  `npm run check`. Update its STATUS in place; never append narrative. The dated story goes in
  the task file's `## Progress log` + one `log.md` line. `docs/HISTORY.md` is frozen.
- Role prompts and this file have budgets too (same script). Ledgers written by routines
  get a size rule and a script that enforces it.
- Unattended runs never use ultracode. The robot's catch routine uses no Workflows; its work
  routine runs exactly one `mm-task` Workflow per run (≤ 8 agents — it keeps the run's own
  context to conclusions). Both fan out read-only with at most ~3 `Explore` agents (they
  skip the instruction load), asking for short structured answers, never file dumps.
- Read in slices (`sed -n`, Read with offset/limit, grep first). Never `cat` `docs/HISTORY.md`,
  `tasks/log.md`, or a whole check tool.
- Checkpoint and exit before a long session compacts; a fresh session resumes from the
  progress log.

## 10. Orientation docs (on demand — none of these are auto-loaded)

`docs/HISTORY.md` (the frozen changelog) · `spec/PHIL_133_Platform_Spec_v2.md` (behaviour
authority) · `docs/buildout/NORTH_STAR.md`, `VISUAL_VOCAB.md`, `designs/` (design memos) ·
`deploy/README.md` · `server/README.md` · `app/tools/fixtures/reference/README.md` ·
`problem sets/hw*.pdf`.

## 11. Memory discipline

The queue is the store. Claude's memory directory is for durable gotchas and standing
feedback only, never task tracking. Its index is edited by concurrent sessions — re-read
before a targeted edit.

## 12. Standing conventions (from Gabriel)

Clickable links for every file written; a compact running list of tasks touched, refreshed
as it changes; end every catcher/work response with **"Done."**; commit messages end with
the `Co-Authored-By:` line naming the model that ran (the harness supplies it); plain
language first, code vocabulary second. An unattended robot run has no reader for the
running list, the links or "Done.": it keeps the co-author line and the plain language.
