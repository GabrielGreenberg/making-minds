# Grading Interface: One Grade Model, Then the Surfaces on Top
_Status: accepted (Gabriel, 2026-09-26) · Task: 2026-09-23-031 · Build: tasks 2026-09-26-061…071 ·
Decisions: all answered by Gabriel 2026-09-26 (§3) · Mockups: `grading-interface/mockups.html`,
screenshots `tasks/attachments/2026-09-23-031-*.png`_

## 1. The phenomenon, and why the fix is a model before a screen

Instructors need to grade: see who submitted, re-run the autograder, hand-grade the paragraph
answers, give ½ credit, apply the late policy, spot students in trouble, and export grades.
The app today has one gradebook page per assignment and a ✓/✗ button on open questions. The
missing screens are the visible part. Underneath is one defect family: **human judgment is
stored inside the autograder's output, and nothing defines what a grade is.**
- A hand verdict lives in `result.questions[i].manual` (`types.ts:606-610, 624`). It sits on one
  attempt, so a resubmission strands it (F3), and a fresh grading run would overwrite it (F2).
- The score is computed three ways that disagree (F1, §2.2).
- Results are never tied to the version of the assignment they graded (F2). No record says who
  graded what (F4).

A surgical fix, adding a Re-grade button and a ½ option to `GradebookView`, keeps all four
defects, and its first re-grade would wipe every hand verdict. The deep fix is four pieces,
with every surface a view over them:
- **(a)** A grade record separate from the autograde output, anchored to the answer it judged.
- **(b)** One pure score function.
- **(c)** Results stamped with the assignment version they graded.
- **(d)** An append-only log of every grade change.

This retires F1–F5 and gives every later surface one source of truth: the flags, the export,
the student page, and the student's own Grades tab.

## 2. Current behaviour (verified against `e3218ee`, 2026-09-26)

### 2.1 Surfaces and endpoints
- **Gradebook**: `#/instructor/assignments/:id/submissions` (`routing.ts:29`, parsed `:58-67`) →
  `GradebookView` (`InstructorApp.tsx:35-36`), reached only from the dashboard row's
  "Submissions" button (`InstructorDashboard.tsx:184-189`).
  - One row per submission `student` email string, never a roster name (`GradebookView.tsx:94-103`;
    the server stamps `student: req.user!.email`, `server/src/app.ts:595`).
  - The latest attempt is picked in the view (`GradebookView.tsx:102`) and stats run over latest
    attempts (`:106`).
  - Stat tiles at `:134-174`. "Submissions" is `grades.length`, so every attempt counts.
  - Two-level expansion into `SubmissionDetail` (`:370-567`), which shows failed cases only per
    mode (`:433-435, 470, 502, 535`), the open response (`:391-408`) and integrity notes
    (`:573-600`).
  - Manual review: ✓/✗ + note (`ManualReviewControls`, `:605-660` → `recordManualReview`,
    `:621-627` → `POST …/submissions/:attempt/review`, `api/client.ts:510-519`), offered on every
    attempt, pending questions only.
  - Release/Hide in the header (`:63-73, 122-130`).
  - No filter, sort, search or not-submitted list. No per-student note. No view of the student's
    machine: the only `navigate` calls go back to the dashboard (`:83, 115`).
- **Dashboard**: its "Submissions" column is `listAll(...).length`, every attempt
  (`InstructorDashboard.tsx:26-29`, shown `:165`). The tabs are `SECTIONS`
  (`InstructorLayout.tsx:11-20`, rendered `:32-47`); instructor routes are listed at
  `routing.ts:26-32`.
- **Server**:
  - Submit grades once on receipt (`app.ts:581`, `gradeSubmission` `:599`) and assesses
    integrity beside the grade (`:604-611`).
  - `GET …/submissions` returns the caller's own attempts (`:626-636`, task 037). The instructor
    feed is `GET …/submissions/all` (`:638-640`), per assignment only. No cross-assignment listing.
  - Review: `:651-690`. It stamps `reviewedAt` (`:681`) and never the reviewer. It applies to
    pending questions only (`app/src/storage/manualReview.ts:30-33`) and overwrites (`:17-19,
    34-36`).
  - Release `:543-556`, visibility `:528-541`. No re-grade and no override route.
  - Instructor routes gate on `requireInstructor` (`server/src/auth.ts:278-284`).

