# Wire Routing: Fix the World Model, Not the Symptoms
_Status: accepted · 2026-07-06 · Task: P1.8 · Judged competition: D1 "MODEL-FIX" 77 vs D2 "GUARANTEE-LAYER" 65_

## 1. Problem family, and why now

Three routing defects, one root: the router's obstacle table disagrees with rendered geometry.
`getCompDimensions` (`app/src/wireRouter.ts:104`) has no MEM case, so MEM falls to the default
**75×70** while the canvas and oracle render **50×50** (`CircuitCanvas.tsx:28`,
`tools/layoutCheck.ts:47`). MEM.min's stub tip (port x+50 → tip x+62) sits **18px inside** the
phantom expanded right edge (x+80), so every incident edge is blocked, A* returns null, and the
wire takes the obstacle-blind fallback lane. This caused all six HW3 appearance failures. The
family: **(a)** fallback lanes through bodies/collinear with other wires; **(b)** different-source
wires hugging at <3px — reads as a forbidden merge (hw3-p9 shipped a 1px case) because A* has no
foreign-lane cost and can't see fallback lanes at all; **(c)** split dots drawn only at source
ports — divergence elbows on shared trunks are undotted (VISUAL_VOCAB wants dots at splits).

Why now: P1.8 gates Phase 3 — perception fixtures (hw2-p10..12, hw3-p11..12) are CC/SC, back on
the router. And the fix is **pre-validated, not projected**: the judge reproduced D1's riskiest
claims against the real oracle — the bounds fix alone keeps **all 23 CC/SC fixtures (46
machines) oracle-clean**, drops fallback invocations **283 → 99** (residuals exactly in
hw2-p3/p7, hw3-p1/p2/p5/p6/p8/p9), and speeds the sweep ~28% by deleting doomed 5000-iteration
searches. (The HANDOFF's "16 fixtures" is stale — 23 exist; the manifest lists 34 CC/SC rows,
so the gate's scope grows as the rest land.)

## 2. Decision

**Repair the router's world model so A* can do its job everywhere.** Four moves, all in
`wireRouter.ts` unless noted: align obstacle bounds with rendered geometry via one shared
geometry module; teach A* a foreign-lane cost + an H4 near-merge validation round; route residual
fallbacks first and make the fallback itself lane-aware; dot divergence elbows in the renderer.
The end state is *simpler* than the start state: one geometry truth instead of three drifting
copies, and defense-in-depth inside the existing cost-search paradigm — no repair subsystem.

```ts
// (1) NEW app/src/componentGeometry.ts — no React/DOM. Owns dimensions AND port math
//     (incl. the OR/XOR left-port inset + rotation), imported by CircuitCanvas,
//     wireRouter, AND layoutCheck — the three copies can never diverge again.
export function getComponentSize(comp): { w; h };   // MEM 50×50; STATE boxed 90×50 else 60×60
export function getPortPositionLocal(comp, port): Point;

// (2a) Foreign-lane cost: OccupancyState.segments records gain sourcePortKey. In aStarSearch's
//      existing countCrossings loop (single scan, wireRouter.ts:203): edge parallel to a
//      DIFFERENT-source segment, perp dist < LANE_CLEARANCE(10px), shared span > 1px →
//      cost += span * W_LANE_PER_PX (~25; 16px hug = 400 > one crossing 200, << W_OVERLAP).
// (2b) H4 validation round (alongside H1–H3, wireRouter.ts:950-1037): the oracle's own
//      collinearOverlap predicate at 5px (hysteresis over the 3px gate), same-source exempt,
//      wires with manualSegments SKIPPED; violators reroute seeing full occupancy.
// (2c) Phase 0 in routeAllWires: O(4) doomed-check per wire (any unblocked incident edge at
//      each stub?); doomed wires take the fallback FIRST and register occupancy so A* sees
//      their lanes. fallbackPath becomes lane-aware: shift ±16/±32/±48, deterministic, first
//      offset clearing LANE_MIN_ACCEPT ≥ 3.5px vs committed geometry wins. WireRouteResult
//      gains usedFallback?/violation? (final read-only oracle sweep — warn, don't block).

// (3) CircuitCanvas splitDots memo (~line 3979) → pure exported findDivergencePoints():
//     per sourcePortKey group, pairwise common-prefix walk over DISPLAYED points
//     (post-manualSegments); dedupe; skip points within bump radius of a CANVAS-side crossing
//     (the canvas recomputes crossings after manual shifts, superseding result.crossings).
```

Two grafts from D2 are binding: **hysteresis plumbing** — feed pre-modification, grid-aligned
`rawPoints` into `previousPathsRef` (CircuitCanvas ~3938) so H4 reroutes and nudged fallbacks
don't silently break `edgeMatchesPreviousPath`'s exact keys; **manual-segment discipline** —
`segmentIndex`-keyed offsets are corrupted by point-count changes, so reroute rounds never
touch a wire the student has dragged.

## 3. Slice plan

Each slice independently green (`check`/`tsc`/`build`/`coverage` 41/56, layoutCheck clean) and
revertible. S1+S2 are near-riskless and pre-validated; the browser-sweep budget goes to S3/S4.

1. **Bounds + shared geometry.** `componentGeometry.ts` (sizes + port math); wireRouter,
   CircuitCanvas, layoutCheck all import it. Side effect (flagged, deliberate):
   `validateSegmentPosition` (wireRouter.ts:1184) uses the same table, so the phantom 25px
   no-drag halo right of every MEM loosens — beneficial, but swept. **Acceptance:** all 23
   fixtures oracle-clean (pre-validated by the judge); instrumented fallback count ≤ 99;
   browser sweep of the nine hw3 fixtures (~72 routes move) + hw2-p7.
2. **Divergence dots** (renderer-only; oracle measures segments, not dots — zero gate risk).
   **Acceptance:** headless unit corpus for `findDivergencePoints` (trunk fanout, stub-point
   divergence subsuming today's port dot, dot-vs-bump skip using canvas-side crossings);
   browser spot-check of a fanout-heavy fixture.
3. **Foreign-lane cost + H4 round** (2a+2b, plus the rawPoints and manualSegments grafts).
   **Acceptance:** 23 fixtures clean; hw3-p9's 1px hug gone (oracle predicate + measured
   separation); route-dump diff identifies changed fixtures — sweep only those; W_LANE
   calibration gets at most two sweep rounds before falling back to H4-only (see Risks).
4. **Fallback: phase-0 + lane-nudge + flags** (2c). **Acceptance:** residual fallback wires
   drop further, each carrying `usedFallback`; **the resurrected pre-fix HW3 layout (git
   history — it produced all six appearance failures) yields zero oracle violations**;
   idempotence + anchor pins (below) green.
5. *(Optional, only if Phase 3 fixtures drag)* Perf: unsimplified-segment occupancy scans in
   the A* inner loop. **Acceptance:** measured sweep timing, no route changes (byte-diff).

## 4. Compatibility contract (must never break)

- **Every CC/SC fixture stays layoutCheck-clean after every slice** (23 files / 46 machines
  today; the manifest's remaining CC/SC rows join the gate as they land). If a slice changes
  routes on a previously-clean fixture, the browser sweep for the affected fixtures runs
  *before* the slice is accepted — oracle-clean is necessary, not sufficient.
- **layoutCheck geometry must track router changes structurally, not by discipline**: both
  import `componentGeometry.ts` (dimensions *and* port math — a port-inset change in the
  canvas must not silently desync the oracle again).
- **Route stability for live editing**: routing stays deterministic (fixed sort order, monotone
  occupancy, deterministic nudge order — no RNG); `manualSegments` wires are never rerouted by
  H4; `rawPoints` keeps hysteresis keys matchable. Honesty note: today's stability is mostly
  *re-derivation determinism* — `buildPreviousPathEdges` (wireRouter.ts:508) keys whole
  simplified runs while A* matches single grid edges, so the continuity discount rarely fires.
  Fixing that matcher would change routes: a deliberate future decision, **out of scope** here.
- Warn-don't-block: `violation` flags surface in tooling (and later canvas highlights); the
  router never hard-fails a student's circuit.

## 5. Test plan

New `tools/routerCheck.ts` (joins `npm run check`): fallback-count budget (monotone ≤ 99, exact
residual distribution pinned); doomed-check unit pins; **idempotence** (route twice → byte-equal,
incl. nudged fallbacks); **anchor invariants** (path[0], path[last], stub tips byte-equal across
slices); lane-nudge determinism + LANE_MIN_ACCEPT floor; `findDivergencePoints` corpus; **the
pre-fix HW3 layout regression pin** (asserts the new router solves the actual historical
failure); oracle-predicate *reuse* — routerCheck imports `collinearOverlap`/`segThroughRect`
from layoutCheck rather than reimplementing them. layoutCheck stays the appearance oracle via
the coverage harness; per-slice route-dump diffs bound browser sweeps to changed fixtures.

## 6. Risks and mitigations

- **W_LANE calibration** (the real S3 risk — soft costs can trade wrongly on dense layouts).
  Three independent layers mean no single weight is load-bearing: A* lane cost (soft), H4
  reroute (deterministic, oracle-predicate-triggered), lane-nudged fallback with a hard
  acceptance floor. Budget: two sweep rounds; if calibration fights back, ship H4+floor only.
- **S1 route churn**: 72 hw3 routes move. Pre-validated oracle-clean; swept before acceptance.
- **Doomed-check is O(4), not complete**: iteration-exhaustion failures still burn 5000
  iterations and fall to the H-round fallback. Accepted; the fallback-count pin watches it.
- **Two crossing pipelines**: the canvas recomputes crossings post-manualSegments and bakes
  bumps into pathD, superseding `result.crossings`. Dots consume the canvas-side set (S2);
  unifying the pipelines is noted, not attempted here.
- **Zoom**: every threshold in play (oracle 3px, LANE_CLEARANCE 10px, dot r=4) is model-space;
  at min zoom an "oracle-clean" 8px gap renders sub-pixel. Open appearance-bar question; not P1.8's.
- **validateSegmentPosition halo change**: user-visible (drags allowed closer to MEM's right
  edge). Beneficial and consistent with rendered geometry, but called out and swept, not silent.

## 7. Rejected alternative

**D2, "GUARANTEE-LAYER" (65/100)** — keep A* byte-identical and add a post-hoc resolver
(union-find near-merge clusters → nudge/detour candidates validated against rendered rects)
triggered by the oracle predicate. Its fixture-stability engineering is genuinely superior
(byte-identity through three slices, provable; it won that criterion outright) and its rawPoints
insight, oracle-predicate trigger, verification sweep, regression-pin layout, and
manual-segment analysis are all grafted above. Rejected because it buys stability by keeping a
router that believes MEM is 75×70: every future student MEM circuit still routes as dressed-up
L-paths; ~350 lines of resolver never fire on any current fixture (green gates validate none of
it); user-dragged wires — exactly the wires students touched — are wholly exempt; and it ends
with four geometry copies, two intentionally disagreeing, plus a subsystem whose permanent job
is repairing what the router just did. For a course platform where arbitrary student circuits
are the real workload, fixing the world model beats institutionalizing a repair layer.
