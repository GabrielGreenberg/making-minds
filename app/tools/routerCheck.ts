// routerCheck — unit pins for the wire router's world model (P1.8).
//
//   cd app && npx tsx tools/routerCheck.ts        (also part of `npm run check`)
//
// The router, the canvas, and the layout oracle all read component geometry
// from ONE module (src/componentGeometry.ts) — that consistency is structural
// (by import), so this tool pins the things imports alone cannot guarantee:
//
//   1. GEOMETRY SMOKE — componentGeometry's rendered dimensions and port math
//      still equal what CircuitCanvas historically rendered (MEM 50×50, the
//      OR/XOR left-port inset, rotation). If someone edits the shared module,
//      all three consumers move together — but they must move to values that
//      match the drawn SVG bodies, and these pins are the tripwire.
//
//   2. MEM.min + XOR.in REACHABILITY — two historical ways a wire was born
//      blocked. MEM: the router's private geometry table had no MEM case, so
//      MEM fell to a phantom 75×70 obstacle. XOR: the left-port inset
//      (11.25px) exceeds STUB_LENGTH(12) − ELEMENT_MARGIN(5), so the stub tip
//      sits inside the XOR's OWN expanded bounds — fixed by the own-endpoint
//      exemption (a wire may touch its own endpoints' bounds at its stub
//      tips; wireRouter.ts). Pins: in a clean field, MEM and XOR wires route
//      via A* (zero fallbacks) and are oracle-clean. Plus a tripwire proving
//      the fallback counter still fires when a FOREIGN component (never
//      exempt) buries a stub tip.
//
//   3. FALLBACK BUDGET — route every CC/SC reference fixture exactly as the
//      canvas would and pin the fallbackPath invocation counts: 2 total
//      (was 283 before the MEM bounds fix, 147 before the own-endpoint
//      exemption killed the structural XOR floor), with the residual
//      distribution pinned per fixture. New fixtures must route
//      fallback-free or be added to the table DELIBERATELY.
//      Every fixture must also stay oracle-clean (layoutCheck predicates).
//
//   4. DIVERGENCE DOTS — findDivergencePoints corpus (VISUAL_VOCAB: a split
//      draws a dot at the JUNCTION). Trunk fanout dots the elbow where the
//      branches part, stub-tip divergence subsumes the old always-at-the-port
//      dot, extra collinear waypoints can't fake a junction, and a dot within
//      collision range of a CANVAS-side crossing (whose bump arc the canvas
//      bakes into pathD from displayed points — NOT the router's crossing
//      set) is skipped.
//
//   5. ROUTE-QUALITY FLAGS — WireRouteResult.usedFallback / .violation (S4:
//      warn-don't-block). The doomed tripwire wire carries BOTH flags (its
//      phase-0 fallback L-path cuts through the foreign blocker); hw3-p9's
//      residual w21 carries usedFallback with NO violation (its fallback is
//      oracle-clean — which is exactly why the S4 lane-nudge was skipped);
//      A*-routed wires carry neither.
//
//   6. PRE-FIX LAYOUT — the historical hw3-p4 layout (P1.3-era positions,
//      git 0d0c5e5; 4 collinear-overlap pairs under the pre-P1.8 router —
//      it was repositioned in P1.7 to dodge them) must route oracle-clean
//      under TODAY's router with no repositioning. Fallbacks allowed,
//      violations not: the pin asserts the world-model fix solved the actual
//      historical failure rather than the fixture nudge hiding it.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  getComponentSize,
  getPortPosition,
  getPortPositionLocal,
} from '../src/componentGeometry';
import {
  routeAllWires,
  resetFallbackCount,
  getFallbackCount,
  getFallbackWireIds,
  findDivergencePoints,
  type DisplayedWirePath,
} from '../src/wireRouter';
import { buildRouteInputs, checkCircuitLayout, checkFixtureLayout } from './layoutCheck';
import { comp, wire, circuit } from './builder';
import type { CircuitData, CircuitComponent } from '../src/types';

/** Route a machine exactly as the canvas/oracle would and return the raw
 *  per-wire results (for the flag pins — checkCircuitLayout hides them). */
