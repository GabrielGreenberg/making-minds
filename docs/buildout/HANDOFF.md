# Handoff — the hot state

_Read this first. It says exactly where we are and what to do next. Rewrite it at
the end of every iteration. If it conflicts with the harness, the harness wins —
run `npm run coverage` and reconcile._

## Where we are

Branch `buildout-infra` (pushed to `origin`). **41 / 56 exact-verified**, 15
pending (all tier `interface`), 0 regressed, 0 warnings. Seventeen iterations
done. All arithmetic complete (HW1–HW5). The wire-router **model fix** (P1.8,
`designs/wire-routing.md`) has S1 (shared geometry) + S2 (divergence dots)
landed (commits `4e62a7e`, `bdf13b1`) **and fully accepted**: iteration 17 ran
the previously-missing in-browser sweep — 237 rendered wires across 11 fixtures
(203 across hw3-p1..p9), **0 false merges, 0 through-body routes**, every
fan-out dotted at its divergence elbow (r=4 #333). Two candidates were
adjudicated non-violations (LOG iteration 17): a sub-pixel (0.33px)
integer-rounding jitter on hw3-p9's own fan-out trunk, and ONE undotted
T-junction at hw3-p9 (1375,757) — the documented bump-adjacent skip rule, not a
rendering bug — flagged as a readability nit for S3/S4.

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

## Do this next — META-audit-queue (due), then P1.8 S3

**FIRST: META-audit-queue** is due (~every 5 iterations; last ran iteration 11,
we're at 17). Run `npm run coverage`; reconcile COVERAGE + QUEUE against the
harness JSON; prune/re-rank; audit for patch accumulation since iteration 11
(P2.1–P2.4, the scope shift, P1.8 S1/S2 all landed in that window). Expect
little row drift — iteration 17 changed no rows. **Also: `origin/main` is 7
commits ahead of this branch** (discovered end of iteration 17): PR #13 adds a
whole SIXTH question mode ("open" free-text, manually reviewed) and PR #11
reworks turbot samples + turbotCheck (grades FSM/SC-brained turbots). Merge
`origin/main` into `buildout-infra` as part of the audit, re-run every gate
(`check`/`tsc`/`build`/`coverage` — turbotCheck and pipelineCheck are the
likely friction points), and audit whether QUEUE/COVERAGE need rows or task
updates for the new mode before P1.8 S3 builds on stale code.

**THEN P1.8 S3–S4** (per `designs/wire-routing.md` slice plan):
- **S3** — foreign-lane A* cost + an H4 near-merge validation round using the
  oracle's own `collinearOverlap` predicate; this kills the 1px-hug class
  generally (not just where fixtures were hand-tuned). W_LANE calibration
  capped at two sweep rounds before falling back to H4-only. Two inputs from
  the iteration-17 sweep: (a) the bump-adjacent dot-skip T-junction (hw3-p9
  (1375,757)) is algorithm-correct but momentarily ambiguous to read — decide
  whether S3's lane separation makes it moot or the skip radius needs tuning;
  (b) elbow vertices integer-round while trunks ride fractional y — keep H4
  near-merge thresholds ≥0.5px so sub-pixel jitter doesn't false-positive.
- **S4** — fallback phase-0 (route residual fallbacks first so A* sees them) +
  lane-nudged fallback + per-wire `usedFallback`/violation flags. Regression-pin
  a pre-fix HW3 layout → zero oracle violations.
Each slice: `npm run check` (incl. `routerCheck`) + `tsc` + `build` +
`coverage` (41/56, 0 regressed) + layoutCheck clean + browser spot-check.

## Then

P3.1 (target-functions design memo — perception authoring) → P3.2/P3.3
perception fixtures → P4.2 multi-arena grading → P4.3 nav arenas → P5.1
capstone → smalls (P1.5 allowed_components, P1.6 cc.ts label-order, P1.11 ARG
multi-group) → P6 close-out.

## Watch out for

- **Interface tier, not answer-chasing** (see SCOPE SHIFT above): if you notice
  an iteration burning effort trying to make an attempt *pass* its cases,
  stop — report the score and move on. Only statement lint, Stage-1 validity,
  end-to-end grading, layout, and appearance gate an interface row.
- **`routerCheck` pins the fallback budget (99) + exact distribution** — S3/S4
  deliberately ratchet it down, so those pins are EXPECTED to change; edit the
  `EXPECTED_FALLBACKS` table intentionally, don't just relax the bound.
- **layoutCheck now imports `componentGeometry`** — geometry changes flow to
  the oracle automatically; a "violation" after a router change is real, not
  oracle drift.
- **`componentGeometry.ts` is the single source** for dims + port math — never
  reintroduce a local copy in CircuitCanvas/wireRouter/layoutCheck.
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
