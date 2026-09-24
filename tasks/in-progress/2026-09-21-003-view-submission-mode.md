---
id: 2026-09-21-003
type: feature
title: Let a student view a submitted snapshot read-only at any time, not only once past due
priority: normal
size: unknown
requires:
area: app
source: claude-md
created: 2026-09-21T15:30:00-07:00
status: in-progress
after:
branch: task/003-view-submission-mode
merged_into:
---

## Description
The frozen read-only view of the actually-submitted circuit (`frozenQuestionCircuit`,
`selectAssignmentFrozen`, `dueDates.ts isFrozen`) only applies once the due date has passed
AND a submission exists. Grades can be released earlier, and the grade sheet's "Open my
submission" link then lands on the live workbook, which may have diverged.

## Done when
- A student can open "submission N" read-only (Run/Step live, edits refused) from the grade
  sheet regardless of due date, and return to their live workbook.
- Freezing keeps its current semantics (past due + submitted = locked to the submission).

## Design
- **deepFix (recommended):** generalise the frozen path into a store "viewing submission"
  mode (`viewingSubmission: attempt | null`), with the due-date freeze becoming one trigger
  that forces it on. The lock stays in `isCurrentQuestionLocked`. Autosave already refuses
  to write while frozen; reuse that guard.
- **surgicalFix:** a second read-only route that mounts the same components.
- Open decision for Gabriel at claim time: can a student switch back to the live workbook
  while frozen (probably not), and which attempt does the link open (latest, or the graded one).

## Verify
Extend `navResetCheck`'s `[frozen assignment]` section with the non-frozen viewing case.
Owed, not claimed (browser): Grades → a released sheet → "Open submission N →" and the
dropdown's "Open my submission →" land on the attempt read-only (the MenuBar tag, no Submit;
the TabBar tag + "Back to my work"; the overview's "Viewing submission N" line); Run/Step
work; "Back to my work" shows the live work; a past-due + submitted assignment shows no way back.

## Progress log

### 2026-09-23 — implemented (work loop)
- **Built.** A store "viewing submission" mode: `viewingSubmission: SubmissionRecord | null`
  and `viewSubmission(attempt | null)`. The route is `#/a/:id/submission/:n[/q/:i[/case/:k]]`
  (`Route.assignment.attempt`; a malformed attempt is dropped and the rest kept). `applyRoute`
  awaits `viewSubmission(route.attempt ?? null)` after `openAssignment` and before
  `switchQuestion`/`loadCaseInput`, and an unknown attempt repairs the URL to the live route.
  The attempt is looked up in `submissions`, then the current view, then the submission seam
  (`listSubmissions`). Entering or leaving the view is a canvas swap (`resetAllSimState`).
  Showing the attempt already on show is a no-op, so a re-applied route keeps its run. Leaving
  the live workbook flushes the pending autosave, then folds the live canvas into
  `questionCircuits`. `switchQuestion` stays on the viewed attempt.
- **One lock, one save guard.** `selectQuestionLocked` is true while a submission is on show
  (`showsSubmission` = viewing OR frozen), so `isCurrentQuestionLocked` refuses every edit.
  Simulation is never locked. The fold never writes a viewed canvas: `syncedQuestionCircuits`
  (the autosave, the journal, the leaving principal's save, submit, export), `goHome`,
  `switchQuestion` and the done toggle all skip it. A submit while viewing records the LIVE
  work. The autosave subscriber and `saveForLeavingPrincipal` guard on `showsSubmission`.
- **Freezing is one trigger.** `openAssignment` sets `viewingSubmission` to the latest
  submission when frozen, and `switchQuestion` does the same when the freeze begins
  mid-session (it folds the live canvas first). `selectAssignmentFrozen`/`isFrozen` are
  unchanged. `frozenQuestionCircuit` is now `submittedQuestionCircuit`.
- **UI.** Grade sheet: the dropdown's "Open my submission →" opens that question in the
  sheet's attempt, and a new foot link "Open submission N →" opens the overview in view mode.
  "Run this input" stays on the live work (002's settled behaviour; its route carries no
  attempt, so it leaves a view). TabBar: "Submission N · read-only" plus "Back to my work" in
  place of Mark done (not when frozen); the arrows and "‹ Questions" keep the attempt. MenuBar:
  Submit is hidden while viewing, with a "Viewing submission N — read-only" tag. Overview: a
  "Viewing submission N, submitted … — read-only · Back to my work" line replaces Submit, and
  its problems open the attempt. The open/fill-in panels' lock line and the box rename/confirm
  refusals now name the lock (`selectLockNotice`/`lockRefusal`), so a viewed submission no
  longer says "Marked done".
- **Graded-case replay.** `loadCaseInput` reads the attempt on show (`viewingSubmission ??
  submissions[id]`), so a case under `/submission/N` replays that attempt on its own machine
  ("Same as when graded").
- **Settled by the loop session, open to Gabriel's revision.** (1) While frozen (past due +
  submitted) the student can NOT switch back to the live workbook: `viewSubmission(null)`
  resolves to the latest submission and no "Back to my work" shows (Done-when 2, and the
  task's own lean). (2) The sheet's link opens the attempt the sheet shows: the latest, which
  is both the one that counts and the one graded (grading is on receipt). The attempt is
  explicit in the route, so a later UI can open older attempts. (3) Task 002's "Run this
  input" and its divergence note are unchanged.
- **Latent bug fixed.** Before this change, `goHome` on a frozen assignment folded the
  SUBMITTED canvas into `questionCircuits` and saved it directly, which overwrote the live
  workbook's copy of that question. The done toggle had the same hole while frozen (only the
  TabBar hid it). Both are retired by the fold guard and pinned.
