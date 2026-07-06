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

## Building fixtures by running the app

The most reliable way to produce `correct` machine JSON is to build the solution
in the running app and export it, rather than hand-authoring component/port/wire
ids. Keep the exported `CircuitData` and pair it with the authored `question`.
