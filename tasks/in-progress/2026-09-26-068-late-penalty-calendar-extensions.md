---
id: 2026-09-26-068
type: feature
title: Apply the late policy from the class calendar — a repo copy of the website's course.json, per-student extensions, waivers, and the late warning at submit
priority: high
size: large
requires: browser
area: app
source: chat
created: 2026-09-26T21:34:00-07:00
status: in-progress
after: 2026-09-26-067
branch: robot/068-late-penalty-calendar-extensions
merged_into:
---

## Description
Filed from task 031's accepted design (Gabriel approved 2026-09-26, with its three proposed defaults). Authority: the memo `docs/buildout/designs/grading-interface.md` — its §3 table records every decision; read it before starting. Slice 8 of 11 (memo §12). HW1 is due Oct 4 and is returned about a week later, so slices 1–8 carry the schedule.

Policy: −5 once late, −5 per class meeting after (HW6 per day), floor 0; extensions by
request (memo §4.6–§4.7, §7.4, §7.7). Today lateness is a tag only (`dueDates.ts:41-44`).

## Done when
- `app/src/devData/courseCalendar.json` `{timezone, meetings:[{date,start,end,kind}]}` from
  `npm run calendar -- import <website data/course.json>` (lesson + in-class exam entries at
  `course.lecture` times; holidays have no meeting; the finals slot is not a meeting);
  committed; synced into `course_settings.calendar` by `npm run homeworks -- sync` (release);
  bundled for local mode.
- `countsTowardGrade` and `latePolicy` join `INSTRUCTOR_OWNED_FIELDS`
  (`devData/homeworkSync.ts:31`), filled by the sync when unset; HW6 = `per-day`, HW7 =
  `countsTowardGrade: false`. Editable in the assignment editor.
- `extensions` (date only — no reason column) and `late_waivers` tables + endpoints, logged in
  `grade_events`; **Extension…** and **Waive…** on the submission page (067) and the student
  page (070).
- Effective due date = extension ?? assignment date; the student's served copy carries it, so
  Home, overview, freezing (`dueDates.ts:70 isFrozen`) follow; shown "Due Oct 8 (extended)".
- `scoreSubmission` gets the real calendar: deductions appear in the matrix, the submission
  page and (after release) the student's sheet ("late by 2 class meetings: −15; 5 waived").
- Hand-off from 064: `app/src/storage/gradingSummary.ts dueFor` (the ONE hook both grading
  adapters call) returns the extension-aware due date AND the `late` policy, so the
  summaries' `latest.late.units` / `.deduction` (null since 064) carry the real values;
  flip `server/tools/gradingCheck.ts`'s "units and deduction wait for the calendar" pin to
  the calendar's numbers.
- The submit dialog, past the effective due date, states the cost and that an earlier
  on-time submission will no longer count.
- Pinned: `dueDateCheck` + `scoreCheck` over the committed calendar (HW1–HW6 real dates), the
  import script on a fixture, sync fills unset fields only.

## Design
- **deepFix:** the calendar is course data with one source (the website), one copy (the
  repo), one sync path (release) — the same shape as the homeworks.
- Pointers: `dueDates.ts`, `server/src/homeworks.ts`, `devData/homeworkSync.ts`,
  `provenance/notice.ts:25-31`, `server/src/sanitize.ts` (per-student due date), website
  `Phil 133 - web/claude redesign/data/course.json`.

### Resolved decisions (Gabriel, 2026-09-27)
- Land it with the eyeball owed: the code and every gate are green on
  `robot/068-late-penalty-calendar-extensions`; land it (headless check if the run can), and
  write the browser check in `## Verify` into the progress log as owed, not claimed, with its
  recipe. Gabriel eyeballs it before the hand release.

## Verify
Gates; browser: a toy late submission shows the deduction; an extension moves the due
date on the student's Home; a waiver reduces it.