### 2.2 The score has three definitions (F1)
| Where | Rule |
| --- | --- |
| `instructor/Gradebook.ts:26-45, 55-61` | passed ÷ non-pending questions; a skipped or 0-case question counts as failed; a reviewed open question counts by its verdict |
| `engine/grader.ts:309-321` `summarizeResult` | passed ÷ `status==='graded'` only, so every open question is excluded, reviewed or not (shown as "N of M correct", `GradesView.tsx:73, 96`, `HomeScreen.tsx:139, 174`) |
| `components/GradeSheet.tsx:119-123, 187` | counts `questionVerdict` pass/fail tones (`gradeDisplay.ts:11-27`), so reviewed open questions are included |

One expanded Grades row shows rule 2 in the row and rule 3 in its sheet. They disagree whenever
an open question has been reviewed. The grader itself is pass/fail: "No partial credit"
(`engine/grader.ts:19-23`).

### 2.3 Data
- `submissions(id, assignment_id, email, attempt, submitted_at, submission, result)`
  (`server/src/db.ts:161-169`), with `integrity` added at `:252`. Every attempt is kept
  (`addSubmission`, `:1006-1041`), with no foreign key.
- `listSubmissions` (`:1044-1074`) does not select `email`. It returns every attempt's full
  submission + result + integrity with no LIMIT. A submission "can run to a few MB"
  (`app.ts:93-95`), so this is F5, the payload problem.
- **F2, results go stale.** A result records no assignment version: `SubmissionRecord`,
  `types.ts:655-664`, carries only `assignmentTitle` (`app.ts:593-598`). Both the homework sync
  (`server/src/homeworks.ts:108`) and `PUT /api/assignments/:id` (`app.ts:504-517`) rewrite
  content without re-grading.
- `removeAssignment` deletes only the row (`db.ts:885-887`), so submissions are orphaned.
- **F4, no record of who graded.** There is no event log of any kind. The only "who" stamps are
  `access_requests.resolved_by` (`db.ts:182`) and the Notes page's `updated_by` (`app.ts:869`).
- **Accounts.** `users` is keyed by `email`, the permanent account key, with UID, section and
  sort name added (`db.ts:131-135, 243-294`; `identity.ts:5-13`). There is no last-login column.
  Roles are `student | instructor` (`db.ts:134`), and a roster `ta` becomes `instructor`
  (`roster.ts:571-576`).
- `sanitize.ts` strips answer banks from student copies (`:42-59`), blanks `expected`/`got`
  (`:64-82`), removes `integrity` (`:119`), and withholds `result` until release (`:122`). It
  passes `manual` (including the note) and `response` through (`:86`).

### 2.4 Reusable pieces
- Task 003's read-only viewer: `store.ts viewSubmission` (`:2617-2677`) plus
  `submittedQuestionCircuit` (`:5223`). It covers own attempts only: records come from
  `listOwn` (`:2635-2643`), and it opens the viewer's own workbook (`:2658-2667`).
- "Run this input": `loadCaseInput` (`store.ts:4882`) over `engine/caseRun.ts`, which is key-free.
- The machine fingerprint `gradedMachineKey` (`engine/caseRun.ts:390`): same key, same grade.
- The submit dialog already promises "only your most recent submission is graded"
  (`provenance/notice.ts:28`).
- Page vocabulary: `.mm-tabs`, `.mm-segmented`, `.mm-table`, `.tag--*`, `.mm-btn--*`,
  `.mm-modal`, `.instructor-stats` (`theme.css`, `pages.css`). There is no progress bar yet.
- No class-meeting calendar exists in the repo. The website has one:
  `Phil 133 - web/claude redesign/data/course.json`, where `schedule[]` holds lesson / exam /
  holiday / hw entries and `course.lecture` is Tue & Thu 12:30–13:45 PT.

## 3. Resolved decisions (Gabriel, 2026-09-26)

