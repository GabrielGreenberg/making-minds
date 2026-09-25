# ROBOT-WORK — the robot's work routine (started by the catch routine, or "Run now")

You are one unattended run on the robot: Gabriel's always-on Mac, in the work clone
`~/making-minds-robot` (`<repo>` below; setup: `START.md` §"The robot"). Nobody is watching
and nobody can answer. Read `tasks/PROFILE.md` first, then `tasks/LOOP.md` §2 (selection),
§3 (the task workflow) and §4 (parking); this file overrides them where it differs. Work
**exactly one task**, then release, then stop. Parking always beats doing the wrong thing.

## 0. Rules of this run
- This clone only. Never read `~/making-minds-private/` (raw feedback): you work from the
  catcher's distilled tasks, never a student's words.
- Your branches are `robot/NNN-slug`; `task/` branches are Gabriel's sessions' — never touch
  them. Never force-push, never rewrite pushed history, never delete a branch you didn't make.
- Pushing is part of the job (PROFILE §2: land = push): the claim at once, the land at once.
- Release only through `deploy/release.sh --unattended` (task 042's gate), never by hand.
- One `mm-task` Workflow per run (≤ 8 agents) is your only multi-agent use (PROFILE §9).
  No Workflow tool in this session → tell Gabriel (§7) and stop: a setup fault (043).

## 1. Sync
`git -C <repo> status --porcelain` must be empty (dirty = a run crashed mid-edit: tell
Gabriel, stop). `git -C <repo> fetch origin --prune`; `git -C <repo> checkout main`;
`git -C <repo> merge --ff-only origin/main`. If that fails because `main` is only *ahead*
(`git merge-base --is-ancestor origin/main main`: a land whose push failed), push it; if
it has diverged, tell Gabriel and stop.

## 2. Pick — first match wins
1. **Resume**: an `in-progress/` task whose `branch:` starts with `robot/`. Check it out
   (from `origin/` if not local), `git merge --no-edit main` into it (a conflict → abort,
   park §5), and continue from its progress log's last line. Its third `(robot,
   unfinished)` entry → park it instead: it doesn't fit a run.
2. **Claim**: the top eligible `incoming/` task by LOOP §2.2 (`status: ready`, its `after:`
   in `done/`, `requires:` empty or only `browser`). On `main`: `status: in-progress`,
   `branch: robot/NNN-slug` (or the branch the file already names — a parked task Gabriel
   released), `git mv` → `in-progress/`, commit `tasks: claim NNN (robot)`, and **push
   before any work** — the claim is the lock between the machines. Rejected → drop the
   claim (`git reset --hard origin/main` after `git fetch` — safe: after §1 this clone has
   nothing else unpushed), re-check the task is still in `incoming/` on `origin/main`, and
   claim it or the next one; at most 3 tries. Then check out the branch (`-b` if new).
3. **Nothing eligible** → go straight to §4's release step (pushed laptop work still ships),
   then stop.

## 3. Work it
Run the task workflow by path: `Workflow({scriptPath: "<repo>/.claude/workflows/mm-task.js",
args: {task, branch, repo: "<repo>", today, coauthor}})` (LOOP §3). It runs in the
background: wait for its completion notification, doing nothing else meanwhile. Read the
result; spot-check it (`git diff --stat main`, a file or two).
- `needsGabriel` non-empty → park (§5) with those as the questions.
- **Visual checks** (`owedChecks`, `requires: browser`): do them yourself against this
  clone's dev server — `.claude/launch.json` → "Robot Dev Server" — as LOOP §2.5 says.
  Fix small misses; a bigger one goes back into the workflow (resume it with the finding).
  No browser tools in this session → park, the recipe as the question ("Visual check owed:
  <recipe>. Land it once you've looked?").
- Gates still red after the workflow's rounds plus one attempt of yours → park.
- Out of time or context before it's done → §5 "Unfinished".

## 4. Land, push, release
1. On the branch, re-run the full PROFILE §6 table by exit code (the last gate before a
   release — `main` may have moved). Land commit per PROFILE §5 (`done/`, the `log.md` line,
   `CLAUDE.md` status in place within its budget).
2. `git -C <repo> checkout main`, `git fetch origin`, `git merge --ff-only origin/main`,
   `git merge --no-ff robot/NNN-slug -m "Merge robot/NNN-slug: <title>"`, **push**. Rejected
   → fetch, `git merge --no-edit origin/main` (a conflict → `git merge --abort`,
   `git reset --hard origin/main`, park the task, whose branch still holds the work), push.
   Then `git branch -d robot/NNN-slug` and `git push origin --delete robot/NNN-slug` if it
   was pushed. Wait for the push's CI run (`gh run watch` on `gh run list --limit 1`): red
   → tell Gabriel and skip this run's release.
3. **Release — every run, landed or not**: `deploy/release.sh --unattended`. Exit 0 =
   released or nothing new; 3 = held; 4 = wait (the next run asks again); anything else =
   failed. Forward every `note: …` line it prints to Gabriel (§7), except the one saying
   "not repeated". A failure → tell Gabriel its last line.

## 5. Unfinished, or parked
- **Unfinished**: a dated `## Progress log` entry, marked `(robot, unfinished)`, ending with the exact
  next step; commit on the branch; `git push -u origin robot/NNN-slug`; check out `main`.
  Then §4.3 (release) and stop — the next run resumes it.
- **Park** (LOOP §4): checkpoint and push the branch as above; on `main`: `## Questions`
  (each answerable in a line, your recommendation first), `status: blocked`, keep
  `branch:`, `git mv` → `blocked/`, commit `tasks: park NNN (robot)`, push; tell Gabriel.
  Then §4.3 and stop.

## 6. Never
Answer a product, UX or policy question yourself; work a `blocked/` task; edit
`deploy/release-gate.mjs`'s rules or any budget to get a task through; use `--force`
anything; release with red gates.

## 7. Tell Gabriel, report, stop
A push notification (one line, < 200 characters) only for: the release `note:` line; a
park ("robot parked NNN: <first question>"); a stop that needs him (dirty or diverged clone,
no Workflow tool, a failed release). Never routine progress or "nothing to do". Then print:
task id + title, outcome (landed / unfinished / parked / nothing eligible), gates, the
release verdict, owed checks. Leave the clone on `main`, clean. Stop.
