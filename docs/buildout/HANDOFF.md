# Handoff — the hot state

_Read this first. It says exactly where we are and what to do next. Rewrite it at
the end of every iteration. If it conflicts with the harness, the harness wins —
run `npm run coverage` and reconcile._

## Where we are

Branch `buildout-infra` (pushed to `origin`). **46 / 56 exact-verified**, 10
pending (tier `interface`), 0 regressed, 0 warnings. Twenty iterations done.
**All arithmetic (HW1–HW5) and ALL perception (hw2-p10..p12, hw3-p11..p12)
complete at exact tier** — every perception row promoted from Gabriel's
devData samples, adversarially confirmed, appearance-swept. Remaining pending:
9 navigation rows + the HW6 Desert Ant capstone.

**Iteration-20 diagnostic win — the router fallback budget is now a named
mechanism, not a mystery:** hw3-p11 exposed 48 new fallbacks; a bounded agent
proved they are the **structural XOR floor** — XOR's left-port inset (11.25px)
exceeds STUB_LENGTH(12)−ELEMENT_MARGIN(5), so every A* goal at an XOR in-port
is born blocked → exactly 3 fallbacks per XOR-in wire. The ENTIRE 147 budget
decomposes as 3×XOR-in wires per fixture + 3 one-off doomed wires
(hw3-p1/p8/p9). Deliberately pinned (`routerCheck.ts` header has mechanism +
fix candidates). hw3-p12 (146 comps, PLA-matrix layout, 270°-rotated MEMs) has
ZERO fallbacks because it has zero XORs.

## ⚠ SCOPE SHIFT (user directive 2026-07-06) — read before picking work

**Interface over correctness.** All 10 remaining rows are navigation/capstone:
the bar is a plausible attempt that authors, builds, validates Stage-1, and
grades end-to-end; scores reported, not asserted. Do NOT hunt correct
solutions (Way Finder, Mad Max, Desert Ant) — future correct-answers project.
**Exception:** free correct machines (devData/problem-set-printed) — take
them; the HW4 zig-zag FSM is PRINTED in the problem set.

## Do this next — P1.8 S3 (router: lanes + the XOR floor)

Per `designs/wire-routing.md` + three pinned exhibits, S3 now has a full
mechanism map. Scope:
1. **Foreign-lane A* cost** (W_LANE; calibration capped at two sweep rounds,
   fall back to H4-only) — kills hug-lanes generally.
2. **The XOR fallback floor**: fix candidates — exempt the wire's OWN
   endpoint-component bounds on first/last approach edges, or lengthen stubs
   past inset+margin. Expected post-fix budget ≈ 3 (ratchet
   `EXPECTED_FALLBACKS` DOWN deliberately).
3. **Bumpless-crossing class**: hug lanes at port±ELEMENT_MARGIN(5) ≡ R=5
   bump-skip radius — break the coincidence. Acceptance: `tools/bumpCheck.ts`
   clean on ALL CC/SC fixtures (exhibits: hw2-p11 6, hw3-p12 17+12), then
   wire bumpCheck into `npm run check`.
4. **Obstacle-model gap**: INPUT toggle-tabs aren't router obstacles
   (hw3-p12 wire pmo-36 elbows through IN2's tab) — add to obstacle bounds.
5. **H4 near-merge validation round** with the oracle's `collinearOverlap`;
   thresholds ≥0.5px (elbows integer-round over fractional trunks); decide
   the hw3-p9 (1375,757) bump-adjacent dot-skip (moot or tune).
Gates per slice: `npm run check` (edit routerCheck pins DELIBERATELY
downward) + tsc + build + coverage (46/56, 0 regressed) + layoutCheck +
browser spot-check of moved routes (serial, ONE agent).

**Queue-jump decision for the iteration after S3:** P1.15 (real app bug — SC
sim state leaks across question navigation; only TM+turbot slices reset;
deep fix = ONE unified all-modes sim reset in the store) — but the appearance
agent flagged a chip for Gabriel, who fixed the TM twin himself yesterday in
a parallel session. CHECK `git log origin/main` for his fix before building;
if untaken by then, P1.15 beats S4/P4.x on user impact.

## Then

P1.8 S4 (fallback phase-0 + lane-nudge + per-wire `usedFallback`) → P4.2
multi-arena navigation grading (grader must require ALL arenas in
`turbot_cases`; acceptance: single-layout solution fails the family) → P4.3
nav arenas + plausible brains (zig-zag FSM is printed in HW4 — free; main's
turbot rework grades all four inner modes; 2-bit motor labels canonical via
`turbotFsmNotation`, default `0:11`) → P4.4 turbot sandbox tab (optional) →
P5.1 Desert Ant capstone (interface proof, NOT a solved ant) → smalls (P1.5
allowed_components, P1.6 cc.ts label-order, P1.11 ARG multi-group, P1.15 if
still open, P1.16 rotated-MEM labels) → P6 close-out. META-audit-queue due
~iteration 23.

## Watch out for

- **Fetch main first** every iteration (`git rev-list --count
  HEAD..origin/main`); Gabriel ships from parallel sessions — merge before
  building. Check specifically for a P1.15 fix landing.
- **Runaway fix agents:** hard bar + stop rule in every fix-agent prompt
  (iteration-19 annealer, 200k tokens). Iteration-20's bounded agent HONORED
  its stop rule and returned a root cause instead of a spiral — that's the
  template (LOG 20).
- **Interface tier, not answer-chasing** — free correct machines excepted.
- **Perception grades OUTSIDE the codec**; coverageCheck's Stage-1 mirror
  matches gradeQuestion's dispatch (open → perception → turbot → codec).
- **routerCheck pins are now MECHANISM-NAMED** (XOR floor) — S3 ratchets them
  down; never raise without a diagnosis like iteration 20's.
- **Rotated MEMs are sanctioned** (first-class `rotation` field,
  rotation-aware port math, validated end-to-end on hw3-p12); known cosmetic
  issue: label bisection (P1.16).
- **`turbotFsmNotation` single grammar answer**; 1-bit = alias BY DESIGN
  (main's contrary pin was flipped — still flagged for Gabriel).
- **notationCheck grep gate**, **scWindowCheck**, **tmCheck**,
  **perceptionCheck** green; `bumpCheck.ts` NOT a gate until S3.
- iteration-16 `validateSegmentPosition` drag-halo side effect: benign,
  unswept.
- **Ops:** 529 → `Workflow({scriptPath, resumeFromRunId})`; commit landed
  slices before long agent runs; serial browser work = ONE agent.
- **Appearance recipe v3**; seeds from `app/public/` at `/making-minds/`;
  clean keys twice; delete seed JSONs + dist copies.
- `tsx` missing → `npm install`; no lockfile churn.