| # | Question | Answer | Consequence in this design |
| --- | --- | --- | --- |
| 1 | Where | **A Grading tab** in the Dashboard | Tabs: Assignments · Grading · Roster & accounts · Feedback · Notes. The old gradebook route redirects into Grading (§6.6). |
| 2 | Points | **1 point per problem; ½ allowed on any human grade** | No `points` field. The value set is {0, ½, 1}. |
| 2b | Machine ½ | **An automatic per-problem rule**, set by the author | `half_credit_at` on a question (§4.3). |
| 3 | Override | **Any problem, note required** | Overrides and hand grades are one record kind (§4.2). |
| 4 | Counting attempt | **Latest only**, no per-student pick | As the submit dialog promises. A late resubmission makes the whole submission late, and the dialog warns first (§6.7). |
| 5 | Late | **Computed per policy, shown, waivable** | The deduction comes from the calendar (§4.6). A waiver is a logged adjustment. |
| 5b | Calendar | **A repo copy of the website's `course.json`**, synced on release | `app/src/devData/courseCalendar.json` (§7.4). |
| 6 | Extensions | **A per-student due date, no reason stored** | Lateness and freezing use the effective date. The student sees it (§4.7). |
| 7 | What counts | **HW1–HW6; HW7 not graded** | A `countsTowardGrade` flag per assignment. |
| 8 | Groups | **Roster-picked members at submit + reciprocity flag** | §6.7, §8. |
| 9 | TAs | **TAs stay full instructors** | No grader role (slice x of the audit is dropped). Every change is still logged with its actor. |
| 10 | Anonymous | **A hide-names toggle** in the by-problem queue | A per-person preference. |
| 11 | Release | **Per assignment** | As today. The Overview shows what is still pending first. |
| 12 | Export | **Plain CSV, one row per student** | UID, name, email, HW1–HW6 out of 100, average. |
| 12b | Course grade | **Problem sets only** | No exam or participation data in the app (a smaller P3 surface). |
| 13 | Flags | **The five, with tunable thresholds** | Not submitted by due · > 2 weeks late · < 70 on two consecutive sets · no account one week in · non-reciprocal group. |
| 15 | Private notes | **Yes, on the student page**, instructors only | A dated, append-only note log. |
| 16 | Resubmit after a hand grade | **Carry the grade if the answer is unchanged**, else "changed since graded" | Every human grade is anchored to an answer fingerprint (§4.4). |
| 17 | Two graders at once | **Soft claim** | "Being graded by …" for 5 minutes; the queue skips it; nothing is locked (§6.4). |
| 14 | Student regrade requests | **Out of scope for now** | Students email; instructors override. |

## 4. The grade model

### 4.1 Points
- Every problem is worth **1 point**, and a problem earns 0, ½ or 1.
- P = earned ÷ available over all the assignment's questions.
- Assignment grade G = **40 + 60·P**, rounded to 0.1.
- Late deduction D (§4.6). Final = **max(0, G − D)**: it can go below 40 but not below 0 (policy
  text). No curve.

### 4.2 Where a problem's points come from (precedence)
1. **Human grade**: a hand grade (open questions) or an override (any autograded problem). It is
   one record kind: `{points ∈ {0,½,1}, note, grader, at, answerKey}`, and its note is required
   when it overrides an autograde. It wins only while its `answerKey` matches the counting
   attempt's answer (§4.4). Otherwise it stays attached as a *suggestion* and the problem shows
   **changed since graded**.
2. **Autograde**: 1 if every case passes. ½ if the question's `half_credit_at` rule is met.
   Otherwise 0.
