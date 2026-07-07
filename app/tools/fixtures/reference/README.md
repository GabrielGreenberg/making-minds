# Reference solution fixtures

Each file here is a **self-contained reference solution** for one course problem,
consumed by the coverage harness (`app/tools/coverageCheck.ts`). The loop writes
these; a problem's COVERAGE row only turns green once its fixture exists and the
harness's adversarial assertions pass.

## Format

```jsonc
{
  "question": { /* an AssignmentQuestion (see app/src/types.ts) */ },
  "correct":  { "components": [ /* CircuitComponent[] */ ], "wires": [ /* Wire[] */ ] },
  "broken":   { "components": [ ... ], "wires": [ ... ] }   // deliberately wrong
}
```

- **`question`** — the authored problem: `buildMode`, `representation`, `cc_spec`
  (group widths), and `test_cases` (value-based `{inputs, outputs}`). For
  navigation (turbot) questions, use `innerMode` + `turbot_cases` instead of
  `cc_spec`/`test_cases`.
  - TM cases may carry an optional `separations: number[]` layout hint — the
    background gap AFTER each input block except the last (for two inputs, one
    entry; absent = the standard single-cell separator). Use it when the
    statement demands robustness to arbitrary block separation (hw5-p4 spreads
    gaps 1/2/3/5 across its bank so a gap=1-only machine fails). Other axes
    ignore the field.
- **`correct`** — a machine that a student could build in the UI and that the
  real grader (`gradeQuestion`) passes on **every** case.
- **`broken`** — a plausible-but-wrong machine that the grader **must fail**. This
  is what makes the check adversarial; a fixture without it is treated as a
  regression (a grader that passes everything proves nothing). Required.

## Naming

`<row-id>.json`, matching the `id` in `coverage-manifest.json` (e.g. `hw2-p1.json`).
Wire the path into that row's `"fixture"` field, relative to `tools/fixtures/`
(e.g. `"reference/hw2-p1.json"`).

## Hardening bars (what the harness checks beyond pass/fail)

Every wired fixture also runs through four bars in `coverageCheck.ts`:

- **Broken-breadth (WARN)** — the ledger prints each row's broken-fail fraction
  (`failed / bank size`). On SAMPLED banks (SC/FSM/TM) a fraction **< 25%** gets a
  WARN — a broken variant that trips almost none of a sample isn't proving much.
  Exhaustive CC banks print the fraction as info only (a narrow near-miss like
  hw2-p6's 1/16 is legitimate when the whole input space is tested). Warnings
  never change row state or the exit code.
- **Drain coverage (WARN, SC/FSM)** — if the question's output width exceeds its
  input width, the bank must contain at least one case whose expected output
  (encoded on the codec's time axis) has a nonzero bit at a step >= the input
  width — i.e. a case that only passes if the machine emits during drain steps.
- **Statement lint (hard FAIL)** — `question.statement` must be clean prose:
  non-empty, no ledger-shorthand prefix ("2x B. …"), no answer-giveaway
  parenthetical ("(It is possible…", "(Yes,…").
- **Layout oracle (hard FAIL, CC/SC rows)** — `tools/layoutCheck.ts` routes both
  machines through the app's real wire router with CircuitCanvas's exact port
  geometry and rejects different-source collinear/near-parallel wire overlaps,
  wires through foreign component bodies, and overlapping component boxes.
  Check a fixture standalone with `npx tsx tools/layoutCheck.ts <fixture.json>`.
  (FSM/TM/turbot STATE curves bypass the router — those rows are skipped.)

## Navigation generality

Problems with unknown distances/positions (Mad Max, Way Finder, Desert Ant) are
only proven by a **family** of arenas. Put several arenas in
`question.turbot_cases`; the grader requires all of them to pass, so a solution
that only works for one layout will fail the fixture.

## Authoring fixtures headlessly (the primary path — no browser)

Machines are plain JSON and the engine is pure, so author fixtures **in code**
and verify them with the real grader before writing the file:

1. Import the helpers from `app/tools/builder.ts` (`comp`, `wire`, `transition`,
   `circuit`) — the same pattern as `src/devData/sampleData.ts`, which has
   canonical programmatic machines for all five modes.
2. Build `correct` and `broken`, author the `question`, and check them in the
   same script: `gradeQuestion(question, correct)` must pass every case and
   `gradeQuestion(question, broken)` must not. Run it with `npx tsx` from `app/`.
3. Write the fixture JSON only once the script proves both assertions.

Give components real grid positions (left→right flow, ~160px column spacing) so
the same fixture also loads cleanly in the UI for the appearance check — grading
ignores positions, rendering doesn't.

The running app remains a fallback: build a machine in the UI and export its
`CircuitData` if a diagram is easier to draw than to code (large layouts,
tricky wiring).
