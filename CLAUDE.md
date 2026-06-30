# Making Minds — Project Guide

This file is read automatically at the start of every session. It has two parts:
**Part 1 — Project Status** (an overview of what's done and what's left, for humans and
Claude) and **Part 2 — Technical Reference** (architecture, key files, and design rules for
Claude to load into context).

> **Maintenance:** Before pushing or merging a substantive feature, update **Part 1** —
> keep "Where we are now" and "What's next" in sync with what actually shipped, and bump the
> _Last updated_ date below. Update **Part 2** only when the architecture, file layout, or a
> design rule actually changes. When you add a doc under `CLAUDE_KB/`, register it in the
> "Knowledge base" mapping in Part 2 so it stays discoverable.

_Last updated: 2026-06-29_

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

- **Student side** — stub login → browse assignments → open one → per-question canvas in the
  correct mode → instant local autosave → leave and resume (reload/Back returns you into the
  assignment) → Submit a timestamped snapshot.
- **Autograding** — pure headless `engine/` simulators for **CC, SC, FSM**; `grader.ts`
  dispatches on `buildMode` and checks submissions against stored `test_vectors`. Submissions
  **autograde on receipt** in `SubmissionStore` and the result is persisted on the record (the
  exact shape a real server endpoint will take).
- **Instructor side** — role-gated `#/instructor` mode: dashboard, assignment editor, a **CC
  question creator**, and a **gradebook** that reflects stored autogrades (scores, per-question
  pass rates, failed-vector drill-down). Sample CC/SC/FSM data can be seeded to demo the
  pipeline.
- **Reference-function DSL** — instructors don't hand-write test vectors. They declare a
  question's input/output groups and specify the correct output with a small **affine/bitwise
  arithmetic mini-language** (the "reference function"); the system enumerates inputs,
  evaluates the formula, and auto-generates the `test_vectors` at authoring time, with a live
  preview table. See the DSL section in Part 2.

The missing half is the **server** and productized submit/grade loop.

## What's next

**Near-term (still no backend):**

- **TM grading** — no TM simulation engine yet; `grader.ts` skips TM cleanly until one exists.
- **SC/FSM/TM authoring** — the QuestionCreator is CC-only (other modes show "coming soon");
  SC/FSM assignments are seeded directly rather than authored.

**The backend phase (the big step):**

- **Real auth** — replace the stub with UCLA SSO; student vs. instructor roles from the token.
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

## Knowledge base — read before working on a feature

Deeper technical specs live under `CLAUDE_KB/` and are loaded **on demand**, not every session.
Before starting on an area below, read the listed docs first. (See `CLAUDE_KB/README.md` for
the layout and conventions.)

| When working on… | Read |
| ---------------- | ---- |
| Anything in `engine/` (orientation) | `CLAUDE_KB/engines/overview.md` |
| Combinatorial circuits — gates, canvas eval, boxed circuits | `CLAUDE_KB/engines/overview.md`, `CLAUDE_KB/engines/cc.md` |
| Sequential circuits — MEM, clock, timing | `CLAUDE_KB/engines/overview.md`, `CLAUDE_KB/engines/cc.md`, `CLAUDE_KB/engines/sc.md` |
| Finite state machines — states, transitions | `CLAUDE_KB/engines/overview.md`, `CLAUDE_KB/engines/fsm.md` |
| Turing machines (not yet built — design notes) | `CLAUDE_KB/engines/overview.md`, `CLAUDE_KB/engines/tm.md` |
| Autograder, test-vector format, grading bugs | `CLAUDE_KB/engines/grading.md` + the relevant per-mode doc |
| Instructor authoring / reference-function DSL | `CLAUDE_KB/engines/grading.md` + "Reference-function DSL" below |

## Architecture principle: seams

Every external dependency sits **behind an interface**, so the no-backend prototype becomes a
server-backed product by swapping implementations — not rewriting the UI. **Route new features
through these seams, not around them.**

