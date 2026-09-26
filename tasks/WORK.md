# WORK — the interactive work session (`/work`)

You are the work session: Gabriel opens you to spend a session on ONE task (or one tightly
related cluster) from the queue, with him present. Read `tasks/PROFILE.md` first; schema,
lifecycle and id rule are in `tasks/README.md`. You implement code, in depth, on a
`task/NNN-slug` branch in the main checkout, and you land it — or checkpoint so the next
session can. Everything the routine does, you do too, minus the size gate and plus a human.

## A. Orient
1. `git -C <repo> branch --show-current`, `git status --porcelain`, `git log --oneline -1`,
   and `git -C <repo> fetch origin` — the robot works the same queue (PROFILE §3); on a clean
   `main`, `merge --ff-only origin/main` before surveying. If the checkout is already on a
   `task/` branch, that task is the first resume candidate: read its file from
   `tasks/in-progress/` right there. `robot/` branches are the robot's: never resume them.
2. Read (names + frontmatter only, then the last progress-log line): `tasks/in-progress/`
   (resume candidates; if `branch:` is set and you're on `main`, read the branch's copy:
   `git show <branch>:tasks/in-progress/<file>`), `tasks/incoming/` (the ready pool),
   `tasks/blocked/` (needs Gabriel's answer — offer to take an answer now, catcher-style).
   Skip `done/` and `log.md` except the last few lines.
3. If arguments were given to `/work`, resolve them to a task and jump to C.

## B. Propose and offer
1. **Clusters.** If two or more ready tasks are one disease (same root mechanism, same seam,
   one fix retires both), propose merging them: name the survivor and the members. Only on
   Gabriel's yes: add `### Members` to the survivor, set the absorbed files to
   `status: merged` + `merged_into:`, `git mv` them to `done/`, commit on `main`
   (`tasks: merge NNN into MMM`), push.
2. **Options.** Offer 3–5, each one line: `NNN · title · size · priority · why now · blockers
   (after:/requires:)`. Order: resume candidates first, then urgent/high, then whatever
   Gabriel has said he's focused on, then oldest. Mark ONE as recommended and say why in a
   sentence. Then ask which. (Two tightly coupled tasks can be one session; say so.)

## C. Claim
1. If the task lacks a real `## Done when` or `## Design` (root cause, deepFix/surgicalFix,
   file pointers), **diagnose first**, with Gabriel: read the code, write those sections
   into the file, state the family of phenomena and which fix depth you propose and why
   (NORTH_STAR). Get a yes on the plan before touching code. A significant architectural
   move gets a design memo in `docs/buildout/designs/<slug>.md` first.
2. Claim on `main` (README §Lifecycle): `status: in-progress`, `branch: task/NNN-slug`,
   `git mv` → `in-progress/`, commit `tasks: claim NNN`, and **push it at once** — the claim
   is the lock between the machines. Rejected → fetch, merge `origin/main`; if the robot
   took the task meanwhile, tell Gabriel and offer the next. Then
   `git -C <repo> checkout -b task/NNN-slug`.
   If the checkout isn't on `main` and clean, stop and sort that out with Gabriel first —
   never stash or discard someone else's work in flight.

## D. Work
- Depth over patches, scoped to the real phenomenon (PROFILE §1). Route through the seams.
- Verify HEAD before and between writes; absolute paths; explicit `git add`.
- Delegate reads: `Explore` agents for fan-out, conclusions only in this session. You may
  use Workflows/ultracode if Gabriel started you that way. Implement edits **yourself** in
  this checkout (subagents write here too — that's fine for `/work`, unlike the routine).
- Verify as you go with the fast loop (PROFILE §6); use the browser preview for anything
  visual (`.claude/launch.json` → "Vite Dev Server") — verify and show proof, never ask
  Gabriel to check manually.
- When a task names a contract, extend the matching `app/tools/*Check.ts` (or server tool)
  with a pin. The harness is the test suite.
- **Checkpoint** at every natural stop (gates green on a coherent unit, or when the session
  is getting long): append a dated `## Progress log` entry — what's done, what remains,
  **the exact next step** — commit it on the branch with the code. A cold session must be
  able to resume from that line alone.

## E. Land (PROFILE §5)
All gates green (both `tsc`s, app build, app check, server check — by exit code). Then the
land commit on the branch (`done/` + `log.md` line), merge `--no-ff` into `main`, **push at
once** (land = push, PROFILE §2 — the robot releases it through the gate within the hour),
confirm `gh run list --limit 1` is green, delete the branch.

**Update `CLAUDE.md` in place** if what's built or how it works changed: the affected Part 1
status lines and Part 2 entries — replace, don't append; it must stay ≤ 40 KB (the land gate
fails otherwise). The dated story is already in the task file.

## F. Ending mid-task
Checkpoint (D), commit on the branch, leave the checkout on the branch if you'll resume
soon — otherwise `git checkout main`. Either way the file's `branch:` says where the code is.
If the task turns out to need a product decision Gabriel can't make now: park it
(`## Questions`, `status: blocked`, `git mv` → `blocked/`, commit on `main`, push), keep the
branch, note the branch name in the file.

## Output conventions
Compact running list (`NNN · title — STATUS`), clickable links for every file written, and
close with **"Done."**
