/**
 * layoutCheck — the LAYOUT ORACLE for reference-fixture machines (CC/SC only).
 *
 * Re-creates exactly what CircuitCanvas.tsx does on first render:
 *   - port positions and rendered dimensions via src/componentGeometry.ts —
 *     the SAME module the canvas and wireRouter import (structural guarantee:
 *     the oracle's geometry can never desync from the renderer's again)
 *   - routeAllWires(routeInputs, components, undefined)  [no previousPaths]
 *
 * Then reports, per machine:
 *   (a) collinear / near-parallel overlapping segment pairs from DIFFERENT
 *       sources (same axis, lines within 3px of each other, shared span > 1px;
 *       pairs sharing a sourcePortKey are legitimate fan-out trunks — exempt)
 *   (b) segments passing through a FOREIGN component's rendered body rect
 *       (a wire's own first segment vs its source comp and its own last
 *        segment vs its target comp are exempt — port stubs touch their body)
 *   (c) component-box overlaps (pairwise rendered rects, strict interior)
 *
 * Scope: only CC/SC machines route through src/wireRouter. FSM/TM/turbot
 * STATE-node transitions draw as curves and bypass the router entirely — do
 * not run this oracle on them (coverageCheck gates on the manifest mode).
 *
 * CLI:  cd app/ && npx tsx tools/layoutCheck.ts <fixture.json> [--verbose]
 * API:  checkFixtureLayout(path) → { violations }, or checkCircuitLayout(machine)
 *       for an in-memory CircuitData (used by the coverage self-test).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { routeAllWires, type WireRouteInput } from '../src/wireRouter';
import { getComponentSize, getPortPosition } from '../src/componentGeometry';
import type { CircuitComponent, Wire, CircuitData } from '../src/types';

// ─── Segment machinery ──────────────────────────────────────────────────────

interface Seg {
  wireId: string;
  sourcePortKey: string;
  sourceCompId: string;
  targetCompId: string;
  index: number; // segment index within its wire
  count: number; // total segments in the wire
  x1: number; y1: number; x2: number; y2: number;
}

// EPS 0.5 decides whether a segment is axis-aligned (collinearity axis check);
// the 3px tolerance below catches near-parallel tracks from different sources
// that render as visually-merged wires even when not exactly collinear.
const EPS = 0.5;
const isHoriz = (s: Seg) => Math.abs(s.y1 - s.y2) < EPS;
const isVert = (s: Seg) => Math.abs(s.x1 - s.x2) < EPS;

function collinearOverlap(a: Seg, b: Seg): boolean {
  if (isHoriz(a) && isHoriz(b) && Math.abs(a.y1 - b.y1) < 3) {
    const lo = Math.max(Math.min(a.x1, a.x2), Math.min(b.x1, b.x2));
    const hi = Math.min(Math.max(a.x1, a.x2), Math.max(b.x1, b.x2));
    return hi - lo > 1; // positive shared span, not a mere endpoint touch
  }
  if (isVert(a) && isVert(b) && Math.abs(a.x1 - b.x1) < 3) {
    const lo = Math.max(Math.min(a.y1, a.y2), Math.min(b.y1, b.y2));
    const hi = Math.min(Math.max(a.y1, a.y2), Math.max(b.y1, b.y2));
    return hi - lo > 1;
  }
  return false;
}

/** Strict-interior axis-aligned segment vs rect test (same as wireRouter's). */
function segThroughRect(s: Seg, r: { left: number; top: number; right: number; bottom: number }): boolean {
  const minX = Math.min(s.x1, s.x2), maxX = Math.max(s.x1, s.x2);
  const minY = Math.min(s.y1, s.y2), maxY = Math.max(s.y1, s.y2);
  if (maxX <= r.left || minX >= r.right || maxY <= r.top || minY >= r.bottom) return false;
  if (isHoriz(s)) return s.y1 > r.top && s.y1 < r.bottom && maxX > r.left && minX < r.right;
  if (isVert(s)) return s.x1 > r.left && s.x1 < r.right && maxY > r.top && minY < r.bottom;
  return false;
}

// ─── Oracle ─────────────────────────────────────────────────────────────────

export interface LayoutViolation {
  /** Which machine in the fixture ('correct' | 'broken', or a caller label). */
  machine: string;
  kind: 'collinear-overlap' | 'body-pass-through' | 'box-overlap';
  detail: string;
}

/**
 * Route one machine exactly as the canvas would and return every layout
 * violation. Pure geometry — grading is the coverage harness's job.
 */
