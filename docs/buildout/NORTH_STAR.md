# North Star — the Making-Minds build-out

_The mission. Rarely edited. If a session wants to change this, stop and ask the human._

## The goal

Make the Making Minds UI able to **construct a machine for every
machine-buildable problem in the course** — across every machine type and problem
category in PHIL 133 — and keep it that way. Success is measured concretely: for
each problem in the real homeworks, a person can build a **plausible solution
attempt** in the app and the real autograder runs it end-to-end, while the visual
vocabulary matches the textbook.

**Interface first, correctness later (user directive 2026-07-06).** What matters
now is that the *interface* exists — that a TM, a turbot, a perception question
can be authored, built, simulated, and graded. Producing exactly-correct answers
to every homework problem is a **separate, future project**. Do not spend large
token budgets hunting correct solutions; a good-faith plausible attempt that
exercises the full pipeline is the bar (see the two verification tiers below).

## Central design principle — depth over patches

Prefer **unified, deep, architectural solutions that capture a whole family of
related phenomena** over superficial, surgical patches. When a task exposes a
problem, ask what *class* of problems it belongs to and, whenever reasonable,
choose the deepest solution that also improves the app. The codebase already
works this way — the seams, and the one value-based codec pipeline instead of
five per-mode graders — continue in that grain.

For every non-trivial task:

- **Name the family.** What related phenomena share this problem's shape?
  (The FSM-turbot's 1-bit motor is one instance of "transition outputs are
  single-bit everywhere"; the TM `1:0R` token is one instance of "per-mode
  transition grammars are string conventions scattered through the canvas";
  perception authoring is one instance of "a question's target function has
  exactly one representation — an arithmetic formula".)
- **Choose depth deliberately.** State the shallow fix and the deep fix; pick
  the deepest one *warranted by real phenomena* (course problems, COVERAGE
  rows, named follow-ups) — not speculative generality.
- **Route through the seams** (pure engine / store / UI separation, the codec),
  never around them. A deep solution that bypasses a seam is a deep patch.
- **Big moves get a design memo first.** Before implementing a significant
  architectural change, write `docs/buildout/designs/<slug>.md`: problem family
  → options with depths → chosen solution → blast radius. Later sessions follow
  the reasoning, not just the diff.

**Convergence guardrail** (this loop runs unattended): depth must land. A deep
solution ships with the harness green in the same arc; if it can't reach green
within an iteration or two, split it — land the architectural seam first,
migrate callers next. Depth is measured by phenomena captured, not lines moved.

## Definition of done

The finish line is the **Problem Coverage Matrix** ([COVERAGE.md](COVERAGE.md)),
one row per machine-buildable problem in HW1–HW6. A row is **green** when all of:

- **authorable** — the question exists (instructor UI can express it, or it's a
  bundled assignment with correct value-based `test_cases`);
- **buildable** — a reference machine can be constructed in the student UI;
- **grades ✓** — at the row's **tier** (below);
- **appearance ✓** — the rendering matches [VISUAL_VOCAB.md](VISUAL_VOCAB.md).

**Two verification tiers** (harness-enforced via `tier` in the manifest):

- **exact** — the reference machine passes every case AND a deliberately-broken
  variant fails. The bar for arithmetic (already met, 41 rows); those rows stay
  exact as regression pins.
- **interface** — the fixture's machine is a **plausible attempt**: it must pass
  Stage-1 validation (the editor/engine can express a well-formed machine of
  this shape) and grade end-to-end to per-case results; its score is reported,
  **not asserted**, and no broken variant is required. The bar for all
  perception and navigation rows. Statement lint and the layout oracle still
  apply — they are interface quality.

**The project is done when every row is green at its tier** and all checks
(`npm run coverage`, `check`, `tsc`, `build`) pass. Upgrading interface rows to
exact (a correct Way Finder, a correct Desert Ant…) is the future
**correct-answers project** — explicitly out of scope here. Reference solutions live as fixtures under
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

The textbook writes Turing-machine transitions as a dual-action token
`input:action` (e.g. `1:0R`). The platform instead uses the **industry-standard
one-input → two-output** form _(landed, P2.1)_: one input symbol drives **two
separate outputs**, one for *what to write* and one for *how to move* — stored
`read:write,move` (`1:0,R`), rendered as two labeled output fields; the legacy
token parses forever as an alias and decays on edit-save. The engine stores
`TMAction {write, move}` separately, so this was a notation/editor/display
change, not an engine rewrite. This is the single place the app intentionally
departs from the textbook; the departure is recorded in VISUAL_VOCAB §TM and
spec §10.3.

## Principles that keep it honest

- **The harness is the gate.** No row goes green on assertion — only on a passing
  reference machine + a failing broken variant, run through the real grader.
- **The memos are the only memory.** All durable state lives in `docs/buildout/`,
  the manifest, and fixtures. Any single session is disposable.
- **A task isn't done until its docs are.** Update COVERAGE/QUEUE/LOG/HANDOFF (and
  CLAUDE.md) as part of the task, before reporting it done.
- **Trust but verify.** CLAUDE.md says the five modes are "built." Treat that as a
  claim to be proven by a reference solution, not an assumption.
