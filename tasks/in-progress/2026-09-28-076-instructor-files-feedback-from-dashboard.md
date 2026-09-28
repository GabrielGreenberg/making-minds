---
id: 2026-09-28-076
type: feature
title: Let the instructor file a Feedback report from the Dashboard
priority: normal
size: small
requires:
area: app
source: feedback
created: 2026-09-28T10:00:00-07:00
status: in-progress
after:
branch: robot/076-instructor-files-feedback-from-dashboard
merged_into:
---

## Description
App Feedback report `fb-mulh4lmu-duomc3` (author-role: instructor, category: platform
design): the instructor wants to write a Feedback report from the instructor Dashboard,
without first crossing to Student view.

Today (from the code): every entry point to the report form is `SessionControls`
(`app/src/components/SessionControls.tsx:55-59` topbar button, `:119-123` the editor's
"Name ▾" menu item). The Dashboard shell turns it off on purpose —
`app/src/instructor/InstructorLayout.tsx:36` renders `<SessionControls feedback={false} />`
(task 023) — and the Dashboard's **Feedback** tab (`FeedbackQueueView.tsx:43-110`) only
lists and triages reports; it cannot file one. The server already accepts a report from any
signed-in user and stamps the role from the session (`server/src/app.ts:1114,1166-1173`), so
this is UI only.

## Done when
- On every Dashboard tab the instructor can open the same report form (`FeedbackPanel`)
  that students use, and submitting files a report that appears in the Feedback queue with
  the instructor tag.
- The Feedback tab itself has a visible "New report" (or equivalent) action beside its
  filters, opening the same form.
- A report filed from the Dashboard carries no stale assignment/question context: the
  context is derived only when an assignment is actually open (check `FeedbackPanel.tsx:39-40,
  78-83`, which reads the editor store's `assignment` — confirm the store is cleared on
  leaving the editor, else pass context explicitly from the route).
- Local and remote mode both work (local: `LocalFeedbackStore`; remote: `/api/feedback`).

## Design
- **deepFix (recommended):** drop `feedback={false}` so the Dashboard gets the same
  topbar Feedback button every other page has (one entry point, one component), and add a
  "New report" button in `FeedbackQueueView` that opens the same `FeedbackPanel`, then
  reloads the list on submit. Make the report's context come from the current route (an
  explicit prop from the caller) rather than whatever the editor store last held, so
  Dashboard/Home reports are honestly "context: none".
- **surgicalFix:** only remove `feedback={false}` in `InstructorLayout.tsx:36`.
- Why 023 hid it: the topbar button and the "Feedback" tab share a name on the same page.
  If that reads badly, label the topbar button "Report…" on instructor pages; recommended
  default is to keep the one label and rely on the tab's "New report" button.

### Members
- `fb-mulh4lmu-duomc3` · instructor · platform design.

## Verify
Gates in `app/`: `npx tsc -p tsconfig.app.json --noEmit`, `npm run build`, `npm run check`
(`routingCheck`/`workbenchCheck` if they pin the instructor shell's session controls; add a
pin that the Dashboard shell offers Feedback). Remote path covered by `remoteStoreCheck`'s
real server boot if a feedback POST as an instructor is added there. Eyeball (owed): sign in
as the toy instructor, Dashboard → Feedback → New report → it appears in the list tagged
instructor, context none.

## Progress log
