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
