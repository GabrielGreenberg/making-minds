# Making Minds — Project Guide

This file is auto-loaded into every session, so it is an **index, not a journal**: Part 1
says where the project stands, Part 2 is the technical reference. It is kept **under 40 KB**
by `tasks/tools/check-budgets.mjs` (runs in CI and in app `npm run check`).

> **Maintenance.** When a task changes what is built, how it works, or what comes next,
> update the STATUS here (Part 1 "Where we are now" / "What's next", the affected Part 2
> entries) **in place: replace, never append**, and bump the date below. A change's dated
> story lives in its task file's `## Progress log` and one line in `tasks/log.md`, never
> here; the pre-pipeline changelog (2026-07 → 2026-09-21) is frozen in `docs/HISTORY.md`.

_Last updated: 2026-09-23_

## How work flows — the task pipeline (`tasks/`)

All work bigger than a one-line fix goes through the committed queue in `tasks/` (schema and
the id rule: `tasks/README.md`; shared operating rules every role reads first:
`tasks/PROFILE.md`; how to launch: `tasks/START.md`):

- **`/catch`** — the catcher session: Gabriel describes problems and ideas, it diagnoses
  (root cause, class, deep vs surgical fix) and files task files, surfacing parked questions
  from `tasks/blocked/` first.
- **`/work`** — the work session: it surveys the queue, proposes merges, offers options;
  Gabriel picks; the session works one task in depth on a `task/NNN-slug` branch and lands
  it with a merge commit.
- **`/worker`** — the unattended routine (written, **not yet scheduled**): claims one
  `size: small` task, fixes it in a worktree, verifies by the gates, merges. `large`/`unknown`
  tasks and anything with `requires:` are interactive-only by construction.

The former build-out loop (`/handoff`) is retired; of `docs/buildout/` only `NORTH_STAR.md`
and `VISUAL_VOCAB.md` stay live (Source-of-truth docs).

---

# Part 1 — Project Status

## The goal

A platform where a student logs in (eventually UCLA SSO), picks an assignment, works on it
(one canvas per question, in the right mode — CC / SC / FSM / TM / turbot / open), leaves,
comes back, and resumes exactly where they left off — then submits the whole assignment
with one button. On submit it goes to the **server** and is **autograded**. Instructors
author assignments and view scores. **Students cannot grade their own work** — grading is a
server/instructor capability.

## Where we are now

A single-page React + TypeScript app supporting the full target flow end-to-end in **two
backends behind one switch** (`app/src/storage/backend.ts`): **local** mode (browser-only
localStorage — the default, the dev environment, what the headless harness drives) and
**remote** mode (built with `VITE_API_BASE`; every seam backed by the `server/` API —
server-side grading, sanitized student payloads, real sessions). Identical flows in both
except where noted.

**Student side.** Every surface outside the editor renders inside ONE site-styled shell
(`PageShell`, the makingminds.org look — Key files: Page surfaces). The student area is **Home** (nav label; an
instructor's "Student view" is the same page) with the tabs **Assignments** (the catalog under
the website's up-next box — the soonest due homework) and **Grades** (`#/grades[/:id]`: a row per
homework with the result once released, opening into the question-by-question sheet; task
026). Sign in
(local: toy-account picker; remote: email + password against the CSV roster; "First time
here?" sets up a roster member's account (student ID), an access request only for an
off-roster email; the screen renders from the server's reported capabilities, so SSO needs
no frontend rebuild; a 30-day bearer session; a health retry screen while the server is
down; a "Password" control) → browse
**published** assignments (hidden until an instructor publishes) → the assignment as a
**problem-set document** (`AssignmentOverview` → `ProblemSetDocument`, task 020: preamble,
sections with the instruction for their run of problems, continuously numbered problems with
run-in titles, tables/one-liners in grids/columns, callout boxes, figures, a turbot's arena
drawn live, a status mark per problem, an "Original PDF" link) → a per-question canvas, whose panel shows the problem under its section's
instruction, in the right mode: **CC, SC, FSM, TM,
turbot** (TM: clickable tape strip below the canvas, machine table / run / history panels,
tape alphabet tied to the question's `representation`; turbot: the normal editor for the
question's `innerMode` brain plus the arena "Map" (Step/Run/Pause/Reset) in the right panel;
TM brains also show their internal tape read-only),
**open** (free-text panel) and **fill-in** (labelled
boxes, autograded). Debounced autosave through `WorkbookStore` (remote: PUT with an `'error'`
indicator + backoff retry, keepalive unload flush, and a per-email crash-buffer journal
replayed on the next open — a hard tab kill loses nothing). Leave and resume. **Submit** a
timestamped snapshot (remote submit is online-only: a failure alerts and records nothing —
the server stamps time). Once grades are released: the **Grades** tab's sheet (verdict per
question, the instructor's feedback note if any, a per-question "▸ failed inputs" dropdown
with safe fields only — which input/frame/blank/arena failed and why, never the answer key —
a link into that question, and per failed input/arena **Run this input** — the grader's run of
that case, loaded, recorded vs live verdict); Home and the overview re-fetch on every visit. **Freezing**: once the
due date has passed AND a submission exists, every question shows the actually-submitted
circuit read-only (Run/Step still work), edits are refused, Submit disappears; a student who
never submitted stays editable and can submit late, and that submission then freezes them.
**Mark done**: a per-question self-lock toggle with an "N of M done" summary; both locks share
`isCurrentQuestionLocked`. A **Feedback** link files platform/homework reports (category,
message, ≤ 2 downscaled screenshots). Editor chrome is minimal (Home + Submit + session).
**Paste provenance** (task 033): in an assignment a paste (canvas or answer field) takes only
what this user copied in an assignment in this window; nothing copied
there reaches the system clipboard. The sandbox is free. **Watermark** (task 034): ids carry a
MAC under a per-student, per-assignment key, each question a signed editing record; at submit
the server names whose ids they are and flags one-piece work (`integrity`, instructor-only,
never a verdict).
**Visitors** (task 027): access is per route (`routing.ts routeAccess`) — the sandbox is public, needs
no server; a browser never signed in (`mm:auth:known`) opening `#/` lands there (banner, Sign in).
The freeform **sandbox** offers every machine as a worksheet tab — CC / FSM / TM and a
Turbot tab (second menu page picks the brain kind) with its own editable arena ("Edit map").

