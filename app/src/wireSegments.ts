// A wire's manual segment moves (the student dragged a middle run of a wire
// aside), re-applied to the freshly routed path — pure, so the harness pins
// it (routerCheck). An offset belongs to the route it was dragged on: moving
// a part clears the offsets on its wires (store.ts moveComponentsBatch), and
// an offset whose routed segment has since moved (a changed part geometry —
// task 056 — or a router change) is stale and is not applied, rather than
// shoving some other run of the re-routed wire aside.

import type { WireManualSegment } from './types';

type Pt = { x: number; y: number };

/** Is this segment one a student may drag? Never a port stub or the run
 *  straight after it (the first and last two segments): moving those would
 *  pull the wire off its port. The canvas's drag rules use the same range. */
export function isDraggableSegment(index: number, pointCount: number): boolean {
  return index >= 2 && index < pointCount - 3;
}

/** Apply manual segment overrides to a computed wire path, keeping it
 *  connected (a shifted segment's neighbours stretch). An override applies
 *  only to a draggable segment of the right orientation, and — when it
 *  recorded where its segment was routed (`base`) — only while the routed
 *  segment is still there. */
export function applyManualSegments(points: Pt[], manualSegments?: WireManualSegment[]): Pt[] {
  if (!manualSegments || manualSegments.length === 0) return points;
  const result = points.map((p) => ({ ...p }));
  // Check orientation on the ORIGINAL points, not the mutated result,
  // so prior adjustments don't break subsequent ones.
  for (const seg of manualSegments) {
    const i = seg.segmentIndex;
    if (!isDraggableSegment(i, points.length)) continue;
    const origP1 = points[i];
    const origP2 = points[i + 1];
    const isHorizontal = Math.abs(origP1.y - origP2.y) < 1;
    const isVertical = Math.abs(origP1.x - origP2.x) < 1;
    if (seg.base !== undefined) {
      const at = seg.axis === 'y' ? origP1.y : origP1.x;
      if (Math.abs(at - seg.base) > 0.5) continue; // the route moved: stale
    }
    if (isHorizontal && seg.axis === 'y') {
      // Move horizontal segment up/down — shift both endpoints
      result[i].y += seg.offset;
      result[i + 1].y += seg.offset;
    } else if (isVertical && seg.axis === 'x') {
      // Move vertical segment left/right — shift both endpoints
      result[i].x += seg.offset;
      result[i + 1].x += seg.offset;
    }
  }
  return result;
}