## Progress log
- 2026-09-27 (robot, implement): the calendar is course data with one source —
  `engine/calendar.ts` (`importCourseCalendar`, DST-correct `toCourseCalendar`), CLI
  `npm run calendar -- import|show`, the committed `devData/courseCalendar.json` (20 meetings:
  19 lessons + the 10-29 midterm; no 11-11 / 11-26 / 12-09), bundled as `COURSE_CALENDAR`,
  synced into `course_settings.calendar` by `homeworks.ts syncCalendar` (homeworks CLI `sync`
  / `status` dry run, `seed --homeworks`). `lateContext.ts`: `dueInput` (extension ?? date;
  policy + waiver only with a calendar — no calendar, no deduction) and `studentCopy` (served
  date + `dueExtended`, students only). `gradingSummary.ts dueFor(…, LateContext)` threads
  through all four builders (rows gain `extendedTo` / `waived`; attempt detail `due`,
  `extension`, `waiver`). Owned fields: `countsTowardGrade` / `latePolicy` (HW6 per-day, HW7
  false; content hashes of hw1–hw7 unchanged), filled only on an unchanged copy. Tables
  `extensions` / `late_waivers` (+ PUT routes, `planExtensionWrite` / `planWaiverWrite`,
  logged as `extension` / `waiver` events with no questionId); local mirror
  `storage/lateLocal.ts`. UI: editor late policy + counts checkbox, `LateAdjustControls` on the
  submission page and the interim student page, `(extended)` on Home / overview, the sheet's
  late line, the submit dialog's warning. Pins: dueDateCheck, scoreCheck [real calendar],
  pipelineCheck [local extensions/waivers], gradingCheck (line-286 pin flipped; [extensions &
  waivers]), homeworkSyncCheck [owned fields] [calendar], remoteStoreCheck. Gates green.
  Owed (browser): a toy late submission shows the deduction; an extension moves the due date
  on the student's Home; a waiver reduces it.

### 2026-09-27 — implemented (work loop)
- **Built:** late work now costs what the syllabus says. The course calendar (lecture
  meetings) is imported from the website into `devData/courseCalendar.json`, bundled locally
  and synced to the server on release; `scoreSubmission` counts class meetings past the
  (extension-aware) due date. Instructors can grant a per-student **Extension…** or **Waive…**
  points on the submission page and the interim student page; students see "Due … (extended)",
  freezing follows the extended date, the submit dialog warns of the cost, and released sheets
  show "late by N class meetings: −X; Y waived". HW6 is `per-day`, HW7 doesn't count; both
  owned fields are editable in the assignment editor.
- **Pins:** dueDateCheck [calendar import] (fixture, unknown-zone rejection), scoreCheck
  [real calendar] (HW1/HW2/HW4 dates, Sunday 23:59 LA incl. post-DST, deduction pins),
  pipelineCheck [local extensions/waivers], gradingCheck (units/deduction pin flipped;
  [extensions & waivers], incl. removeAssignment clearing them), homeworkSyncCheck [owned
  fields] [calendar], remoteStoreCheck.
- **Gates:** app-tsc 0, app-build 0, app-check 0, server-tsc 0, server-check 0.
- **Review fixed:** sync fills an edited copy's unset owned fields (still 'edited', logged
  "set from the repo"); scoreCheck covers HW2/HW4 + DST; server removeAssignment deletes
  extensions/waivers; calendar import rejects unknown IANA zones. Skipped: none. Nit left:
  CLAUDE.md Dev/sample row still lists only `order`/`dueDate` as hash-excluded.
- **Owed:** browser checks (local: late submit deduction in dialog/matrix/page, extension
  moves Home due date + unfreezes, waiver nets, HW7 dimmed, HW6 'per day'; remote: served copy
  carries extended date, instructor editor keeps the original). To Gabriel after release:
  `npm run homeworks -- status` on the box; set HW6/HW7 owned fields by hand if 'edited';
  rerun `npm run calendar -- import` whenever the website's course.json changes.
- **NEXT STEP:** loop session: visual check if owed, then land per PROFILE §5.

### 2026-09-27 (robot) — parked for the browser check
- The task `requires: browser`, but an unattended run can't start the dev server
  (preview_start refuses in scheduled runs), so the owed eyeball above couldn't be done.
  Code and gates are complete on `robot/068-late-penalty-calendar-extensions` (9e3e09c).
- **NEXT STEP:** do the owed browser checks (entry above), then land per PROFILE §5.
