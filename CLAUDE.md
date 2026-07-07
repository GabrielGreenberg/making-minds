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

_Last updated: 2026-07-06 (**P2.3 — standard-halt-position toggle wired end-to-end** —
`requireStandardHaltPosition` is now an optional field on `AssignmentQuestion`; the grader's
tape branch passes it into `acceptTM` (absent/false = position-agnostic, unchanged), and the
question creator exposes it as a TM-only checkbox that round-trips through save/load. HW5
fixtures p1–p8 — whose statements promise standard-position halting — are flagged (p9's does
not); all stay verified, and hw5-p8's broken variant now fails 16/16 (was 15/16: one case
slipped through only because position was unenforced). tmCheck pins the flag end-to-end
through `gradeQuestion` (off-position machine passes without the flag, fails every case with
it; a standard-position machine passes with it). Earlier same day: **P2.1 — TM two-output
notation** — TM transition labels moved
off the textbook's dual-action token (`1:0R`) to the industry-standard **two-output form**
`read:write,move` (stored `1:0,R`; canvas renders read │ write,move with the comma shown;
the label editor presents one input field + two output fields (write, move); the machine
table gains separate WRITE/MOVE columns; history shows `1,R`) — the platform's ONE
deliberate departure from the textbook, recorded in spec §10.3 and VISUAL_VOCAB §TM. The
grammar now lives natively in `engine/notation.ts` (`tmNotation(rep)` — replacing the
delegating `tmDualNotation` adapter; alphabet still representation-tied, `*` only on
binary); the legacy dual-action spelling parses FOREVER as an alias and decays to canonical
on any edit-save, so old localStorage machines keep working with no migration (devData's TM
sample migrated to canonical anyway). `parseTMTransition`/`parseTMAction` are gone from
`engine/tm.ts` — the engine parses through the seam — and `validateTMTable` folded onto the
generic `validateTransitionTable` walker (which now carries a `kind`:
unparseable/ambiguous/missing), preserving its error shape. Engine SEMANTICS are unchanged:
every transition still writes and moves as one atomic step. notationCheck pins the new
grammar (canonical corpus, alias≡canonical, decay, `*` binary-only, outputFields contract)
and its grep gate no longer whitelists tm.ts; tmCheck gained legacy-alias engine-equivalence
pins. Earlier same day: **FSM arc-rendering fix** — opposite-direction transition
pairs (S₀→S₁ and S₁→S₀) now auto-offset into two separated arcs (each bows left of its
own travel direction, distance-scaled); previously both curves computed to the same
control point and rendered coincident with superimposed labels. Explicit `fsmControlPt`
still wins; self-loop fanning and same-direction parallel stacking unchanged. Earlier
same day: **Transition-notation seam + k-bit FSM (P1.12)** — new
framework-agnostic `engine/notation.ts` owns transition-label SYNTAX for all four grammars
(FSM, base-TM, turbot-TM internal/external) behind one `TransitionNotation`
interface: parse / canonical format / input alphabet / editor token fields / default label.
FSM is k-bit capable — `fsmNotation(inBits, outBits)`, symbol char i = cc_spec group i — so
multi-input FSM questions (hw4-p11 `x+y`) now validate (totality over all 2^kIn symbols,
kIn ≤ 3), grade (the grader feeds the FULL encoded row per step, not wire 0), and run in the
UI (question runs join the row into one k-char symbol; the label editor enters symbols one
character at a time for every grammar). TM/turbot parsers are unchanged behind delegating
adapters; `turbotFsmNotation` is the single validity answer for turbot-FSM brain labels
(legacy 1-bit outputs alias to the canonical 2-bit motor form and decay on edit-save;
`runBrainStep` decodes both identically). Also folded in **P1.10**: the sandbox FSM feed now
consumes typed input rightmost-char-first (t1), matching SC. `tools/notationCheck.ts` (in
`npm run check`) pins adapter≡parser equivalence, legacy byte-compat, an asymmetric `x + 2*y`
bit-order grade, and a grep gate keeping label dissection inside the seam. Earlier same day:
**SC/FSM question runs mirror the grader exactly — window AND content** — inside an assignment question, Run/Step execute exactly the grader's `stepCountFor`
window and feed exactly the grader's input stream: the typed global input is parsed as a
**value** per input group (exactly how the A/V ARG column reads it — tally "11" = 2, binary
"110" = 6) and laid on the time axis by the codec's `encodeInput` (LSB at t1, so a tally
value's ones arrive LAST, zeros leading) in `scStep`/`fsmStep` via the store's
`selectCodecLayout`; the SC A/V numeral decodes only the grader's window per output group
(`timeOutputBits`). What the student types is the value the grader tests, and UI verdicts
match grades in **both representations**. Note this changes FSM question-run typed input: it
is now read as a **numeral** (MSB-left, "110" = 6) like SC and the ARG column — previously it
was fed t1-first raw; sandbox FSM is unchanged. The FSM Input/Output row's OUT display now
also renders t1-rightmost (time flows right-to-left, matching SC) via the pure builder
`components/outputDisplay.ts`, so a passing identity's OUT reads as the same numeral as its
typed IN. A typed string that is not a valid numeral for the
representation (tally "101") denotes no value: the run falls back to the raw typed bits and
the ARG column flags it '/'; values wider than a group clamp/mask via `valueToBits` as
everywhere else. Sandbox behavior is unchanged (raw typed bits; SC: L + one 0-drain step per
MEM; FSM: L). Pinned by `tools/scWindowCheck.ts` (grader + real-store headless runs, incl. the
real hw3-p7 tally fixture's correct machine), part of `npm run check`. Earlier 2026-07-05: a
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
  TM-brained turbots additionally show their internal tape read-only below the canvas) →
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
  internal states do single-action tape ops on {0,1,*}; external states sense B/E/F and move
  forward/turn; halting is its stop). `gradeTurbot` runs the brain in each `turbot_cases` arena
  (`engine/turbot.ts` driver loop; turbot-TM tables validated by `validateTurbotTM`) and checks
  the case's success criterion (reach-and-stop / pass-through / return-to-start) — positional
  results (`TurbotCaseResult`), not value comparisons. Submissions **autograde on receipt** in
  `SubmissionStore` and the result is persisted on the record (the exact shape a real server
  endpoint will take).
