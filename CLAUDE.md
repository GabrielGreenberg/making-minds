# Making Minds — Project Guide

This file is read automatically at the start of every session. It has two parts:
**Part 1 — Project Status** (an overview of what's done and what's left, for humans and
Claude) and **Part 2 — Technical Reference** (architecture, key files, and design rules for
Claude to load into context).

> **Maintenance — keep this file current.** Whenever you finish a task that changes what is
> built, how it works, or what comes next, update this file **as part of that task** (before you
> report it done) — do not leave it stale for a later pass. Specifically:
> - Update **Part 1** ("Where we are now" / "What's next") to match what actually shipped, and
>   bump the _Last updated_ date below.
> - Update **Part 2** when the architecture, file layout, key files, or a design rule changes.
>
> A change isn't finished until the docs that describe it are too.

_Last updated: 2026-07-05 (turbot engine — first slice of the turbot feature block: pure
`engine/turbot.ts` (arena driver loop around the existing CC/SC/FSM/TM single-step evaluators —
sense → run one brain cycle → apply motor command → record history, halting on motor "00" or a
halted FSM/TM brain) plus the grader's `gradeTurbot` branch (arena-based success criteria —
reach-and-stop / pass-through / return-to-start — replacing the old `skip('turbot grading not
yet implemented')`). New types: `ArenaConfig`, `TurbotState`, `TurbotHistoryEntry`,
`TurbotTestCase`, `TurbotCaseResult`, plus `innerMode`/`turbot_cases` on `AssignmentQuestion`.
Headless-only so far — no arena canvas, no instructor arena editor, no store wiring yet; verified
via `tools/turbotCheck.ts`. Earlier 2026-07-04: UI/UX batch from notes/todos.md — FSM/TM state
connection rework: drag from anywhere on a state's rim, release anywhere in the target;
click-port-then-click-target "arms" a pending wire (no more accidental self-loops);
select-s1-then-shift-click-s2 creates a transition; shift-click-rotate removed (shift-click now
toggles selection; Rotate stays in the toolbar); triple-click selects all; drag-select picks up
transition arrows; Task/Options dropdowns removed; bigger TM tape; question panel shows the
representation; question-nav arrows moved next to "‹ Questions"; question creator: single-output
**Target function** section (`f(x, y) = …`) with an inline live check (spinner-less number
fields); submit no longer downloads JSON and warns that only the latest submission is graded;
gradebook groups submissions by student — latest scores per student, per-student attempt counts,
expandable history)_

---

# Part 1 — Project Status

## The goal

A platform where a student logs in (eventually UCLA SSO), picks an assignment, works on it
(one canvas per question, in the right mode — CC / SC / FSM / TM), leaves, comes back, and
resumes exactly where they left off — then submits the whole assignment with one button. On
submit it goes to the **server** and is **autograded**. Instructors author assignments and
view scores. **Students cannot grade their own work** — grading is a server/instructor
capability.

## Where we are now

A browser-only single-page app supporting the **local** version of the full target flow,
end-to-end:

- **Student side** — mockup login (pick a student or instructor account) → browse assignments →
  open one to its **question list** (`AssignmentOverview`) → click a question to open its
  dedicated canvas in the correct mode (**CC, SC, FSM, and TM** — TM has a clickable tape strip
  below the canvas plus machine-table/run/history panels; its tape alphabet is tied to the
  question's `representation`, so `*` can only be entered — in the transition editor or on the
  tape — on binary questions; the question statement appears at the
  top of the right data panel) → navigate back to the list or between questions via the nav bar
  → instant local autosave →
  leave and resume (reload/Back returns you into the assignment) → Submit a timestamped snapshot.
  The editor chrome is minimal: no File/Edit menus (Home + Submit + session controls only).
