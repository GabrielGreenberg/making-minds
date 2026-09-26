import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { useStore, selectEffectiveMode, selectLiveFsmStateId, selectTransitionNotationForSource, selectPasteScope, selectShowUnboundBoxWarning } from '../store';
import { inputCharTokens, hasCombinationalLoop, memorySlots } from '../engine';
import { usePasteGuard, useNotice } from '../usePasteGuard';
import { CanvasActions } from './CanvasActions';
import { Palette } from './Palette';
import { usePaletteDrag } from './paletteDrag';
import { clientToCanvas, placementOrigin, toolComponent } from '../palette';
import { editorShortcut, isTextEntryTarget } from '../shortcuts';
import { applyManualSegments } from '../wireSegments';
import { canvasColors, canvasVar, signalColor } from '../canvasTheme';
import { circuitBounds, fitView, freeArea, zoomAbout, ZOOM_STEP } from '../canvasView';
import { CanvasGuide } from './CanvasGuide';
import type {
  CircuitComponent,
  Wire,
  BoxDefinition,
} from '../types';
import {
  GRID_SIZE,
  PORT_RADIUS,
  STATE_RADIUS,
  isMemSourcePort,
  isMemSinkPort,
} from '../types';
import { mintId } from '../provenance/ids';
import { unboundBoxes } from '../boxPorts';
import {
  routeAllWires,
  validateSegmentPosition,
  findDivergencePoints,
  SPLIT_DOT_RADIUS,
  type WireRouteInput,
  type DisplayedWirePath,
} from '../wireRouter';

// ─── Geometry helpers ─────────────────────────────────────────────
// Rendered dimensions + port math live in componentGeometry.ts — the single
// source of truth shared with wireRouter (obstacle bounds) and
// tools/layoutCheck (the appearance oracle). Never redefine them here.

import {
  getComponentSize as getCompDimensions,
  getLabelAnchor,
  OR_STUB,
  getPortPosition,
  getPortPositionLocal,
} from '../componentGeometry';

const PORT_HIT_RADIUS = 20;

/** Find the wire target under `canvasPos`: nearest valid input port (first
 *  pass: proximity; second pass: cursor inside component bounds). Used both
 *  when a wire drag is released and when a click completes a pending wire. */
function findWireTarget(
  components: CircuitComponent[],
  canvasPos: { x: number; y: number },
  sourceCompId?: string
): { comp: CircuitComponent; port: CircuitComponent['ports'][0] } | null {
  let bestDist = Infinity;
  let bestComp: CircuitComponent | null = null;
  let bestPort: CircuitComponent['ports'][0] | null = null;
  const sourceComp = components.find((c) => c.id === sourceCompId);
  const isFsmSource = sourceComp?.type === 'STATE';
  for (const comp of components) {
    // For FSM: allow self-loops (same source and target STATE)
    if (comp.id === sourceCompId && !isFsmSource) continue;
    for (const port of comp.ports) {
      // For STATE: 'in' port is the target (or same comp for self-loop)
      // For MEM, target port depends on direction; for all others, left-side ports are targets
      const isTargetPort = comp.type === 'STATE' ? port.id === 'left'
        : comp.type === 'MEM' ? isMemSinkPort(comp, port.id) : port.side === 'left';
      if (!isTargetPort) continue;
      // For STATE targets, releasing anywhere in (or just outside) the
      // circle connects — measure from the state's center, not the port.
      const portPos = comp.type === 'STATE'
        ? { x: comp.x + STATE_RADIUS, y: comp.y + STATE_RADIUS }
        : getPortPosition(comp, port.id);
      const dist = Math.hypot(canvasPos.x - portPos.x, canvasPos.y - portPos.y);
      const hitRadius = comp.type === 'STATE' ? STATE_RADIUS + 12 : PORT_HIT_RADIUS + 10;
      if (dist < hitRadius && dist < bestDist) {
        bestDist = dist;
        bestComp = comp;
        bestPort = port;
      }
    }
  }
  // Second pass: overshoot — cursor is inside component bounds, find closest target port
  if (!bestComp) {
    for (const comp of components) {
      if (comp.id === sourceCompId && !isFsmSource) continue;
      const { w, h } = getCompDimensions(comp);
      if (canvasPos.x >= comp.x && canvasPos.x <= comp.x + w &&
          canvasPos.y >= comp.y && canvasPos.y <= comp.y + h) {
        for (const port of comp.ports) {
          const isTargetPort = comp.type === 'STATE' ? true
            : comp.type === 'MEM' ? isMemSinkPort(comp, port.id) : port.side === 'left';
          if (!isTargetPort) continue;
          const portPos = getPortPosition(comp, port.id);
          const dist = Math.hypot(canvasPos.x - portPos.x, canvasPos.y - portPos.y);
          if (dist < bestDist) {
            bestDist = dist;
            bestComp = comp;
            bestPort = port;
          }
        }
      }
    }
  }
  return bestComp && bestPort ? { comp: bestComp, port: bestPort } : null;
}

// ─── Wire routing (A* pathfinder — see wireRouter.ts) ────────────

