---
id: 2026-09-21-018
type: feature
title: Let /catch pull the app's student feedback reports into tasks/inbox/
priority: low
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

## Done when
`node tasks/tools/pull-feedback.mjs` (instructor token from gitignored `secrets/`) writes each
open report not yet pulled as `inbox/feedback-<id>.md` with provenance; `CATCHER.md` §3 lists
it as a source. Marking resolved stays a human/instructor action.

## Design
Pure script over the existing API; `requires: human` only for the one-time token setup.

## Verify
Run against a local server (`npm run seed -- --sample` + a filed report).

## Progress log