- **Autograding (the codec)** — pure headless `engine/` simulators for **CC, SC, FSM, and TM**,
  graded through one **value-based codec pipeline**: every machine implements a function `f`, and
  `grader.ts` checks it against a machine-agnostic bank of numeric `(x, f(x))` `test_cases` via
  `validate → encode → run → accept → decode → compare`. The only per-mode knowledge is the
  **axis** — how a number maps to/from bits over wires (CC `space`), time (SC/FSM `time`), or tape
  (TM `tape`) — which lives in the **codec** (`engine/codec.ts` + `tmCodec.ts`). The old bit-based
  `test_vectors` are gone. Submissions **autograde on receipt** in `SubmissionStore` and the
  result is persisted on the record (the exact shape a real server endpoint will take).
- **Instructor side** — role-gated `#/instructor` mode: dashboard, assignment editor, a **question
  creator**, and a **gradebook** that reflects stored autogrades, **grouped by student**: one row
  per student showing the **latest** submission's scores (only the latest counts for grading) and a
  per-student attempt count; expanding a student reveals the full submission history with
  failed-case drill-down per attempt. Sample CC/SC/FSM/TM data can be seeded to demo the pipeline.
  The question creator is one shared form authoring **all four modes** (CC/SC/FSM/TM) — mode is an
  ordinary field, not a gate; question names are editable; there is no bit-width field and no
  example-preview table. Each question computes exactly **one output**: the **Target function**
  section shows `f(x, y, …) = <formula>` over the declared input-group names, with a lightweight
  live single-input check inline next to it. CC input groups declare a **max input
  value**; SC/FSM/TM have no size field — they're tested on a **sampled** set of values across a
  range of input lengths (`buildQuestionBank` in `engine/testVectorGen.ts`, which also derives all
  group widths).
- **Reference-function DSL** — instructors don't hand-write test cases. They declare a question's
  input/output groups + one representation and specify the correct output with a small
  **affine/bitwise arithmetic mini-language** (the "reference function"); the system enumerates
  inputs, evaluates the formula, and auto-generates the numeric `test_cases` — the full
  enumeration runs once, at save. While editing, a live check evaluates the formula on a single
  input per keystroke and a button previews up to 16 worked examples on demand (enumerating the
  whole space per keystroke was too slow). See the DSL section in Part 2.

The missing half is the **server** and productized submit/grade loop.

## What's next

**Near-term (still no backend):**

