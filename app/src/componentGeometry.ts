/**
 * componentGeometry — the single source of truth for rendered component
 * geometry. Pure TypeScript, no React/DOM.
 *
 * Owns BOTH of the things a wire cares about:
 *   - rendered dimensions per component type (`getComponentSize`)
 *   - port position math (`getPortPositionLocal` / `getPortPosition`),
 *     including the OR/XOR left-port inset and component rotation
 *
 * Imported by:
 *   - components/CircuitCanvas.tsx  (what the student actually sees)
 *   - wireRouter.ts                 (obstacle bounds for A* routing)
 *   - tools/layoutCheck.ts          (the headless appearance oracle)
 *
 * Before this module existed each of those kept its own copy, and they
 * drifted: the router's copy had no MEM case, so MEM fell to the 75×70
 * default while the canvas rendered 50×50 — every wire incident on a MEM's
 * right port was born inside a phantom obstacle, A* failed, and the wire
 * took the obstacle-blind fallback lane (all six HW3 appearance failures).
 * With one shared module the three consumers can never desync again; keep
 * every rendered-size or port-math change HERE.
 */

import type { CircuitComponent } from './types';
import {
  COMP_WIDTH,
  COMP_HEIGHT,
  INPUT_OUTPUT_SIZE,
  STATE_RADIUS,
  STATE_SIZE,
} from './types';

// ─── INPUT toggle tab ─────────────────────────────────────────────────
// The INPUT body carries a small click-to-toggle tab rendered OUTSIDE the
// body box, on its left face: CircuitCanvas draws it at
//   x = comp.x - INPUT_TOGGLE_W - strokeW/2   (at-rest strokeW = 1.5)
// centered vertically. Ports, drag, and selection all use the body box
// (`getComponentSize`); the tab matters only to consumers of the rendered
// FOOTPRINT (`getComponentBounds`) — wires must route around it too.
// Keep these numbers in sync with CircuitCanvas's INPUT case.
export const INPUT_TOGGLE_W = 14;
export const INPUT_TOGGLE_H = 20;
/** The strokeW/2 seam between tab and body at rest (unselected stroke 1.5). */
const INPUT_TOGGLE_SEAM = 0.75;

/** Rendered bounding-box size for a component (unrotated, in canvas px). */
export function getComponentSize(comp: CircuitComponent): { w: number; h: number } {
  if (comp.type === 'INPUT' || comp.type === 'OUTPUT') {
    return { w: INPUT_OUTPUT_SIZE, h: INPUT_OUTPUT_SIZE };
  }
  if (comp.type === 'NOT') {
    return { w: 55, h: 50 };
  }
  if (comp.type === 'HA') {
    return { w: COMP_WIDTH, h: COMP_HEIGHT + 10 };
  }
  if (comp.type === 'MEM') {
    return { w: 50, h: 50 };
  }
  if (comp.type === 'STATE') {
    if (comp.boxedCircuitId) return { w: 90, h: 50 };
    return { w: STATE_SIZE, h: STATE_SIZE };
  }
  return { w: COMP_WIDTH, h: COMP_HEIGHT };
}

/** Unrotated port position (absolute canvas coords). */
export function getPortPositionLocal(
  comp: CircuitComponent,
  portId: string
): { x: number; y: number } {
  const port = comp.ports.find((p) => p.id === portId);
  if (!port) return { x: comp.x, y: comp.y };

  // STATE: ports on left/right
  if (comp.type === 'STATE') {
    if (comp.boxedCircuitId) {
      // Boxed FSM instance: ports at left/right center of the rectangle
      const { w, h } = getComponentSize(comp);
      const midY = comp.y + h / 2;
      switch (portId) {
        case 'left':  return { x: comp.x,     y: midY };
        case 'right': return { x: comp.x + w, y: midY };
        default:      return { x: comp.x + w / 2, y: midY };
      }
    }
    const cx = comp.x + STATE_RADIUS;
    const cy = comp.y + STATE_RADIUS;
    switch (portId) {
      case 'in':
      case 'left':  return { x: cx - STATE_RADIUS, y: cy };
      case 'out':
      case 'right': return { x: cx + STATE_RADIUS, y: cy };
      default:      return { x: cx, y: cy };
    }
  }

  const { w, h } = getComponentSize(comp);
  const portsOnSide = comp.ports.filter((p) => p.side === port.side);
  const spacing = h / (portsOnSide.length + 1);

  let localX = port.side === 'left' ? 0 : w;
  const localY = spacing * (port.index + 1);

  // OR/XOR gates have a curved left face — inset the left ports so they sit
  // on the drawn curve, not the bounding box edge (XOR's double arc adds 6px).
  if (port.side === 'left' && (comp.type === 'OR' || comp.type === 'XOR')) {
    const xorOffset = comp.type === 'XOR' ? 6 : 0;
    localX = xorOffset + w * 0.07;
  }

  return { x: comp.x + localX, y: comp.y + localY };
}

