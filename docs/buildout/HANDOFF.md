# Handoff — the hot state

_Read this first. It says exactly where we are and what to do next. Rewrite it at
the end of every iteration. If it conflicts with the harness, the harness wins —
run `npm run coverage` and reconcile._

## Where we are

Branch `buildout-infra` (pushed to `origin`). **41 / 56 exact-verified**, 15
pending (tier `interface` in the manifest — but see next paragraph: 5 of them
are about to be free exact rows), 0 regressed, 0 warnings. Eighteen iterations
done. All arithmetic complete (HW1–HW5). P1.8 S1+S2 landed and
browser-accepted (iteration 17: 237 wires, 0 violations).

Iteration 18 = META-audit-queue, which became a DOUBLE merge of `origin/main`
(Gabriel ships features on main in parallel — check `git fetch` + `rev-list
HEAD..origin/main` at the START of every iteration from now on):
- `e9122e0` — open free-text questions (sixth mode; `gradeQuestion(question,
  circuit, responseText?)` short-circuits to `pending` 0/0) + turbot grading
  rework (turbotCheck grades all four inner modes).
- `b36aed6` — **perception questions (PR #12)**: `engine/perception.ts` +
  `gradePerception`, a separate question kind outside the value codec and the
  notation seam. Rules `min-run`/`exact-run`/`pattern` (CC) and
  `change`/`motion` (SC); banks generated at save; QuestionCreator gets a
  function|perception Task toggle; devData Q9–Q13 ship correct AND incorrect
  circuits covering EXACTLY hw2-p10/p11/p12 + hw3-p11/p12, pinned by
  perceptionCheck (now wired into `npm run check`) + pipelineCheck 13/13 vs
  0/13.
All gates independently re-verified green after each merge. **P3.1 closed as
overtaken** (main's shipped design IS the decision); P3.2/P3.3 rescoped to
fixture promotion. Two adjudications flagged for Gabriel in LOG iteration 18:
the 1-bit turbot-label pin flip (alias design won) and the perception
target-function residual (three forms now; unification deferred).

## ⚠ SCOPE SHIFT (user directive 2026-07-06) — read before picking work

**Interface over correctness.** For everything that remains (perception +
navigation), the bar is that the *interface* exists: the question authors, a
**plausible attempt** builds in the editor, passes Stage-1 validation, and
grades end-to-end. The attempt's score is reported, **not asserted** — do NOT
budget tokens hunting exactly-correct solutions (Way Finder, Mad Max, Desert
Ant). That is the separate future "correct-answers project". Harness tier
`interface` (◐) enforces it. The 41 exact rows stay exact as regression pins.
**Exception that now applies:** when a correct machine is FREE (main's
perception samples), take it — P3.2/P3.3 rows go exact tier at no search cost.

## Do this next — P3.2: promote CC perception fixtures (then P3.3)

**P3.2** — promote main's devData CC perception circuits into reference
fixtures: hw2-p10 (min-run 3, w8 = sample Q9), hw2-p11 (exact-run 3, w8 =
Q10), hw2-p12 (pattern 110010111, w9 = Q11). Correct + incorrect circuits are
in `src/devData/sampleData.ts` (netlist-built); fixture format per
`app/tools/fixtures/reference/README.md`; prove with `gradeQuestion` headless
BEFORE writing the fixture; flip those manifest rows' tier to exact. Layout
oracle hard-gates (CC fixtures) — positions may need a re-layout pass like
earlier batches. Appearance check per VISUAL_VOCAB + recipe v3.
**Acceptance:** harness 44 exact / 12 pending / 0 regressed; gates green.

**Then P3.3** — same for SC: hw3-p11 (change, w8 = Q12), hw3-p12 (motion k=3,
w8, ~80 gates = Q13). 44→46. ⚠ If the layout oracle trips on Q13's big motion
circuit, that is evidence to pull P1.8 S3 forward — fix positions if cheap,
otherwise switch to S3 and come back.

**Then P1.8 S3/S4** (per `designs/wire-routing.md`): S3 foreign-lane A* cost +
H4 near-merge round using the oracle's `collinearOverlap` (inputs from the
iteration-17 sweep: keep H4 thresholds ≥0.5px — elbows integer-round over
fractional trunks; decide whether lane separation moots the hw3-p9 (1375,757)
bump-adjacent dot-skip or the skip radius needs tuning; W_LANE calibration
capped at two sweep rounds). S4 fallback phase-0 + lane-nudge + per-wire
`usedFallback`; regression-pin a pre-fix HW3 layout.

## Then

P4.2 multi-arena grading → P4.3 nav arenas (main's turbot rework grades all
four inner modes — build on it; turbot-FSM labels are canonical 2-bit via
`turbotFsmNotation`, default `0:11`) → P5.1 capstone → smalls (P1.5
allowed_components, P1.6 cc.ts label-order, P1.11 ARG multi-group) → P6
close-out. META-audit-queue next due ~iteration 23.

## Watch out for

- **Fetch main first:** Gabriel ships to main from parallel sessions —
  `git fetch origin main` + check `HEAD..origin/main` at the start of every
  iteration; merge before building on stale code.
- **Interface tier, not answer-chasing** — except when correct machines are
  free (see SCOPE SHIFT). Only statement lint, Stage-1 validity, end-to-end
  grading, layout, and appearance gate an interface row.
- **Perception questions grade OUTSIDE the codec** (raw bit-vector frames,
  IN1-first; SC `change`/`motion` treat pre-t1 as blank, matching MEM init).
  coverageCheck's Stage-1 mirror now matches gradeQuestion's full dispatch
  (open → perception → turbot → codec) — keep them in lockstep.
- **`routerCheck` pins the fallback budget (99) + exact distribution** — S3/S4
  deliberately ratchet it down; edit `EXPECTED_FALLBACKS` intentionally.
- **layoutCheck imports `componentGeometry`** — a violation after a router
  change is real, not oracle drift. **`componentGeometry.ts` is the single
  source** for dims + port math.
- **`turbotFsmNotation` is the single turbot-FSM grammar answer** (main's
  separate regex parser was deleted in the merge); 1-bit labels are
  accepted-as-alias BY DESIGN (P1.12) — main's contrary pin was flipped;
  flag to Gabriel if strictness was intended.
- **notationCheck grep gate**, **scWindowCheck (45+)**, **tmCheck**,
  **perceptionCheck** all stay green.
- The iteration-16 `validateSegmentPosition` drag-halo side effect: benign,
  still unswept; spot-check if touching drag validation.
- **Ops:** 529 → `Workflow({scriptPath, resumeFromRunId})`; commit landed
  slices before long agent runs; a serial browser sweep fits ONE delegated
  agent, not a fan-out workflow.
- **Appearance recipe v3**; seeds from `app/public/` at `/making-minds/`;
  clean seed keys twice + delete `app/public/*-seed.json` (and any `app/dist/`
  copy).
- `tsx` missing → `npm install`; no lockfile churn.