function pointsToPathD(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L${points[i].x},${points[i].y}`;
  }
  return d;
}

/** Build a pathD string identical to pointsToPathD but with a small upward
 *  arc substituted wherever a horizontal segment crosses a vertical wire.
 *  Both wires remain visually continuous — no white gaps. */
function pathDWithBumps(
  points: { x: number; y: number }[],
  crossings: { x: number; y: number }[],
  R = 5
): string {
  if (points.length === 0) return '';
  if (crossings.length === 0) return pointsToPathD(points);

  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const isHoriz = Math.abs(a.y - b.y) < 0.5;
    if (!isHoriz) { d += ` L${b.x},${b.y}`; continue; }

    const goingRight = b.x >= a.x;
    const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
    const hits = crossings
      .filter(cp => Math.abs(cp.y - a.y) < 2 && cp.x > minX + R && cp.x < maxX - R)
      .sort((p, q) => goingRight ? p.x - q.x : q.x - p.x);

    if (hits.length === 0) { d += ` L${b.x},${b.y}`; continue; }

    for (const cp of hits) {
      if (goingRight) {
        d += ` L${cp.x - R},${a.y} A${R},${R} 0 0,0 ${cp.x + R},${a.y}`;
      } else {
        d += ` L${cp.x + R},${a.y} A${R},${R} 0 0,1 ${cp.x - R},${a.y}`;
      }
    }
    d += ` L${b.x},${b.y}`;
  }
  return d;
}

// ─── Alignment guides ────────────────────────────────────────────

interface AlignGuide {
  type: 'vertical' | 'horizontal';
  pos: number;
  start: number;
  end: number;
}

const ALIGN_THRESHOLD = 8;

function findAlignmentGuides(
  movingComp: CircuitComponent,
  allComponents: CircuitComponent[],
  movingIds: Set<string>,
): { guides: AlignGuide[]; snapDx: number; snapDy: number } {
  const { w: mw, h: mh } = getCompDimensions(movingComp);
  const mLeft = movingComp.x;
  const mRight = movingComp.x + mw;
  const mTop = movingComp.y;
  const mBottom = movingComp.y + mh;

  // Collect port positions for the moving component
  const movingPortPositions = movingComp.ports.map((p) => getPortPosition(movingComp, p.id));

  let bestDistX = ALIGN_THRESHOLD + 1;
  let bestDistY = ALIGN_THRESHOLD + 1;
  let snapDx = 0;
  let snapDy = 0;
  let bestXGuides: AlignGuide[] = [];
  let bestYGuides: AlignGuide[] = [];

  for (const comp of allComponents) {
    if (movingIds.has(comp.id)) continue;
    const { w, h } = getCompDimensions(comp);
    const cLeft = comp.x;
    const cRight = comp.x + w;
    const cTop = comp.y;
    const cBottom = comp.y + h;

    // Collect port positions for the other component
    const otherPortPositions = comp.ports.map((p) => getPortPosition(comp, p.id));

    const vExtent = (pos: number) => ({
      type: 'vertical' as const,
      pos,
      start: Math.min(mTop, cTop) - 20,
      end: Math.max(mBottom, cBottom) + 20,
    });
    const hExtent = (pos: number) => ({
      type: 'horizontal' as const,
      pos,
      start: Math.min(mLeft, cLeft) - 20,
      end: Math.max(mRight, cRight) + 20,
    });

    // Port-to-port alignment: snap port centers to each other
    for (const mp of movingPortPositions) {
      for (const op of otherPortPositions) {
        // X alignment (vertical guide through aligned ports)
        const distX = Math.abs(mp.x - op.x);
        if (distX < ALIGN_THRESHOLD) {
          const dx = op.x - mp.x;
          if (distX < bestDistX - 0.5) {
            bestDistX = distX;
            snapDx = dx;
            bestXGuides = [vExtent(op.x)];
          } else if (Math.abs(distX - bestDistX) < 0.5 && Math.abs(dx - snapDx) < 0.5) {
            bestXGuides.push(vExtent(op.x));
          }
        }

        // Y alignment (horizontal guide through aligned ports)
        const distY = Math.abs(mp.y - op.y);
        if (distY < ALIGN_THRESHOLD) {
          const dy = op.y - mp.y;
          if (distY < bestDistY - 0.5) {
            bestDistY = distY;
            snapDy = dy;
            bestYGuides = [hExtent(op.y)];
          } else if (Math.abs(distY - bestDistY) < 0.5 && Math.abs(dy - snapDy) < 0.5) {
            bestYGuides.push(hExtent(op.y));
          }
        }
      }
    }

    // Also keep component edge alignment as a secondary option
    const mcx = movingComp.x + mw / 2;
    const mcy = movingComp.y + mh / 2;
    const cx = comp.x + w / 2;
    const cy = comp.y + h / 2;

    const xCandidates = [
      { dist: Math.abs(mLeft - cLeft), dx: cLeft - mLeft, guide: vExtent(cLeft) },
      { dist: Math.abs(mRight - cRight), dx: cRight - mRight, guide: vExtent(cRight) },
      { dist: Math.abs(mcx - cx), dx: cx - mcx, guide: vExtent(cx) },
    ];

    for (const c of xCandidates) {
      if (c.dist < ALIGN_THRESHOLD) {
        if (c.dist < bestDistX - 0.5) {
          bestDistX = c.dist;
          snapDx = c.dx;
          bestXGuides = [c.guide];
        } else if (Math.abs(c.dist - bestDistX) < 0.5 && Math.abs(c.dx - snapDx) < 0.5) {
          bestXGuides.push(c.guide);
        }
      }
    }

    const yCandidates = [
      { dist: Math.abs(mTop - cTop), dy: cTop - mTop, guide: hExtent(cTop) },
      { dist: Math.abs(mBottom - cBottom), dy: cBottom - mBottom, guide: hExtent(cBottom) },
      { dist: Math.abs(mcy - cy), dy: cy - mcy, guide: hExtent(cy) },
    ];

    for (const c of yCandidates) {
      if (c.dist < ALIGN_THRESHOLD) {
        if (c.dist < bestDistY - 0.5) {
          bestDistY = c.dist;
          snapDy = c.dy;
          bestYGuides = [c.guide];
        } else if (Math.abs(c.dist - bestDistY) < 0.5 && Math.abs(c.dy - snapDy) < 0.5) {
          bestYGuides.push(c.guide);
        }
      }
    }
  }

  return { guides: [...bestXGuides, ...bestYGuides], snapDx, snapDy };
}

// ─── Drag state ──────────────────────────────────────────────────

interface DragInfo {
  type: 'move' | 'wire' | 'pan' | 'boxselect' | 'drawbox' | 'resizebox' | 'movebox' | 'wiresegment';
  anchorScreenX: number;
  anchorScreenY: number;
  anchorCanvasX: number;
  anchorCanvasY: number;
  currentCanvasX: number;
  currentCanvasY: number;
  // for 'move'
  componentId?: string;
  moveOffsets?: Map<string, { dx: number; dy: number }>;
  // for 'boxselect': shift or cmd/ctrl held — the rectangle adds to the
  // selection instead of replacing it (modifier map, handlePointerDown)
  additive?: boolean;
  // for 'wire'
  sourceCompId?: string;
  sourcePortId?: string;
  wireFromX?: number;
  wireFromY?: number;
  // true when the drag re-routes an existing wire picked up from its target
  // port (a plain click must then re-attach it, not be discarded as a no-op)
  isRewire?: boolean;
  // for 'pan'
  origPanX?: number;
  origPanY?: number;
  // for 'drawbox'
  drawBoxStartX?: number;
  drawBoxStartY?: number;
  // for 'resizebox'
  boxId?: string;
  boxCorner?: string; // 'nw' | 'ne' | 'sw' | 'se'
  origBoxX?: number;
  origBoxY?: number;
  origBoxW?: number;
  origBoxH?: number;
  // for 'movebox'
  moveBoxId?: string;
  moveBoxOffsetX?: number;
  moveBoxOffsetY?: number;
  moveBoxCompOffsets?: Map<string, { dx: number; dy: number }>;
  // for 'wiresegment'
  wireId?: string;
  segmentIndex?: number;
  segmentAxis?: 'x' | 'y';
  segmentOrigValue?: number;
  // tracking
  hasMoved?: boolean;
  pointerId?: number;
  clickedInputToggle?: boolean;
}

// ─── Component rendering ─────────────────────────────────────────

function CircuitComponentView({
  comp,
  isSelected,
  portValues,
}: {
  comp: CircuitComponent;
  isSelected: boolean;
  /** The signal on each port's wire (`compId:portId` → 0/1): a port dot
   *  wears its wire's colour; a port no wire reaches, the ink. */
  portValues?: ReadonlyMap<string, number>;
}) {
  const { w, h } = getCompDimensions(comp);
  // Every colour is a theme role (canvasTheme.ts); selection is magenta.
  const C = canvasColors();
  const bodyFill = isSelected ? C.selectFill : C.surface;
  const bodyStroke = isSelected ? C.select : C.ink;
  const bodyStrokeW = isSelected ? 2.5 : 1.5;
  // The live FSM control state for the green highlight — one selector fed by
  // whichever sim is active (FSM sim or a turbot arena run with an FSM
  // brain), never a direct read of one slice's field.
  const liveFsmStateId = useStore(selectLiveFsmStateId);

  const rot = comp.rotation ?? 0;
  const cx = comp.x + w / 2;
  const cy = comp.y + h / 2;
  const counterRotateLabel = () =>
    rot !== 0 ? `rotate(${-rot}, ${cx}, ${cy})` : undefined;
  // A gate's symbol (∧ ∨ ¬) as a stroked path (the memo's), centred on
  // (sx, sy) and scaled by k. It turns with the gate's position but stays
  // upright: counter-rotated about its own centre, not the body's.
  const gateSymbol = (kind: 'and' | 'or' | 'not', sx: number, sy: number, k: number) => {
    const d = kind === 'and'
      ? `M${sx - 7 * k},${sy + 6 * k} L${sx},${sy - 7 * k} L${sx + 7 * k},${sy + 6 * k}`
      : kind === 'or'
        ? `M${sx - 7 * k},${sy - 6 * k} L${sx},${sy + 7 * k} L${sx + 7 * k},${sy - 6 * k}`
        : `M${sx - 7 * k},${sy - 3 * k} H${sx + 6 * k} V${sy + 4 * k}`;
    return (
      <path
        d={d}
        fill="none"
        stroke={C.ink}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        pointerEvents="none"
        data-gate-symbol={kind}
        transform={rot !== 0 ? `rotate(${-rot}, ${sx}, ${sy})` : undefined}
      />
    );
  };

  const renderGateBody = () => {
    switch (comp.type) {
      case 'INPUT': {
        const toggleW = 14;
        const toggleH = 20;
        const strokeW = isSelected ? 2.5 : 1.5;
        const toggleX = comp.x - toggleW - strokeW / 2;
        const toggleY = comp.y + h / 2 - toggleH / 2;
        const val = comp.value;
        const isBlank = val == null;
        const displayVal = isBlank ? '' : val;
        return (
          <g>
            {/* Toggle tab on the left – rendered first so main rect covers the seam */}
            <rect
              x={toggleX}
              y={toggleY}
              width={toggleW}
              height={toggleH}
              rx={3}
              fill={isBlank ? C.faint : val ? C.signal1 : C.dim}
              stroke={isSelected ? C.select : C.ink2}
              strokeWidth={1}
              data-input-toggle={comp.id}
              style={{ cursor: 'pointer' }}
            />
            <rect
              x={comp.x}
              y={comp.y}
              width={w}
              height={h}
              rx={3}
              fill={isSelected ? C.selectFill : val === 1 ? C.signal1Soft : C.surface}
              stroke={isSelected ? C.select : val === 1 ? C.signal1 : C.ink}
              strokeWidth={strokeW}
            />
            <text
              x={toggleX + toggleW / 2}
              y={toggleY + toggleH / 2 + 4}
              textAnchor="middle"
              fontSize="10"
              fill={C.surface}
              pointerEvents="none"
              transform={counterRotateLabel()}
            >
              {displayVal}
            </text>
            <text
              x={comp.x + w / 2}
              y={comp.y - 6}
              textAnchor="middle"
              fontSize="11"
              letterSpacing="0.04em"
              fill={C.dim}
              transform={counterRotateLabel()}
            >
              {comp.label}
            </text>
            <text
              x={comp.x + w / 2}
              y={comp.y + h / 2 + 1}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="17"
              fill={signalColor(C, val)}
              transform={counterRotateLabel()}
            >
              {displayVal}
            </text>
          </g>
        );
      }

      case 'OUTPUT':
        return (
          <g>
            <rect
              x={comp.x}
              y={comp.y}
              width={w}
              height={h}
              rx={3}
              fill={isSelected ? C.selectFill : comp.value === 1 ? C.signal1Soft : C.surface}
              stroke={bodyStroke}
              strokeWidth={bodyStrokeW}
            />
            <text
              x={comp.x + w / 2}
              y={comp.y - 6}
              textAnchor="middle"
              fontSize="11"
              letterSpacing="0.04em"
              fill={C.dim}
              transform={counterRotateLabel()}
            >
              {comp.label}
            </text>
            <text
              x={comp.x + w / 2}
              y={comp.y + h / 2 + 1}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="17"
              fill={signalColor(C, comp.value)}
              transform={counterRotateLabel()}
            >
              {comp.value != null ? comp.value : ''}
            </text>
          </g>
        );

      // AND, OR and NOT: the memo's shapes (componentGeometry.ts PART_SIZE —
      // 60×60, 60×60, 50×60), their symbols drawn as 2px strokes (gateSymbol).
      case 'AND':
        return (
          <g>
            <path
              d={`M${comp.x},${comp.y} H${comp.x + w - h / 2} A${h / 2},${h / 2} 0 0 1 ${comp.x + w - h / 2},${comp.y + h} H${comp.x} Z`}
              fill={bodyFill}
              stroke={bodyStroke}
              strokeWidth={bodyStrokeW}
              strokeLinejoin="round"
            />
            {gateSymbol('and', comp.x + 28, comp.y + 30, 1)}
          </g>
        );

      case 'OR':
        return (
          <g>
            <path
              d={`M${comp.x},${comp.y} H${comp.x + 24} Q${comp.x + 50},${comp.y + 3} ${comp.x + 60},${comp.y + 30} Q${comp.x + 50},${comp.y + 57} ${comp.x + 24},${comp.y + 60} H${comp.x} Q${comp.x + 12},${comp.y + 30} ${comp.x},${comp.y} Z`}
              fill={bodyFill}
              stroke={bodyStroke}
              strokeWidth={bodyStrokeW}
              strokeLinejoin="round"
            />
            {/* The inputs sit on the box's edge; a stub carries each to the curve. */}
            <path
              d={`M${comp.x},${comp.y + 20} H${comp.x + OR_STUB} M${comp.x},${comp.y + 40} H${comp.x + OR_STUB}`}
              fill="none"
              stroke={bodyStroke}
              strokeWidth={1.5}
            />
            {gateSymbol('or', comp.x + 30, comp.y + 30, 1)}
          </g>
        );

      case 'NOT':
        return (
          <g>
            <polygon
              points={`${comp.x},${comp.y + 8} ${comp.x + 50},${comp.y + 30} ${comp.x},${comp.y + 52}`}
              fill={bodyFill}
              stroke={bodyStroke}
              strokeWidth={bodyStrokeW}
              strokeLinejoin="round"
            />
            {gateSymbol('not', comp.x + 16, comp.y + 29, 0.85)}
          </g>
        );

      case 'XOR':
        return (
          <g>
            <path
              d={`M${comp.x + 6},${comp.y} Q${comp.x + w * 0.4},${comp.y} ${comp.x + w * 0.5},${comp.y} Q${comp.x + w},${comp.y} ${comp.x + w},${comp.y + h / 2} Q${comp.x + w},${comp.y + h} ${comp.x + w * 0.5},${comp.y + h} Q${comp.x + w * 0.4},${comp.y + h} ${comp.x + 6},${comp.y + h} Q${comp.x + w * 0.25},${comp.y + h / 2} ${comp.x + 6},${comp.y} Z`}
              fill={bodyFill}
              stroke={bodyStroke}
              strokeWidth={bodyStrokeW}
            />
            <path
              d={`M${comp.x},${comp.y} Q${comp.x + w * 0.18},${comp.y + h / 2} ${comp.x},${comp.y + h}`}
              fill="none"
              stroke={bodyStroke}
              strokeWidth={1.5}
            />
            <text
              x={cx}
              y={cy}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="18"
              fontWeight="700"
              fill={C.ink}
              transform={counterRotateLabel()}
            >
              {'\u2295'}
            </text>
          </g>
        );

      case 'HA':
        return (
          <g>
            <rect
              x={comp.x}
              y={comp.y}
              width={w}
              height={h}
              rx={4}
              fill={bodyFill}
              stroke={bodyStroke}
              strokeWidth={bodyStrokeW}
            />
            <text
              x={cx}
              y={cy}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="13"
              fill={C.ink}
              transform={counterRotateLabel()}
            >
              HA
            </text>
            <text x={comp.x + 6} y={comp.y + h / 3 + 4} fontSize="9" fill={C.dim} transform={counterRotateLabel()}>A</text>
            <text x={comp.x + 6} y={comp.y + (2 * h) / 3 + 4} fontSize="9" fill={C.dim} transform={counterRotateLabel()}>B</text>
            <text x={comp.x + w - 12} y={comp.y + h / 3 + 4} fontSize="9" fill={C.dim} transform={counterRotateLabel()}>S</text>
            <text x={comp.x + w - 12} y={comp.y + (2 * h) / 3 + 4} fontSize="9" fill={C.dim} transform={counterRotateLabel()}>C</text>
          </g>
        );

      case 'MEM': {
        const dir = comp.memDirection;
        // Arrow chevrons inside the block, flanking the stored value
        const arrowSize = 5;
        const arrowInset = 12; // distance from block edge to arrow tip
        // Shift the whole arrow+value group when resolved so it stays visually centered
        const groupShift = !dir ? 0 : dir === 'left-to-right' ? 4 : -4;
        const arrowColor = dir ? C.ink2 : C.faint;
        // Determine arrow directions:
        // Undecided: both arrows point outward (← val →)
        // left-to-right: both point right (→ val →)
        // right-to-left: both point left (← val ←)
        let leftDir: 'left' | 'right';
        let rightDir: 'left' | 'right';
        if (!dir) {
          leftDir = 'left';
          rightDir = 'right';
        } else if (dir === 'left-to-right') {
          leftDir = 'right';
          rightDir = 'right';
        } else {
          leftDir = 'left';
          rightDir = 'left';
        }
        const chevron = (ax: number, ay: number, pointing: 'left' | 'right') => {
          const dx = pointing === 'right' ? arrowSize : -arrowSize;
          return `M${ax - dx},${ay - arrowSize} L${ax},${ay} L${ax - dx},${ay + arrowSize}`;
        };
        const storedVal = comp.storedValue;
        const valDisplay = storedVal != null ? String(storedVal) : '';

        return (
          <g>
            <rect
              x={comp.x}
              y={comp.y}
              width={w}
              height={h}
              rx={8}
              fill={isSelected ? C.selectFill : C.quiet}
              stroke={bodyStroke}
              strokeWidth={bodyStrokeW}
            />
            {/* Name label — bold, off the local top side. The anchor rotates
                with the component (componentGeometry.getLabelAnchor), so a
                90°/270°-rotated MEM's label sits beside the block instead of
                straddling the now-vertical M_IN/M_OUT wire at top-center.
                Coordinates are world coords: counterRotateLabel() cancels the
                group rotation about the same center. */}
            {(() => {
              const anchor = getLabelAnchor(comp);
              return (
                <text
                  x={anchor.x}
                  y={anchor.y}
                  textAnchor={anchor.textAnchor}
                  dominantBaseline={anchor.dominantBaseline}
                  fontSize="12"
                  fill={C.ink}
                  transform={counterRotateLabel()}
                >
                  {comp.label}
                </text>
              );
            })()}
            {/* Left arrow inside block */}
            <path
              d={chevron(comp.x + arrowInset + groupShift, cy, leftDir)}
              fill="none"
              stroke={arrowColor}
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              pointerEvents="none"
            />
            {/* Stored value — centered, prominent */}
            <text
              x={cx}
              y={cy + 1}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="16"
              fill={signalColor(C, storedVal)}
              transform={counterRotateLabel()}
            >
              {valDisplay}
            </text>
            {/* Right arrow inside block */}
            <path
              d={chevron(comp.x + w - arrowInset + groupShift, cy, rightDir)}
              fill="none"
              stroke={arrowColor}
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              pointerEvents="none"
            />
          </g>
        );
      }

      case 'BOXED':
        return (
          <g>
            <rect
              x={comp.x}
              y={comp.y}
              width={w}
              height={h}
              rx={4}
              fill={isSelected ? C.selectFill : C.quiet}
              stroke={bodyStroke}
              strokeWidth={bodyStrokeW}
            />
            <text
              x={cx}
              y={cy}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="13"
              fill={C.ink}
              transform={counterRotateLabel()}
            >
              {comp.label}
            </text>
          </g>
        );

      case 'STATE': {
        const isCurrentState = liveFsmStateId === comp.id;
        const strokeColor = isCurrentState ? C.live : isSelected ? C.select : C.ink;

        const ringR = STATE_RADIUS + 7;
        // Turbot-TM convention (textbook): external states draw as squares,
        // internal states as circles. stateKind is only ever set on turbot-TM
        // states, so plain FSM/TM machines are unaffected.
        const isExternal = comp.stateKind === 'external';
        const stateFill = isCurrentState ? C.liveSoft : isSelected ? C.selectFill : C.surface;
        return (
          <g>
            {/* Outer ring — wire-creation zone affordance */}
            {isExternal ? (
              <rect
                x={cx - ringR} y={cy - ringR} width={ringR * 2} height={ringR * 2} rx={6}
                fill="none" stroke={strokeColor} strokeWidth={1} opacity={0.5} pointerEvents="none"
              />
            ) : (
              <circle
                cx={cx} cy={cy} r={ringR}
                fill="none" stroke={strokeColor} strokeWidth={1} opacity={0.5} pointerEvents="none"
              />
            )}
            {/* Main state shape */}
            {isExternal ? (
              <rect
                x={cx - STATE_RADIUS} y={cy - STATE_RADIUS}
                width={STATE_RADIUS * 2} height={STATE_RADIUS * 2} rx={4}
                fill={stateFill} stroke={strokeColor}
                strokeWidth={isSelected ? 2.5 : 2} pointerEvents="none"
              />
            ) : (
              <circle
                cx={cx} cy={cy} r={STATE_RADIUS}
                fill={stateFill} stroke={strokeColor}
                strokeWidth={isSelected ? 2.5 : 2} pointerEvents="none"
              />
            )}
            {/* State label */}
            <text
              x={cx}
              y={cy}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="16"
              fill={C.ink}
              pointerEvents="none"
            >
              {comp.label}
            </text>
          </g>
        );
      }

      default:
        return (
          <rect
            x={comp.x}
            y={comp.y}
            width={w}
            height={h}
            rx={4}
            fill={bodyFill}
            stroke={bodyStroke}
            strokeWidth={bodyStrokeW}
          />
        );
    }
  };

  const renderPorts = () => {
    const isState = comp.type === 'STATE';

    if (isState) {
      const nodes = [
        { id: 'left',  x: cx - STATE_RADIUS, y: cy, side: 'left'  },
        { id: 'right', x: cx + STATE_RADIUS, y: cy, side: 'right' },
      ];
      return (
        <>
          {/* Full-ring wire-start hit area: dragging from anywhere on the
              outer rim starts a transition (the wire source is always the
              state's 'right' port, so one ring with port attrs suffices). */}
          <circle
            cx={cx}
            cy={cy}
            r={STATE_RADIUS + 10}
            fill="transparent"
            className="port-hit-area"
            data-port-compid={comp.id}
            data-port-id="right"
            data-port-side="right"
          />
          {/* Inner blocking circle — no port attrs, so inner clicks drag */}
          <circle cx={cx} cy={cy} r={STATE_RADIUS - 5} fill="transparent" />
          {/* Visual dots at left/right on the ring */}
          {nodes.map(({ id, x, y }) => (
            <circle
              key={`dot-${id}`}
              cx={x}
              cy={y}
              r={2.5}
              fill={C.dim}
              stroke={C.surface}
              strokeWidth={1}
              pointerEvents="none"
            />
          ))}
        </>
      );
    }

    return (
      <>
        {comp.ports.map((port) => {
          const pos = getPortPositionLocal(comp, port.id);
          return (
            <g key={port.id}>
              <circle
                cx={pos.x}
                cy={pos.y}
                r={PORT_HIT_RADIUS}
                fill="transparent"
                className="port-hit-area"
                data-port-compid={comp.id}
                data-port-id={port.id}
                data-port-side={port.side}
              />
              <circle
                cx={pos.x}
                cy={pos.y}
                r={PORT_RADIUS}
                fill={signalColor(C, portValues?.get(`${comp.id}:${port.id}`))}
                pointerEvents="none"
              />
            </g>
          );
        })}
      </>
    );
  };

  const rotation = comp.rotation ?? 0;
  const centerX = comp.x + w / 2;
  const centerY = comp.y + h / 2;
  const shouldRotate = rotation !== 0;

  return (
    <g
      data-comp-id={comp.id}
      className="circuit-component"
      transform={shouldRotate ? `rotate(${rotation}, ${centerX}, ${centerY})` : undefined}
    >
      {renderGateBody()}
      {renderPorts()}
    </g>
  );
}

// ─── Wire rendering ──────────────────────────────────────────────


function WireView({
  wire,
  pathD,
  pathPoints,
  isSelected,
  fromPos,
  toPos,
  showValues,
  usedFallback,
  violation,
}: {
  wire: Wire;
  pathD: string;
  pathPoints: { x: number; y: number }[];
  isSelected: boolean;
  fromPos: { x: number; y: number };
  toPos: { x: number; y: number };
  showValues: boolean;
  usedFallback?: boolean;
  violation?: string;
}) {
  const C = canvasColors();
  const isBlankWire = wire.value === -1;
  // A wire is 2px in its signal's colour, selected or not (black = 0, red =
  // 1); a selected wire gets a lavender halo under it.
  const color = signalColor(C, isBlankWire ? 0 : wire.value);
  const valStr = isBlankWire ? '' : String(wire.value);

  // Route-quality indicator (warn, don't block — wire-routing design memo):
  // flagged wires stay fully functional; a hover tooltip names the flag, and
  // a violation additionally gets a faint dashed amber halo under the wire.
  // Deliberately NOT red/black dashes: wire color is semantic (black=0,
  // red=1 per VISUAL_VOCAB) and must stay untouched.
  const routeFlagTitle = violation
    ? `Routing warning: ${violation} — try dragging a wire segment`
    : usedFallback
      ? 'Routing note: this wire used the simple fallback path'
      : undefined;

  return (
    <g data-wire-id={wire.id} style={{ cursor: 'pointer' }}>
      {routeFlagTitle && <title>{routeFlagTitle}</title>}
      {/* Invisible wider path for easier clicking */}
      <path
        d={pathD}
        fill="none"
        stroke="transparent"
        strokeWidth={14}
        data-wire-id={wire.id}
      />
      {violation && (
        <path
          d={pathD}
          fill="none"
          stroke={C.warn}
          strokeWidth={6}
          strokeDasharray="4,6"
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity={0.35}
          pointerEvents="none"
          data-wire-violation={wire.id}
        />
      )}
      {isSelected && (
        <path
          d={pathD}
          fill="none"
          stroke={C.halo}
          strokeWidth={8}
          strokeLinejoin="round"
          strokeLinecap="round"
          pointerEvents="none"
          data-wire-halo={wire.id}
        />
      )}
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        pointerEvents="none"
      />
      {/* ── Manual wire segment dragging ──────────────────────────────
          Each segment in the path is a full straight run from one bend to
          the next (the A* path is simplified to merge collinear grid nodes).

          DRAGGING RULES — which segments can the user grab:
          • i=0: port → stub tip (source)      → NEVER draggable
          • i=1: stub tip → first bend (source) → NEVER draggable
          • i=len-3: last bend → stub tip (target) → NEVER draggable
          • i=len-2: stub tip → port (target)      → NEVER draggable
          • Everything else (i=2 … len-4): the "middle" routing segments
            — these are the bends and runs the router chose, and the user
            CAN drag them to manually adjust the wire path.

          PRIORITY NOTE: keeping stubs locked is critical because they
          encode port-facing direction. If a user could drag a stub, the
          wire would disconnect from the port visually. The middle segments
          are the ones that represent routing choices (where to bend, how
          far to run) and those are fair game for manual override. */}
      {pathPoints.map((_, i) => {
        if (i < 2 || i >= pathPoints.length - 3) return null;
        const p1 = pathPoints[i];
        const p2 = pathPoints[i + 1];
        if (!p1 || !p2) return null;
        const isHoriz = Math.abs(p1.y - p2.y) < 1;
        const isVert = Math.abs(p1.x - p2.x) < 1;
        if (!isHoriz && !isVert) return null;
        // Segment must have meaningful length to be draggable
        const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        if (len < 3) return null;
        return (
          <line
            key={`seg-${wire.id}-${i}`}
            x1={p1.x}
            y1={p1.y}
            x2={p2.x}
            y2={p2.y}
            stroke="transparent"
            strokeWidth={10}
            data-wire-segment-id={wire.id}
            data-segment-index={i}
            data-segment-axis={isHoriz ? 'y' : 'x'}
            style={{ cursor: isHoriz ? 'ns-resize' : 'ew-resize' }}
          />
        );
      })}
      {showValues && !isBlankWire && (() => {
        // Determine annotation positions from actual wire stub direction.
        // pathPoints[0]=port, [1]=stub tip tells us the source direction;
        // pathPoints[len-1]=port, [len-2]=stub tip tells us the target direction.
        const valFill = wire.value === 1 ? C.signal1 : C.dim;
        const fontProps = { fontSize: 10, fill: valFill, pointerEvents: 'none' as const };

        // Source annotation: placed just past the stub tip
        const srcDx = pathPoints.length >= 2 ? pathPoints[1].x - pathPoints[0].x : 1;
        const srcDy = pathPoints.length >= 2 ? pathPoints[1].y - pathPoints[0].y : 0;
        let srcX: number, srcY: number, srcAnchor: 'start' | 'end';
        if (Math.abs(srcDx) >= Math.abs(srcDy)) {
          // Horizontal stub
          srcX = srcDx >= 0 ? fromPos.x + 8 : fromPos.x - 8;
          srcY = fromPos.y - 6;
          srcAnchor = srcDx >= 0 ? 'start' : 'end';
        } else {
          // Vertical stub
          srcX = fromPos.x + 6;
          srcY = srcDy >= 0 ? fromPos.y + 12 : fromPos.y - 4;
          srcAnchor = 'start';
        }

        // Target annotation: placed just past the stub tip (arriving side)
        const n = pathPoints.length;
        const tgtDx = n >= 2 ? pathPoints[n - 2].x - pathPoints[n - 1].x : -1;
        const tgtDy = n >= 2 ? pathPoints[n - 2].y - pathPoints[n - 1].y : 0;
        let tgtX: number, tgtY: number, tgtAnchor: 'start' | 'end';
        if (Math.abs(tgtDx) >= Math.abs(tgtDy)) {
          // Horizontal stub
          tgtX = tgtDx >= 0 ? toPos.x + 8 : toPos.x - 8;
          tgtY = toPos.y - 6;
          tgtAnchor = tgtDx >= 0 ? 'start' : 'end';
        } else {
          // Vertical stub
          tgtX = toPos.x + 6;
          tgtY = tgtDy >= 0 ? toPos.y + 12 : toPos.y - 4;
          tgtAnchor = 'start';
        }

        return (
          <>
            <text x={srcX} y={srcY} textAnchor={srcAnchor} {...fontProps}>{valStr}</text>
            <text x={tgtX} y={tgtY} textAnchor={tgtAnchor} {...fontProps}>{valStr}</text>
          </>
        );
      })()}
    </g>
  );
}

// ─── FSM Transition View ─────────────────────────────────────────

function FsmTransitionView({
  wire,
  pathD,
  labelPos,
  controlPt,
  from,
  to,
  isSelected,
  onSnapGuides,
}: {
  wire: Wire;
  pathD: string;
  labelPos: { x: number; y: number };
  controlPt?: { x: number; y: number };
  from: { x: number; y: number };
  to: { x: number; y: number };
  isSelected: boolean;
  onSnapGuides: (guides: AlignGuide[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  // Field 0 = the input symbol; field 1+i = notation.outputFields[i]. Every
  // field is a fixed-width run of single-character tokens (an FSM question's
  // k-bit symbol, a TM transition's write+move outputs, a turbot motor pair …),
  // entered one character at a time.
  const [editFields, setEditFields] = useState<string[]>(['0', '0']);
  const [activeField, setActiveField] = useState(0);
  const [charPos, setCharPos] = useState(0);
  const [dragging, setDragging] = useState(false);
  const editorRef = useRef<HTMLInputElement>(null);

  // The label's grammar comes from the notation seam (engine/notation.ts):
  // the wire's SOURCE state picks the TransitionNotation — FSM sized to the
  // question's input/output group counts, base TM (two-output write,move;
  // alphabet tied to the question's representation), turbot-TM per state
  // kind, turbot-FSM motor labels. Token lists, field widths, and the
  // default label are all read from that one object; this component never
  // dissects a label string itself.
  const notation = useStore((s) =>
    selectTransitionNotationForSource(s, s.components.find((c) => c.id === wire.sourceComponentId)));
  const fieldWidths = [notation.inputWidth, ...notation.outputFields.map((f) => f.width)];
  const fieldTokens = [inputCharTokens(notation), ...notation.outputFields.map((f) => f.tokens)];
  // Separator rendered between output FIELDS (TM write,move) — mirrors the
  // stored canonical form, so the label reads exactly as it is stored.
  const outputSep = notation.outputSeparator ?? '';
  const totalChars = fieldWidths.reduce((a, b) => a + b, 0) +
    outputSep.length * (notation.outputFields.length - 1);
  const lastField = fieldWidths.length - 1;

  const label = wire.transitionLabel || '?:?';
  // Render canonical: a stored legacy alias (turbot-FSM '0:1', dual-action TM
  // '1:0R') displays as its canonical form ('0:11' / '1:0,R') — the same
  // string an edit-save would store.
  const parsedLabel = notation.parse(wire.transitionLabel);
  const displayLeft = parsedLabel?.input;
  const displayRight = parsedLabel ? parsedLabel.outputs.join(outputSep) : undefined;
  const C = canvasColors();
  const color = isSelected ? C.select : C.ink;

  useEffect(() => {
    if (editing && editorRef.current) {
      editorRef.current.focus();
    }
  }, [editing]);

  const openEdit = (field: number) => {
    const seed = parsedLabel ?? notation.parse(notation.defaultLabel)!;
    setEditFields([seed.input, ...seed.outputs]);
    setActiveField(Math.min(field, lastField));
    setCharPos(0);
    setEditing(true);
  };

  const commitEdit = (fields = editFields) => {
    setEditing(false);
    useStore.getState().setTransitionLabel(
      wire.id,
      notation.format({ input: fields[0], outputs: fields.slice(1) }),
    );
  };

  const setCharAt = (fields: string[], field: number, pos: number, ch: string): string[] => {
    const next = [...fields];
    const chars = next[field].split('');
    chars[pos] = ch;
    next[field] = chars.join('');
    return next;
  };

  const handleEditorKeyDown = (e: React.KeyboardEvent) => {
    let key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    // Turbot-TM external motor tokens aren't typable — accept aliases:
    // F/W/ArrowUp = forward (↑), R = right turn (↱), L = left turn (↰).
    if (notation.id === 'turbot-external' && activeField > 0) {
      if (key === 'F' || key === 'W' || e.key === 'ArrowUp') key = '↑';
      else if (key === 'R') key = '↱';
      else if (key === 'L') key = '↰';
    }
    const advance = () => {
      if (charPos + 1 < fieldWidths[activeField]) {
        setCharPos(charPos + 1);
        return true;
      }
      if (activeField < lastField) {
        setActiveField(activeField + 1);
        setCharPos(0);
        return true;
      }
      return false; // past the last character
    };
    if (fieldTokens[activeField].includes(key)) {
      e.preventDefault();
      const next = setCharAt(editFields, activeField, charPos, key);
      setEditFields(next);
      // Typing the final character commits immediately (with the fresh value
      // — the closure would otherwise capture the stale state).
      if (!advance()) commitEdit(next);
    } else if (e.key === 'Tab' || e.key === 'ArrowRight') {
      e.preventDefault();
      if (!advance()) {
        setActiveField(0);
        setCharPos(0);
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (charPos > 0) {
        setCharPos(charPos - 1);
      } else if (activeField > 0) {
        setActiveField(activeField - 1);
        setCharPos(fieldWidths[activeField - 1] - 1);
      } else {
        setActiveField(lastField);
        setCharPos(fieldWidths[lastField] - 1);
      }
    } else if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      commitEdit();
    }
  };

  // ── Drag handling for control point ──
  const handleDotPointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDragging(true);
    const el = e.currentTarget as SVGElement;
    el.setPointerCapture(e.pointerId);
  }, []);

  const handleDotPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    e.stopPropagation();
    const state = useStore.getState();
    const containerEl = (e.currentTarget as SVGElement).closest('svg')?.parentElement;
    if (!containerEl) return;
    const rect = containerEl.getBoundingClientRect();
    // Mouse position in canvas coords = desired on-curve midpoint
    let sx = (e.clientX - rect.left) / state.zoom - (state.panX ?? 0);
    let sy = (e.clientY - rect.top) / state.zoom - (state.panY ?? 0);
    // Object snapping: snap to state center X/Y lines and midpoint
    const SNAP_DIST = 8;
    const guides: AlignGuide[] = [];
    const snapXs: number[] = [];
    const snapYs: number[] = [];
    for (const comp of state.components) {
      if (comp.type !== 'STATE') continue;
      snapXs.push(comp.x + STATE_RADIUS);
      snapYs.push(comp.y + STATE_RADIUS);
    }
    // Also snap to midpoint between source and target
    snapXs.push((from.x + to.x) / 2);
    snapYs.push((from.y + to.y) / 2);
    for (const tx of snapXs) {
      if (Math.abs(sx - tx) < SNAP_DIST) {
        sx = tx;
        guides.push({ type: 'vertical', pos: tx, start: sy - 200, end: sy + 200 });
        break;
      }
    }
    for (const ty of snapYs) {
      if (Math.abs(sy - ty) < SNAP_DIST) {
        sy = ty;
        guides.push({ type: 'horizontal', pos: ty, start: sx - 200, end: sx + 200 });
        break;
      }
    }
    onSnapGuides(guides);
    // Convert on-curve midpoint to bezier control point:
    // For quadratic bezier, point at t=0.5 = (S + 2*C + E) / 4
    // So C = (4*P - S - E) / 2
    const cx = (4 * sx - from.x - to.x) / 2;
    const cy = (4 * sy - from.y - to.y) / 2;
    state.setFsmControlPt(wire.id, { x: cx, y: cy });
  }, [dragging, wire.id, from, to, onSnapGuides]);

  const handleDotPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    e.stopPropagation();
    setDragging(false);
    onSnapGuides([]);
    (e.currentTarget as SVGElement).releasePointerCapture(e.pointerId);
  }, [dragging, onSnapGuides]);

  return (
    <g data-wire-id={wire.id} style={{ cursor: 'pointer' }}>
      {/* SVG arrowhead marker definition */}
      <defs>
        <marker
          id={`arrow-${wire.id}`}
          markerWidth="10"
          markerHeight="8"
          refX="10"
          refY="4"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M0,0.5 L10,4 L0,7.5 Z" fill={color} />
        </marker>
      </defs>
      {/* Invisible wider path for easier clicking */}
      <path
        d={pathD}
        fill="none"
        stroke="transparent"
        strokeWidth={14}
        data-wire-id={wire.id}
      />
      {/* Visible curve with arrowhead */}
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={isSelected ? 2.5 : 2}
        strokeLinecap="round"
        markerEnd={`url(#arrow-${wire.id})`}
        pointerEvents="none"
      />
      {/* Draggable control point dot on the wire */}
      {controlPt && (
        <circle
          cx={controlPt.x}
          cy={controlPt.y}
          r={4}
          fill={dragging ? C.select : C.surface}
          stroke={color}
          strokeWidth={1.5}
          style={{ cursor: 'move' }}
          onPointerDown={handleDotPointerDown}
          onPointerMove={handleDotPointerMove}
          onPointerUp={handleDotPointerUp}
        />
      )}
      {/* Transition label — click either half to edit that field */}
      {!editing && (() => {
        const H = 18;
        if (displayLeft === undefined || displayRight === undefined) {
          // Unparseable/stale label: show it verbatim as one box; a click
          // opens the editor seeded from the notation's default.
          const W = Math.max(36, 16 + 8 * label.length);
          const x0 = labelPos.x - W / 2;
          const y0 = labelPos.y - H / 2;
          return (
            <g>
              <rect x={x0} y={y0} width={W} height={H} rx={3}
                fill={C.surface} fillOpacity={0.92} stroke={C.line2} strokeWidth={0.5} pointerEvents="none" />
              <rect x={x0} y={y0} width={W} height={H} rx={3} fill="transparent" style={{ cursor: 'text' }}
                onClick={(e) => { e.stopPropagation(); openEdit(0); }} />
              <text x={labelPos.x} y={labelPos.y} textAnchor="middle" dominantBaseline="central"
                fontSize="12"
                fill={color} pointerEvents="none">{label}</text>
            </g>
          );
        }
        // Width scales with the notation's character count (an FSM question's
        // k-bit symbol, TM's 2-char action, a turbot motor pair).
        const CHAR_W = 10;
        const leftW = 8 + CHAR_W * displayLeft.length;
        const rightW = 8 + CHAR_W * displayRight.length;
        const W = leftW + rightW;
        const x0 = labelPos.x - W / 2;
        const y0 = labelPos.y - H / 2;
        const sepX = x0 + leftW;
        return (
          <g>
            {/* Background */}
            <rect x={x0} y={y0} width={W} height={H} rx={3}
              fill={C.surface} fillOpacity={0.92} stroke={C.line2} strokeWidth={0.5} pointerEvents="none" />
            {/* Left half (input) — click target */}
            <rect x={x0} y={y0} width={leftW} height={H} rx={3} fill="transparent" style={{ cursor: 'text' }}
              onClick={(e) => { e.stopPropagation(); openEdit(0); }} />
            {/* Right half (outputs) — click target */}
            <rect x={sepX} y={y0} width={rightW} height={H} rx={3} fill="transparent" style={{ cursor: 'text' }}
              onClick={(e) => { e.stopPropagation(); openEdit(1); }} />
            {/* Input symbol */}
            <text x={x0 + leftW / 2} y={labelPos.y} textAnchor="middle" dominantBaseline="central"
              fontSize="12"
              fill={color} pointerEvents="none">{displayLeft}</text>
            {/* Separator */}
            <line x1={sepX} y1={y0 + 3} x2={sepX} y2={y0 + H - 3}
              stroke={C.line2} strokeWidth={1} pointerEvents="none" />
            {/* Output symbol(s) */}
            <text x={sepX + rightW / 2} y={labelPos.y} textAnchor="middle" dominantBaseline="central"
              fontSize="12"
              fill={color} pointerEvents="none">{displayRight}</text>
          </g>
        );
      })()}
      {editing && (
        <foreignObject
          x={labelPos.x - (14 + 7 * totalChars)}
          y={labelPos.y - 15}
          width={28 + 14 * totalChars}
          height={30}
        >
          <div
            // Lets the canvas-level pointerdown handler recognize a click on
            // the OTHER half of this editor and skip its forced blur, so the
            // click can switch the active field instead of closing the editor.
            data-fsm-transition-editor="true"
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'stretch',
              width: '100%',
              height: '100%',
              border: `1.5px solid ${canvasVar('select')}`,
              borderRadius: 4,
              background: canvasVar('surface'),
              boxSizing: 'border-box',
              outline: 'none',
              overflow: 'hidden',
            }}
          >
            {/* A tabIndex'd <div> inside an SVG <foreignObject> doesn't reliably
                take/keep keyboard focus in WebKit, so onKeyDown never fired and
                0/1 presses were silently dropped. A real <input> focuses
                reliably; keep it invisible and overlaid so the two colored
                halves below remain the visible UI. */}
            <input
              ref={editorRef}
              readOnly
              value=""
              onKeyDown={handleEditorKeyDown}
              onBlur={() => commitEdit()}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                margin: 0,
                padding: 0,
                border: 'none',
                background: 'transparent',
                color: 'transparent',
                caretColor: 'transparent',
                outline: 'none',
                cursor: 'default',
                // Let clicks fall through to the two halves below (which set
                // the active field and refocus this input) instead of the
                // absolutely-positioned input eating them.
                pointerEvents: 'none',
              }}
            />
            {/* Input half (field 0) */}
            <div
              onClick={(e) => { e.stopPropagation(); setActiveField(0); setCharPos(0); editorRef.current?.focus(); }}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: activeField === 0 ? canvasVar('select') : 'transparent',
                color: activeField === 0 ? canvasVar('surface') : canvasVar('ink'),
                fontFamily: 'var(--mm-font-sans)',
                fontVariantNumeric: 'tabular-nums',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'default',
                userSelect: 'none',
              }}
            >
              {editFields[0].split('').map((ch, i) => (
                <span key={i} style={{ opacity: activeField === 0 && charPos !== i ? 0.5 : 1 }}>{ch}</span>
              ))}
            </div>
            {/* Separator */}
            <div style={{
              width: 1, alignSelf: 'stretch', margin: '5px 1px',
              background: canvasVar('line2'), flexShrink: 0,
            }} />
            {/* Output half — every output field's characters in sequence,
                with the notation's separator between fields (a TM's
                write,move; an FSM question's k output bits; a turbot motor
                pair). The character being entered is full-opacity; its
                field-mates dim, like the old TM sub-fields. */}
            <div
              onClick={(e) => {
                e.stopPropagation();
                setActiveField(Math.min(1, lastField));
                setCharPos(0);
                editorRef.current?.focus();
              }}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: activeField > 0 ? canvasVar('select') : 'transparent',
                color: activeField > 0 ? canvasVar('surface') : canvasVar('ink'),
                fontFamily: 'var(--mm-font-sans)',
                fontVariantNumeric: 'tabular-nums',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'default',
                userSelect: 'none',
              }}
            >
              {editFields.slice(1).flatMap((field, fi) => [
                ...(fi > 0 && outputSep
                  ? [<span key={`sep:${fi}`} style={{ opacity: 0.5 }}>{outputSep}</span>]
                  : []),
                ...field.split('').map((ch, i) => (
                  <span
                    key={`${fi}:${i}`}
                    style={{ opacity: activeField > 0 && !(activeField === fi + 1 && charPos === i) ? 0.5 : 1 }}
                  >{ch}</span>
                )),
              ])}
            </div>
          </div>
        </foreignObject>
      )}
    </g>
  );
}

