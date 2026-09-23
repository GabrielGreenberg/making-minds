# LOOP — the attended work loop (`/loop /work-loop`)

You are the loop session. Gabriel starts you and mostly steps away; you work the ready
queue **one task at a time, each in depth**, until nothing more can move without him. You
are the work session (`WORK.md`) with two substitutions: Gabriel's pick is replaced by the
selection rule below, and each task's heavy lifting runs in **one Workflow**, so this session
holds conclusions, not file dumps. `PROFILE.md` and `WORK.md` apply in full except where this
file says otherwise. Read all three once per session; on a re-fire, if they're already in
your context, don't re-read them.

## 1. Standing authority (granted by starting you)

- Claim, branch, implement, verify, land (merge `--no-ff` into `main`) without asking.
- Run Workflows: one per task, serial. Starting this loop is the explicit opt-in.
- **Not granted:** pushing, releasing, answering product questions, working `blocked/` tasks,
  deleting branches or worktrees you didn't create.
- **Arguments** (after `/loop /work-loop`): `push` = after each land, push `main` and confirm
  `gh run list --limit 1` is green; `release` = `push` plus `deploy/release.sh` after each
  push; `max=N` = stop after N landed tasks; a task id or list = work only those.

## 2. One iteration = one task

1. **Orient** (WORK §A, abridged). If on a `task/` branch whose task is in `in-progress/`,
   resume it. If the checkout has modified files you didn't make (someone's work in
   flight), wait: ScheduleWakeup 1200 s and re-check; on the third sight, stop (§6).
2. **Select.** Eligible: `tasks/incoming/`, `status: ready`, its `after:` id in `done/`,
   `requires:` empty or only `browser`, not parked this session. Order: priority
   (urgent > high > normal > low); within it, a task whose `after:` just landed; then
   oldest id. Nothing eligible → §6.
3. **Claim** (WORK §C.2): the claim commit on `main`, then `task/NNN-slug`.
4. **Run the task workflow** (§3), in the background, with a ScheduleWakeup fallback of
   1800 s. When it completes, read its result. `needsGabriel` non-empty → park it (§4).
5. **Visual check** yourself, in this session, for `requires: browser` or any visible change.
   The workflow's agents can't use the browser pane. Use `.claude/launch.json` → "Vite Dev
   Server" (restart it after bulk edits). Prefer `get_page_text`/`read_page`; screenshots at
   scale ≤ 0.6. Attachments: headless Chrome `--screenshot` with a fresh `--user-data-dir`
   writes the file then hangs, so `pkill -f headless=new` after it. Fix small misses
   yourself; send anything bigger back into the workflow (resume it with the finding).
6. **Land** (WORK §E, PROFILE §5): gates green by exit code, the land commit, merge, delete
   the branch, CLAUDE.md status in place (§5). Then `push`/`release` if granted.
7. **Ledger:** one line in `<scratchpad>/loop-ledger.md` (id · outcome · merge commit), and
   print the compact running list. Then ScheduleWakeup 60 s with the same `/loop` prompt:
   the next iteration.

## 3. The task workflow (`.claude/workflows/mm-task.js`)

Use the saved workflow `mm-task` (args `{ task: "<task file path>", branch: "task/NNN-slug" }`).
If it doesn't exist yet, author it once (load the `workflow-authoring` skill first), run it
on the first task, and commit it on `main` (`tasks: add the mm-task workflow`). Its shape,
≤ 8 agents:

- **Plan** (read-only): PROFILE §6–§8, the task file, the code it points at. Returns the
  Done-when items mapped to changes, the check tool to add or extend, visual checks owed,
  and `needsGabriel[]`, which is non-empty only for product/UX/policy choices the task file
  doesn't settle. If it's non-empty, the workflow stops here.
- **Implement**: edits in the main checkout on the branch; adds the pin; the fast loop green.
  Never commits to `main`, merges, pushes, or touches `blocked/`.
- **Gates**: the full PROFILE §6 table by exit code; fix and re-run, at most 2 rounds.
- **Review** (1–2 read-only, adversarial): the diff against the Done-when and the
  load-bearing laws (PROFILE §8); findings with `file:line`, each verified.
- **Fix** the confirmed findings, then re-run the gates.
- **Checkpoint**: a dated `## Progress log` entry in the task file; commit code + log on the
  branch.

Result, kept short: `doneWhen[{item, met, evidence}]`, `gates{name: exitCode}`,
`changedFiles[]`, `owedChecks[]` (visual recipes), `needsGabriel[]`, `summary`. Trust it,
spot-check it (a file or two, `git diff --stat`), and don't re-read the whole diff.

## 4. Park, don't stall

Park when a task needs Gabriel: a product/UX/policy choice, a Done-when that can't be met as
written, gates still red after the workflow's fix rounds plus one attempt of yours, or
anything needing ssh, credentials or a real device. Do this:
- checkpoint on the branch;
- write `## Questions` in the task file, each answerable in a line, your recommendation
  first;
- set `status: blocked` and note the branch;
- `git mv` the file to `blocked/` and commit on `main`;
- check out `main` and go to the next task.

Technical choices are yours: take the deepest fix the evidence warrants (PROFILE §1) and
record why in the progress log. A **design task** (the deliverable is a memo): write the
memo, then park it for Gabriel's review. Don't implement it.

## 5. Context and cost

- One task and one workflow at a time. The checkout, dev server and browser are shared.
- Between tasks this session keeps only the ledger line; the story lives in the task file.
- `CLAUDE.md` sits at its 40 KB cap. A land that updates it replaces in place and trims an
  equal amount of stale detail (Part 2 parentheticals first). Never raise a budget without
  asking.
- Parallel `/catch` sessions commit on whatever branch the checkout is on. Their `tasks:`
  commits riding a task branch are harmless. A foreign **code** change is not: stop (§6).

## 6. Stop

Stop (ScheduleWakeup `stop: true`) when nothing eligible remains, `max=N` is reached,
foreign work in flight persists, or the same failure repeats on two tasks. Before stopping,
leave the checkout on `main` and clean. The final report:
- **Landed**: id · title · merge commit.
- **Parked**: id · its questions, verbatim, so Gabriel can answer them in one `/catch`.
- **Skipped**: id · why (`requires: human/ssh`, `after:` pending).
- **Pushed/released**: whether they happened, with the CI state.
- The one next step you recommend.

End with **"Done."**
