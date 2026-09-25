---
id: 2026-09-21-018
type: feature
title: Pull open feedback reports from the server into a private folder outside the repo, with the author's role and a server-side triage mark (stage 1 of the feedback pipeline)
priority: normal
size: large
requires: browser, human
area: pipeline
source: chat
created: 2026-09-21T15:30:00-07:00
status: done
after:
branch:
merged_into:
---

## Description
The app has a "Feedback" form feeding an instructor queue (`FeedbackStore`;
`GET /api/feedback`, `PUT /api/feedback/:id/status`). It is a natural detector for the task
pipeline: the catcher should be able to drain open reports and diagnose them like any other
intake.

Updated 2026-09-22 (catch): this is STAGE 1 of the feedback pipeline Gabriel asked for — task
2026-09-22-029 is the triage routine that consumes these reports, and it needs to know whether
the author is an instructor or a student. The `feedback` table stores email, category,
message, screenshots, `context` and status but NOT the role (`server/src/db.ts:156–167`).

Re-diagnosed 2026-09-24 (`/work`, with Gabriel): **the repo is PUBLIC on GitHub**
(`GabrielGreenberg/making-minds`). The original plan (one file per report committed to
`tasks/inbox/`, screenshots to `tasks/attachments/`) would publish student emails, messages and
screenshots (which show the signed-in name and the student's work) — FERPA-class data, the
same class `.gitignore` already keeps out (class lists). Students may also use the form,
mistakenly, for personal matters. Raw reports must never get near git; only a distilled,
de-identified task may.

## Done when
1. **The author's role is on the record.** `feedback` gains `author_role`, stamped at filing
   from the session (`req.user.role`); existing rows are backfilled once from `users`. Local
   mode stamps it the same way (the seam's `submit` takes `authorRole`). `PlatformFeedback`
   carries `authorRole?: Role` (absent = unknown, e.g. an author later removed).
2. **Processing is remembered on the server.** `feedback` gains a triage mark:
   `filed` (with the task ids it became or joined), `personal` (about the student — left for
   the instructor, never filed) or `dismissed` (noise / duplicate / already done, with a short
   note). `PUT /api/feedback/:id/triage` (instructor) sets or clears it; `GET /api/feedback`
   accepts `?status=open&triaged=false`. The mark never changes `status` — resolving stays an
   instructor action in the app.
3. **The instructor Feedback queue shows both**: an "instructor" tag on instructor-filed
   reports and the triage mark ("→ task 2026-09-24-040", "personal — for you",
   "dismissed: …").
4. **The Feedback form says what it is for**: one line — for problems with the platform or a
   homework; for anything personal, email the instructor.
5. **`node tasks/tools/feedback.mjs pull`** signs in with the instructor credentials in
   gitignored `secrets/feedback.env` (`MM_API_BASE`, `MM_FEEDBACK_EMAIL`,
   `MM_FEEDBACK_PASSWORD`), fetches every open, untriaged report (also filtered client-side,
   so an older server is safe), writes each as `feedback-<id>.md` (report id, author role,
   category, filed time, context, the message; **never the author's email**) with its
   screenshots decoded beside it, into a private folder **outside the repo**
   (default `~/making-minds-private/feedback/`, `--out` overrides); drops cached reports that
   are no longer pending; signs out. Idempotent.
   **`node tasks/tools/feedback.mjs mark <report-id> filed <task-id>… | personal | dismissed
   "<note>" | clear`** sets the server mark and drops the cached copy.
6. **`CATCHER.md` §3** lists the pull as an intake source with the privacy rules: distil in
   the catcher's own words; cite report id, role and category; never the author's name/email,
   never their text verbatim, never a screenshot in git; a personal report is marked
   `personal`, never filed, and mentioned to Gabriel; every report handled gets a `mark`.
7. **Gates:** a new `server/tools/feedbackCheck.ts` (in server `npm run check`) pins the role
   stamp + backfill, the triage route (auth, validation, set/clear, 404), the list filters,
   and runs the script end to end against a real password-mode server: files, role, no
   email, screenshot bytes, the second run a no-op, `mark` → mark set + cache dropped + next
   pull skips it.
8. 029 and 006 carry the consequences (below); `CLAUDE.md` updated in place.

## Design
- **Family:** the first *detector* feeding the queue (README `source: <detector>`) — data from
  outside the repo crossing into a public git history. The boundary is the point: the
  server is the private store of record, this Mac reads it over the same HTTPS API the
  instructor's browser uses, a working copy sits outside the repo, and only the catcher's
  distilled task is committed.
- **deepFix (chosen):** role stamped at filing (the capacity they filed in, stable if the
  account later goes; one semantics in both backends) rather than a join at read time;
  processing state as a server-side mark (visible in the app, survives a wiped Mac, the
  pull's dedupe for free) rather than a local ledger; a guard at every layer (form note,
  no email in the cache, catcher's no-verbatim rule, `personal` outcome).
- **surgicalFix (rejected):** the original — commit raw reports to `tasks/inbox/`. Publishes
  student data.
- Pointers: `server/src/db.ts:102` (`migrate`), `:156–167` (table), `:498–565` (feedback
  methods); `server/src/app.ts:608–694` (routes); `app/src/types.ts:662` (`PlatformFeedback`);
  `app/src/storage/feedbackStore.ts`, `remoteStores.ts` (seam); `app/src/api/client.ts:505`;
  `app/src/components/FeedbackPanel.tsx:67` (submit), `app/src/instructor/FeedbackQueueView.tsx:73`.

### Resolved decisions (Gabriel, 2026-09-24)
1. Raw reports stay on the server; the Mac's working copy lives **outside the repo**, kept
   until the report is processed.
2. "Processed" is remembered **on the server**, as a mark shown in the Feedback queue.
3. All three guards: the note on the form, personal reports never filed, no verbatim quotes
   (nor name/email) in git.
4. Sign-in by **email + password** in gitignored `secrets/feedback.env`. Under UCLA SSO this
   needs a server-issued key instead — noted on 006.

## Verify
`server/tools/feedbackCheck.ts` (above). Browser pass (remote mode against a local server):
the form note, the queue's instructor tag and triage marks. **Owed:** a real pull against the
pilot — needs the server change released (`deploy/release.sh`) and Gabriel's
`secrets/feedback.env` (three lines: `MM_API_BASE=https://100-22-69-95.sslip.io`,
`MM_FEEDBACK_EMAIL=<his instructor account>`, `MM_FEEDBACK_PASSWORD=<its password>`), then
`node tasks/tools/feedback.mjs pull`.

## Progress log
- 2026-09-24 (`/work`): re-diagnosed with Gabriel — the repo is public, so raw reports never
  enter git (decisions above); size small → large. Built: `feedback.author_role` (stamped at
  filing, backfilled once) and `feedback.triage` (`server/src/db.ts`), `?status`/`?triaged`
  filters and `PUT /api/feedback/:id/triage` (`server/src/app.ts`), `authorRole`/`triage` on
  `PlatformFeedback` and the seam, the queue's instructor tag + mark, the form's personal-
  matters note, `tasks/tools/feedback.mjs pull|mark` (working copy outside the repo, no
  email, refuses an in-repo `--out`, signs out every run), `server/tools/feedbackCheck.ts`
  (52 pins; neutered twice — a wrong role stamp → 3 FAIL; an unfiltered, email-carrying,
  no-logout script → 7 FAIL), a `remoteStoreCheck` role pin, CATCHER §3 intake rules,
  PROFILE law 9, 029 rebased (review becomes a server mark, no committed ledger), 006 noted
  (SSO needs a server-issued key for the script). Browser (remote mode, local server, dev
  auth): a report filed from the form; `pull` wrote 3 files, roles right, no email; `mark`
  filed / personal / dismissed each render in the Feedback tab, desktop and 375 px; no
  console errors. All gates green. Owed: the pilot run (Verify).
