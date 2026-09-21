---
id: 2026-09-21-021
type: feature
title: Restyle the instructor views onto the page-surface design layer (019 Phase B)
priority: normal
size: large
requires: browser
area: app
source: chat
created: 2026-09-21T17:05:00-07:00
status: ready
after:
branch:
merged_into:
---

## Description
Phase A of 2026-09-21-019 built the page-surface design layer — `app/src/theme.css`
(the makingminds.org tokens + shared vocabulary), `app/src/pages.css` (per-surface rules),
`components/PageShell.tsx` / `SessionControls.tsx`, the `themeCheck` gate — and restyled
every student surface through it. The instructor shell already renders inside `PageShell`
(wide column, the app nav with Instructor current), and the instructor CSS carried over
from `index.css` was re-pointed at the tokens (colours and fonts), so the views are
coherent but still shaped by the old vocabulary: rounded `instructor-btn`s, pill badges,
a `.instructor-page-head` per view choosing between two title classes, a row of five
nav-like buttons on the dashboard (Load sample data · Load HW1–HW7 · Roster & accounts ·
Feedback · Notes), the unlock screen (`InstructorGate`) with its own card. Split off from
019 at land time, as its Done-when foresaw. Rules: `docs/buildout/VISUAL_VOCAB.md`
§"Page surfaces"; before/after of the dashboard shell:
`tasks/attachments/2026-09-21-019-instructor-{before,after}.jpg`.

## Done when
1. The dashboard, assignment editor, question creator, gradebook, roster, feedback queue,
   notes and the unlock screen use the shared vocabulary: `.mm-btn` (one magenta primary
   per view), `.tag` (mono, square) instead of `instructor-badge` pills, `.mm-table`
   (eyebrow `th`, hairlines) instead of `instructor-table`, `.mm-field`/`.mm-input`
   instead of `instructor-field`/`instructor-input`, serif `h1`/`h2` + `.mm-head` instead
   of `instructor-page-head`/`-page-title`/`-section-title`. The gradebook and roster keep
   their sticky columns and horizontal scroll.
2. The dashboard's Roster & accounts · Feedback · Notes buttons become the shell's nav on
   instructor routes (`PageShell nav`, current item underlined); the two dev seeds (Load
   sample data · Load HW1–HW7) stay as quiet buttons in the dashboard head, local mode only.
3. `InstructorGate`'s unlock screen is the shell's card variant.
4. `pages.css` loses the retired `instructor-btn`/`-badge`/`-table`/`-input`/`-page-head`
   rules (or the survivors are aliased onto the vocabulary), `themeCheck` still passes, and
   its retired-idiom pin grows to cover them.
5. Every instructor surface eyeballed in the browser at 1280 and ~700 wide; screenshots
   attached as `tasks/attachments/2026-09-21-021-<view>-{before,after}.jpg`. Roster is
   remote-only: run "Vite Remote Mode" against a local server for that view.

## Design
- **deepFix (recommended):** replace the instructor class families with the vocabulary
  the student surfaces already use, view by view, deleting the old rules from `pages.css`
  as each family goes dead — no third button/table/field idiom survives. The nav move
  routes through `PageShell`'s existing `nav` prop (`appNav` grows an instructor-routes
  variant); no store, engine, storage or routing change.
- **surgicalFix:** keep the `instructor-*` classes and re-skin them in place (square
  corners, token colours). Not recommended — two vocabularies for one site.
- Pointers: `app/src/pages.css` (the carried-over instructor block, from "Instructor
  frontend" to "Instructor notes"), `instructor/InstructorDashboard.tsx`,
  `AssignmentEditor.tsx`, `QuestionCreator.tsx`, `GradebookView.tsx`, `RosterView.tsx`,
  `FeedbackQueueView.tsx`, `NotesView.tsx`, `InstructorGate.tsx`, `InstructorLayout.tsx`,
  `components/PageShell.tsx` (`appNav`), `app/tools/themeCheck.ts`.
- The headless screenshot recipe from 019 (a localStorage snapshot + Chrome over the
  DevTools protocol, no deps) is in 019's progress log; reuse it for the before/after set.

## Verify
- Gates: `tsc`, `npm run build`, `npm run check` (with `themeCheck`).
- Browser recipe (local, "Vite Dev Server"): Prof. Ada → `#/instructor` → each view;
  Edit HW1 → New question; Submissions on HW1 (expand a student, review an open answer);
  Feedback; Notes; log out → John Doe → `#/instructor` for the unlock screen. Remote mode
  for Roster.
- Owed: a real-device look on Gabriel's laptop.

## Progress log
