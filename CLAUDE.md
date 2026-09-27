# Making Minds — Project Guide

Auto-loaded into every session, so an **index, not a journal** (Part 1: where the project
stands; Part 2: the technical reference), kept **under 40 KB** by
`tasks/tools/check-budgets.mjs` (CI and app `npm run check`).

> **Maintenance.** When a task changes what is built, how it works, or what comes next,
> update the status here (Part 1, the affected Part 2 entries) **in place: replace, never
> append**, and bump the date. The dated story lives in the task file's `## Progress log` and
> one `tasks/log.md` line; the changelog through 2026-09-21 is frozen in `docs/HISTORY.md`.

_Last updated: 2026-09-27_

## How work flows — the task pipeline (`tasks/`)

All work bigger than a one-line fix goes through the committed queue in `tasks/` (schema, id
rule: `tasks/README.md`; rules every role reads first: `tasks/PROFILE.md`; launching:
`tasks/START.md`):

- **`/catch`** — Gabriel describes problems and ideas; the catcher diagnoses (root cause,
  class, deep vs surgical fix), files tasks, surfaces parked questions (`tasks/blocked/`)
  first, and drains app Feedback (`tasks/tools/feedback.mjs`).
- **`/work`** — surveys the queue, proposes merges, offers options; Gabriel picks; it works
  one task in depth on a `task/NNN-slug` branch and lands it with a merge commit.
- **The robot** — Gabriel's always-on Mac, own clones: an hourly catch (`ROBOT-CATCH.md`:
  Feedback → tasks; student fixes wait in `blocked/` for his yes) starts one work run
  (`ROBOT-WORK.md`: one task, landed, pushed, released via the gate). Land = push
  everywhere; GitHub `main` ships hourly.

---

# Part 1 — Project Status

## The goal

A platform where a student logs in (eventually UCLA SSO), picks an assignment, works it (one
canvas per question, in the right mode — CC / SC / FSM / TM / turbot / open), leaves, comes
back, resumes exactly where they left off, and submits the whole assignment with one button;
it goes to the **server** and is **autograded**. Instructors author assignments and view
scores. **Students cannot grade their own work** — grading is a server/instructor capability.

## Where we are now

The full flow runs end to end on **two backends behind one switch**
(`app/src/storage/backend.ts`): **local** mode (browser localStorage — the default, the dev
environment, what the headless harness drives) and **remote** mode (built with
`VITE_API_BASE`; every seam backed by the `server/` API — server-side grading, sanitized
student payloads, real sessions). Flows are identical except where noted.

