/**
 * bumpCheck — headless bump-renderability predicate for reference fixtures.
 *
 * Replicates CircuitCanvas.tsx exactly:
 *   1. Route with the real routeAllWires (no previousPaths, no manualSegments —
 *      fixtures carry none), geometry from componentGeometry.
 *   2. Canvas crossing detection (CircuitCanvas ~line 3873): for each wire's
 *      horizontal segments vs every OTHER wire's vertical segments,
 *      crossing recorded on the HORIZONTAL wire when
 *        c.x > minHx+1 && c.x < maxHx-1 && a.y > minVy+1 && a.y < maxVy-1.
 *   3. pathDWithBumps skip rule (R=5): a crossing is DRAWN only if some
 *      horizontal segment of the owning wire passes
 *        |cp.y - a.y| < 2 && cp.x > minX + R && cp.x < maxX - R.
 *
 * Any detected crossing not drawn by any segment = BUMPLESS (defect).
 *
 * usage: cd app/ && npx tsx <this file> <fixture.json>
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { routeAllWires, type WireRouteInput } from '/Users/gabriel/Programming/making-minds/app/src/wireRouter';
import { getPortPosition } from '/Users/gabriel/Programming/making-minds/app/src/componentGeometry';

const R = 5;
type Pt = { x: number; y: number };

function checkMachine(machine: any, name: string): { bumpless: string[]; totalCrossings: number } {
  const components = machine.components as any[];
  const wires = machine.wires as any[];
  const routeInputs: WireRouteInput[] = [];
  for (const w of wires) {
    const sourceComp = components.find((c) => c.id === w.sourceComponentId);
    const targetComp = components.find((c) => c.id === w.targetComponentId);
    if (!sourceComp || !targetComp) continue;
    const from = getPortPosition(sourceComp, w.sourcePortId);
    const to = getPortPosition(targetComp, w.targetPortId);
    const sourcePort = sourceComp.ports.find((p: any) => p.id === w.sourcePortId);
    const targetPort = targetComp.ports.find((p: any) => p.id === w.targetPortId);
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
  const data = new Map<string, Pt[]>();
  for (const r of results) data.set(r.wireId, r.points);

  const bumpless: string[] = [];
  let totalCrossings = 0;

  for (const [wireId, pts] of data) {
    // canvas crossing detection (crossing owned by the horizontal wire)
    const crossings: { x: number; y: number; via: string }[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (Math.abs(a.y - b.y) > 0.5) continue;
      const minHx = Math.min(a.x, b.x), maxHx = Math.max(a.x, b.x);
      for (const [otherId, opts] of data) {
        if (otherId === wireId) continue;
        for (let j = 0; j < opts.length - 1; j++) {
          const c = opts[j], d = opts[j + 1];
          if (Math.abs(c.x - d.x) > 0.5) continue;
          const minVy = Math.min(c.y, d.y), maxVy = Math.max(c.y, d.y);
          if (c.x > minHx + 1 && c.x < maxHx - 1 && a.y > minVy + 1 && a.y < maxVy - 1) {
            crossings.push({ x: c.x, y: a.y, via: otherId });
          }
        }
      }
    }
    totalCrossings += crossings.length;
    if (crossings.length === 0) continue;

    // pathDWithBumps: which crossings actually get an arc drawn?
    const drawn = new Set<object>();
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (Math.abs(a.y - b.y) >= 0.5) continue; // isHoriz check (< 0.5)
      const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
      for (const cp of crossings) {
        if (Math.abs(cp.y - a.y) < 2 && cp.x > minX + R && cp.x < maxX - R) drawn.add(cp);
      }
    }
    for (const cp of crossings) {
      if (!drawn.has(cp)) {
        bumpless.push(`${name}: wire ${wireId} crossed by ${cp.via} at (${cp.x},${cp.y}) — NO BUMP`);
      }
    }
  }
  return { bumpless, totalCrossings };
}

const fixturePath = resolve(process.argv[2]);
const fx = JSON.parse(readFileSync(fixturePath, 'utf8'));
let anyBad = false;
for (const key of ['correct', 'broken']) {
  const m = fx[key];
  if (!m) continue;
  const { bumpless, totalCrossings } = checkMachine(m, key);
  console.log(`${key}: ${totalCrossings} crossings detected, ${bumpless.length} bumpless`);
  for (const line of bumpless) { console.log('  ' + line); anyBad = true; }
}
console.log(anyBad ? 'BUMP PREDICATE: FAIL' : 'BUMP PREDICATE: CLEAN');
process.exit(anyBad ? 1 : 0);
