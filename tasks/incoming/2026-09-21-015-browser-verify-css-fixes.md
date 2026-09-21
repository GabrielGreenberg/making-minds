---
id: 2026-09-21-015
type: chore
title: Browser-verify the CSS-only fixes landed without a browser (2026-09-17 pass + two legacy layout items)
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
Landed without a browser (Chrome automation was unavailable that session), flagged as owed.
Two further members come from the legacy to-do list (`tasks/inbox/_processed/legacy-fixes-md.md`,
catch session 2026-09-21): the code for both now looks right, but nobody has eyeballed it.

### Members
- Submissions pane: per-question columns scroll horizontally, Score column pinned (`position: sticky`).
- Instructor dashboard action buttons have a fixed min-width (Publish vs Hide no longer shifts).
- TM tape strip: `user-select: none` (shift-click selected cell text) and `max-width: 100%`.
- Top bar shows a student's name without announcing the role.
- Feedback link present in both `MenuBar` and `HomeScreen` headers.
- **Legacy:** the question-pane resize grip was reported "a couple of pixels right of the pane
  boundary". `.panel-resize-handle` (`app/src/index.css:673`) now sits at `left: -5px` with a
  comment deriving the 1px border correction, so it should be centred on the divider — confirm
  on a CC, an SC and a turbot question (all five `DataTable.tsx` panels render it).
- **Legacy:** on the assignment overview the "Submit assignment" button was reported misaligned
  with the "✓ Submitted <date>" line. `.assignment-overview-submit` (`index.css:2308`) is now a
  centred flex row (`align-items: center; justify-content: space-between`) — confirm both the
  submitted and the not-submitted state, and the frozen "🔒 Past due" variant.

## Done when
Each member eyeballed in the dev preview (local mode; seed HW1–HW7 + sample submissions for
the gradebook); any defect fixed in the same session; screenshots attached.

## Design
Verification task; fixes, if any, are CSS.

## Verify
Screenshots in `tasks/attachments/2026-09-21-015-*.png`.

## Progress log
