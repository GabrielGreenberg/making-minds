---
id: 2026-09-21-018
type: feature
title: Pull the app's feedback reports into tasks/inbox/ with the author's role (stage 1 of the feedback pipeline)
priority: normal
size: small
requires: human
area: pipeline
source: chat
created: 2026-09-21T15:30:00-07:00
status: ready
after:
branch:
merged_into:
---

## Description
The app has a student "Feedback" form feeding an instructor queue (`FeedbackStore`;
`GET /api/feedback`, `PUT /api/feedback/:id/status`). It is a natural detector for the task
pipeline: the catcher should be able to drain open reports into `tasks/inbox/` (one file per
report, screenshots into `attachments/`) and diagnose them like any other intake.

Updated 2026-09-22 (catch): this is STAGE 1 of the feedback pipeline Gabriel asked for — task
2026-09-22-029 is the triage routine that consumes these files, and it needs to know whether
the author is an instructor or a student. The `feedback` table stores email, category,
message, screenshots, `context` and status but NOT the role (`server/src/db.ts:129–140, 396`);
`GET /api/feedback` (`server/src/app.ts:656`) should return each report with `role` joined
from the users table, and every inbox file carries `author-role: instructor | student`.

## Done when
`node tasks/tools/pull-feedback.mjs` (instructor token from gitignored `secrets/`) writes each
open report not yet pulled as `inbox/feedback-<id>.md` with provenance; `author-role`, category, report id and
the route/assignment `context`, screenshots as `attachments/feedback-<id>-<n>.<ext>`; `CATCHER.md` §3 lists
it as a source. Marking resolved stays a human/instructor action.

## Design
Pure script over the existing API; `requires: human` only for the one-time token setup.

## Verify
Run against a local server (`npm run seed -- --sample` + a filed report).

## Progress log
