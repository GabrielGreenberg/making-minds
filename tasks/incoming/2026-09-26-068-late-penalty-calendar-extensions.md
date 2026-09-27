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
status: ready
after: 2026-09-26-067
branch:
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

## Verify
Gates; browser: a toy late submission shows the deduction; an extension moves the due
date on the student's Home; a waiver reduces it.

## Progress log
