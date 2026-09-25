---
id: 2026-09-22-029
type: feature
title: Feedback triage routine — instructor reports auto-filed by a routine catcher, student reports triaged (clear fixes filed, the rest flagged for review)
priority: normal
size: large
requires: human
area: pipeline
source: chat
created: 2026-09-22T10:30:00-07:00
status: ready
after: 2026-09-21-018
branch:
merged_into:
---

## Description
Gabriel (2026-09-22, "adding it to the task list, not asking for it now"): feedback filed
from inside the app should flow into the task pipeline automatically. **From an instructor:**
straight through a routine version of the catcher and into `tasks/`. **From a student:**
triaged and inspected — a clear bug, fix or obviously-needed change goes to the catcher;
a feature request, a bigger change or something off-topic is **flagged for review**.
Provenance: chat, catch session 2026-09-22.

Stage 1 — getting reports out of the app into `tasks/inbox/` — is task 018 (updated today to
carry the author's role). This task is the routine that consumes them.

### What exists
- Reports: `POST /api/feedback` (any signed-in user), `GET /api/feedback` (instructor), status
  open/resolved (`server/src/app.ts:594, 656, 660`; table `feedback` — email, category
  (`platform design` | `homework content`), message, ≤ 2 screenshots, `context`, status —
  `server/src/db.ts:129–140, 396`). The author's ROLE is not stored; 018 joins it from the
  users table at pull time.
- The catcher (`tasks/CATCHER.md`) is interactive: it asks Gabriel at product forks. A routine
  cannot ask — it must file `ready` when the fix is clear and `blocked/` (with `## Questions`)
  when the product decision is not, which `/catch` already drains first thing.
- The worker routine (`tasks/WORKER.md`, `START.md`) shows the unattended pattern: one claim,
  worktree, gates, no pushes, ≤ 3 `Explore` agents, a ledger with a size rule.

## Done when
1. **A routine catcher prompt** `tasks/CATCHER-ROUTINE.md` (budgeted by `check-budgets.mjs`):
   the diagnosis discipline of `CATCHER.md` §4–7 with the interactive parts removed — never
   asks; files `ready` or `blocked`; dedupes against `incoming/`/`blocked/`/`in-progress/`;
   commits on `main` only when the checkout is clean, otherwise leaves the inbox item and
   exits; never pushes.
2. **A triage prompt** `tasks/TRIAGE.md` and command `/triage`: reads each pending report in
   018's private working copy (`~/making-minds-private/feedback/feedback-*.md`, after
   `node tasks/tools/feedback.mjs pull`); **instructor** author → hands it to the routine
   catcher; **student** (or `unknown`) author → classifies it as `fix` (a reproducible bug,
   a broken statement, a wrong answer key, a clearly missing affordance) → routine catcher;
   `personal` (about the student) → `mark personal`, never filed; or `review` (feature
   request, bigger change, off-topic, unclear) → a server-side `review` mark (a fourth
   triage outcome added to 018's `filed | personal | dismissed`), NOT a committed ledger.
3. **`/catch` surfaces the reports marked `review`** right after `blocked/`, fetched from the
   server (a `feedback.mjs` subcommand), paraphrased; for each, Gabriel says file / not now /
   discard, and the catcher re-marks it (`filed` / `dismissed`).
4. **Every filed task** carries `source: feedback`, the report id, author role and category,
   and follows CATCHER.md §3's privacy rules (no name/email, no verbatim text, no screenshot);
   every report handled gets a `mark`; the routine never marks a report resolved.
5. **Scheduling** is documented in `START.md` beside the worker (a cron/launchd line on this
   Mac, where `secrets/feedback.env` lives, running `feedback.mjs pull` then `/triage`), but
   activation is Gabriel's call (as for 017).

## Design
- **Rebased on 018 (2026-09-24).** The repo is public, so raw reports never enter git: they
  stay on the server, the pull keeps a working copy outside the repo, and what the pipeline
  did with each report is a server-side triage mark shown in the Feedback tab. That replaces
  this task's original `inbox/feedback-*.md` files, `inbox/review/` folder and committed
  `tasks/review.md` ledger (student-derived text in a public history). Adding `review` means
  extending `FeedbackTriageOutcome` (`app/src/types.ts`), the route's validation
  (`server/src/app.ts` `PUT /api/feedback/:id/triage`), the queue's tag and
  `server/tools/feedbackCheck.ts`.
- **deepFix (recommended):** the routine catcher is a MODE of the catcher's discipline, not a
  second diagnosis method — same schema, same dedupe, same "verify against the code" bar —
  so a task filed by feedback is indistinguishable from one Gabriel described. Triage is a
  thin classifier in front of it with exactly two outcomes and a human-facing ledger.
- **surgicalFix:** dump every report into `inbox/` and let the interactive catcher sort them
  (that is what 018 alone gives). Fine as a stop-gap; this task is the automation over it.
- Decisions recorded at intake: instructor feedback is trusted (auto-filed, no triage);
  student feedback is filed only when it is a clear fix; everything else waits for Gabriel.
  Open for `/work` (not product): whether triage runs as one Claude session over all pending
  files or one per file.
- Context budget (PROFILE §9): both prompts are short, read the inbox file and PROFILE.md
  only, fan out with ≤ 3 `Explore` agents, never `cat` ledgers.

## Verify
- Dry run against a local server: `npm run seed -- --sample`, file one report as Prof. Ada
  and two as John Doe (one "the Rotate button rotates the wrong way", one "please add dark
  mode"), run 018's pull, then `/triage`: the instructor report and the bug become task files
  (`ready` or `blocked`) with `filed` marks, the dark-mode request gets a `review` mark, and
  `git diff` shows no email, quote or screenshot; a second run changes nothing (idempotent).
  `check-budgets.mjs` covers the new prompts. Owed: the scheduled run itself (requires: human).

## Progress log