// ─── Box View ────────────────────────────────────────────────────

function BoxView({
  box,
  isDraft,
  isHighlighted,
  isEditingName,
  onFinishEditName,
  onNotice,
}: {
  box: BoxDefinition;
  isDraft: boolean;
  isHighlighted: boolean;
  isEditingName?: boolean;
  onFinishEditName?: () => void;
  /** Where a refused paste into the rename field explains itself (the
   *  canvas's notice line — the field is too small to hold one). */
  onNotice?: (message: string) => void;
}) {
  const removeConfirmedBox = useStore((s) => s.removeConfirmedBox);
  const putAwayBox = useStore((s) => s.putAwayBox);
  const [hovered, setHovered] = useState(false);
  const C = canvasColors();
  // Box names are part of the graded circuit: the rename wears the provenance
  // guard like every assignment answer field (law 8).
  const { ref: pasteGuardRef } = usePasteGuard(onNotice);

  // Compute port positions along box boundary
  const inputPortPositions = useMemo(() => {
    if (isDraft || box.inputPortIds.length === 0) return [];
    const count = box.inputPortIds.length;
    const spacing = box.height / (count + 1);
    return box.inputPortIds.map((_, i) => ({
      x: box.x,
      y: box.y + spacing * (i + 1),
    }));
  }, [isDraft, box.inputPortIds, box.x, box.y, box.height]);

  const outputPortPositions = useMemo(() => {
    if (isDraft || box.outputPortIds.length === 0) return [];
    const count = box.outputPortIds.length;
    const spacing = box.height / (count + 1);
    return box.outputPortIds.map((_, i) => ({
      x: box.x + box.width,
      y: box.y + spacing * (i + 1),
    }));
  }, [isDraft, box.outputPortIds, box.x, box.y, box.width, box.height]);

  return (
    <g data-box-id={box.id} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {/* Main box rect */}
      <rect
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        fill={isDraft ? C.selectFill : C.quiet}
        fillOpacity={isDraft ? 0.35 : 0.5}
        stroke={isDraft || isHighlighted ? C.select : C.ink}
        strokeWidth={isDraft ? 2 : 2}
        strokeDasharray={isDraft ? '6,3' : undefined}
        rx={4}
        data-box-id={box.id}
      />
      {/* Invisible wider hit area on box edge for dragging confirmed boxes */}
      {!isDraft && (
        <rect
          x={box.x - 6}
          y={box.y - 6}
          width={box.width + 12}
          height={box.height + 12}
          fill="none"
          stroke="transparent"
          strokeWidth={12}
          rx={4}
          data-box-edge={box.id}
          style={{ cursor: 'move' }}
          pointerEvents="stroke"
        />
      )}
      {/* Input port indicators (left side) */}
      {inputPortPositions.map((pos, i) => (
        <g key={`in-${i}`}>
          <line
            x1={pos.x - 8}
            y1={pos.y}
            x2={pos.x}
            y2={pos.y}
            stroke={C.ink}
            strokeWidth={2}
          />
          <circle cx={pos.x - 8} cy={pos.y} r={3} fill={C.ink2} />
        </g>
      ))}
      {/* Output port indicators (right side) */}
      {outputPortPositions.map((pos, i) => (
        <g key={`out-${i}`}>
          <line
            x1={pos.x}
            y1={pos.y}
            x2={pos.x + 8}
            y2={pos.y}
            stroke={C.ink}
            strokeWidth={2}
          />
          <circle cx={pos.x + 8} cy={pos.y} r={3} fill={C.ink2} />
        </g>
      ))}
      {/* Editable label — double-click to rename confirmed boxes */}
      {!isDraft && isEditingName ? (
        <foreignObject x={box.x + 2} y={box.y - 20} width={120} height={18}>
          <input
            autoFocus
            ref={pasteGuardRef}
            defaultValue={box.name}
            onFocus={(e) => e.target.select()}
            onBlur={(e) => {
              const name = e.target.value.trim();
              if (name && name !== box.name) {
                const err = useStore.getState().renameBox(box.id, name);
                if (err) alert(err);
              }
              onFinishEditName?.();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              // Restore before blurring: the blur handler is what commits.
              if (e.key === 'Escape') {
                (e.target as HTMLInputElement).value = box.name;
                (e.target as HTMLInputElement).blur();
              }
            }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            style={{ width: '100%', fontSize: 11, fontWeight: 600, border: `1px solid ${canvasVar('select')}`, borderRadius: 2, padding: '0 4px', outline: 'none', fontFamily: 'var(--mm-font-sans)' }}
          />
        </foreignObject>
      ) : (
        <g data-box-name={isDraft ? undefined : box.id}>
          {/* Invisible hit area behind the text for reliable click detection */}
          {!isDraft && (
            <rect
              x={box.x + 2}
              y={box.y - 16}
              width={Math.max(60, box.name.length * 7 + 12)}
              height={16}
              fill="transparent"
              data-box-name={box.id}
              style={{ cursor: 'pointer' }}
            />
          )}
          <text
            x={box.x + 6}
            y={box.y - 4}
            fontSize="11"
            fontWeight="600"
            fill={isDraft ? C.select : C.ink}
            style={{ cursor: isDraft ? 'default' : 'pointer' }}
            pointerEvents={isDraft ? 'none' : 'auto'}
            data-box-name={isDraft ? undefined : box.id}
          >
            {isDraft ? 'new box' : box.name}
          </text>
        </g>
      )}
      {/* Resize handles for draft box */}
      {isDraft && (
        <>
          {['nw', 'ne', 'sw', 'se'].map((corner) => {
            const hx = corner.includes('e') ? box.x + box.width : box.x;
            const hy = corner.includes('s') ? box.y + box.height : box.y;
            return (
              <rect
                key={corner}
                x={hx - 5}
                y={hy - 5}
                width={10}
                height={10}
                fill={C.surface}
                stroke={C.select}
                strokeWidth={1.5}
                rx={2}
                data-box-resize={box.id}
                data-resize-corner={corner}
                style={{ cursor: `${corner}-resize` }}
              />
            );
          })}
        </>
      )}
      {/* Delete button — top-right corner, visible on hover */}
      {!isDraft && hovered && (
        <g
          style={{ cursor: 'pointer' }}
          onPointerDown={(e) => {
            e.stopPropagation();
            removeConfirmedBox(box.id);
          }}
        >
          <circle cx={box.x + box.width - 8} cy={box.y + 8} r={7} fill={C.surface} stroke={C.line2} strokeWidth={1} />
          <text
            x={box.x + box.width - 8}
            y={box.y + 8}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="10"
            fill={C.dim}
            pointerEvents="none"
          >
            ×
          </text>
        </g>
      )}
      {!isDraft && hovered && (
        <g
          style={{ cursor: 'pointer' }}
          onPointerDown={(e) => {
            e.stopPropagation();
            const error = putAwayBox(box.id);
            if (error) onNotice?.(error);
          }}
        >
          <title>Put away: take this design off the canvas (the box stays in the library)</title>
          <circle cx={box.x + box.width - 26} cy={box.y + 8} r={7} fill={C.surface} stroke={C.line2} strokeWidth={1} />
          <text
            x={box.x + box.width - 26}
            y={box.y + 8}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="10"
            fill={C.dim}
            pointerEvents="none"
          >
            ↓
          </text>
        </g>
      )}
    </g>
  );
}

// ─── Palette ghost ───────────────────────────────────────────────

/** The part a palette tile would place, drawn at 55% under the pointer while
 *  the tile is dragged over open canvas (Palette.tsx runs the drag; its tiny
 *  store changes at pointer rate, so only this re-renders). */
function PaletteGhost({ containerRef }: { containerRef: React.RefObject<HTMLDivElement | null> }) {
  const drag = usePaletteDrag((s) => s.drag);
  const library = useStore((s) => s.confirmedBoxLibrary);
  const rect = drag?.overCanvas ? containerRef.current?.getBoundingClientRect() : undefined;
  if (!drag || !rect) return null;
  const comp = toolComponent(drag.tool, library);
  if (!comp) return null;
  const at = clientToCanvas({ x: drag.clientX, y: drag.clientY }, rect, useStore.getState());
  const origin = placementOrigin(comp, at.x, at.y);
  return (
    <g className="cv-ghost" pointerEvents="none">
      <CircuitComponentView comp={{ ...comp, x: origin.x, y: origin.y }} isSelected={false} />
    </g>
  );
}

// ─── Navigation Arrow ────────────────────────────────────────────

function NavigationArrow({
  direction,
  onClick,
}: {
  direction: 'left' | 'right' | 'up' | 'down';
  onClick: () => void;
}) {
  const arrows: Record<string, string> = {
    left: '\u2190',
    right: '\u2192',
    up: '\u2191',
    down: '\u2193',
  };

  // The look is workbench.css .cv-nav; only the edge it sits on is inline.
  const posStyle: React.CSSProperties = {};

  if (direction === 'left') Object.assign(posStyle, { left: 8, top: '50%', transform: 'translateY(-50%)' });
  if (direction === 'right') Object.assign(posStyle, { right: 8, top: '50%', transform: 'translateY(-50%)' });
  if (direction === 'up') Object.assign(posStyle, { top: 8, left: '50%', transform: 'translateX(-50%)' });
  if (direction === 'down') Object.assign(posStyle, { bottom: 8, left: '50%', transform: 'translateX(-50%)' });

  return (
    <button type="button" className="cv-nav" style={posStyle} onClick={onClick} title="Show the circuit">
      {arrows[direction]}
    </button>
  );
}

// ─── Main Canvas ─────────────────────────────────────────────────

export function CircuitCanvas() {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const dragRef = useRef<DragInfo | null>(null);

  const [wirePreview, setWirePreview] = useState<{
    fromX: number; fromY: number; toX: number; toY: number;
  } | null>(null);
  const [boxSelect, setBoxSelect] = useState<{
    x1: number; y1: number; x2: number; y2: number;
  } | null>(null);
  const [alignGuides, setAlignGuides] = useState<AlignGuide[]>([]);
  const [isPanning, setIsPanning] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 });
  const [editingBoxId, setEditingBoxId] = useState<string | null>(null);
  // A refused paste's explanation (provenance.ts refusalMessage), from the
  // canvas's own Cmd+V or a box-rename field's guard.
  const [pasteNotice, showPasteNotice] = useNotice();
  const [drawBoxPreview, setDrawBoxPreview] = useState<{
    x: number; y: number; w: number; h: number;
  } | null>(null);
  const [wireSegmentViolation, setWireSegmentViolation] = useState<{
    x1: number; y1: number; x2: number; y2: number;
  } | null>(null);

  const rafRef = useRef<number>(0);
  const pendingOverlay = useRef<{
    wirePreview?: { fromX: number; fromY: number; toX: number; toY: number } | null;
    boxSelect?: { x1: number; y1: number; x2: number; y2: number } | null;
    alignGuides?: AlignGuide[];
    drawBoxPreview?: { x: number; y: number; w: number; h: number } | null;
    wireSegmentViolation?: { x1: number; y1: number; x2: number; y2: number } | null;
  }>({});

  // Subscribe to store
  const components = useStore((s) => s.components);
  const wires = useStore((s) => s.wires);
  const zoom = useStore((s) => s.zoom);
  const panX = useStore((s) => s.panX);
  const panY = useStore((s) => s.panY);
  const C = canvasColors();
  const showGrid = useStore((s) => s.showGrid);
  const showWireValues = useStore((s) => s.showWireValues);
  const selectedIds = useStore((s) => s.selectedIds);
  // For turbot questions the canvas edits the inner brain circuit, so
  // editor-behavior branches key off the effective (inner) mode.
  const effectiveMode = useStore(selectEffectiveMode);
  // The store decides whether the unbound-box warning shows (not on a locked
  // canvas); the canvas holds no lock of its own (law 3).
  const showUnboundBoxWarning = useStore(selectShowUnboundBoxWarning);
  const selectedTool = useStore((s) => s.selectedTool);
  const boxes = useStore((s) => s.boxes);
  const boxDrawing = useStore((s) => s.boxDrawing);

  // ─── Coordinate conversion ──────────────────────────────────────
  const screenToCanvas = useCallback(
    (screenX: number, screenY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      const state = useStore.getState();
      return {
        x: (screenX - rect.left - state.panX) / state.zoom,
        y: (screenY - rect.top - state.panY) / state.zoom,
      };
    },
    []
  );

  // ─── Validation warnings ───────────────────────────────────────
  const warnings = useMemo(() => {
    const w: string[] = [];
    // Skip circuit validation warnings in FSM/TM mode — loops and merged links are expected
    if (effectiveMode === 'FSM' || effectiveMode === 'TM') return w;
    // A loop no MEM breaks — looking through sequential boxes, whose inner
    // MEM may be what breaks a loop drawn around them.
    if (hasCombinationalLoop(components, wires)) {
      w.push('Warning: Loop detected in combinatorial circuit');
    }
    const inputPortConnections = new Map<string, number>();
    for (const wire of wires) {
      const key = `${wire.targetComponentId}:${wire.targetPortId}`;
      inputPortConnections.set(key, (inputPortConnections.get(key) || 0) + 1);
    }
    for (const [key, count] of inputPortConnections) {
      if (count > 1) {
        w.push(`Warning: Merged link detected on port ${key.split(':')[1]}`);
      }
    }
    // A box saved before 038 whose ports no rule could bind (boxPorts.ts):
    // those ports read 0 until it is placed again.
    if (showUnboundBoxWarning) {
      for (const label of unboundBoxes(components)) {
        w.push(`Warning: ${label} has ports not connected to anything inside — draw and place it again`);
      }
    }
    return w;
  }, [components, wires, effectiveMode, showUnboundBoxWarning]);

  // ─── Keyboard shortcuts ──────────────────────────────────────
  // Which command a key press is lives in ONE pure table (shortcuts.ts, task
  // 058: case-free, so Shift or Caps Lock never turns ⌘Z's "z" into a miss;
  // Ctrl+Y redoes too); this handler only dispatches. Undo and redo are the
  // store's, which carry the lock (law 3).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isTextEntryTarget(document.activeElement as HTMLElement | null)) return;
      const command = editorShortcut(e);
      if (!command) return;
      const state = useStore.getState();
      switch (command) {
        case 'escape':
          // Esc disarms the palette tool, closes the Boxes pop-out and
          // cancels a box being drawn.
          state.setSelectedTool(null);
          if (state.boxesPopoutOpen) state.setBoxesPopoutOpen(false);
          if (state.boxDrawing.phase !== 'idle') {
            state.setBoxDrawingPhase('idle');
            state.setDraftBox(null);
          }
          return;
        case 'delete':
          e.preventDefault();
          state.deleteSelected();
          return;
        case 'undo':
          e.preventDefault();
          state.undo();
          return;
        case 'redo':
          e.preventDefault();
          state.redo();
          return;
        case 'copy':
          e.preventDefault();
          state.copySelected();
          return;
        case 'paste': {
          e.preventDefault();
          const refused = state.paste();
          if (refused) showPasteNotice(refused);
          return;
        }
        case 'selectAll':
          e.preventDefault();
          state.setSelectedIds(state.components.map((c) => c.id));
          return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showPasteNotice]);

  // ─── Wheel: zoom / pan ─────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const state = useStore.getState();
      if (e.ctrlKey || e.metaKey) {
        const delta = -e.deltaY * 0.005;
        state.setZoom(state.zoom + delta);
      } else {
        state.setPan(state.panX - e.deltaX, state.panY - e.deltaY);
      }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  // ─── Track container size ──────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ─── Find what's under the mouse ───────────────────────────────
  function findTarget(e: React.PointerEvent | PointerEvent) {
    const target = e.target as SVGElement;

    // Check for port
    const portEl =
      target.getAttribute('data-port-compid')
        ? target
        : target.closest<SVGElement>('[data-port-compid]');
    if (portEl) {
      return {
        type: 'port' as const,
        compId: portEl.getAttribute('data-port-compid')!,
        portId: portEl.getAttribute('data-port-id')!,
        portSide: portEl.getAttribute('data-port-side')!,
      };
    }

    // Check for wire segment (for manual movement)
    const wireSegEl = target.getAttribute('data-wire-segment-id')
      ? target
      : target.closest<SVGElement>('[data-wire-segment-id]');
    if (wireSegEl) {
      return {
        type: 'wiresegment' as const,
        wireId: wireSegEl.getAttribute('data-wire-segment-id')!,
        segmentIndex: parseInt(wireSegEl.getAttribute('data-segment-index')!),
        segmentAxis: wireSegEl.getAttribute('data-segment-axis')! as 'x' | 'y',
      };
    }

    // Check for box resize handle
    const boxResizeEl = target.getAttribute('data-box-resize')
      ? target
      : target.closest<SVGElement>('[data-box-resize]');
    if (boxResizeEl) {
      return {
        type: 'boxresize' as const,
        boxId: boxResizeEl.getAttribute('data-box-resize')!,
        corner: boxResizeEl.getAttribute('data-resize-corner')!,
      };
    }

    // Check for box name text (for double-click rename / drag)
    const boxNameEl = target.getAttribute('data-box-name')
      ? target
      : target.closest<SVGElement>('[data-box-name]');
    if (boxNameEl) {
      return {
        type: 'boxname' as const,
        boxId: boxNameEl.getAttribute('data-box-name')!,
      };
    }

    // Check for confirmed box edge (for dragging)
    const boxEdgeEl = target.getAttribute('data-box-edge')
      ? target
      : target.closest<SVGElement>('[data-box-edge]');
    if (boxEdgeEl) {
      return {
        type: 'boxedge' as const,
        boxId: boxEdgeEl.getAttribute('data-box-edge')!,
      };
    }


    // Check for wire
    const wireEl =
      target.getAttribute('data-wire-id')
        ? target
        : target.closest<SVGElement>('[data-wire-id]');
    if (wireEl) {
      return {
        type: 'wire' as const,
        wireId: wireEl.getAttribute('data-wire-id')!,
      };
    }

    // Check for component
    const compEl =
      target.getAttribute('data-comp-id')
        ? target
        : target.closest<SVGElement>('[data-comp-id]');
    if (compEl) {
      return {
        type: 'component' as const,
        compId: compEl.getAttribute('data-comp-id')!,
      };
    }

    return { type: 'canvas' as const };
  }

  // ─── Request overlay repaint ──────────────────────────────────
  const requestOverlayUpdate = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const p = pendingOverlay.current;
      if ('wirePreview' in p) setWirePreview(p.wirePreview ?? null);
      if ('boxSelect' in p) setBoxSelect(p.boxSelect ?? null);
      if ('alignGuides' in p) setAlignGuides(p.alignGuides ?? []);
      if ('drawBoxPreview' in p) setDrawBoxPreview(p.drawBoxPreview ?? null);
      if ('wireSegmentViolation' in p) setWireSegmentViolation(p.wireSegmentViolation ?? null);
      pendingOverlay.current = {};
    });
  }, []);

  // ─── Pointer event handlers ─────────────────────────────────────
  const handlersRef = useRef<{
    onMove: (e: PointerEvent) => void;
    onUp: (e: PointerEvent) => void;
  }>({
    onMove: () => {},
    onUp: () => {},
  });

  const stableOnMove = useCallback(
    (e: PointerEvent) => handlersRef.current.onMove(e),
    []
  );
  const stableOnUp = useCallback(
    (e: PointerEvent) => handlersRef.current.onUp(e),
    []
  );

  // ─── Pending (armed) wire: a click on a source port arms a wire that
  //     follows the cursor; the next click on a valid target completes it ───
  const pendingWireRef = useRef<{
    sourceCompId: string;
    sourcePortId: string;
    fromX: number;
    fromY: number;
  } | null>(null);

  // A Mac ctrl-click is also a context-menu click: set by a ctrl+left press
  // that ran a gesture (swallowMacMenu, modifier map), it tells onContextMenu
  // to swallow the menu that follows. Pointer-up clears it (the Mac menu comes
  // on pointer-down, before it), so a Windows/Linux ctrl-click, which raises
  // no menu, leaves nothing armed.
  const menuSuppressRef = useRef(false);

  const pendingWireMove = useCallback(
    (e: PointerEvent) => {
      const p = pendingWireRef.current;
      if (!p) return;
      const pos = screenToCanvas(e.clientX, e.clientY);
      pendingOverlay.current.wirePreview = {
        fromX: p.fromX, fromY: p.fromY, toX: pos.x, toY: pos.y,
      };
      requestOverlayUpdate();
    },
    [screenToCanvas, requestOverlayUpdate]
  );

  const clearPendingWire = useCallback(() => {
    if (!pendingWireRef.current) return;
    pendingWireRef.current = null;
    window.removeEventListener('pointermove', pendingWireMove);
    pendingOverlay.current.wirePreview = null;
    requestOverlayUpdate();
  }, [pendingWireMove, requestOverlayUpdate]);

  useEffect(() => {
    handlersRef.current.onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      const state = useStore.getState();

      if (drag.type === 'pan') {
        const dx = e.clientX - drag.anchorScreenX;
        const dy = e.clientY - drag.anchorScreenY;
        state.setPan(drag.origPanX! + dx, drag.origPanY! + dy);
        return;
      }

      const canvasPos = screenToCanvas(e.clientX, e.clientY);

      if (drag.type === 'move' && drag.moveOffsets) {
        drag.hasMoved = true;

        const moves = new Map<string, { x: number; y: number }>();
        let primaryComp: CircuitComponent | undefined;

        for (const [id, offset] of drag.moveOffsets) {
          const newX = canvasPos.x - offset.dx;
          const newY = canvasPos.y - offset.dy;
          moves.set(id, { x: newX, y: newY });
          if (id === drag.componentId) {
            primaryComp = state.components.find((c) => c.id === id);
          }
        }

        if (state.snapToAlign && primaryComp) {
          const pos = moves.get(drag.componentId!);
          if (pos) {
            const testComp = { ...primaryComp, x: pos.x, y: pos.y };
            const movingIds = new Set(drag.moveOffsets.keys());
            const { guides, snapDx, snapDy } = findAlignmentGuides(
              testComp,
              state.components,
              movingIds
            );

            if (snapDx !== 0 || snapDy !== 0) {
              for (const [id, p] of moves) {
                moves.set(id, { x: p.x + snapDx, y: p.y + snapDy });
              }
            }

            pendingOverlay.current.alignGuides = guides;
            requestOverlayUpdate();
          }
        } else {
          pendingOverlay.current.alignGuides = [];
          requestOverlayUpdate();
        }

        state.moveComponentsBatch(moves);
        return;
      }

      if (drag.type === 'wire') {
        drag.currentCanvasX = canvasPos.x;
        drag.currentCanvasY = canvasPos.y;
        pendingOverlay.current.wirePreview = {
          fromX: drag.wireFromX!,
          fromY: drag.wireFromY!,
          toX: canvasPos.x,
          toY: canvasPos.y,
        };
        requestOverlayUpdate();
        return;
      }

      if (drag.type === 'boxselect') {
        drag.currentCanvasX = canvasPos.x;
        drag.currentCanvasY = canvasPos.y;
        pendingOverlay.current.boxSelect = {
          x1: Math.min(drag.anchorCanvasX, canvasPos.x),
          y1: Math.min(drag.anchorCanvasY, canvasPos.y),
          x2: Math.max(drag.anchorCanvasX, canvasPos.x),
          y2: Math.max(drag.anchorCanvasY, canvasPos.y),
        };
        requestOverlayUpdate();
        return;
      }

      if (drag.type === 'drawbox') {
        const x = Math.min(drag.drawBoxStartX!, canvasPos.x);
        const y = Math.min(drag.drawBoxStartY!, canvasPos.y);
        const w = Math.abs(canvasPos.x - drag.drawBoxStartX!);
        const h = Math.abs(canvasPos.y - drag.drawBoxStartY!);
        pendingOverlay.current.drawBoxPreview = { x, y, w, h };
        requestOverlayUpdate();
        return;
      }

      if (drag.type === 'resizebox' && drag.boxId) {
        const corner = drag.boxCorner!;
        let newX = drag.origBoxX!;
        let newY = drag.origBoxY!;
        let newW = drag.origBoxW!;
        let newH = drag.origBoxH!;

        if (corner.includes('e')) {
          newW = Math.max(40, canvasPos.x - newX);
        }
        if (corner.includes('w')) {
          const right = newX + newW;
          newX = Math.min(canvasPos.x, right - 40);
          newW = right - newX;
        }
        if (corner.includes('s')) {
          newH = Math.max(40, canvasPos.y - newY);
        }
        if (corner.includes('n')) {
          const bottom = newY + newH;
          newY = Math.min(canvasPos.y, bottom - 40);
          newH = bottom - newY;
        }

        state.updateBox(drag.boxId, { x: newX, y: newY, width: newW, height: newH });
        return;
      }

      if (drag.type === 'movebox' && drag.moveBoxId) {
        drag.hasMoved = true;
        const newBoxX = canvasPos.x - drag.moveBoxOffsetX!;
        const newBoxY = canvasPos.y - drag.moveBoxOffsetY!;
        const box = state.boxes.find((b) => b.id === drag.moveBoxId);
        if (box) {
          state.updateBox(drag.moveBoxId, { x: newBoxX, y: newBoxY });
          // Move all components inside the box by the same delta
          if (drag.moveBoxCompOffsets) {
            const moves = new Map<string, { x: number; y: number }>();
            for (const [id, offset] of drag.moveBoxCompOffsets) {
              moves.set(id, {
                x: canvasPos.x - offset.dx,
                y: canvasPos.y - offset.dy,
              });
            }
            state.moveComponentsBatch(moves);
          }
        }
        return;
      }

      if (drag.type === 'wiresegment' && drag.wireId) {
        // Calculate offset from base position
        const wire = state.wires.find((w) => w.id === drag.wireId);
        if (!wire) return;
        const axis = drag.segmentAxis!;
        let currentValue = axis === 'x' ? canvasPos.x : canvasPos.y;

        // ─── Wire segment snapping (snap mode only) ───────────
        const WIRE_SNAP_THRESHOLD = 8;
        const guides: AlignGuide[] = [];

        if (state.snapToAlign) {
          // Collect snap targets: all port positions + all wire segment positions
          const snapTargets = new Set<number>();

          // 1. All port positions
          for (const comp of state.components) {
            for (const port of comp.ports) {
              const pos = getPortPosition(comp, port.id);
              snapTargets.add(axis === 'x' ? pos.x : pos.y);
            }
          }

          // 2. All wire segment positions (from current rendered paths)
          const wdMap = wireDataRef.current;
          for (const [wId, wd] of wdMap) {
            if (wId === drag.wireId) continue; // skip self
            for (let si = 0; si < wd.points.length - 1; si++) {
              const sp1 = wd.points[si];
              const sp2 = wd.points[si + 1];
              if (axis === 'x') {
                // For vertical segment drag (axis='x'), snap to other vertical segments' x
                if (Math.abs(sp1.x - sp2.x) < 1) snapTargets.add(sp1.x);
              } else {
                // For horizontal segment drag (axis='y'), snap to other horizontal segments' y
                if (Math.abs(sp1.y - sp2.y) < 1) snapTargets.add(sp1.y);
              }
            }
          }

          // Find best snap
          let bestDist = WIRE_SNAP_THRESHOLD + 1;
          let bestTarget = currentValue;
          for (const target of snapTargets) {
            const dist = Math.abs(currentValue - target);
            if (dist < bestDist) {
              bestDist = dist;
              bestTarget = target;
            }
          }

          if (bestDist <= WIRE_SNAP_THRESHOLD) {
            currentValue = bestTarget;
            // Create guide line
            if (axis === 'x') {
              guides.push({
                type: 'vertical',
                pos: bestTarget,
                start: canvasPos.y - 200,
                end: canvasPos.y + 200,
              });
            } else {
              guides.push({
                type: 'horizontal',
                pos: bestTarget,
                start: canvasPos.x - 200,
                end: canvasPos.x + 200,
              });
            }
          }
        }

        pendingOverlay.current.alignGuides = guides;

        const offset = currentValue - drag.segmentOrigValue!;
        const existingSegments = wire.manualSegments ? [...wire.manualSegments] : [];
        const existingIdx = existingSegments.findIndex(
          (s) => s.segmentIndex === drag.segmentIndex
        );
        // `base`: where the router ran this segment — the offset belongs to
        // that route and goes stale if the route moves (wireSegments.ts).
        const newSeg = { segmentIndex: drag.segmentIndex!, offset, axis, base: drag.segmentOrigValue };
        if (existingIdx >= 0) {
          existingSegments[existingIdx] = newSeg;
        } else {
          existingSegments.push(newSeg);
        }
        state.updateWireManualSegments(drag.wireId, existingSegments);

        // §9.4: Check if proposed segment position violates hard constraints
        const wd = wireDataRef.current.get(drag.wireId);
        if (wd) {
          const pts = applyManualSegments(wd.basePoints, existingSegments);
          const segIdx = drag.segmentIndex!;
          if (segIdx >= 0 && segIdx < pts.length - 1) {
            const sp1 = pts[segIdx], sp2 = pts[segIdx + 1];
            const valid = validateSegmentPosition(sp1, sp2, state.components);
            pendingOverlay.current.wireSegmentViolation = valid
              ? null
              : { x1: sp1.x, y1: sp1.y, x2: sp2.x, y2: sp2.y };
          }
        }

        requestOverlayUpdate();
        return;
      }
    };

    handlersRef.current.onUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      dragRef.current = null;
      setIsPanning(false);
      setAlignGuides([]);
      setWireSegmentViolation(null);

      // §9.4: On release, if the manual segment violates a hard constraint, revert it
      if (drag.type === 'wiresegment' && drag.wireId) {
        const storeState = useStore.getState();
        const wire = storeState.wires.find((w) => w.id === drag.wireId);
        const wd = wireDataRef.current.get(drag.wireId);
        if (wire && wd) {
          const pts = applyManualSegments(wd.basePoints, wire.manualSegments);
          const segIdx = drag.segmentIndex!;
          if (segIdx >= 0 && segIdx < pts.length - 1) {
            const sp1 = pts[segIdx], sp2 = pts[segIdx + 1];
            if (!validateSegmentPosition(sp1, sp2, storeState.components)) {
              // Revert: remove this manual segment override
              const reverted = (wire.manualSegments ?? []).filter(
                (s) => s.segmentIndex !== segIdx
              );
              storeState.updateWireManualSegments(drag.wireId, reverted);
            }
          }
        }
      }

      if (drag.pointerId != null && svgRef.current) {
        try {
          svgRef.current.releasePointerCapture(drag.pointerId);
        } catch {
          // ignore
        }
      }

      window.removeEventListener('pointermove', stableOnMove);
      window.removeEventListener('pointerup', stableOnUp);

      const state = useStore.getState();

      if (drag.type === 'wire') {
        // A click that never really moved doesn't drop the wire — it ARMS it:
        // the wire stays attached to the cursor and the next click on a valid
        // target completes it (so click-port-then-click-state connects, and a
        // stray click on a state's rim no longer creates an instant self-loop).
        // Rewires are exempt: there a plain click re-attaches the wire.
        const movedDist = Math.hypot(
          e.clientX - drag.anchorScreenX,
          e.clientY - drag.anchorScreenY
        );
        if (movedDist < 5 && !drag.isRewire) {
          pendingWireRef.current = {
            sourceCompId: drag.sourceCompId!,
            sourcePortId: drag.sourcePortId!,
            fromX: drag.wireFromX!,
            fromY: drag.wireFromY!,
          };
          window.addEventListener('pointermove', pendingWireMove);
          return;
        }
        const canvasPos = screenToCanvas(e.clientX, e.clientY);
        const target = findWireTarget(state.components, canvasPos, drag.sourceCompId);
        if (target) {
          state.addWire(
            drag.sourceCompId!,
            drag.sourcePortId!,
            target.comp.id,
            target.port.id
          );
        }
        pendingOverlay.current.wirePreview = null;
        requestOverlayUpdate();
        return;
      }

      if (drag.type === 'boxselect') {
        const x1 = Math.min(drag.anchorCanvasX, drag.currentCanvasX);
        const y1 = Math.min(drag.anchorCanvasY, drag.currentCanvasY);
        const x2 = Math.max(drag.anchorCanvasX, drag.currentCanvasX);
        const y2 = Math.max(drag.anchorCanvasY, drag.currentCanvasY);

        if (Math.abs(x2 - x1) > 5 || Math.abs(y2 - y1) > 5) {
          const compIds = state.components
            .filter((c) => {
              const { w, h } = getCompDimensions(c);
              return c.x + w > x1 && c.x < x2 && c.y + h > y1 && c.y < y2;
            })
            .map((c) => c.id);
          // FSM/TM transition arrows: selected when both endpoint states are
          // inside the rectangle (covers self-loops too, where from === to),
          // or when the rectangle captures the arrow's label.
          const inRect = (p: { x: number; y: number }) =>
            p.x > x1 && p.x < x2 && p.y > y1 && p.y < y2;
          const transitionIds = state.wires
            .filter((w) => {
              const wd = wireDataRef.current.get(w.id);
              if (!wd?.isFsmTransition) return false;
              if (inRect(wd.from) && inRect(wd.to)) return true;
              return wd.labelPos != null && inRect(wd.labelPos);
            })
            .map((w) => w.id);
          const captured = [...compIds, ...transitionIds];
          // Additive: the selection held at pointer-down (never cleared) plus
          // what the rectangle caught.
          state.setSelectedIds(
            drag.additive ? [...new Set([...state.selectedIds, ...captured])] : captured
          );
        }
        pendingOverlay.current.boxSelect = null;
        requestOverlayUpdate();
        return;
      }

      if (drag.type === 'drawbox') {
        const preview = drawBoxPreview;
        pendingOverlay.current.drawBoxPreview = null;
        setDrawBoxPreview(null);
        requestOverlayUpdate();

        if (preview && preview.w > 20 && preview.h > 20) {
          const newBox: BoxDefinition = {
            // Minted like every id (task 034): bound to this assignment.
            id: mintId(selectPasteScope(useStore.getState())),
            name: '',
            x: preview.x,
            y: preview.y,
            width: preview.w,
            height: preview.h,
            componentIds: [],
            inputPortIds: [],
            outputPortIds: [],
          };
          state.addBox(newBox);
          state.setSelectedTool(null);
          if (useStore.getState().boxes.some((b) => b.id === newBox.id)) {
            state.setDraftBox(newBox);
            state.setBoxDrawingPhase('adjusting');
          }
        }
        return;
      }

      if (drag.type === 'move') {
        if (drag.hasMoved && drag.moveOffsets) {
          const wasAligned = state.snapToAlign && alignGuides.length > 0;
          if (!wasAligned) {
            const ids = Array.from(drag.moveOffsets.keys());
            state.snapComponentsToGrid(ids);
          }
        }

        // Input toggle is handled on pointer-down, not here
      }
    };
  });

  // ─── Unified pointer down ─────────────────────────────────────
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // ── Modifier map ─────────────────────────────────────────────
      // Every pointer-down gesture on the canvas, in the order the branches
      // below test it. A new gesture is written here first; the branches
      // point back here rather than re-explaining.
      //   a pending (armed) wire         → this click completes it (or cancels)
      //   middle button / alt+left       → pan (wins over everything below)
      //   a wire's middle segment        → plain: drag the segment;
      //                                    shift or cmd/ctrl: the wire click below
      //   box resize handle / box edge   → resize / move the box, any modifier
      //   box name                       → nothing (the dblclick renames)
      //   a port or a component body, through modifierClick (the port circles
      //   cover most of a small part — NOT, MEM, IN/OUT, a gate's edges, a
      //   state's rim — so both mean the same; the body first lets the INPUT
      //   toggle tab flip its value under any modifier):
      //     shift, STATE → STATE (FSM/TM)    → connect the one selected state to it
      //     shift, any non-STATE part        → rotate it 90° (rotateComponent: the
      //                                        Rotate button's lock, undo, re-route)
      //     shift, a STATE, nothing to connect → legacy: the body toggles it in
      //                                        the selection, the rim starts a wire
      //     cmd/ctrl                         → toggle it in/out of the selection
      //   shift or cmd/ctrl+wire         → toggle it in/out of the selection
      //   detail ≥ 3 on a component, no modifier → select everything on the canvas
      //   plain port / wire / component  → a port arms a wire; select (drag moves)
      //   background, a palette tool armed → draw the box / place the part, any
      //                                    modifier (the tool stays armed)
      //   background, shift or cmd/ctrl  → additive box-select (a drag adds the
      //                                    rectangle; a click keeps the selection)
      //   background, plain              → clear the selection, box-select
      // A ctrl+left press that ran a toggle or an additive box-select is also
      // the Mac context-menu click: swallowMacMenu has onContextMenu swallow
      // that one menu (menuSuppressRef). Rapid shift-clicks count up e.detail
      // too, so every modifier is tested BEFORE the triple-click.
      menuSuppressRef.current = false; // before the early return: only this press may arm it
      if (e.button !== 0 && e.button !== 1) return;

      // If an input/textarea is currently focused (e.g. editing a box name or
      // tab name), blur it first so the edit commits before we do anything else.
      // This is needed because preventDefault() below would suppress the
      // automatic blur that browsers normally do on pointerdown.
      // Exception: a click on the other half of an open FSM transition-label
      // editor should switch which side is active, not blur-and-close — that
      // half's own click handler manages focus/activeField itself.
      const activeEl = document.activeElement;
      const withinOpenFsmEditor = (e.target as Element).closest?.('[data-fsm-transition-editor]');
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') &&
        activeEl !== e.target &&
        !withinOpenFsmEditor
      ) {
        (activeEl as HTMLElement).blur();
      }

      const state = useStore.getState();
      const canvasPos = screenToCanvas(e.clientX, e.clientY);
      const hit = findTarget(e);
      const mod = e.metaKey || e.ctrlKey; // cmd on a Mac, ctrl elsewhere

      // Called where a cmd/ctrl gesture actually ran (modifier map): on a Mac
      // a ctrl+left press also raises the context menu, which onContextMenu
      // then swallows. Pointer-up disarms it, whatever the platform.
      const swallowMacMenu = () => {
        if (!e.ctrlKey) return;
        menuSuppressRef.current = true;
        window.addEventListener('pointerup', () => { menuSuppressRef.current = false; }, { once: true, capture: true });
      };

      // FSM/TM: with a single state s1 selected, shift-clicking another state
      // s2 creates the transition s1 → s2 directly (no drag needed). Returns
      // true when it handled the click.
      const tryShiftConnect = (targetCompId: string): boolean => {
        if (!e.shiftKey) return false;
        if (selectEffectiveMode(state) !== 'FSM' && selectEffectiveMode(state) !== 'TM') return false;
        const target = state.components.find((c) => c.id === targetCompId);
        if (!target || target.type !== 'STATE') return false;
        if (state.selectedIds.length !== 1) return false;
        const source = state.components.find((c) => c.id === state.selectedIds[0]);
        if (!source || source.type !== 'STATE' || source.id === targetCompId) return false;
        state.addWire(source.id, 'right', targetCompId, 'left');
        // Move the selection along so connections can be chained s1→s2→s3…
        state.setSelectedIds([targetCompId]);
        return true;
      };

      // shift / cmd-ctrl on a component (modifier map). Called from the port
      // branch AND the component branch: the port hit circles cover most of a
      // small part (NOT, MEM, IN/OUT, a gate's edges, a state's rim), so a
      // modifier-click landing on a "port" must mean the same. True when it
      // handled the click; false leaves a STATE's legacy shift-click to its
      // branch. Rotation is the clicked component only — the Rotate button
      // rotates the selection.
      const modifierClick = (comp: CircuitComponent): boolean => {
        if (e.shiftKey) {
          if (tryShiftConnect(comp.id)) return true;
          if (comp.type === 'STATE') return false;
          if (!state.selectedIds.includes(comp.id)) state.setSelectedIds([comp.id]);
          state.rotateComponent(comp.id);
          return true;
        }
        if (mod) {
          state.toggleSelected(comp.id);
          swallowMacMenu();
          return true;
        }
        return false;
      };

      // A pending (armed) wire completes on the next click: connect to the
      // target under the cursor, or cancel if the click lands on nothing.
      if (pendingWireRef.current && e.button === 0 && !e.altKey) {
        const pending = pendingWireRef.current;
        clearPendingWire();
        if (hit.type === 'port' || hit.type === 'component') {
          const target = findWireTarget(state.components, canvasPos, pending.sourceCompId);
          if (target) {
            e.preventDefault();
            e.stopPropagation();
            state.addWire(pending.sourceCompId, pending.sourcePortId, target.comp.id, target.port.id);
            return;
          }
        }
        // No valid target — the pending wire is cancelled; the click behaves normally.
      }

      // Middle-click or alt+left-click → pan (modifier map)
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        dragRef.current = {
          type: 'pan',
          anchorScreenX: e.clientX,
          anchorScreenY: e.clientY,
          anchorCanvasX: 0,
          anchorCanvasY: 0,
          currentCanvasX: 0,
          currentCanvasY: 0,
          origPanX: state.panX,
          origPanY: state.panY,
          pointerId: e.pointerId,
        };
        setIsPanning(true);
        svgRef.current?.setPointerCapture(e.pointerId);
        window.addEventListener('pointermove', stableOnMove);
        window.addEventListener('pointerup', stableOnUp);
        e.preventDefault();
        return;
      }

      // ─── Wire segment drag ─────────────────────────────────
      // A modifier-click on a segment is the wire's click (modifier map): the
      // segment's hit line lies over the middle of the wire.
      if (hit.type === 'wiresegment' && !e.shiftKey && !mod) {
        e.preventDefault();
        e.stopPropagation();
        const wire = state.wires.find((w) => w.id === hit.wireId);
        if (!wire) return;

        const wd = wireDataRef.current.get(wire.id);
        if (!wd) return;
        const segIdx = hit.segmentIndex;
        const axis = hit.segmentAxis;
        // Use BASE path (before manual segments) for the original value
        // so the offset is always relative to the computed position
        const baseP = wd.basePoints[segIdx];
        if (!baseP) return;
        const origValue = axis === 'x' ? baseP.x : baseP.y;

        state.pushHistory();
        dragRef.current = {
          type: 'wiresegment',
          anchorScreenX: e.clientX,
          anchorScreenY: e.clientY,
          anchorCanvasX: canvasPos.x,
          anchorCanvasY: canvasPos.y,
          currentCanvasX: canvasPos.x,
          currentCanvasY: canvasPos.y,
          wireId: hit.wireId,
          segmentIndex: segIdx,
          segmentAxis: axis,
          segmentOrigValue: origValue,
          pointerId: e.pointerId,
        };
        svgRef.current?.setPointerCapture(e.pointerId);
        window.addEventListener('pointermove', stableOnMove);
        window.addEventListener('pointerup', stableOnUp);
        return;
      }

      // ─── Box resize ────────────────────────────────────────
      if (hit.type === 'boxresize') {
        e.preventDefault();
        e.stopPropagation();
        const box = state.boxes.find((b) => b.id === hit.boxId);
        if (!box) return;
        dragRef.current = {
          type: 'resizebox',
          anchorScreenX: e.clientX,
          anchorScreenY: e.clientY,
          anchorCanvasX: canvasPos.x,
          anchorCanvasY: canvasPos.y,
          currentCanvasX: canvasPos.x,
          currentCanvasY: canvasPos.y,
          boxId: hit.boxId,
          boxCorner: hit.corner,
          origBoxX: box.x,
          origBoxY: box.y,
          origBoxW: box.width,
          origBoxH: box.height,
          pointerId: e.pointerId,
        };
        svgRef.current?.setPointerCapture(e.pointerId);
        window.addEventListener('pointermove', stableOnMove);
        window.addEventListener('pointerup', stableOnUp);
        return;
      }

      // ─── Box name click → do nothing on pointerdown (dblclick handler on SVG handles rename) ──
      if (hit.type === 'boxname') {
        // Don't preventDefault or stopPropagation — let the event flow through
        // so that the native dblclick event can fire on the text element.
        return;
      }

      // ─── Box edge drag (move box + contents) ──────────────
      if (hit.type === 'boxedge') {
        e.preventDefault();
        e.stopPropagation();
        const box = state.boxes.find((b) => b.id === hit.boxId);
        if (!box) return;

        // Compute offsets for all components inside the box
        const compOffsets = new Map<string, { dx: number; dy: number }>();
        for (const compId of box.componentIds) {
          const c = state.components.find((comp) => comp.id === compId);
          if (c) {
            compOffsets.set(compId, {
              dx: canvasPos.x - c.x,
              dy: canvasPos.y - c.y,
            });
          }
        }

        state.pushHistory();
        dragRef.current = {
          type: 'movebox',
          anchorScreenX: e.clientX,
          anchorScreenY: e.clientY,
          anchorCanvasX: canvasPos.x,
          anchorCanvasY: canvasPos.y,
          currentCanvasX: canvasPos.x,
          currentCanvasY: canvasPos.y,
          moveBoxId: hit.boxId,
          moveBoxOffsetX: canvasPos.x - box.x,
          moveBoxOffsetY: canvasPos.y - box.y,
          moveBoxCompOffsets: compOffsets,
          hasMoved: false,
          pointerId: e.pointerId,
        };
        svgRef.current?.setPointerCapture(e.pointerId);
        window.addEventListener('pointermove', stableOnMove);
        window.addEventListener('pointerup', stableOnUp);
        return;
      }

      // ─── Port interaction ─────────────────────────────────────
      if (hit.type === 'port') {
        e.preventDefault();
        e.stopPropagation();
        const comp = state.components.find((c) => c.id === hit.compId);
        if (!comp) return;

        // shift / cmd-ctrl mean the same on a port as on the body (modifier map)
        if (modifierClick(comp)) return;

        // Always select the component when clicking its port, so Delete still works
        state.setSelectedIds([hit.compId]);

        // For MEM blocks, source port depends on direction; for STATE, either port initiates a wire (always from right); for all others, right-side ports are sources
      const isSourcePort = comp.type === 'MEM'
        ? isMemSourcePort(comp, hit.portId)
        : comp.type === 'STATE'
        ? true
        : hit.portSide === 'right';
      // For STATE: always use the right port as the wire source, regardless of which port was clicked
      const sourcePortId = (comp.type === 'STATE') ? 'right' : hit.portId;
      if (isSourcePort) {
          const pos = getPortPosition(comp, sourcePortId);
          dragRef.current = {
            type: 'wire',
            anchorScreenX: e.clientX,
            anchorScreenY: e.clientY,
            anchorCanvasX: pos.x,
            anchorCanvasY: pos.y,
            currentCanvasX: pos.x,
            currentCanvasY: pos.y,
            sourceCompId: hit.compId,
            sourcePortId: sourcePortId,
            wireFromX: pos.x,
            wireFromY: pos.y,
            pointerId: e.pointerId,
          };
          pendingOverlay.current.wirePreview = {
            fromX: pos.x, fromY: pos.y, toX: pos.x, toY: pos.y,
          };
          requestOverlayUpdate();
        } else {
          const existingWire = state.wires.find(
            (w) => w.targetComponentId === hit.compId && w.targetPortId === hit.portId
          );
          if (existingWire) {
            const sourceComp = state.components.find(
              (c) => c.id === existingWire.sourceComponentId
            );
            if (sourceComp) {
              const srcPos = getPortPosition(sourceComp, existingWire.sourcePortId);
              const curPos = getPortPosition(comp, hit.portId);
              state.pushHistory();
              useStore.getState().removeWire(existingWire.id);

              dragRef.current = {
                type: 'wire',
                anchorScreenX: e.clientX,
                anchorScreenY: e.clientY,
                anchorCanvasX: srcPos.x,
                anchorCanvasY: srcPos.y,
                currentCanvasX: curPos.x,
                currentCanvasY: curPos.y,
                sourceCompId: existingWire.sourceComponentId,
                sourcePortId: existingWire.sourcePortId,
                wireFromX: srcPos.x,
                wireFromY: srcPos.y,
                isRewire: true,
                pointerId: e.pointerId,
              };
              pendingOverlay.current.wirePreview = {
                fromX: srcPos.x, fromY: srcPos.y, toX: curPos.x, toY: curPos.y,
              };
              requestOverlayUpdate();
            }
          }
        }

        svgRef.current?.setPointerCapture(e.pointerId);
        window.addEventListener('pointermove', stableOnMove);
        window.addEventListener('pointerup', stableOnUp);
        return;
      }

      // ─── Wire click (a segment's too, under a modifier) ─────────
      if (hit.type === 'wire' || hit.type === 'wiresegment') {
        e.preventDefault();
        e.stopPropagation();

        if (state.selectedTool) {
          state.setSelectedTool(null);
        }
        if (e.shiftKey || mod) { // modifier map
          state.toggleSelected(hit.wireId);
          if (mod) swallowMacMenu();
        } else {
          state.setSelectedIds([hit.wireId]);
        }
        return;
      }

      // ─── Component click ───────────────────────────────────
      if (hit.type === 'component') {
        if (state.selectedTool) {
          state.setSelectedTool(null);
        }
        e.preventDefault();
        e.stopPropagation();
        const comp = state.components.find((c) => c.id === hit.compId);
        if (!comp) return;

        // Toggle input value immediately without selecting or starting a drag
        const targetEl = e.target as Element;
        if (targetEl?.getAttribute?.('data-input-toggle') != null) {
          if (comp.type === 'INPUT') {
            // Cycle: undefined → 0 → 1 → 0 → 1...
            const newVal = comp.value == null ? 0 : comp.value === 0 ? 1 : 0;
            state.setInputValue(comp.id, newVal);
            // Auto-select the matching row in the I/O table
            setTimeout(() => {
              const s = useStore.getState();
              const inputs = s.components
                .filter((c) => c.type === 'INPUT')
                .sort((a, b) => parseInt(a.label.replace('IN', '')) - parseInt(b.label.replace('IN', '')));
              const mems = memorySlots(s.components); // boxed MEMs included
              const inBits = inputs.map((c) => c.value ?? 0);
              const memBits = mems.length > 0 ? mems.map((m) => m.value) : undefined;
              s.localStepSelect(inBits, memBits);
            }, 0);
          }
          // Still select the component so Backspace can delete it
          state.setSelectedIds([comp.id]);
          return;
        }

        // Modifiers before the triple-click (modifier map): connect / rotate /
        // toggle, then a STATE's legacy shift-click toggles it.
        if (modifierClick(comp)) return;
        if (e.shiftKey) {
          state.toggleSelected(comp.id);
          return;
        }

        // Triple-click a component → select everything on the canvas
        if (e.detail >= 3) {
          state.setSelectedIds(state.components.map((c) => c.id));
          return;
        }

        let idsToMove: string[];
        if (state.selectedIds.includes(hit.compId)) {
          idsToMove = state.selectedIds;
        } else {
          state.setSelectedIds([hit.compId]);
          idsToMove = [hit.compId];
        }

        const moveOffsets = new Map<string, { dx: number; dy: number }>();
        const freshState = useStore.getState();
        for (const id of idsToMove) {
          const c = freshState.components.find((comp) => comp.id === id);
          if (c) {
            moveOffsets.set(id, {
              dx: canvasPos.x - c.x,
              dy: canvasPos.y - c.y,
            });
          }
        }

        state.pushHistory();

        dragRef.current = {
          type: 'move',
          anchorScreenX: e.clientX,
          anchorScreenY: e.clientY,
          anchorCanvasX: canvasPos.x,
          anchorCanvasY: canvasPos.y,
          currentCanvasX: canvasPos.x,
          currentCanvasY: canvasPos.y,
          componentId: hit.compId,
          moveOffsets,
          hasMoved: false,
          pointerId: e.pointerId,
          clickedInputToggle: false,
        };

        svgRef.current?.setPointerCapture(e.pointerId);
        window.addEventListener('pointermove', stableOnMove);
        window.addEventListener('pointerup', stableOnUp);
        return;
      }

      // ─── Canvas background ──────────────────────────────────────
      e.preventDefault();
      // A click on empty canvas closes the palette's Boxes pop-out.
      if (state.boxesPopoutOpen) state.setBoxesPopoutOpen(false);

      // Click-to-place: NEW_BOX tool — start drawing
      if (state.selectedTool === 'NEW_BOX') {
        dragRef.current = {
          type: 'drawbox',
          anchorScreenX: e.clientX,
          anchorScreenY: e.clientY,
          anchorCanvasX: canvasPos.x,
          anchorCanvasY: canvasPos.y,
          currentCanvasX: canvasPos.x,
          currentCanvasY: canvasPos.y,
          drawBoxStartX: canvasPos.x,
          drawBoxStartY: canvasPos.y,
          pointerId: e.pointerId,
        };
        svgRef.current?.setPointerCapture(e.pointerId);
        window.addEventListener('pointermove', stableOnMove);
        window.addEventListener('pointerup', stableOnUp);
        return;
      }

      // Click-to-place: a part or a box, centred on the click — the store's
      // one placement path (placeTool), the palette's drop uses it too. Shift
      // keeps the tool armed for another copy; a plain click places one and
      // disarms. A click that lands on an existing object disarms it instead
      // (the branches above).
      if (state.selectedTool) {
        state.placeTool(state.selectedTool, canvasPos.x, canvasPos.y);
        if (!e.shiftKey) state.setSelectedTool(null);
        return;
      }

      // Box select — additive under shift or cmd/ctrl (modifier map)
      const additive = e.shiftKey || mod;
      if (!additive) {
        state.clearSelection();
      } else if (mod) {
        swallowMacMenu(); // or the Mac menu would take the drag
      }
      dragRef.current = {
        type: 'boxselect',
        anchorScreenX: e.clientX,
        anchorScreenY: e.clientY,
        anchorCanvasX: canvasPos.x,
        anchorCanvasY: canvasPos.y,
        currentCanvasX: canvasPos.x,
        currentCanvasY: canvasPos.y,
        additive,
        pointerId: e.pointerId,
      };
      pendingOverlay.current.boxSelect = null;

      svgRef.current?.setPointerCapture(e.pointerId);
      window.addEventListener('pointermove', stableOnMove);
      window.addEventListener('pointerup', stableOnUp);
    },
    [screenToCanvas, requestOverlayUpdate, stableOnMove, stableOnUp, clearPendingWire]
  );

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('pointermove', stableOnMove);
      window.removeEventListener('pointerup', stableOnUp);
      window.removeEventListener('pointermove', pendingWireMove);
    };
  }, [stableOnMove, stableOnUp, pendingWireMove]);

  // Escape cancels a pending (armed) wire
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearPendingWire();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [clearPendingWire]);

  // ─── Navigation arrow ─────────────────────────────────────────
  const navArrow = useMemo(() => {
    if (components.length === 0) return null;

    const viewLeft = -panX / zoom;
    const viewTop = -panY / zoom;
    const viewRight = viewLeft + containerSize.width / zoom;
    const viewBottom = viewTop + containerSize.height / zoom;

    const anyVisible = components.some((c) => {
      const { w, h } = getCompDimensions(c);
      return (
        c.x + w > viewLeft &&
        c.x < viewRight &&
        c.y + h > viewTop &&
        c.y < viewBottom
      );
    });

    if (anyVisible) return null;

    const cx = components.reduce((s, c) => s + c.x + getCompDimensions(c).w / 2, 0) / components.length;
    const cy = components.reduce((s, c) => s + c.y + getCompDimensions(c).h / 2, 0) / components.length;

    const viewCX = (viewLeft + viewRight) / 2;
    const viewCY = (viewTop + viewBottom) / 2;

    const dx = cx - viewCX;
    const dy = cy - viewCY;

    let direction: 'left' | 'right' | 'up' | 'down';
    if (Math.abs(dx) > Math.abs(dy)) {
      direction = dx > 0 ? 'right' : 'left';
    } else {
      direction = dy > 0 ? 'down' : 'up';
    }

    return direction;
  }, [components, panX, panY, zoom, containerSize]);

  const handleNavigate = useCallback(() => {
    if (components.length === 0) return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    const cx = components.reduce((s, c) => s + c.x + getCompDimensions(c).w / 2, 0) / components.length;
    const cy = components.reduce((s, c) => s + c.y + getCompDimensions(c).h / 2, 0) / components.length;

    const state = useStore.getState();
    state.setPan(
      -cx * state.zoom + rect.width / 2,
      -cy * state.zoom + rect.height / 2
    );
  }, [components]);

  // ─── Grid ──────────────────────────────────────────────────────
  // A dot on every grid point (GRID_SIZE — where parts snap), drawn as the
  // container's background so it runs to every edge and follows pan and
  // zoom: one dot per cell, the cell GRID_SIZE × zoom, shifted half a cell
  // so the dots sit on the grid points, not between them.
  const gridStyle = useMemo<React.CSSProperties | undefined>(() => {
    if (!showGrid) return undefined;
    const cell = GRID_SIZE * zoom;
    return {
      backgroundImage: 'radial-gradient(circle, var(--mm-canvas-dot) 1px, transparent 1.2px)',
      backgroundSize: `${cell}px ${cell}px`,
      backgroundPosition: `${panX - cell / 2}px ${panY - cell / 2}px`,
    };
  }, [showGrid, zoom, panX, panY]);

  // ─── Port colours ──────────────────────────────────────────────
  // Each port dot wears the colour of the signal on its wire.
  const portValues = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of wires) {
      if (w.value === -1) continue;
      m.set(`${w.sourceComponentId}:${w.sourcePortId}`, w.value);
      m.set(`${w.targetComponentId}:${w.targetPortId}`, w.value);
    }
    return m;
  }, [wires]);

  // ─── Fit ───────────────────────────────────────────────────────
  // Centre the circuit in the part of the canvas the palette leaves free,
  // never below 80% (canvasView.ts fitView). A view change only: zoom and
  // pan, never the circuit, its runs or its history (law 6).
  const fitCanvas = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const pal = el.querySelector<HTMLElement>('.pal');
    const pr = pal?.getBoundingClientRect();
    const palette = pal && pr && pr.width > 0
      ? { x: pr.left - rect.left, y: pr.top - rect.top, w: pr.width, h: pr.height, horiz: pal.classList.contains('pal--horiz') }
      : null;
    const state = useStore.getState();
    const view = fitView(circuitBounds(state.components, state.boxes), freeArea({ w: rect.width, h: rect.height }, palette));
    state.setZoom(view.zoom);
    state.setPan(view.panX, view.panY);
  }, []);

  // Every canvas swap — a question or tab change, an opened assignment, a
  // submission put on show — fits the new canvas: the canvas's response to
  // the store's swap counter (resetAllSimState bumps it), never a separate
  // reset of its own. Two frames: the palette measures and settles first.
  const canvasSwapSeq = useStore((s) => s.canvasSwapSeq);
  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => fitCanvas());
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [canvasSwapSeq, fitCanvas]);

  /** − and +: a zoom step about the canvas's centre. */
  const zoomStep = useCallback((factor: number) => {
    const el = containerRef.current;
    const state = useStore.getState();
    const w = el?.clientWidth ?? 0;
    const h = el?.clientHeight ?? 0;
    const view = zoomAbout(state, factor, w / 2, h / 2);
    state.setZoom(view.zoom);
    state.setPan(view.panX, view.panY);
  }, []);

  // ─── Wire data ref (for event handlers that need current wire paths) ──
  const wireDataRef = useRef<Map<string, { pathD: string; points: { x: number; y: number }[]; basePoints: { x: number; y: number }[]; crossings: { x: number; y: number }[]; from: { x: number; y: number }; to: { x: number; y: number }; isFsmTransition?: boolean; labelPos?: { x: number; y: number }; usedFallback?: boolean; violation?: string }>>(new Map());

  // ─── Previous paths ref for continuity bias (§7.2) ──
  const previousPathsRef = useRef<Map<string, { x: number; y: number }[]>>(new Map());

  // ─── FSM control point snap guide callback ──────────────────────
  const handleFsmSnapGuides = useCallback((guides: AlignGuide[]) => {
    pendingOverlay.current.alignGuides = guides;
    requestOverlayUpdate();
  }, [requestOverlayUpdate]);

  // ─── Compute all wire paths (A* grid-based router) ──────────────
  const wireData = useMemo(() => {
    const data = new Map<string, { pathD: string; points: { x: number; y: number }[]; basePoints: { x: number; y: number }[]; crossings: { x: number; y: number }[]; from: { x: number; y: number }; to: { x: number; y: number }; isFsmTransition?: boolean; labelPos?: { x: number; y: number }; controlPt?: { x: number; y: number }; usedFallback?: boolean; violation?: string }>();

    // Separate FSM transitions from regular wires
    const fsmWires: Wire[] = [];
    const regularWires: Wire[] = [];
    for (const wire of wires) {
      const sourceComp = components.find((c) => c.id === wire.sourceComponentId);
      const targetComp = components.find((c) => c.id === wire.targetComponentId);
      if (sourceComp?.type === 'STATE' && targetComp?.type === 'STATE') {
        fsmWires.push(wire);
      } else {
        regularWires.push(wire);
      }
    }

    // ── FSM transition curves ──────────────────────────────────────
    // Build per-direction counts: separate A→B from B→A
    const directedCounts = new Map<string, number>();
    const directedIndices = new Map<string, number>();
    // Also track total between each unordered pair (for deciding if straight)
    const pairTotals = new Map<string, number>();
    for (const wire of fsmWires) {
      const dirKey = `${wire.sourceComponentId}|${wire.targetComponentId}`;
      directedCounts.set(dirKey, (directedCounts.get(dirKey) || 0) + 1);
      const pairKey = [wire.sourceComponentId, wire.targetComponentId].sort().join('|');
      pairTotals.set(pairKey, (pairTotals.get(pairKey) || 0) + 1);
    }
    // Arrowhead length for endpoint pullback (keeps stroke from peeking past arrow tip)
    const ARROW_LEN = 2;
    for (const wire of fsmWires) {
      const dirKey = `${wire.sourceComponentId}|${wire.targetComponentId}`;
      const dirIdx = directedIndices.get(dirKey) || 0;
      directedIndices.set(dirKey, dirIdx + 1);

      const sourceComp = components.find((c) => c.id === wire.sourceComponentId)!;
      const targetComp = components.find((c) => c.id === wire.targetComponentId)!;
      const sCx = sourceComp.x + STATE_RADIUS;
      const sCy = sourceComp.y + STATE_RADIUS;
      const tCx = targetComp.x + STATE_RADIUS;
      const tCy = targetComp.y + STATE_RADIUS;

      const isSelfLoop = wire.sourceComponentId === wire.targetComponentId;
      const pairKey = [wire.sourceComponentId, wire.targetComponentId].sort().join('|');
      const totalBetweenPair = pairTotals.get(pairKey) || 1;

      let pathD: string;
      let labelPos: { x: number; y: number };
      let curvePointX = 0, curvePointY = 0;

      if (isSelfLoop) {
        // Self-loop: draw a loop arc that fans out around the state.
        // Successive self-loops on the same state (dirIdx > 0) are rotated
        // around the state so their arcs and anchor points don't coincide
        // with earlier ones (which would otherwise make the earlier ones
        // unclickable, since they'd be fully shadowed).
        const loopR = 22 + dirIdx * 4;
        const rotationStep = (Math.PI * 50) / 180;
        const dirAngle = -Math.PI / 2 + dirIdx * rotationStep;
        const dX = Math.cos(dirAngle);
        const dY = Math.sin(dirAngle);
        const pX = -dY;
        const pY = dX;
        const bulgeX = sCx + dX * (STATE_RADIUS + loopR * 2);
        const bulgeY = sCy + dY * (STATE_RADIUS + loopR * 2);
        const cpX1 = bulgeX - pX * (loopR + 10);
        const cpY1 = bulgeY - pY * (loopR + 10);
        const cpX2 = bulgeX + pX * (loopR + 10);
        const cpY2 = bulgeY + pY * (loopR + 10);
        // Start and end anchors spread symmetrically around dirAngle
        const startAngle = dirAngle - Math.PI / 4;
        const endAngle = dirAngle + Math.PI / 4;
        const startX = sCx + STATE_RADIUS * Math.cos(startAngle);
        const startY = sCy + STATE_RADIUS * Math.sin(startAngle);
        const endX0 = sCx + STATE_RADIUS * Math.cos(endAngle);
        const endY0 = sCy + STATE_RADIUS * Math.sin(endAngle);
        // Pull end back for arrowhead
        const eAngleTan = Math.atan2(endY0 - cpY2, endX0 - cpX2);
        const eX = endX0 - ARROW_LEN * Math.cos(eAngleTan);
        const eY = endY0 - ARROW_LEN * Math.sin(eAngleTan);
        pathD = `M${startX},${startY} C${cpX1},${cpY1} ${cpX2},${cpY2} ${eX},${eY}`;
        labelPos = { x: bulgeX - dX * 6, y: bulgeY - dY * 6 };
      } else {
        // Curve between two different states
        const centerAngle = Math.atan2(tCy - sCy, tCx - sCx);
        const dist = Math.hypot(tCx - sCx, tCy - sCy);
        const perpX = -(tCy - sCy) / dist;
        const perpY = (tCx - sCx) / dist;

        // Determine curve offset.
        //
        // Opposite-direction sibling (some B→A wire alongside this A→B one):
        // each arc bows to the LEFT of its own direction of travel. `perp` is
        // the travel direction rotated 90° (travel-right on screen), and it
        // flips with direction — so a negative own-frame offset lands A→B and
        // B→A on opposite world sides deterministically, matching the
        // hand-placed hw4-p11 convention (left→right arc on top, right→left
        // arc underneath). The bow scales with state spacing (~30% of the
        // center distance, clamped) so both arcs and their labels stay
        // clearly distinct at typical 200–400px spacings.
        const reverseKey = `${wire.targetComponentId}|${wire.sourceComponentId}`;
        const hasOppositeSibling = (directedCounts.get(reverseKey) || 0) > 0;

        let offset: number;
        if (hasOppositeSibling) {
          const bowMag = Math.min(150, Math.max(50, dist * 0.3));
          offset = -(bowMag + dirIdx * 25);
        } else if (totalBetweenPair === 1) {
          // Only one transition between this pair → straight line
          offset = 0;
        } else {
          // Multiple in the same direction (no reverse sibling): stack them
          // to one side, chosen by lexical id order for determinism.
          const side = wire.sourceComponentId < wire.targetComponentId ? 1 : -1;
          offset = side * (30 + dirIdx * 25);
        }

        // ── State avoidance: push arc away from intermediate states ──
        const clearance = STATE_RADIUS + 12; // circle radius + margin
        for (const other of components) {
          if (other.id === wire.sourceComponentId || other.id === wire.targetComponentId) continue;
          if (other.type !== 'STATE') continue;
          const oCx = other.x + STATE_RADIUS;
          const oCy = other.y + STATE_RADIUS;
          // Project other-state center onto the source→target line
          const dx = tCx - sCx;
          const dy = tCy - sCy;
          const t = ((oCx - sCx) * dx + (oCy - sCy) * dy) / (dist * dist);
          if (t <= 0.05 || t >= 0.95) continue; // only care about states between endpoints
          // Perpendicular distance from line
          const projX = sCx + t * dx;
          const projY = sCy + t * dy;
          const perpDist = (oCx - projX) * perpX + (oCy - projY) * perpY;
          const absPerpDist = Math.abs(perpDist);
          if (absPerpDist < clearance) {
            // State is too close to the line — push the arc to the far side
            const pushSide = perpDist >= 0 ? -1 : 1; // push away from the obstacle
            const needed = (clearance - absPerpDist) + clearance;
            const pushOffset = pushSide * needed;
            if (Math.abs(pushOffset) > Math.abs(offset)) {
              offset = pushOffset;
            }
          }
        }

        // Use manual control point if set, otherwise compute automatically
        if (wire.fsmControlPt) {
          // Recompute effective offset for start/end angle adjustment
          const dotPerp = (wire.fsmControlPt.x - (sCx + tCx) / 2) * perpX + (wire.fsmControlPt.y - (sCy + tCy) / 2) * perpY;
          offset = dotPerp;
        }

        // Adjust start/end angles to account for curve offset
        const offsetAngle = dist > 0 ? Math.atan2(offset, dist / 2) : 0;
        const startA = centerAngle + offsetAngle * 0.3;
        const endA = centerAngle + Math.PI - offsetAngle * 0.3;

        const startX = sCx + STATE_RADIUS * Math.cos(startA);
        const startY = sCy + STATE_RADIUS * Math.sin(startA);
        const rawEndX = tCx + STATE_RADIUS * Math.cos(endA);
        const rawEndY = tCy + STATE_RADIUS * Math.sin(endA);

        // Control point
        const midX = wire.fsmControlPt
          ? wire.fsmControlPt.x
          : (startX + rawEndX) / 2 + perpX * offset;
        const midY = wire.fsmControlPt
          ? wire.fsmControlPt.y
          : (startY + rawEndY) / 2 + perpY * offset;

        // Pull endpoint back along approach tangent for clean arrowhead
        const isStraight = Math.abs(offset) < 1;
        const tanAngle = isStraight
          ? centerAngle
          : Math.atan2(rawEndY - midY, rawEndX - midX);
        const endX = rawEndX - ARROW_LEN * Math.cos(tanAngle);
        const endY = rawEndY - ARROW_LEN * Math.sin(tanAngle);

        if (isStraight) {
          pathD = `M${startX},${startY} L${endX},${endY}`;
        } else {
          pathD = `M${startX},${startY} Q${midX},${midY} ${endX},${endY}`;
        }
        // Control point position on the curve (for the draggable dot)
        // For Q bezier: point at t=0.5 is (S + 2*C + E) / 4
        curvePointX = isStraight ? (startX + endX) / 2 : (startX + 2 * midX + rawEndX) / 4;
        curvePointY = isStraight ? (startY + endY) / 2 : (startY + 2 * midY + rawEndY) / 4;

        // Label offset: above or to the side of the wire
        const curveTangentX = isStraight ? (endX - startX) : (rawEndX - startX);
        const curveTangentY = isStraight ? (endY - startY) : (rawEndY - startY);
        const tLen = Math.hypot(curveTangentX, curveTangentY) || 1;
        const labelOffsetDist = 14;
        // Perpendicular to the tangent at the midpoint, away from center of curvature
        const labelNx = -curveTangentY / tLen;
        const labelNy = curveTangentX / tLen;
        const labelSide = offset >= 0 ? 1 : -1;
        labelPos = {
          x: curvePointX + labelNx * labelOffsetDist * labelSide,
          y: curvePointY + labelNy * labelOffsetDist * labelSide,
        };
      }

      const from = { x: sCx, y: sCy };
      const to = { x: tCx, y: tCy };
      data.set(wire.id, {
        pathD,
        points: [from, to],
        basePoints: [from, to],
        crossings: [],
        from,
        to,
        isFsmTransition: true,
        labelPos,
        controlPt: isSelfLoop ? undefined : { x: curvePointX, y: curvePointY },
      });
    }

    // ── Regular wires (A* routing) ─────────────────────────────────
    const routeInputs: WireRouteInput[] = [];
    for (const wire of regularWires) {
      const sourceComp = components.find((c) => c.id === wire.sourceComponentId);
      const targetComp = components.find((c) => c.id === wire.targetComponentId);
      if (!sourceComp || !targetComp) continue;

      const from = getPortPosition(sourceComp, wire.sourcePortId);
      const to = getPortPosition(targetComp, wire.targetPortId);
      const sourcePort = sourceComp.ports.find((p) => p.id === wire.sourcePortId);
      const targetPort = targetComp.ports.find((p) => p.id === wire.targetPortId);

      routeInputs.push({
        wireId: wire.id,
        sourceComp,
        targetComp,
        sourcePortId: wire.sourcePortId,
        targetPortId: wire.targetPortId,
        sourcePortSide: sourcePort?.side ?? 'right',
        targetPortSide: targetPort?.side ?? 'left',
        sourcePos: from,
        targetPos: to,
        sourcePortKey: `${wire.sourceComponentId}:${wire.sourcePortId}`,
      });
    }

    // Route regular wires using A* pathfinder with continuity bias
    const results = routeAllWires(routeInputs, components, previousPathsRef.current);

    // Build next previousPaths for continuity bias on next render
    const nextPreviousPaths = new Map<string, { x: number; y: number }[]>();

    for (const result of results) {
      const wire = regularWires.find(w => w.id === result.wireId);
      if (!wire) continue;
      const input = routeInputs.find(r => r.wireId === result.wireId);
      if (!input) continue;

      const basePoints = result.points;
      const points = applyManualSegments(basePoints, wire.manualSegments);
      data.set(wire.id, {
        pathD: pointsToPathD(points),
        points,
        basePoints,
        crossings: result.crossings ?? [],
        from: input.sourcePos,
        to: input.targetPos,
        // Route-quality flags (warn, don't block — spec/wire-routing memo):
        // usedFallback = obstacle-blind L-path; violation = the router's final
        // oracle-predicate sweep still sees an appearance defect.
        usedFallback: result.usedFallback,
        violation: result.violation,
      });
      nextPreviousPaths.set(wire.id, basePoints);
    }

    previousPathsRef.current = nextPreviousPaths;

    // ── Crossing detection + bump path generation ─────────────────
    // Detect perpendicular crossings from the final displayed paths
    // (after routing + manual-segment adjustments) and bake the arc
    // directly into each horizontal wire's pathD so both wires remain
    // visually continuous with no white gaps. The recomputed set REPLACES
    // the router's result.crossings on wireData — displayed geometry is
    // the truth here, and downstream consumers (the split-dot bump-skip)
    // must see the same crossings the bumps were drawn from.
    for (const [wireId, wd] of data) {
      if (wd.isFsmTransition) continue;
      const crossings: { x: number; y: number }[] = [];
      const pts = wd.points;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        if (Math.abs(a.y - b.y) > 0.5) continue;
        const minHx = Math.min(a.x, b.x), maxHx = Math.max(a.x, b.x);
        for (const [otherId, owd] of data) {
          if (otherId === wireId || owd.isFsmTransition) continue;
          const opts = owd.points;
          for (let j = 0; j < opts.length - 1; j++) {
            const c = opts[j], d = opts[j + 1];
            if (Math.abs(c.x - d.x) > 0.5) continue;
            const minVy = Math.min(c.y, d.y), maxVy = Math.max(c.y, d.y);
            if (c.x > minHx + 1 && c.x < maxHx - 1 && a.y > minVy + 1 && a.y < maxVy - 1) {
              crossings.push({ x: c.x, y: a.y });
            }
          }
        }
      }
      wd.crossings = crossings;
      if (crossings.length > 0) {
        wd.pathD = pathDWithBumps(wd.points, crossings);
      }
    }

    wireDataRef.current = data;
    return data;
  }, [wires, components]);

  // ─── Split dots ────────────────────────────────────────────────
  // VISUAL_VOCAB: splitting one output to many inputs draws a dot at the
  // JUNCTION — where the branches actually part ways on the displayed paths
  // (shared trunks get their dot at the divergence elbow, not the source
  // port). findDivergencePoints is pure (wireRouter.ts, corpus-tested in
  // tools/routerCheck.ts); it consumes the CANVAS-side crossing set stored
  // on wireData so dots never land on a rendered bump arc.
  const splitDots = useMemo(() => {
    const displayed: DisplayedWirePath[] = [];
    const canvasCrossings: { x: number; y: number }[] = [];
    for (const w of wires) {
      const wd = wireData.get(w.id);
      if (!wd || wd.isFsmTransition) continue; // FSM transitions don't split
      displayed.push({
        sourcePortKey: `${w.sourceComponentId}:${w.sourcePortId}`,
        points: wd.points,
      });
      canvasCrossings.push(...wd.crossings);
    }
    return findDivergencePoints(displayed, canvasCrossings).map((p) => (
      <circle
        key={`split-${Math.round(p.x)},${Math.round(p.y)}`}
        cx={p.x}
        cy={p.y}
        r={SPLIT_DOT_RADIUS}
        fill={C.ink}
      />
    ));
  }, [wires, wireData, C]);

  // ─── Box highlighting (inputs/outputs crossing boundary) ───────
  const draftBox = boxDrawing.draftBox;
  const highlightedPorts = useMemo(() => {
    if (!draftBox) return new Set<string>();
    const highlighted = new Set<string>();
    const insideIds = new Set(
      components
        .filter((c) => {
          const cx = c.x + 40;
          const cy = c.y + 30;
          return cx >= draftBox.x && cx <= draftBox.x + draftBox.width && cy >= draftBox.y && cy <= draftBox.y + draftBox.height;
        })
        .map((c) => c.id)
    );
    for (const w of wires) {
      const srcIn = insideIds.has(w.sourceComponentId);
      const tgtIn = insideIds.has(w.targetComponentId);
      if (srcIn !== tgtIn) {
        if (srcIn) highlighted.add(`${w.sourceComponentId}:${w.sourcePortId}`);
        else highlighted.add(`${w.targetComponentId}:${w.targetPortId}`);
      }
    }
    return highlighted;
  }, [draftBox, components, wires]);

  // Derive cursor
  let cursor = 'default';
  if (isPanning) cursor = 'grabbing';
  else if (wirePreview) cursor = 'crosshair';
  else if (selectedTool === 'NEW_BOX') cursor = 'crosshair';
  else if (selectedTool) cursor = 'crosshair';

  return (
    <div
      className="canvas-container"
      ref={containerRef}
      style={gridStyle}
    >
      {/* Ready to Box button */}
      {draftBox && boxDrawing.phase === 'adjusting' && (
        <div
          className="ready-to-box-btn"
          style={{
            position: 'absolute',
            left: (draftBox.x + draftBox.width) * zoom + panX + 8,
            top: (draftBox.y) * zoom + panY,
            zIndex: 60,
          }}
        >
          <button
            type="button"
            className="cv-btn cv-btn--primary"
            onClick={() => {
              const error = useStore.getState().confirmBox(draftBox.id);
              if (error) {
                alert(error);
              } else {
                setEditingBoxId(draftBox.id);
              }
            }}
          >
            Ready to Box
          </button>
          <button
            type="button"
            className="cv-btn"
            onClick={() => {
              useStore.getState().removeBox(draftBox.id);
              useStore.getState().setBoxDrawingPhase('idle');
              useStore.getState().setDraftBox(null);
            }}
          >
            Cancel
          </button>
        </div>
      )}

      <svg
        ref={svgRef}
        onPointerDown={handlePointerDown}
        onContextMenu={(e) => {
          // A Mac ctrl-click whose pointer-down already ran a cmd/ctrl gesture
          // (swallowMacMenu, modifier map) gets no menu on top of it.
          const swallow = menuSuppressRef.current;
          menuSuppressRef.current = false;
          // Right-click — a Mac ctrl-click too — disarms the palette tool (and
          // cancels a pending wire) instead of opening the browser menu. With
          // nothing armed and nothing to swallow the menu behaves normally.
          const state = useStore.getState();
          const armed = state.selectedTool !== null || pendingWireRef.current !== null;
          if (armed) {
            state.setSelectedTool(null);
            clearPendingWire();
          }
          if (armed || swallow) e.preventDefault();
        }}
        onDoubleClick={(e) => {
          // Double-click on a box name → enter rename mode
          const target = e.target as SVGElement;
          const boxNameEl = target.getAttribute('data-box-name')
            ? target
            : target.closest<SVGElement>('[data-box-name]');
          if (boxNameEl) {
            e.stopPropagation();
            setEditingBoxId(boxNameEl.getAttribute('data-box-name')!);
          }
        }}
        style={{
          cursor,
          touchAction: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
      >
        <g transform={`translate(${panX}, ${panY}) scale(${zoom})`}>

          {/* Confirmed boxes */}
          {boxes.filter((b) => b.name && b.id !== draftBox?.id).map((box) => (
            <BoxView
              key={box.id}
              box={box}
              isDraft={false}
              isHighlighted={selectedIds.some((id) => box.componentIds.includes(id))}
              isEditingName={editingBoxId === box.id}
              onFinishEditName={() => setEditingBoxId(null)}
              onNotice={showPasteNotice}
            />
          ))}

          {/* Draft box */}
          {draftBox && (
            <BoxView
              box={draftBox}
              isDraft={true}
              isHighlighted={false}
            />
          )}

          {/* Draw box preview */}
          {drawBoxPreview && (
            <rect
              x={drawBoxPreview.x}
              y={drawBoxPreview.y}
              width={drawBoxPreview.w}
              height={drawBoxPreview.h}
              fill={C.selectFill}
              fillOpacity={0.35}
              stroke={C.select}
              strokeWidth={2}
              strokeDasharray="6,3"
              rx={4}
              pointerEvents="none"
            />
          )}

          {/* Wires */}
          {wires.map((wire) => {
            const wd = wireData.get(wire.id);
            if (!wd) return null;
            if (wd.isFsmTransition) {
              return (
                <FsmTransitionView
                  key={wire.id}
                  wire={wire}
                  pathD={wd.pathD}
                  labelPos={wd.labelPos!}
                  controlPt={wd.controlPt}
                  from={wd.from}
                  to={wd.to}
                  isSelected={selectedIds.includes(wire.id)}
                  onSnapGuides={handleFsmSnapGuides}
                />
              );
            }
            return (
              <WireView
                key={wire.id}
                wire={wire}
                pathD={wd.pathD}
                pathPoints={wd.points}
                isSelected={selectedIds.includes(wire.id)}
                fromPos={wd.from}
                toPos={wd.to}
                showValues={showWireValues}
                usedFallback={wd.usedFallback}
                violation={wd.violation}
              />
            );
          })}


          {/* Split dots */}
          {splitDots}

          {/* Highlighted ports (for box boundary crossing) */}
          {highlightedPorts.size > 0 && components.map((comp) => {
            return comp.ports.map((port) => {
              const key = `${comp.id}:${port.id}`;
              if (!highlightedPorts.has(key)) return null;
              const pos = getPortPosition(comp, port.id);
              return (
                <circle
                  key={`hl-${key}`}
                  cx={pos.x}
                  cy={pos.y}
                  r={6}
                  fill="none"
                  stroke={C.warn}
                  strokeWidth={2}
                  pointerEvents="none"
                />
              );
            });
          })}

          {/* Wire preview */}
          {wirePreview && (
            <line
              x1={wirePreview.fromX}
              y1={wirePreview.fromY}
              x2={wirePreview.toX}
              y2={wirePreview.toY}
              stroke={C.select}
              strokeWidth={2}
              strokeDasharray="5,4"
              pointerEvents="none"
            />
          )}

          {/* Box select overlay */}
          {boxSelect && (
            <rect
              x={boxSelect.x1}
              y={boxSelect.y1}
              width={boxSelect.x2 - boxSelect.x1}
              height={boxSelect.y2 - boxSelect.y1}
              fill={C.selectFill}
              fillOpacity={0.5}
              stroke={C.select}
              strokeWidth={1}
              strokeDasharray="4,4"
              pointerEvents="none"
            />
          )}

          {/* Alignment guides */}
          {alignGuides.map((guide, i) =>
            guide.type === 'vertical' ? (
              <line
                key={`guide-${i}`}
                x1={guide.pos}
                y1={guide.start}
                x2={guide.pos}
                y2={guide.end}
                stroke={C.guide}
                strokeWidth={1}
                strokeDasharray="4,2"
                pointerEvents="none"
              />
            ) : (
              <line
                key={`guide-${i}`}
                x1={guide.start}
                y1={guide.pos}
                x2={guide.end}
                y2={guide.pos}
                stroke={C.guide}
                strokeWidth={1}
                strokeDasharray="4,2"
                pointerEvents="none"
              />
            )
          )}

          {/* Wire segment constraint violation indicator (§9.4) */}
          {wireSegmentViolation && (
            <line
              x1={wireSegmentViolation.x1}
              y1={wireSegmentViolation.y1}
              x2={wireSegmentViolation.x2}
              y2={wireSegmentViolation.y2}
              stroke={C.danger}
              strokeWidth={4}
              strokeDasharray="6,3"
              opacity={0.7}
              pointerEvents="none"
            />
          )}

          {/* Components */}
          {components.map((comp) => (
            <CircuitComponentView
              key={comp.id}
              comp={comp}
              isSelected={selectedIds.includes(comp.id)}
              portValues={portValues}
            />
          ))}

          {/* A palette tile in flight: the part at 55%, centred on the pointer */}
          <PaletteGhost containerRef={containerRef} />
        </g>
      </svg>

      {/* The floating palette and its Boxes pop-out (task 054) */}
      <Palette canvasW={containerSize.width} canvasH={containerSize.height} />

      {/* Navigation arrow */}
      {navArrow && (
        <NavigationArrow direction={navArrow} onClick={handleNavigate} />
      )}

      {/* A refused paste explains itself */}
      {pasteNotice && (
        <div className="canvas-notice" role="status">
          {pasteNotice}
        </div>
      )}

      {/* Validation warnings */}
      {warnings.length > 0 && (
        <div className="validation-warnings">
          {warnings.map((w, i) => (
            <div key={i} className="validation-warning">
              {w}
            </div>
          ))}
        </div>
      )}

      {/* Undo · Redo · Delete · Rotate · Clear — top-right corner */}
      <CanvasActions />

      {/* The hint line (bottom-left) and the empty canvas's message */}
      <CanvasGuide />

      {/* Zoom — bottom-right: − · % · + · Fit */}
      <div className="cv-zoom" role="group" aria-label="Zoom">
        <button type="button" onClick={() => zoomStep(1 / ZOOM_STEP)} title="Zoom out" aria-label="Zoom out">−</button>
        <button type="button" className="cv-zoom-pct" onClick={() => zoomStep(1 / zoom)} title="Back to 100%">
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" onClick={() => zoomStep(ZOOM_STEP)} title="Zoom in" aria-label="Zoom in">+</button>
        <button type="button" onClick={fitCanvas} title="Show the whole circuit">Fit</button>
      </div>
    </div>
  );
}
