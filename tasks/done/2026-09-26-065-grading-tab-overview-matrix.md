---
id: 2026-09-26-065
type: feature
title: Add the Grading tab — assignment list with progress, and each assignment's Overview and Matrix — and retire the old gradebook page into it
priority: high
size: large
requires: browser
area: app
source: chat
created: 2026-09-26T21:34:00-07:00
status: done
after: 2026-09-26-064
branch:
merged_into:
---

## Description
Filed from task 031's accepted design (Gabriel approved 2026-09-26, with its three proposed defaults). Authority: the memo `docs/buildout/designs/grading-interface.md` — its §3 table records every decision; read it before starting. Slice 5 of 11 (memo §12). HW1 is due Oct 4 and is returned about a week later, so slices 1–8 carry the schedule.

The surfaces of memo §6.1–§6.2, drawn in mockups 1–3
(`docs/buildout/designs/grading-interface/mockups.html`, screenshots
`tasks/attachments/2026-09-23-031-{1-grading-tab,2-overview,3-matrix}.png`).

## Done when
- Dashboard tabs: Assignments · **Grading** · Roster & accounts · Feedback · Notes
  (`InstructorLayout.tsx:11-20`). Routes `#/instructor/grading`,
  `#/instructor/grading/:asg[/matrix|/queue[/:qid]]`, `…/student/:sid`,
  `#/instructor/students/:sid` in `routing.ts` (public_id in every path, never an email/UID);
  `routingCheck` pins them and the redirect of `#/instructor/assignments/:id/submissions` →
  `#/instructor/grading/:id`.
- Grading tab (mockup 1): assignments with due, submitted / roster bar, autograde (current /
  n stale), hand grading bar, mean, released; HW7-style `countsTowardGrade: false` rows dimmed.
  The Needs-attention box and flagged list appear once 2026-09-26-070 lands (hidden until
  then).
- Overview (mockup 2): the four progress tiles, the stale banner (its Re-grade… button arrives
  in 069), the per-problem table; Export and Release actions (Release warns while pending).
- Matrix (mockup 3): roster rows, filter chips, section select, search, cells 1 / ½ / 0 / ✎ /
  ↻ / — with the human-grade underline and ⚑, late and grade columns, sticky name/grade; a row
  opens the student submission route (page built in 067 — until then it opens today's detail).
- The dashboard's "Submissions" button → "Grading", its column counts students submitted, not
  attempts (`InstructorDashboard.tsx:26-29`). `GradebookView` is deleted.
- New idioms (progress bar, matrix cell, filter chip) join `theme.css`/`pages.css` in tokens
  only; `themeCheck` green; `docs/buildout/VISUAL_VOCAB.md` §Page surfaces names them.

## Design
- **deepFix:** every view renders the 064 summary; no view computes a grade.
- Pointers: `instructor/InstructorApp.tsx:30-42`, `InstructorLayout.tsx`,
  `InstructorDashboard.tsx:184-189`, `GradebookView.tsx` (to retire), `routing.ts:26-32`,
  `useInstructorRoute.ts`, `theme.css`, `pages.css`; the mockup's `gr-*` CSS is the starting
  point.

## Verify
Gates; browser against local mode with HW1–HW7 loaded and the sample submissions: each
screen matches its mockup; screenshots into the progress log.

## Progress log
- 2026-09-27 (robot, implement): Built the Grading tab over the 064 summaries — no view computes a grade.
  - Routes: `instructor-grading`, `instructor-grading-assignment` (overview/matrix/queue[/:qid]),
    `instructor-grading-student`, `instructor-student` (student key URI-encoded whole); the old
    `#/instructor/assignments/:id/submissions` parses to the Overview and `canonicalHash` rewrites it
    on load/popstate. `instructor-submissions` retired; Dashboard tabs Assignments · Grading · …
  - Data: `AssignmentData.countsTowardGrade?` (absent = counts; HW7's `false` + instructor-owned is
    068's), carried to the summary and the `/api/grading` row; `GradingProgress.grades {mean, median,
    provisional}` over submitted roster rows, in the shared builder.
  - Views: `GradingTab`, `GradingAssignment` (+ `GradingOverview`, `GradingMatrix`, `GradingParts`),
    pure `gradingViews.ts`; interim `StudentSubmissionView` (the old gradebook detail, read through
    `gradingStore.attempt`; grade controls on hand-graded problems and existing grades) and
    `StudentGradingView`; queue view is a placeholder for 066. `GradebookView.tsx` and `Gradebook.ts`
    deleted; the dashboard reads `course()` (column = roster students submitted).
  - Not built here (owned elsewhere): the Export CSV file (071 — the Overview carries a disabled
    "Export CSV" button until then), Re-grade… (069), Needs attention / the Flagged chip / row
    flags (070).
  - Review fixes: the summary's `GradingProblem` carries `flags` (the counting attempt's integrity
    flag codes — never the details, which can name a classmate's email; the tooltip words them) so the matrix keeps the old gradebook's per-problem ⚑ before 070;
    `GradingAttemptMeta.late.deduction` is null when on time and net of any waiver (latent until
    068's policy), and the Late column tests `late.late` — no red "−0". Pinned in gradingViewCheck.
  - CSS: `.gr-bar`/`.gr-prog` in theme.css, the rest in pages.css, tokens only; dead gradebook rules
    removed. VISUAL_VOCAB §Page surfaces names the idioms.
  - Pins: new `gradingViewCheck` (cells, filters, problem stats, tiles, grades, release warning, sort,
    grep gate, retirement); routingCheck `[grading routes]`; gradingCheck `[mean]`, `[counts toward
    grade]`; navResetCheck, pipelineCheck, turbotCheck repointed. Both tscs, build, app + server
    `npm run check` green.
  - Browser (headless Chrome over a scratch Vite, local mode, HW1–HW7 + sample data, two sample
    attempts re-keyed to the toy roster): `tasks/attachments/2026-09-26-065-{1-grading-tab,2-overview,
    3-matrix,7-student-submission}.png`. The legacy URL landed on `#/instructor/grading/hw1`. Local
    dev-seed submitters are off-roster by design (064), so today's local data shows them below the
    matrix divider.

### 2026-09-27 — implemented (work loop)
- Built: the instructor Dashboard's new **Grading** tab — a course-wide assignment table, each
  assignment's Overview (tiles, stale banner, per-problem table, Release + a disabled Export CSV
  until 071) and Matrix (cells 1/½/0/✎/↻/— with human-grade underline and per-problem ⚑, chips,
  section select, search, sticky name/grade, Late + Grade columns; a row opens the student's
  submission). Every view renders the 064 summaries; none computes a grade. `GradebookView` retired.
