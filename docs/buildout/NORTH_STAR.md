# North Star — the Making-Minds build-out

_The mission. Rarely edited. If a session wants to change this, stop and ask the human._

## The goal

Make the Making Minds UI able to **construct a machine that solves every
machine-buildable problem in the course** — across every machine type and problem
category in PHIL 133 — and keep it that way. Success is measured concretely: for
each problem in the real homeworks, a person can build a solution in the app and
the real autograder passes it, while the visual vocabulary matches the textbook.

## Definition of done

The finish line is the **Problem Coverage Matrix** ([COVERAGE.md](COVERAGE.md)),
one row per machine-buildable problem in HW1–HW6. A row is **green** when all of:

- **authorable** — the question exists (instructor UI can express it, or it's a
  bundled assignment with correct value-based `test_cases`);
- **buildable** — a reference solution can be constructed in the student UI;
- **grades ✓** — the real `gradeQuestion` passes the correct machine on every
  case AND fails a deliberately-broken variant (adversarial — see the harness);
- **appearance ✓** — the rendering matches [VISUAL_VOCAB.md](VISUAL_VOCAB.md).

The project is done when every row is green and all checks (`npm run coverage`,
`check`, `tsc`, `build`) pass. Reference solutions live as fixtures under
`app/tools/fixtures/reference/` and are the shared source of truth for the
harness and (via export/import) the UI.

## Scope

**In scope** — every arithmetic, perception, and navigation problem that yields a
*constructed machine* across CC, SC, FSM, TM, and turbots (incl. TM-brained), as
enumerated in [COVERAGE.md](COVERAGE.md).

**Out of scope** — problems whose deliverable is prose, a flowchart, an English
function definition, or a proof: HW1 §II–III (functions/representations except the
synthesis machines #16–17), HW3 §III & HW4 §I reflections/state-abstraction essays,
HW5 §III (algorithmic design), HW6 #1 & #3 (flowchart/prose), and all of HW7 (final
essay). These are excluded by design and absent from the matrix.

## The one deliberate visual change

Turing-machine transitions currently use the textbook's dual-action token
`input:action` (e.g. `1:0R`). Switch the UI to the **industry-standard
one-input → two-output** form: one input symbol drives **two separate outputs**,
one for *what to write* and one for *how to move*. The engine already stores
`TMAction {write, move}` separately, so this is a notation/editor/display/migration
change, not an engine rewrite. This is the single place the app intentionally
departs from the textbook; record the departure in VISUAL_VOCAB and spec §10.3.

## Principles that keep it honest

- **The harness is the gate.** No row goes green on assertion — only on a passing
  reference machine + a failing broken variant, run through the real grader.
- **The memos are the only memory.** All durable state lives in `docs/buildout/`,
  the manifest, and fixtures. Any single session is disposable.
- **A task isn't done until its docs are.** Update COVERAGE/QUEUE/LOG/HANDOFF (and
  CLAUDE.md) as part of the task, before reporting it done.
- **Trust but verify.** CLAUDE.md says the five modes are "built." Treat that as a
  claim to be proven by a reference solution, not an assumption.
