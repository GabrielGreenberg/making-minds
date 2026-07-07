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
//   2. MEM.min REACHABILITY — the root cause of the HW3 appearance failures:
//      the router's private geometry table had no MEM case, so MEM fell to a
//      phantom 75×70 obstacle and every wire incident on MEM.min's stub was
//      born blocked, taking the obstacle-blind fallback. Pin: in a clean
//      field, a MEM wire routes via A* (zero fallbacks) and is oracle-clean.
//      Plus a tripwire proving the fallback counter actually fires (a counter
//      that cannot count is not instrumenting anything).
//
//   3. FALLBACK BUDGET — route every CC/SC reference fixture exactly as the
//      canvas would and pin the fallbackPath invocation counts: ≤ 99 total
//      (was 283 before the bounds fix), with the residual distribution pinned
//      per fixture. New fixtures must route fallback-free or be added to the
//      table DELIBERATELY; later slices (S3/S4) ratchet these numbers down.
//      Every fixture must also stay oracle-clean (layoutCheck predicates).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  getComponentSize,
  getPortPosition,
  getPortPositionLocal,
} from '../src/componentGeometry';
import { resetFallbackCount, getFallbackCount } from '../src/wireRouter';
import { checkCircuitLayout, checkFixtureLayout } from './layoutCheck';
import { comp, wire, circuit } from './builder';

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

  // Tripwire: a genuinely doomed wire MUST increment the counter. The
  // OUTPUT's stub tip is buried inside a foreign AND's expanded bounds, so
  // every incident edge is blocked and A* has to give up.
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
// Pinned S1 state (bounds fix): 99 total, residuals exactly in the eight
// fixtures below (was 283 before MEM got real 50×50 bounds). S3/S4 are
// expected to LOWER these — update the table deliberately, never upward
// without a design decision.

const MAX_TOTAL_FALLBACKS = 99;
const EXPECTED_FALLBACKS: Record<string, number> = {
  'hw2-p3': 6,
  'hw2-p7': 24,
  'hw3-p1': 15,
  'hw3-p2': 24,
  'hw3-p5': 12,
  'hw3-p6': 6,
  'hw3-p8': 3,
  'hw3-p9': 9,
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
      console.log(`    ${row.id}: ${n} fallbacks (pinned ${expected}) — if deliberate, update EXPECTED_FALLBACKS`);
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

console.log(`\n${failures === 0 ? 'ROUTER CHECK OK' : `ROUTER CHECK FAILED (${failures} checks)`}`);
process.exit(failures === 0 ? 0 : 1);
