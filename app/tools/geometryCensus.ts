// geometryCensus — which stored circuits does a change of part geometry
// break? (task 2026-09-25-056, the regularized gate shapes.) For every
// circuit the repo holds — each reference fixture's correct and broken
// machines, the dev sample data — it lists the pairs of parts whose rendered
// rects overlap under the CURRENT geometry (src/componentGeometry.ts) but
// did not under the LEGACY one frozen below (the sizes before 056), with the
// layout oracle's rule (layoutCheck (c): strict interior of the footprints).
// Report-only; exit 0. It is also the recipe for the owed real-workbook pass:
// point it at circuits exported from a private DB copy and report counts only
// (student work never enters the repo — PROFILE §8 law 9).
//
//   cd app && npx tsx tools/geometryCensus.ts [--verbose]

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CircuitComponent, CircuitData } from '../src/types';
import { getComponentSize } from '../src/componentGeometry';
import * as sample from '../src/devData/sampleData';

const verbose = process.argv.includes('--verbose');

/** The part sizes before task 056 (w × h): AND, OR, XOR and a placed box all
 *  fell to one 75×70 default; NOT was 55×50. */
function legacySize(c: CircuitComponent): { w: number; h: number } {
  switch (c.type) {
    case 'INPUT':
    case 'OUTPUT':
      return { w: 40, h: 40 };
    case 'NOT':
      return { w: 55, h: 50 };
    case 'HA':
      return { w: 75, h: 80 };
    case 'MEM':
      return { w: 50, h: 50 };
    case 'STATE':
      return { w: 60, h: 60 };
    default:
      return { w: 75, h: 70 };
  }
}

type SizeOf = (c: CircuitComponent) => { w: number; h: number };
/** The rendered footprint (an INPUT's toggle tab, 14 + the seam, to its left). */
function rect(c: CircuitComponent, size: SizeOf) {
  const { w, h } = size(c);
  return { left: c.type === 'INPUT' ? c.x - 14.75 : c.x, top: c.y, right: c.x + w, bottom: c.y + h };
}
function overlaps(a: CircuitComponent, b: CircuitComponent, size: SizeOf): boolean {
  const ra = rect(a, size), rb = rect(b, size);
  return ra.left < rb.right && rb.left < ra.right && ra.top < rb.bottom && rb.top < ra.bottom;
}

export interface CensusRow { circuit: string; parts: number; newOverlaps: string[]; resolvedOverlaps: number }

/** Pairs overlapping under the current geometry but not the legacy one. */
export function censusOf(name: string, machine: CircuitData): CensusRow {
  const comps = machine.components.filter((c) => c.type !== 'STATE');
  const newOverlaps: string[] = [];
  let resolvedOverlaps = 0;
  for (let i = 0; i < comps.length; i++) {
    for (let j = i + 1; j < comps.length; j++) {
      const now = overlaps(comps[i], comps[j], getComponentSize);
      const then = overlaps(comps[i], comps[j], legacySize);
      if (now && !then) newOverlaps.push(`${comps[i].id}(${comps[i].type}) × ${comps[j].id}(${comps[j].type})`);
      if (then && !now) resolvedOverlaps++;
    }
  }
  return { circuit: name, parts: machine.components.length, newOverlaps, resolvedOverlaps };
}

export function repoCircuits(): [string, CircuitData][] {
  const out: [string, CircuitData][] = [];
  const dir = join(import.meta.dirname, 'fixtures/reference');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const fx = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { correct: CircuitData; broken?: CircuitData };
    out.push([`${f.replace('.json', '')} correct`, fx.correct]);
    if (fx.broken) out.push([`${f.replace('.json', '')} broken`, fx.broken]);
  }
  for (const [name, fn] of Object.entries(sample)) {
    if (typeof fn !== 'function' || fn.length !== 0 || !/Correct$|Incorrect$/.test(name)) continue;
    const c = (fn as () => CircuitData)();
    if (c && Array.isArray(c.components)) out.push([`sample ${name}`, c]);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = repoCircuits().map(([name, c]) => censusOf(name, c));
  const hit = rows.filter((r) => r.newOverlaps.length > 0);
  console.log(`geometryCensus: ${rows.length} stored circuits, ${hit.length} with new overlaps, ` +
    `${rows.reduce((s, r) => s + r.newOverlaps.length, 0)} new overlapping pairs ` +
    `(${rows.reduce((s, r) => s + r.resolvedOverlaps, 0)} old overlaps resolved).`);
  for (const r of hit) {
    console.log(`  ${r.circuit}: ${r.newOverlaps.length} new (${r.parts} parts)`);
    if (verbose) for (const o of r.newOverlaps) console.log(`      ${o}`);
  }
}