- **Instructor side** — role-gated `#/instructor` mode: dashboard, assignment editor, a **question
  creator**, and a **gradebook** that reflects stored autogrades, **grouped by student**: one row
  per student showing the **latest** submission's scores (only the latest counts for grading) and a
  per-student attempt count; expanding a student reveals the full submission history with
  failed-case drill-down per attempt (value questions: input/expected/got; turbot questions:
  arena #, steps taken, final pose, failure reason). Sample data for all five modes can be seeded
  to demo the pipeline.
  The question creator is one shared form authoring **all five modes** (CC/SC/FSM/TM/turbot) —
  mode is an ordinary field, not a gate; question names are editable; there is no bit-width field
  and no example-preview table. CC/SC/FSM/TM questions compute exactly **one output**: the
  **Target function** section shows `f(x, y, …) = <formula>` over the declared input-group names,
  with a lightweight live single-input check inline next to it. CC input groups declare a **max
  input value**; SC/FSM/TM have no size field — they're tested on a **sampled** set of values
  across a range of input lengths (`buildQuestionBank` in `engine/testVectorGen.ts`, which also
  derives all group widths). **Turbot questions** replace the formula pipeline with an
  inner-machine picker (CC/SC/FSM/TM), a clickable **arena editor** (paint blocks/goals, place +
  rotate the turbot start; resizable up to 20×20; helpers in `instructor/arenaEditing.ts`), and a
  success criterion + max-steps pair; goal-directed criteria require a goal cell before save.
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
  (internal/external states, single tape actions, B/E/F senses, ↑/↱/↰ motors). Known follow-ups:
  multi-arena authoring UI (the `turbot_cases` data model already holds a list; the creator
  authors one), an FSM-brain motor encoding richer than stop/forward (a single Mealy output bit
  can't express turns — see `runBrainStep` in `engine/turbot.ts`), a sample TM-turbot question
  in devData, and live-linking arena stepping to circuit-edit invalidation (currently the
  student Resets manually after editing mid-run, same as TM).
- **Deferred authoring follow-ups** — mode-filtered `allowed_components` (an optional field on
  `AssignmentQuestion`, not yet exposed in the question creator's editor UI). The
  `requireStandardHaltPosition` TM acceptance toggle is done (2026-07-06): wired end-to-end
  through `gradeQuestion` and exposed as a TM-only checkbox in the question creator.

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
| Engine        | `app/src/engine/tm.ts`, `tmValidate.ts`, `tmCodec.ts`                          | TM: notation-aware tape engine — **two-output** labels `read:write,move` (e.g. `1:0,R`; legacy `1:0R` parses as an alias), executed as one **atomic step** (every transition writes a symbol AND moves; grammar lives in `engine/notation.ts`); pre-engine table validation (ambiguous/unparseable, via the generic walker); encode/accept/decode (the codec `tape` axis; accept honors the question's optional `requireStandardHaltPosition` — head must halt on the output block's rightmost cell)          |
| Engine        | `app/src/engine/grader.ts`                                                     | `gradeSubmission` / `gradeQuestion` — one value-based codec pipeline for CC/SC/FSM/TM against numeric `test_cases`, plus a separate `gradeTurbot` branch (arena success criteria, not the codec)          |
| Engine        | `app/src/engine/codec.ts`, `machineValidation.ts`                              | The codec (`space`/`time` value↔bits; `tape` → `tmCodec`) and Stage-1 machine validation for all modes                                     |
| Engine        | `app/src/engine/testVectorGen.ts`, `formulaEval.ts`                            | Authoring-time: affine-formula language → `buildQuestionBank(inputs, outputs, rep, mode)` → `{spec, test_cases}` (widths derived; SC/FSM/TM sampled). Legacy `generateTestCases(spec, rep, mode)` remains for the sample data |
| Engine        | `app/src/engine/notation.ts`                                                   | Transition-label SYNTAX seam: `TransitionNotation` (parse/format/alphabet/editor token fields/default) for all four grammars — native k-bit `fsmNotation(inBits,outBits)` + `turbotFsmNotation` (1-bit alias → canonical 2-bit motor, decays on edit-save); TM/turbot grammars delegate to their engine parsers; generic `validateTransitionTable` walker. Label dissection is allowed ONLY here + the delegated parsers (notationCheck grep gate)  |
| Engine        | `app/src/engine/representation.ts`, `index.ts`                                 | value↔bits core (`valueToBits`/`isValidCodeword`/`bitsToValue`) + display helpers; barrel exports                                          |
| Engine        | `app/src/engine/turbot.ts`                                                     | Turbot arena driver loop: `senseAhead`(bit)/`senseAheadSymbol`(B/E/F)/`applyMotorCommand`, `runBrainStep`/`initialBrainState` (one transition per call: CC/SC/FSM circuit brains, or the **turbot TM** — per-state internal/external kinds, single tape actions, ↑/↱/↰ motor labels, own validator `validateTurbotTM`), and `runTurbot` (`stopped` = motor 00 or a TM halt). `evaluateTurbotCriterion` judges `reach-and-stop` / `pass-through` / `return-to-start` (spec §12.5) |
| Store         | `app/src/store.ts`                                                             | Zustand UI state; delegates simulation to `engine/`. Per-mode sim state incl. TM (`tmTape`/`tmStep`/`setTmCell`) and turbot (`turbotState`/`turbotStep`/`turbotRun`, reset on question load/switch); selectors `selectTmNotation` (TM alphabet: open question's `representation`, sandbox falls back to `repSystem`), `selectTurbotArena`/`selectTurbotInnerMode`, and `selectEffectiveMode` (turbot → the question's `innerMode`; drives every editor-behavior branch), plus `assignmentView` ('overview' \| 'question')  |
| Routing       | `app/src/routing.ts`                                                           | `Route` union, `parseHash`/`routeToHash`, `navigate()`                                                                                     |
| Storage       | `app/src/storage/workbookStore.ts`, `AssignmentStore.ts`, `submissionStore.ts` | The three localStorage-backed seams                                                                                                        |
| Auth          | `app/src/auth/`                                                                | `AuthGate.tsx`, `stubAuth.tsx`, `instructorRole.ts`                                                                                        |
| Assignments   | `app/src/assignments/index.ts`, `cc-basics.json`                               | Bundled registry (`listAssignments`/`getAssignment`) + the one bundled CC assignment                                                       |
| Instructor UI | `app/src/instructor/`                                                          | `InstructorApp`, `InstructorGate`, `InstructorDashboard`, `AssignmentEditor`, `QuestionCreator` (incl. turbot arena editor; pure paint/resize/place helpers in `arenaEditing.ts`), `Gradebook(.ts/View.tsx)`                 |
| Student UI    | `app/src/components/`                                                          | `CircuitCanvas`, `ComponentLibrary`, `DataTable`, `HomeScreen`, `AssignmentOverview` (question list), `MenuBar`, `SequentialTimeline`, `TMTapePanel` (clickable tape), `ArenaCanvas` (shared arena grid renderer), `TurbotArenaPanel` ("Map" + run controls, in the right data panel), `TurbotTapePanel` (turbot TM's read-only internal tape), `SimulationPanel`, `TabBar` (question nav bar in assignments) |
| Dev/sample    | `app/src/devData/sampleData.ts`, `seed.ts`                                     | Builders + seeding for demo CC/SC/FSM/TM/turbot assignments and submissions                                                                |
| Tools         | `app/tools/grade.ts`, `pipelineCheck.ts`, `codecCheck.ts`, `notationCheck.ts`, `tmCheck.ts`, `turbotCheck.ts`, `scWindowCheck.ts`, `coverageCheck.ts`, `layoutCheck.ts` | Headless CLI grader, submit→grade pipeline check (all five modes), codec + rep-core unit checks, the transition-notation seam check (adapter≡parser equivalence, legacy byte-compat, k=2 asymmetric bit-order grade pin, arity/totality errors, label-dissection grep gate), TM engine/codec/grader smoke test, turbot engine/grader smoke test (incl. the turbot-FSM one-notation validity pins), the SC/FSM question-run contract check (grader window length + codec input-stream content parity, via real-store headless runs incl. the hw3-p7 fixture and a k=2 FSM store-run≡grader pin), the reference-fixture coverage harness (verified/pending ledger + breadth/drain warnings + statement lint), and the canvas layout oracle (real `routeAllWires` route prediction: collinear/near-parallel overlaps, body crossings, box collisions; CLI + used by the harness for CC/SC fixtures) (`npx tsx`)          |

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
   _(built: engine + grading + store + UI — FSM-style state editor, two-output
   `read:write,move` labels (the platform's one deliberate textbook departure, spec §10.3),
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
- **SC/FSM question runs are the grader's runs** — inside an assignment question, Run/Step
  execute exactly the grader's run length (`stepCountFor` = max(input widths, output widths)
  time steps) AND feed exactly the grader's input stream: the typed global input is parsed as
  a **value** per input group (as the A/V ARG column reads it — tally "11" = 2) and laid on
  the time axis by the codec's `encodeInput` (LSB at t1 — a tally value's ones arrive last,
  zeros leading), and the SC A/V numeral decodes only the grader's window per output group.
  What the student types is the value the grader tests; the UI verdict matches the grade in
  both representations (`selectCodecLayout`/`selectCodecWindow` in the store; pinned by
  `tools/scWindowCheck.ts`, incl. the real hw3-p7 tally fixture). Typed input that is not a
  valid numeral for the representation (tally "101") runs on the raw typed bits and is flagged
  '/' in ARG. The per-MEM flush rule — after the typed input is consumed, Run continues for
  one 0-input drain step per MEM so delayed bits (a serial adder's final carry) reach the
  output — applies only to **sandbox** SC runs (which feed raw typed bits); sandbox FSM runs
  stop at the typed length L.
- **MEM block** — M_OUT (left) feeds the stored value in; M_IN (right) receives the new value.
  All memory initializes to 0; display the stored value during simulation.
- **Input labels** — assigned at creation and permanent; new inputs get the next sequential
  number regardless of vertical position.
- **Turbot encoding is hardcoded** — sensor in: 0 empty, 1 block. Motor out `ij` = the two
  wheel motors (i = left wheel, j = right wheel): 00 stay, 01 right motor on → turn left,
  10 left motor on → turn right, 11 both on → forward.
- **CC evaluation** — topological sort for gate order; propagation is instantaneous.
- **Homework JSON** (spec §1.5) carries numeric `test_cases` (`{inputs, outputs}` of values); the
  codec encodes/decodes per axis and the grader compares decoded outputs to expected. TM
  questions may additionally set `requireStandardHaltPosition: true` (authored via a TM-only
  checkbox in the question creator) to reject runs whose head does not halt on the output
  block's rightmost cell; absent/false, acceptance is position-agnostic.

## Things to watch

- **Test cases must not ship to the client in production.** Bundled assignment JSON today
  includes `test_cases` (the answers) — fine for the prototype, where grading happens inside
  the `SubmissionStore` seam. In the product, split assignments into a client part (statements,
  modes) and a server-only part (test cases); the server grades on submit.
- **localStorage is a stopgap** — per-browser, per-device, ~5 MB. The `WorkbookStore` /
  `AssignmentStore` / `SubmissionStore` seams are exactly the boundaries a server replaces.