**Autograding.** Pure headless `engine/` simulators for CC, SC, FSM and TM, graded through
one **value-based codec pipeline**: every machine implements a function `f`, checked against
a machine-agnostic bank of numeric `(x, f(x))` `test_cases` via `validate → encode → run →
accept → decode → compare`. The only per-mode knowledge is the **axis** — CC `space`, SC/FSM
`time`, TM `tape` — in `engine/codec.ts` + `tmCodec.ts`. Outside the codec: **turbots**
(`gradeTurbot` runs the CC/SC/FSM/TM brain in every `turbot_cases` arena; criteria
reach-and-stop / pass-through / return-to-start judged on positions only, never path or
facing; every arena of the family must pass; return-to-start in a goal-ful arena also
requires visiting the goal, so hardcoded out-and-back brains fail), **perception**
(`gradePerception`, bit-level against `perception_cases`, a case passes iff every step
matches), **fill-in** (`engine/fillIn.ts`, string compare, leading zeros/whitespace
normalised), **open** (a `'pending'` result carrying the response for manual review).
Question-level constraints checked at Stage 1: `allowed_components`, `component_limits`,
`maxTapeCells`, `requireStandardHaltPosition`. Submissions autograde on receipt (the Grading
seam).

**Instructor side** (`#/instructor`, the **Dashboard**: the student pages' shell and column, its sections
as tabs — Assignments · Roster & accounts · Feedback · Notes): **Roster & accounts** (remote — the registrar's class list as exported,
a status report + who-left review; who has an account, password reset, add/remove, access requests),
**Feedback** queue (open/resolved/all), shared **Notes** page (one markdown document,
`marked` + `dompurify`, save-only-on-Save, warns before overwriting a newer save),
dashboard (drag-to-reorder, **Publish/Hide** — every assignment hidden until published;
local-mode "Load HW1–HW7"), assignment editor (drag-to-reorder questions; the document around them — preamble, source
PDF, sections with intro / layout / callouts / figures, every question filed into a section,
a live preview of the problem set), **question
creator** (all six modes on one form; per-problem callout boxes and figures; formula DSL →
test banks; turbot: inner machine,
encoding, arena editor ≤ 30×30, criterion + max-steps; perception: rule + retina size;
component restrictions and limits; TM halt-position toggle; **no fill-in authoring UI yet**),
**gradebook** grouped by student (latest attempt counts; expandable history with failed-case
drill-down per mode; ✓/✗ + note manual review of open questions; ⚑ integrity flags; Release/Hide grades).

**Server** (`server/`, Express 5 + `node:sqlite`, zero native deps): auth providers behind
`MM_AUTH_MODE` (`password` default — roster-gated registration, scrypt, login throttle;
`dev` passwordless; `sso` — capabilities reported, `authenticate` is a TODO), roster
import (UI + CLI), the **homework sync** (`npm run homeworks -- sync |
status`, task 007 — HW1–HW7 from the repo into the DB: missing ones added unpublished, copies
nobody edited refreshed, instructor-edited ones left alone and listed), assignment CRUD, workbooks (+ mint key, per-save size history), submit-with-grading + integrity,
manual review, grade release, feedback, notes, `/api/health`. SQLite, WAL. Gates: `serverCheck`, `rosterCheck`, `authCheck`, `parityCheck`, `homeworkSyncCheck`.

**Deployment — pilot live.** Cloudflare Pages `https://making-minds.pages.dev` → Lightsail
API at the placeholder `https://100-22-69-95.sslip.io` (Caddy TLS). Not yet fit for students:
UCLA SSO is a stub and the roster is the toy one (plus a leftover `cc-basics` demo row,
deletable from the dashboard). **Content:** HW1–HW7 live in the repo as JSON
(`app/src/devData/homeworks/`, 80 questions — machine problems from the reference fixtures,
prose problems as open questions), transcribed to their PDFs' document structure (sections,
intros, callouts, SVG figures cropped from the PDFs under `app/public/problem-sets/` beside the
PDFs themselves). **The repo is the source; every release syncs it into the pilot DB**
(`deploy/release.sh` → `npm run homeworks -- sync`), and local mode's "Load HW1–HW7" runs the same planner.

