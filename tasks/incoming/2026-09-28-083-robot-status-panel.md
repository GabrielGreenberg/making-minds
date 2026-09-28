---
id: 2026-09-28-083
type: feature
title: Show the robot's state on the instructor Dashboard — what's live, what waits for release, what waits for Gabriel's answer
priority: high
size: large
requires: browser
area: server
source: inbox
created: 2026-09-28T11:45:00-07:00
status: ready
after:
branch:
merged_into:
---

## Description
From Gabriel's inbox note `tasks/inbox/_processed/2026-09-28-robot-status-panel.md` (written
in the 043 session on the robot). The robot's push notifications don't reach him: his phone
isn't on this Claude account. So he learns about a held release or a parked question only by
asking a Claude session. On 2026-09-27/28, seven landed tasks sat unreleased for a day. The
gate had held them (schema, sanitize, homework content) and nothing told him.

He wants the instructor's Dashboard to show, in plain words:
1. **What's live**: which version the pilot runs, and since when.
2. **What's waiting for his release**, with the reason in one line ("3 tasks — they change
   the database").
3. **What's waiting for his answer**: parked tasks (`tasks/blocked/`) with their first
   question, student-fix tasks waiting for his yes, and feedback reports marked `review`.
4. **What the robot did lately**: tasks landed, parked, claimed or filed, with times.

Constraints from the note: no phone, no new account, and no new secret if avoidable. It is
instructor-only, like the Feedback tab. It shows no report text and no student names
(PROFILE §8.9). **No "release now" button**: releasing stays a hand act on the robot.

