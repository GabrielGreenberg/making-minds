# Handoff — the hot state

_Read this first. It says exactly where we are and what to do next. Rewrite it at
the end of every iteration. If it conflicts with the harness, the harness wins —
run `npm run coverage` and reconcile._

## Where we are

Branch `buildout-infra` (pushed to `origin`). **41 / 56 exact-verified**, 15
pending (all tier `interface`), 0 regressed, 0 warnings. Eighteen iterations
done. All arithmetic complete (HW1–HW5). P1.8 S1+S2 (shared geometry +
divergence dots) landed AND browser-accepted (iteration 17: 237 wires, 0
violations). Iteration 18 ran META-audit-queue, whose main body was **merging
`origin/main`** (7 commits ahead) as `e9122e0`: main brought a SIXTH question
mode — "open" free-text, manually reviewed, `gradeQuestion(question, circuit,
responseText?)` short-circuits it to a `pending` 0/0 result — and a turbot
rework (turbotCheck grades all four inner modes; TMNotation threaded through
runBrainStep/runTurbot). All gates re-verified green post-merge, independently
of the merge agent.

**One adjudication to flag to Gabriel:** main's new turbotCheck pin asserted
1-bit turbot FSM labels are REJECTED; the branch's documented P1.12 design
says they alias to canonical 2-bit (decay on edit-save, bit-identical
execution, old localStorage machines keep validating). The alias design won —
main's separate `parseTurbotFSMLabel` grammar was deleted and
`validateTurbotFSM` now delegates to the notation seam. If strict rejection
was deliberate, flip it back WITH a migration plan (LOG iteration 18).

## ⚠ SCOPE SHIFT (user directive 2026-07-06) — read before picking work

**Interface over correctness.** For everything that remains (perception +
navigation, all 15 pending rows), the bar is that the *interface* exists: the
question authors, a **plausible attempt** builds in the editor, passes Stage-1
validation, and grades end-to-end. The attempt's score is reported, **not
asserted** — do NOT spend tokens hunting exactly-correct solutions (Way Finder,
Mad Max, Desert Ant, motion detector). That is a separate future
"correct-answers project". Enforced in the harness as tier `interface` (all 15
pending manifest rows are tagged; state ◐); NORTH_STAR and QUEUE carry the full
statement. The 41 exact rows stay exact as regression pins. P2.5 is deferred to
the correct-answers project. P1.8 (router) is unaffected — that IS interface
quality work.

## Do this next — P1.8 S3, then S4

**P1.8 S3** (per `designs/wire-routing.md` slice plan): foreign-lane A* cost +
an H4 near-merge validation round using the oracle's own `collinearOverlap`
predicate; this kills the 1px-hug class generally (not just where fixtures
were hand-tuned). W_LANE calibration capped at two sweep rounds before falling
back to H4-only. Two inputs from the iteration-17 sweep: (a) the bump-adjacent
dot-skip T-junction (hw3-p9 (1375,757)) is algorithm-correct but momentarily
ambiguous to read — decide whether S3's lane separation makes it moot or the
skip radius needs tuning; (b) elbow vertices integer-round while trunks ride
fractional y — keep H4 near-merge thresholds ≥0.5px so sub-pixel jitter
doesn't false-positive.

**Then S4:** fallback phase-0 (route residual fallbacks first so A* sees
them) + lane-nudged fallback + per-wire `usedFallback`/violation flags.
Regression-pin a pre-fix HW3 layout → zero oracle violations.

Each slice: `npm run check` (incl. `routerCheck`) + `tsc` + `build` +
`coverage` (41/56, 0 regressed) + layoutCheck clean + browser spot-check.

## Then

P3.1 (target-functions design memo — perception authoring) → P3.2/P3.3
perception fixtures → P4.2 multi-arena grading → P4.3 nav arenas (main's
turbot rework already grades all four inner modes — build on it) → P5.1
capstone → smalls (P1.5 allowed_components, P1.6 cc.ts label-order, P1.11 ARG
multi-group) → P6 close-out. META-audit-queue next due ~iteration 23.

## Watch out for

- **Interface tier, not answer-chasing** (see SCOPE SHIFT above): if you notice
  an iteration burning effort trying to make an attempt *pass* its cases,
  stop — report the score and move on. Only statement lint, Stage-1 validity,
  end-to-end grading, layout, and appearance gate an interface row.
- **Open questions post-merge:** `gradeQuestion` has an optional third param
  (`responseText`); open questions return `pending` BEFORE Stage-1 — they are
  outside coverage scope (the 56 rows are all autogradeable) and
  coverageCheck's self-test pins the contract. `SubmissionGrade` scores
  denominate over autogradeable questions only.
- **`routerCheck` pins the fallback budget (99) + exact distribution** — S3/S4
  deliberately ratchet it down, so those pins are EXPECTED to change; edit the
  `EXPECTED_FALLBACKS` table intentionally, don't just relax the bound.
- **layoutCheck imports `componentGeometry`** — geometry changes flow to
  the oracle automatically; a "violation" after a router change is real, not
  oracle drift.
- **`componentGeometry.ts` is the single source** for dims + port math — never
  reintroduce a local copy in CircuitCanvas/wireRouter/layoutCheck.
- **`turbotFsmNotation` is the single turbot-FSM grammar answer** (post-merge:
  main's separate regex parser was deleted); default label is `0:11`;
  `turbotInternalNotation` is TMNotation-aware (no `*` on unary questions).
- **notationCheck grep gate**, **scWindowCheck (45+)**, **tmCheck** (incl. the
  P2.3 standard-halt + P2.4 separations pins) all stay green.
- The iteration-16 side effect — `validateSegmentPosition` inherited the
  shrunken MEM bottom drag-halo / STATE obstacle bounds from the shared
  geometry — is benign but still unswept in-browser; spot-check if you touch
  drag validation.
- **Ops:** 529 → `Workflow({scriptPath, resumeFromRunId})`; model/credit limit
  can kill an agent mid-workflow — commit landed slices first. A serial browser
  sweep fits ONE delegated agent (iteration 17: 11 fixtures, 128k tokens),
  not a fan-out workflow.
- **Appearance recipe v3**; seeds from `app/public/` at `/making-minds/`; clean
  seed keys twice + delete the `app/public/*-seed.json` (and any `app/dist/`
  copy if a build ran).
- `tsx` missing → `npm install`; no lockfile churn.
