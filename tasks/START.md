# START — launching the pipeline

Read this after a break. Keep it current.

## The roles

| Want to… | Do |
| --- | --- |
| Report a problem, dump ideas, answer parked questions | Open a session at the repo root, type `/catch`. Talk. It files task files under `tasks/` and pushes each one. It also brings you the robot's questions: student fixes waiting for your yes, and feedback marked "Needs your call". Drop longer notes in `tasks/inbox/` first if you like (from any machine — commit + push; the robot files them within the hour). |
| Work on something | `/work` (or `/work 007` to go straight to a task). It offers options; you pick; it claims, branches, works, checkpoints, lands, pushes. Sessions can end mid-task: the progress log's last line is the resume point, and the next `/work` offers "resume" first. |
| Work the queue while you're away, on this laptop | `/loop /work-loop` (keep the app open). It takes the ready tasks one by one in priority order, lands and pushes each, parks decisions as questions in `blocked/`, and stops with a report. Add `release`, `max=N` or task ids to widen or narrow it. It costs real money: several agents per large task. |
| Let the robot catch and work around the clock | The robot, on the always-on Mac — §"The robot" below. Hourly: it files app feedback, then works one ready task, pushes it and releases through the gate (task 042). |

Pushing to GitHub `main` is shipping: the robot releases whatever is new there within the
hour, unless the gate holds it (grading, homework content, sign-in, the database, `deploy/`,
missing backups, a failed CI) — then it tells you once and you release by hand
(`deploy/release.sh`). Pushes that touch only `tasks/` or docs never release anything.

## The robot

Two scheduled routines in the Claude app on Gabriel's always-on Mac, each in its own clone:
**catch** (hourly; `ROBOT-CATCH.md`) and **work** (no schedule; started by catch's last step
or "Run now"; `ROBOT-WORK.md`). Two clones because a work run can outlast the hour: the
next catch must never switch branches under it. Set it up once, with a Claude session on
that Mac told "set up the robot using `tasks/START.md`" (task 043), Gabriel at hand:

1. **Tools**: the Claude desktop app signed in as Gabriel; Node ≥ 22.5; git; `gh`.
   `gh auth login` (HTTPS) and `gh auth setup-git`, so both clones push as Gabriel.
2. **Clones** (`https://github.com/GabrielGreenberg/making-minds.git`):
   `~/making-minds-robot` (work) and `~/making-minds-robot-catch` (catch). In each:
   `git config user.name "Gabriel Greenberg (robot)"` and `user.email` as on the laptop.
   `npm ci` in the work clone's `app/` and `server/` (the catch clone needs none).
3. **Private files — Gabriel copies them by hand** (AirDrop or a USB stick; never git, never a
   chat): into the work clone `secrets/cloudflare.env`, `secrets/feedback.env` and
   `ssh/LightsailDefaultKey-us-west-2.pem` (`chmod 600`); into the catch clone
   `secrets/feedback.env` only. All gitignored.
4. **The work clone's dev server**: create its gitignored `.claude/launch.json` with one
   configuration, `"name": "Robot Dev Server"`, `npm run dev --prefix app`, port 5190.
5. **Check the pieces by hand**, in a session in each clone: `node tasks/tools/feedback.mjs
   list --review` (catch: the credentials work); `deploy/release.sh --check` (work: ssh and
   the pilot API answer); `npm run check` in `app/` and `server/` (work: the gates run here).
6. **The two routines** (the app's Scheduled tasks; model **Opus 5.5**; the permission mode
   that runs without prompts):
   - `mm-robot-work` — **no schedule**; working folder `~/making-minds-robot`; prompt:
     `Read tasks/PROFILE.md, then tasks/ROBOT-WORK.md, both in full, and follow
     ROBOT-WORK.md exactly: one task, then the release step, then stop.`
   - `mm-robot-catch` — hourly, `0 * * * *`; working folder `~/making-minds-robot-catch`;
     prompt: `Read tasks/PROFILE.md, then tasks/ROBOT-CATCH.md, both in full, and follow
     ROBOT-CATCH.md exactly. Its last step always starts the mm-robot-work routine.`
     The id `mm-robot-work` matters: the catch routine looks it up by that name.
7. **Approvals**: "Run now" each routine once while watching and "always allow" every tool
   it asks for (Bash, Read, Edit, Write, Glob, Grep, Workflow, the scheduled-tasks tools,
   push notifications, the browser tools). Confirm, and write into 043's log: the Workflow
   tool runs in a routine and the run waits for it; the browser pane works; a push
   notification reaches the phone. Whatever doesn't, fix this recipe (and the prompts).
8. **Always on**: the Claude app opens at login and stays open (routines run only while it
   is); its keep-awake setting on; the Mac never sleeps (System Settings → Energy).
9. **After a day**, the transcript probe, in `~/.claude/projects/*making-minds-robot*/*.jsonl`:
   the first assistant message's `usage` (input + cache_read + cache_creation) is the
   starting context — well under 100k; no `"subtype":"compact_boundary"` records (no
   compactions); no `isApiErrorMessage` records (limit errors). And no double claims or
   stuck rejected pushes between the laptop and the robot.

**Stopping it**: disable `mm-robot-catch` in the app — the work routine then never starts.
A run in flight finishes its task first. **Holding releases** without stopping it: the
gate's rules in `deploy/release-gate.mjs` (hold list, hours, deadline freeze).

## Later, deliberately not built yet

- **Auditor** (the robot's idle mode: audit one surface read-only, file findings) — add
  once the robot is stable. The Virgil template's §7 is the recipe:
  `~/virgil-tasks/AUDITOR.md`.
