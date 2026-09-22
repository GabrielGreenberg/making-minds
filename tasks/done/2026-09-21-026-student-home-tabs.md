---
id: 2026-09-21-026
type: feature
title: Give students a Home with Assignments · Grades tabs, an up-next box and a Grades page (retire the grade-sheet modal)
priority: high
size: large
requires: browser
area: app
source: chat
created: 2026-09-21T23:05:00-07:00
status: done
after:
branch:
merged_into:
---

## Description
The instructor side got the Dashboard idiom in 023 (one column, tabs inside the column,
role-based nav). The student side still has one flat catalog page: a student's nav says
"Assignments" and lands on a page titled "Assignments"; released grades live in a modal
reached per assignment; nothing tells a student what is due next. Gabriel (chat,
2026-09-21): students need the same dashboard/tab layout — at least assignments and grades.
Decisions taken: nav label **Home**; tabs **Assignments · Grades** only (Account and Help are
later candidates; Feedback stays a session action); the grade-sheet modal **retires** in
favour of the Grades page.

## Done when
1. The student area is **Home**: nav label "Home" for students (instructors keep Student
   view · Dashboard, and Student view IS this Home); inside the column an eyebrow that
   matches the nav label and the tab row Assignments · Grades (`.mm-tabs`, current tab
   underlined), on the catalog, the Grades page and the assignment overview (Assignments
   current there, as the instructor's editor does).
2. The Assignments tab shows the website's **up-next box** above the list when any visible
   assignment has a due date in the future: the earliest one, with its due date, how long
   is left, and whether it is submitted; nothing when there is no due date.
3. **Grades** is a route (`#/grades`, `#/grades/:id`) and a page: one hairline table, a row
   per published assignment — title · submitted (date · attempt) · result ("N of M correct"
   once released; "not released yet"; "not submitted"). A row expands into the per-question
   sheet (verdict, instructor note, failed-inputs dropdown, link into the question); the
   expanded row is the route's id, so it is linkable. "View grades" on a catalog row and on
   the overview page navigate there with that row open.
4. `GradesPanel` (the modal) is gone; its sheet lives on as `GradeSheet`, rendered inline.
5. Routing: `Route` gains `grades`; `parseHash`/`routeToHash` round-trip it; applying it
   closes any open workbook (as Home does); a shared `useRoute` hook serves both the student
   Home and `useInstructorRoute`.
6. Browser-verified at 1280 and 700 as John Doe (Home tabs, up-next box when HW has a due
   date, Grades with a released HW1, expand/collapse, links) and as Prof. Ada (Student view
   shows the same Home); the chrome does not move between Home tabs (measured). Screenshots
   attached. Gates green; `themeCheck`'s page-component list covers the new files.

## Design
- **deepFix (recommended):** a `StudentLayout` (the twin of `InstructorLayout`: PageShell +
  the tab row) used by the catalog, the Grades page and the overview; `GradesView` as a real
  page over the existing seams (`listAssignments`, the store's latest-submission map,
  `getAssignment` for labels) with `GradeSheet` extracted from the modal; the up-next box
  derived from `dueDates.ts` over the summaries; `useRoute` generalised from
  `useInstructorRoute`. No store, engine, storage or server change.
- **surgicalFix:** add a "Grades" button that opens the existing modal for each assignment
  in turn. Not recommended — grades stay a pop-up and the student side stays flat.
- Pointers: `routing.ts` (Route union, parseHash, routeToHash, applyRoute), `App.tsx`,
  `components/HomeScreen.tsx`, `AssignmentOverview.tsx`, `GradesPanel.tsx` (→ `GradeSheet`),
  `components/PageShell.tsx` (`appNav`), `instructor/useInstructorRoute.ts`, `dueDates.ts`,
  `src/theme.css` (`.mm-next`/`.mm-nx` = the site's `.next`/`.nx`), `app/tools/themeCheck.ts`.

## Verify
- Gates: tsc, build, `npm run check` (themeCheck), server check.
- Browser (local, "Vite Dev Server"): Prof. Ada → Dashboard → Edit HW2 → set a due date a
  few days out → Student view (up-next box shows HW2) → Grades tab (HW1 released: expand,
  failed inputs, "Open my submission →") → HW1 overview shows the tab row; John Doe → Home
  tabs + Grades. Measure the chrome across Home tabs.
- Screenshots `tasks/attachments/2026-09-21-026-<surface>-{before,after}.jpg`.

## Progress log
- **2026-09-21 (/work, `task/026-student-home-tabs`) — landed.** The student area is Home:
  `appNav` labels a student's one page "Home" (an instructor's "Student view" is the same
  page); `StudentLayout` (the twin of `InstructorLayout`) renders the eyebrow + the tabs
  Assignments · Grades inside the column on the catalog, the Grades page and the assignment
  overview. `Route` gained `grades` (`#/grades`, `#/grades/:id`); applying it closes any
  workbook as Home does, and `HomeScreen` picks the tab from the hash through the new shared
  `useRoute` hook (which `useInstructorRoute` now uses too). `GradesView` is the Grades tab
  (assignment · submitted · result; a released row opens in place into `GradeSheet`, the
  modal's sheet extracted; the open row is the route id, so it is linkable and Back closes
  it); `GradesPanel` is deleted and both "View grades" links navigate to `#/grades/:id`.
  The up-next box (`.mm-next`/`.mm-nx`, the site's idiom) shows the soonest future due date
  with time left and submission state; `dueDates.ts` gained `formatDateTime`/`formatDueDay`.
  Verified: tsc, build, themeCheck (page-component list + StudentLayout pins + "GradesPanel
  is gone"), app check, server check; in the pane as John Doe with HW1 released and HW2 due
  in 3 days: View grades → `#/grades/hw1` with the sheet open and the chrome unmoved (brand
  [140,12], band [0,58], tabs [140,102]); collapse → `#/grades`; failed inputs → "Open my
  submission →" → `#/a/hw1/q/0` in the editor; Grades tab rows read "5 of 6 correct" /
  "Not released yet". Screenshots `2026-09-21-026-{home,grades,overview}-before.jpg`,
  `-{home,grades,grades-open,overview,student-view}-after.jpg`,
  `-{home,grades-open}-narrow-after.jpg` (HW2/HW3 due dates injected into the snapshot).
  Owed: a real-device look; Account and Help tabs are candidates when there is content.
  Next: nothing — done.