- **Pins.** `navResetCheck` has a new `[viewing a submission]` section: entering is a swap
  (junk flushed, undo empty); every edit is refused (add, paste, open response, undo, the done
  toggle), and a sim input change arms no save; an SC run steps on the viewed attempt; the live
  work and its editing record are untouched in memory and in the saved workbook after
  `goHome`; a submit while viewing records the live work; a repeat view is a no-op, an unknown
  attempt changes nothing, and the way back is a swap and editable; an older attempt comes
  through the seam. `[frozen assignment]` gains: no way back, the done toggle refused, goHome
  keeps the diverged live work (the latent-bug pin), and a fresh open views the latest.
  `[principal change]`: a viewed submission is cleared. `routingCheck` gains `[submission
  route]` (parse, round-trip, bad attempts dropped) and `[submission route: applied]` (view
  before switch before case, the live workbook asked for on a plain route, repair, superseded).
  `caseRunCheck` gains `[viewed attempt]`. Mutating each guard (goHome's, the synced fold's,
  the done toggle's, the subscriber's) fails its pin.
- **Out of scope, for the loop to file.** In remote mode an instructor's "Student view" gets
  every student's records from `listSubmissions` (and local mode keeps every toy account's in
  one list), so `getLatest`, the frozen view and an attempt lookup can show another person's
  submission. This was already true before this change, and it is untouched here.
- **Review fixes (Fix stage, 2026-09-23).** (1) A seam lookup of an older attempt overtaken by
  a newer navigation on the SAME assignment no longer lands: a new `viewSubmissionSeq` is
  bumped by every `viewSubmission` call, every `openAssignment` (the same-assignment resume
  included), `goHome` and `resetForPrincipal`, and the lookup applies nothing unless it is
  still the latest (`openAssignmentSeq` alone could not tell, since a same-assignment
  navigation never bumps it). (2) `saveForLeavingPrincipal` no longer returns early while a
  submission is on show: its snapshot never folds a viewed canvas, so it saves (remotely:
  journals, then PUTs) the live workbook, whose save on the way into the view may still be in
  flight or queued as the trailing rerun the reset cancels. (3) The "a sim input change arms
  no save" pin now toggles a real INPUT (on the submitted SC circuit; Q1's submitted canvas
  has none) and asserts the chip stays `saved` straight after the toggle. New pins in
  `navResetCheck`: `[viewing a submission]` (j) — an overtaken lookup applies nothing against
  a newer live route, a newer view of another attempt, and Home; `[principal change
  mid-save]` — a live edit left unsaved behind a viewed submission reaches the seam at the
  change. Mutating each fix fails its pin.
- **Gates (by exit code, final tree).** app `tsc` 0, app `npm run build` 0, app `npm run check`
  0, server `typecheck` 0, server `npm run check` 0. Re-run at checkpoint: app `tsc` 0,
  `navResetCheck` 0 (361 passed), `routingCheck` 0, `caseRunCheck` 0, `check-budgets` 0
  (CLAUDE.md 39,961 B). Review findings: 1+4 (the same race), 2 and 3 fixed as above. None
  skipped, no nits left.
- **Owed, not claimed (browser; the loop session does these).** (a) Local mode, not frozen:
  instructor loads HW1–HW7, publishes HW1 with a future due date; a toy student submits a wrong
  HW1 P1 (attempt N), then edits further; instructor releases grades; student: Grades → HW1 →
  ▸ failed inputs → "Open my submission →" lands on `#/a/hw1/submission/N/q/0` with the
  submitted machine, "Submission N · read-only" + "Back to my work", no Submit, gate drag and
  delete refused, INPUT toggles and Run/Step working; ←/→ and "‹ Questions" keep the attempt
  (overview banner, Submit hidden); "Back to my work" shows the diverged live machine,
  editable, Submit back; reload restores the view; browser Back from live returns to it; the
  foot link "Open submission N →" opens the overview in view mode; "Run this input" still runs
  the LIVE machine with 002's divergence note. (b) Frozen: due date in the past → `#/a/hw1` and
  the sheet link show the submission, past-due tags, no "Back to my work"; Home, reopen, due
  date back to the future → the live diverged work is intact. (c) Open and fill-in questions
  show the submitted text read-only; at 375 px the question bar, overview banner and sheet foot
  do not scroll sideways; site tokens (IBM Plex, link colour). (d) Remote mode ("Vite Remote
  Mode" + server on 8199): viewing a non-latest attempt makes one GET
  `/api/assignments/:id/submissions`; while viewing, no PUT `/api/workbooks/:id` except
  goHome's, whose body is the live work; zero `/api` traffic in local mode (law 5).
- **For Gabriel to confirm (loop-settled, open to revision, as 002 did).** (1) Frozen has no
  way back to the live workbook. (2) The link opens the attempt the sheet shows: the latest,
  which is also the graded one (the gradebook counts the latest; the sheet renders
  `getLatest`), so the two options coincide. (3) 002's "Run this input" is unchanged.
- **Next step.** Loop session: the owed browser checks (a)–(d) above, then land per PROFILE §5,
  and file the out-of-scope instructor "Student view" / shared-local-list submission leak.