function routeMachine(machine: CircuitData) {
  return routeAllWires(buildRouteInputs(machine), machine.components as CircuitComponent[], undefined);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures');

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const nearPt = (p: { x: number; y: number }, x: number, y: number) => near(p.x, x) && near(p.y, y);

// ─── 1. Geometry smoke — shared module matches the rendered SVG bodies ──────

console.log('GEOMETRY SMOKE — componentGeometry pins (rendered dimensions + port math)');
{
  const dims = (type: Parameters<typeof comp>[1], extra = {}) =>
    getComponentSize(comp('t', type, type, 0, 0, extra));
  const eqDims = (d: { w: number; h: number }, w: number, h: number) => d.w === w && d.h === h;

  check('INPUT renders 40×40', eqDims(dims('INPUT'), 40, 40));
  check('OUTPUT renders 40×40', eqDims(dims('OUTPUT'), 40, 40));
  check('NOT renders 55×50', eqDims(dims('NOT'), 55, 50));
  check('AND/OR/XOR render 75×70',
    eqDims(dims('AND'), 75, 70) && eqDims(dims('OR'), 75, 70) && eqDims(dims('XOR'), 75, 70));
  check('HA renders 75×80', eqDims(dims('HA'), 75, 80));
  check('MEM renders 50×50 (NOT the old phantom 75×70 router default)',
    eqDims(dims('MEM'), 50, 50));
  check('STATE renders 60×60', eqDims(dims('STATE'), 60, 60));
  check('boxed STATE renders 90×50', eqDims(dims('STATE', { boxedCircuitId: 'b1' }), 90, 50));

  // Port math: two left ports on a 70-tall gate sit at h/3 and 2h/3.
  const and = comp('a', 'AND', 'AND', 100, 100);
  check('AND in1/in2 at left edge, spaced h/3',
    nearPt(getPortPosition(and, 'in1'), 100, 100 + 70 / 3) &&
    nearPt(getPortPosition(and, 'in2'), 100, 100 + 140 / 3));
  check('AND out at right edge, centered',
    nearPt(getPortPosition(and, 'out'), 175, 135));

  // OR/XOR left-port inset: the curved face pulls left ports inward.
  const or = comp('o', 'OR', 'OR', 100, 100);
  const xor = comp('x', 'XOR', 'XOR', 100, 100);
  check('OR left ports inset by 7% of width (x = 105.25)',
    near(getPortPositionLocal(or, 'in1').x, 100 + 75 * 0.07));
  check('XOR left ports inset a further 6px (x = 111.25)',
    near(getPortPositionLocal(xor, 'in1').x, 100 + 6 + 75 * 0.07));

  // MEM ports: mout on the left face, min on the RIGHT face at x+50 — the
  // 50×50 body is exactly why min's stub tip (x+62) cleared the phantom
  // 75×70 bounds fix.
  const mem = comp('m', 'MEM', 'MEM', 200, 300);
  check('MEM mout at left-center (200, 325)', nearPt(getPortPosition(mem, 'mout'), 200, 325));
  check('MEM min at right-center (250, 325)', nearPt(getPortPosition(mem, 'min'), 250, 325));

  // Rotation: an INPUT rotated 90° points its out port south.
  const rotIn = comp('r', 'INPUT', 'IN', 0, 0, { rotation: 90 });
  check('INPUT rotated 90° has out at bottom-center (20, 40)',
    nearPt(getPortPosition(rotIn, 'out'), 20, 40));
}

// ─── 2. MEM.min reachability + fallback-counter tripwire ────────────────────

console.log('\nMEM ROUTING — A* reaches MEM.min in a clean field (no fallback)');
{
  // SC delay register in an open field: INPUT → MEM.min, MEM.mout → OUTPUT.
  // Pre-fix, the min-side wire was doomed (stub tip inside phantom bounds).
  const machine = circuit(
    [
      comp('in1', 'INPUT', 'IN1', 100, 100),
      comp('m1', 'MEM', 'MEM', 400, 100),
      comp('out1', 'OUTPUT', 'OUT1', 150, 300),
    ],
    [
      wire('w1', 'in1', 'out', 'm1', 'min'),
      wire('w2', 'm1', 'mout', 'out1', 'in'),
    ],
  );
  resetFallbackCount();
  const violations = checkCircuitLayout(machine, 'mem-min');
  check('MEM wires route via A* (0 fallbacks)', getFallbackCount() === 0);
  check('MEM machine is oracle-clean', violations.length === 0);

  // XOR reachability: the left-port inset (11.25px) puts the stub tip
  // 4.25px inside the XOR's own expanded bounds. Pre-exemption this made
  // every XOR-in wire structurally unreachable (3 fallbacks each, the whole
  // pinned budget); the own-endpoint exemption must keep the goal reachable.
  const xorMachine = circuit(
    [
      comp('xin1', 'INPUT', 'IN1', 100, 100),
      comp('xin2', 'INPUT', 'IN2', 100, 250),
      comp('x1', 'XOR', 'XOR', 400, 150),
      comp('xout1', 'OUTPUT', 'OUT1', 700, 170),
    ],
    [
      wire('xw1', 'xin1', 'out', 'x1', 'in1'),
      wire('xw2', 'xin2', 'out', 'x1', 'in2'),
      wire('xw3', 'x1', 'out', 'xout1', 'in'),
    ],
  );
  resetFallbackCount();
  const xorViolations = checkCircuitLayout(xorMachine, 'xor-in');
  check('XOR-in wires route via A* (0 fallbacks — own-endpoint exemption)', getFallbackCount() === 0);
  check('XOR machine is oracle-clean', xorViolations.length === 0);

  // Tripwire: a genuinely doomed wire MUST increment the counter. The
  // OUTPUT's stub tip is buried inside a FOREIGN AND's expanded bounds —
  // foreign components are never exempt — so every incident edge is blocked
  // and A* has to give up.
  const doomed = circuit(
    [
      comp('in2', 'INPUT', 'IN1', 100, 100),
      comp('blocker', 'AND', 'AND', 330, 85),
      comp('out2', 'OUTPUT', 'OUT1', 400, 100),
    ],
    [wire('w3', 'in2', 'out', 'out2', 'in')],
  );
  resetFallbackCount();
  checkCircuitLayout(doomed, 'doomed');
  check('fallback counter fires on a doomed wire (tripwire)', getFallbackCount() > 0);
}

// ─── 3. Fallback budget across the CC/SC reference fixtures ─────────────────
// Pinned state: 2 total. The own-endpoint exemption (wireRouter.ts) erased
// the structural XOR floor that used to account for the ENTIRE 147-fallback
// budget (3 per XOR-in wire — stub tip born inside the XOR's own expanded
// bounds — plus capacity misses from the old flat 5000-iteration A* cap,
// which now scales with the grid). History: 283 → 99 (MEM 50×50 bounds fix)
// → 147 (hw3-p11 added, 16 XOR-in wires) → 2 (own-endpoint exemption +
// near-parallel overlap costs + scaled iteration cap).
//
// The residual is hw3-p9's w21 (MEM.mout → HA.in1 in the monster correct
// machine): its only goal approach is occupied by a foreign parallel track,
// so the cheapest legal path costs overlap-scale (~100k) and proving that
// would take ~240k iterations — the scaled cap (grid nodes ≈ 35k) cuts the
// search off and the wire takes an oracle-clean fallback instead. That is
// the fallback lane doing its job on a genuinely cramped layout, not a
// world-model bug. Update the table deliberately, never upward without a
// design decision.

const MAX_TOTAL_FALLBACKS = 2;
const EXPECTED_FALLBACKS: Record<string, number> = {
  'hw3-p9': 2, // w21, genuinely cramped goal approach — see header note
  // every other CC/SC fixture: 0
};

console.log('\nFALLBACK BUDGET — CC/SC reference fixtures (canvas-identical routing)');
{
  const manifest = JSON.parse(
    readFileSync(join(FIXTURES, 'coverage-manifest.json'), 'utf8'),
  ) as { rows: { id: string; mode: string; fixture: string | null }[] };

  let total = 0;
  let distributionOk = true;
  let allClean = true;
  for (const row of manifest.rows) {
    if (!row.fixture || (row.mode !== 'CC' && row.mode !== 'SC')) continue;
    resetFallbackCount();
    const { violations } = checkFixtureLayout(join(FIXTURES, row.fixture));
    const n = getFallbackCount();
    total += n;
    const expected = EXPECTED_FALLBACKS[row.id] ?? 0;
    if (n !== expected) {
      distributionOk = false;
      console.log(`    ${row.id}: ${n} fallbacks (pinned ${expected}) — wires: ${getFallbackWireIds().join(', ')} — if deliberate, update EXPECTED_FALLBACKS`);
    }
    if (violations.length > 0) {
      allClean = false;
      for (const v of violations) console.log(`    ${row.id} [${v.kind}] ${v.machine}: ${v.detail}`);
    }
  }
  check(`fallback total within budget (${total} <= ${MAX_TOTAL_FALLBACKS})`, total <= MAX_TOTAL_FALLBACKS);
  check('fallback residual distribution matches the pinned table', distributionOk);
  check('every CC/SC fixture is oracle-clean', allClean);
}

// ─── 4. Divergence dots — findDivergencePoints corpus ───────────────────────

console.log('\nDIVERGENCE DOTS — junction dots on displayed fan-out paths');
{
  const p = (x: number, y: number) => ({ x, y });
  const dw = (sourcePortKey: string, points: { x: number; y: number }[]): DisplayedWirePath =>
    ({ sourcePortKey, points });
  const KEY = 'src:out';

  // Port at (100,100), stub tip at (112,100). A runs straight east; B shares
  // the trunk to x=200 then turns north; C leaves the trunk at the stub tip.
  const A = [p(100, 100), p(112, 100), p(300, 100)];
  const B = [p(100, 100), p(112, 100), p(200, 100), p(200, 40)];
  const C = [p(100, 100), p(112, 100), p(112, 180), p(240, 180)];

  let dots = findDivergencePoints([dw(KEY, A), dw(KEY, B)]);
  check('trunk fanout: one dot at the divergence elbow (200,100)',
    dots.length === 1 && nearPt(dots[0], 200, 100));

  dots = findDivergencePoints([dw(KEY, A), dw(KEY, C)]);
  check('stub-tip divergence subsumes the port dot: dot at (112,100), not (100,100)',
    dots.length === 1 && nearPt(dots[0], 112, 100));

  dots = findDivergencePoints([dw(KEY, A), dw(KEY, B), dw(KEY, C)]);
  const hasElbow = dots.some((d) => nearPt(d, 200, 100));
  const hasStubTip = dots.some((d) => nearPt(d, 112, 100));
  check('three-branch trunk: two junction dots, pairwise duplicates deduped',
    dots.length === 2 && hasElbow && hasStubTip);

  // Same trunk, different segmentation: an extra collinear waypoint mid-trunk
  // (e.g. left by a manual drag elsewhere) must not read as a junction.
  const B2 = [p(100, 100), p(112, 100), p(150, 100), p(200, 100), p(200, 40)];
  dots = findDivergencePoints([dw(KEY, A), dw(KEY, B2)]);
  check('extra collinear waypoints do not fake a junction (dot stays at 200,100)',
    dots.length === 1 && nearPt(dots[0], 200, 100));

  dots = findDivergencePoints([dw('s1:out', A), dw('s2:out', C)]);
  check('different-source wires never get a junction dot', dots.length === 0);

  dots = findDivergencePoints([dw(KEY, A)]);
  check('a lone wire gets no dot', dots.length === 0);

  dots = findDivergencePoints([dw(KEY, A), dw(KEY, A.map((q) => ({ ...q })))]);
  check('identical paths never diverge (no dot)', dots.length === 0);

  // Bump-collision skip: the skip consumes CANVAS-side crossings. A crossing
  // near the (200,100) elbow (within bump 5 + dot 4 = 9px) suppresses the dot;
  // a crossing farther along the trunk does not.
  dots = findDivergencePoints([dw(KEY, A), dw(KEY, B)], [p(201, 102)]);
  check('dot within bump radius of a canvas-side crossing is skipped', dots.length === 0);

  dots = findDivergencePoints([dw(KEY, A), dw(KEY, B)], [p(215, 100)]);
  check('crossing beyond bump-collision range leaves the dot',
    dots.length === 1 && nearPt(dots[0], 200, 100));
}

// ─── 5. Route-quality flags — usedFallback / violation ──────────────────────

console.log('\nROUTE-QUALITY FLAGS — usedFallback / violation on WireRouteResult');
{
  // hw3-p9: the one fixture with residual fallbacks. w21's FINAL route must
  // be flagged usedFallback; and it must be violation-free — the recorded
  // rationale for skipping the S4 lane-nudge. Every A*-routed wire in the
  // same machine carries neither flag.
  const p9 = JSON.parse(
    readFileSync(join(FIXTURES, 'reference', 'hw3-p9.json'), 'utf8'),
  ) as { correct: CircuitData };
  resetFallbackCount();
  const p9Results = routeMachine(p9.correct);
  const w21 = p9Results.find((r) => r.wireId === 'hw3-p9-w21');
  const otherFlagged = p9Results.filter(
    (r) => r.wireId !== 'hw3-p9-w21' && (r.usedFallback || r.violation),
  );
  check('hw3-p9 w21 (residual fallback) is flagged usedFallback',
    w21?.usedFallback === true);
  check('hw3-p9 w21 fallback is oracle-clean (no violation — lane-nudge not needed)',
    w21 !== undefined && w21.violation === undefined);
  check('no other hw3-p9 wire carries a flag', otherFlagged.length === 0);

  // Doomed tripwire (same layout as §2): the OUTPUT's stub tip is buried in
  // a FOREIGN AND's bounds, so phase 0 sends the wire straight to the
  // fallback — and its L-path cuts through the blocker's rendered body, so
  // the final oracle-predicate sweep must flag a violation too.
  const doomed = circuit(
    [
      comp('in2', 'INPUT', 'IN1', 100, 100),
      comp('blocker', 'AND', 'AND', 330, 85),
      comp('out2', 'OUTPUT', 'OUT1', 400, 100),
    ],
    [wire('w3', 'in2', 'out', 'out2', 'in')],
  );
  resetFallbackCount();
  const doomedResults = routeMachine(doomed);
  const w3 = doomedResults.find((r) => r.wireId === 'w3');
  check('doomed wire is flagged usedFallback (phase-0 fallback)',
    w3?.usedFallback === true);
  check('doomed wire carries a body-pass-through violation naming the blocker',
    w3?.violation !== undefined && w3.violation.includes('blocker'));
  check('doomed wire falls back exactly once (phase 0; validation skips doomed wires)',
    getFallbackCount() === 1);
}

// ─── 6. Pre-fix layout regression pin ────────────────────────────────────────
// The P1.3-era hw3-p4 component positions (git 0d0c5e5). Under the pre-P1.8
// router this layout produced 4 collinear-overlap pairs (LOG 2026-07-06,
// iteration 7) and was repositioned to dodge them — the fixture nudge, not a
// router fix. Today's router must route the ORIGINAL layout clean: displace
// the current fixture's components back to the historical positions and run
// the full oracle. Fallbacks are allowed (reported only); violations are not.

console.log('\nPRE-FIX LAYOUT — historical hw3-p4 (P1.3 positions) routes oracle-clean today');
{
  const PREFIX_POSITIONS: Record<string, Record<string, { x: number; y: number }>> = {
    correct: {
      'hw3-p4-in1': { x: 80, y: 320 },
      'hw3-p4-m1': { x: 360, y: 60 },
      'hw3-p4-m2': { x: 680, y: 60 },
      'hw3-p4-not1': { x: 360, y: 220 },
      'hw3-p4-or1': { x: 520, y: 140 },
      'hw3-p4-or2': { x: 600, y: 320 },
    },
    broken: {
      'hw3-p4-in1': { x: 80, y: 320 },
      'hw3-p4-m1': { x: 360, y: 60 },
      'hw3-p4-out1': { x: 760, y: 320 },
    },
  };

  const fx = JSON.parse(
    readFileSync(join(FIXTURES, 'reference', 'hw3-p4.json'), 'utf8'),
  ) as { correct: CircuitData; broken: CircuitData };

  for (const key of ['correct', 'broken'] as const) {
    const machine = JSON.parse(JSON.stringify(fx[key])) as CircuitData;
    let displaced = 0;
    for (const c of machine.components as CircuitComponent[]) {
      const pos = PREFIX_POSITIONS[key][c.id];
      if (pos && (c.x !== pos.x || c.y !== pos.y)) {
        c.x = pos.x;
        c.y = pos.y;
        displaced++;
      }
    }
    check(`${key}: historical displacement applied (fixture has drifted from P1.7 positions)`,
      displaced === Object.keys(PREFIX_POSITIONS[key]).length);

    resetFallbackCount();
    const violations = checkCircuitLayout(machine, `hw3-p4-prefix-${key}`);
    for (const v of violations) console.log(`    [${v.kind}] ${v.machine}: ${v.detail}`);
    const n = getFallbackCount();
    if (n > 0) console.log(`    (${key}: ${n} fallback(s) — allowed here: ${getFallbackWireIds().join(', ')})`);
    check(`${key}: zero oracle violations on the pre-fix layout`, violations.length === 0);
  }
}

console.log(`\n${failures === 0 ? 'ROUTER CHECK OK' : `ROUTER CHECK FAILED (${failures} checks)`}`);
process.exit(failures === 0 ? 0 : 1);
