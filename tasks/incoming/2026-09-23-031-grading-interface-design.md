---
id: 2026-09-23-031
type: research
title: Design the instructor grading interface (audit done at intake) — design memo + mockups for Gabriel's approval
priority: high
size: large
requires: human
area: app
source: chat
created: 2026-09-23T10:00:00-07:00
status: ready
after:
branch:
merged_into:
---

## Description
Gabriel (2026-09-23): "We need a grading interface for instructors. This should be part of the
dashboard. But before we can even build it, I think we need to design it, and approve." His
starting list: organized by assignment; a button to auto-grade / re-grade every auto-gradeable
problem of an assignment for all students; going into an individual student's responses; a
hand-grading method for problems that need it, both by student and across students on the
same problem; a progress bar; notes; flagging students who are late or in trouble (not
submitted, doing poorly several weeks in a row) — "and probably more". The catcher ran the
audit below at intake; this task turns it into an approved design. **No code in this task.**

## Findings — the audit (catch session 2026-09-23)

### A. What exists today
- **Gradebook** — `#/instructor/assignments/:id/submissions` → `GradebookView`
  (`app/src/instructor/GradebookView.tsx`, `Gradebook.ts`), reached only from the dashboard
  row's "Submissions" button (`InstructorDashboard.tsx:186`). Per assignment: one row per
  student keyed by the submission's email string (never the roster name; `:92–101`); the
  latest attempt counts (`:100–104`); stat tiles — students, submissions, mean score,
  per-question pass rate, "✎ N to review" (`:132–171`, the only progress indicator); columns
  Student · Last submitted (+ late tag) · Attempts · ✓/✗/✎ per question · Score; expandable
  attempt history (`:271–305`) → `SubmissionDetail`, a failed-cases-only drill-down per mode
  (`:351–547`); ✓ Correct / ✗ Incorrect + note on OPEN questions only (`:552–608`);
  Release/Hide grades per assignment (`:61–71`). No filters, sort, search, not-submitted
  list, per-student notes, or view of the student's actual machine.
- **Dashboard** — "Submissions" column counts every attempt, not students
  (`InstructorDashboard.tsx:26–29`); nothing about pending review, release state or due dates.
- **Roster** (remote only, `RosterView.tsx`) — name, email, student ID, role, account yes/no;
  never joined to submissions.
- **Student side** — Grades tab + `GradeSheet` (verdict, instructor note, safe failed inputs);
  the server withholds `result` until release and `expected`/`got` always
  (`server/src/sanitize.ts:54–63, 86–91`).
- **Server** (`server/src/app.ts`) — submit grades once on receipt (`:495–521`,
  `gradeSubmission` at `:513`); `GET …/submissions` per assignment only (`:525`); review
  (`:544–583`, pending questions only, overwrite, `reviewedAt` stamped); grades-release
  (`:463`); visibility (`:448`). No re-grade, no override, no cross-assignment listing.
- **Data** (`server/src/db.ts`) — `submissions(id, assignment_id, email, attempt,
  submitted_at, submission JSON, result JSON)` keeps every attempt (`:104–114, 597–623`); a
  review lives INSIDE the result JSON (`questions[i].manual`), leaving `status: 'pending'` and
  `passed/total` untouched; `users(email, name, role ∈ {student, instructor}, student_id,
  password_hash, registered_at)` (`:82–85, 165–167`) — no last-login.

### B. Gaps against the course's own policy
The makingminds.org Policies page (source repo `Phil 133 - web/claude redesign/policies.html`)
defines grading; the app implements almost none of it.

