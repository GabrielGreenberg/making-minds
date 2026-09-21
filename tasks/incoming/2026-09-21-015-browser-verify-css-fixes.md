---
id: 2026-09-21-015
type: chore
title: Browser-verify the five CSS-only fixes from the 2026-09-17 todos pass
priority: normal
size: small
requires: browser
area: app
source: claude-md
created: 2026-09-21T15:30:00-07:00
status: ready
after:
branch:
merged_into:
---

## Description
Landed without a browser (Chrome automation was unavailable that session), flagged as owed:

### Members
- Submissions pane: per-question columns scroll horizontally, Score column pinned (`position: sticky`).
- Instructor dashboard action buttons have a fixed min-width (Publish vs Hide no longer shifts).
- TM tape strip: `user-select: none` (shift-click selected cell text) and `max-width: 100%`.
- Top bar shows a student's name without announcing the role.
- Feedback link present in both `MenuBar` and `HomeScreen` headers.

## Done when
Each member eyeballed in the dev preview (local mode; seed HW1–HW7 + sample submissions for
the gradebook); any defect fixed in the same session; screenshots attached.

## Design
Verification task; fixes, if any, are CSS.

## Verify
Screenshots in `tasks/attachments/2026-09-21-015-*.png`.

## Progress log