export function checkCircuitLayout(machine: CircuitData, machineName = 'machine'): LayoutViolation[] {
  const components = machine.components as CircuitComponent[];
  const wires = machine.wires as Wire[];
  const violations: LayoutViolation[] = [];

  // Build route inputs exactly like CircuitCanvas (wire array order).
  const routeInputs: WireRouteInput[] = [];
  for (const w of wires) {
    const sourceComp = components.find((c) => c.id === w.sourceComponentId);
    const targetComp = components.find((c) => c.id === w.targetComponentId);
    if (!sourceComp || !targetComp) continue;
    const from = getPortPosition(sourceComp, w.sourcePortId);
    const to = getPortPosition(targetComp, w.targetPortId);
    const sourcePort = sourceComp.ports.find((p) => p.id === w.sourcePortId);
    const targetPort = targetComp.ports.find((p) => p.id === w.targetPortId);
    routeInputs.push({
      wireId: w.id,
      sourceComp,
      targetComp,
      sourcePortId: w.sourcePortId,
      targetPortId: w.targetPortId,
      sourcePortSide: sourcePort?.side ?? 'right',
      targetPortSide: targetPort?.side ?? 'left',
      sourcePos: from,
      targetPos: to,
      sourcePortKey: `${w.sourceComponentId}:${w.sourcePortId}`,
    });
  }

  const results = routeAllWires(routeInputs, components, undefined);

  // Enumerate segments.
  const segs: Seg[] = [];
  for (const result of results) {
    const input = routeInputs.find((r) => r.wireId === result.wireId)!;
    const pts = result.points;
    const total = pts.length - 1;
    for (let i = 0; i < total; i++) {
      const a = pts[i], b = pts[i + 1];
      if (Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS) continue; // zero-length
      segs.push({
        wireId: result.wireId,
        sourcePortKey: input.sourcePortKey,
        sourceCompId: input.sourceComp.id,
        targetCompId: input.targetComp.id,
        index: i,
        count: total,
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      });
    }
  }

  // (a) collinear/near-parallel overlapping pairs from different sources.
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const a = segs[i], b = segs[j];
      if (a.wireId === b.wireId) continue;
      if (a.sourcePortKey === b.sourcePortKey) continue; // legit fan-out trunk
      if (!collinearOverlap(a, b)) continue;
      violations.push({
        machine: machineName,
        kind: 'collinear-overlap',
        detail:
          `${a.wireId}#${a.index} (${a.x1},${a.y1})-(${a.x2},${a.y2})` +
          ` ~ ${b.wireId}#${b.index} (${b.x1},${b.y1})-(${b.x2},${b.y2})`,
      });
    }
  }

  // (b) segments through foreign component bodies (rendered rects).
  for (const s of segs) {
    for (const c of components) {
      if (s.index === 0 && c.id === s.sourceCompId) continue; // own source stub
      if (s.index === s.count - 1 && c.id === s.targetCompId) continue; // own target stub
      const { w, h } = getComponentSize(c);
      const rect = { left: c.x, top: c.y, right: c.x + w, bottom: c.y + h };
      if (segThroughRect(s, rect)) {
        violations.push({
          machine: machineName,
          kind: 'body-pass-through',
          detail: `${s.wireId}#${s.index} (${s.x1},${s.y1})-(${s.x2},${s.y2}) through ${c.id}`,
        });
      }
    }
  }

  // (c) component-box overlaps.
  for (let i = 0; i < components.length; i++) {
    for (let j = i + 1; j < components.length; j++) {
      const a = components[i], b = components[j];
      const da = getComponentSize(a), db = getComponentSize(b);
      const overlap =
        a.x < b.x + db.w && b.x < a.x + da.w &&
        a.y < b.y + db.h && b.y < a.y + da.h;
      if (overlap) {
        violations.push({ machine: machineName, kind: 'box-overlap', detail: `${a.id} overlaps ${b.id}` });
      }
    }
  }

  return violations;
}

/**
 * Load a reference fixture and run the oracle on its machines (each machine is
 * routed exactly once). Returns every violation across correct + broken.
 */
export function checkFixtureLayout(fixturePath: string): { violations: LayoutViolation[] } {
  const fx = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
    correct?: CircuitData;
    broken?: CircuitData;
  };
  const violations: LayoutViolation[] = [];
  for (const key of ['correct', 'broken'] as const) {
    const machine = fx[key];
    if (machine) violations.push(...checkCircuitLayout(machine, key));
  }
  return { violations };
}

// ─── CLI ────────────────────────────────────────────────────────────────────

const isMain = !!process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const fixtureArg = process.argv.slice(2).find((a) => a.endsWith('.json'));
  if (!fixtureArg) {
    console.error('usage: npx tsx tools/layoutCheck.ts <fixture.json>');
    process.exit(2);
  }
  const { violations } = checkFixtureLayout(resolve(fixtureArg));
  for (const v of violations) {
    console.log(`  [${v.kind}] ${v.machine}: ${v.detail}`);
  }
  console.log(violations.length === 0 ? 'ORACLE: CLEAN' : `ORACLE: FAIL (${violations.length} violation(s))`);
  process.exit(violations.length === 0 ? 0 : 1);
}
