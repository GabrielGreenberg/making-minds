// The canvas's view, the pure parts (task 055; the design memo is
// docs/buildout/designs/editor-workbench.md §Canvas): the one zoom range, a
// zoom step about a point, Fit, and the one-line hint. No React, no store:
// CircuitCanvas and CanvasGuide render what these decide, store.ts clamps
// zoom with them, and app/tools/workbenchCheck.ts pins them.

import type { BoxDefinition, CircuitComponent } from './types';
import { getComponentBounds } from './componentGeometry';

// ── Zoom ───────────────────────────────────────────────────────────────────

/** The ONE zoom range: the store's setZoom, the wheel, the ± buttons and Fit
 *  all clamp to it (before task 055 the slider allowed 0.2 and the store 0.25). */
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 3;
/** One press of − or + multiplies the zoom by this. */
export const ZOOM_STEP = 1.2;

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
}

export interface CanvasView { zoom: number; panX: number; panY: number }

/** Zoom by `factor` keeping the canvas point under screen point (cx, cy)
 *  where it is — the − and + buttons zoom about the canvas's centre. */
export function zoomAbout(view: CanvasView, factor: number, cx: number, cy: number): CanvasView {
  const zoom = clampZoom(view.zoom * factor);
  const k = zoom / view.zoom;
  return { zoom, panX: cx - (cx - view.panX) * k, panY: cy - (cy - view.panY) * k };
}

// ── Fit ────────────────────────────────────────────────────────────────────

export interface Rect { x0: number; y0: number; x1: number; y1: number }

/** Room left around a label drawn outside a part's body (the "IN1" above an
 *  input, a MEM's name) and a wire's stub past it. */
const BOUNDS_PAD = 18;

/** The circuit's extent on the canvas, in canvas coordinates: every part's
 *  full footprint (componentGeometry.getComponentBounds — an INPUT's toggle
 *  tab included) and every drawn box, padded for labels. Null when empty. */
export function circuitBounds(
  components: readonly CircuitComponent[],
  boxes: readonly Pick<BoxDefinition, 'x' | 'y' | 'width' | 'height'>[] = [],
): Rect | null {
  if (components.length === 0 && boxes.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of components) {
    const b = getComponentBounds(c);
    x0 = Math.min(x0, b.left); y0 = Math.min(y0, b.top);
    x1 = Math.max(x1, b.right); y1 = Math.max(y1, b.bottom);
  }
  for (const b of boxes) {
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height);
  }
  return { x0: x0 - BOUNDS_PAD, y0: y0 - BOUNDS_PAD, x1: x1 + BOUNDS_PAD, y1: y1 + BOUNDS_PAD };
}

/** Fit never shrinks a circuit below this (a wider one left-aligns and the
 *  student pans), and never blows a small one up past FIT_MAX. */
export const FIT_MIN = 0.8;
export const FIT_MAX = 1.4;

/** What the canvas's corner furniture takes: the action group (top right),
 *  the zoom group and hint line (bottom), and a gap beside the palette. */
export const FIT_MARGIN = { top: 48, right: 30, bottom: 50, left: 16, gap: 16 } as const;

/** The part of the canvas the palette leaves free, in screen px. A standing
 *  palette leaves a region to its right and one to its left — the wider
 *  wins; a flat one, a region below and one above — the taller wins. */
export function freeArea(
  canvas: { w: number; h: number },
  palette: { x: number; y: number; w: number; h: number; horiz: boolean } | null,
): Rect {
  const m = FIT_MARGIN;
  const whole: Rect = { x0: m.left, y0: m.top, x1: canvas.w - m.right, y1: canvas.h - m.bottom };
  if (!palette) return whole;
  if (!palette.horiz) {
    const right: Rect = { ...whole, x0: Math.max(whole.x0, palette.x + palette.w + m.gap) };
    const left: Rect = { ...whole, x1: Math.min(whole.x1, palette.x - m.gap) };
    return right.x1 - right.x0 >= left.x1 - left.x0 ? right : left;
  }
  const below: Rect = { ...whole, y0: Math.max(whole.y0, palette.y + palette.h + m.gap) };
  const above: Rect = { ...whole, y1: Math.min(whole.y1, palette.y - m.gap) };
  return below.y1 - below.y0 >= above.y1 - above.y0 ? below : above;
}

/**
 * Fit: the zoom and pan that centre the circuit in the free area, zoomed to
 * fill it between FIT_MIN and FIT_MAX. A circuit too wide even at FIT_MIN
 * left-aligns in the area (and top-aligns when too tall), so its start is on
 * screen and the student pans for the rest. An empty canvas gets 100% with
 * its origin at the free area's corner. A view change only: nothing about
 * the circuit, its runs or its history moves.
 */
export function fitView(bounds: Rect | null, area: Rect): CanvasView {
  if (!bounds) return { zoom: 1, panX: Math.round(area.x0), panY: Math.round(area.y0) };
  const aw = Math.max(1, area.x1 - area.x0);
  const ah = Math.max(1, area.y1 - area.y0);
  const bw = Math.max(1, bounds.x1 - bounds.x0);
  const bh = Math.max(1, bounds.y1 - bounds.y0);
  const zoom = clampZoom(Math.max(FIT_MIN, Math.min(FIT_MAX, aw / bw, ah / bh)));
  const place = (a0: number, room: number, b0: number, span: number) =>
    span * zoom > room ? a0 - b0 * zoom : a0 + (room - span * zoom) / 2 - b0 * zoom;
  return {
    zoom,
    panX: Math.round(place(area.x0, aw, bounds.x0, bw)),
    panY: Math.round(place(area.y0, ah, bounds.y0, bh)),
  };
}

// ── The hint line ──────────────────────────────────────────────────────────

export interface HintState {
  /** The armed tool's name as the student reads it ("AND", "Box 1"), 'NEW_BOX', or null. */
  tool: string | null;
  selectedParts: number;
  selectedWires: number;
  parts: number;
  wires: number;
  /** A state machine or Turing machine canvas: states and transitions, not gates. */
  stateMachine: boolean;
  /** The question refuses edits (done, frozen, a submission on show). */
  locked: boolean;
}

/** The canvas's one-line hint (memo §Canvas), or null for none. An empty
 *  canvas has none (its centred message speaks instead); a locked one says
 *  only what still works. */
export function canvasHint(s: HintState): string | null {
  if (s.parts === 0) return null;
  if (s.locked) {
    return s.stateMachine ? null : 'This question is locked. You can still switch the inputs and run it.';
  }
  if (s.tool === 'NEW_BOX') return 'Drag a rectangle around the parts to box them. Esc cancels.';
  if (s.tool) return `Click the canvas to place ${s.tool}. Shift-click to place several. Esc cancels.`;
  if (s.selectedParts > 0) return `Drag to move. Delete removes ${s.selectedParts + s.selectedWires > 1 ? 'them' : 'it'}.`;
  if (s.selectedWires > 0) return s.selectedWires > 1 ? 'Delete removes these wires.' : 'Delete removes this wire.';
  if (s.wires === 0) {
    return s.stateMachine
      ? 'Drag from the edge of one state to another to add a transition.'
      : 'Drag from one dot to another to connect parts.';
  }
  return s.stateMachine
    ? 'Click a transition’s label to change it.'
    : 'Click an input to switch it between 0 and 1.';
}

/** The empty canvas's centred message (memo §Canvas). */
export const EMPTY_CANVAS_MESSAGE = 'Drag parts from the toolbar onto the canvas, or click a part and then click here.';
