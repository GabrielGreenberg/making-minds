# Handoff — the hot state

_Read this first. It says exactly where we are and what to do next. Rewrite it at
the end of every iteration. If it conflicts with the harness, the harness wins —
run `npm run coverage` and reconcile._

## Where we are

Branch `buildout-infra`. **HW1 is done: 7 / 56 verified**, 49 pending, 0
regressed. The workflow shape for fixture batches is proven (see LOG iteration 2):
spec-from-PDF → parallel build+prove → single manifest-wire agent → parallel
adversarial verifiers + gates + appearance sweep → completeness critic. Fixture
authoring template: LOG 2026-07-06 (iteration 1) + the gotchas in iteration 2.

## Do this next — P1.2: HW2 CC arithmetic (hw2-p1…p7)

Seven CC arithmetic fixtures, same workflow shape as P1.1. Notes:

- Spec agent reads `problem sets/hw2.pdf` for exact statements/functions of
  p1…p7 (manifest row descriptions are the cross-check; PDF wins).
- Multi-bit input/output groups arrive here: the codec slices **IN1/OUT1 = most
  significant**; the canonical broken variant is an endianness swap (see
  hw1-p17). CC input groups need `max_value`; widths are derived, outputs never
  truncated (carry is kept — `x + y` on 2-bit inputs has a 3-bit output group).
- **Tally problems:** the platform accepts only canonical 1s-then-0s codewords
  even though the textbook's `tal()` is position-insensitive — correct circuits
  must emit canonical form (see LOG iteration 2, hw1-p16).
- DSL formulas: no `~` (negative risk); use `x ^ 1` for NOT, `+ - * & | ^`.
- Broken variants must be **functionally** wrong near-misses
  (`allowed_components` is unenforced until P1.5 lands).

**Acceptance:** `npm run coverage` → 14/56 verified (HW1 7 + HW2 arithmetic 7);
COVERAGE rows fully ✅ incl. appearance; gates green (`npm run check`, `tsc`,
`build`).

## Then

P1.3 (HW3 SC arithmetic, hw3-p1…p9 — pipeline-drain behaviour on carries) →
P1.4 (HW4 FSM) → P1.5 (enforce `allowed_components`, discovered work) → Phase 2
(TM two-output notation, design memo first).

## Watch out for

- **Depth over patches** (NORTH_STAR): P1.2 is template-stamping. P2.1/P3.1/P4.1
  carry deep framings in QUEUE — design memo before implementation.
- **Delegate to survive:** run the batch as a Workflow; keep only conclusions in
  the driving session. ~17 agents / ~900k subagent tokens per 6-fixture batch is
  the observed cost.
- **Appearance-injection recipe v2** (iteration-2 LOG): reload to Home FIRST,
  then seed `mm:asg:cc-basics` localStorage, then click through CC basics → Q1 —
  seeding before reload gets clobbered by the store's beforeunload flushAutoSave.
  Verify fine details (junction dots, crossing bumps, glyphs) in the SVG DOM.
- Author machines in code via `app/tools/builder.ts`; canonical prove scripts
  from iterations 1–2 live in the session scratchpad (`prove_*.ts`) and hw1-*
  fixtures are worked examples.
- `tsx` may be missing after checkout → `npm install` (don't commit lockfile churn).
- After committing, confirm CI only if pushing; `buildout-infra` has no Pages
  deploy.
