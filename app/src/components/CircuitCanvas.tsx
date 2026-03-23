import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { useStore } from '../store';
import type {
  CircuitComponent,
  Wire,
  ComponentType,
  TextElement,
  CommentElement,
  BoxDefinition,
} from '../types';
import {
  GRID_SIZE,
  COMP_WIDTH,
  COMP_HEIGHT,
  PORT_RADIUS,
  INPUT_OUTPUT_SIZE,
  isMemSourcePort,
  isMemSinkPort,
} from '../types';
import { v4 as uuid } from 'uuid';
import { routeAllWires, validateSegmentPosition, type WireRouteInput } from '../wireRouter';

// ─── Geometry helpers ─────────────────────────────────────────────

function getCompDimensions(comp: CircuitComponent): { w: number; h: number } {
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
  return { w: COMP_WIDTH, h: COMP_HEIGHT };
}

/** Unrotated port position (absolute coords). */
function getPortPositionLocal(
  comp: CircuitComponent,
  portId: string
): { x: number; y: number } {
  const port = comp.ports.find((p) => p.id === portId);
  if (!port) return { x: comp.x, y: comp.y };

  const { w, h } = getCompDimensions(comp);
  const portsOnSide = comp.ports.filter((p) => p.side === port.side);
  const spacing = h / (portsOnSide.length + 1);

  let localX = port.side === 'left' ? 0 : w;
  const localY = spacing * (port.index + 1);

  if (port.side === 'left' && (comp.type === 'OR' || comp.type === 'XOR')) {
    const xorOffset = comp.type === 'XOR' ? 6 : 0;
    localX = xorOffset + w * 0.07;
  }

  return { x: comp.x + localX, y: comp.y + localY };
}