- **Turbots** — pure engine + grader branch done (`engine/turbot.ts`, `gradeTurbot` in
  `grader.ts`; a turbot's brain is a CC/SC/FSM/TM circuit with a fixed 1-bit sensor / 2-bit motor
  interface, not a fifth simulation engine). Still to build: the student arena canvas +
  split-panel workspace (arena on top, the inner circuit's normal editor below), the store's
  turbot sim slice (position/history/step/run), and the instructor's arena editor + `innerMode`/
  criterion/max-steps fields in `QuestionCreator`. TM-brained turbots (spec's Phase 6) are
  supported by the engine already but deferred everywhere else, matching CC/SC/FSM/TM's own phase
  order.
- **Deferred authoring follow-ups** — the `requireStandardHaltPosition` TM acceptance toggle and
  mode-filtered `allowed_components` (both optional fields on `AssignmentQuestion`, not yet
  exposed in the question creator's editor UI).

**The backend phase (the big step):**

- **Real auth** — replace the mockup login with UCLA SSO; student vs. instructor roles from the token.
- **Server persistence** — `RemoteWorkbookStore` behind the existing seam, syncing across
  devices. (Supabase free tier looks sufficient.)
- **Submission endpoint + server-side autograding** — submit → server runs `engine/grader` →
  results stored; instructor gradebook reads them (the local pipeline already mirrors this).
- **Real assignment content** — author the actual PHIL 133 homeworks (HW1–HW7).

---

# Part 2 — Technical Reference

## What this is

An interactive web platform for **PHIL 133 ("Making Minds")**, a philosophy/computation
course (~80 students). Students build circuits, finite state machines, and grid-based agents
("turbots"), completing and submitting homeworks that are automatically graded. Built as a
**single-page React + TypeScript app** that runs entirely in the browser today; designed so a
server can be added later by swapping implementations behind interfaces ("seams").

## Architecture principle: seams

Every external dependency sits **behind an interface**, so the no-backend prototype becomes a
server-backed product by swapping implementations — not rewriting the UI. **Route new features
through these seams, not around them.**

| Seam        | Interface                        | Today (prototype)                            | Later (product)            |
| ----------- | -------------------------------- | -------------------------------------------- | -------------------------- |
| Evaluation  | `engine/` (pure, headless)       | runs in browser                              | same code grades on server |
| Grading     | `engine/grader.ts`               | grades on receipt in `SubmissionStore`       | server grades on submit    |
| Identity    | `src/auth/` (mockup)             | mockup login: pick a toy account (student/instructor); role gates views | real SSO + role claim      |
| Persistence | `WorkbookStore`                  | `LocalWorkbookStore` (localStorage)          | `RemoteWorkbookStore`      |
| Assignments | `AssignmentStore` + registry     | bundled + localStorage (instructor-authored) | server CRUD                |
| Submission  | `SubmissionStore`                | `LocalSubmissionStore` (localStorage)        | server endpoint            |
| Navigation  | `routing` (`Route` + `navigate`) | hash URLs via History API                    | same routes                |

**Keep evaluation logic framework-agnostic.** All circuit/FSM evaluation lives in
`app/src/engine/` (pure TypeScript — no React, Zustand, or DOM) so the same code runs in the
browser and headlessly for server-side autograding. The store and UI are thin wrappers over
the engine.

## Key files

| Area          | Path                                                                           | What's there                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Types         | `app/src/types.ts`                                                             | All domain types: `AssignmentData`, `AssignmentQuestion`, `SubmissionData`/`SubmissionRecord`, `CircuitData`, `CCSpec`, `SubmissionResult` |
| Engine        | `app/src/engine/cc.ts`, `sc.ts`, `fsm.ts`                                      | Pure simulators per mode (topological eval for CC; clocked step for SC; transition-matching for FSM)                                       |
| Engine        | `app/src/engine/tm.ts`, `tmValidate.ts`, `tmCodec.ts`                          | TM: notation-aware tape engine, **dual-action** model (every transition writes a symbol and moves in one atomic step, e.g. `1:0R`); pre-engine table validation (ambiguous/unparseable); encode/accept/decode (the codec `tape` axis)          |
| Engine        | `app/src/engine/grader.ts`                                                     | `gradeSubmission` / `gradeQuestion` — one value-based codec pipeline for CC/SC/FSM/TM against numeric `test_cases`, plus a separate `gradeTurbot` branch (arena success criteria, not the codec)          |
| Engine        | `app/src/engine/codec.ts`, `machineValidation.ts`                              | The codec (`space`/`time` value↔bits; `tape` → `tmCodec`) and Stage-1 machine validation for all modes                                     |
| Engine        | `app/src/engine/testVectorGen.ts`, `formulaEval.ts`                            | Authoring-time: affine-formula language → `buildQuestionBank(inputs, outputs, rep, mode)` → `{spec, test_cases}` (widths derived; SC/FSM/TM sampled). Legacy `generateTestCases(spec, rep, mode)` remains for the sample data |
| Engine        | `app/src/engine/representation.ts`, `index.ts`                                 | value↔bits core (`valueToBits`/`isValidCodeword`/`bitsToValue`) + display helpers; barrel exports                                          |
| Engine        | `app/src/engine/turbot.ts`                                                     | Turbot arena driver loop: `senseAhead`/`decodeMotorCommand`/`applyMotorCommand` (grid + sensor/motor per spec §9.2) and `runTurbot`, which drives one movement cycle per call into `evaluateCCInputs`/`evaluateSCSingleStep`/`evaluateFSMSingleStep`/an inline TM step — a turbot brain is a CC/SC/FSM/TM circuit, not a new engine. `evaluateTurbotCriterion` judges a run against `reach-and-stop` / `pass-through` / `return-to-start` (spec §12.5). No arena canvas or store wiring yet (headless only) |
| Store         | `app/src/store.ts`                                                             | Zustand UI state; delegates simulation to `engine/`. Per-mode sim state incl. TM (`tmTape`/`tmStep`/`setTmCell`), `selectTmNotation` (TM alphabet: open question's `representation`, sandbox falls back to `repSystem`), and `assignmentView` ('overview' \| 'question')  |
| Routing       | `app/src/routing.ts`                                                           | `Route` union, `parseHash`/`routeToHash`, `navigate()`                                                                                     |
| Storage       | `app/src/storage/workbookStore.ts`, `AssignmentStore.ts`, `submissionStore.ts` | The three localStorage-backed seams                                                                                                        |
| Auth          | `app/src/auth/`                                                                | `AuthGate.tsx`, `stubAuth.tsx`, `instructorRole.ts`                                                                                        |
| Assignments   | `app/src/assignments/index.ts`, `cc-basics.json`                               | Bundled registry (`listAssignments`/`getAssignment`) + the one bundled CC assignment                                                       |
| Instructor UI | `app/src/instructor/`                                                          | `InstructorApp`, `InstructorGate`, `InstructorDashboard`, `AssignmentEditor`, `QuestionCreator`, `Gradebook(.ts/View.tsx)`                 |
| Student UI    | `app/src/components/`                                                          | `CircuitCanvas`, `ComponentLibrary`, `DataTable`, `HomeScreen`, `AssignmentOverview` (question list), `MenuBar`, `SequentialTimeline`, `TMTapePanel` (clickable tape), `SimulationPanel`, `TabBar` (question nav bar in assignments) |
| Dev/sample    | `app/src/devData/sampleData.ts`, `seed.ts`                                     | Builders + seeding for demo CC/SC/FSM assignments and submissions                                                                          |
| Tools         | `app/tools/grade.ts`, `pipelineCheck.ts`, `codecCheck.ts`, `tmCheck.ts`, `turbotCheck.ts` | Headless CLI grader, submit→grade pipeline check, codec + rep-core unit checks, TM engine/codec/grader smoke test, and turbot engine/grader smoke test (`npx tsx`)          |

## Reference-function DSL (instructor authoring)

Instructors specify _what a student circuit must compute_ with a small arithmetic
mini-language instead of writing test cases by hand. This is an authoring-time convenience
only — the grader never sees the formula; it runs against the generated numeric `test_cases`.

- **Where it lives** — `engine/formulaEval.ts` (`evalFormula(expr, vars)` → non-negative
  integer; throws `FormulaError`) and `engine/testVectorGen.ts`
  (`buildQuestionBank(inputs, outputs, rep, mode)` → `{spec, test_cases}`, all at save). The
  instructor UI (`instructor/QuestionCreator.tsx`, with `instructor/ccPreview.ts`) validates
  formulas **live on a single input** (`probeFormulas`, cheap per keystroke); there is no
  example-preview table. Blocks save on any formula error.
- **The language** — variables (declared input-group names like `x`, `y`), non-negative
  integer literals, and the operators `+ - *` and bitwise `& | ^ ~`, with parentheses. No
  division, modulo, conditionals, or function calls. Each formula is one expression returning a
  single non-negative integer.
- **No width fields; widths are derived.** Instructors never enter bit widths. A CC input group
  declares a **max input value** (stored as `max_value`; width = bits/strokes to hold it) and is
  enumerated exhaustively 0..max. SC/FSM/TM input spaces are unbounded/streaming, so they get no
  size field: `buildQuestionBank` tests a **sample** of values across a range of input lengths
  (binary: min/mid/max of each bit-length up to `SAMPLE_MAX_LEN`; tally: 0..`TALLY_SAMPLE_MAX`
  exhaustively; cartesian capped at `MAX_SAMPLED_CASES`). Output group widths are derived from
  the largest generated output, so **outputs are never truncated** — there is no
  width-as-modulus trick; write `x ^ y` for XOR, and `x + y` always keeps its carry.
- **Representation** — one per question (`binary` | `tally`), not per group. It governs the input
  value ranges, how the codec lays values onto the machine's axis, and how outputs decode. The
  codec — not the DSL — owns the value↔bits mapping at grade time.
- **All four modes in the UI.** `QuestionCreator` authors CC/SC/FSM/TM through one shared form
  (mode is a field, not a separate step; the question **name** is editable); the same DSL
  expresses every mode's function (the sample SC delay is `2 * x`, the FSM identity is `x`, the
  TM increment is `x + 1`). `buildQuestionBank` takes the mode to pick exhaustive-vs-sampled
  enumeration per axis. The grader handles all modes via the codec.
- **Safety** — `evalFormula` validates against a strict token whitelist (digits, declared
  variable names, the allowed operators) before evaluating via `new Function()`. Acceptable
  because formulas are instructor-authored, never student-supplied.

## Source-of-truth docs (in repo, not auto-loaded)

- `spec/PHIL_133_Platform_Spec_v2.md` — full platform spec; the authority for behavior,
  layout, and feature decisions. Read before implementing a phase.
- `CLAUDE_CODE_PROMPT.md` — the original implementation brief (phase plan + design details).
- `spec/mm_textbook.pdf` — course textbook for pedagogy and notation.
- `problem sets/hw1.pdf`…`hw7.pdf` — the real homeworks the grader must handle.
- `spec/Private & Shared/.../Mock_Ups-*.jpg` — UI mockups (CC/SC workspaces, FSM editor,
  turbot split view, TM).

## Build phases (from the spec)

1. **CC** — gates (NOT/AND/OR), I/O, validated wiring, I/O & A/V tables, boxed circuits
   (XOR, Half-Adder), drag-and-drop snap-to-grid canvas. _(built)_
2. **SC** — MEM block, clock/time model, right-to-left time-step table. _(built)_
3. **FSM** — state nodes, `input:output` transition arrows, simulation with state
   highlighting, state table. _(built)_
4. **Turbots** — split arena/circuitry workspace, grid arena, hardcoded sensor/motor
   encoding, live-linked internal circuit.
5. **Turing Machines** — infinite tape, read/write head, TM transition labels, op cycle.
   _(built: engine + grading + store + UI — FSM-style state editor, `input:action` labels,
   clickable tape strip, machine table / run controls / history)_
6. **TM Turbots** — turbot with TM-based internal circuitry.

## Critical design rules (don't miss these)

- **Directionality** — every component has inputs on the **left**, outputs on the **right**;
  signal flows left→right (gates, MEM, boxed circuits alike).
- **Wires** — splitting allowed (one output → many inputs); merging forbidden. Crossings
  draw a bump/arc; splits draw a dot. Color: **black = 0, red = 1**.
- **Validation** — _warn, don't block_ on loops, merged links, and free ends (red highlight +
  tooltip).
- **I/O vs A/V tables** — I/O shows raw per-wire bits; A/V shows concatenated numerals under
  **tally or binary**. Local scope = per-wire; global scope = all inputs as one number, all
  outputs as one number.
- **Time flows right-to-left** in SC and FSM tables (t1 on the right; later steps extend left).
- **SC runs flush the pipeline** — after a loaded input sequence is consumed, Run continues for
  one 0-input drain step per MEM so delayed bits (a serial adder's final carry, a delay
  register's last bit) reach the output instead of being dropped.
- **MEM block** — M_OUT (left) feeds the stored value in; M_IN (right) receives the new value.
  All memory initializes to 0; display the stored value during simulation.
- **Input labels** — assigned at creation and permanent; new inputs get the next sequential
  number regardless of vertical position.
- **Turbot encoding is hardcoded** — sensor in: 0 empty, 1 block. Motor out: 00 stop, 01
  left, 10 right, 11 forward.
- **CC evaluation** — topological sort for gate order; propagation is instantaneous.
- **Homework JSON** (spec §1.5) carries numeric `test_cases` (`{inputs, outputs}` of values); the
  codec encodes/decodes per axis and the grader compares decoded outputs to expected.

## Things to watch

- **Test cases must not ship to the client in production.** Bundled assignment JSON today
  includes `test_cases` (the answers) — fine for the prototype, where grading happens inside
  the `SubmissionStore` seam. In the product, split assignments into a client part (statements,
  modes) and a server-only part (test cases); the server grades on submit.
- **localStorage is a stopgap** — per-browser, per-device, ~5 MB. The `WorkbookStore` /
  `AssignmentStore` / `SubmissionStore` seams are exactly the boundaries a server replaces.
