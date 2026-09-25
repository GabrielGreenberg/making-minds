# ROBOT-WORK — the robot's work routine (started by the catch routine, or "Run now")

You are one unattended run on the robot: Gabriel's always-on Mac, in the work clone
`~/making-minds-robot` (`<repo>` below; setup: `START.md` §"The robot"). Nobody is watching
and nobody can answer. Do §1 first; then read `tasks/PROFILE.md` and `tasks/LOOP.md` §2
(selection), §3 (the task workflow) and §4 (parking) — after the sync, so you read today's
rules (re-read this file too if the sync changed it). This file overrides them where it
differs. Work **exactly one task**, then release, then stop. Parking beats doing the wrong
thing. "Stop" below means end the run there, skipping the release step, unless it names §4.6.

## 0. Rules of this run
- This clone only. Never read `~/making-minds-private/` (raw feedback): you work from the
  catcher's distilled tasks, never a student's words.
- Your branches are `robot/NNN-<the task file's slug>`; `task/` branches are Gabriel's
  sessions' — never touch them. Never force-push or rewrite pushed history; never delete a
  branch you didn't make.
- Pushing is part of the job (PROFILE §2: land = push): the claim at once, the land at once.
- Release only through `deploy/release.sh --unattended` (task 042's gate), never by hand.
- One `mm-task` Workflow per run (≤ 8 agents) is your only multi-agent use (PROFILE §9).

## 1. Sync and check
`git -C <repo> status --porcelain` must be empty (dirty = a run crashed mid-edit: tell
Gabriel, stop). `git -C <repo> fetch origin --prune`; `git -C <repo> checkout main`;
`git -C <repo> merge --ff-only origin/main`. If that fails because `main` is only *ahead*
(`git merge-base --is-ancestor origin/main main`: a land whose push failed), push it; if
it has diverged, tell Gabriel and stop. No Workflow tool in this session → tell Gabriel
(a setup fault, task 043) and stop. Note whether you have the browser pane's tools.

## 2. Pick — first match wins
1. **Resume**: an `in-progress/` task whose `branch:` starts with `robot/`. Check it out
   (from `origin/` if not local) and continue from its progress log's last line. Its third
   `(robot, unfinished)` entry → park it instead: it doesn't fit a run.
2. **Claim**: the top eligible `incoming/` task by LOOP §2.2 (`status: ready`, its `after:`
   in `done/`, `requires:` empty — or `browser` only if you have the browser pane). On
   `main`: `status: in-progress`, `branch: robot/NNN-slug` (or the branch the file already
   names — a parked task Gabriel released), `git mv` → `in-progress/`, commit
   `tasks: claim NNN (robot)`, and **push before any work** — the claim is the lock between
   the machines. Rejected → `git fetch`, drop the claim (`git reset --hard origin/main` —
   safe: after §1 this clone has nothing else unpushed), re-check the task is still in
   `incoming/`, and claim it or the next one; at most 3 tries. Then check out the branch
   (`-b` if new; a named branch from `origin/`).
3. **Nothing eligible** → §4.6 (the release step: pushed laptop work still ships), then stop.

## 3. Work it
Run the task workflow by path: `Workflow({scriptPath: "<repo>/.claude/workflows/mm-task.js",
args: {task, branch, repo: "<repo>", today, coauthor}})` (LOOP §3). It runs in the
background: wait for its completion notification, doing nothing else meanwhile. Read the
result; spot-check it (`git diff --stat main`, a file or two).
- `needsGabriel` non-empty → park (§5) with those as the questions.
- **Visual checks.** An eyeball the task needs in order to land (`requires: browser`, or its
  `## Verify` says so): do it yourself against this clone's dev server — `.claude/launch.json`
  → "Robot Dev Server" — as LOOP §2.5 says; fix small misses, send a bigger one back into the
  workflow (resume it with the finding). Any other eyeball, the Plan's `owedChecks`
  included: write it into the progress log as owed, not claimed, and land.
- Gates still red after the workflow's rounds plus one attempt of yours → park.
- Out of time or context before it's done → §5 "Unfinished".

## 4. Land, push, release
1. On the branch: `git fetch origin`, `git merge --no-edit origin/main` (a conflict →
   `git merge --abort`, park). If that brought anything in, re-run the full PROFILE §6 table
   by exit code (what ships is what was gated); if not, the workflow's gates stand.
2. `CLAUDE.md`: edit it only where a Part 1/Part 2 line is now false, in place, trimming an
   equal amount (LOOP §5) — unsure → leave it and say so in the progress log. Then the land
   commit per PROFILE §5 (`done/`, the `log.md` line).
3. `git checkout main`, `git merge --ff-only origin/main`,
   `git merge --no-ff robot/NNN-slug -m "Merge robot/NNN-slug: <title>"`, **push**.
4. Rejected (someone pushed meanwhile) → `git fetch`, `git reset --hard origin/main` on
   `main`, and on the branch drop the land commit (`git reset --hard HEAD~1` — it was never
   pushed); back to 4.1, once. Rejected twice → §5 "Unfinished".
5. `git branch -d robot/NNN-slug`, and `git push origin --delete robot/NNN-slug` if it was
   pushed. Wait for the push's CI run (`gh run list --limit 1`, then `gh run watch <id>`).
6. **Release — every run, landed or not**: `deploy/release.sh --unattended`. Exit 0 =
   released or nothing new; 3 = held; 4 = wait (the gate re-asks next run — CI still
   running, night, a deadline); anything else = failed. Forward its `note: …` line to
   Gabriel (§7), except the one saying "not repeated". A failure → tell Gabriel its last line.

## 5. Unfinished, or parked
- **Unfinished**: a dated `## Progress log` entry, marked `(robot, unfinished)`, ending with
  the exact next step; commit on the branch; `git push -u origin robot/NNN-slug`; check out
  `main`. Then §4.6 and stop — the next run resumes it.
- **Park** (LOOP §4): if the branch holds an unpushed land commit, drop it first
  (`git reset --hard HEAD~1`). Checkpoint and push the branch as above; on `main`:
  `## Questions` (each answerable in a line, your recommendation first), `status: blocked`,
  keep `branch:`, `git mv` → `blocked/`, commit `tasks: park NNN (robot)`, push; tell
  Gabriel. Then §4.6 and stop.

## 6. Never
Answer a product, UX or policy question yourself; work a `blocked/` task; edit
`deploy/release-gate.mjs`'s rules or any budget to get a task through; use `--force`
anything; release with red gates.

## 7. Tell Gabriel, report, stop
A push notification — one line, cut to 200 characters — only for: the release `note:`
line; a park ("robot parked NNN: <first question>"); a stop that needs him (dirty or
diverged clone, no Workflow tool, a failed release). Never routine progress or "nothing to
do". Then print: task id + title, outcome (landed / unfinished / parked / nothing
eligible), gates, the release verdict, owed checks. Leave the clone on `main`, clean. Stop.
