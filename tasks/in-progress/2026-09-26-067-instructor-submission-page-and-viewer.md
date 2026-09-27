---
id: 2026-09-26-067
type: feature
title: Show one student's submission to an instructor — full autograde detail, overrides, and the submitted machine in the read-only viewer
priority: high
size: large
requires: browser
area: app
source: chat
created: 2026-09-26T21:34:00-07:00
status: in-progress
after: 2026-09-26-065
branch: robot/067-instructor-submission-page-and-viewer
merged_into:
---

## Description
Filed from task 031's accepted design (Gabriel approved 2026-09-26, with its three proposed defaults). Authority: the memo `docs/buildout/designs/grading-interface.md` — its §3 table records every decision; read it before starting. Slice 7 of 11 (memo §12). HW1 is due Oct 4 and is returned about a week later, so slices 1–8 carry the schedule.

The instructor never sees a student's actual machine today — only failed-case tables
(memo F6, §6.3; mockup 5, `tasks/attachments/2026-09-23-031-5-submission.png`). Task 003 built
a read-only viewer for a student's OWN attempts; this generalises it.

## Done when
- `#/instructor/grading/:asg/student/:sid`: header (name, UID, section, account; counting
  attempt + older attempts read-only; submitted, late units and deduction; group members;
  integrity summary; previous/next student in matrix order), then every problem: full
  autograde incl. expected/got, the ½ rule's count, **Run this input**, and the points control
  (0 · ½ · 1, a required note on an override, Clear).
- **Open in viewer**: `store.ts viewSubmission` accepts a fetched record (from the 064 attempt
  detail) instead of reading `listOwn`; in that mode it never opens, folds or saves the
  instructor's own workbook, frozen logic ignores the instructor's submissions, and the lock
  message names the student. Run/Step work; edits refused (`isCurrentQuestionLocked`).
  `loadCaseInput` replays a case unchanged.
- Pinned: `navResetCheck` (viewing another's attempt never touches the viewer's workbook;
  leaving resets), `caseRunCheck` replay from a fetched record.

## Design
- **deepFix:** one viewer for "a submitted attempt", whoever owns it; ownership decides only
  where the record comes from.
- Pointers: `store.ts:2617-2677` `viewSubmission`, `:2635-2643` (listOwn), `:2658-2667`
  (own workbook), `:5202` (lock message), `:5223` `submittedQuestionCircuit`, `:4882`
  `loadCaseInput`, `routing.ts:74-82, 253-273`.

## Verify
Gates; browser: open a toy student's CC and turbot answers read-only, Run a failed case,
override ½ with a note, see it in the matrix.

## Progress log
- 2026-09-27 (robot, implement): **Viewer** — store.ts `viewingOwner` (cleared with every
  `viewingSubmission: null`), `ownsOpenWorkbook` (guards saveAssignmentState, the journal,
  saveForLeavingPrincipal, submitAssignment, openAssignment's same-id resume),
  `viewSubmission({record, owner})` (no listOwn; identity = owner + attempt; no fold/flush for a
  foreign target), `openSubmissionOf` (goHome-style leave, gradingStore.attempt + getAssignment,
  no loadForOpen / mint key), `leaveForeignView` (goHome and every other route close it);
  frozen false and lock strings name the student; copySelected refused while viewing another's.
  routing.ts: viewer hash `#/instructor/grading/:asg/student/:sid/submission/:n[/q/:i[/case/:k]]`
  → `{kind:'assignment', student, attempt}` (instructor-only; malformed attempt → the student
  page), `editorRoute` shared by QuestionPanel / GradedCaseBanner (latestAttempt undefined while
  foreign) / EditorTopBar (Grading crumbs, "Back to <name>'s submission"); App.tsx gates the
  foreign editor in InstructorGate. **Page** — StudentSubmissionView: header (UID, section,
  account, off-roster tag, late units/−D from the score else "late by", group, integrity count
  → anchor, older attempts, Open in viewer), ← Previous / Next → (`gradingViews.adjacentStudents`,
  unfiltered matrix order), per problem Open in viewer, ½-rule line (read off autoPoints), failed
  table + "All N cases" disclosure with Run this input (function/turbot only), GradeControls on
  every problem of the counting attempt, note placeholder says no medical/accommodation details.
  Pins: navResetCheck [viewing another's attempt], caseRunCheck [fetched record], routingCheck
  [viewer route]/[viewer apply], gradingViewCheck [adjacent students]; workbenchCheck's
  QuestionPanel pin follows editorRoute. Gates: app tsc/typecheck:tools/build/check, server check green.
- 2026-09-27 (robot, fix): review — leaving the foreign viewer stored an EMPTY canvas over the
  viewer's sandbox tab (`closeAssignment` blanks the live fields, which with no assignment ARE
  the sandbox's active tab; entered straight from the sandbox the tab was lost in memory too).
  `leaveForeignView` now puts the active tab back from `tabCircuits`; `openSubmissionOf` always
  leaves via `goHome` (sandbox: folded into its tab) and flushes the sandbox save while no
  assignment is in memory. Pinned: navResetCheck [viewing another's attempt] (h) (fails 6/6
  without the fix). **Verify done** (headless Chrome over CDP on a Vite dev server, local mode
  as Prof. Ada, sample data seeded): the student page renders header, prev/next (Previous
  navigates), ½-rule counts, failed tables, the "All N cases" disclosure with Run this input;
  Run this input on Q3 (FSM) case 0 opens the viewer read-only ("Viewing …'s attempt 1 —
  read-only", Grading crumbs, "Back to …'s submission"), banner "Same as when graded."; Q7
  (turbot FSM) shows the student's machine, Step moves the turbot, `addComponent` refused;
  Back returns to the page with the sandbox (2 parts) intact in memory and storage; ½ on Q3
  refused without a note ("overriding the autograde needs a note saying why"), saved with one,
  shown ½ underlined in the Matrix (65.7* → 67.9*).

### 2026-09-27 — implemented (work loop)
- **Built:** an instructor can open one student's submission as a page (header, prev/next in
  matrix order, every problem's autograde with expected/got, the ½-rule count, Run this input,
  the 0 · ½ · 1 control with a required override note) and open any answer in the ordinary
  editor read-only as that student's attempt — the record fetched, never the instructor's own
  workbook opened, folded or saved; leaving restores the instructor's sandbox/own copy.
- **Pins:** navResetCheck [viewing another's attempt] incl. (h) sandbox survives; caseRunCheck
  [fetched record]; routingCheck [viewer route]/[viewer apply]; gradingViewCheck [adjacent
  students]; workbenchCheck's QuestionPanel pin follows `editorRoute`.
- **Gates:** app-tsc=0 app-build=0 app-check=0 server-tsc=0 server-check=0.
- **Review:** fixed [major] leaving the viewer blanked the sandbox tab (leaveForeignView restores
  it; openSubmissionOf flushes the sandbox save); [minor] browser Verify done (above). Skipped:
  none. Nit left: a stray OFF_ROSTER_LABEL doc comment in GradingMatrix.tsx:21.
- **Owed:** browser eyeballs not yet seen — the instructor's own copy intact after a view
  (navResetCheck pins it), remote mode (server attempt route; a student's 403 on the viewer URL).
- **NEXT STEP:** loop session: visual check if owed, then land per PROFILE §5.