- Pins: `gradingViewCheck` (new), routingCheck `[grading routes]` (incl. the legacy
  `/submissions` redirect), server gradingCheck `[mean]`, `[counts toward grade]`, row flags ≡
  attempt integrity codes, no-email; navResetCheck / pipelineCheck / turbotCheck repointed.
- Gates: app-tsc=0 app-build=0 app-check=0 server-tsc=0 server-check=0.
- Review fixed: (1) Export CSV action (disabled, 071); (2) Late column never "−0" (deduction null
  on time, net of waiver); (3) per-problem ⚑ via `GradingProblem.flags` codes only. Skipped: none.
  Nits left: CLAUDE.md trimmed unrelated facts to stay under budget.
- Owed: loop-session browser check in local mode (tab row, Grading tab vs mockup 1, Overview vs 2
  incl. release/hide round trip, Matrix vs 3 incl. filters/sticky/row click/grade write, legacy URL
  replace, /queue + students interim views, 375px no page scroll) with screenshots
  `tasks/attachments/2026-09-26-065-*.png`; remote mode optional (summary routes, public_id sids,
  no `/submissions/all`). Gabriel after release: pilot `#/instructor/grading` renders.
- **Next step:** loop session: visual check if owed, then land per PROFILE §5.

### 2026-09-27 — landed (robot)
- Visual check: the pane can't start a dev server in an unattended run, so the eyeball was the
  workflow's headless-Chrome shots of the real build (local mode, HW1–HW7 + samples) against
  mockups 1–3: tab row, Grading table (bars, current/stale, hand bar, mean*, Hidden tags),
  Overview (tiles, per-problem shares, Release) and Matrix (cells, underline, chips, search,
  off-roster divider, legend) all match. The Needs-attention box is absent as intended (070).
- Owed, not claimed: the shots predate the review fixes, so the Matrix's Late column and the
  Overview's disabled "Export CSV" button are code- and pin-verified only; also owed the
  release/hide round trip, sticky columns on horizontal scroll, the row → student route with a
  grade write, and 375px (recipe: the workflow's owedChecks above; re-shoot
  `tasks/attachments/2026-09-26-065-*.png`). Gabriel after release: pilot `#/instructor/grading`.
- Gates at land: app tsc/build/check, server tsc/check — all 0 (no new commits on main since).