/** World-space anchor for a component's floating name label. */
export interface LabelAnchor {
  x: number;
  y: number;
  textAnchor: 'start' | 'middle' | 'end';
  /** SVG dominant-baseline to render the label with. */
  dominantBaseline: 'auto' | 'central' | 'hanging';
}

/**
 * Where a component's floating name label (e.g. the bold "M1" above a MEM)
 * anchors, given the component's rotation.
 *
 * The label lives off the component's local TOP side — the one side of a
 * left→right component that never carries ports — and that side rotates
 * WITH the component. Unrotated, the label sits centered above the block
 * (exactly the legacy `(cx, y - gap)` placement, so 0° rendering is
 * unchanged). At 90°/270° the port axis is vertical — a wire enters or
 * leaves through the block's top-center, exactly where the legacy anchor
 * sat, bisecting the label — so the anchor moves to the block's east/west
 * side instead. At 180° it moves below.
 *
 * Returned coordinates are world/canvas coords: the canvas renders labels
 * counter-rotated about the component center (net identity with the group
 * rotation), so these literal coordinates are where the text lands on
 * screen. Rotation snaps to the nearest 90°.
 */
export function getLabelAnchor(comp: CircuitComponent, gap = 5): LabelAnchor {
  const { w, h } = getComponentSize(comp);
  const cx = comp.x + w / 2;
  const cy = comp.y + h / 2;
  const rot = (((comp.rotation ?? 0) % 360) + 360) % 360;
  const quarter = Math.round(rot / 90) % 4;
  switch (quarter) {
    case 1: // local top faces EAST (SVG rotation is clockwise)
      return { x: comp.x + w + gap, y: cy, textAnchor: 'start', dominantBaseline: 'central' };
    case 2: // local top faces SOUTH
      return { x: cx, y: comp.y + h + gap, textAnchor: 'middle', dominantBaseline: 'hanging' };
    case 3: // local top faces WEST
      return { x: comp.x - gap, y: cy, textAnchor: 'end', dominantBaseline: 'central' };
    default: // unrotated: centered above the block (legacy placement)
      return { x: cx, y: comp.y - gap, textAnchor: 'middle', dominantBaseline: 'auto' };
  }
}

/** Rotated port position (absolute canvas coords). */
export function getPortPosition(
  comp: CircuitComponent,
  portId: string
): { x: number; y: number } {
  const local = getPortPositionLocal(comp, portId);
  const rotation = comp.rotation ?? 0;
  if (rotation === 0) return local;

  const { w, h } = getComponentSize(comp);
  const cx = comp.x + w / 2;
  const cy = comp.y + h / 2;
  const dx = local.x - cx;
  const dy = local.y - cy;
  const rad = (rotation * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);

  return {
    x: cx + dx * cosA - dy * sinA,
    y: cy + dx * sinA + dy * cosA,
  };
}

/**
 * Rendered FOOTPRINT bounds (absolute canvas px, axis-aligned): everything
 * the component actually draws — the body box plus adjunct chrome outside
 * it. Today the only adjunct is INPUT's left toggle tab (14×20, drawn left
 * of the body), which is why obstacle consumers (wireRouter's A* blocking
 * model, the layout oracle's body rects) must take bounds from HERE rather
 * than rebuilding `comp.x + getComponentSize(...)` boxes themselves: a
 * `{w,h}` anchored at comp.x cannot express chrome left of the body, and a
 * wire routed "around the body" still crosses the tab (hw3-p12's pmo-36).
 *
 * The tab is 20px tall and vertically centered on a 40px body, so it never
 * widens the footprint vertically; the footprint stays ONE rect (the tab's
 * corner slivers are over-covered — negligible next to the router's 5px
 * element margin). Rotation follows the render exactly: CircuitCanvas
 * rotates the whole component group (tab included) about the BODY center,
 * so this returns the AABB of the footprint rect rotated about that point —
 * identical to the body AABB for every non-INPUT component.
 */
export function getComponentBounds(comp: CircuitComponent): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  const { w, h } = getComponentSize(comp);
  const left =
    comp.type === 'INPUT' ? comp.x - INPUT_TOGGLE_W - INPUT_TOGGLE_SEAM : comp.x;
  const top = comp.y;
  const right = comp.x + w;
  const bottom = comp.y + h;

  const rotation = comp.rotation ?? 0;
  if (rotation === 0) return { left, top, right, bottom };

  // AABB of the footprint rect rotated about the body center (the render's
  // rotation origin — same origin as getPortPosition above).
  const cx = comp.x + w / 2;
  const cy = comp.y + h / 2;
  const rad = (rotation * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  const fx = (left + right) / 2 - cx; // footprint-center offset from origin
  const fy = (top + bottom) / 2 - cy;
  const rcx = cx + fx * cosA - fy * sinA;
  const rcy = cy + fx * sinA + fy * cosA;
  const halfW = ((right - left) * Math.abs(cosA) + (bottom - top) * Math.abs(sinA)) / 2;
  const halfH = ((right - left) * Math.abs(sinA) + (bottom - top) * Math.abs(cosA)) / 2;
  return { left: rcx - halfW, top: rcy - halfH, right: rcx + halfW, bottom: rcy + halfH };
}