| Policy | App today | Implication |
| --- | --- | --- |
| Paragraph answers human-graded; machine & multiple-choice computer-graded, "not with AI" | Open questions → `pending` → ✓/✗ review | Hand grading exists in embryo; task 014 (LLM grading) can only ever be a suggestion a human confirms |
| "Complex problems are graded on a 0, 0.5, 1-point basis"; assignment grade = 40 + 60·P, P = fraction of available points | Pass/fail per question, "No partial credit" (`engine/grader.ts:18–23`); score = fraction of questions passed (`Gradebook.ts:59–61`) | A points model with ½ credit; an override on autograded problems (HW6 desert ant, HW7 capstone, the 10 "interface-tier" fixtures whose autograde is not trusted as exact) |
| Late: −5 once late, −5 per class meeting after (HW6: per day), floor 0; > 2 weeks late normally not accepted | `lateBy` shown as a tag only (`dueDates.ts:38`) | Penalty computation needs the class-meeting calendar (Tue/Thu, holidays — in the website's `data/course.json`) |
| Extensions requested ≥ 1 week ahead | One due date per assignment, no per-student override | Per-student extension DATE; never its reason (see P3/P4 below) |
| Groups ≤ 3; list members on the submission; membership must be reciprocal | No group field on a submission | A members field + a reciprocity flag |
| Six problem sets = 55 % | The app holds HW1–HW7 (HW7 = Final Project) | Which six count; is the final project graded here |

**Data classification** (`Set Up Administration/data classification analysis - P2 vs P3.md`):
grades are FERPA education records → **P3**: need-to-know access, event logging, backups.
Accommodation/disability information is **P4** and must stay out of the platform — an
extension may be stored as a date, never with a reason. Today a review stores no grader
identity and keeps no history, and a roster row with role `ta` becomes a full `instructor`
(`server/src/roster.ts:214–218`) — edit, publish, release, roster and all.

### C. Defects the interface would stand on (foundation)
- **F1 · The score has no single definition.** Three computations disagree:
  `Gradebook.ts:59–61`, `summarizeResult` (`engine/grader.ts:483–487`, counts only
  `status === 'graded'`, so a reviewed open question is missing from the student's Grades-row
  "N of M" while `GradeSheet.tsx:84–88` includes it), and `gradeDisplay.ts:14–18`.
- **F2 · Results go stale silently.** Graded once at receipt; the assignment is not
  snapshotted; editing test cases — or the homework sync that rewrites HW content on every
  release (task 007, `server/src/homeworks.ts`) — leaves old results as they were. An added
  question shows ✗ but is not scored; a deleted one still counts. A naive re-grade (fresh
  `gradeSubmission`) would WIPE manual reviews.
- **F3 · Hand grades are per attempt.** A resubmission re-opens every open question (✎) and
  strands the earlier verdict on the old attempt.
- **F4 · No grader identity, no history** (P3 event logging).
- **F5 · Payload.** `GET …/submissions` returns every attempt's full circuits and every case,
  unpaginated (`db.ts:635–640`; "a few MB" per submission, `app.ts:74–76`) — tens to hundreds
  of MB per assignment at 80 students. `listSubmissions` does not even select `email`
  (`db.ts:631, 637`).
- **F6 · Small ones.** Dashboard counts attempts as submissions; `removeAssignment` orphans
  submissions (`db.ts:522`); gradebook shows emails not names; not-submitted students are
  invisible; the instructor never sees the student's machine, only failed-case tables (the
  student-side twin is task 003; both would use the frozen-circuit viewer,
  `store.ts frozenQuestionCircuit`).

### D. Needs inventory (Gabriel's list + derived)
1. **Per-assignment grading home** — progress: submitted / on roster, late, not submitted;
   autograded; hand-graded x of y; released or not. Actions: Auto-grade all (re-grade),
   Release/Hide, Export.
2. **Matrix** — students × problems, roster names, not-submitted rows, late tags; filter and
   sort by needs-review / late / missing / low score.
3. **A student's submission** — every problem with a read-only canvas of the submitted machine
   (Run/Step allowed), full autograde detail (expected/got), grade + override (0 / ½ / 1 +
   note), attempt switcher, group members, late status and extension.
4. **Hand-grading queue** — by problem across students (fast: next/previous, one-key 0 / ½ / 1,
   note, auto-advance) and by student; optionally anonymized.
5. **Re-grade** — every auto-gradeable problem × every counting attempt against the CURRENT
   assignment; a dry run first ("N results would change"); never touches hand grades or
   overrides.
6. **Late & extensions** — per-student extension date; penalty computed per policy;
   instructor waive.
7. **Flags / at-risk** — not submitted by due; late; > 2 weeks late; low scores N assignments
   in a row; no account yet; group mismatch. Needs a **per-student page across all
   assignments** (and a cross-assignment summary endpoint, which does not exist).
8. **Notes** — per-question feedback the student sees on release (exists) vs private
   per-student instructor notes (missing) vs the shared Notes page (exists).
9. **Release** — per assignment today; granularity to decide.
10. **Export** — per-assignment grades out of 100 and/or the course grade (40 + 60·P, late
    deductions, 55 % / 15 % / 25 % / 5 % weights) for the official gradebook.
12. **Integrity flags** (added 2026-09-23, from task 033): identical or near-identical circuits
    across students (a canonical circuit hash), identical open-response text, and later a
    workbook-save history showing a circuit that appeared fully formed. These are the only
    defence against console, localStorage or API tampering and redrawing by hand. Present them
    as prompts to look, never verdicts.
11. **Several graders** — a TA/grader role; who graded what; not two people on one response.

### E. Straw-man surface map (for the review, not decided)
Dashboard gains a **Grading** tab (beside Assignments · Roster · Feedback · Notes): a list of
assignments with grading status → **Assignment grading** page with three views — *Overview*
(progress + actions), *Matrix* (students × problems), *Queue* (by problem / by student) → a
**Student submission** page (`#/instructor/grading/:asg/:email`) → a **Student** page across
all assignments (`#/instructor/students/:email`, reached from Roster and from flags). The
existing gradebook route is retired into it.