**Reference-fixture coverage:** 56/56 at-tier — 46 exact (correct passes every case, broken
fails) + 10 interface (navigation/capstone: a plausible attempt validates and grades
end-to-end; score reported, never asserted) — behind `app/tools/coverageCheck.ts`.

## What's next

The open work is the queue: `tasks/incoming/` (ready) and `tasks/blocked/` (waiting on
Gabriel) — run `/work` to see it offered. Headline items on 2026-09-22: **UCLA SSO** (blocked
on UCLA IdP details), a real domain + scheduled SQLite backup for the pilot box, sequential-sub-circuit boxing, a fill-in authoring UI,
a due-date-independent "view my submission" mode, turbot multi-arena authoring,
an SC perception frame player, LLM-assisted open-question grading, and — last — activating
the worker routine.

---

# Part 2 — Technical Reference

## What this is

An interactive web platform for **PHIL 133 ("Making Minds")**, a philosophy/computation
course (~80 students): students build circuits, finite state machines, Turing machines and
grid-based agents ("turbots") in autograded homeworks. A **single-page React + TypeScript
app** (`app/`, Vite) over the two backends of Part 1 (`VITE_API_BASE` picks remote at build).

## Architecture principle: seams

Every external dependency sits **behind an interface** — how the no-backend prototype became
a server-backed product by swapping implementations, not rewriting the UI. The seams
are Promise-returning; `storage/backend.ts` is the ONE mode decision and the sole exporter of
store instances. **Route new features through these seams, not around them.**

