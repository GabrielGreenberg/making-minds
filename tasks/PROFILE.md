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
typecheck + check, the context-budget guard, app build → GitHub Pages. The pilot deploy
(Cloudflare Pages + Lightsail) is manual — `deploy/README.md`. **Routines never push or
deploy.** Interactive sessions push only when Gabriel says so, and after any push confirm
`gh run list --limit 1` is green before reporting done.

## 3. The main checkout is live and shared

Gabriel edits it, and parallel Claude sessions may be working in it at the same time. So:
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
- `/worker` (unattended): `fix/NNN-slug` in an **isolated worktree**, so half-done work never
  touches the live checkout:
  ```
  git -C <repo> worktree add <repo>/.claude/worktrees/NNN-slug -b fix/NNN-slug main
  ln -s <repo>/app/node_modules    <repo>/.claude/worktrees/NNN-slug/app/node_modules
  ln -s <repo>/server/node_modules <repo>/.claude/worktrees/NNN-slug/server/node_modules
  ```
  `.claude/` is gitignored (no status noise) and `~/.claude/settings.json` excludes
  `**/.claude/worktrees/**` from CLAUDE.md loading (so the worktree's copy is never loaded a
  second time). A dev server generally can't run inside a symlinked worktree; durable proof
  there is types + tests; a visual check is owed against `main` after the merge.

## 5. Landing (the one procedure; README.md §Lifecycle explains the why)

1. On the branch, all gates green (§6). Then in the task file: `status: done`, clear
   `branch:`, final `## Progress log` entry; `git mv` it `in-progress/` → `done/`; append the
   `tasks/log.md` line; `git add` those paths; commit `tasks: land NNN — <title>`.
2. The main checkout must be **on `main` and clean**. If it isn't (Gabriel mid-edit):
   `/work` — tell Gabriel and wait; `/worker` — set `status: awaiting-merge`, leave the
   branch, retry next run.
3. `git -C <repo> merge --no-ff fix/NNN-slug -m "Merge fix/NNN-slug: <title>"` (or the
   `task/` branch). Must be conflict-free; a real conflict is a human call — abort the
   merge and escalate.
4. `git -C <repo> worktree remove <path>` (worker), `git -C <repo> branch -d <branch>`.
5. Never push (routines) / push only when told (interactive).

## 6. Gates (verify tooling)

| From | Command | What it proves |
| --- | --- | --- |
| `app/` | `npx tsc -p tsconfig.app.json --noEmit` | strict types (`noUnusedLocals/Parameters` — CI is strict) |
| `app/` | `npm run build` | the production bundle builds |
| `app/` | `npm run check` | the budget guard + 16 headless harness tools (`app/tools/*Check.ts`; several boot a real server — minutes, not seconds) |
| `server/` | `npm run typecheck` | server types |
| `server/` | `npm run check` | serverCheck + authCheck + parityCheck (server ≡ engine grading) |

Fast loop while working: both `tsc`s plus the ONE harness tool that pins the area you're
touching (`npx tsx tools/<name>Check.ts` from `app/`). Before landing: everything in the
table. When a task names a contract, add or extend a pin in the matching check tool — the
harness is the project's test suite; "green" means these, by exit code, not by assertion.
Deps missing → `npm ci` in that package (never commit lockfile churn).

## 7. What the dev environment cannot prove — "owed, not claimed"

- **Visual/layout** — only a browser eyeball proves it. Interactive sessions verify with
  the browser tools against the dev server (`.claude/launch.json` → "Vite Dev Server",
  port 5173; "Vite Remote Mode" pairs with a local server on 8199). Routines can't start a
  dev server or answer permission prompts: a task needing this carries `requires: browser`.
- **The Lightsail box / Cloudflare Pages** — needs ssh keys / tokens in gitignored
  `secrets/`, `ssh/`: `requires: ssh`, human-run.
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
6. **Every canvas swap resets sim state** via `resetAllSimState()` (`navResetCheck`).
7. **`CLAUDE.md` stays ≤ 40 KB** and is never appended to (§9).
Full rules: `CLAUDE.md` Part 2 "Critical design rules" and "Things to watch".

## 9. Context budget (a lesson from the Virgil pipeline — read twice)

`CLAUDE.md` is loaded into **every** session and every subagent except `Explore`. Left to
grow, it starts sessions half-full and makes unattended runs thrash and die. Rules:
- `CLAUDE.md` is an **index** ≤ 40 KB, enforced by `tasks/tools/check-budgets.mjs` in CI and
  `npm run check`. Update its STATUS in place; never append narrative. The dated story goes in
  the task file's `## Progress log` + one `log.md` line. `docs/HISTORY.md` is frozen.
- Role prompts and this file have budgets too (same script). Ledgers written by routines
  get a size rule and a script that enforces it.
- Unattended prompts never use ultracode / multi-agent workflows. The worker fans out
  read-only with at most ~3 `Explore` agents (they skip the instruction load), asking for
  short structured answers, never file dumps.
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
`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; plain language first, code
vocabulary second.
