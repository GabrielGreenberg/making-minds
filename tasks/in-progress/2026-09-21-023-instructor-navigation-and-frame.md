---
id: 2026-09-21-023
type: feature
title: One page frame and a clear instructor navigation (Dashboard, tabs, role switch, Sandbox set apart)
priority: high
size: large
requires: browser
area: app
source: chat
created: 2026-09-21T22:10:00-07:00
status: in-progress
after:
branch: task/023-instructor-navigation
merged_into:
---

## Description
After 019/021 the instructor interface reads as "all over the place" (Gabriel, chat,
2026-09-21): switching between the student catalog and the instructor area makes the page
jump; the words Instructor / Dashboard / Assignments name overlapping things; the old
Student view / Instructor view switch is no longer recognisable; Sandbox sits in the nav as
if it were a page although it opens the editor.

Mechanism: the student pages render in the site's 1080px `.page` column and the instructor
shell in a 1400px `page--wide` one, so at 1280 wide every topbar element shifts 100px on the
crossing; the instructor shell also adds `.subbar` (the section sub-nav), which pushes the
band and content down 44px. Two frames, two chromes. The nav is `appNav` (Assignments ·
Sandbox · Instructor) and the sub-nav's first item is "Dashboard", whose page is titled
"Assignments".

## Done when
1. One frame: `.page` (1080px) on every surface; `page--wide` and `.subbar` are gone.
   Crossing Student view ↔ Dashboard moves nothing in the chrome — the brand, nav, band and
   column edges sit at identical pixel positions at 1280 and 700 wide (a browser measurement
   recorded in the progress log; screenshots attached).
2. The instructor sections are tabs INSIDE the page column, on every instructor page: a
   `.mm-tabs` row (Assignments · Roster & accounts · Feedback · Notes) above the page head,
   current tab underlined; the editor, question creator and gradebook show it with
   Assignments current.
3. Names: the instructor area is "Dashboard" everywhere (nav label, tab-row eyebrow). Nav for
   a student: Assignments. Nav for an instructor: Student view · Dashboard. The dashboard's
   first tab and its page title are "Assignments".
4. Sandbox is set apart: a lavender boxed link (`.mm-navbox`) at the right end of the nav
   group, visibly not a page. The home page's "Explore → Sandbox" section is removed.
5. Instructor tables that need the room scroll horizontally inside their wrappers (the
   dashboard and gradebook already have `.instructor-table-scroll`); nothing overflows the
   column at 1280 or 700.
6. `themeCheck`'s retired pin grows `subbar` and `page--wide`; all gates green.

## Design
- **deepFix (recommended):** the shell is invariant — one column, one chrome — and a
  section's navigation is a page-level primitive (`.mm-tabs`, the login tabs' idiom
  generalised) rendered by `InstructorLayout` inside the column, not by the shell. `appNav`
  takes the role and derives the labels (Student view · Dashboard for instructors). The
  Sandbox link becomes a distinct `navbox` slot on `PageShell`. No store or routing change.
- **surgicalFix:** widen the student pages to 1400 and render an empty subbar for students.
  Not recommended — it keeps two ideas of "section" and makes the student pages worse.
- Pointers: `components/PageShell.tsx` (`appNav`, `subnav`, `width`),
  `instructor/InstructorLayout.tsx` (SECTIONS), `src/theme.css` (`.page--wide`, `.subbar`),
  `src/pages.css` (`.login-tabs` idiom to generalise), `components/HomeScreen.tsx` (Explore
  section), `instructor/InstructorGate.tsx`, `app/tools/themeCheck.ts`.
- Decisions (Gabriel, chat): instructor nav labels "Student view · Dashboard"; the home
  Explore section goes.

## Verify
- Gates: tsc, build, `npm run check` (themeCheck), server check.
- Browser (local, "Vite Dev Server"): Prof. Ada → Student view ↔ Dashboard at 1280 and 700 —
  measure the `.brand` and `.band` rects before and after the switch; each instructor tab;
  Sandbox from the topbar → editor; John Doe → nav shows only Assignments + the Sandbox box.
- Screenshots `tasks/attachments/2026-09-21-023-<surface>-{before,after}.jpg`.

## Progress log