| Seam | Interface | Local mode (default) | Remote mode (`VITE_API_BASE`) |
| --- | --- | --- | --- |
| Evaluation | `engine/` (pure, headless) | runs in browser | same code grades on the server (imported directly) |
| Grading | `engine/grader.ts` | grades on receipt in `LocalSubmissionStore` | server grades on submit; client never sees `test_cases` (grep-gated); parity pinned |
| Identity | `src/auth/` (one provider per mode) | mockup login: pick a toy account | the server's account system rendered from its reported capabilities → bearer session → `me()` restore; 401 hook; visitor principal; UCLA SSO = one server-side `AuthProvider` swap |
| Persistence | `WorkbookStore` | `LocalWorkbookStore` | `RemoteWorkbookStore` + crash-buffer journal + fill-empty migration |
| Assignments | `AssignmentStore` + registry | localStorage; release + visibility flags on the seam (`mm:published:<id>`) | server CRUD, role-sanitized; `student_visible` defaults 0 |
| Submission | `SubmissionStore` | `LocalSubmissionStore` | `RemoteSubmissionStore` (answers only; identity/time = server's word) |
| Feedback / Notes | `FeedbackStore` / `NotesStore` | localStorage (`mm:feedback`, `mm:instructor-notes`) | `/api/feedback*`, `/api/instructor-notes` |
| Navigation | `routing` (`Route` + `navigate`) | hash URLs (starts inside AuthGate) | same |

**Keep evaluation logic framework-agnostic**: all simulation and grading lives in
`app/src/engine/` (pure TypeScript, no React, Zustand or DOM); the store and UI are thin
wrappers over it.

## Key files

| Area | Path | What's there |
| --- | --- | --- |
| Types | `app/src/types.ts` | All domain types: `AssignmentData` (incl. the document level: `preamble`, `sections: AssignmentSection[]`, `sourcePdf`) / `AssignmentQuestion` (incl. `title`, `hint`, `callouts`, `figures`, `allowed_components`, `component_limits`, `maxTapeCells`, `requireStandardHaltPosition`, `perception`/`perception_cases`, `turbot_cases`, `fill_in`/`fill_in_answers`), `SubmissionData`/`SubmissionRecord`, `QuestionResult` (+ `ManualReview`), `CircuitData`, `CCSpec`, `ArenaConfig`/`TurbotCaseResult`, `PerceptionCaseResult`, `QuestionCircuit` (`responseText`, `done`). `questionModeLabel` names a turbot's inner machine / a perception task in mode chips. |
| Engine | `app/src/engine/cc.ts`, `sc.ts`, `fsm.ts` | Pure simulators: topological eval (CC), clocked step (SC; `evaluateSCSequence` clocks top-level MEMs only), transition matching (FSM; `evaluateFSMSymbolStep`). One `sortByLabel` in cc.ts orders I/O for top-level and boxed internals. |
| Engine | `app/src/engine/tm.ts`, `tmValidate.ts`, `tmCodec.ts` | TM: notation-aware tape engine — **two-output** labels `read:write,move` (`1:0,R`; legacy `1:0R` parses forever as an alias) executed as one atomic step; table validation (ambiguous/unparseable via the generic walker); the codec `tape` axis (accept honors `requireStandardHaltPosition` — head halts on the output block's rightmost cell); `tapeCellsUsed` = span of tape touched, for `maxTapeCells`. |
| Engine | `app/src/engine/caseRun.ts`, `grader.ts` | `caseRun.ts`: one case run as graded, key-free (`questionLayout`, `gradingCircuit` — MEMs from 0, `validateQuestionMachine`, `caseStimulus`, `runValueCase`/`runTurbotCase`); `grader.ts` = that + the comparison (`gradeQuestion` results parallel the banks; turbot, perception bit-level, fill-in, open → `'pending'`). |
| Engine | `app/src/engine/codec.ts`, `machineValidation.ts` | The codec (`space`/`time` value↔bits; `tape` → tmCodec; `stepCountFor`, `encodeInput`, `timeOutputBits`) and Stage-1 validation incl. `validateAllowedComponents`/`isComponentTypeAllowed` (semantics: Critical design rules, Homework JSON) and component limits. |
| Engine | `app/src/engine/testVectorGen.ts`, `formulaEval.ts` | Authoring-time: formula DSL → test banks (Reference-function DSL below). |
| Engine | `app/src/engine/notation.ts` | Transition-label SYNTAX seam: `TransitionNotation` (parse / canonical format / alphabet / editor token fields / default) for all grammars — k-bit `fsmNotation(inBits, outBits)`, `tmNotation(rep)` (`*` binary-only), `turbotFsmNotation` (1-bit alias → canonical 2-bit motor), `turbotInternalNotation(tapeNotation)`; generic `validateTransitionTable` walker. Label dissection is allowed ONLY here (notationCheck grep gate). |
| Engine | `app/src/engine/representation.ts`, `index.ts` | value↔bits core (`valueToBits`/`isValidCodeword`/`bitsToValue`), display helpers; barrel exports. |
| Engine | `app/src/engine/turbot.ts` | Arena driver loop: `senseAhead`/`senseAheadSymbol` (B/E/F), `applyMotorCommand`, `runBrainStep`/`initialBrainState` (CC/SC circuit brains; the turbot FSM with 2-bit motor outputs `in:ij` via `turbotFsmNotation`; the textbook **turbot TM** — internal (circle) states do single tape ops on the encoding's alphabet, external (square) states sense B/E/F and move ↑/↱/↰; `validateTurbotTM`/`validateTurbotFSM`), `runTurbot` (`stopped` = motor 00 or TM halt). `evaluateTurbotCriterion` + `criterionRequiresStop` (pass-through is trace-satisfiable: `pass: true` with `hitStepLimit: true` is legitimate) + `explainTurbotCriterionFailure`. |
| Engine | `app/src/engine/perception.ts`, `fillIn.ts` | Perception rules (`min-run`/`exact-run`/`pattern` for CC; `change`/`motion` for SC — "up" = toward IN1; the pre-first-frame "previous input" is the all-zero frame), `buildPerceptionCases` (CC exhaustive ≤ 10 wires; SC fixed battery), `validatePerceptionMachine`, `runPerceptionCase`. Fill-in grading. |
| Store | `app/src/store.ts` | Zustand UI state delegating simulation to `engine/`. Sim slices (SC/FSM/TM/turbot + I/O `tableRows`) and undo/redo are app-wide — hence the two reset laws (Critical design rules). Selectors: `selectEffectiveMode` (turbot → inner mode; drives every editor branch), `selectTmNotation`, `selectTurbotArena`/`selectTurbotInnerMode` (sandbox falls back to the active tab's own `arena`/`innerMode`), `selectAllowedComponents`, `selectLiveFsmStateId`, `selectCodecLayout`/`selectCodecWindow`/`selectQuestionStepBudget` (question runs mirror the grader), `selectAssignmentFrozen`, `selectQuestionLocked`. `isCurrentQuestionLocked(state)` (done OR frozen) is inlined at the top of every mutating action. `frozenQuestionCircuit` loads the SUBMITTED circuit when frozen. `loadCaseInput` replays a graded case (`loadedCase`, `turbotCaseIndex`). Boxes: `confirmedBoxLibrary` is per HOMEWORK in an assignment (`AssignmentState.boxLibrary`), per TAB in the sandbox; `nextBoxName`/`takenBoxNames` keep default names unique; `renameBox` is the ONE rename path (library + drawn box + every placed instance in every question). `openResponse` mirrors `QuestionCircuit.responseText`. |
| Problem-set document | `app/src/problemSet.ts`, `components/ProblemSetDocument.tsx`, `statementFormat.ts`, `components/StatementBody.tsx` | The document level over `questions[]` (design memo `docs/buildout/designs/problem-set-document.md`). `problemSet.ts` (pure): `documentSections` (no `sections` → one unnamed section; unlisted questions trail; ids used once), continuous `problemNumber`, `problemShape` table / compact / full → `problemRuns` grid / columns / stack (a section's `layout` overrides), `figureUrl` (data URL or public path under the base URL), `validateDocument`. `ProblemSetDocument` renders the overview and lends `ProblemBody` / `ProblemContext` to the three editor panels. `statementFormat.ts`: the markup parser (`$…$` KaTeX, `` `code` ``, bold, italic, paragraphs, line breaks, `- ` / `1. ` lists with two-space nesting, `(a)` or line-start `a.` parts; inline `IN1=0,IN2=1 -> OUT=1` profiles lifted into tables), `statementProse` for previews; `StatementBody` the one JSX renderer (`lead` runs a title into the first paragraph). Styling: `.ps-*` and `.statement-*` in `pages.css`. |
| Due dates | `app/src/dueDates.ts` | Pure policy: `dueStatus` (green > 3 days / amber < 3 days / red overdue), `lateBy` (0 = on time = no signal), `formatDuration`/`formatDueDate`, and `isFrozen(dueDate, now, hasSubmission)` — the ONE exception to "a due date never gates anything": editing is gated only once past due AND submitted; submitting never is. |
| Routing | `app/src/routing.ts`, `useRoute.ts` | `Route` union (incl. `grades`, Home's Grades tab; `caseIndex` = `#/a/:id/q/:i/case/:k`), `parseHash`/`routeToHash`, `navigate()`; `useRoute()` is the hash as React state (the student Home's tabs and `useInstructorRoute` read it). |
| Wire layout | `app/src/componentGeometry.ts`, `wireRouter.ts` | `componentGeometry` is the single source of truth for component dimensions, port math (`getPortPosition`, OR/XOR left-port inset, rotation), the full obstacle footprint `getComponentBounds` (body + INPUT toggle-tab) and the rotation-aware `getLabelAnchor` — imported by the canvas, the router and the layout oracle. `wireRouter` is the cost-based A* orthogonal router (own-endpoint exemption; doomed wires take the L-path in a phase-0 pass; per-wire `usedFallback`/`violation` flags shown as tooltip + amber halo; `findDivergencePoints` for junction dots). |
| Storage | `app/src/storage/workbookStore.ts`, `AssignmentStore.ts`, `submissionStore.ts`, `feedbackStore.ts`, `NotesStore.ts` | The five Promise-returning seam interfaces + Local impls. Grade release lives on `AssignmentStore` (`getGradesReleased`/`setGradesReleased`). `submissionStore` owns `recordManualReview`. |
| Storage | `app/src/storage/backend.ts`, `remoteStores.ts`, `manualReview.ts`, `journal.ts`, `migrateLocal.ts` | `backend.ts`: the ONE mode decision + sole exporter of store instances. `remoteStores.ts`: Remote impls as direct `api/client.ts` calls (404 → seam-null; GRADER-FREE, grep-gated). `manualReview.ts`: the leaf pure `applyManualReview` used by the local store AND the server. `journal.ts`: per-email crash buffer `mm:journal:<email>:<asgId>` replayed by the next `openAssignment`. `migrateLocal.ts`: first-remote-login fill-empty upload of local data (guard `mm:migrated:<email>`; server never overwritten; submissions/release/reviews not migrated). |
| Auth | `app/src/auth/` | `AuthGate.tsx` (per-route gate; `initRouting()` + landing rule fire here), `HealthGate.tsx` (health provider + retry screen), `LoginScreen.tsx` (toy picker locally; remotely the panes Part 1 describes, from the server's `AuthCapabilities`), `AccountPanel.tsx` (change password), `authProvider.tsx` (one provider per mode), `types.ts`, `session.ts`, `accounts.ts`, `instructorRole.ts`. |
| Page surfaces | `app/src/theme.css`, `pages.css`, `components/PageShell.tsx`, `SessionControls.tsx` | The design layer for everything outside the editor. `theme.css`: the makingminds.org palette / type / spacing as `--mm-*` tokens (each names its `site.css` original; colour literals live ONLY in its `:root`) + the shared vocabulary (shell, tags, rows, tables, buttons, fields, segmented controls, modals). `pages.css`: per-surface rules. `PageShell`: topbar (brand → the website; `appNav` by role; the Sandbox link; session controls) · band · ONE `.page` column (1080px, every route) · footer, plus a `card` variant for login/health; `.mm-tabs` is a section's own navigation inside the column (the Dashboard's tabs). `index.css` is the editor alone and inherits only the font family. Rules: `docs/buildout/VISUAL_VOCAB.md` §Page surfaces; gate: `themeCheck`. |
| Async UI | `app/src/useAsyncValue.ts` | The shared fetch-on-mount hook (`value`/`loading`/`error`/`reload`) behind every view reading the async seams. |
| Provenance | `app/src/provenance.ts`, `usePasteGuard.ts` | The paste seam (pure; its header states the rule and its limits): `canPaste`, `canvasPasteVerdict` (in an assignment + canvas kind, `allowed_components`), `textPasteVerdict`, `refusalMessage`; a module-memory clipboard (canvas + text slots). `usePasteGuard`: the answer fields' DOM adapter (copy/cut/paste/drop/`beforeinput`). `provenance/` (task 034; pure, server-imported): `ids` (`mintId`, the ONE id source; `verifyId`; the memory-only key registry), `sha256`, `trace` (the signed record), `integrity` (`assessIntegrity`, thresholds), `notice`. |
| Assignments | `app/src/assignments/index.ts` | Thin registry over the `AssignmentStore` seam (`listAssignments`/`getAssignment`/`createAssignment`) + `sortAssignments` (instructor `order` asc, then title). Nothing is bundled into the app: local mode starts empty until the dashboard's dev seeds load content. |
| Instructor UI | `app/src/instructor/` | `InstructorApp`, `InstructorGate`, `InstructorDashboard`, `RosterView`, `FeedbackQueueView`, `NotesView`, `AssignmentEditor`, `dragReorder.ts` (pure `moveItem` + `useDragReorder`; pinned rows immovable), `QuestionCreator` (+ `ccPreview.ts`, `arenaEditing.ts` — `MAX_ARENA_SIZE` 30), `Gradebook.ts`/`GradebookView.tsx`, `DocumentEditors.tsx` (the callout-list and figure-list widgets shared by the assignment editor and the creator; `readFigureFile` caps an upload at 300 KB, downscaling rasters). |
| Student UI | `app/src/components/` | `CircuitCanvas`, `ComponentLibrary`, `DataTable`, `StudentLayout` (the Home tabs), `HomeScreen` (Assignments tab + up-next box), `GradesView` + `GradeSheet` (the Grades tab and its inline sheet), `GradedCaseBanner`, `AssignmentOverview` (the document page), `ProblemSetDocument`, `MenuBar`, `FeedbackPanel`, `SequentialTimeline`, `TMTapePanel`, `ArenaCanvas`, `TurbotArenaPanel` (Map + run controls; sandbox "Edit map"), `TurbotTapePanel`, `OpenResponsePanel`/`FillInPanel` (read-only when locked; paste-guarded), `SimulationPanel`, `TabBar` (question nav + Mark done / 🔒 tag; sandbox + menu), `outputDisplay.ts` (t1-rightmost OUT rows, per-group ARG values). |
| API client | `app/src/api/client.ts` | One typed function per endpoint; bearer token under `mm:auth:token`; `onUnauthorized` hook; `health()`; auth/roster/feedback/notes calls; `putWorkbook` takes `keepalive`. `setApiBase` is the harness override. |
| Dev tool | `app/tools/shootProblemSets.mjs` | Headless-Chrome screenshots of every HW document, the canvas panel and the editor (it seeds local mode itself) — the visual proof when the browser pane is unavailable. |
| Server | `server/src/app.ts`, `db.ts`, `auth.ts`, `password.ts`, `roster.ts`, `rosterImport.ts`, `sanitize.ts`, `config.ts`, `seed.ts`, `roster-cli.ts`, `homeworks.ts`, `homeworks-cli.ts` | Routes, SQLite storage, the `AuthProvider` seam (`createAuthProvider` — `MM_AUTH_MODE`: `password` default / `dev` / `sso`; `LoginThrottle`), scrypt credentials (`scrypt$N$r$p$salt$hash`, self-describing), the pure roster reader (`roster.ts`, the registrar's export as-is) + `rosterImport.ts` (never removes; lists who left), redaction + grade-release withholding (`sanitize.ts`: students get no `test_cases`/`perception_cases`/`fill_in_answers`; their own results keep safe per-case fields but never `expected`/`got` or `integrity`), env config, seeding, the admin CLI (`npm run roster`). The homework sync (`homeworks.ts`: a copy is pristine iff its content hash is a committed version of its file — `gitLineage` over the box's clone — or one the sync wrote, the `content_sync` table; `seed.ts --homeworks` runs it too). Tools: `serverCheck.ts`, `rosterCheck.ts`, `authCheck.ts`, `parityCheck.ts` (server ≡ in-process grading, deep-compared), `homeworkSyncCheck.ts`. |
| Dev/sample | `app/src/devData/sampleData.ts`, `seed.ts`, `homeworks.ts`, `homeworks/hw{1..7}.json` | Sample assignment for all modes (netlist-built perception circuits, one turbot question per inner mode, open Q14) + sample submissions; `seedHomeworks()` syncs the real HW1–HW7 (record `mm:seeded-homework:<id>`) + reseeds 22 sample submissions; `homeworkSync.ts` is the pure planner it shares with the server (content hash = canonical JSON minus the instructor-owned `order`/`dueDate`; insert / unchanged / refresh / edited). |
| Tools | `app/tools/*.ts` | The headless harness — the project's test suite, all in `npm run check` (plus `grade.ts`, the CLI grader; `builder.ts`, the netlist builder; `layoutCheck.ts`, the canvas layout oracle): `codecCheck`, `dueDateCheck`, `statementFormatCheck` (markup grammar, document model, every HW valid with its figures), `notationCheck` (grammar pins + label-dissection grep gate), `themeCheck` (the Page surfaces gate), `tmCheck`, `turbotCheck` (all four brains; `[multi-arena]`, `[pass-through step-limit]`, trajectory/orientation independence), `perceptionCheck`, `scWindowCheck` (question runs ≡ grader), `caseRunCheck` (caseRun ≡ grader; replay per mode, remote shape, budgets), `routerCheck` (fallback budget 2; hw3-p4 pin), `bumpCheck`, `pipelineCheck` (submit → grade, every mode), `navResetCheck` (both reset laws; `[mark as done]`, `[frozen assignment]`), `routingCheck` (route access, landing, held routes, principal change), `boxScopeCheck` (box library scope, SC boxing refuses MEM, `[naming]`), `pasteCheck` (paste policy + the provenance grep gates), `provenanceCheck` (mint/verify, attribution, paste re-mint, stamp + trace flags, uuid grep gate), `remoteStoreCheck` (boots the REAL server; grader-import grep gate; auth client against a password-mode server), `coverageCheck` (the two-tier reference-fixture ledger + `allowed_components` self-test pins). |
| Queue | `tasks/` | The task pipeline (top of this file). `tasks/tools/check-budgets.mjs` is the size guard on this file. |

## Reference-function DSL (instructor authoring)

Instructors specify _what a student machine must compute_ with a small arithmetic
mini-language instead of writing test cases by hand — authoring-time only; the grader never
sees the formula, it runs against the generated numeric `test_cases`.

- **Where** — `engine/formulaEval.ts` (`evalFormula(expr, vars)` → non-negative integer;
  throws `FormulaError`) and `engine/testVectorGen.ts` (`buildQuestionBank(inputs, outputs,
  rep, mode)` → `{spec, test_cases}`, all at save). `QuestionCreator` probes formulas live
  (`probeFormulas`); save blocks on any formula error.
- **Language** — variables (declared input-group names), non-negative integer literals,
  `+ - *` and bitwise `& | ^ ~`, parentheses. No division, modulo, conditionals, calls. One
  expression per output, returning one non-negative integer.
- **No width fields; widths are derived.** A CC input group declares a **max input value**
  (`max_value`) and is enumerated exhaustively. SC/FSM/TM inputs are streaming, so they get a
  **sample** across input lengths (binary: min/mid/max of each bit-length up to
  `SAMPLE_MAX_LEN`; tally: 0..`TALLY_SAMPLE_MAX`; cartesian capped at `MAX_SAMPLED_CASES`).
  Output widths come from the largest generated output — **outputs are never truncated**;
  `x + y` keeps its carry, write `x ^ y` for XOR.
- **Representation** — one per question (`binary` | `tally`), governing input ranges, how the
  codec lays values on the axis, and decoding. The codec, not the DSL, owns value↔bits.
- **Safety** — strict token whitelist before `new Function()`; acceptable because formulas are
  instructor-authored, never student-supplied.

## Source-of-truth docs (in repo, not auto-loaded)

- `spec/PHIL_133_Platform_Spec_v2.md` — the platform spec; authority for behaviour, layout
  and feature decisions.
- `docs/buildout/NORTH_STAR.md` (design principle, verification tiers) and
  `docs/buildout/VISUAL_VOCAB.md` (the appearance oracle); `docs/buildout/designs/` (one
  memo per major architectural decision — write one before a significant move).
- `docs/HISTORY.md` — the frozen changelog through 2026-09-21.
- `CLAUDE_CODE_PROMPT.md` — the original implementation brief.
- `spec/mm_textbook.pdf`, `problem sets/hw1.pdf`…`hw7.pdf`, the UI mockups under `spec/`.
- `deploy/README.md`, `server/README.md`, `app/tools/fixtures/reference/README.md`.

## Build phases (from the spec) — all built

1. **CC** — gates, I/O, validated wiring, I/O tables, boxed circuits, snap-to-grid canvas.
2. **SC** — MEM block, clock/time model, right-to-left time-step table. SC boxes are
   combinational only (`confirmBox` refuses MEM).
3. **FSM** — state nodes, `input:output` transitions (k-bit), simulation with highlighting,
   state table; opposite-direction transition pairs render as two separated arcs.
4. **Turbots** — arena Map + circuitry workspace, fixed sensor/motor encoding, CC/SC/FSM/TM
   brains, instructor arena authoring.
5. **Turing machines** — tape, head, two-output `read:write,move` labels (the platform's one
   deliberate textbook departure, spec §10.3), clickable tape strip, run/history.
6. **TM turbots** — the textbook "Turbots: Operation" model (internal/external states,
   single tape actions, B/E/F senses, ↑/↱/↰ motors, blank starting tape shown read-only).

## Critical design rules (don't miss these)

- **Directionality** — inputs on the **left**, outputs on the **right**; signal flows
  left→right (gates, MEM, boxed circuits alike).
- **Wires** — splitting allowed (one output → many inputs); merging forbidden. Crossings draw
  a bump; splits draw a dot. Color: **black = 0, red = 1**.
- **Validation** — _warn, don't block_ on loops, merged links, free ends (red + tooltip).
- **I/O tables** — the right panel shows raw per-wire bits. The Argument/Value table and its
  toggle are gone; the codec's per-group value read survives as grading plumbing. `repSystem`
  is still persisted and picks a SANDBOX TM's tape alphabet, but nothing sets it, so a sandbox
  TM is fixed at binary {0,1,*}.
- **Time flows right-to-left** in SC and FSM tables (t1 on the right).
- **Question runs ARE the grader's runs** — inside an assignment question, SC/FSM Run/Step
  execute exactly `stepCountFor` time steps and feed exactly the grader's stream: the typed
  global input is parsed as a **value** per input group (tally "11" = 2, binary "110" = 6) and
  laid on the time axis by `encodeInput` (LSB at t1); the SC run decodes only the grader's
  window per output group (`selectCodecLayout`/`selectCodecWindow`; pinned by `scWindowCheck`).
  Invalid numerals (tally "101") run on raw bits and show '/'. The per-MEM 0-drain flush rule
  applies only to **sandbox** SC runs; sandbox FSM runs stop at the typed length. TM/turbot
  question runs stop at the grader's budgets (`DEFAULT_TM_MAX_STEPS`; the arena's `maxSteps`),
  sandbox Run at 1000 (`selectQuestionStepBudget`; `caseRunCheck`).
- **MEM block** — M_OUT (left) feeds the stored value in; M_IN (right) receives the new value.
  All memory initializes to 0 (the grader ignores saved values); the stored value is
  displayed during simulation.
- **Input labels** — assigned at creation and permanent; new inputs get the next sequential
  number regardless of vertical position.
- **Turbot encoding is hardcoded** — sensor in: 0 empty, 1 block. Motor out `ij` = left/right
  wheel motors: 00 stay, 01 turn left, 10 turn right, 11 forward. FSM brains output the full
  2-bit code (`in:ij`); TM brains use ↑/↱/↰ on external states.
- **CC evaluation** — topological sort; propagation is instantaneous.
- **Homework JSON** (spec §1.5) carries numeric `test_cases` (`{inputs, outputs}` of values).
  TM questions may set `requireStandardHaltPosition` (head must halt on the output block's
  rightmost cell) and any TM or TM-brained turbot question `maxTapeCells` (span of tape
  touched, checked after acceptance). Any question may set `allowed_components` (listed types
  + always-allowed INPUT/OUTPUT/STATE; boxed internals recursed; absent/empty = unrestricted —
  enforced at Stage 1, in the palette, and authored in the creator) and `component_limits`
  (`{TYPE: max}`, counted through boxed internals — HW2 P6's "one +1 sub-part" is `{BOXED: 1}`).
- **Editing locks** — a question refuses edits when it's marked done OR the assignment is
  frozen (past due AND submitted, `dueDates.ts isFrozen`). Both route through
  `store.ts`'s `isCurrentQuestionLocked`/`selectQuestionLocked`, inlined at the top of every
  mutating action — never gate in a component, or a new edit path will slip past it.
  Simulation (Run/Step/evaluate) is deliberately NEVER locked. Not locked either: INPUT
  toggles, MEM overrides, idle TM tape edits (exploratory, reset on navigation).
- **Boxing a TM or an FSM is refused by design** (no wire boundary to box as a stateless
  call): `placeableBoxKinds('TM'|'FSM')` return `[]`; the reasoning is beside it in `types.ts`.
- **Every canvas swap resets sim state AND undo/redo** via `resetAllSimState()`; **every
  principal change** (sign-in/out, 401) resets the whole editor store and loads that person's
  sandbox via `resetForPrincipal()`, called by the auth provider (`navResetCheck`); a
  background-tab removal deliberately leaves the live run alone.
- **Assignment content enters only through the provenance seam** — canvas paste and every
  answer field (open response, fill-in, box rename) ask `provenance.ts`; no clipboard API
  outside `usePasteGuard.ts`, which every new answer field must wear (`pasteCheck` grep gate).
  The clipboard is memory only: a principal change empties it (and the mint keys), a canvas
  swap never does. `window.__store` is dev-only. Ids come only from `mintId` (grep-gated); the
  editing record advances in `store.ts recordEdit`, at edit time, never at save.

## Things to watch

- **Test cases never ship to the client in production — SOLVED in remote mode.** The server
  strips `test_cases`/`perception_cases`/`fill_in_answers` from student copies and the answer
  key (`expected`/`got`) and `integrity` from student results, keeping safe per-case fields
  (`sanitize.ts`; parity-pinned both ways). LOCAL mode holds answers and grades in the browser **by design**
  (the dev/demo prototype, never what students use). Never wire the engine grader (or any
  answer-carrying JSON) into the remote-store module graph (`remoteStoreCheck` grep gate).
- **localStorage is LOCAL mode only.** Remotely: the token (`mm:auth:token`) + its owner
  (`mm:auth:principal`), the crash journal, per-person sandboxes (`making-minds-autosave:*`),
  the migration guard.
  Old local data is never deleted (first remote login uploads it fill-empty).
- **Remote workbooks are last-write-wins across devices** (accepted pilot trade-off,
  `docs/buildout/designs/remote-stores.md` §5; an If-Match precondition is the follow-up if it bites).
- **Releasing = `deploy/release.sh`** after a push to `main` (box backup + pull + homework sync + restart over ssh,
  then the Pages upload; refuses unless local main == origin/main; needs the gitignored
  `secrets/cloudflare.env` and an `ssh/` key — `deploy/README.md` §0).
- **Deploy knobs live in `deploy/README.md`**: Pages sets `VITE_API_BASE` and
  `VITE_BASE_PATH=/` at build; the Lightsail unit sets `MM_AUTH_MODE=password`,
  `MM_CORS_ORIGINS` and friends; SQLite backup = copy the file (WAL-safe).
- **CI is strict TypeScript** (`noUnusedLocals`, `noUnusedParameters`): run
  `npx tsc -p tsconfig.app.json --noEmit` before committing; after any push check
  `gh run list --limit 1`.
