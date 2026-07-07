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

_Last updated: 2026-07-07 (**perception questions (CC + SC)** — the perception homeworks are
now authorable and autogradable: a CC/SC question can be a **Perception** task (question
creator's new "Task" toggle) whose machine reads its inputs as an array of stimulations (a
retina) and outputs one classification bit. Grading is **bit-level, outside the value codec**
(new `engine/perception.ts` + `gradePerception` branch in `grader.ts`): cases carry raw
`frames` (bit-vectors, IN1 first; an SC case is one frame per clock tick) and the `expected`
output bit per step, generated at save from an authored `PerceptionRule` — CC rules `min-run`
(≥k consecutive 1s, "edge detector"), `exact-run` (a maximal run of exactly k, "object
detector"), `pattern` (input = an exact bit string, "landmark recognition"; width = pattern
length); SC rules `change` (current frame ≠ previous frame) and `motion` (an exactly-k object
image moving **up** — toward IN1 — 1 unit per tick). CC banks enumerate all 2^width frames
(width capped at 10); SC banks are a fixed deterministic battery of frame sequences (climbs,
drifts, statics, jumps, noise, random streams). SC timing convention: the "previous input"
before the first frame is the all-zero frame — exactly what fresh MEM blocks hold. New types
(`PerceptionRule`/`PerceptionSpec`/`PerceptionTestCase`/`PerceptionCaseResult`,
`perception`/`perception_cases` on `AssignmentQuestion`, `perceptionCases` on
`QuestionResult`); structural Stage 1 = width input wires + 1 output wire; a case passes iff
every step matches. Students need **zero new UI** — a perception question opens the ordinary
CC/SC canvas (mode chips read "CC - perception"); the gradebook drill-down shows failed
stimuli (frames → expected/got bit strings + first wrong step). Sample assignment grew to 13
questions (Q9–Q13 = the five textbook perception problems) with correct/incorrect sample
circuits built by a small netlist builder in `sampleData.ts` (the motion detector is ~80
gates); new `tools/perceptionCheck.ts` (44 checks) and `pipelineCheck` now 13/13 vs 0/13.
Merged with the same-day open-questions work: sample ids are machine Q1–Q8, perception
Q9–Q13, open Q14. Earlier, 2026-07-06: **open questions** — a sixth question mode, `buildMode: 'open'`,
for free-text answers that cannot be autograded: the student workspace swaps the canvas for a
writing panel (`OpenResponsePanel`; copy/cut/paste/drop are blocked in the textarea to
discourage pasting in prepared text — a soft deterrent, not a security boundary) with the same
chrome/nav/autosave/Submit as machine questions; the answer lives as `responseText` on
`QuestionCircuit` (mirrored by the store's `openResponse` at every canvas sync point) and on
the submission's answer; the grader returns a new `QuestionResult` status `'pending'`
("open question — needs manual review") carrying the `response`, contributing 0/0 to tallies —
designed so a future LLM-grading pass can consume the same field and replace the pending
result (not implemented). The question creator gains an 'Open' mode (name + statement only);
the gradebook marks open questions ✎ (excluded from the auto score — `SubmissionGrade.score`
is now over autogradeable questions only), shows a "manual review" stat tile instead of a pass
rate, and the attempt drill-down displays the full response; the grading CLI prints a word
count. A sample open question (the binary-vs-tally design question, now Q14) + sample
responses; `pipelineCheck` asserts the pending path. Verified: tsc/build clean, all tool
checks pass, and a store-level Node harness drove the open-question student flow (type →
switch → reload → submit → pending result). Earlier same day: **sample turbot questions for
all four inner modes** — the seeded
sample assignment now has eight questions: CC/SC/FSM/TM plus one turbot question per inner
mode (Q5 CC corridor, Q6 SC 3×3 L-course needing a MEM turner, Q7 FSM corridor, Q8 TM textbook
walker on a tally/unary question), each with correct/incorrect sample brains wired into the
sample submissions and `pipelineCheck` (now 8/8 vs 0/8); mode chips in the student question
list and the instructor assignment editor now name a turbot question's inner machine
("turbot - TM") via the new `questionModeLabel` helper in `types.ts`. Also: **turbotCheck FSM/SC coverage** — the turbot smoke test now
grades questions in all four inner modes: new FSM- and SC-brained graded questions beside the
existing TM and CC ones, plus first engine coverage for SC brains — a MEM-latching turner that
threads a 3×3 L-course (forward → turn left at the first wall → stop at the second), proving
brain state carries across arena cycles. Same day, **turbot-FSM 2-bit motors** — an FSM-brained turbot's Mealy
transitions now output the full 2-bit motor code (`in:ij`, e.g. `0:11`, `1:01` — same
wheel-motor encoding as CC/SC output wires), so FSM brains can issue every movement command,
turns included, closing the old stop/forward-only limitation: new `parseTurbotFSMLabel` +
`validateTurbotFSM` (labels must parse; every state handles both sensor inputs exactly once) in
`engine/turbot.ts`, used by `runBrainStep`'s FSM branch and `gradeTurbot`'s Stage 1; the
transition editor reuses the base-TM two-sub-field right half for the two motor bits (new
turbot-FSM default label `0:11`); the glossary's CC/SC/FSM rows merged into one motor-code
table. Same day, **turbot encoding + glossary polish** — turbot questions now carry an
authored **encoding** (binary | unary; the question creator's "Encoding" toggle, stored as the
question's `representation`, no longer hardcoded to 'tally'): it picks a turbot-TM brain's
internal tape alphabet (binary {0,1,*}, unary {0,1}) everywhere — the transition editor's token
sets (no `*` enterable under unary), the glossary, `validateTurbotTM`/`parseTurbotInternalLabel`/
`runBrainStep`/`runTurbot` (new `TMNotation` param, default binary), the store's live stepping,
and grading (`gradeTurbot` maps `representation` → notation; a `*`-using table fails Stage 1 on a
unary question — `turbotCheck` covers this). The Map glossary sits **level with the Map** when
the data panel is wide enough and wraps below it when not (`.turbot-map-row` flex-wrap), and its
output lines now name **motor states**, not movements: circuit brains "00 = both motors off /
01 = right motor on / 10 = left motor on / 11 = both motors on"), and
the turbot-TM arrows are glossed as ↑ = both motors on, ↱ = left motor on, ↰ = right motor on.
The engine's `TURBOT_TM_READ_SYMBOLS`/`TURBOT_TM_INTERNAL_ACTIONS` constants became the
notation-aware `turbotTMReadSymbols`/`turbotTMInternalActions`. Earlier 2026-07-05: a
percept/motor **glossary** under the Map — TM brains list the
internal/external vocabularies (B/E/F → ↑/↱/↰; 0/1/* → write/move), circuit brains the 1-bit
sensor and motor codes — and the question creator's Save/Cancel now also appear at the top of
the form. Same day, **turbot TM + Map relocation** — the TM-brained turbot is now the
textbook's real model ("Turbots: Operation"), replacing the earlier placeholder that reused the
base dual-action TM engine: STATE nodes carry a `stateKind` (internal = circle, external =
square; toolbar "In/External" toggle), internal transitions read the private {0,1,*} tape and
perform ONE single action (write a symbol OR move L/R), external transitions sense the cell
ahead as B (block/boundary) / E (empty) / F (food — passable, and F IS the goal cell) and move
forward (↑) or turn (↱/↰); every transition is one time step, turbots start on a blank tape
(shown read-only below the canvas via `TurbotTapePanel`), and halting is the turbot TM's stop —
`reach-and-stop` accepts a TM that halts on the goal (`TurbotRunResult.stopped`). Turbot-TM
tables get their own validator (`validateTurbotTM`, per-state-kind grammar) and the transition
editor/label store enforce the per-kind grammars. The student Map moved from above the canvas
into the right data panel (below the question statement, above the machine/history tables).
`TurbotHistoryEntry` is now kind/input/action (internal rows dimmed in the history table).
Earlier same day: **turbots, end to end** — the full Phase 4 feature block in five
staged commits: (1) pure `engine/turbot.ts` (arena driver loop around the existing CC/SC/FSM/TM
single-step evaluators — sense → one brain cycle → apply motor command → record history, halting
on motor "00", a halted FSM/TM brain, or the step limit) + the grader's `gradeTurbot` branch
(arena success criteria: reach-and-stop / pass-through / return-to-start) + new types
(`ArenaConfig`, `TurbotState`, `TurbotHistoryEntry`, `TurbotTestCase`, `TurbotCaseResult`,
`innerMode`/`turbot_cases` on `AssignmentQuestion`); (2) the store's turbot sim slice
(`turbotStep/Run/Pause/Reset`, pose + brain state + history), with reset wired into question
load/switch; (3) the student workspace — `TurbotArenaPanel` (Map grid + Step/Run/Pause/Reset +
cycle/sensor/motor readout) mounted above the normal canvas, `selectEffectiveMode` so a turbot
question's canvas edits its `innerMode` brain (palette, transition grammar, STATE interactions,
toolbar reset all follow it), and a DataTable turbot branch (machine table for FSM/TM brains +
movement history); (4) instructor authoring — 'Turbot' mode in `QuestionCreator` with an
inner-machine picker, clickable arena editor (blocks/goals/start+facing, resizable ≤20×20),
criterion + max-steps; gradebook drill-down shows per-arena steps/final-pose/reason; (5) sample
Q5 turbot question + correct/incorrect sample brains; `pipelineCheck` now covers all five modes.
Verified: tsc/build clean; `turbotCheck`/`tmCheck`/`codecCheck`/`pipelineCheck` all pass; a
store-level Node harness drove the full student flow (open → switch to turbot question → build
brain → step to goal → halt/reset/switch semantics). Earlier 2026-07-04: UI/UX batch —
FSM/TM connection rework, TM alphabet tied to representation, gradebook by student, single
target function; see git history)_

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
  dedicated canvas in the correct mode (**CC, SC, FSM, TM, and turbot** — TM has a clickable tape
  strip below the canvas plus machine-table/run/history panels; its tape alphabet is tied to the
  question's `representation`, so `*` can only be entered — in the transition editor or on the
  tape — on binary questions; a turbot question's canvas is the normal editor for the question's
  `innerMode` brain, with the arena "Map" (grid + Step/Run/Pause/Reset + cycle/sensor readout) in
  the right data panel below the question statement, above the machine table and step history;
  TM-brained turbots additionally show their internal tape read-only below the canvas; an
  **open** question swaps the canvas for a free-text writing panel — same nav/autosave/Submit,
  copy/paste blocked in the textarea) →
  navigate back to the list or between questions via the nav bar → instant local autosave →
  leave and resume (reload/Back returns you into the assignment) → Submit a timestamped snapshot.
  The editor chrome is minimal: no File/Edit menus (Home + Submit + session controls only).
- **Autograding (the codec)** — pure headless `engine/` simulators for **CC, SC, FSM, and TM**,
  graded through one **value-based codec pipeline**: every machine implements a function `f`, and
  `grader.ts` checks it against a machine-agnostic bank of numeric `(x, f(x))` `test_cases` via
  `validate → encode → run → accept → decode → compare`. The only per-mode knowledge is the
  **axis** — how a number maps to/from bits over wires (CC `space`), time (SC/FSM `time`), or tape
  (TM `tape`) — which lives in the **codec** (`engine/codec.ts` + `tmCodec.ts`). The old bit-based
  `test_vectors` are gone. **Turbots grade outside the codec**: a turbot's brain is a CC/SC/FSM
  circuit with a fixed 1-bit sensor / 2-bit motor interface, or a **turbot TM** (textbook model:
  internal states do single-action tape ops on the question's encoding's alphabet — binary
  {0,1,*}, unary {0,1}; external states sense B/E/F and move forward/turn; halting is its stop).
  `gradeTurbot` maps the question's `representation` to that notation and runs the brain in each
  `turbot_cases` arena (`engine/turbot.ts` driver loop; turbot-TM tables validated by the
  notation-aware `validateTurbotTM`) and checks
  the case's success criterion (reach-and-stop / pass-through / return-to-start) — positional
  results (`TurbotCaseResult`), not value comparisons. **Perception questions also grade outside
  the codec** (`engine/perception.ts`, `gradePerception`): a CC/SC question with a `perception`
  spec is graded bit-level against `perception_cases` — raw input frames in (one frame per SC
  clock tick; the pre-first-frame "previous input" is the all-zero frame, matching MEM init),
  one output bit compared per step, a case passing iff every step matches
  (`PerceptionCaseResult`). **Open questions aren't autograded at
  all**: the answer travels as `responseText` on the submission and the grader returns a
  `'pending'` result carrying it for manual review (an LLM-grading pass could later replace
  that pending result — the seam is there, not implemented). Submissions **autograde on
  receipt** in `SubmissionStore` and the result is persisted on the record (the exact shape a
  real server endpoint will take).
- **Instructor side** — role-gated `#/instructor` mode: dashboard, assignment editor, a **question
  creator**, and a **gradebook** that reflects stored autogrades, **grouped by student**: one row
  per student showing the **latest** submission's scores (only the latest counts for grading) and a
  per-student attempt count; expanding a student reveals the full submission history with
  failed-case drill-down per attempt (value questions: input/expected/got; turbot questions:
  arena #, steps taken, final pose, failure reason; perception questions: input frames,
  expected/got bit strings, first wrong step; open questions: the full text response,
  marked ✎ and excluded from the auto score). Sample data for all six modes plus the five
  perception problems can be seeded to demo the pipeline.
  The question creator is one shared form authoring **all six modes** (CC/SC/FSM/TM/turbot/open) —
  mode is an ordinary field, not a gate; question names are editable; there is no bit-width field
  and no example-preview table. CC/SC/FSM/TM questions compute exactly **one output**: the
  **Target function** section shows `f(x, y, …) = <formula>` over the declared input-group names,
  with a lightweight live single-input check inline next to it. CC input groups declare a **max
  input value**; SC/FSM/TM have no size field — they're tested on a **sampled** set of values
  across a range of input lengths (`buildQuestionBank` in `engine/testVectorGen.ts`, which also
  derives all group widths). **Turbot questions** replace the formula pipeline with an
  inner-machine picker (CC/SC/FSM/TM), an **encoding** toggle (binary | unary, stored as the
  question's `representation`; it picks a TM brain's internal tape alphabet), a clickable
  **arena editor** (paint blocks/goals, place + rotate the turbot start; resizable up to 20×20;
  helpers in `instructor/arenaEditing.ts`), and a
  success criterion + max-steps pair; goal-directed criteria require a goal cell before save.
  **Perception questions** (CC/SC only) are a "Task" toggle on the same form: pick a rule
  (CC: ≥k run / exactly-k run / exact pattern; SC: change / upward motion), a retina size
  (2–10 wires; a pattern's width is its length), and the bit-level case bank generates at save
  (`buildPerceptionCases`); representation is implicitly binary bits.
  **Open questions** are just a name + question text (no representation, formula, or bank).
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

- **Turbot polish** — the full turbot flow (engine, grader, store, student workspace, instructor
  authoring, gradebook, sample data) shipped 2026-07-05, including the textbook turbot TM
  (internal/external states, single tape actions, B/E/F senses, ↑/↱/↰ motors); FSM brains got
  full 2-bit motor outputs 2026-07-06, and the sample assignment gained a turbot question per
  inner mode the same day. Known follow-ups:
  multi-arena authoring UI (the `turbot_cases` data model already holds a list; the creator
  authors one), and live-linking arena stepping to circuit-edit invalidation (currently the
  student Resets manually after editing mid-run, same as TM).
- **Perception polish** — the CC/SC perception flow (rules, bit-level grading, authoring,
  gradebook drill-down, samples) shipped 2026-07-06. Known follow-ups: a student-facing frame
  player for SC perception (today students hand-enter per-wire input sequences in the normal SC
  timeline to test their circuit), instructor-editable/custom frame sequences for SC banks (the
  battery is fixed), and richer rules (downward/any-direction motion, multi-object scenes).
- **Deferred authoring follow-ups** — the `requireStandardHaltPosition` TM acceptance toggle and
  mode-filtered `allowed_components` (both optional fields on `AssignmentQuestion`, not yet
  exposed in the question creator's editor UI).
- **Open-question grading follow-ups** — a way for the instructor to record a manual score on a
  pending open question (today the gradebook only displays the response), and optional
  LLM-assisted grading: the `pending` `QuestionResult` already carries the `response`, so an
  LLM pass would replace it with a scored result server-side.

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
| Engine        | `app/src/engine/grader.ts`                                                     | `gradeSubmission` / `gradeQuestion` — one value-based codec pipeline for CC/SC/FSM/TM against numeric `test_cases`, plus a separate `gradeTurbot` branch (arena success criteria, not the codec); open questions short-circuit to a `'pending'` result carrying the free-text `response` for manual (later maybe LLM) review          |
| Engine        | `app/src/engine/codec.ts`, `machineValidation.ts`                              | The codec (`space`/`time` value↔bits; `tape` → `tmCodec`) and Stage-1 machine validation for all modes                                     |
| Engine        | `app/src/engine/testVectorGen.ts`, `formulaEval.ts`                            | Authoring-time: affine-formula language → `buildQuestionBank(inputs, outputs, rep, mode)` → `{spec, test_cases}` (widths derived; SC/FSM/TM sampled). Legacy `generateTestCases(spec, rep, mode)` remains for the sample data |
| Engine        | `app/src/engine/representation.ts`, `index.ts`                                 | value↔bits core (`valueToBits`/`isValidCodeword`/`bitsToValue`) + display helpers; barrel exports                                          |
| Engine        | `app/src/engine/turbot.ts`                                                     | Turbot arena driver loop: `senseAhead`(bit)/`senseAheadSymbol`(B/E/F)/`applyMotorCommand`, `runBrainStep`/`initialBrainState` (one transition per call: CC/SC circuit brains, the **turbot FSM** — Mealy transitions with full 2-bit motor outputs `in:ij`, own validator `validateTurbotFSM` — or the **turbot TM** — per-state internal/external kinds, single tape actions, ↑/↱/↰ motor labels, own validator `validateTurbotTM`; internal alphabet per the question's encoding, a `TMNotation` param — binary {0,1,*}, unary {0,1}), and `runTurbot` (`stopped` = motor 00 or a TM halt). `evaluateTurbotCriterion` judges `reach-and-stop` / `pass-through` / `return-to-start` (spec §12.5) |
| Engine        | `app/src/engine/perception.ts`                                                 | Perception (bit-level, outside the codec): `PerceptionRule` evaluators (`hasRunAtLeast`/`hasRunExactly`/`singleObjectAt`/`expectedPerceptionOutputs` — the pre-first-frame "previous input" is the blank frame, "up" = toward IN1), save-time bank generation `buildPerceptionCases` (CC: exhaustive 2^width, width ≤ 10; SC: deterministic frame-sequence battery), `validatePerceptionMachine` (width inputs + 1 output), and `runPerceptionCase` (CC frame eval / SC clocked sequence) |
| Store         | `app/src/store.ts`                                                             | Zustand UI state; delegates simulation to `engine/`. Per-mode sim state incl. TM (`tmTape`/`tmStep`/`setTmCell`) and turbot (`turbotState`/`turbotStep`/`turbotRun`, reset on question load/switch); selectors `selectTmNotation` (TM alphabet: open question's `representation`, sandbox falls back to `repSystem`), `selectTurbotArena`/`selectTurbotInnerMode`, and `selectEffectiveMode` (turbot → the question's `innerMode`; drives every editor-behavior branch), plus `assignmentView` ('overview' \| 'question') and `openResponse`/`setOpenResponse` (the open question's free-text answer, synced into `QuestionCircuit.responseText` at every canvas sync point)  |
| Routing       | `app/src/routing.ts`                                                           | `Route` union, `parseHash`/`routeToHash`, `navigate()`                                                                                     |
| Storage       | `app/src/storage/workbookStore.ts`, `AssignmentStore.ts`, `submissionStore.ts` | The three localStorage-backed seams                                                                                                        |
| Auth          | `app/src/auth/`                                                                | `AuthGate.tsx`, `stubAuth.tsx`, `instructorRole.ts`                                                                                        |
| Assignments   | `app/src/assignments/index.ts`, `cc-basics.json`                               | Bundled registry (`listAssignments`/`getAssignment`) + the one bundled CC assignment                                                       |
| Instructor UI | `app/src/instructor/`                                                          | `InstructorApp`, `InstructorGate`, `InstructorDashboard`, `AssignmentEditor`, `QuestionCreator` (incl. turbot arena editor; pure paint/resize/place helpers in `arenaEditing.ts`), `Gradebook(.ts/View.tsx)`                 |
| Student UI    | `app/src/components/`                                                          | `CircuitCanvas`, `ComponentLibrary`, `DataTable`, `HomeScreen`, `AssignmentOverview` (question list), `MenuBar`, `SequentialTimeline`, `TMTapePanel` (clickable tape), `ArenaCanvas` (shared arena grid renderer), `TurbotArenaPanel` ("Map" + run controls, in the right data panel), `TurbotTapePanel` (turbot TM's read-only internal tape), `OpenResponsePanel` (open question's writing panel; copy/cut/paste/drop blocked), `SimulationPanel`, `TabBar` (question nav bar in assignments) |
| Dev/sample    | `app/src/devData/sampleData.ts`, `seed.ts`                                     | Builders + seeding for demo CC/SC/FSM/TM/turbot/perception/open assignments and submissions                                                                |
| Tools         | `app/tools/grade.ts`, `pipelineCheck.ts`, `codecCheck.ts`, `tmCheck.ts`, `turbotCheck.ts`, `perceptionCheck.ts` | Headless CLI grader, submit→grade pipeline check (all modes, incl. perception and the open question's pending path), codec + rep-core unit checks, TM engine/codec/grader smoke test, turbot engine/grader smoke test, and perception rules/generation/grading smoke test (`npx tsx`)          |

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
   encoding, live-linked internal circuit. _(built: engine + grading + store + UI +
   instructor arena authoring; brain = CC/SC/FSM/TM circuit behind a fixed 1-bit sensor /
   2-bit motor interface)_
5. **Turing Machines** — infinite tape, read/write head, TM transition labels, op cycle.
   _(built: engine + grading + store + UI — FSM-style state editor, `input:action` labels,
   clickable tape strip, machine table / run controls / history)_
6. **TM Turbots** — turbot with TM-based internal circuitry. _(built, per the textbook
   "Turbots: Operation" model: internal (circle) states do single-action {0,1,*} tape ops,
   external (square) states sense B/E/F and move ↑/↱/↰, one transition per time step, blank
   starting tape shown read-only below the canvas, halting = stopping)_

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
- **Turbot encoding is hardcoded** — sensor in: 0 empty, 1 block. Motor out `ij` = the two
  wheel motors (i = left wheel, j = right wheel): 00 stay, 01 right motor on → turn left,
  10 left motor on → turn right, 11 both on → forward.
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
