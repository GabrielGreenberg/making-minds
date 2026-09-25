# START — launching the pipeline

Read this after a break. Keep it current.

## The three roles

| Want to… | Do |
| --- | --- |
| Report a problem, dump ideas, answer parked questions | Open a session at the repo root, type `/catch`. Talk. It files task files under `tasks/` and commits each one. Drop longer notes in `tasks/inbox/` first if you like (from any machine — commit + push). |
| Work on something | `/work` (or `/work 007` to go straight to a task). It offers options; you pick; it claims, branches, works, checkpoints, lands. Sessions can end mid-task: the progress log's last line is the resume point, and the next `/work` offers "resume" first. |
| Work the queue while you're away | `/loop /work-loop` (keep the app open). It takes the ready tasks one by one in priority order, lands each on `main`, parks decisions as questions in `blocked/`, and stops with a report. Add `push`, `release`, `max=N` or task ids to widen or narrow it. It costs real money: several agents per large task. |
| Let the routine drain small tasks | Not yet activated — see below. Foreground alternative any time: `/loop /worker` (advances only while that window is open). |

Both interactive roles may run in **ultracode** if you start them that way (you see the
spend). The routine never does.

## Activating the worker routine (when the heavy lifts are done)

> **Superseded (2026-09-25):** don't schedule `/worker`. Task 029 (the robot pipeline) replaces
> this section with §"The robot"; 017 is merged into it.

1. Make sure at least one `size: small` task with no `requires:` sits in `tasks/incoming/`.
2. Run it by hand once: open a session at the repo root, `/worker`. Grant the tools it asks
   for (Bash, Read, Edit, Write, Glob, Grep) with "always allow", so an unattended run never
   stalls on a permission prompt. Watch a full claim → worktree → fix → gates → merge →
   `done/` + `log.md` cycle.
3. Create the Claude Desktop **Scheduled Task**: hourly (`0 * * * *`), working directory =
   this repo root (never `tasks/`), model **Opus** (not Fable — far cheaper per token; the
   routine is deliberately small work), autonomous permission mode, prompt:
   `Read and follow tasks/WORKER.md. Process exactly one task this run, then stop.`
   It skips a fire while the previous run is active, so runs never stack. It only runs while
   the desktop app is open.
4. After a day, run the transcript probe: in
   `~/.claude/projects/-Users-gabriel-Programming-making-minds/*.jsonl`, the first assistant
   message's `usage` (input + cache_read + cache_creation) is the starting context — it must
   be well under 100k; `"subtype":"compact_boundary"` records are compactions — there should
   be none; `isApiErrorMessage` user records hold limit/thrash errors.
5. Flip task `2026-09-21-017` to done.

## Later, deliberately not built yet

- **Auditor** (the worker's idle mode: audit one surface read-only, file findings) — add
  once the catcher/worker loop is stable. The Virgil template's §7 is the recipe:
  `~/virgil-tasks/AUDITOR.md`.
- **Feedback-queue detector** — task `2026-09-21-018`: let `/catch` drain the app's own
  student feedback reports into `inbox/`.