### F. Data layer the design implies
- **A grade model separate from autograde output**: `result` stays the recomputable autograde
  output (stamped with the assignment version it was graded against); human judgment lives in
  a `grades` table keyed (assignment, student, question) — points (0 / ½ / 1 or the problem's
  max), note, grader, time, the attempt it was given on — so re-grades never wipe it and a
  resubmission after grading is flagged "changed since graded" rather than silently reopened.
- **One pure `scoreSubmission`** in `engine/` (retires F1): per-problem points (default 1),
  override > hand grade > autograde, P, 40 + 60·P, late deduction.
- **Endpoints**: a slim per-assignment summary (latest attempts, no circuits), one attempt's
  detail on demand, re-grade (dry run + commit), grade write, a per-student cross-assignment
  summary, extensions, an append-only grade-change log.
- Roster joined in (names, not-submitted, TA/grader role).

### G. Relationship to queued tasks
014 (LLM open-question grading) becomes a suggestion inside the hand-grading queue and waits
for this design. 003 (student views the submitted snapshot) shares the read-only viewer with
item D3. 002 (failed input → live Run) applies equally to the instructor's view. 008 (backups)
should precede any re-grade that commits.
**030 (Activity tab, filed 2026-09-22)** overlaps: its per-assignment started / submitted / late
counts and per-question pass rates are the same roster ↔ submissions join and summary query
this design needs. The memo must say what lives where — suggested: Activity = usage (accounts,
active students, saves, traffic), Grading = progress, grades and flags — and name ONE shared
summary endpoint both consume.
## Done when
1. A design memo `docs/buildout/designs/grading-interface.md`: surfaces and routes; the grade
   model (points, ½ credit, override, counting attempt, late penalty, extensions); re-grade
   semantics; the data layer (tables, endpoints, migration of existing `manual` reviews);
   P3 constraints; what is deferred. Every claim about current behaviour cites `file:line`.
2. Mockups of the Grading tab, the assignment Overview / Matrix / Queue, the student
   submission page and the per-student page, drawn in the page vocabulary (`theme.css` tokens,
   `pages.css` idioms) — static HTML or an artifact — with screenshots in
   `tasks/attachments/2026-09-23-031-*.png`.
3. Every decision below answered by Gabriel and recorded in the memo's Resolved decisions.
4. Gabriel approves (recorded in the progress log), and the build is filed as ordered tasks —
   expected slices: (i) grade model + `scoreSubmission` + `grades` table + change log;
   (ii) summary / detail / cross-assignment endpoints + roster join; (iii) re-grade with dry
   run; (iv) Grading tab + Overview + Matrix; (v) hand-grading queue; (vi) submission viewer
   (shared with 003); (vii) late penalties + extensions; (viii) flags + student page;
   (ix) export; (x) grader role.
5. `CLAUDE.md` "What's next" names the grading interface.

## Design
- **deepFix (recommended):** design the grade model first (separate from autograde output,
  one score function, a change log), then the surfaces on top of it. It retires F1–F5 and
  gives every later surface — flags, export, the student page — one source of truth.
- **surgicalFix (rejected):** add a Re-grade button and a ½ option to `GradebookView`. The
  scores keep disagreeing, results keep drifting, and the first re-grade wipes every hand
  verdict.

### Decisions for the review (Gabriel's calls; recommendation first)
1. **Where** — a Grading tab in the dashboard (rec.), or grading under each assignment row.
2. **Points** — every problem 1 point by default, instructor may set more; ½ allowed on any
   hand grade or override (rec.).
3. **Override autograde** — allowed on any problem, with a required note (rec.).
4. **Counting attempt** — the latest submission, as the submit dialog promises, even when an
   earlier on-time one exists; the instructor may pick another per student (rec.).
5. **Late penalty** — computed by the app per policy from the class-meeting calendar, shown,
   waivable (rec.); or shown as a tag only.
6. **Extensions** — a per-student due date, stored without a reason (rec.).
7. **What counts** — which six of HW1–HW7 are "the six problem sets"; is the HW7 final
   project graded here.
8. **Groups** — a group-members field on submit and a reciprocity flag (rec.).
9. **TAs** — a grader role that grades but cannot edit, publish, release or manage the roster
   (rec.); or TAs as full instructors (today).
10. **Anonymous grading** — a hide-names toggle in the by-problem queue (rec.).
11. **Release** — stays per assignment (rec.), or per problem.
12. **Export** — CSV of per-assignment grades out of 100 plus a course-grade column; confirm
    the target (Bruin Learn, MyUCLA, a spreadsheet).
13. **Flag thresholds** — e.g. below 70 on two consecutive assignments; > 2 weeks late;
    no account a week into the term (rec. as a starting point).
14. **Student regrade requests** — out of scope for now (rec.).
15. **Private per-student notes** — yes, instructors only (rec.).

## Verify
A design task: verified by Gabriel's approval in the progress log and by the follow-on tasks
existing. The memo's current-behaviour claims are spot-checked against the cited lines; the
mockups are screenshot-attached.

## Progress log
