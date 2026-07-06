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
- **`correct`** — a machine that a student could build in the UI and that the
  real grader (`gradeQuestion`) passes on **every** case.
- **`broken`** — a plausible-but-wrong machine that the grader **must fail**. This
  is what makes the check adversarial; a fixture without it is treated as a
  regression (a grader that passes everything proves nothing). Required.

## Naming

`<row-id>.json`, matching the `id` in `coverage-manifest.json` (e.g. `hw2-p1.json`).
Wire the path into that row's `"fixture"` field, relative to `tools/fixtures/`
(e.g. `"reference/hw2-p1.json"`).

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
