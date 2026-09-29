---
id: 2026-09-29-086
type: feature
title: Mark a Feedback report resolved on its own once the pipeline has fixed it — when every task it was filed into is done and live
priority: normal
size: large
requires:
area: server
source: feedback
created: 2026-09-29T15:12:00-07:00
status: ready
after:
branch:
merged_into:
---

## Description
App Feedback report `fb-mun6lunz-z7k56e` (author-role: instructor, category: platform
design; filed from HW1 P4): in the instructor's Feedback tab, a report should be marked
**resolved** automatically when the robot resolves it. Today it stays **open** until
Gabriel resolves it by hand, even after the task filed from it has landed and shipped.

That is by design so far, and this task reverses the rule at Gabriel's request:
- `tasks/tools/feedback.mjs:33` says marking "Never marks a report resolved; that stays the
  instructor's act in the app". `tasks/CATCHER.md:73` says "Marking never resolves a
  report; that stays Gabriel's call". Task 018's design has the same rule
  (`tasks/done/2026-09-21-018-feedback-queue-detector.md:45`).
- The pipeline's only write is the **triage mark**: `PUT /api/feedback/:id/triage`
  (`server/src/app.ts:1232`), stored as JSON `{outcome, tasks?, note?}` in `feedback.triage`
  (`server/src/db.ts:363`, `setFeedbackTriage` at `:1185`). The **status** (`open` /
  `resolved`) is the separate `PUT /api/feedback/:id/status` (`app.ts:1212`), which only the
  Feedback tab calls.

What "the robot resolves it" means, as built here (defaults. Gabriel can change them
later, see Design):
- **filed** → resolved once **every** task named in the mark is **done and live**: its file
  is in `tasks/done/` in the code the pilot is running. A fix only counts once students have
  it. Whoever landed the task (the robot or `/work`) and whoever released it (the gate or
  Gabriel by hand) doesn't matter.
- **dismissed** (not a report, already fixed, declined) → resolved when marked: the
  pipeline has closed it.
- **personal** and **review** → left open. They are waiting for Gabriel.
- A report Gabriel re-opens after an automatic resolve **stays open**. The automatic
  resolve happens once per report.

## Done when
- A report marked `filed` with task ids becomes `resolved` on its own once all of those
  tasks are in `tasks/done/` of the live code, with no instructor action. A report whose
  tasks are only partly done, or done on `main` but not yet released, stays open.
- A report marked `dismissed` is `resolved` when the mark lands.
- `personal`, `review`, and unmarked reports are never resolved automatically.
- Re-opening an automatically resolved report in the Feedback tab sticks: it isn't
  resolved again on the next restart or sweep.
- The Feedback tab shows that the pipeline resolved it: e.g. "Resolved: fixed by 085"
  or "Resolved: dismissed by the robot", next to the existing triage mark.
- `feedback.mjs`'s header, `tasks/CATCHER.md` §3 and `tasks/ROBOT-CATCH.md` describe the
  new rule in place of the old one. The `CLAUDE.md` Server row gets the new behaviour in a
  few words if it fits the budget.
- Local mode (no server) is unchanged: `LocalFeedbackStore` has no pipeline.

## Design
- **deepFix (recommended): the server resolves on its own, from the code it is running.**
  On the box, the server runs from the release clone (`repoDirFor`,
  `server/src/robotStatus.ts:65`; `app.ts:1303` already gives it to the robot panel).
  So `<repoDir>/tasks/done/` lists exactly the tasks that are **live**, and every release
  restarts the server. Add a pure `feedbackResolution.ts` (server): given the open reports'
  triage marks and the set of done task ids (from `tasks/done/` file names, `YYYY-MM-DD-NNN-`
  prefix, plus each file's `status` / `merged_into`), return which reports to resolve and
  why. Run it (a) once at server start, and
  (b) in the triage `PUT` for `dismissed`, and for `filed` when every named task is already
  done (a late filing into a finished task). Record the automatic resolve **inside the
  triage JSON** (`autoResolved: {at, reason, tasks?}`), so the sweep skips a report once it
  has been auto-resolved and a re-open sticks. This needs **no schema change**, so no
  `db.ts` edit and no held release (`deploy/release-gate.mjs` HOLD_PATHS lists `db.ts`).
  The status change goes through the same db method the status route uses. **Merged
  tasks:** README §Lifecycle moves a merged task to `done/` with `status: merged` and
  `merged_into: <id>`, so being in `done/` is not enough. Read the frontmatter: a merged
  task counts only once its `merged_into` task is itself done, following the chain.
- **Alternative:** a `feedback.mjs resolve` command that the robot's catch routine runs
  every hour. It reads the live commit from `/api/robot/status`, asks git whether each
  task's land merge is an ancestor, and calls the status route. More moving parts
  (ancestry, the mirror, a second writer of status), and a hand release waits up to an hour
  to be noticed. Only worth it if reading `tasks/done/` on the box turns out to be wrong
  (check that the release clone's working tree is what's running: release.sh pulls, then
  restarts).
- **surgicalFix:** the work routine calls the status route for the task's reports right
  after it lands. Wrong: this resolves before release, misses `/work` landings and hand
  releases, and puts pilot credentials into the work routine. Not recommended.
- **Dev/local:** `repoDir` in dev is the checkout itself, so a dev server resolves against
  the local `done/`. That's harmless (a dev database), but say so in the code comment.
  An in-memory database (the harnesses) takes the done set as a parameter to stay
  deterministic.
- **The Feedback tab:** `app/src/instructor/FeedbackQueueView.tsx` renders status + triage.
  Add the one-line "Resolved: fixed by NNN" label from `triage.autoResolved`. The
  `FeedbackStore` seam and the shared types carry the new optional field. It isn't
  student-visible: the queue is instructor-only.
- **Law 9:** nothing here moves report text into git. The sweep reads task ids and file
  names only.

## Verify
- Gates: both `tsc`s, `npm run build`, `npm run check` (app), `npm run check` (server).
- Pins in `server/tools/feedbackCheck.ts`:
  - The pure resolver:
    - filed [A] with A done → resolve;
    - filed [A,B] with only A done → keep open;
    - dismissed → resolve;
    - personal / review / unmarked → keep open;
    - already `autoResolved` and re-opened → keep open;
    - merged into a done task → resolve;
    - merged into an open one → keep open.
  - End to end on a real server with a temp `done/` directory: mark `filed`, start the
    server, and the report comes back resolved with the reason. Re-open it, restart, and it
    is still open. A dismissed mark resolves at once.
- The app's `remoteStoreCheck` (or the Feedback view's pin) covers the new label's field
  passing through the seam.
- Owed: on the pilot after release, one real report filed into a task that has shipped
  shows as resolved in the Feedback tab (Gabriel's eyeball, or the robot panel's next
  read).

## Progress log