Priority `high` (the catcher's call): until this lands, a held release reaches Gabriel only
if he happens to ask a Claude session.

## Done when
- The Dashboard has a **Robot** tab (`#/instructor/robot`, after Notes in
  `app/src/instructor/InstructorLayout.tsx:11` `SECTIONS`), built from the page vocabulary
  (`theme.css` / `pages.css`; `themeCheck` green). It has four sections, the four wants above:
  - **Live**: the short sha and subject the pilot runs, the newest `tasks: land` in its
    history (id and title), and when it was released (as a time, plus "3 h ago").
  - **Waiting for release**: one row per landed task on GitHub `main` that the pilot doesn't
    run yet (id, title, landed time). Above the rows, the verdict in one line **in the gate's
    own words**: `hold` → why, from `decide()`'s `brief`s ("held: the database schema and its
    migrations; what students may see"); `wait` → why ("outside release hours", "CI still
    running", "HW3 due in 20 h"); `current` → "Up to date". Changes that don't ship (queue,
    docs) never count as waiting (the gate's `QUIET_PATHS`).
  - **Waiting for your answer**: every `tasks/blocked/` file on GitHub `main` except
    `status: deferred`. Each row shows id, title and the **first** `## Questions` item cut to
    one line. A task whose first question is "Work this student-reported fix?" gets a
    "student fix" tag. Below the tasks, the count of feedback reports marked `review`, each
    as its report id and category only, linking to the Feedback tab. Never its text or
    author.
  - **Recent queue activity**: the last ~15 queue events on GitHub `main` (`tasks: land` /
    `park` / `claim` / `file` subjects, and merges of `robot/…` branches), newest first, with
    times. A robot event (`(robot)` or `(robot catch)` suffix, or a `robot/` branch) gets a
    "robot" tag.
  - An "as of <time>" line and a **Refresh** button. A failed refresh shows the last good
    answer and the error in one line, and never breaks the page.
- **When something waits for him, the Dashboard says so without a click**: a one-line strip
  over the tab row on every Dashboard tab, e.g. "Robot: 7 tasks held for your release · 2
  questions wait — Robot tab". The strip is absent when nothing waits.
- Server: `GET /api/robot/status` behind `auth, requireInstructor` (students get 403, pinned
  in `serverCheck`), served from a cache: a fetch at most every 10 minutes, plus
  `?refresh=1`. It never shells out with request input (fixed `execFile` args only) and never
  returns a 500 for a git or network failure: each section degrades to "unknown: <why>".
- **Local mode**: the tab shows "Not available in local mode" and makes zero `/api` calls
  (law 5). The Local store returns that answer. No `fetch` from local code.
- Gates: PROFILE §6, all green. One pure builder is pinned by a new `app/tools` check or by
  `server/tools/serverCheck.ts` (see Verify).

## Design
**Why the box can't answer today.** The box's clone (`/srv/making-minds/repo`, the server's
own `WorkingDirectory`, `deploy/makingminds-api.service`) moves only when a release pulls it
(`deploy/release.sh:123`). Queue commits are "quiet" and are never released
(`deploy/release-gate.mjs:60` `QUIET_PATHS`, `:157`). So the box's `tasks/` folder is stale
by design, and its `origin/main` is only as new as the last release. Every want except "what's
live" needs GitHub's current `main`. The gate's verdict exists today only on the robot, as
console lines from `node deploy/release-gate.mjs` inside `release.sh --unattended`, and as a
push notification that doesn't reach him.

**The reusable parts already exist.**
- The hold/wait decision is pure: `decide(facts)` (`deploy/release-gate.mjs:137`, typed by
  `release-gate.d.mts`, pinned by `server/tools/releaseGateCheck.ts`). The rules are data
  (`HOLD_PATHS` :45, `RELEASE_HOURS`, `FREEZE_HOURS`, `BACKUP_MAX_AGE_HOURS`). The
  landed-task parse is `gatherFacts`'s `tasks: land (\S+) — (.+)` (:325).
- The server already runs git in its own clone: `gitLineage` (`server/src/homeworks.ts:56`,
  `execFileSync('git', …)`).
- `review` marks are server data: the triage column (`server/src/app.ts:1222`; `GET
  /api/feedback` filtered on `triage.outcome === 'review'`, :1199).
- The backups dir is owned by the service user (`deploy/backup-install.sh:19`), so the server
  can read the newest daily copy's mtime itself.
- The repo is public, so fetching it needs no credential.

- **deepFix (recommended): the server works it all out itself, and the gate's rules stay the
  one definition.**
  1. **A fetch-only mirror, never the release clone.** Keep a bare mirror under the data dir
     (`<dirname(MM_DB_PATH)>/repo-mirror.git`, inside the unit's `ReadWritePaths`: no
     `deploy/` change, so no hand release is forced), cloned from the server clone's own
     `remote.origin.url`. `git fetch` runs in it at most every 10 minutes, and only when the
     panel is asked (a single in-flight promise, a timeout). Never fetch in
     `/srv/making-minds/repo` itself: a fetch racing `release.sh`'s `pull --ff-only` there
     can fail the release on a ref lock. A missing or failing mirror degrades to "unknown".
  2. **Facts (server I/O, `server/src/robotStatus.ts`)**:
     - `live` = own HEAD, subject, and release time. Use the HEAD reflog's newest entry time,
       else the process start time.
     - `mirror` = `origin/main` sha, `git log live..main` (subjects, times), and
       `git diff --name-only live..main`.
     - blocked files = `git ls-tree` + `git show main:tasks/blocked/<f>`.
     - `backup` = newest `daily-*.sqlite` mtime, plus `systemctl is-active
       makingminds-backup.timer`. Unknown if either can't be read.
     - `ci` = GitHub's public REST API (`actions/runs?head_sha=`, unauthenticated, cached with
       the fetch). Unknown → the gate's own "cannot read CI" wait.
     - `assignments` = own DB (visible + dueDate, as `listPilotAssignments` shapes them).
     - `now`.
  3. **The verdict is `decide()` itself.** Import `deploy/release-gate.mjs`: its import is
     side-effect free (pilot-api.mjs only defines constants). So the Dashboard's reason can
     never drift from what the robot's gate says. Don't re-list the hold paths.
  4. **One pure builder**: `robotStatusView(facts, gateResult)`, which parses front matter and
     the first `## Questions` item, classifies queue subjects, and tags robot and student-fix
     items. No I/O; pinned headless.
  5. **Seam**: a `RobotStatusStore` (`get(refresh?)`) with Local ("not available in local
     mode") and Remote (`api/client.ts` `robotStatus()`) impls, exported from
     `storage/backend.ts` like `feedbackStore` (:47). The tab and the strip read it through
     `useAsyncValue`.

  This answers all four wants with no robot change and no secret. It also reflects Gabriel's
  laptop pushes, and it stays right when the robot is down: then "Recent queue activity"
  simply goes quiet, which is itself the signal.
- **Alternative (not recommended as the first move): the robot reports.** At the end of every
  catch and work run, the robot would PUT a snapshot (its gate `--json`, blocked list, run
  outcome) to an instructor endpoint, with the pilot-api session it already has
  (`secrets/feedback.env`). The server would store one row. This gives the gate's exact
  answer plus robot liveness ("last run 10:30"). But it adds a step to both routines, goes
  stale by up to an hour, misses laptop activity until the next run, and a forgotten step
  fails silently. It is a good follow-up if liveness proves wanted: a small `heartbeat` row
  beside the deep fix, not instead of it.
- **surgicalFix**: the release gate writes its note into the shared Notes document, or files
  a Feedback report. That is one-way and unstructured, it misses blocked questions, and it
  abuses two surfaces built for other jobs. Rejected.
- **Security**: fixed-argument `execFile` only, a timeout on every child process, and the
  mirror URL taken from the server clone's config, never from a request. Blocked-task text is
  de-identified by the catcher's rules (`tasks/CATCHER.md` §3). Feedback appears only as id
  and category.
- **Sibling**: `2026-09-22-030` (Activity tab: class usage and Cloudflare traffic) is another
  instructor-only analytics tab. Keep the two separate, but share the tab/strip vocabulary if
  030 lands first.

### Members
- `tasks/inbox/_processed/2026-09-28-robot-status-panel.md`: Gabriel's note (inbox).

## Verify
- Gates: PROFILE §6, all.
- Pin the pure builder (new `app/tools/robotStatusCheck.ts` added to `npm run check`, or a
  `[robot-status]` section in `server/tools/serverCheck.ts`), feeding it synthetic facts:
  - a hold-list path → "held: …" with the gate's `brief`s;
  - quiet-only changes → "Up to date" and no waiting rows;
  - a deferred blocked task omitted;
  - the student-fix tag;
  - `(robot)` / `robot/` tagging;
  - a first question longer than one line is cut;
  - `review` feedback carries no message field.
- `serverCheck`: a student gets 403 on `/api/robot/status`. An instructor gets 200 against a
  temp git repo with a local bare remote (no network). A broken mirror path → 200 with
  "unknown" sections, not 500. `?refresh=1` refetches, and a plain second call within 10
  minutes doesn't.
- `remoteStoreCheck`: the Remote impl round-trips against the real server. The grader-import
  grep gate stays green.
- Local mode: `routingCheck` or a local-store pin shows the tab resolves with no `/api`
  traffic.
- **Owed, not claimed** (the eyeball): in the dev server's remote mode ("Vite Remote Mode" +
  a local server on 8199), open `#/instructor/robot`. Check the four sections, the strip on
  another tab, and Refresh. Check phone width.
- **Owed after the first release, on the box**: on the pilot as instructor, the Robot tab
  shows the pilot's sha, matching what `node deploy/release-gate.mjs` reports on the robot.
  `systemctl is-active` works as `makingminds`, else backup shows "unknown", which is
  acceptable. The mirror appears under `/srv/making-minds/data/`.

## Progress log
