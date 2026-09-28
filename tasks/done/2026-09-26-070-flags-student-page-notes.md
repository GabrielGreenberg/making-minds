---
id: 2026-09-26-070
type: feature
title: Flag students who need attention, and give each student an instructor page with private notes and grade history
priority: normal
size: large
requires: browser
area: app
source: chat
created: 2026-09-26T21:34:00-07:00
status: done
after: 2026-09-26-068
branch:
merged_into:
---

## Description
Filed from task 031's accepted design (Gabriel approved 2026-09-26, with its three proposed defaults). Authority: the memo `docs/buildout/designs/grading-interface.md` — its §3 table records every decision; read it before starting. Slice 10 of 11 (memo §12). HW1 is due Oct 4 and is returned about a week later, so slices 1–8 carry the schedule.

Memo §6.5, §8; mockups 1 (Needs attention) and 6
(`tasks/attachments/2026-09-23-031-6-student.png`).

## Done when
- Flags (prompts, never verdicts), thresholds in `course_settings.flagThresholds` (Settings
  on the Grading tab): not submitted by the effective due date; > 14 days late; final < 70 on
  two consecutive counted sets; no account 7 days after the first meeting; group mismatch
  (a listed member doesn't list back once both submitted or the due date passed; group > 3);
  integrity (`SubmissionIntegrity.flagged > 0`, now counted per row) + identical
  open-response text across students (annotated "same group" when a reciprocal group
  explains it).
- The Grading tab's Needs-attention box and flagged list; ⚑ on matrix rows.
- `#/instructor/students/:sid` (from the matrix, Roster & accounts, flags): identity, flags,
  per-assignment rows, average of counted sets so far, **private notes** (`student_notes`,
  dated, append-only, instructors only, P4 placeholder), grade history from `grade_events`,
  extensions.
- Pinned: each flag rule on fixtures; notes never reach a student payload
  (`sanitize`/`gradingCheck`).

## Design
- **deepFix:** flags are pure functions over the 064 summaries + settings; no flag stores
  state.
- Pointers: `provenance/integrity.ts:332`, `types.ts:538-570`, `instructor/RosterView.tsx`.
- Hand-off from 068: the interim student page (`instructor/StudentGradingView.tsx`) already
  carries **Extension…** / **Waive…** per assignment row (`instructor/LateAdjustControls.tsx`,
  fed by `GradingRow.extendedTo` / `.waived`); the rebuild keeps them. Extension and waiver
  changes are `grade_events` of kind `extension` / `waiver` (no `questionId`) — the grade
  history lists them. The effective due date for "not submitted by" is
  `storage/gradingSummary.ts dueFor` (already extension-aware).

## Verify
Gates; browser: each flag shows on a toy fixture; a note added appears only to
instructors.

## Progress log
- 2026-09-27 (robot, implement): built. Flags are pure functions — NEW `app/src/storage/gradingFlags.ts`
  (thresholds + `normalizeThresholds`, `assignmentFlags` per summary, `courseFlags` course-wide; grader-free,
  server-imported). `buildAssignmentSummary({thresholds, groupKey})` puts `group` + `flags` on roster rows
  (open-text fingerprints computed inside, never shipped); `buildCourseGrading` → `flagged` + `thresholds`;
  `buildStudentGrading` → `flags`, `average` (`countedAverage`, reusable by 071), `notes`, `history`. Seam:
  `GradingStore.setFlagThresholds` / `addStudentNote`; local `mm:flag-thresholds`, `mm:student-notes:<email>`;
  server `course_settings.flagThresholds`, `student_notes` table, `PUT /api/grading/settings`,
  `POST /api/students/:sid/notes`; `/api/roster` rows carry a student's `key` (public_id). UI: Grading tab
  Needs-attention box + flagged list + Settings panel; matrix row ⚑, ↗ student-page link, Flagged chip;
  StudentGradingView rebuilt (flags, rows with Extension…/Waive…, average, notes, history); Roster names link.
  Pins: gradingViewCheck `[flags]`, gradingCheck `[flags & notes]` + `[local ≡ remote]` with a group listing.
  Decisions:
  · **Every private note is also logged in grade_events** (memo §9) as a `NoteEvent` (`kind: 'note'`,
    actor, student, `after: {noteId}` — no text) under the course-wide id `COURSE_LOG_ID` (`''`, no
    assignment's), in the same transaction as the `student_notes` row; locally `mm:grade-log:` via
    `logNote`. (Fix stage: the implement stage had treated the notes table as the log.)
  · **Struggling reads settled grades only**: past the row's effective due date (extension ?? due), then
    final and not provisional, or missing = 0; counted sets in catalog order; an unsettled set (not yet due
    even if submitted, or provisional) breaks the run — as the counted average reads the same sets.
  · **The student page's average counts published sets only** (`buildStudentGrading` takes each
    assignment's `visible`; a hidden one is listed but never averaged), matching the flags.
  · **The Grading tab's flags are over PUBLISHED assignments** (a hidden one raises nothing); the matrix's
    row ⚑ carries that assignment's flags only; no account and struggling are course-wide (student page, tab).
  · Only roster students are flagged; identical text compares roster rows only. Group keys: server listings
    are public_ids (= identity keys); local listings are toy ids, mapped to emails (`groupKey`).
  · gradingCheck's no-leak regex now forbids the `"integrity":` record key rather than the word, since a
    row's flag of kind `integrity` (a count) rides the summary.
  Owed (requires: browser): eyeball the tab's box/list/Settings, the matrix ⚑, the student page and notes
  in both modes.

### 2026-09-27 — implemented (work loop)
Built: instructor flags as pure functions over the grading summaries (not submitted, very late,
struggling, no account, group mismatch, integrity, identical open text), thresholds editable in the
Grading tab's Settings; the tab's Needs-attention box + flagged list, ⚑ on matrix rows; the rebuilt
student page `#/instructor/students/:sid` (identity, flags, rows with Extension…/Waive…, average of
counted published sets, private append-only notes, grade history); Roster names link to it.
Pins: gradingViewCheck `[flags]` (each rule both ways, extensions, settled-only struggling incl. a
not-yet-due set); gradingCheck `[flags & notes]` (settings persist, notes 403/404/400, newest first,
never in a student payload, no edit/delete path, one text-free `note` grade_event per note under the
course-wide id, hidden assignment listed but not averaged).
Gates: app-tsc 0, app-build 0, app-check 0, server-tsc 0, server-check 0 (one earlier run failed in the
untouched [regrade] sign-in after every 070 check passed; rerun clean — suspected flake).
Review fixed: notes logged in grade_events (NoteEvent, same transaction; local `logNote`); struggling
waits for the effective due date; student-page average counts published sets only. Skipped: none.
Nits left: PUT /api/grading/settings resets unsent fields to defaults; very-late detail floors days.
Owed: browser checks (local: box/list/Settings/⚑/student page/notes/group+identical flow, light+dark vs
the 031 attachments; remote: No account + roster link). Nothing owed by ssh (CREATE TABLE IF NOT EXISTS).
NEXT STEP: loop session: visual check if owed, then land per PROFILE §5.

### 2026-09-27 (robot) — landed
- **Headless check (local mode, CDP, Vite on :5177, Prof. Ada, HW1–HW7 seeded + published, HW1 due
  moved to Sep 10):** Grading tab: the Needs-attention box reads "2 not submitted · 2 very late · See all 2
  students →"; the flagged list shows John Doe and Jane Roe, each with Not submitted and Very late for HW1
  (both flags on a missing set, as memo §8 says: "or none by then"); Settings opens the six threshold
  fields. HW1 Matrix: ⚑ after both names, the "Flagged 2" chip. John's page `#/instructor/students/…`:
  identity, both flags, a row per set with Extension…, "Average so far (1 counted set): 0", an empty grade
  history, notes placeholder "No medical or accommodation details". Adding a note shows it dated
  with no edit or delete control, and it survives a reload. As student John the same URL shows no note.
  Fixed: the matrix legend's missing space ("⚑ on a problem").
- Gates: the workflow's (all 0); origin/main brought nothing in; after the legend fix, app-tsc 0.
- **Owed, not claimed (Gabriel's eyeball):** the recipes above: the group-mismatch/identical-text flow,
  dark theme vs the 031 attachments, remote mode's No-account flag and the roster link (Vite Remote Mode + a
  local server on 8199).