3. **Pending**: no valid human grade and nothing the autograder could grade: an open question,
   or one the grader skipped (the question had no bank or spec; a submission always carries an
   answer for every question, so a skip is never the student's blank). It counts as **0
   earned**, with the grade marked **provisional** (never over-reporting), and releasing warns
   while any remain. _(Refined while building task 061.)_

The autograde value is always shown beside a human grade, so an override never hides what the
machine did. A re-grade that changes the autograde under an override flags it
("autograde changed under override").

### 4.3 The automatic ½ rule (decision 2b)
- `AssignmentQuestion.half_credit_at?: number` means: **½ when at least K of the question's N
  cases pass**, with 1 ≤ K < N.
- One rule serves every mode, because every grader already reports a case vector:
  - value cases `cases[]`
  - turbot arenas `turbotCases[]`
  - perception films `perceptionCases[]`
  - fill-in blanks `fillCases[]`
  So a turbot question with three arenas can say "½ for 2 of 3 arenas", and a fill-in question
  "½ for 3 of 5 blanks".
- **A machine rejected at Stage 1 earns 0, never automatic ½.** That covers an invalid machine,
  a disallowed part, or one over a component limit. A human may still override.
- The author sets K in the question creator ("½ if ≥ K of N cases pass", with N shown live), and
  `validateDocument` (`problemSet.ts`) rejects K ≥ N at save. Generated value banks can change
  size when a formula changes, so the creator re-validates K on every bank rebuild.
- Absent means no automatic ½.

### 4.4 The counting attempt and carry-forward (decisions 4, 16)
- The **latest** submission counts, always.
- A human grade records the `answerKey` of the answer it judged:
  - machine → `gradedMachineKey` (`engine/caseRun.ts:390`)
  - open → the response text, whitespace-normalised
  - fill-in → the normalised blank values
- When the latest attempt's answer to that question has the same key, the grade applies
  silently. If the key differs, the problem returns to the queue as **changed since graded**,
  showing the old grade as a one-click suggestion.
- `answerKey` is pure and lives in `engine/`, beside the score function.

### 4.5 Not submitted
There is no grade before the due date. After the effective due date (§4.7) with no submission,
the problem set is **Missing**. The export writes 0, since the policy's average of A1–A6 treats
a missing set that way. _(Default confirmed at approval.)_

### 4.6 Late penalty (decisions 5, 5b)
- **When a submission is late**: `submittedAt` is after the student's effective due date. The
  server stamps `submittedAt`, and a late resubmission is late: latest only.
- **The deduction** is 5 points once late, plus 5 more per class meeting that has **ended**
  after the due date and before `submittedAt`.
  - Class meetings are the calendar's lecture and in-class exam dates, at their 12:30–13:45 slot.
    Holidays simply have no meeting. The finals-week exam slot is not a meeting.
  - A meeting "passes" when it has ended (confirmed at approval).
- **Per-day assignments**: an assignment can carry `latePolicy: 'per-day'` (HW6, due on the
  last day of instruction). It deducts 5 once late plus 5 per full 24 hours after.
- After instruction ends, per-meeting deductions stop growing. The "> 2 weeks late" flag (§8)
  carries the policy's "normally not accepted" to a human.
- **Waiver**: a logged adjustment `{points waived, note}` per (assignment, student). It reduces D
  and never goes below 0.
- The computation is pure (`engine/score.ts`, below). It takes the calendar and the effective
  due date as inputs, so the student's sheet, the matrix and the export can't disagree.

### 4.7 Extensions (decision 6)
- An extension is a per-(assignment, student) due date `{dueDate, setBy, setAt}`. It never has a
  reason field: accommodation information is P4 and stays out of the platform (§9).
- The **effective due date** is the extension if one exists, else the assignment's date. It
  drives lateness, the deduction and freezing: `isFrozen` (`dueDates.ts:70`) gets the effective
  date.
- The student sees it: the server serves the student's copy of the assignment with `dueDate`
  set to their effective date, so Home, the overview and the freeze all follow without new
  client logic.

### 4.8 One score function (retires F1)
`app/src/engine/score.ts` is pure, and both the server and local mode import it:
```ts
scoreSubmission({ assignment, result, grades, latest, effectiveDue, calendar, waiver })
  → { problems: [{ questionId, points: 0|0.5|1|null, source: 'auto'|'auto-half'|'human'
                   |'pending'|'changed', autoPoints, suggestion? }],
      earned, available, P, raw /* 40+60P */, late: { meetings|days, deduction, waived },
      final, provisional, missing }
answerKey(question, answer) → string
lateDeduction(submittedAt, effectiveDue, policy, calendar) → { units, deduction }
```
`Gradebook.ts`'s score, `summarizeResult`'s question count and `GradeSheet`'s tally are
retired into it:
- The student's Grades row shows **82.5 / 100** after release.
- The sheet shows per-problem points (1 · ½ · 0 · awaiting review) and the late line.
- `summarizeResult` keeps only its case totals, if anything still reads them.

Pinned by a new `app/tools/scoreCheck.ts`: precedence, ½ rule, carry-forward, late math across
the real calendar (holiday weeks, the midterm meeting, HW6 per-day), the floor, missing, and
server ≡ client parity (extend `parityCheck`).

## 5. Re-grade (the "Auto-grade all" button)
- **Stale detection.** Every stored result carries `assignmentHash`: `homeworkContentHash`
  (`devData/homeworkSync.ts:56`) of the assignment it was graded against. That hash already
  excludes instructor-owned fields, so reordering or re-dating doesn't mark results stale. The
  Overview says "12 submissions were graded against an older version" whenever hashes differ.
- **Dry run first.**
  - `POST …/regrade {dryRun: true}` re-runs `gradeSubmission` on each student's **latest**
    attempt against the current assignment.
  - It diffs `scoreSubmission` before/after per problem and returns: changed (student, problem,
    before → after, "under an override"), unchanged, and total.
  - The UI lists the changes; Commit is a second click.
- **Commit** does four things:
  - It first writes a DB snapshot (`VACUUM INTO` beside the daily backups, task 041).
  - It rewrites `result` + `assignmentHash` on those latest attempts.
  - It logs one `regrade` event per changed (student, problem).
  - It **never touches human grades**. Carry-forward (§4.4) is answer-based, so it is unaffected.
- Older attempts keep their receipt-time results, labelled with the version they graded. They
  don't count.

## 6. Surfaces and routes (mockups: §11)

### 6.1 Grading tab: `#/instructor/grading`
- The assignments in dashboard order: counting ones first, HW7 dimmed "not counted".
- Each row shows: due, **submitted / roster** (a progress bar, late and missing counts),
  autograde (✓ current, or "↻ n stale"), **hand grading x / y** (a bar), mean grade, and
  released or not.
- Above the table, a **Needs attention** box counts the flagged students and links to them.
  A small **Settings** link holds the flag thresholds.

### 6.2 Assignment grading: `#/instructor/grading/:asg` (Overview · Matrix · Queue)
A segmented control switches views; the URL keeps the view (`/matrix`, `/queue`).
- **Overview**:
  - Progress tiles with bars: submitted, autograded, hand-graded, released.
  - The stale banner with **Re-grade…**.
  - A per-problem table: kind, mean points, share at 1 / ½ / 0, hand-graded x / y, and a
    "Grade →" link into the queue.
  - Actions: Re-grade…, Export CSV, and **Release grades** (the one primary button, which warns
    while anything is pending).
- **Matrix**: students × problems.
  - Filter chips: All · Needs grading · Changed · Late · Missing · Flagged · Below 70. Also a
    section select and a name/UID search.
  - Rows are **roster students**: names, and not-submitted rows too.
  - Cells show 1 / ½ / 0 / ✎ pending / ↻ changed / — missing, with ⚑ when an integrity or
    group flag touches that cell.
  - Columns: late (meetings, −D), grade out of 100, provisional mark.
  - A row opens the student's submission.
- **Queue**: below.

### 6.3 Student submission: `#/instructor/grading/:asg/student/:sid`
- **Header**: name, UID, section, and account status.
  - The counting attempt, with older attempts viewable read-only.
  - Submitted time and late status (meetings, −D), with **Extension…** and **Waive…**.
  - Group members with their reciprocity state, and the integrity summary.
  - Previous/next student (matrix order).
- **Then every problem**:
  - The autograde in full, including `expected`/`got` (instructor-only), the ½ rule's count,
    and **Run this input**.
  - The points control: 0 · ½ · 1, a required note on an override, and **Clear**.
  - For machines, **Open in viewer**. Task 003's read-only editor, generalised to a fetched
    record: `viewSubmission(record)` takes the record instead of reading `listOwn`, never opens
    or saves the instructor's own workbook, and its lock message names the student.

### 6.4 Hand-grading queue: `/queue/:qid` (by problem) and by student
- **By problem** is the fast path.
  - It shows the problem's statement (collapsible), then one response at a time, then 0 / ½ / 1.
  - Keys: `0`, `h` for ½, and `1`. A note is optional on a hand grade.
  - **Save & next** auto-advances past responses that are graded or claimed.
  - "Response 39 of 71", with a side list of states (to grade, changed, graded, claimed).
- The **Hide names** toggle (decision 10) replaces names with "Response 39". It is a per-person
  preference stored in localStorage as a UI pref.
- The **soft claim** (decision 17): opening a response claims it for 5 minutes, renewed while
  active. The server holds claims in memory (nothing to migrate or clean). Others see "Being
  graded by P. Talma" and skip it. A write never checks the claim. A write DOES carry the grade
  row's `version`, and a stale version returns 409 showing the other grade, so two graders
  never silently overwrite each other.
- **By student** walks one student's pending problems in order. It reuses §6.3.

### 6.5 Student page: `#/instructor/students/:sid`
- Reached from the matrix, Roster & accounts, and the Needs-attention box.
- Shows identity and account status, active flags, and one row per assignment: submitted,
  late, extension, grade / 100.
- Then the average of the counted sets so far, the **private notes** log (decision 15: dated,
  append-only, instructors only), and the student's grade-change history (from the log).

### 6.6 Retired and changed
- `#/instructor/assignments/:id/submissions` redirects to `#/instructor/grading/:id`. The
  dashboard's "Submissions" button becomes "Grading", and its column shows **students
  submitted**, not attempts (F6).
- `removeAssignment` refuses an assignment that has submissions; Hide is the way out (F6).

### 6.7 Student side
- **Grades tab / GradeSheet** after release: the grade out of 100, per-problem points with
  notes, and the late line ("late by 2 class meetings: −15; 5 waived"). The grader's identity
  never reaches the student.
- **Submit dialog**:
  - An optional **group members** picker (up to 2 classmates, from the roster). It is not
    typed content, so the provenance seam doesn't apply.
  - Past the effective due date it adds the late cost: "Submitting now is late by 1 class
    meeting: −10. Your earlier on-time submission will no longer count."
- Home and the overview show an extended due date as "Due Oct 8 (extended)".

## 7. Data layer

### 7.1 Tables (server; local mode mirrors them in localStorage behind the seam)
| Table | Columns | Notes |
| --- | --- | --- |
| `grades` | assignment_id, student (account key), question_id, points, note, grader, graded_at, attempt, answer_key, version | PK (assignment, student, question). The human grade; overwritten in place, every write logged. |
| `grade_events` | id, at, actor, assignment_id, student, question_id?, kind, before JSON, after JSON | **Append-only**; no update or delete path. kind ∈ grade, clear, override, waiver, extension, regrade, release, hide, export, note. |
| `extensions` | assignment_id, student, due_date, set_by, set_at | No reason column, by design. |
| `late_waivers` | assignment_id, student, points, note, by, at | |
| `student_notes` | id, student, body, author, at | Append-only; instructors only. |
| `course_settings` | key, value JSON | `calendar` (synced), `flagThresholds`. |
| `submissions` + | `assignment_hash` column; `group` inside the submission JSON | The stale stamp; `group: string[]` of account keys. |
| `users` + | `public_id` (random, stable) | Routes and API paths use it (§9), never email or UID. |

The account key is `users.email`, the same key submissions hang off (`identity.ts:5-13`), so
aliases and the UID model are unaffected.

### 7.2 Endpoints (all `requireInstructor` unless noted)
| Endpoint | Returns / does |
| --- | --- |
| `GET /api/grading` | per-assignment progress rows plus course-wide flags (the Grading tab) |
| `GET /api/assignments/:id/summary` | **the shared summary**: roster-joined rows of identity, latest attempt meta, per-problem `{points, source}`, late, grade, flags. No circuits. About 50 KB at 80 × 23. **030's Activity tab consumes this same endpoint** for submitted / late / pass rates. |
| `GET /api/assignments/:id/submissions/:sid/:attempt` | one attempt in full (circuits, result with expected/got, integrity, grades, events), on demand |
| `GET /api/assignments/:id/questions/:qid/responses` | the queue feed: per latest attempt, the answer (text/blanks; a machine by reference), grade, answerKey, claim |
| `PUT /api/assignments/:id/grades/:sid/:qid` | `{points, note, version}` → 409 on a stale version; `DELETE` clears |
| `POST /api/assignments/:id/regrade` | `{dryRun}` → the diff, or commit (§5) |
| `PUT /api/assignments/:id/students/:sid/extension` · `/waiver` | set or clear |
| `POST /api/grading/claims` | a soft claim (in memory, 5-minute TTL) |
| `GET /api/students/:sid` · `POST …/notes` | the student page and its notes |
| `GET /api/grading/export.csv` | the export (§7.5); logged |
| student: `GET …/submissions` (existing) | after release, gains `score` (the `scoreSubmission` output minus grader identity) |

The per-assignment `GET …/submissions/all` is retired once the Gradebook is.
`POST …/submissions/:attempt/review` is retired into `PUT …/grades` after migration.

### 7.3 The seam
`GradingStore` (`app/src/storage/`) is the new Promise-returning seam, with
`LocalGradingStore` and `RemoteGradingStore`, exported only by `storage/backend.ts`. It
carries summary, detail, responses, grade, clear, regrade, extension, waiver, claim, student,
note and export. Local mode computes the same summaries in the browser over
`LocalSubmissionStore` and the toy roster with the same `engine/score.ts`, so the harness can
drive it headless. The remote store stays grader-free (`remoteStoreCheck`'s gate).

### 7.4 The course calendar
- `app/src/devData/courseCalendar.json` holds `{timezone, meetings: [{date, start, end, kind}]}`.
- It is generated by `npm run calendar -- import <path to the website's data/course.json>` from
  `schedule[]` lesson and in-class exam entries plus `course.lecture` times.
- It is committed, and synced into `course_settings.calendar` by the release's
  `npm run homeworks -- sync` (task 007's step). It is not an answer key, so local mode bundles
  it.

### 7.5 Export
One row per roster student: `UID, name, email, section, HW1 … HW6` (each final grade out of
100, Missing = 0 per §4.5, blank before the due date), then `average` (the mean of counted
sets due so far).
- It is generated server-side from the summary rows.
- It is logged as an `export` event.
- It never enters git: a download, like the class list, stays out of the public repo (PROFILE
  §8.9).

### 7.6 Migrating today's `manual` reviews
On server start (a `db.ts` migration step) and in `LocalGradingStore` init, every
`questions[i].manual` on a student's **latest** attempt becomes a `grades` row:
`points = pass ? 1 : 0`, note, `grader = null (migrated)`, `graded_at = reviewedAt`,
`answer_key` computed. It is logged as a `grade` event with actor "migration". The JSON keeps
`manual` as history, unread. The pilot DB holds only toy data, so this is small, but it runs
the same way everywhere.

### 7.7 Assignment-level fields
`countsTowardGrade` (default true) and `latePolicy` (`'per-meeting'` default | `'per-day'`) join
`INSTRUCTOR_OWNED_FIELDS` (`devData/homeworkSync.ts:31`). The repo JSON supplies them, the sync
fills an unset copy (as it does `dueDate`), and editing them in the dashboard never detaches a
homework from the sync. HW6 carries `per-day`; HW7 carries `countsTowardGrade: false` and stays
unpublished.

## 8. Flags (decision 13; prompts to look, never verdicts)
| Flag | Rule (thresholds in `course_settings.flagThresholds`) |
| --- | --- |
| Not submitted | past the effective due date, no submission |
| Very late | a submission more than 14 days after the effective due date, or none by then |
| Struggling | final grade < 70 on two consecutive counted sets |
| No account | on the roster, no account 7 days after the first meeting |
| Group mismatch | a listed member doesn't list back (once both have submitted, or the due date has passed); or a group larger than 3 |
| Integrity | `SubmissionIntegrity.flagged > 0` (task 034; today per-cell only, `GradebookView.tsx:243-250`), now also counted at row level |

- Identical open-response text across students is added to the integrity flags.
- Machines with identical structure are marked "same group" when a reciprocal group explains
  it. They are still shown.
- A structure fingerprint that ignores ids across students is a follow-up (`gradedMachineKey`
  includes minted ids, so it only identifies one student's resubmission).

## 9. P3 constraints (FERPA grades; `data classification analysis - P2 vs P3.md`)
- **Need to know.** Every grading endpoint is instructor-only. Students read only their own
  released score, and never grader identity, integrity or other students.
  - TAs are instructors by decision 9. The log's actor field is how access is accounted for.
- **Event logging.** Every grade write, clear, override, waiver, extension, re-grade commit,
  release/hide, export and private note is logged in the append-only `grade_events`, with actor
  and time. Per-view read logging is deferred (§10).
- **Backups.** Daily, kept 35 days (task 041), plus the pre-commit snapshot before a re-grade.
- **No identifiers in URLs.** Routes and API paths use `users.public_id`. Hash fragments stay in
  browser history, and API paths reach the box's access logs, so emails and UIDs must not
  appear in either.
- **P4 stays out.** Extensions have no reason field. Note fields (per-problem, private, waiver)
  carry the placeholder "No medical or accommodation details". The export is a download that
  never enters git.
- **No deletion path** for grades history. An assignment with submissions can't be removed
  (§6.6).

## 10. Deferred (named, not built)
Student regrade requests (decision 14) · exam and participation grades and the course letter
(decision 12b) · per-problem release · read-access logging · a cross-student
structure-fingerprint for machines · LLM suggestions in the queue (task 014: a suggestion a
human confirms, never a grade) · per-part grades (task 048 extends the grade key with a part
when multi-part questions land; 048 decides how parts roll up to the problem's 1 point).

## 11. Mockups
`docs/buildout/designs/grading-interface/mockups.html` draws every surface above, using the
app's own `theme.css` and `pages.css` (so tokens and idioms are the real ones). Each proposed
new idiom (a progress bar, the matrix cells, the queue's grade keys) is drawn in `--mm-*`
tokens only. The data is fictional. Screenshots:
`tasks/attachments/2026-09-23-031-{1-grading-tab,2-overview,3-matrix,4-queue,5-submission,6-student,7-regrade}.png`.
Open a single screen with `mockups.html#only=<id>`.

## 12. Build order (filed as tasks 2026-09-26-061 … 071, in this order)
HW1 is due **Oct 4**, and the policy returns work "about a week after". So slices 1–6 should
land by about Oct 9. Slice 2 must precede HW1 submissions, or HW1's groups go unrecorded.
1. **Grade model**: `engine/score.ts` (`scoreSubmission`, `answerKey`, `lateDeduction`),
   `half_credit_at` (+ creator field, `validateDocument`), and the three old score rules
   retired. The student Grades tab shows /100. New `scoreCheck`; parity extended.
2. **Groups on submit**: the roster picker, stored on the submission. The flag comes in slice 10.
3. **Grade storage + seam**:
   - `grades`, `grade_events`, `users.public_id`, and the `assignment_hash` stamp.
   - `GradingStore` local + remote, `PUT/DELETE …/grades` with version, and the migration.
   - The review endpoint retired.
4. **Summary endpoints**: `/summary` (shared with 030), `/api/grading`, `/api/students/:sid`,
   attempt detail on demand, and the roster join.
5. **Grading tab + Overview + Matrix**: the gradebook route redirected, the dashboard column
   fixed, and the progress-bar idiom added to `theme.css` (`themeCheck`).
6. **Hand-grading queue**: by problem / by student, keys, hide names, soft claim, carry-forward.
7. **Student submission page + instructor viewer**: generalise 003's viewer to a fetched record.
8. **Late penalty + calendar + extensions + waivers**: `courseCalendar.json` + import + sync,
   the student-side extended date, and the submit-dialog late warning.
9. **Re-grade**: dry run, commit, snapshot, and the stale banner.
10. **Flags + student page + private notes + threshold settings**.
11. **Export CSV**.