/** Rotated port position (absolute coords). */
function getPortPosition(
  comp: CircuitComponent,
  portId: string
): { x: number; y: number } {
  const local = getPortPositionLocal(comp, portId);
  const rotation = comp.rotation ?? 0;
  if (rotation === 0) return local;

  const { w, h } = getCompDimensions(comp);
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

const PORT_HIT_RADIUS = 20;

// ─── Wire routing (A* pathfinder — see wireRouter.ts) ────────────

/** Apply manual segment overrides to a computed wire path, maintaining connectivity.
 *  When a segment is shifted, adjacent segments stretch to stay connected. */
function applyManualSegments(
  points: { x: number; y: number }[],
  manualSegments?: import('../types').WireManualSegment[]
): { x: number; y: number }[] {
  if (!manualSegments || manualSegments.length === 0) return points;
  const result = points.map((p) => ({ ...p }));
  // Check orientation on the ORIGINAL points, not the mutated result,
  // so prior adjustments don't break subsequent ones.
  for (const seg of manualSegments) {
    const i = seg.segmentIndex;
    if (i < 0 || i >= points.length - 1) continue;
    const origP1 = points[i];
    const origP2 = points[i + 1];
    const isHorizontal = Math.abs(origP1.y - origP2.y) < 1;
    const isVertical = Math.abs(origP1.x - origP2.x) < 1;
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

function pointsToPathD(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L${points[i].x},${points[i].y}`;
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
  type: 'move' | 'wire' | 'pan' | 'boxselect' | 'drawbox' | 'resizebox' | 'movebox' | 'movetext' | 'resizetext' | 'wiresegment';
  anchorScreenX: number;
  anchorScreenY: number;
  anchorCanvasX: number;
  anchorCanvasY: number;
  currentCanvasX: number;
  currentCanvasY: number;
  // for 'move'
  componentId?: string;
  moveOffsets?: Map<string, { dx: number; dy: number }>;
  shiftKey?: boolean;
  // for 'wire'
  sourceCompId?: string;
  sourcePortId?: string;
  wireFromX?: number;
  wireFromY?: number;
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
  // for 'movetext'
  textId?: string;
  textOffsetX?: number;
  textOffsetY?: number;
  // for 'resizetext'
  resizeTextId?: string;
  resizeCorner?: string;
  origTextX?: number;
  origTextY?: number;
  origTextW?: number;
  origTextH?: number;
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
}: {
  comp: CircuitComponent;
  isSelected: boolean;
}) {
  const { w, h } = getCompDimensions(comp);

  const rot = comp.rotation ?? 0;
  const cx = comp.x + w / 2;
  const cy = comp.y + h / 2;
  const counterRotateLabel = () =>
    rot !== 0 ? `rotate(${-rot}, ${cx}, ${cy})` : undefined;

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
              fill={isBlank ? '#ccc' : val ? '#e53935' : '#999'}
              stroke={isSelected ? '#2a7fff' : '#555'}
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
              fill={isSelected ? '#e3f2fd' : 'white'}
              stroke={isSelected ? '#2a7fff' : '#333'}
              strokeWidth={strokeW}
            />
            <text
              x={toggleX + toggleW / 2}
              y={toggleY + toggleH / 2 + 4}
              textAnchor="middle"
              fontSize="10"
              fontFamily="monospace"
              fontWeight="600"
              fill="white"
              pointerEvents="none"
              transform={counterRotateLabel()}
            >
              {displayVal}
            </text>
            <text
              x={comp.x + w / 2}
              y={comp.y - 4}
              textAnchor="middle"
              fontSize="10"
              fill="#666"
              fontWeight="500"
              transform={counterRotateLabel()}
            >
              {comp.label}
            </text>
            <text
              x={comp.x + w / 2}
              y={comp.y + h / 2 + 5}
              textAnchor="middle"
              fontSize="14"
              fontFamily="monospace"
              fontWeight="600"
              fill={val === 1 ? '#e53935' : '#333'}
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
              fill={isSelected ? '#e3f2fd' : 'white'}
              stroke={isSelected ? '#2a7fff' : '#333'}
              strokeWidth={isSelected ? 2.5 : 1.5}
            />
            <text
              x={comp.x + w / 2}
              y={comp.y - 4}
              textAnchor="middle"
              fontSize="10"
              fill="#666"
              fontWeight="500"
              transform={counterRotateLabel()}
            >
              {comp.label}
            </text>
            <text
              x={comp.x + w / 2}
              y={comp.y + h / 2 + 5}
              textAnchor="middle"
              fontSize="14"
              fontFamily="monospace"
              fontWeight="600"
              fill={comp.value === 1 ? '#e53935' : '#333'}
              transform={counterRotateLabel()}
            >
              {comp.value != null ? comp.value : ''}
            </text>
          </g>
        );

      case 'AND':
        return (
          <g>
            <path
              d={`M${comp.x},${comp.y} L${comp.x + w * 0.5},${comp.y} Q${comp.x + w},${comp.y} ${comp.x + w},${comp.y + h / 2} Q${comp.x + w},${comp.y + h} ${comp.x + w * 0.5},${comp.y + h} L${comp.x},${comp.y + h} Z`}
              fill={isSelected ? '#e3f2fd' : 'white'}
              stroke={isSelected ? '#2a7fff' : '#333'}
              strokeWidth={isSelected ? 2.5 : 1.5}
            />
            <text
              x={cx}
              y={cy}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="20"
              fontWeight="700"
              fill="#333"
              stroke="#333"
              strokeWidth={1}
              paintOrder="stroke"
              transform={counterRotateLabel()}
            >
              {'\u2227'}
            </text>
          </g>
        );

      case 'OR':
        return (
          <g>
            <path
              d={`M${comp.x},${comp.y} Q${comp.x + w * 0.3},${comp.y} ${comp.x + w * 0.5},${comp.y} Q${comp.x + w},${comp.y} ${comp.x + w},${comp.y + h / 2} Q${comp.x + w},${comp.y + h} ${comp.x + w * 0.5},${comp.y + h} Q${comp.x + w * 0.3},${comp.y + h} ${comp.x},${comp.y + h} Q${comp.x + w * 0.2},${comp.y + h / 2} ${comp.x},${comp.y} Z`}
              fill={isSelected ? '#e3f2fd' : 'white'}
              stroke={isSelected ? '#2a7fff' : '#333'}
              strokeWidth={isSelected ? 2.5 : 1.5}
            />
            <text
              x={cx}
              y={cy}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="20"
              fontWeight="700"
              fill="#333"
              stroke="#333"
              strokeWidth={1}
              paintOrder="stroke"
              transform={counterRotateLabel()}
            >
              {'\u2228'}
            </text>
          </g>
        );

      case 'NOT':
        return (
          <g>
            <polygon
              points={`${comp.x},${comp.y} ${comp.x + w},${comp.y + h / 2} ${comp.x},${comp.y + h}`}
              fill={isSelected ? '#e3f2fd' : 'white'}
              stroke={isSelected ? '#2a7fff' : '#333'}
              strokeWidth={isSelected ? 2.5 : 1.5}
            />
            <text
              x={comp.x + w / 3}
              y={cy}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="18"
              fontWeight="700"
              fill="#333"
              transform={counterRotateLabel()}
            >
              {'\u00AC'}
            </text>
          </g>
        );

      case 'XOR':
        return (
          <g>
            <path
              d={`M${comp.x + 6},${comp.y} Q${comp.x + w * 0.4},${comp.y} ${comp.x + w * 0.5},${comp.y} Q${comp.x + w},${comp.y} ${comp.x + w},${comp.y + h / 2} Q${comp.x + w},${comp.y + h} ${comp.x + w * 0.5},${comp.y + h} Q${comp.x + w * 0.4},${comp.y + h} ${comp.x + 6},${comp.y + h} Q${comp.x + w * 0.25},${comp.y + h / 2} ${comp.x + 6},${comp.y} Z`}
              fill={isSelected ? '#e3f2fd' : 'white'}
              stroke={isSelected ? '#2a7fff' : '#333'}
              strokeWidth={isSelected ? 2.5 : 1.5}
            />
            <path
              d={`M${comp.x},${comp.y} Q${comp.x + w * 0.18},${comp.y + h / 2} ${comp.x},${comp.y + h}`}
              fill="none"
              stroke={isSelected ? '#2a7fff' : '#333'}
              strokeWidth={1.5}
            />
            <text
              x={cx}
              y={cy}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="18"
              fontWeight="700"
              fill="#333"
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
              fill={isSelected ? '#e3f2fd' : 'white'}
              stroke={isSelected ? '#2a7fff' : '#333'}
              strokeWidth={isSelected ? 2.5 : 1.5}
            />
            <text
              x={cx}
              y={cy}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="13"
              fontWeight="600"
              fill="#333"
              transform={counterRotateLabel()}
            >
              HA
            </text>
            <text x={comp.x + 6} y={comp.y + h / 3 + 4} fontSize="9" fill="#888" transform={counterRotateLabel()}>A</text>
            <text x={comp.x + 6} y={comp.y + (2 * h) / 3 + 4} fontSize="9" fill="#888" transform={counterRotateLabel()}>B</text>
            <text x={comp.x + w - 12} y={comp.y + h / 3 + 4} fontSize="9" fill="#888" transform={counterRotateLabel()}>S</text>
            <text x={comp.x + w - 12} y={comp.y + (2 * h) / 3 + 4} fontSize="9" fill="#888" transform={counterRotateLabel()}>C</text>
          </g>
        );

      case 'MEM': {
        const dir = comp.memDirection;
        // Arrow chevrons inside the block, flanking the stored value
        const arrowSize = 5;
        const arrowInset = 12; // distance from block edge to arrow tip
        // Shift the whole arrow+value group when resolved so it stays visually centered
        const groupShift = !dir ? 0 : dir === 'left-to-right' ? 4 : -4;
        const arrowColor = dir ? '#2a7fff' : '#999';
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
              fill={isSelected ? '#e3f2fd' : '#f5f5f5'}
              stroke={isSelected ? '#2a7fff' : '#aaa'}
              strokeWidth={isSelected ? 2 : 1.5}
            />
            {/* Label above — bold */}
            <text
              x={cx}
              y={comp.y - 5}
              textAnchor="middle"
              fontSize="12"
              fill="#333"
              fontWeight="700"
              transform={counterRotateLabel()}
            >
              {comp.label}
            </text>
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
              y={cy + 5}
              textAnchor="middle"
              fontSize="14"
              fontFamily="monospace"
              fontWeight="700"
              fill={storedVal === 1 ? '#e53935' : '#333'}
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
              fill={isSelected ? '#e3f2fd' : 'white'}
              stroke={isSelected ? '#2a7fff' : '#333'}
              strokeWidth={2}
            />
            <text
              x={cx}
              y={cy}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="12"
              fontWeight="600"
              fill="#333"
              transform={counterRotateLabel()}
            >
              {comp.label}
            </text>
          </g>
        );

      default:
        return (
          <rect
            x={comp.x}
            y={comp.y}
            width={w}
            height={h}
            rx={4}
            fill={isSelected ? '#e3f2fd' : 'white'}
            stroke={isSelected ? '#2a7fff' : '#333'}
            strokeWidth={1.5}
          />
        );
    }
  };

  const renderPorts = () => {
    return comp.ports.map((port) => {
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
            fill="#bbb"
            stroke="#000"
            strokeWidth={2}
            pointerEvents="none"
          />
        </g>
      );
    });
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
  crossings,
  isSelected,
  fromPos,
  toPos,
  showValues,
}: {
  wire: Wire;
  pathD: string;
  pathPoints: { x: number; y: number }[];
  crossings: { x: number; y: number }[];
  isSelected: boolean;
  fromPos: { x: number; y: number };
  toPos: { x: number; y: number };
  showValues: boolean;
}) {
  const isBlankWire = wire.value === -1;
  const color = isBlankWire ? '#333' : wire.value === 1 ? '#e53935' : '#333';
  const strokeW = isSelected ? 3 : 2;
  const valStr = isBlankWire ? '' : String(wire.value);

  return (
    <g data-wire-id={wire.id} style={{ cursor: 'pointer' }}>
      {/* Invisible wider path for easier clicking */}
      <path
        d={pathD}
        fill="none"
        stroke="transparent"
        strokeWidth={14}
        data-wire-id={wire.id}
      />
      <path
        d={pathD}
        fill="none"
        stroke={isSelected ? '#2a7fff' : color}
        strokeWidth={strokeW}
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
      {/* ── Crossing bridge/hop indicators (§8) ────────────────────── */}
      {crossings.map((cp, ci) => (
        <circle
          key={`cross-${wire.id}-${ci}`}
          cx={cp.x}
          cy={cp.y}
          r={4}
          fill="white"
          stroke={isSelected ? '#2a7fff' : color}
          strokeWidth={strokeW}
          pointerEvents="none"
        />
      ))}
      {showValues && !isBlankWire && (
        <>
          <text
            x={fromPos.x + 8}
            y={fromPos.y - 6}
            fontSize="10"
            fontFamily="'SF Mono', 'Fira Code', monospace"
            fontWeight="600"
            fill={wire.value === 1 ? '#e53935' : '#888'}
            pointerEvents="none"
          >
            {valStr}
          </text>
          <text
            x={toPos.x - 14}
            y={toPos.y - 6}
            fontSize="10"
            fontFamily="'SF Mono', 'Fira Code', monospace"
            fontWeight="600"
            fill={wire.value === 1 ? '#e53935' : '#888'}
            pointerEvents="none"
          >
            {valStr}
          </text>
        </>
      )}
    </g>
  );
}

// ─── Text Element View ───────────────────────────────────────────

function TextElementView({
  elem,
  isSelected,
  isEditing,
  onStartEdit,
}: {
  elem: TextElement;
  isSelected: boolean;
  isEditing: boolean;
  onStartEdit: () => void;
}) {
  const updateTextElement = useStore((s) => s.updateTextElement);

  return (
    <g data-text-id={elem.id}>
      {/* Bounding box */}
      <rect
        x={elem.x}
        y={elem.y}
        width={elem.width}
        height={elem.height}
        fill={isSelected ? 'rgba(42, 127, 255, 0.05)' : 'transparent'}
        stroke={isSelected ? '#2a7fff' : '#ccc'}
        strokeWidth={isSelected ? 1.5 : 0.5}
        strokeDasharray={isSelected ? undefined : '4,2'}
        data-text-id={elem.id}
        style={{ cursor: 'move' }}
      />
      {/* Resize handles when selected */}
      {isSelected && (
        <>
          {['nw', 'ne', 'sw', 'se'].map((corner) => {
            const hx = corner.includes('e') ? elem.x + elem.width : elem.x;
            const hy = corner.includes('s') ? elem.y + elem.height : elem.y;
            return (
              <rect
                key={corner}
                x={hx - 4}
                y={hy - 4}
                width={8}
                height={8}
                fill="white"
                stroke="#2a7fff"
                strokeWidth={1}
                data-text-resize={elem.id}
                data-resize-corner={corner}
                style={{ cursor: `${corner}-resize` }}
              />
            );
          })}
        </>
      )}
      {/* Text content */}
      {isEditing ? (
        <foreignObject x={elem.x + 4} y={elem.y + 2} width={elem.width - 8} height={elem.height - 4}>
          <textarea
            autoFocus
            defaultValue={elem.text}
            onBlur={(e) => {
              updateTextElement(elem.id, { text: e.target.value });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                (e.target as HTMLTextAreaElement).blur();
              }
            }}
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              resize: 'none',
              fontFamily: 'inherit',
              fontSize: elem.fontSize,
              color: elem.fontColor,
              fontWeight: elem.bold ? 'bold' : 'normal',
              fontStyle: elem.italic ? 'italic' : 'normal',
              padding: 0,
              margin: 0,
            }}
          />
        </foreignObject>
      ) : (
        <foreignObject x={elem.x + 4} y={elem.y + 2} width={elem.width - 8} height={elem.height - 4}>
          <div
            onDoubleClick={(e) => {
              e.stopPropagation();
              onStartEdit();
            }}
            style={{
              width: '100%',
              height: '100%',
              fontSize: elem.fontSize,
              color: elem.fontColor,
              fontWeight: elem.bold ? 'bold' : 'normal',
              fontStyle: elem.italic ? 'italic' : 'normal',
              fontFamily: 'inherit',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              overflow: 'hidden',
              cursor: 'text',
              userSelect: 'none',
            }}
          >
            {elem.text || (isSelected ? 'Double-click to edit' : '')}
          </div>
        </foreignObject>
      )}
    </g>
  );
}

// ─── Comment Icon View ───────────────────────────────────────────

function CommentIconView({
  comment,
  anchorX,
  anchorY,
  isExpanded,
  onToggle,
}: {
  comment: CommentElement;
  anchorX: number;
  anchorY: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const updateComment = useStore((s) => s.updateComment);
  const removeComment = useStore((s) => s.removeComment);
  const [editing, setEditing] = useState(false);

  const iconX = anchorX + comment.x;
  const iconY = anchorY + comment.y;

  return (
    <g data-comment-id={comment.id}>
      {/* Comment icon (speech bubble) */}
      <g
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        style={{ cursor: 'pointer' }}
      >
        <circle cx={iconX} cy={iconY} r={8} fill="#2196f3" />
        <text
          x={iconX}
          y={iconY + 4}
          textAnchor="middle"
          fontSize="10"
          fill="white"
          fontWeight="bold"
          pointerEvents="none"
        >
          {'\u2709'}
        </text>
      </g>

      {/* Expanded comment bubble */}
      {isExpanded && (
        <foreignObject x={iconX + 12} y={iconY - 10} width={200} height={120}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'white',
              border: '1px solid #2196f3',
              borderRadius: 6,
              padding: 8,
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              fontSize: 12,
            }}
          >
            {editing ? (
              <textarea
                autoFocus
                defaultValue={comment.text}
                onBlur={(e) => {
                  updateComment(comment.id, { text: e.target.value });
                  setEditing(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur();
                }}
                style={{
                  width: '100%',
                  height: 60,
                  border: '1px solid #ccc',
                  borderRadius: 3,
                  resize: 'none',
                  fontSize: 12,
                  fontFamily: 'inherit',
                  padding: 4,
                }}
              />
            ) : (
              <div
                onDoubleClick={() => setEditing(true)}
                style={{ minHeight: 20, cursor: 'text', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
              >
                {comment.text || 'Double-click to add comment...'}
              </div>
            )}
            <div style={{ display: 'flex', gap: 4, marginTop: 4, justifyContent: 'flex-end' }}>
              {!editing && (
                <button
                  onClick={() => setEditing(true)}
                  style={{ fontSize: 10, padding: '2px 6px', cursor: 'pointer', border: '1px solid #ccc', borderRadius: 3, background: 'white' }}
                >
                  Edit
                </button>
              )}
              <button
                onClick={() => removeComment(comment.id)}
                style={{ fontSize: 10, padding: '2px 6px', cursor: 'pointer', border: '1px solid #e53935', borderRadius: 3, background: 'white', color: '#e53935' }}
              >
                Delete
              </button>
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
}: {
  box: BoxDefinition;
  isDraft: boolean;
  isHighlighted: boolean;
  isEditingName?: boolean;
  onFinishEditName?: () => void;
}) {
  const updateBox = useStore((s) => s.updateBox);

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
    <g data-box-id={box.id}>
      {/* Main box rect */}
      <rect
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        fill={isDraft ? 'rgba(42, 127, 255, 0.05)' : 'rgba(42, 127, 255, 0.03)'}
        stroke={isDraft ? '#2a7fff' : (isHighlighted ? '#2a7fff' : '#333')}
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
            stroke="#333"
            strokeWidth={2}
          />
          <circle cx={pos.x - 8} cy={pos.y} r={3} fill="#555" />
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
            stroke="#333"
            strokeWidth={2}
          />
          <circle cx={pos.x + 8} cy={pos.y} r={3} fill="#555" />
        </g>
      ))}
      {/* Editable label — double-click to rename confirmed boxes */}
      {!isDraft && isEditingName ? (
        <foreignObject x={box.x + 2} y={box.y - 20} width={120} height={18}>
          <input
            autoFocus
            defaultValue={box.name}
            onBlur={(e) => {
              const name = e.target.value.trim();
              if (name) updateBox(box.id, { name });
              onFinishEditName?.();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') onFinishEditName?.();
            }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            style={{ width: '100%', fontSize: 11, fontWeight: 600, border: '1px solid #2a7fff', borderRadius: 2, padding: '0 4px', outline: 'none', fontFamily: 'inherit' }}
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
            fill={isDraft ? '#2a7fff' : '#333'}
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
                fill="white"
                stroke="#2a7fff"
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
    </g>
  );
}

// ─── Text Formatting Toolbar (HTML overlay) ──────────────────────

function TextFormattingToolbar({ elem }: { elem: TextElement }) {
  const updateTextElement = useStore((s) => s.updateTextElement);

  return (
    <div className="text-format-toolbar">
      <select
        value={elem.fontSize}
        onChange={(e) => updateTextElement(elem.id, { fontSize: parseInt(e.target.value) })}
        className="text-format-select"
      >
        {[10, 12, 14, 16, 18, 20, 24, 28, 32].map((s) => (
          <option key={s} value={s}>{s}px</option>
        ))}
      </select>
      <input
        type="color"
        value={elem.fontColor}
        onChange={(e) => updateTextElement(elem.id, { fontColor: e.target.value })}
        className="text-format-color"
        title="Font color"
      />
      <button
        className={`text-format-btn ${elem.bold ? 'active' : ''}`}
        onClick={() => updateTextElement(elem.id, { bold: !elem.bold })}
        title="Bold"
      >
        B
      </button>
      <button
        className={`text-format-btn ${elem.italic ? 'active' : ''}`}
        onClick={() => updateTextElement(elem.id, { italic: !elem.italic })}
        title="Italic"
        style={{ fontStyle: 'italic' }}
      >
        I
      </button>
    </div>
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

  const posStyle: React.CSSProperties = {
    position: 'absolute',
    zIndex: 50,
    background: 'rgba(42, 127, 255, 0.9)',
    color: 'white',
    border: 'none',
    borderRadius: '50%',
    width: 36,
    height: 36,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontSize: 18,
    fontWeight: 'bold',
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
  };

  if (direction === 'left') Object.assign(posStyle, { left: 8, top: '50%', transform: 'translateY(-50%)' });
  if (direction === 'right') Object.assign(posStyle, { right: 8, top: '50%', transform: 'translateY(-50%)' });
  if (direction === 'up') Object.assign(posStyle, { top: 8, left: '50%', transform: 'translateX(-50%)' });
  if (direction === 'down') Object.assign(posStyle, { bottom: 8, left: '50%', transform: 'translateX(-50%)' });

  return (
    <button style={posStyle} onClick={onClick} title="Navigate to circuit">
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
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [editingBoxId, setEditingBoxId] = useState<string | null>(null);
  const [expandedCommentId, setExpandedCommentId] = useState<string | null>(null);
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
  const showGrid = useStore((s) => s.showGrid);
  const showWireValues = useStore((s) => s.showWireValues);
  const addComponent = useStore((s) => s.addComponent);
  const selectedIds = useStore((s) => s.selectedIds);
  const buildMode = useStore((s) => s.buildMode);
  const homework = useStore((s) => s.homework);
  const currentProblemIndex = useStore((s) => s.currentProblemIndex);
  const selectedTool = useStore((s) => s.selectedTool);
  const textElements = useStore((s) => s.textElements);
  const comments = useStore((s) => s.comments);
  const showComments = useStore((s) => s.showComments);
  const boxes = useStore((s) => s.boxes);
  const boxDrawing = useStore((s) => s.boxDrawing);
  const problemSet = useStore((s) => s.problemSet);
  const currentProblemPageIndex = useStore((s) => s.currentProblemPageIndex);

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
    {
      const compMap = new Map(components.map((c) => [c.id, c]));
      const visited = new Set<string>();
      const recStack = new Set<string>();
      const adj = new Map<string, string[]>();
      for (const c of components) adj.set(c.id, []);
      for (const wire of wires) {
        // Skip wires into MEM input ports — MEM breaks feedback loops
        const targetComp = compMap.get(wire.targetComponentId);
        if (targetComp?.type === 'MEM' && isMemSinkPort(targetComp, wire.targetPortId)) continue;
        const list = adj.get(wire.sourceComponentId) || [];
        list.push(wire.targetComponentId);
        adj.set(wire.sourceComponentId, list);
      }
      function hasCycle(id: string): boolean {
        visited.add(id);
        recStack.add(id);
        for (const next of adj.get(id) || []) {
          if (!visited.has(next) && hasCycle(next)) return true;
          if (recStack.has(next)) return true;
        }
        recStack.delete(id);
        return false;
      }
      for (const c of components) {
        if (!visited.has(c.id) && hasCycle(c.id)) {
          w.push('Warning: Loop detected in combinatorial circuit');
          break;
        }
      }
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
    return w;
  }, [components, wires, buildMode]);

  // ─── Keyboard shortcuts ──────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      )
        return;

      if (e.key === 'Escape') {
        useStore.getState().setSelectedTool(null);
        setEditingTextId(null);
        setExpandedCommentId(null);
        // Cancel box drawing
        const state = useStore.getState();
        if (state.boxDrawing.phase !== 'idle') {
          state.setBoxDrawingPhase('idle');
          state.setDraftBox(null);
        }
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        useStore.getState().deleteSelected();
      }
      if (e.metaKey || e.ctrlKey) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          useStore.getState().undo();
        }
        if (e.key === 'z' && e.shiftKey) {
          e.preventDefault();
          useStore.getState().redo();
        }
        if (e.key === 'c') {
          e.preventDefault();
          useStore.getState().copySelected();
        }
        if (e.key === 'v') {
          e.preventDefault();
          useStore.getState().paste();
        }
        if (e.key === 'a') {
          e.preventDefault();
          const s = useStore.getState();
          s.setSelectedIds([
            ...s.components.map((c) => c.id),
            ...s.textElements.map((t) => t.id),
          ]);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

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

  // ─── Drag & drop from component library ────────────────────────
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData('componentType');
      if (!type) return;
      const pos = screenToCanvas(e.clientX, e.clientY);

      // Handle box instance drops
      if (type === 'BOXED_INSTANCE') {
        const boxId = e.dataTransfer.getData('boxDefinitionId');
        if (boxId) {
          useStore.getState().placeBoxInstance(boxId, pos.x - 40, pos.y - 30);
        }
        return;
      }

      addComponent(type as ComponentType, pos.x - 40, pos.y - 30);
    },
    [screenToCanvas, addComponent]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
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

    // Check for text resize handle
    const textResizeEl = target.getAttribute('data-text-resize')
      ? target
      : target.closest<SVGElement>('[data-text-resize]');
    if (textResizeEl) {
      return {
        type: 'textresize' as const,
        textId: textResizeEl.getAttribute('data-text-resize')!,
        corner: textResizeEl.getAttribute('data-resize-corner')!,
      };
    }

    // Check for text element
    const textEl = target.getAttribute('data-text-id')
      ? target
      : target.closest<SVGElement>('[data-text-id]');
    if (textEl) {
      return {
        type: 'text' as const,
        textId: textEl.getAttribute('data-text-id')!,
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

      if (drag.type === 'movetext' && drag.textId) {
        state.updateTextElement(drag.textId, {
          x: canvasPos.x - drag.textOffsetX!,
          y: canvasPos.y - drag.textOffsetY!,
        });
        return;
      }

      if (drag.type === 'resizetext' && drag.resizeTextId) {
        const corner = drag.resizeCorner!;
        let newX = drag.origTextX!;
        let newY = drag.origTextY!;
        let newW = drag.origTextW!;
        let newH = drag.origTextH!;

        if (corner.includes('e')) {
          newW = Math.max(40, canvasPos.x - newX);
        }
        if (corner.includes('w')) {
          const right = newX + newW;
          newX = Math.min(canvasPos.x, right - 40);
          newW = right - newX;
        }
        if (corner.includes('s')) {
          newH = Math.max(20, canvasPos.y - newY);
        }
        if (corner.includes('n')) {
          const bottom = newY + newH;
          newY = Math.min(canvasPos.y, bottom - 20);
          newH = bottom - newY;
        }

        state.updateTextElement(drag.resizeTextId, { x: newX, y: newY, width: newW, height: newH });
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
        const newSeg = { segmentIndex: drag.segmentIndex!, offset, axis };
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
        const canvasPos = screenToCanvas(e.clientX, e.clientY);
        // First pass: direct proximity to port
        let bestDist = Infinity;
        let bestComp: typeof state.components[0] | null = null;
        let bestPort: typeof state.components[0]['ports'][0] | null = null;
        for (const comp of state.components) {
          if (comp.id === drag.sourceCompId) continue;
          for (const port of comp.ports) {
            // For MEM, target port depends on direction; for all others, left-side ports are targets
            const isTargetPort = comp.type === 'MEM' ? isMemSinkPort(comp, port.id) : port.side === 'left';
            if (!isTargetPort) continue;
            const portPos = getPortPosition(comp, port.id);
            const dist = Math.hypot(canvasPos.x - portPos.x, canvasPos.y - portPos.y);
            if (dist < PORT_HIT_RADIUS + 10 && dist < bestDist) {
              bestDist = dist;
              bestComp = comp;
              bestPort = port;
            }
          }
        }
        // Second pass: overshoot — cursor is inside component bounds, find closest target port
        if (!bestComp) {
          for (const comp of state.components) {
            if (comp.id === drag.sourceCompId) continue;
            const { w, h } = getCompDimensions(comp);
            if (canvasPos.x >= comp.x && canvasPos.x <= comp.x + w &&
                canvasPos.y >= comp.y && canvasPos.y <= comp.y + h) {
              for (const port of comp.ports) {
                const isTargetPort = comp.type === 'MEM' ? isMemSinkPort(comp, port.id) : port.side === 'left';
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
        if (bestComp && bestPort) {
          state.addWire(
            drag.sourceCompId!,
            drag.sourcePortId!,
            bestComp.id,
            bestPort.id
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
          const textIds = state.textElements
            .filter((t) => {
              return t.x + t.width > x1 && t.x < x2 && t.y + t.height > y1 && t.y < y2;
            })
            .map((t) => t.id);
          state.setSelectedIds([...compIds, ...textIds]);
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
            id: uuid(),
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
          state.setDraftBox(newBox);
          state.setBoxDrawingPhase('adjusting');
          state.setSelectedTool(null);
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
      if (e.button !== 0 && e.button !== 1) return;

      // If an input/textarea is currently focused (e.g. editing a box name or
      // tab name), blur it first so the edit commits before we do anything else.
      // This is needed because preventDefault() below would suppress the
      // automatic blur that browsers normally do on pointerdown.
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') &&
        activeEl !== e.target
      ) {
        (activeEl as HTMLElement).blur();
      }

      const state = useStore.getState();
      const canvasPos = screenToCanvas(e.clientX, e.clientY);
      const hit = findTarget(e);

      // Middle-click or alt+left-click → pan
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
      if (hit.type === 'wiresegment') {
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

      // ─── Text resize ──────────────────────────────────────
      if (hit.type === 'textresize') {
        e.preventDefault();
        e.stopPropagation();
        const elem = state.textElements.find((t) => t.id === hit.textId);
        if (!elem) return;
        state.pushHistory();
        dragRef.current = {
          type: 'resizetext',
          anchorScreenX: e.clientX,
          anchorScreenY: e.clientY,
          anchorCanvasX: canvasPos.x,
          anchorCanvasY: canvasPos.y,
          currentCanvasX: canvasPos.x,
          currentCanvasY: canvasPos.y,
          resizeTextId: hit.textId,
          resizeCorner: hit.corner,
          origTextX: elem.x,
          origTextY: elem.y,
          origTextW: elem.width,
          origTextH: elem.height,
          pointerId: e.pointerId,
        };
        svgRef.current?.setPointerCapture(e.pointerId);
        window.addEventListener('pointermove', stableOnMove);
        window.addEventListener('pointerup', stableOnUp);
        return;
      }

      // ─── Text element click ────────────────────────────────
      if (hit.type === 'text') {
        e.preventDefault();
        e.stopPropagation();
        const elem = state.textElements.find((t) => t.id === hit.textId);
        if (!elem) return;

        // If comment tool is active, attach comment to text element
        if (state.selectedTool === 'COMMENT') {
          const text = window.prompt('Enter comment:') || '';
          state.addComment(hit.textId, text);
          state.setSelectedTool(null);
          return;
        }

        state.setSelectedIds([hit.textId]);

        // Start drag for moving
        dragRef.current = {
          type: 'movetext',
          anchorScreenX: e.clientX,
          anchorScreenY: e.clientY,
          anchorCanvasX: canvasPos.x,
          anchorCanvasY: canvasPos.y,
          currentCanvasX: canvasPos.x,
          currentCanvasY: canvasPos.y,
          textId: hit.textId,
          textOffsetX: canvasPos.x - elem.x,
          textOffsetY: canvasPos.y - elem.y,
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

        // For MEM blocks, source port depends on direction; for all others, right-side ports are sources
      const isSourcePort = comp.type === 'MEM'
        ? isMemSourcePort(comp, hit.portId)
        : hit.portSide === 'right';
      if (isSourcePort) {
          const pos = getPortPosition(comp, hit.portId);
          dragRef.current = {
            type: 'wire',
            anchorScreenX: e.clientX,
            anchorScreenY: e.clientY,
            anchorCanvasX: pos.x,
            anchorCanvasY: pos.y,
            currentCanvasX: pos.x,
            currentCanvasY: pos.y,
            sourceCompId: hit.compId,
            sourcePortId: hit.portId,
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

      // ─── Wire click ───────────────────────────────────────────
      if (hit.type === 'wire') {
        e.preventDefault();
        e.stopPropagation();

        // Comment tool on wire
        if (state.selectedTool === 'COMMENT') {
          const text = window.prompt('Enter comment:') || '';
          state.addComment(hit.wireId, text);
          state.setSelectedTool(null);
          return;
        }

        if (state.selectedTool) {
          state.setSelectedTool(null);
        }
        if (e.shiftKey) {
          state.toggleSelected(hit.wireId);
        } else {
          state.setSelectedIds([hit.wireId]);
        }
        return;
      }

      // ─── Component click ───────────────────────────────────
      if (hit.type === 'component') {
        // Comment tool on component
        if (state.selectedTool === 'COMMENT') {
          const text = window.prompt('Enter comment:') || '';
          state.addComment(hit.compId, text);
          state.setSelectedTool(null);
          return;
        }

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
              const mems = s.components.filter((c) => c.type === 'MEM')
                .sort((a, b) => parseInt(a.label.replace('M', '')) - parseInt(b.label.replace('M', '')));
              const inBits = inputs.map((c) => c.value ?? 0);
              const memBits = mems.length > 0 ? mems.map((c) => c.storedValue ?? 0) : undefined;
              s.localStepSelect(inBits, memBits);
            }, 0);
          }
          return;
        }

        if (e.shiftKey) {
          useStore.getState().rotateComponent(hit.compId);
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
          shiftKey: e.shiftKey,
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

      // Click-to-place: TEXT tool
      if (state.selectedTool === 'TEXT') {
        const id = state.addTextElement(canvasPos.x, canvasPos.y);
        state.setSelectedIds([id]);
        setEditingTextId(id);
        state.setSelectedTool(null);
        return;
      }

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

      // Click-to-place: component tool
      if (state.selectedTool && state.selectedTool !== 'COMMENT') {
        addComponent(state.selectedTool as ComponentType, canvasPos.x - 40, canvasPos.y - 30);
        return;
      }

      // Deselect comment tool on canvas click
      if (state.selectedTool === 'COMMENT') {
        state.setSelectedTool(null);
      }

      // Close expanded comment
      setExpandedCommentId(null);

      // Box select
      if (!e.shiftKey) {
        state.clearSelection();
      }
      dragRef.current = {
        type: 'boxselect',
        anchorScreenX: e.clientX,
        anchorScreenY: e.clientY,
        anchorCanvasX: canvasPos.x,
        anchorCanvasY: canvasPos.y,
        currentCanvasX: canvasPos.x,
        currentCanvasY: canvasPos.y,
        pointerId: e.pointerId,
      };
      pendingOverlay.current.boxSelect = null;

      svgRef.current?.setPointerCapture(e.pointerId);
      window.addEventListener('pointermove', stableOnMove);
      window.addEventListener('pointerup', stableOnUp);
    },
    [screenToCanvas, requestOverlayUpdate, stableOnMove, stableOnUp]
  );

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('pointermove', stableOnMove);
      window.removeEventListener('pointerup', stableOnUp);
    };
  }, [stableOnMove, stableOnUp]);

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
  const gridPattern = useMemo(() => {
    if (!showGrid) return null;
    return (
      <>
        <defs>
          <pattern
            id="grid-pattern"
            width={GRID_SIZE}
            height={GRID_SIZE}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${GRID_SIZE} 0 L 0 0 0 ${GRID_SIZE}`}
              fill="none"
              stroke="#ddd"
              strokeWidth={0.5}
            />
          </pattern>
        </defs>
        <rect x={-4000} y={-4000} width={8000} height={8000} fill="url(#grid-pattern)" />
      </>
    );
  }, [showGrid]);

  // ─── Wire data ref (for event handlers that need current wire paths) ──
  const wireDataRef = useRef<Map<string, { pathD: string; points: { x: number; y: number }[]; basePoints: { x: number; y: number }[]; crossings: { x: number; y: number }[]; from: { x: number; y: number }; to: { x: number; y: number } }>>(new Map());

  // ─── Previous paths ref for continuity bias (§7.2) ──
  const previousPathsRef = useRef<Map<string, { x: number; y: number }[]>>(new Map());

  // ─── Compute all wire paths (A* grid-based router) ──────────────
  const wireData = useMemo(() => {
    const data = new Map<string, { pathD: string; points: { x: number; y: number }[]; basePoints: { x: number; y: number }[]; crossings: { x: number; y: number }[]; from: { x: number; y: number }; to: { x: number; y: number } }>();

    // Build routing inputs
    const routeInputs: WireRouteInput[] = [];
    for (const wire of wires) {
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

    // Route all wires using A* pathfinder with continuity bias
    const results = routeAllWires(routeInputs, components, previousPathsRef.current);

    // Build next previousPaths for continuity bias on next render
    const nextPreviousPaths = new Map<string, { x: number; y: number }[]>();

    for (const result of results) {
      const wire = wires.find(w => w.id === result.wireId);
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
      });
      nextPreviousPaths.set(wire.id, basePoints);
    }

    previousPathsRef.current = nextPreviousPaths;
    wireDataRef.current = data;
    return data;
  }, [wires, components]);

  // ─── Split dots ────────────────────────────────────────────────
  const splitDots = useMemo(() => {
    const outputUsage = new Map<string, number>();
    for (const w of wires) {
      const key = `${w.sourceComponentId}:${w.sourcePortId}`;
      outputUsage.set(key, (outputUsage.get(key) || 0) + 1);
    }
    const dots: React.ReactElement[] = [];
    for (const [key, count] of outputUsage) {
      if (count > 1) {
        const [compId, portId] = key.split(':');
        const comp = components.find((c) => c.id === compId);
        if (comp) {
          const pos = getPortPosition(comp, portId);
          dots.push(
            <circle key={`split-${key}`} cx={pos.x} cy={pos.y} r={4} fill="#333" />
          );
        }
      }
    }
    return dots;
  }, [wires, components]);

  // ─── Comment anchors ───────────────────────────────────────────
  const commentAnchors = useMemo(() => {
    const anchors = new Map<string, { x: number; y: number }>();
    for (const comp of components) {
      const { w } = getCompDimensions(comp);
      anchors.set(comp.id, { x: comp.x + w, y: comp.y });
    }
    for (const wire of wires) {
      const wd = wireData.get(wire.id);
      if (wd && wd.points.length > 1) {
        const mid = wd.points[Math.floor(wd.points.length / 2)];
        anchors.set(wire.id, { x: mid.x, y: mid.y });
      }
    }
    for (const te of textElements) {
      anchors.set(te.id, { x: te.x + te.width, y: te.y });
    }
    return anchors;
  }, [components, wires, wireData, textElements]);

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
  else if (selectedTool === 'TEXT') cursor = 'text';
  else if (selectedTool === 'COMMENT') cursor = 'help';
  else if (selectedTool === 'NEW_BOX') cursor = 'crosshair';
  else if (selectedTool) cursor = 'crosshair';

  // Problem text
  const currentProblem = homework?.problems[currentProblemIndex];
  const currentProblemPage = problemSet?.pages[currentProblemPageIndex];

  // Selected text element for formatting toolbar
  const selectedTextElem = textElements.find((t) => selectedIds.includes(t.id));

  return (
    <div
      className="canvas-container"
      ref={containerRef}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {/* Problem Set header */}
      {currentProblemPage && (
        <div className="problem-set-header">
          <div className="problem-set-label">{currentProblemPage.label}</div>
          <div className="problem-set-statement">{currentProblemPage.statement}</div>
        </div>
      )}
      {/* Legacy homework banner */}
      {currentProblem && !currentProblemPage && (
        <div className="problem-banner">{currentProblem.text}</div>
      )}

      {/* Text formatting toolbar */}
      {selectedTextElem && (
        <TextFormattingToolbar elem={selectedTextElem} />
      )}

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
            className="toolbar-btn"
            style={{ background: '#2a7fff', color: 'white', borderColor: '#2a7fff', fontSize: 11, padding: '4px 10px' }}
            onClick={() => {
              const error = useStore.getState().confirmBox(draftBox.id);
              if (error) {
                alert(error);
              }
            }}
          >
            Ready to Box
          </button>
          <button
            className="toolbar-btn"
            style={{ fontSize: 11, padding: '4px 8px', marginLeft: 4 }}
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
          {gridPattern}

          {/* Confirmed boxes */}
          {boxes.filter((b) => b.name && b.id !== draftBox?.id).map((box) => (
            <BoxView
              key={box.id}
              box={box}
              isDraft={false}
              isHighlighted={selectedIds.some((id) => box.componentIds.includes(id))}
              isEditingName={editingBoxId === box.id}
              onFinishEditName={() => setEditingBoxId(null)}
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
              fill="rgba(42, 127, 255, 0.05)"
              stroke="#2a7fff"
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
            return (
              <WireView
                key={wire.id}
                wire={wire}
                pathD={wd.pathD}
                pathPoints={wd.points}
                crossings={wd.crossings}
                isSelected={selectedIds.includes(wire.id)}
                fromPos={wd.from}
                toPos={wd.to}
                showValues={showWireValues}
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
                  stroke="#ff9800"
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
              stroke="#2a7fff"
              strokeWidth={1.5}
              strokeDasharray="6,3"
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
              fill="rgba(42, 127, 255, 0.1)"
              stroke="#2a7fff"
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
                stroke="#4db8ff"
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
                stroke="#4db8ff"
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
              stroke="#e53935"
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
            />
          ))}

          {/* Text elements */}
          {textElements.map((elem) => (
            <TextElementView
              key={elem.id}
              elem={elem}
              isSelected={selectedIds.includes(elem.id)}
              isEditing={editingTextId === elem.id}
              onStartEdit={() => setEditingTextId(elem.id)}
            />
          ))}

          {/* Comments */}
          {showComments && comments.map((comment) => {
            const anchor = commentAnchors.get(comment.targetId);
            if (!anchor) return null;
            return (
              <CommentIconView
                key={comment.id}
                comment={comment}
                anchorX={anchor.x}
                anchorY={anchor.y}
                isExpanded={expandedCommentId === comment.id}
                onToggle={() => setExpandedCommentId(
                  expandedCommentId === comment.id ? null : comment.id
                )}
              />
            );
          })}
        </g>
      </svg>

      {/* Navigation arrow */}
      {navArrow && (
        <NavigationArrow direction={navArrow} onClick={handleNavigate} />
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

      {/* Zoom control — bottom-right corner */}
      <div className="zoom-control">
        <button
          className="zoom-btn"
          onClick={() => useStore.getState().setZoom(zoom - 0.1)}
          title="Zoom out"
        >
          −
        </button>
        <input
          type="range"
          className="zoom-slider"
          min={0.2}
          max={3}
          step={0.05}
          value={zoom}
          onChange={(e) => useStore.getState().setZoom(parseFloat(e.target.value))}
          title={`${Math.round(zoom * 100)}%`}
        />
        <button
          className="zoom-btn"
          onClick={() => useStore.getState().setZoom(zoom + 0.1)}
          title="Zoom in"
        >
          +
        </button>
        <button
          className="zoom-pct"
          onClick={() => useStore.getState().setZoom(1)}
          title="Reset to 100%"
        >
          {Math.round(zoom * 100)}%
        </button>
      </div>
    </div>
  );
}
