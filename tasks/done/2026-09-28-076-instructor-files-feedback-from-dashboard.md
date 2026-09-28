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
status: done
after:
branch:
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
- 2026-09-28 (robot, implement): deep fix. Checked the store: NOT cleared on leaving the
  editor (`goHome` keeps `assignment` on purpose; instructor routes never touch the store),
  so the context now comes from the route — pure `routing.ts feedbackContextFor(route,
  assignment)` (an assignment route whose assignment is the one open → its id, + the
  question's id when in range; else none), read by `SessionControls`' internal
  `RouteFeedbackPanel`; `FeedbackPanel` takes `context` as a prop and reads no store.
  `feedback` prop removed from `SessionControls` (the Dashboard shell now offers Feedback on
  every tab); the Feedback tab gains "New report" (no context) and reloads on
  `FEEDBACK_FILED_EVENT`, which the panel fires on every filing. Implementer's choice: the
  form's copy is role-aware — an instructor reads "joins the Feedback queue with the
  instructor tag" / "Filed — it's in the Feedback queue." (the student copy, "email your
  instructor instead", read wrong for them); the student copy is unchanged. Kept the one
  "Feedback" label (no "Report…" rename). Pins: routingCheck `[feedback context]` (pure
  cases, local seam, source pins); remoteStoreCheck (instructor files through the real
  server: role stamped, no context). Eyeball owed (Verify recipe).
- 2026-09-28 (robot, fix): review findings. (major) The Feedback modal put a textarea over
  the Grading Queue, whose window keydown took Enter in ANY textarea as Save & next: the
  queue's keys are now the pure `gradingQueueViews.ts queueKeyAction(key, target,
  modalOpen)` — Enter saves only from the card's own note (by ref) or the page, and any
  `.mm-modal-backdrop` up owns the keyboard (gradingViewCheck `[queue]` key pins + a
  source pin). (minor) Filing goes through the pure `feedbackStore.ts
  feedbackFromSession(user, form, context)` (author + role from the session), pinned
  with the account LocalAuthProvider restores; the Dashboard-shell pin is now a real
  `react-dom/server` render through LocalAuthProvider (routingCheck `[dashboard shell]`:
  Feedback on every tab, New report on the Feedback tab), replacing the prop-regex pins.

### 2026-09-28 — implemented (work loop)
- **Built:** the instructor can file a Feedback report from every Dashboard tab — the
  shell's topbar now carries the same Feedback button as every other page
  (`InstructorLayout.tsx:38`, `feedback` prop gone from `SessionControls`), and the
  Feedback tab has "New report" beside its filter (`FeedbackQueueView.tsx:86-91`), reloading
  on `FEEDBACK_FILED_EVENT` from either entry point. A report's context comes from the
  route (`routing.ts:420 feedbackContextFor`), never the editor store's leftover
  assignment; author + role from the session (`feedbackStore.ts feedbackFromSession`).
  Form copy is role-aware for instructors. Grading Queue keys now `queueKeyAction` (a modal
  owns the keyboard; Enter saves only from the card's note or the page).
- **Pins:** routingCheck `[feedback context]` (pure cases, local seam filing as instructor
  and student, source pins) + `[dashboard shell]` (real `react-dom/server` render through
  LocalAuthProvider: Feedback on six Dashboard routes, New report on the Feedback tab;
  mutation-tested); remoteStoreCheck (instructor files through the real server: role
  stamped, no context, listed tagged instructor); gradingViewCheck `[queue]` key pins.
- **Gates (exit codes):** app-tsc 0, app-build 0, app-check 0, server-tsc 0, server-check 0
  (tsc, typecheck:tools, routingCheck re-run at checkpoint: 0).
- **Review:** fixed 1 major (queue Enter behind the modal) + 2 minor (tautological filing
  pin, regex shell pin); skipped none. Nits left: CLAUDE.md Notes line lost "only" in a
  budget trim (39995/40000 B); viewer route without `/q/:i` files the assignment only.
- **Owed:** headless-Chrome eyeball, local mode (Verify recipe: topbar Feedback on
  Dashboard tabs; Feedback tab → New report → card tagged instructor, no context; editor
  context kept from `#/a/<id>/q/1`; 375px head row wraps). For Gabriel after release: file
  one report from the pilot Dashboard, confirm it lands tagged instructor.
- **Next step:** loop session: visual check if owed, then land per PROFILE §5.
- 2026-09-28 (robot, land): headless-Chrome eyeball over CDP, local mode (Vite from Bash
  on :5188, a throwaway profile; the pane can't start a server unattended): 15/15 —
  topbar "Prof. Ada · Instructor | Feedback | Log out" on `#/instructor`, `/grading`,
  `/roster`; the topbar modal carries the instructor wording; with hw1 still open in the
  store after crossing from `#/a/hw1/q/1` to `#/instructor/feedback` (the stale case
  live), "New report" sits beside the filter, files, the queue reloads with a card tagged
  instructor and NO assignment line; a topbar filing on the Feedback tab refreshes the
  list too; the editor's Name ▾ → Feedback files `{assignmentId: hw1, questionId: 2}`;
  375px: no horizontal overflow, the head row wraps; no page errors. After merging
  `origin/main` (task files only) the full PROFILE §6 table re-ran green by exit code:
  app-tsc 0, app-build 0, app-check 0, server-tsc 0, server-check 0. CLAUDE.md updated in
  place by the workflow (Feedback on every signed-in page; the queue's New report).
  **Owed, not claimed:** Gabriel's own eyeball (the recipe above, in the pane), and on
  the pilot after release: file one report from the Dashboard, confirm it lands tagged
  instructor with no context.