| Seam        | Interface                        | Today (prototype)                            | Later (product)            |
| ----------- | -------------------------------- | -------------------------------------------- | -------------------------- |
| Evaluation  | `engine/` (pure, headless)       | runs in browser                              | same code grades on server |
| Grading     | `engine/grader.ts`               | grades on receipt in `SubmissionStore`       | server grades on submit    |
| Identity    | `src/auth/` (stub)               | stub user; sessionStorage instructor role    | real SSO + role claim      |
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
| Engine        | `app/src/engine/grader.ts`                                                     | `gradeSubmission` / `gradeQuestion` — dispatch on `buildMode`, compare against `test_vectors`; TM/turbot skipped                           |
| Engine        | `app/src/engine/testVectorGen.ts`, `formulaEval.ts`                            | Authoring-time: affine-formula language → generated CC test vectors                                                                        |
| Engine        | `app/src/engine/representation.ts`, `index.ts`                                 | Bit encoding/decoding; barrel exports                                                                                                      |
| Store         | `app/src/store.ts`                                                             | Zustand UI state; delegates simulation to `engine/`                                                                                        |
| Routing       | `app/src/routing.ts`                                                           | `Route` union, `parseHash`/`routeToHash`, `navigate()`                                                                                     |
| Storage       | `app/src/storage/workbookStore.ts`, `AssignmentStore.ts`, `submissionStore.ts` | The three localStorage-backed seams                                                                                                        |
| Auth          | `app/src/auth/`                                                                | `AuthGate.tsx`, `stubAuth.tsx`, `instructorRole.ts`                                                                                        |
| Assignments   | `app/src/assignments/index.ts`, `cc-basics.json`                               | Bundled registry (`listAssignments`/`getAssignment`) + the one bundled CC assignment                                                       |
| Instructor UI | `app/src/instructor/`                                                          | `InstructorApp`, `InstructorGate`, `InstructorDashboard`, `AssignmentEditor`, `QuestionCreator`, `Gradebook(.ts/View.tsx)`                 |
| Student UI    | `app/src/components/`                                                          | `CircuitCanvas`, `ComponentLibrary`, `DataTable`, `HomeScreen`, `MenuBar`, `SequentialTimeline`, `SimulationPanel`, `TabBar`               |
| Dev/sample    | `app/src/devData/sampleData.ts`, `seed.ts`                                     | Builders + seeding for demo CC/SC/FSM assignments and submissions                                                                          |
| Tools         | `app/tools/grade.ts`, `pipelineCheck.ts`                                       | Headless CLI grader and submit→grade pipeline check (`npx tsx`)                                                                            |

## Reference-function DSL (instructor authoring)

Instructors specify _what a student circuit must compute_ with a small arithmetic
mini-language instead of writing test vectors by hand. This is an authoring-time convenience
only — the grader never sees the formula; it runs against the generated `test_vectors`.

- **Where it lives** — `engine/formulaEval.ts` (`evalFormula(expr, vars)` → non-negative
  integer; throws `FormulaError`) and `engine/testVectorGen.ts` (enumerates input
  combinations, evaluates the formula, encodes outputs → `test_vectors`). The instructor UI
  (`instructor/QuestionCreator.tsx`, with `instructor/ccPreview.ts`) renders a **live preview
  table** and blocks save on any formula error.
- **The language** — variables (declared input-group names like `x`, `y`), non-negative
  integer literals, and the operators `+ - *` and bitwise `& | ^ ~`, with parentheses. No
  division, modulo, conditionals, or function calls. Each formula is one expression returning a
  single non-negative integer.
- **Width is the implicit modulus** — the output group's bit width truncates the result to its
  least-significant bits, so an instructor writes `x + y` with a 1-bit output to mean XOR, or a
  2-bit output to also get the carry. No explicit `% 2` needed.
- **Encoding** — each input/output group is **binary or unary**; this governs how bit groups
  decode to the integer the formula receives and how the result re-encodes to output wires.
- **Today CC only.** SC/FSM/TM authoring via the DSL is not implemented; their sample
  assignments are seeded directly (see `devData/`). The grader already supports SC/FSM.
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
- **MEM block** — M_OUT (left) feeds the stored value in; M_IN (right) receives the new value.
  All memory initializes to 0; display the stored value during simulation.
- **Input labels** — assigned at creation and permanent; new inputs get the next sequential
  number regardless of vertical position.
- **Turbot encoding is hardcoded** — sensor in: 0 empty, 1 block. Motor out: 00 stop, 01
  left, 10 right, 11 forward.
- **CC evaluation** — topological sort for gate order; propagation is instantaneous.
- **Homework JSON** (spec §1.5) carries `test_vectors`; the grader compares student outputs
  against expected.

## Things to watch

- **Test vectors must not ship to the client in production.** Bundled assignment JSON today
  includes `test_vectors` (the answers) — fine for the prototype, where grading happens inside
  the `SubmissionStore` seam. In the product, split assignments into a client part (statements,
  modes) and a server-only part (test vectors); the server grades on submit.
- **localStorage is a stopgap** — per-browser, per-device, ~5 MB. The `WorkbookStore` /
  `AssignmentStore` / `SubmissionStore` seams are exactly the boundaries a server replaces.