**Student side.** Outside the editor every page sits in ONE site-styled shell (`PageShell`).
**Home** (nav label; an instructor's "Student view" is the same page) has tabs
**Assignments** (the catalog under the website's up-next box — the soonest due homework) and
**Grades** (`#/grades[/:id]`: a row per homework, its result once released, opening the
question-by-question sheet). Sign in (local: toy-account picker; remote: any of a person's
emails + password; "First time here?" claims the roster seat by UID with the class-list or a
UCLA email, an access request only for someone the roster lacks; 30-day bearer session; a
health retry screen while the server is down; a "Password" control) → **published**
assignments (hidden until an instructor publishes) → the assignment as a **problem-set
document** (`AssignmentOverview` → `ProblemSetDocument`: live turbot arenas, a status mark
per problem, an "Original PDF" link) → the question **editor**, a workbench built to its
memo (top bar with save state + Submit; resizable, collapsible columns; floating parts
palette; the site's canvas look) in the right mode: **CC, SC, FSM, TM, turbot** (TM:
clickable tape strip + machine table / run / history panels, alphabet from the question's
`representation`; turbot: the `innerMode` brain's editor + the arena "Map"
(Step/Run/Pause/Reset), a TM brain's tape read-only; SC perception: a retina frame player),
**open** (free text), **fill-in** (labelled boxes, autograded). Debounced autosave through
`WorkbookStore` (remote: PUT, an `'error'` indicator + backoff retry, keepalive unload
flush, the per-email crash journal — a hard tab kill loses nothing); leave and resume.
**Submit** a timestamped snapshot in one `SubmitDialog` (≤ 2 group members; online-only: a
failure records nothing — server stamps time). Released grades: the **Grades** sheet
(the grade / 100 and each problem's points, the instructor's note, "▸ failed inputs" in safe fields — which case
failed and why — a link into the question, and **Run this input**: the grader's run of that
case, recorded vs live verdict); Home and the overview re-fetch every visit. **Viewing a
submission**: the sheet opens a graded attempt read-only (the `attempt` route).
**Freezing** (`isFrozen`, Due dates
row) forces the latest attempt, no way back. **Mark done**: the question panel's self-lock
checkbox. **Feedback** link: platform/homework reports (category, message, ≤ 2 downscaled
screenshots). **Paste provenance** (Critical design rules); the sandbox is free.
**Watermark**: ids carry a MAC under a per-student, per-assignment key, each question a
signed editing record; at submit the server names whose ids they are and flags one-piece
work (`integrity`, instructor-only, never a verdict). **Visitors**: access is per route
(`routing.ts routeAccess`); signed out, `#/` is the sign-in form, the public **sandbox** a
quiet line below (no server; banner, Sign in). The sandbox: every machine as a worksheet tab
— CC / FSM / TM, and Turbot (brain kind picked) with its own editable arena; its **File**
menu saves the tabs to a `.json` on this computer and opens one back.

**Autograding.** CC, SC, FSM and TM machines grade through one **value-based codec
pipeline**: every machine implements a function `f`, checked against a machine-agnostic bank
of numeric `(x, f(x))` `test_cases` via `validate → encode → run → accept → decode →
compare`; the only per-mode knowledge is the **axis** (CC `space`, SC/FSM `time`, TM `tape`;
`engine/codec.ts` + `tmCodec.ts`). Outside the codec: **turbots** (`gradeTurbot`: the brain
runs in every `turbot_cases` arena, all must pass; criteria reach-and-stop / pass-through /
return-to-start judge positions only, never path or facing; return-to-start in a goal-ful
arena must also visit the goal), **perception** (`gradePerception`, bit-level against
`perception_cases`; a case passes iff every step matches), **fill-in** (`engine/fillIn.ts`,
string compare, leading zeros/whitespace normalised), **open** (`'pending'`, the response
kept for manual review). Question-level constraints: Homework JSON, Part 2. Submissions
autograde on receipt (Grading seam). **Points** are `engine/score.ts`'s alone (task 061): 1 per
problem, ½ by a question's `half_credit_at` (≥ K of N cases), a human grade over either while
it judges the same answer; grade = 40 + 60·P.

**Instructor side** (`#/instructor`, the **Dashboard**, sections as tabs — Assignments ·
Grading · Roster & accounts · Feedback · Notes). **Roster & accounts** (remote: the registrar's class
list as exported, status report + who-left review; accounts, password reset, add/remove,
access requests); **Feedback** queue (open/resolved/all; instructor tag, triage mark);
shared **Notes** (one markdown document, `marked` + `dompurify`, saved only on Save, warns
before overwriting a newer save); dashboard (drag-to-reorder, **Publish/Hide**, local-mode
"Load HW1–HW7"); assignment editor (drag-to-reorder questions; the document around them —
preamble, source PDF, sections with intro / layout / callouts / figures, every question in a
section, live preview); **question creator** (all six modes on one form; per-problem
callouts, figures; formula DSL → test banks; turbot: inner machine, encoding, arenas ≤
30×30, each with criterion + max-steps; perception: rule + retina size; component
restrictions and limits; TM halt-position toggle; fill-in blanks); **Grading** (task 065; views read the 064 summaries, none grades): the course
list (submitted, autograde, hand grading, mean, released; `countsTowardGrade: false`
dimmed); per assignment Overview (tiles, per-problem shares, Release warns while pending) ·
Matrix (1 / ½ / 0 / ✎ / ↻ / — cells, filter chips) · Queue (066); a row opens the student's
submission (interim until 067: history, failed cases, 0 / ½ / 1 + note).

**Server** (`server/`: Express 5 + `node:sqlite`, zero native deps, WAL; files and gates:
the Server row): auth providers behind `MM_AUTH_MODE` (`password` default — roster-gated
registration, scrypt, login throttle; `dev` passwordless; `sso` — capabilities reported,
`authenticate` a TODO), **identity by UID** (emails are aliases), roster import (UI + CLI),
the **homework sync** (`npm run homeworks -- sync | status`; Deployment below), assignment
CRUD, workbooks (+ mint key, per-save size history), submit-with-grading + integrity, human
grades, the **grading summaries** (task 064: `/api/assignments/:id/summary` — roster-joined,
latest attempt, no circuits — `/api/grading`, `/api/students/:sid`, one attempt in full),
grade release, feedback (+ role, triage mark), notes, `/api/health`.

**Deployment — pilot live.** Cloudflare Pages `https://making-minds.pages.dev` → Lightsail
API at the placeholder `https://100-22-69-95.sslip.io` (Caddy TLS). Not yet fit for
students: UCLA SSO is a stub, the roster the toy one (plus a leftover `cc-basics` demo row,
deletable from the dashboard). **Content:** HW1–HW7 as JSON in the repo
(`app/src/devData/homeworks/`, 86 questions — machine problems from the reference fixtures,
prose ones as open questions) in their PDFs' structure (sections, intros, callouts, SVG
figures cropped from the PDFs into `app/public/problem-sets/`). **The repo is the source;
every release syncs it into the pilot DB** (`deploy/release.sh` → `npm run homeworks --
sync`: missing homeworks added unpublished, unedited copies refreshed, instructor-edited
ones left alone and listed); local mode's "Load HW1–HW7" runs the same planner.

**Reference-fixture coverage:** 56/56 at-tier — 46 exact (correct passes, broken fails) + 10
interface (a plausible attempt grades end-to-end) — `app/tools/coverageCheck.ts`.

## What's next

The open work is the queue (`tasks/incoming/` ready, `tasks/blocked/` waiting on Gabriel);
`/work` offers it. Headline on 2026-09-26: **building the grading interface** (memo
`docs/buildout/designs/grading-interface.md`; slices 061–071, 061–068 before HW1 returns);
the robot (043), the pilot domain (008); SSO (006) deferred.

---

# Part 2 — Technical Reference

## What this is

The web platform for **PHIL 133 ("Making Minds")**, a philosophy/computation course (~80
students) whose autograded homeworks have students build circuits, finite state machines,
Turing machines and grid-based agents ("turbots"): a **single-page React + TypeScript app**
(`app/`, Vite) over Part 1's two backends.

## Architecture principle: seams

Every external dependency sits **behind an interface** — the no-backend prototype became a
server-backed product by swapping implementations, not rewriting the UI. The seams are
Promise-returning; `storage/backend.ts` is the ONE mode decision and the sole exporter of
store instances. **Route new features through these seams, not around them.**

| Seam | Interface | Local mode (default) | Remote mode (`VITE_API_BASE`) |
| --- | --- | --- | --- |
| Evaluation | `engine/` (pure, headless) | runs in browser | the server imports and grades with the same code |
| Grading | `engine/grader.ts` | grades on receipt in `LocalSubmissionStore` | server grades on submit; client never sees `test_cases` (grep-gated); parity pinned |
| Identity | `src/auth/` (one provider per mode) | toy-account picker | the server's account system, rendered from its reported capabilities → bearer session → `me()` restore; 401 hook; visitor principal; UCLA SSO = one server-side `AuthProvider` swap |
| Persistence | `WorkbookStore` | `LocalWorkbookStore` | `RemoteWorkbookStore` + crash-buffer journal + fill-empty migration |
| Assignments | `AssignmentStore` + registry | localStorage; release + visibility flags on the seam (`mm:published:<id>`) | server CRUD, role-sanitized; `student_visible` defaults 0 |
| Submission | `SubmissionStore` (the principal's own; the grading summaries: `listAll`) | `LocalSubmissionStore` | `RemoteSubmissionStore` (answers + group; identity/time = server's word; `listClassmates`) |
| Grading | `GradingStore` (human grades, apart from `result`; task 063) | `LocalGradingStore` (`mm:grades:`, `mm:grade-log:`) | grade routes by `public_id`; `grades` + append-only `grade_events` tables |
| Feedback / Notes | `FeedbackStore` / `NotesStore` | localStorage (`mm:feedback`, `mm:instructor-notes`) | `/api/feedback*`, `/api/instructor-notes` |
| Navigation | `routing` (`Route` + `navigate`) | hash URLs (starts inside AuthGate) | same |

**Keep evaluation logic framework-agnostic**: all simulation and grading lives in
`app/src/engine/` (pure TypeScript — no React, Zustand or DOM); store and UI are thin
wrappers.

## Key files

| Area | Path | What's there |
| --- | --- | --- |
| Types | `app/src/types.ts` | Domain types: `AssignmentData` (+ document level: `preamble`, `sections: AssignmentSection[]`, `sourcePdf`) / `AssignmentQuestion` (+ `title`, `hint`, `callouts`, `figures`, `allowed_components`, `component_limits`, `maxTapeCells`, `requireStandardHaltPosition`, `perception`/`perception_cases`, `turbot_cases`, `fill_in`/`fill_in_answers`), `SubmissionData`/`SubmissionRecord`, `QuestionResult` (+ `ManualReview`), `CircuitData`, `CCSpec`, `ArenaConfig`/`TurbotCaseResult`, `PerceptionCaseResult`, `QuestionCircuit` (`responseText`, `done`). `questionTask`/`QUESTION_TASKS`: the ONE task classifier (panel, grader, answer); `questionModeLabel` chips it. |
| Engine | `app/src/engine/cc.ts`, `sc.ts`, `netlist.ts`, `fsm.ts` | Pure simulators: topological eval (CC; `truthTableCC` every row), clocked step (SC; MEM-holding boxes inlined, `memorySlots` the state vector), transition matching (FSM). `sortByLabel` orders I/O; `boxInterior` binds box ports (`Port.bind`, via `boxPorts.ts`). |
| Engine | `app/src/engine/tm.ts`, `tmValidate.ts`, `tmCodec.ts` | Notation-aware tape engine — **two-output** labels `read:write,move` (`1:0,R`; legacy `1:0R` a permanent alias), one atomic step each; table validation (ambiguous/unparseable, via the generic walker); the codec `tape` axis (accept honors `requireStandardHaltPosition`); `tapeCellsUsed` for `maxTapeCells` (both: Homework JSON). |
| Engine | `app/src/engine/caseRun.ts`, `grader.ts` | `caseRun.ts`: one case run as graded, key-free (`questionLayout`, `gradingCircuit` — MEMs from 0, `validateQuestionMachine`, `caseStimulus`, `runValueCase`/`runTurbotCase`); `grader.ts` = that + the comparison (`gradeQuestion` results parallel the banks; turbot, perception bit-level, fill-in, open → `'pending'`); `score.ts`: THE grade (`scoreRecord`/`scoreSubmission`, `autoPoints`, `answerKey`, `lateDeduction`, `halfCreditProblem`), which every surface renders. |
| Engine | `app/src/engine/codec.ts`, `machineValidation.ts` | The codec (`space`/`time` value↔bits; `tape` → tmCodec; `stepCountFor`, `encodeInput`, `timeOutputBits`); Stage-1 validation incl. `validateAllowedComponents`/`isComponentTypeAllowed` and component limits (semantics: Homework JSON). |
| Engine | `app/src/engine/testVectorGen.ts`, `formulaEval.ts` | Authoring-time: formula DSL → test banks (Reference-function DSL below). |
| Engine | `app/src/engine/notation.ts` | Transition-label SYNTAX seam: `TransitionNotation` (parse / canonical format / alphabet / editor token fields / default) for every grammar — k-bit `fsmNotation(inBits, outBits)`, `tmNotation(rep)` (`*` binary-only), `turbotFsmNotation` (1-bit alias → canonical 2-bit motor), `turbotInternalNotation(tapeNotation)`; the generic `validateTransitionTable` walker. Label dissection happens ONLY here (notationCheck grep gate). |
| Engine | `app/src/engine/representation.ts`, `index.ts` | value↔bits core (`valueToBits`/`isValidCodeword`/`bitsToValue`), display helpers; barrel exports. |
| Engine | `app/src/engine/turbot.ts` | Arena driver loop: `senseAhead`/`senseAheadSymbol` (B/E/F), `applyMotorCommand`, `runBrainStep`/`initialBrainState` (CC/SC circuit brains; the turbot FSM (`turbotFsmNotation`); the textbook **turbot TM** — internal (circle) states do single tape ops, external (square) ones sense B/E/F and move ↑/↱/↰; `validateTurbotTM`/`validateTurbotFSM`), `runTurbot` (`stopped` = motor 00 or TM halt). `evaluateTurbotCriterion` (via `isGoalCell`) + `criterionRequiresStop` (pass-through may pass with `hitStepLimit`) + `explainTurbotCriterionFailure`. |
| Engine | `app/src/engine/perception.ts`, `fillIn.ts` | Perception rules (CC: `min-run`/`exact-run`/`pattern`; SC: `change`/`motion` — "up" = toward IN1; the "previous input" before the first frame is all zeros), `buildPerceptionCases` (CC exhaustive ≤ 10 wires; SC a fixed battery), `validatePerceptionMachine`, `runPerceptionCase`, `framesToLanes`/`lanesToFrames`. Fill-in grading. |
| Store | `app/src/store.ts` | Zustand UI state over `engine/`. Sim slices (SC/FSM/TM/turbot + I/O `tableRows`) and undo/redo are app-wide — hence the reset laws (Critical design rules). Selectors: `selectEffectiveMode` (turbot → inner mode; drives every editor branch), `selectTmNotation`, `selectTurbotArena`/`selectTurbotInnerMode` (sandbox: the active tab's own `arena`/`innerMode`), `selectAllowedComponents`, `selectLiveFsmStateId`, `selectCodecLayout`/`selectCodecWindow`/`selectQuestionStepBudget` (Question runs rule), `selectTurbotGoalHit` (Map goal pulse), `selectAssignmentFrozen`, `selectQuestionLocked`, `selectRunControls` + `runControl` (the output panel's one run row; every run loop is the store's). `viewingSubmission`: a submitted attempt on show (`viewSubmission`), never folded or saved. `loadCaseInput` replays a graded case (`loadedCase`, `turbotCaseIndex`). Boxes: `confirmedBoxLibrary` is per HOMEWORK in an assignment (`AssignmentState.boxLibrary`), per TAB in the sandbox; `nextBoxName`/`takenBoxNames` keep default names unique; `renameBox` is the ONE rename path (library, drawn box, every placed instance). |
| Problem-set document | `app/src/problemSet.ts`, `components/ProblemSetDocument.tsx`, `statementFormat.ts`, `components/StatementBody.tsx` | The document level over `questions[]` (memo `docs/buildout/designs/problem-set-document.md`). `problemSet.ts` (pure): `documentSections` (no `sections` → one unnamed section; unlisted questions trail; ids used once), continuous `problemNumber`, `problemShape` table/compact/full → `problemRuns` grid/columns/stack (a section's `layout` overrides), `figureUrl` (data URL or public path under the base URL), `validateDocument`. `ProblemSetDocument` renders the overview, lending `ProblemBody`/`ProblemContext` to the three editor panels. `statementFormat.ts`: markup parser (KaTeX, code, bold, italic, paragraphs, nested lists, `(a)`/`a.` parts; inline `IN1=0,IN2=1 -> OUT=1` profiles → tables), `statementProse` for previews; `StatementBody`: the one JSX renderer (`lead` runs a title into the first paragraph). Styles: `.ps-*`, `.statement-*` in `pages.css`. |
| Due dates | `app/src/dueDates.ts` | Pure policy: `dueStatus` (green > 3 days / amber < 3 days / red overdue), `lateBy`, `formatDuration`/`formatDueDate`, `isFrozen(dueDate, now, hasSubmission)` — the ONE exception to "a due date never gates anything": editing is gated once past due AND submitted; submitting never is. |
| Routing | `app/src/routing.ts`, `useRoute.ts` | `Route` union (incl. `grades`, Home's Grades tab; `attempt` = `#/a/:id/submission/:n`, `caseIndex` = `…/q/:i/case/:k`; the Grading tab's `instructor-grading*`, `instructor-student`), `parseHash`/`routeToHash`, `canonicalHash` (the old gradebook URL → Grading), `navigate()`; `useRoute()`: the hash as React state (Home's tabs, `useInstructorRoute`). |
| Wire layout | `app/src/componentGeometry.ts`, `wireRouter.ts`, `wireSegments.ts` | `componentGeometry`: the one geometry — per-type sizes (`PART_SIZE`, `boxSize`), ports (`getPortPosition`), footprint `getComponentBounds`, `getLabelAnchor` — for canvas, router, oracle, `confirmBox`. `wireRouter`: the A* orthogonal router (phase-0 L-path for doomed wires; `usedFallback`/`violation` flags; `findDivergencePoints`). `wireSegments`: a stale segment drag is dropped. |
| Storage | `app/src/storage/workbookStore.ts`, `AssignmentStore.ts`, `submissionStore.ts`, `gradingStore.ts`, `feedbackStore.ts`, `NotesStore.ts` | The six Promise-returning seam interfaces + Local impls. Grade release lives on `AssignmentStore` (`remove` refuses an assignment with submissions); records carry their student's human `grades` (task 063); `gradingStore.ts` WRITES them and READS the grading summaries (task 064). |
| Storage | `app/src/storage/backend.ts`, `remoteStores.ts`, `gradeWrites.ts`, `gradingSummary.ts`, `journal.ts`, `migrateLocal.ts` | `backend.ts`: the mode switch (seams, above). `remoteStores.ts`: Remote impls as direct `api/client.ts` calls (404 → seam-null; GRADER-FREE, grep-gated). `gradeWrites.ts`: the pure `planGradeWrite` (version → 409, override needs a note, anchored to the latest answer, one log event) + the legacy-review migration, used by the local store AND the server. `gradingSummary.ts`: the ONE pure summary builder (roster ∪ flagged off-roster submitters, latest attempt, `scoreRecord` per problem, stale by content hash; `dueFor` is where 068's extensions enter), local store + `server/src/gradingSummary.ts` adapt it. `journal.ts`: per-email crash buffer `mm:journal:<email>:<asgId>`, replayed by the next `openAssignment`. `migrateLocal.ts`: first-remote-login fill-empty upload of local data (guard `mm:migrated:<email>`; server never overwritten; submissions/release/reviews not migrated). |
| Auth | `app/src/auth/` | `AuthGate.tsx` (per-route gate; `initRouting()` fires here), `HealthGate.tsx` (health provider + retry screen), `LoginScreen.tsx` (toy picker locally; remotely the panes Part 1 describes, from the server's `AuthCapabilities`), `AccountPanel.tsx` (change password), `authProvider.tsx` (one provider per mode), `types.ts`, `session.ts`, `accounts.ts`, `instructorRole.ts`. |
| Page surfaces | `app/src/theme.css`, `pages.css`, `workbench.css`, `components/PageShell.tsx`, `SessionControls.tsx` | ONE visual language, the makingminds.org look. `theme.css`: the site's palette/type/spacing as `--mm-*` tokens (each names its `site.css` original; colour literals ONLY in its `:root`) + the shared vocabulary (shell, tags, rows, tables, buttons, fields, segmented controls, modals). `pages.css`: per-surface rules. `PageShell`: topbar (brand → website; `appNav` by role; Sandbox link; session controls) · band · ONE `.page` column (1080px, every route) · footer; `card` variant for login/health; `.mm-tabs`: a section's own tabs in the column (the Dashboard's). `workbench.css`: the editor frame; `index.css`'s canvas literals ratchet to zero. Rules: `docs/buildout/VISUAL_VOCAB.md` §Page surfaces; gate: `themeCheck`. |
| Workbook file | `app/src/workbookFile.ts`, `fileHandle.ts`, `components/WorkbookFileMenu.tsx` | The sandbox as a file: pure `parseWorkbookFile` (validate, legacy) + `workbookKeyHash` (unsaved baseline); pickers, else download (not a save) / file input. |
| Async UI | `app/src/useAsyncValue.ts` | The shared fetch-on-mount hook (`value`/`loading`/`error`/`reload`) behind every view reading the async seams. |
| Provenance | `app/src/provenance.ts`, `usePasteGuard.ts` | The paste seam (pure): `canPaste`, `canvasPasteVerdict` (in an assignment + canvas kind, `allowed_components`), `textPasteVerdict`, `refusalMessage`; a module-memory clipboard (canvas + text slots). `usePasteGuard`: the answer fields' DOM adapter (copy/cut/paste/drop/`beforeinput`). `provenance/` (pure, server-imported): `ids` (`mintId`, the ONE id source; `verifyId`; the memory-only key registry), `sha256`, `trace` (the signed record), `integrity` (`assessIntegrity`, thresholds), `notice`. |
| Assignments | `app/src/assignments/index.ts` | Thin registry over the `AssignmentStore` seam (`listAssignments`/`getAssignment`/`createAssignment`) + `sortAssignments` (instructor `order` asc, then title). Nothing is bundled: local mode starts empty until the dashboard's dev seeds load content. |
| Instructor UI | `app/src/instructor/` | `InstructorApp`, `InstructorGate`, `InstructorDashboard`, `RosterView`, `FeedbackQueueView`, `NotesView`, `AssignmentEditor`, `dragReorder.ts` (pure `moveItem` + `useDragReorder`; pinned rows immovable), `QuestionCreator` (+ `ccPreview.ts`, `arenaEditing.ts`, `turbotCaseAuthoring.ts` / `TurbotArenasEditor`, `fillInAuthoring.ts`), `Grading*.tsx` (pure: `gradingViews.ts`), `Student{Submission,Grading}View`, `DocumentEditors.tsx` (callout/figure list widgets shared by both editors; `readFigureFile` caps an upload at 300 KB, downscaling rasters). |
| Student UI | `app/src/components/` | `CircuitCanvas` (colours: `canvasTheme.ts` roles; zoom/Fit/hint: `canvasView.ts`, `CanvasGuide`), `Palette` (parts, Boxes pop-out; pure: `palette.ts`; keys: `shortcuts.ts`), `DataTable`, `PerceptionFramePlayer`, `StudentLayout` (the Home tabs), `HomeScreen` (Assignments tab + up-next box), `GradesView` + `GradeSheet` (the Grades tab, its inline sheet), `GradedCaseBanner`, `AssignmentOverview` (the document page), `ProblemSetDocument`, `EditorShell` (+ `EditorTopBar`, `QuestionPanel`; pure: `workbench.ts`), `FeedbackPanel`, `SequentialTimeline`, `TMTapePanel` (under the canvas), `ArenaCanvas`, `OutputPanel` (the run row over `DataTable`; `LiveTruthTable`), `CanvasActions` (canvas edit buttons), `TurbotArenaPanel` (Map, right panel; sandbox "Edit map"), `TurbotTapePanel`, `OpenResponsePanel`/`FillInPanel` (read-only when locked; paste-guarded), `TabBar` (sandbox tabs), `outputDisplay.ts` (t1-rightmost OUT rows). |
| API client | `app/src/api/client.ts` | One typed function per endpoint; bearer token under `mm:auth:token`; `onUnauthorized` hook; `health()`; `putWorkbook` takes `keepalive`. `setApiBase` is the harness override. |
| Dev tool | `app/tools/shootProblemSets.mjs`, `shootCircuits.mjs`, `geometryCensus.ts` | Headless-Chrome shots (HW documents, the editor; fixture circuits before/after) when the pane is unavailable; the census of stored circuits a geometry change overlaps. |
| Server | `server/src/app.ts`, `db.ts`, `auth.ts`, `identity.ts`, `password.ts`, `roster.ts`, `rosterImport.ts`, `sanitize.ts`, `config.ts`, `seed.ts`, `roster-cli.ts`, `homeworks.ts`, `homeworks-cli.ts`, `gradingSummary.ts` | Routes, SQLite, the `AuthProvider` seam (`createAuthProvider` — `MM_AUTH_MODE`; `LoginThrottle`), scrypt credentials, `identity.ts` (the ONE place an email or UID resolves to an account; `users.uid` unique, `user_emails` aliases, keys never rekeyed), `roster.ts` (pure reader of the registrar's export as-is) + `rosterImport.ts` (never removes; lists who left), `sanitize.ts` (redaction + grade-release withholding: Things to watch), env config, seeding, admin CLI (`npm run roster`). `homeworks.ts`, the homework sync: a copy is pristine iff its content hash is a committed version of its file (`gitLineage` over the box's clone) or one the sync wrote (`content_sync` table); `seed.ts --homeworks` runs it too. `gradingSummary.ts`: the summary routes' Db adapter (opaque keys; a removed submitter's derived from the mint secret). `server/tools/*Check.ts` (`parityCheck`: server ≡ in-process grading, deep-compared). |
| Dev/sample | `app/src/devData/sampleData.ts`, `seed.ts`, `homeworks.ts`, `homeworks/hw{1..7}.json` | Sample assignment for all modes (netlist-built perception circuits, one turbot question per inner mode, open Q14) + sample submissions; `seedHomeworks()` syncs the real HW1–HW7 (record `mm:seeded-homework:<id>`) + reseeds 22 sample submissions; `homeworkSync.ts`: the pure planner it shares with the server (content hash = canonical JSON minus the instructor-owned `order`/`dueDate`; insert / unchanged / refresh / edited). |
| Tools | `app/tools/*.ts` | The headless harness = the test suite, all in `npm run check` (besides `grade.ts` CLI grader, `builder.ts` netlist builder, `layoutCheck.ts` layout oracle): `portabilityCheck` (first: tool imports in-repo, exact-case, declared; tools type-checked), `codecCheck`, `dueDateCheck`, `statementFormatCheck` (markup grammar, document model, every HW + figures valid), `notationCheck` (grammar pins + label-dissection grep gate), `themeCheck`, `workbenchCheck` (editor frame), `tmCheck`, `turbotCheck` (all four brains; `[multi-arena]`, `[pass-through step-limit]`, path/facing independence), `perceptionCheck`, `scWindowCheck` (question runs ≡ grader), `caseRunCheck` (caseRun ≡ grader; replay per mode, remote shape, budgets), `routerCheck` (fallback budget 0; hw3-p4 pin), `bumpCheck`, `pipelineCheck` (submit → grade, every mode), `scoreCheck` (the grade: ½ rule, precedence, late math), `gradingViewCheck` (cells, filters, tiles; no view grades), `navResetCheck` (the reset laws, `[edit during run]`; done / frozen / viewed-submission locks), `routingCheck` (route access, landing, held routes, principal change), `boxScopeCheck` (box library scope, sequential + drawn-across boxes ≡ unboxed, `[naming]`), `pasteCheck` (paste policy + provenance grep gates), `provenanceCheck` (mint/verify, attribution, paste re-mint, stamp + trace flags, uuid grep gate), `workbookFileCheck` (round trip, bad files, unsaved baseline, file handle), `remoteStoreCheck` (boots the REAL server; grader-import grep gate; password auth client), `coverageCheck` (two-tier reference-fixture ledger + `allowed_components` pins). |
| Queue | `tasks/` | The task pipeline (top of this file). |

## Reference-function DSL (instructor authoring)

Instructors give _what a student machine must compute_ as arithmetic formulas; at save they
become numeric `test_cases` (the grader never sees a formula).

- **Where** — `engine/formulaEval.ts` (`evalFormula(expr, vars)` → non-negative integer, else
  `FormulaError`), `engine/testVectorGen.ts` (`buildQuestionBank(inputs, outputs, rep, mode)`
  → `{spec, test_cases}`); `QuestionCreator` probes live (`probeFormulas`); any formula error
  blocks save.
- **Language** — input-group names, non-negative integer literals, `+ - *`, bitwise
  `& | ^ ~`, parentheses (no division, modulo, conditionals, calls); one non-negative integer
  expression per output.
- **No width fields; widths are derived.** A CC input group declares a **max input value**
  (`max_value`), enumerated exhaustively; streaming SC/FSM/TM inputs are **sampled** (binary:
  min/mid/max of each bit-length ≤ `SAMPLE_MAX_LEN`; tally: 0..`TALLY_SAMPLE_MAX`; cartesian
  ≤ `MAX_SAMPLED_CASES`). Output widths come from the largest output — **outputs are never
  truncated** (`x + y` keeps its carry; XOR is `x ^ y`).
- **Representation** — one per question (`binary` | `tally`): input ranges, axis layout,
  decoding — owned by the codec, not the DSL.
- **Safety** — strict token whitelist before `new Function()`; formulas are
  instructor-authored, never student-supplied.

## Source-of-truth docs (in repo, not auto-loaded)

- `spec/PHIL_133_Platform_Spec_v2.md` — the platform spec: authority for behaviour, layout,
  features.
- `docs/buildout/NORTH_STAR.md` (design principle, verification tiers),
  `docs/buildout/VISUAL_VOCAB.md` (the appearance oracle), `docs/buildout/designs/` (a memo
  per major architectural decision — write one before a significant move).
- `spec/mm_textbook.pdf`, `problem sets/hw1.pdf`…`hw7.pdf`, the UI mockups under `spec/`;
  `CLAUDE_CODE_PROMPT.md` (the original brief); `deploy/README.md`, `server/README.md`,
  `app/tools/fixtures/reference/README.md`.

## Build phases (from the spec) — all built

**CC** → **SC** (MEM, clocked time; a box may hold MEM — kind `SC`, SC canvases only) →
**FSM** (k-bit `input:output`) → **Turbots** (arena Map; CC/SC/FSM/TM brains) → **Turing
machines** (two-output `read:write,move` labels — the one deliberate textbook departure,
spec §10.3) → **TM turbots** (the textbook model; `turbot.ts`).

## Critical design rules (don't miss these)

- **Directionality** — inputs on the **left**, outputs on the **right**; signal flows
  left→right (gates, MEM, boxed circuits alike).
- **Wires** — split freely (one output → many inputs), never merge. Crossings draw a bump,
  splits a dot. Color: **black = 0, red = 1**.
- **Validation** — _warn, don't block_ on loops, merged links, free ends (red + tooltip).
- **I/O tables** — the right panel shows raw per-wire bits (no Argument/Value table).
  `repSystem` (persisted, never set) picks a SANDBOX TM's alphabet: binary {0,1,*}.
- **Time flows right-to-left** in SC and FSM tables (t1 on the right).
- **Question runs ARE the grader's runs** — in an assignment question, SC/FSM Run/Step run
  exactly `stepCountFor` steps of the grader's stream: typed global input is a **value** per
  input group (tally "11" = 2, binary "110" = 6) laid on the time axis by `encodeInput` (LSB
  at t1); SC decodes only the grader's window per output group
  (`selectCodecLayout`/`selectCodecWindow`; `scWindowCheck`); an SC perception film
  (`setScFrames`) runs exactly its frames (`selectScRunWindow`; `perceptionCheck`). Invalid
  numerals (tally "101") run on raw bits, shown as '/'. Only **sandbox** SC runs use the
  per-MEM 0-drain flush; sandbox FSM runs stop at the typed length. TM/turbot question runs
  stop at the grader's budgets (`DEFAULT_TM_MAX_STEPS`; the arena's `maxSteps`), sandbox Run
  at 1000 (`selectQuestionStepBudget`; `caseRunCheck`).
- **MEM block** — M_OUT (left) feeds the stored value in; M_IN (right) takes the new value.
  Memory starts at 0 (the grader ignores saved values); the stored value shows while
  simulating.
- **Input labels** — assigned at creation, permanent; a new input takes the next number
  whatever its vertical position.
- **Turbot encoding is hardcoded** — sensor in: 0 empty, 1 block; motor out `ij` =
  left/right wheel: 00 stay, 01 turn left, 10 turn right, 11 forward. FSM brains output the
  full 2-bit code (`in:ij`); TM brains move ↑/↱/↰ (`turbot.ts`).
- **CC evaluation** — topological sort; propagation is instantaneous.
- **Homework JSON** (spec §1.5): numeric `test_cases` (`{inputs, outputs}` of values). TM
  questions may set `requireStandardHaltPosition` (the head halts on the output block's
  rightmost cell); any TM or TM-brained turbot question `maxTapeCells` (span of tape touched,
  checked after acceptance). Any question may set `allowed_components` (listed types +
  always-allowed INPUT/OUTPUT/STATE; boxed internals recursed; absent/empty = unrestricted;
  enforced at Stage 1 and in the palette, authored in the creator) and `component_limits`
  (`{TYPE: max}`, counted through boxed internals — HW2 P6's "one +1 sub-part" is `{BOXED: 1}`).
- **Editing locks** — a question refuses edits when marked done OR showing a submission
  (viewed, or frozen: past due AND submitted, `dueDates.ts isFrozen`), both via `store.ts`'s
  `isCurrentQuestionLocked`/`selectQuestionLocked`, inlined atop every mutating action —
  never gate in a component, or a new edit path slips past. Simulation (Run/Step/evaluate)
  is deliberately NEVER locked; nor are INPUT toggles, MEM overrides, idle TM tape edits
  (exploratory, reset on navigation).
- **Boxing a TM or an FSM is refused by design** (no wire boundary to box as a stateless
  call): `placeableBoxKinds('TM'|'FSM')` return `[]` (reasoning in `types.ts`).
- **Every canvas swap resets sim state AND undo/redo** via `resetAllSimState()`; **every
  principal change** (sign-in/out, 401) resets the whole editor store and loads that person's
  sandbox via `resetForPrincipal()`, called by the auth provider (`navResetCheck`); removing
  a background tab deliberately leaves the live run alone. **A machine edit**
  (`gradedMachineKey` changes; not a move) restarts every live run at t=1 keeping input and
  undo — a `store.ts` subscriber, so no action or component decides.
- **Assignment content enters only through the provenance seam** — in an assignment a paste
  takes only what this user copied in an assignment in this window: canvas paste and every
  answer field (open response, fill-in, box rename) ask `provenance.ts`; no clipboard API
  outside `usePasteGuard.ts`, which every new answer field must wear (`pasteCheck` grep gate).
  The clipboard is memory only (nothing copied in an assignment reaches the system's): a
  principal change empties it and the mint keys, a canvas swap never does. `window.__store`
  is dev-only. Ids come only from `mintId` (grep-gated); the editing record advances in
  `store.ts recordEdit`, at edit time, never at save.

## Things to watch

- **The repo is PUBLIC: student data never enters git** (class lists → gitignored
  `rosters/`; feedback reports → `tasks/CATCHER.md` §3).
- **Test cases never ship to the client in production — SOLVED in remote mode.** The server
  strips `test_cases`/`perception_cases`/`fill_in_answers` from student copies, and the
  answer key (`expected`/`got`) and `integrity` from student results, keeping safe per-case
  fields (`sanitize.ts`; parity-pinned both ways). LOCAL mode holds answers and grades in the
  browser **by design** (the dev/demo prototype students never use). Never wire the engine
  grader (or any answer-carrying JSON) into the remote-store module graph (`remoteStoreCheck`
  grep gate).
- **localStorage is LOCAL mode only.** Remotely: the token (`mm:auth:token`) + its owner
  (`mm:auth:principal`), the crash journal, per-person sandboxes (`making-minds-autosave:*`),
  the migration guard, ui prefs. Old local data is never deleted (`migrateLocal.ts`).
- **Remote workbooks are last-write-wins across devices** (accepted pilot trade-off,
  `docs/buildout/designs/remote-stores.md` §5; If-Match is the follow-up if it bites).
- **Releasing = `deploy/release.sh`** (box backup, pull, homework sync, restart; Pages
  upload; smoke test; needs main == origin/main and the gitignored `secrets/` + `ssh/` key —
  `deploy/README.md` §0); the robot runs it `--unattended` via `deploy/release-gate.mjs`.
- **Deploy knobs live in `deploy/README.md`** (Pages build vars, the Lightsail unit's env;
  backups daily, kept 35 days).
- **CI is strict TypeScript** (`noUnusedLocals`, `noUnusedParameters`): before committing
  run `npx tsc -p tsconfig.app.json --noEmit` and `npm run typecheck:tools` in `app/` (both
  gate the deploy); after any push check `gh run list --limit 1`.
