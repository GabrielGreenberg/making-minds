# Handoff — the hot state

_Read this first. It says exactly where we are and what to do next. Rewrite it at
the end of every iteration. If it conflicts with the harness, the harness wins —
run `npm run coverage` and reconcile._

## Where we are

Branch `buildout-infra` (pushed to `origin`). **44 / 56 exact-verified**, 12
pending (tier `interface`), 0 regressed, 0 warnings. Nineteen iterations done.
All arithmetic (HW1–HW5) AND CC perception (hw2-p10/p11/p12, iteration 19 —
promoted from main's devData Q9–Q11 at exact tier, adversarially confirmed
63/63, appearance swept). P1.8 S1+S2 landed and accepted; S3/S4 remain, and S3
gained a second exhibit (below).

**Iteration-19 discovery — the bumpless-crossing class:** hw2-p11's correct
circuit renders 6 crossings with NO bump: the router lanes a fan-out branch at
port±ELEMENT_MARGIN(=5), self-coincident with `pathDWithBumps`' R=5 bump-skip
radius, so bumps physically can't render on hug-lane crossings. Structural —
an annealing probe over positions stalled at 2/6 (H1 forbids trunk sharing;
moves only relocate the defect). Ships as a documented residual (COVERAGE
row note); `app/tools/bumpCheck.ts` (headless canvas-crossing + skip-rule
replication on real routes, DOM-validated 1:1) is the pinned predicate —
deliberately NOT in `npm run check` until S3 makes it pass.

## ⚠ SCOPE SHIFT (user directive 2026-07-06) — read before picking work

**Interface over correctness.** For everything that remains (SC perception +
navigation + capstone), the bar is that the *interface* exists: the question
authors, a **plausible attempt** builds, passes Stage-1 validation, and grades
end-to-end; scores reported, not asserted. Do NOT hunt exactly-correct
solutions (Way Finder, Mad Max, Desert Ant) — that's the future
correct-answers project. **Exception:** when a correct machine is FREE
(main's devData samples), take it — that's how hw2-p10..p12 went exact, and
hw3-p11/p12 will too.

## Do this next — P3.3: promote SC perception fixtures

Same drill as P3.2 (see LOG iteration 19 for the exact workflow shape):
promote devData Q12 → hw3-p11 (change detector, w8) and Q13 → hw3-p12 (motion
detector k=3, w8, ~80 gates) into exact-tier reference fixtures.
- Circuits: `perceptionChange*`/`perceptionMotion*` builders (names similar)
  in `app/src/devData/sampleData.ts`; banks via the production
  `buildPerceptionCases` (SC = deterministic seeded battery, NOT exhaustive —
  breadth WARN rules apply to sampled banks, so check the broken-fail
  fraction prints ≥25% or justify).
- SC perception is spatio-temporal: 8 parallel inputs over frames; pre-t1 =
  blank frame (matches MEM init). Fixture questions carry perception +
  perception_cases, no cc_spec/test_cases.
- devData ships components at (0,0) — positions must be generated (ASAP-depth
  columns worked for P3.2; hw3-p12 is the biggest circuit yet, ~1950×1700+).
- Gates: headless gradeQuestion proof before writing; layout oracle clean;
  manifest rows flipped by the MAIN session only; harness → **46 exact · 10
  pending · 0 regressed**; npm run check + tsc + build; adversarial verifier
  (bank integrity vs buildPerceptionCases, promotion fidelity, independent
  re-grade); browser appearance sweep (recipe v3).
- Run `tools/bumpCheck.ts` on both new fixtures: report the count. If the
  motion circuit shows bumpless crossings, do NOT position-hunt (iteration-19
  lesson) — document as the same S3 class and ship at the harness bar.

## Then

**P1.8 S3** — foreign-lane A* cost + H4 near-merge round. S3 acceptance now
includes: (a) H4 thresholds ≥0.5px (sub-pixel elbow rounding, iteration 17);
(b) decide the hw3-p9 (1375,757) bump-adjacent dot-skip (moot or tune radius);
(c) **bumpCheck clean on ALL CC/SC fixtures** (hw2-p11's 6 are the exhibit;
break the ELEMENT_MARGIN=5 ≡ R=5 coincidence) then wire bumpCheck into
`npm run check`; W_LANE calibration capped at two sweep rounds. **S4** —
fallback phase-0 + lane-nudge + per-wire `usedFallback`; regression-pin a
pre-fix HW3 layout. Then P4.2 multi-arena grading → P4.3 nav arenas → P5.1
capstone → smalls (P1.5, P1.6, P1.11) → P6 close-out. META-audit-queue due
~iteration 23.

## Watch out for

- **Fetch main first:** Gabriel ships to main from parallel sessions —
  `git fetch origin main` + `git rev-list --count HEAD..origin/main` at the
  START of every iteration; merge before building on stale code.
- **Runaway fix agents (iteration-19 lesson):** a "small fix" agent
  self-spawned annealing loops and burned 200k+ tokens on a structurally
  unfixable objective. Give fix agents a hard bar ("if not clean after ONE
  principled attempt, STOP and report"), and stand them down via SendMessage
  the moment the fix class looks structural.
- **Interface tier, not answer-chasing** — free correct machines excepted.
- **Perception questions grade OUTSIDE the codec** (raw bit-vector frames,
  IN1 = MSB; SC pre-t1 = blank frame). coverageCheck's Stage-1 mirror matches
  gradeQuestion's dispatch (open → perception → turbot → codec) — keep them
  in lockstep.
- **`routerCheck` pins the fallback budget (99) + distribution** — S3/S4
  ratchet intentionally. **layoutCheck imports `componentGeometry`** — oracle
  violations after router changes are real. **`componentGeometry.ts` single
  source.** **`turbotFsmNotation` single grammar answer** (1-bit = alias BY
  DESIGN; main's contrary pin was flipped — flag to Gabriel).
- **notationCheck grep gate**, **scWindowCheck**, **tmCheck**,
  **perceptionCheck** green; `bumpCheck.ts` exists but is NOT a gate yet.
- iteration-16 `validateSegmentPosition` drag-halo side effect: benign,
  unswept.
- **Ops:** 529 → `Workflow({scriptPath, resumeFromRunId})`; commit landed
  slices before long agent runs; serial browser work = ONE agent.
- **Appearance recipe v3**; seeds from `app/public/` at `/making-minds/`;
  clean seed keys twice; delete `app/public/*-seed.json` + any `app/dist/`
  copy.
- `tsx` missing → `npm install`; no lockfile churn.
