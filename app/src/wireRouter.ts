/**
 * Wire Routing Module — Cost-based A* pathfinding on a sparse orthogonal grid.
 *
 * Replaces the old strategy cascade (straight → L-path → rotated → detour)
 * with a unified algorithm that handles all rotation cases, port directions,
 * and layout configurations through a single codepath.
 *
 * OUTPUT CONTRACT:
 * Each routed wire is an array of {x, y} waypoints with this structure:
 *   [portPos, stubTip, ...routingPoints..., stubTip, portPos]
 *
 * The "routingPoints" in the middle are SIMPLIFIED — consecutive collinear
 * grid nodes are merged so each straight run is exactly one segment. This
 * is essential for the manual segment dragging in WireView (CircuitCanvas.tsx),
 * which treats each segment as one draggable handle.
 *
 * SEGMENT DRAGGING INTERACTION:
 * - Segments 0, 1 (source stub) and len-3, len-2 (target stub) are locked.
 * - Segments 2 through len-4 are user-draggable "routing" segments.
 * - See WireView in CircuitCanvas.tsx for the full dragging rules.
 */

import type { CircuitComponent } from './types';
import { getComponentSize } from './componentGeometry';

// ─── Constants ──────────────────────────────────────────────────────

const GRID_STEP = 16;        // Minimum spacing between parallel wire tracks (px)
const STUB_LENGTH = 12;      // Fixed stub length from port face (px)
const ELEMENT_MARGIN = 5;    // Clearance around element bounding boxes (px)
const MIN_CHANNEL_WIDTH = 16; // Minimum gap between routing channels

/** Radius of the crossing bump arc. Must match pathDWithBumps' R in
 *  CircuitCanvas.tsx. Two consumers: countCrossings weights crossings that
 *  land in a horizontal segment's bump-undrawable end band, and
 *  findDivergencePoints skips dots that would be drawn on top of an arc. */
const CROSSING_BUMP_RADIUS = 5;

// Cost weights — must satisfy: W_OVERLAP >> W_CROSSING >> W_BEND >> W_LENGTH
const W_LENGTH = 1.0;
const W_BEND = 50.0;
const W_CROSSING = 200.0;
const W_OVERLAP = 100000;

// Continuity bias: small discount on edges matching previous path (§7.2)
const CONTINUITY_DISCOUNT = -0.15; // 15% reduction for edges on the previous path

// ─── Types ──────────────────────────────────────────────────────────

export type Dir = 'N' | 'S' | 'E' | 'W';

interface Point {
  x: number;
  y: number;
}

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A node in the sparse routing grid */
interface GridNode {
  id: number;
  x: number;
  y: number;
}

/** An edge between two adjacent grid nodes */
interface GridEdge {
  id: number;
  a: number; // node id
  b: number; // node id
  length: number;
  /** Indices (into the expandedBounds/components array) of every component
   *  whose expanded bounds this edge passes through; empty = unobstructed.
   *  Attribution instead of a boolean so the search can exempt a wire's OWN
   *  endpoint components on the approach edges at its stub tips (see
   *  OWN-ENDPOINT EXEMPTION below). */
  blockedBy: number[];
}

/** Sparse routing grid built from element geometry */
interface RoutingGrid {
  nodes: GridNode[];
  /** Map from "x,y" to node id for fast lookup */
  nodeIndex: Map<string, number>;
  /** Adjacency: nodeId → list of {neighborId, edgeId} */
  adj: Map<number, { neighbor: number; edge: number }[]>;
  edges: GridEdge[];
}

/** Tracks which edges/segments are occupied by routed wires */
export interface OccupancyState {
  /** Set of edge IDs occupied by wires. Value = source port key (for fan-out sharing) */
  occupiedEdges: Map<number, string>;
  /** All routed wire segments for crossing detection and near-parallel
   *  avoidance (sourcePortKey exempts fan-out siblings, which legitimately
   *  share their trunk) */
  segments: { x1: number; y1: number; x2: number; y2: number; wireId: string; sourcePortKey: string }[];
  /** Bend points used by wires. Key = "x,y", value = wireId */
  occupiedBends: Map<string, string>;
}

/** A* search state */
interface SearchState {
  node: number;       // node id
  dir: Dir | null;    // arrival direction
  g: number;          // cost from start
  f: number;          // g + heuristic
  parent: SearchState | null;
}

// ─── Geometry Helpers ───────────────────────────────────────────────

// Obstacle bounds come from the SHARED rendered geometry (componentGeometry.ts)
// — the same table the canvas renders from and the layout oracle checks
// against. The router must never keep its own copy: a private table once let
// MEM default to phantom 75×70 bounds (rendered: 50×50), which blocked every
// edge at MEM.min's stub tip and forced all incident wires onto the
// obstacle-blind fallback.
//
// A wire's OWN endpoint components are not obstacles to it at its stub tips:
// the stub necessarily crosses its own component's margin (and, for inset
// ports like XOR's, the tip can sit inside the expanded bounds outright), so
// both the A* blocking model and the H2 revalidation exempt the wire's own
// source/target bounds on the approach — the same exemption the layout
// oracle applies to a wire's own stubs. Foreign components always block.

function getCompBounds(comp: CircuitComponent): Bounds {
  const { w, h } = getComponentSize(comp);
  const rotation = comp.rotation ?? 0;
  if (rotation === 0) {
    return { left: comp.x, top: comp.y, right: comp.x + w, bottom: comp.y + h };
  }
  const cx = comp.x + w / 2;
  const cy = comp.y + h / 2;
  const rad = (rotation * Math.PI) / 180;
  const cosA = Math.abs(Math.cos(rad));
  const sinA = Math.abs(Math.sin(rad));
  const halfW = (w * cosA + h * sinA) / 2;
  const halfH = (w * sinA + h * cosA) / 2;
  return { left: cx - halfW, top: cy - halfH, right: cx + halfW, bottom: cy + halfH };
}

/** Expand bounds by margin on all sides */
function expandBounds(b: Bounds, margin: number): Bounds {
  return {
    left: b.left - margin,
    top: b.top - margin,
    right: b.right + margin,
    bottom: b.bottom + margin,
  };
}

/** Indices of every bounds entry an axis-aligned segment passes through */
function boundsBlocking(
  x1: number, y1: number, x2: number, y2: number, allBounds: Bounds[]
): number[] {
  const blockedBy: number[] = [];
  for (let i = 0; i < allBounds.length; i++) {
    if (segmentIntersectsBounds(x1, y1, x2, y2, allBounds[i])) blockedBy.push(i);
  }
  return blockedBy;
}

/** Check if an axis-aligned segment intersects bounds */
function segmentIntersectsBounds(
  x1: number, y1: number, x2: number, y2: number, b: Bounds
): boolean {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);

  // No overlap if completely outside
  if (maxX <= b.left || minX >= b.right || maxY <= b.top || minY >= b.bottom) return false;

  // Horizontal segment
  if (Math.abs(y1 - y2) < 0.5) {
    return y1 > b.top && y1 < b.bottom && maxX > b.left && minX < b.right;
  }
  // Vertical segment
  if (Math.abs(x1 - x2) < 0.5) {
    return x1 > b.left && x1 < b.right && maxY > b.top && minY < b.bottom;
  }
  return false;
}

/** Get the direction from point A to point B (must be axis-aligned) */
function getDirection(ax: number, ay: number, bx: number, by: number): Dir | null {
  const dx = bx - ax;
  const dy = by - ay;
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? 'E' : 'W';
  } else if (Math.abs(dy) > Math.abs(dx)) {
    return dy > 0 ? 'S' : 'N';
  }
  return null;
}

function oppositeDir(d: Dir): Dir {
  switch (d) { case 'N': return 'S'; case 'S': return 'N'; case 'E': return 'W'; case 'W': return 'E'; }
}

/** Compute stub direction from component rotation and port side */
export function getStubDir(
  comp: CircuitComponent | undefined,
  portSide: 'left' | 'right'
): Dir {
  const rotation = comp?.rotation ?? 0;
  // Base direction: right ports face E, left ports face W
  const baseDir: Dir = portSide === 'right' ? 'E' : 'W';
  if (rotation === 0) return baseDir;
  // Rotate the direction
  const dirs: Dir[] = ['E', 'S', 'W', 'N'];
  const steps = Math.round(rotation / 90) % 4;
  const baseIdx = dirs.indexOf(baseDir);
  return dirs[(baseIdx + steps) % 4];
}

/** Get stub endpoint given port position and direction */
function getStubEndpoint(port: Point, dir: Dir): Point {
  switch (dir) {
    case 'E': return { x: port.x + STUB_LENGTH, y: port.y };
    case 'W': return { x: port.x - STUB_LENGTH, y: port.y };
    case 'N': return { x: port.x, y: port.y - STUB_LENGTH };
    case 'S': return { x: port.x, y: port.y + STUB_LENGTH };
  }
}

/** A crossing the canvas cannot draw a bump for counts as this many ordinary
 *  crossings. pathDWithBumps (CircuitCanvas.tsx) skips crossings within
 *  CROSSING_BUMP_RADIUS of the owning horizontal segment's ends, so a
 *  crossing landing in that dead band renders as a bare + — a VISUAL_VOCAB
 *  violation, much worse than a bumped crossing but not overlap-grade. */
const UNDRAWABLE_CROSSING_FACTOR = 10;

/** Count perpendicular crossings between a segment and existing segments,
 *  weighted: a crossing in the bump-undrawable band of an EXISTING
 *  horizontal segment (whose extent is known) counts
 *  UNDRAWABLE_CROSSING_FACTOR×. The mirror case — an existing vertical
 *  crossing near the ends of the run being routed — can't be judged
 *  mid-search (the final merged segment's extent isn't known yet), so it
 *  stays an ordinary crossing. */
function countCrossings(
  x1: number, y1: number, x2: number, y2: number,
  segments: OccupancyState['segments']
): number {
  let count = 0;
  const isHoriz = Math.abs(y1 - y2) < 0.5;
  const isVert = Math.abs(x1 - x2) < 0.5;

  for (const seg of segments) {
    const sHoriz = Math.abs(seg.y1 - seg.y2) < 0.5;
    const sVert = Math.abs(seg.x1 - seg.x2) < 0.5;

    if (isHoriz && sVert) {
      // horizontal new vs vertical existing
      const minHx = Math.min(x1, x2);
      const maxHx = Math.max(x1, x2);
      const minVy = Math.min(seg.y1, seg.y2);
      const maxVy = Math.max(seg.y1, seg.y2);
      if (seg.x1 > minHx + 1 && seg.x1 < maxHx - 1 && y1 > minVy + 1 && y1 < maxVy - 1) {
        count++;
      }
    } else if (isVert && sHoriz) {
      // vertical new vs horizontal existing (bump drawn on the horizontal wire)
      const minHx = Math.min(seg.x1, seg.x2);
      const maxHx = Math.max(seg.x1, seg.x2);
      const minVy = Math.min(y1, y2);
      const maxVy = Math.max(y1, y2);
      if (x1 > minHx + 1 && x1 < maxHx - 1 && seg.y1 > minVy + 1 && seg.y1 < maxVy - 1) {
        const drawable =
          x1 > minHx + CROSSING_BUMP_RADIUS && x1 < maxHx - CROSSING_BUMP_RADIUS;
        count += drawable ? 1 : UNDRAWABLE_CROSSING_FACTOR;
      }
    }
  }
  return count;
}

// ─── Grid Builder ───────────────────────────────────────────────────

function buildGrid(
  _components: CircuitComponent[], // kept for future obstacle avoidance
  portPositions: Point[],
  stubEndpoints: Point[],
  expandedBounds: Bounds[]
): RoutingGrid {
  // Collect grid line coordinates
  const xLines = new Set<number>();
  const yLines = new Set<number>();

  // From element bounding boxes (expanded by margin)
  for (const b of expandedBounds) {
    xLines.add(Math.round(b.left));
    xLines.add(Math.round(b.right));
    yLines.add(Math.round(b.top));
    yLines.add(Math.round(b.bottom));
  }

  // From port positions
  for (const p of portPositions) {
    xLines.add(Math.round(p.x));
    yLines.add(Math.round(p.y));
  }

  // From stub endpoints
  for (const p of stubEndpoints) {
    xLines.add(Math.round(p.x));
    yLines.add(Math.round(p.y));
  }

  // Add routing channels between adjacent lines
  const sortedX = Array.from(xLines).sort((a, b) => a - b);
  const sortedY = Array.from(yLines).sort((a, b) => a - b);

  const channelXs: number[] = [];
  for (let i = 0; i < sortedX.length - 1; i++) {
    const gap = sortedX[i + 1] - sortedX[i];
    if (gap > MIN_CHANNEL_WIDTH * 2) {
      // Add channels in the gap
      const numChannels = Math.max(1, Math.floor(gap / MIN_CHANNEL_WIDTH) - 1);
      const spacing = gap / (numChannels + 1);
      for (let j = 1; j <= numChannels; j++) {
        channelXs.push(Math.round(sortedX[i] + spacing * j));
      }
    } else if (gap > MIN_CHANNEL_WIDTH) {
      channelXs.push(Math.round((sortedX[i] + sortedX[i + 1]) / 2));
    }
  }

  const channelYs: number[] = [];
  for (let i = 0; i < sortedY.length - 1; i++) {
    const gap = sortedY[i + 1] - sortedY[i];
    if (gap > MIN_CHANNEL_WIDTH * 2) {
      const numChannels = Math.max(1, Math.floor(gap / MIN_CHANNEL_WIDTH) - 1);
      const spacing = gap / (numChannels + 1);
      for (let j = 1; j <= numChannels; j++) {
        channelYs.push(Math.round(sortedY[i] + spacing * j));
      }
    } else if (gap > MIN_CHANNEL_WIDTH) {
      channelYs.push(Math.round((sortedY[i] + sortedY[i + 1]) / 2));
    }
  }

  for (const x of channelXs) xLines.add(x);
  for (const y of channelYs) yLines.add(y);

  // Add perimeter lines outside all elements for routing around
  if (expandedBounds.length > 0) {
    const globalLeft = Math.min(...expandedBounds.map(b => b.left)) - GRID_STEP * 2;
    const globalRight = Math.max(...expandedBounds.map(b => b.right)) + GRID_STEP * 2;
    const globalTop = Math.min(...expandedBounds.map(b => b.top)) - GRID_STEP * 2;
    const globalBottom = Math.max(...expandedBounds.map(b => b.bottom)) + GRID_STEP * 2;
    xLines.add(Math.round(globalLeft));
    xLines.add(Math.round(globalRight));
    yLines.add(Math.round(globalTop));
    yLines.add(Math.round(globalBottom));
  }

  // Build nodes at every intersection
  const finalXs = Array.from(xLines).sort((a, b) => a - b);
  const finalYs = Array.from(yLines).sort((a, b) => a - b);

  const nodes: GridNode[] = [];
  const nodeIndex = new Map<string, number>();
  let nodeId = 0;

  for (const y of finalYs) {
    for (const x of finalXs) {
      const key = `${x},${y}`;
      if (!nodeIndex.has(key)) {
        nodes.push({ id: nodeId, x, y });
        nodeIndex.set(key, nodeId);
        nodeId++;
      }
    }
  }

  // Build edges between adjacent nodes on the same grid line
  const edges: GridEdge[] = [];
  const adj = new Map<number, { neighbor: number; edge: number }[]>();
  let edgeId = 0;

  // Initialize adjacency lists
  for (const node of nodes) {
    adj.set(node.id, []);
  }

  // Horizontal edges (same Y, adjacent X)
  for (const y of finalYs) {
    let prevId: number | undefined;
    for (const x of finalXs) {
      const key = `${x},${y}`;
      const nid = nodeIndex.get(key);
      if (nid === undefined) continue;
      if (prevId !== undefined) {
        const prevNode = nodes[prevId];
        const currNode = nodes[nid];
        const length = Math.abs(currNode.x - prevNode.x);

        // Record which element bounds this edge passes through
        const blockedBy = boundsBlocking(
          prevNode.x, prevNode.y, currNode.x, currNode.y, expandedBounds
        );

        const eid = edgeId++;
        edges.push({ id: eid, a: prevId, b: nid, length, blockedBy });
        adj.get(prevId)!.push({ neighbor: nid, edge: eid });
        adj.get(nid)!.push({ neighbor: prevId, edge: eid });
      }
      prevId = nid;
    }
  }

  // Vertical edges (same X, adjacent Y)
  for (const x of finalXs) {
    let prevId: number | undefined;
    for (const y of finalYs) {
      const key = `${x},${y}`;
      const nid = nodeIndex.get(key);
      if (nid === undefined) continue;
      if (prevId !== undefined) {
        const prevNode = nodes[prevId];
        const currNode = nodes[nid];
        const length = Math.abs(currNode.y - prevNode.y);

        const blockedBy = boundsBlocking(
          prevNode.x, prevNode.y, currNode.x, currNode.y, expandedBounds
        );

        const eid = edgeId++;
        edges.push({ id: eid, a: prevId, b: nid, length, blockedBy });
        adj.get(prevId)!.push({ neighbor: nid, edge: eid });
        adj.get(nid)!.push({ neighbor: prevId, edge: eid });
      }
      prevId = nid;
    }
  }

  return { nodes, nodeIndex, adj, edges };
}

/** Insert a temporary node at a position that might not be on the grid */
function ensureNodeOnGrid(grid: RoutingGrid, p: Point, expandedBounds: Bounds[]): number {
  const rx = Math.round(p.x);
  const ry = Math.round(p.y);
  const key = `${rx},${ry}`;

  const existing = grid.nodeIndex.get(key);
  if (existing !== undefined) return existing;

  // Create new node
  const newId = grid.nodes.length;
  grid.nodes.push({ id: newId, x: rx, y: ry });
  grid.nodeIndex.set(key, newId);
  grid.adj.set(newId, []);

  // Connect to nearest nodes on same X and Y lines
  // Find closest nodes in each cardinal direction
  const candidates: { nodeId: number; dist: number; dir: 'h' | 'v' }[] = [];

  for (const node of grid.nodes) {
    if (node.id === newId) continue;
    if (node.y === ry && node.x !== rx) {
      candidates.push({ nodeId: node.id, dist: Math.abs(node.x - rx), dir: 'h' });
    }
    if (node.x === rx && node.y !== ry) {
      candidates.push({ nodeId: node.id, dist: Math.abs(node.y - ry), dir: 'v' });
    }
  }

  // For each direction, find the closest node and check if there's no node between
  const directions = [
    { filter: (n: GridNode) => n.y === ry && n.x < rx, sort: (a: GridNode, b: GridNode) => b.x - a.x }, // West
    { filter: (n: GridNode) => n.y === ry && n.x > rx, sort: (a: GridNode, b: GridNode) => a.x - b.x }, // East
    { filter: (n: GridNode) => n.x === rx && n.y < ry, sort: (a: GridNode, b: GridNode) => b.y - a.y }, // North
    { filter: (n: GridNode) => n.x === rx && n.y > ry, sort: (a: GridNode, b: GridNode) => a.y - b.y }, // South
  ];

  for (const { filter, sort } of directions) {
    const filtered = grid.nodes.filter(n => n.id !== newId && filter(n));
    filtered.sort(sort);
    if (filtered.length > 0) {
      const nearest = filtered[0];
      const length = Math.abs(nearest.x - rx) + Math.abs(nearest.y - ry);
      const blockedBy = boundsBlocking(rx, ry, nearest.x, nearest.y, expandedBounds);

      const eid = grid.edges.length;
      grid.edges.push({ id: eid, a: newId, b: nearest.id, length, blockedBy });
      grid.adj.get(newId)!.push({ neighbor: nearest.id, edge: eid });
      grid.adj.get(nearest.id)!.push({ neighbor: newId, edge: eid });
    }
  }

  return newId;
}

// ─── A* Pathfinder ──────────────────────────────────────────────────

/** Simple binary min-heap for A* open set */
class MinHeap {
  private data: SearchState[] = [];

  get size() { return this.data.length; }

  push(state: SearchState) {
    this.data.push(state);
    this._bubbleUp(this.data.length - 1);
  }

  pop(): SearchState | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      this._sinkDown(0);
    }
    return top;
  }

  private _bubbleUp(i: number) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.data[i].f < this.data[parent].f) {
        [this.data[i], this.data[parent]] = [this.data[parent], this.data[i]];
        i = parent;
      } else break;
    }
  }

  private _sinkDown(i: number) {
    const n = this.data.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && this.data[left].f < this.data[smallest].f) smallest = left;
      if (right < n && this.data[right].f < this.data[smallest].f) smallest = right;
      if (smallest === i) break;
      [this.data[i], this.data[smallest]] = [this.data[smallest], this.data[i]];
      i = smallest;
    }
  }
}

/** Set of segment keys from a previous path, for continuity bias matching */
function buildPreviousPathEdges(previousPath: Point[] | undefined): Set<string> {
  const edges = new Set<string>();
  if (!previousPath || previousPath.length < 2) return edges;
  for (let i = 0; i < previousPath.length - 1; i++) {
    const a = previousPath[i];
    const b = previousPath[i + 1];
    // Normalized key: smaller coordinate first
    const ax = Math.round(a.x), ay = Math.round(a.y);
    const bx = Math.round(b.x), by = Math.round(b.y);
    const key = ax < bx || (ax === bx && ay < by)
      ? `${ax},${ay}-${bx},${by}`
      : `${bx},${by}-${ax},${ay}`;
    edges.add(key);
  }
  return edges;
}

/** Check if a grid edge matches any segment from the previous path (within tolerance) */
function edgeMatchesPreviousPath(
  ax: number, ay: number, bx: number, by: number,
  prevEdges: Set<string>
): boolean {
  const rax = Math.round(ax), ray = Math.round(ay);
  const rbx = Math.round(bx), rby = Math.round(by);
  const key = rax < rbx || (rax === rbx && ray < rby)
    ? `${rax},${ray}-${rbx},${rby}`
    : `${rbx},${rby}-${rax},${ray}`;
  return prevEdges.has(key);
}

/** A wire's own endpoint components, as indices into the expandedBounds
 *  array (-1 = unknown). See OWN-ENDPOINT EXEMPTION in aStarSearch. */
export interface OwnComponents {
  sourceIdx: number;
  targetIdx: number;
}

function aStarSearch(
  grid: RoutingGrid,
  startNodeId: number,
  goalNodeId: number,
  startDir: Dir,       // direction the stub is pointing (first edge must continue this way)
  goalDir: Dir,        // direction the stub is pointing at goal (must arrive from opposite)
  occupancy: OccupancyState,
  sourcePortKey: string, // for fan-out: wires from same port can share edges
  ownStubs?: { x1: number; y1: number; x2: number; y2: number }[], // own stub segments to avoid overlapping
  previousPath?: Point[], // previous path for continuity bias (§7.2)
  ownComps?: OwnComponents, // own-endpoint exemption at the stub-tip nodes
  avoidPoints?: Point[] // conflict feedback from validation: overlap-priced locations
): Point[] | null {
  const goalNode = grid.nodes[goalNodeId];
  const startNode = grid.nodes[startNodeId];
  if (!goalNode || !startNode) return null;

  // Iteration cap: a safety valve against the degenerate case (a goal whose
  // only approach costs W_OVERLAP turns A* into full-grid Dijkstra), NOT a
  // path-length limit — so it must scale with the search space. A flat cap
  // silently dooms honest long paths on large circuits: the reference HW3
  // fixtures build ~30k-node grids where real routes need ~7k iterations,
  // starving under the old flat 5000.
  const maxIterations = Math.max(5000, grid.nodes.length);

  const requiredArrivalDir = goalDir; // Must arrive heading in goalDir direction (into the stub)
  const prevEdges = buildPreviousPathEdges(previousPath);
  const nearIndex = buildNearParallelIndex(occupancy.segments, sourcePortKey);

  const heuristic = (nodeId: number): number => {
    const n = grid.nodes[nodeId];
    return (Math.abs(n.x - goalNode.x) + Math.abs(n.y - goalNode.y)) * W_LENGTH;
  };

  const open = new MinHeap();
  // Key: "nodeId,dir" → best g cost seen
  const visited = new Map<string, number>();

  const initState: SearchState = {
    node: startNodeId,
    dir: startDir,
    g: 0,
    f: heuristic(startNodeId),
    parent: null,
  };
  open.push(initState);

  let iterations = 0;

  while (open.size > 0 && iterations < maxIterations) {
    iterations++;
    const current = open.pop()!;

    // Goal check
    if (current.node === goalNodeId) {
      // Verify arrival direction: we must be arriving in the direction the goal stub expects
      if (current.dir === requiredArrivalDir) {
        // Reconstruct path
        const path: Point[] = [];
        let s: SearchState | null = current;
        while (s) {
          const n = grid.nodes[s.node];
          path.unshift({ x: n.x, y: n.y });
          s = s.parent;
        }
        return path;
      }
      // Wrong direction — don't terminate, keep searching
    }

    const visitKey = `${current.node},${current.dir}`;
    const prevG = visited.get(visitKey);
    if (prevG !== undefined && prevG <= current.g) continue;
    visited.set(visitKey, current.g);

    const neighbors = grid.adj.get(current.node);
    if (!neighbors) continue;

    for (const { neighbor, edge } of neighbors) {
      const e = grid.edges[edge];
      // OWN-ENDPOINT EXEMPTION: a wire's landing at its own source/target is
      // legitimate geometry — the same rule the layout oracle applies when it
      // exempts a wire's own stubs from body-pass-through (layoutCheck.ts).
      // Inset ports (XOR's curved face pulls left ports 11.25px inward) put
      // the stub tip INSIDE the component's own expanded bounds, so without
      // this exemption every edge incident on the goal node is blocked and
      // the wire is born unreachable. Scope is deliberately narrow: only
      // edges INCIDENT to this wire's start/goal stub-tip nodes, and only
      // for the matching endpoint component — a path still can't cut through
      // its own component's body elsewhere, and foreign components block the
      // approach edges as before (the doomed-wire tripwire in routerCheck).
      if (e.blockedBy.length > 0) {
        const incidentStart = e.a === startNodeId || e.b === startNodeId;
        const incidentGoal = e.a === goalNodeId || e.b === goalNodeId;
        const passable = ownComps !== undefined && e.blockedBy.every((ci) =>
          (incidentStart && ci === ownComps.sourceIdx) ||
          (incidentGoal && ci === ownComps.targetIdx)
        );
        if (!passable) continue;
      }

      const neighborNode = grid.nodes[neighbor];
      const currentNode = grid.nodes[current.node];

      // Determine direction of this edge
      const edgeDir = getDirection(currentNode.x, currentNode.y, neighborNode.x, neighborNode.y);
      if (!edgeDir) continue;

      // First move must match stub direction
      if (current.parent === null && edgeDir !== startDir) continue;

      // Compute costs
      let cost = e.length * W_LENGTH;

      // Bend cost
      if (current.dir !== null && current.dir !== edgeDir) {
        cost += W_BEND;
        // Penalize bends at nodes already used as bend points by other wires
        // Use a moderate cost — less than overlap to avoid trading shared bends for overlapping segments
        const bendKey = `${currentNode.x},${currentNode.y}`;
        if (occupancy.occupiedBends.has(bendKey)) {
          cost += W_BEND * 4;
        }
      }

      // Overlap cost — same grid edge reused by a different source port
      const occupantPort = occupancy.occupiedEdges.get(edge);
      if (occupantPort !== undefined && occupantPort !== sourcePortKey) {
        cost += W_OVERLAP;
      } else if (edgeNearOverlaps(nearIndex,
                                  currentNode.x, currentNode.y,
                                  neighborNode.x, neighborNode.y)) {
        // Near-parallel overlap (the oracle's collinear-overlap rule): a
        // track within NEAR_PARALLEL_TOL of a DIFFERENT source's parallel
        // segment renders as one visually-merged wire — the same offense as
        // exact overlap, so the same cost. Fan-out siblings are exempt
        // (shared trunks are legitimate).
        cost += W_OVERLAP;
      }

      // Self-stub overlap cost: penalize edges that overlap with this wire's own stubs
      if (ownStubs) {
        for (const stub of ownStubs) {
          if (segmentsOverlap(currentNode.x, currentNode.y, neighborNode.x, neighborNode.y,
                              stub.x1, stub.y1, stub.x2, stub.y2)) {
            cost += W_OVERLAP;
            break;
          }
        }
      }

      // Crossing cost
      const crossings = countCrossings(
        currentNode.x, currentNode.y,
        neighborNode.x, neighborNode.y,
        occupancy.segments
      );
      cost += crossings * W_CROSSING;

      // Conflict feedback (rip-up-and-reroute memory): the validation pass
      // pinpointed defects at these exact locations on this wire's previous
      // path — defects the edge-local cost model cannot see (e.g. a bump-
      // undrawable crossing sitting exactly on a grid-line intersection, at
      // the blind boundary of the fragment-interior tests). Price any edge
      // passing through such a point like an overlap so the re-route
      // actually moves off it instead of deterministically re-picking it.
      if (avoidPoints) {
        for (const p of avoidPoints) {
          const onEdge =
            Math.min(currentNode.x, neighborNode.x) - 1 < p.x &&
            p.x < Math.max(currentNode.x, neighborNode.x) + 1 &&
            Math.min(currentNode.y, neighborNode.y) - 1 < p.y &&
            p.y < Math.max(currentNode.y, neighborNode.y) + 1;
          if (onEdge) {
            cost += W_OVERLAP;
            break;
          }
        }
      }

      // Continuity bonus: discount edges that match the previous path (§7.2)
      if (prevEdges.size > 0) {
        const lengthCost = e.length * W_LENGTH;
        if (edgeMatchesPreviousPath(currentNode.x, currentNode.y, neighborNode.x, neighborNode.y, prevEdges)) {
          cost += lengthCost * CONTINUITY_DISCOUNT; // negative = bonus
        }
      }

      const newG = current.g + cost;
      const nKey = `${neighbor},${edgeDir}`;
      const prevNG = visited.get(nKey);
      if (prevNG !== undefined && prevNG <= newG) continue;

      open.push({
        node: neighbor,
        dir: edgeDir,
        g: newG,
        f: newG + heuristic(neighbor),
        parent: current,
      });
    }
  }

  return null; // No path found
}

// ─── Fallback: simple L-path when A* fails ──────────────────────────

// Instrumentation: how many times the obstacle-blind fallback fired since the
// last reset. The fallback is the router admitting defeat — tools/routerCheck.ts
// pins a budget on it across the reference fixtures so world-model regressions
// (like the phantom MEM 75×70 bounds this counter was added to catch) show up
// as a failing check instead of silently ugly layouts.
let fallbackCount = 0;
let fallbackWireIds: string[] = [];

export function resetFallbackCount(): void {
  fallbackCount = 0;
  fallbackWireIds = [];
}

export function getFallbackCount(): number {
  return fallbackCount;
}

/** Wire ids that took the fallback since the last reset (one entry per
 *  invocation, so a wire re-failing in validation rounds appears repeatedly).
 *  Diagnostic companion to getFallbackCount — routerCheck prints these so a
 *  budget regression names its wires. */
export function getFallbackWireIds(): string[] {
  return [...fallbackWireIds];
}

function fallbackPath(
  srcStub: Point, dstStub: Point, srcDir: Dir, dstDir: Dir
): Point[] {
  const EXTEND = 20; // extend beyond stub in stub direction before turning

  // Compute extension points that respect stub direction
  const srcExt = { ...srcStub };
  if (srcDir === 'E') srcExt.x = Math.max(srcStub.x + EXTEND, dstStub.x + EXTEND);
  else if (srcDir === 'W') srcExt.x = Math.min(srcStub.x - EXTEND, dstStub.x - EXTEND);
  else if (srcDir === 'S') srcExt.y = Math.max(srcStub.y + EXTEND, dstStub.y + EXTEND);
  else if (srcDir === 'N') srcExt.y = Math.min(srcStub.y - EXTEND, dstStub.y - EXTEND);

  const dstExt = { ...dstStub };
  if (dstDir === 'E') dstExt.x = Math.max(dstStub.x + EXTEND, srcStub.x + EXTEND);
  else if (dstDir === 'W') dstExt.x = Math.min(dstStub.x - EXTEND, srcStub.x - EXTEND);
  else if (dstDir === 'S') dstExt.y = Math.max(dstStub.y + EXTEND, srcStub.y + EXTEND);
  else if (dstDir === 'N') dstExt.y = Math.min(dstStub.y - EXTEND, srcStub.y - EXTEND);

  const srcHoriz = srcDir === 'E' || srcDir === 'W';
  const dstHoriz = dstDir === 'E' || dstDir === 'W';

  // Check if direct midpoint path respects stub directions
  const midX = (srcStub.x + dstStub.x) / 2;
  const midY = (srcStub.y + dstStub.y) / 2;
  const srcMidOk = (srcDir === 'E' && midX >= srcStub.x) || (srcDir === 'W' && midX <= srcStub.x)
    || (srcDir === 'S' && midY >= srcStub.y) || (srcDir === 'N' && midY <= srcStub.y);
  const dstMidOk = (dstDir === 'E' && midX >= dstStub.x) || (dstDir === 'W' && midX <= dstStub.x)
    || (dstDir === 'S' && midY >= dstStub.y) || (dstDir === 'N' && midY <= dstStub.y);

  if (srcMidOk && dstMidOk) {
    // Simple midpoint path works without violating stub directions
    if (srcHoriz && dstHoriz) {
      return [srcStub, { x: midX, y: srcStub.y }, { x: midX, y: dstStub.y }, dstStub];
    } else if (!srcHoriz && !dstHoriz) {
      return [srcStub, { x: srcStub.x, y: midY }, { x: dstStub.x, y: midY }, dstStub];
    } else if (srcHoriz) {
      return [srcStub, { x: dstStub.x, y: srcStub.y }, dstStub];
    } else {
      return [srcStub, { x: srcStub.x, y: dstStub.y }, dstStub];
    }
  }

  // Stub directions conflict with direct path — extend out first, then route
  if (srcHoriz && dstHoriz) {
    return [srcStub, srcExt, { x: srcExt.x, y: dstStub.y }, dstStub];
  } else if (!srcHoriz && !dstHoriz) {
    return [srcStub, srcExt, { x: dstStub.x, y: srcExt.y }, dstStub];
  } else if (srcHoriz) {
    return [srcStub, srcExt, { x: srcExt.x, y: dstStub.y }, dstStub];
  } else {
    return [srcStub, srcExt, { x: dstStub.x, y: srcExt.y }, dstStub];
  }
}

// ─── Path Simplification ────────────────────────────────────────────

/**
 * Merge consecutive collinear points so each straight run is one segment.
 *
 * The A* search returns a waypoint at every grid node it visits, so a long
 * horizontal run through 5 grid nodes becomes 5 tiny segments. This function
 * collapses those into a single segment from the first to the last point on
 * the same axis.
 *
 * WHY THIS MATTERS FOR MANUAL EDITING:
 * The WireView UI lets users drag entire straight segments (bend-to-bend).
 * If we don't simplify, each grid-edge fragment shows up as its own drag
 * handle — too small to grab and visually confusing. After simplification,
 * each segment in the path is a meaningful straight run from one turn to
 * the next, exactly what the user expects to drag.
 */
function simplifyPath(path: Point[]): Point[] {
  if (path.length <= 2) return path;

  const result: Point[] = [path[0]];

  for (let i = 1; i < path.length - 1; i++) {
    const prev = result[result.length - 1];
    const curr = path[i];
    const next = path[i + 1];

    // Check if prev → curr → next are collinear (all on same horizontal or vertical line)
    const prevToCurrHoriz = Math.abs(prev.y - curr.y) < 0.5;
    const currToNextHoriz = Math.abs(curr.y - next.y) < 0.5;
    const prevToCurrVert = Math.abs(prev.x - curr.x) < 0.5;
    const currToNextVert = Math.abs(curr.x - next.x) < 0.5;

    const collinearH = prevToCurrHoriz && currToNextHoriz;
    const collinearV = prevToCurrVert && currToNextVert;

    // If collinear, skip this intermediate point — the segment will extend
    // from `prev` directly to a later point on the same line
    if (collinearH || collinearV) continue;

    result.push(curr);
  }

  // Always include the last point
  result.push(path[path.length - 1]);

  return result;
}

// ─── Wire Router (Orchestrator) ─────────────────────────────────────

export interface WireRouteInput {
  wireId: string;
  sourceComp: CircuitComponent;
  targetComp: CircuitComponent;
  sourcePortId: string;
  targetPortId: string;
  sourcePortSide: 'left' | 'right';
  targetPortSide: 'left' | 'right';
  sourcePos: Point;
  targetPos: Point;
  sourcePortKey: string; // "compId:portId" for fan-out grouping
}

export interface WireRouteResult {
  wireId: string;
  points: Point[];
  crossings?: Point[]; // crossing points for bridge/hop rendering (§8)
}

/**
 * Route all wires using cost-based A* on a sparse orthogonal grid.
 *
 * @param inputs - Wire routing inputs, pre-grouped by source port (fan-out wires consecutive)
 * @param components - All circuit components
 * @param previousPaths - Optional map of wireId → previous path for hysteresis
 * @returns Array of routed wire results
 */
export function routeAllWires(
  inputs: WireRouteInput[],
  components: CircuitComponent[],
  previousPaths?: Map<string, Point[]>
): WireRouteResult[] {
  if (inputs.length === 0) return [];

  // Compute expanded bounds for all components
  const expandedBounds = components.map(c => expandBounds(getCompBounds(c), ELEMENT_MARGIN));

  // Component id → index into components/expandedBounds, for the
  // own-endpoint exemption (a wire may touch its own endpoints' bounds
  // at its stub tips; see aStarSearch).
  const compIndexById = new Map<string, number>();
  components.forEach((c, i) => compIndexById.set(c.id, i));
  const ownCompsFor = (input: WireRouteInput): OwnComponents => ({
    sourceIdx: compIndexById.get(input.sourceComp.id) ?? -1,
    targetIdx: compIndexById.get(input.targetComp.id) ?? -1,
  });

  // Collect all port positions and stub endpoints for grid construction
  const allPortPositions: Point[] = [];
  const allStubEndpoints: Point[] = [];
  const wireStubs: { srcStub: Point; dstStub: Point; srcDir: Dir; dstDir: Dir }[] = [];

  for (const input of inputs) {
    const srcDir = getStubDir(input.sourceComp, input.sourcePortSide);
    const dstDir = getStubDir(input.targetComp, input.targetPortSide);
    const srcStub = getStubEndpoint(input.sourcePos, srcDir);
    const dstStub = getStubEndpoint(input.targetPos, dstDir);

    allPortPositions.push(input.sourcePos, input.targetPos);
    allStubEndpoints.push(srcStub, dstStub);
    wireStubs.push({ srcStub, dstStub, srcDir, dstDir });
  }

  // Build the routing grid
  const grid = buildGrid(components, allPortPositions, allStubEndpoints, expandedBounds);

  // Initialize occupancy
  const occupancy: OccupancyState = {
    occupiedEdges: new Map(),
    segments: [],
    occupiedBends: new Map(),
  };

  // Sort inputs: shorter wires first (by Manhattan distance), but keep fan-out groups together
  const indexedInputs = inputs.map((input, i) => ({
    input,
    stubs: wireStubs[i],
    index: i,
    manhattan: Math.abs(input.sourcePos.x - input.targetPos.x) +
               Math.abs(input.sourcePos.y - input.targetPos.y),
  }));

  // Group by source port key, sort groups by shortest wire in group
  const groups = new Map<string, typeof indexedInputs>();
  for (const item of indexedInputs) {
    const key = item.input.sourcePortKey;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  // Sort within groups by manhattan, then sort groups by their shortest wire
  const sortedGroups = Array.from(groups.values()).map(group => {
    group.sort((a, b) => a.manhattan - b.manhattan);
    return group;
  });
  sortedGroups.sort((a, b) => a[0].manhattan - b[0].manhattan);

  const results: WireRouteResult[] = new Array(inputs.length);

  for (const group of sortedGroups) {
    for (const item of group) {
      const { input, stubs } = item;
      const { srcStub, dstStub, srcDir, dstDir } = stubs;

      // Ensure stub endpoints are on grid
      const startNodeId = ensureNodeOnGrid(grid, srcStub, expandedBounds);
      const goalNodeId = ensureNodeOnGrid(grid, dstStub, expandedBounds);

      // Extract previous inner path for continuity bias (§7.2)
      let prevInnerPath: Point[] | undefined;
      if (previousPaths) {
        const prevPath = previousPaths.get(input.wireId);
        if (prevPath && prevPath.length > 2) {
          prevInnerPath = prevPath.slice(1, prevPath.length - 1);
        }
      }

      // Build own stub segments for self-overlap avoidance
      const ownStubs = [
        { x1: input.sourcePos.x, y1: input.sourcePos.y, x2: srcStub.x, y2: srcStub.y },
        { x1: dstStub.x, y1: dstStub.y, x2: input.targetPos.x, y2: input.targetPos.y },
      ];

      // Run A* with continuity bias toward previous path
      let pathPoints = aStarSearch(
        grid, startNodeId, goalNodeId,
        srcDir, oppositeDir(dstDir),
        occupancy, input.sourcePortKey,
        ownStubs,
        prevInnerPath,
        ownCompsFor(input)
      );

      // Fallback if A* fails
      if (!pathPoints || pathPoints.length === 0) {
        fallbackCount++;
        fallbackWireIds.push(input.wireId);
        pathPoints = fallbackPath(srcStub, dstStub, srcDir, dstDir);
      }

      // Prepend source stub, append destination stub
      const fullPath = [
        input.sourcePos,
        srcStub,
        ...pathPoints,
        dstStub,
        input.targetPos,
      ];

      // Update occupancy with the UNSIMPLIFIED path so that every grid edge
      // along the route gets marked as occupied. (Simplified paths merge
      // collinear grid nodes, so their endpoints don't map back to individual
      // grid edges — leaving occupiedEdges empty and allowing later wires to
      // overlap.)
      updateOccupancy(grid, fullPath, occupancy, input.sourcePortKey, input.wireId);

      // Simplify path: merge collinear consecutive points so that each
      // straight run (horizontal or vertical) becomes exactly ONE segment.
      // This is critical for manual wire editing — the UI exposes whole
      // straight segments as draggable handles, not individual grid edges.
      // Without this, the A* grid nodes would fragment a straight run into
      // many tiny segments that are individually useless to drag.
      const dedupedPath = simplifyPath(fullPath);

      results[item.index] = { wireId: input.wireId, points: dedupedPath };
    }
  }

  // ─── Validation pass (§7.1): check all wires for hard constraint violations ───
  // Re-route any wire whose path violates H1 (overlap), H2 (element crossing),
  // H3 (shared bend), or H4 (bump-undrawable crossing). Cap at 2 rounds to
  // bound computation time. H4 conflicts accumulate per wire across rounds
  // and feed back into the re-route as overlap-priced avoid points
  // (rip-up-and-reroute memory — see aStarSearch).
  const avoidByWire = new Map<string, Point[]>();
  for (let round = 0; round < 2; round++) {
    let anyRerouted = false;
    for (const item of indexedInputs) {
      const result = results[item.index];
      if (!result) continue;

      const path = result.points;
      // Check H2: does the path pass through any element bounds? The wire's
      // own landing at its endpoints is exempt (same rule as the A* search
      // and the layout oracle): the first simplified segment leaves the
      // source port and the last arrives at the target port, and each always
      // crosses its own component's margin sliver — that's the stub doing
      // its job, not a violation. Without the exemption EVERY wire re-trips
      // H2 and the whole circuit is silently rerouted each validation round.
      const ownComps = ownCompsFor(item.input);
      const h2Violation = isPathBlockedByBounds(path, expandedBounds, ownComps);

      // Check H1: does the path overlap any other wire's segment? Same rule
      // as the oracle: near-parallel counts (within NEAR_PARALLEL_TOL), and
      // fan-out siblings from the same source port are exempt — their shared
      // trunk is legitimate, not an overlap (without that exemption every
      // fan-out wire re-trips H1 and gets futilely rerouted each round).
      // Also check if the inner path overlaps its own stubs (self-stub overlap).
      let h1Violation = false;
      const selfStubs = [
        { x1: path[0].x, y1: path[0].y, x2: path[1].x, y2: path[1].y },
        { x1: path[path.length - 2].x, y1: path[path.length - 2].y, x2: path[path.length - 1].x, y2: path[path.length - 1].y },
      ];
      for (let i = 0; i < path.length - 1 && !h1Violation; i++) {
        const a = path[i], b = path[i + 1];
        // Check against other wires (different source port only)
        for (const seg of occupancy.segments) {
          if (seg.wireId === item.input.wireId) continue;
          if (seg.sourcePortKey === item.input.sourcePortKey) continue;
          if (segmentsNearOverlap(a.x, a.y, b.x, b.y, seg.x1, seg.y1, seg.x2, seg.y2)) {
            h1Violation = true;
            break;
          }
        }
        // Check inner segments against own stubs (skip stub segments themselves)
        if (!h1Violation && i >= 1 && i < path.length - 2) {
          for (const stub of selfStubs) {
            if (segmentsOverlap(a.x, a.y, b.x, b.y, stub.x1, stub.y1, stub.x2, stub.y2)) {
              h1Violation = true;
              break;
            }
          }
        }
      }

      // Check H3: does this wire share any bend points with other wires?
      let h3Violation = false;
      for (let i = 1; i < path.length - 1 && !h3Violation; i++) {
        const prev = path[i - 1], curr = path[i], next = path[i + 1];
        const d1h = Math.abs(curr.x - prev.x) > 0.5;
        const d2h = Math.abs(next.x - curr.x) > 0.5;
        if (d1h !== d2h) {
          // This is a bend point — check if another wire also bends here
          const bendKey = `${Math.round(curr.x)},${Math.round(curr.y)}`;
          const occupant = occupancy.occupiedBends.get(bendKey);
          if (occupant && occupant !== item.input.wireId) {
            h3Violation = true;
          }
        }
      }

      // Check H4: bump-undrawable crossings. pathDWithBumps draws the bump on
      // the HORIZONTAL wire and skips crossings within CROSSING_BUMP_RADIUS
      // of that segment's ends — a crossing in the dead band renders as a
      // bare +. The vertical partner is the wire that can move (its re-route
      // sees the weighted crossing cost, and only it can be judged against
      // the horizontal's now-known extent), so each wire checks its own
      // vertical segments against the other wires' SIMPLIFIED paths (real
      // segment ends, not grid fragments — occupancy holds fragments).
      let h4Violation = false;
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i], b = path[i + 1];
        if (Math.abs(a.x - b.x) >= 0.5 || Math.abs(a.y - b.y) < 0.5) continue; // vertical only
        const minVy = Math.min(a.y, b.y), maxVy = Math.max(a.y, b.y);
        for (const other of results) {
          if (!other || other.wireId === item.input.wireId) continue;
          const op = other.points;
          for (let j = 0; j < op.length - 1; j++) {
            const oa = op[j], ob = op[j + 1];
            if (Math.abs(oa.y - ob.y) >= 0.5) continue; // horizontal only
            const minHx = Math.min(oa.x, ob.x), maxHx = Math.max(oa.x, ob.x);
            if (a.x > minHx + 1 && a.x < maxHx - 1 && oa.y > minVy + 1 && oa.y < maxVy - 1 &&
                (a.x <= minHx + CROSSING_BUMP_RADIUS || a.x >= maxHx - CROSSING_BUMP_RADIUS)) {
              h4Violation = true;
              // Remember the exact conflict point so the re-route is priced
              // off it (the cost model alone can't see boundary crossings).
              const avoid = avoidByWire.get(item.input.wireId) ?? [];
              avoid.push({ x: a.x, y: oa.y });
              avoidByWire.set(item.input.wireId, avoid);
            }
          }
        }
      }

      if (!h2Violation && !h1Violation && !h3Violation && !h4Violation) continue;

      // Remove this wire's occupancy before re-routing
      removeOccupancy(occupancy, item.input.wireId);

      const { srcStub, dstStub, srcDir, dstDir } = item.stubs;
      const startNodeId = ensureNodeOnGrid(grid, srcStub, expandedBounds);
      const goalNodeId = ensureNodeOnGrid(grid, dstStub, expandedBounds);

      const reOwnStubs = [
        { x1: item.input.sourcePos.x, y1: item.input.sourcePos.y, x2: srcStub.x, y2: srcStub.y },
        { x1: dstStub.x, y1: dstStub.y, x2: item.input.targetPos.x, y2: item.input.targetPos.y },
      ];
      let pathPoints = aStarSearch(
        grid, startNodeId, goalNodeId,
        srcDir, oppositeDir(dstDir),
        occupancy, item.input.sourcePortKey,
        reOwnStubs,
        undefined,
        ownComps,
        avoidByWire.get(item.input.wireId)
      );

      if (!pathPoints || pathPoints.length === 0) {
        fallbackCount++;
        fallbackWireIds.push(item.input.wireId);
        pathPoints = fallbackPath(srcStub, dstStub, srcDir, dstDir);
      }

      const fullPath = [
        item.input.sourcePos, srcStub, ...pathPoints, dstStub, item.input.targetPos,
      ];
      updateOccupancy(grid, fullPath, occupancy, item.input.sourcePortKey, item.input.wireId);
      const dedupedPath = simplifyPath(fullPath);
      results[item.index] = { wireId: item.input.wireId, points: dedupedPath };
      anyRerouted = true;
    }
    if (!anyRerouted) break;
  }

  // ─── Compute crossing points for rendering (§8) ───
  for (const result of results) {
    if (!result) continue;
    result.crossings = findCrossingPoints(result.points, occupancy.segments, result.wireId);
  }

  return results;
}


/** Tracks within this distance of a parallel foreign track render as one
 *  visually-merged wire — the SAME tolerance the layout oracle uses for its
 *  collinear-overlap violation (layoutCheck.ts). Near-coincident grid lines
 *  (port/stub coordinates of unrelated components landing within a couple of
 *  px) are where this bites: exact-collinearity checks are blind to them. */
const NEAR_PARALLEL_TOL = 3;

/** The layout oracle's collinear-overlap rule: two same-axis segments whose
 *  lines sit within NEAR_PARALLEL_TOL of each other and share more than 1px
 *  of span. Exact overlap is the distance-0 case, so this subsumes
 *  segmentsOverlap for cross-wire checks. */
function segmentsNearOverlap(
  ax1: number, ay1: number, ax2: number, ay2: number,
  bx1: number, by1: number, bx2: number, by2: number
): boolean {
  const aHoriz = Math.abs(ay1 - ay2) < 0.5;
  const bHoriz = Math.abs(by1 - by2) < 0.5;
  if (aHoriz && bHoriz && Math.abs(ay1 - by1) < NEAR_PARALLEL_TOL) {
    const lo = Math.max(Math.min(ax1, ax2), Math.min(bx1, bx2));
    const hi = Math.min(Math.max(ax1, ax2), Math.max(bx1, bx2));
    return hi - lo > 1;
  }
  const aVert = Math.abs(ax1 - ax2) < 0.5;
  const bVert = Math.abs(bx1 - bx2) < 0.5;
  if (aVert && bVert && Math.abs(ax1 - bx1) < NEAR_PARALLEL_TOL) {
    const lo = Math.max(Math.min(ay1, ay2), Math.min(by1, by2));
    const hi = Math.min(Math.max(ay1, ay2), Math.max(by1, by2));
    return hi - lo > 1;
  }
  return false;
}

/** Foreign-segment interval index for near-parallel lookups inside ONE A*
 *  search (occupancy is frozen while a search runs, so the index is built
 *  once per search). Horizontal segments bucket by rounded line-y, vertical
 *  by rounded line-x; a relaxed edge then checks the ±NEAR_PARALLEL_TOL
 *  buckets instead of scanning every occupied segment — the near-parallel
 *  cost sits in the A* hot loop, where an O(segments) scan per edge
 *  relaxation multiplies into seconds on the big reference fixtures. */
interface NearParallelIndex {
  horizByY: Map<number, { line: number; lo: number; hi: number }[]>;
  vertByX: Map<number, { line: number; lo: number; hi: number }[]>;
}

function buildNearParallelIndex(
  segments: OccupancyState['segments'],
  ownPortKey: string
): NearParallelIndex {
  const horizByY = new Map<number, { line: number; lo: number; hi: number }[]>();
  const vertByX = new Map<number, { line: number; lo: number; hi: number }[]>();
  const add = (
    map: NearParallelIndex['horizByY'],
    line: number, a: number, b: number
  ) => {
    const key = Math.round(line);
    const entry = { line, lo: Math.min(a, b), hi: Math.max(a, b) };
    const list = map.get(key);
    if (list) list.push(entry);
    else map.set(key, [entry]);
  };
  for (const seg of segments) {
    if (seg.sourcePortKey === ownPortKey) continue; // fan-out trunks are legitimate
    if (Math.abs(seg.y1 - seg.y2) < 0.5) add(horizByY, seg.y1, seg.x1, seg.x2);
    else if (Math.abs(seg.x1 - seg.x2) < 0.5) add(vertByX, seg.x1, seg.y1, seg.y2);
  }
  return { horizByY, vertByX };
}

/** Does an axis-aligned edge near-overlap any indexed foreign segment?
 *  Same predicate as segmentsNearOverlap, served from the bucket index. */
function edgeNearOverlaps(
  index: NearParallelIndex,
  x1: number, y1: number, x2: number, y2: number
): boolean {
  const horiz = Math.abs(y1 - y2) < 0.5;
  const map = horiz ? index.horizByY : index.vertByX;
  const line = horiz ? y1 : x1;
  const lo = horiz ? Math.min(x1, x2) : Math.min(y1, y2);
  const hi = horiz ? Math.max(x1, x2) : Math.max(y1, y2);
  const center = Math.round(line);
  for (let key = center - NEAR_PARALLEL_TOL; key <= center + NEAR_PARALLEL_TOL; key++) {
    const list = map.get(key);
    if (!list) continue;
    for (const entry of list) {
      if (Math.abs(entry.line - line) >= NEAR_PARALLEL_TOL) continue;
      if (Math.min(entry.hi, hi) - Math.max(entry.lo, lo) > 1) return true;
    }
  }
  return false;
}

/** Check if two collinear axis-aligned segments overlap (for H1 validation) */
function segmentsOverlap(
  ax1: number, ay1: number, ax2: number, ay2: number,
  bx1: number, by1: number, bx2: number, by2: number
): boolean {
  const aHoriz = Math.abs(ay1 - ay2) < 0.5;
  const bHoriz = Math.abs(by1 - by2) < 0.5;
  const aVert = Math.abs(ax1 - ax2) < 0.5;
  const bVert = Math.abs(bx1 - bx2) < 0.5;

  if (aHoriz && bHoriz && Math.abs(ay1 - by1) < 1) {
    const aMin = Math.min(ax1, ax2), aMax = Math.max(ax1, ax2);
    const bMin = Math.min(bx1, bx2), bMax = Math.max(bx1, bx2);
    return aMin < bMax - 1 && bMin < aMax - 1;
  }
  if (aVert && bVert && Math.abs(ax1 - bx1) < 1) {
    const aMin = Math.min(ay1, ay2), aMax = Math.max(ay1, ay2);
    const bMin = Math.min(by1, by2), bMax = Math.max(by1, by2);
    return aMin < bMax - 1 && bMin < aMax - 1;
  }
  return false;
}

/** Remove a wire's segments from occupancy (before re-routing) */
function removeOccupancy(occupancy: OccupancyState, wireId: string) {
  occupancy.segments = occupancy.segments.filter(s => s.wireId !== wireId);
  // Remove bend points for this wire
  for (const [key, wid] of occupancy.occupiedBends) {
    if (wid === wireId) occupancy.occupiedBends.delete(key);
  }
}

/** Find all crossing points between this wire and other wires (for bridge rendering §8) */
function findCrossingPoints(
  path: Point[],
  allSegments: OccupancyState['segments'],
  wireId: string
): Point[] {
  const crossings: Point[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const isHoriz = Math.abs(a.y - b.y) < 0.5;
    const isVert = Math.abs(a.x - b.x) < 0.5;

    for (const seg of allSegments) {
      if (seg.wireId === wireId) continue;
      const sHoriz = Math.abs(seg.y1 - seg.y2) < 0.5;
      const sVert = Math.abs(seg.x1 - seg.x2) < 0.5;

      // Perpendicular crossing: horizontal vs vertical
      if (isHoriz && sVert) {
        const minHx = Math.min(a.x, b.x), maxHx = Math.max(a.x, b.x);
        const minVy = Math.min(seg.y1, seg.y2), maxVy = Math.max(seg.y1, seg.y2);
        if (seg.x1 > minHx + 1 && seg.x1 < maxHx - 1 && a.y > minVy + 1 && a.y < maxVy - 1) {
          crossings.push({ x: seg.x1, y: a.y });
        }
      } else if (isVert && sHoriz) {
        const minHx = Math.min(seg.x1, seg.x2), maxHx = Math.max(seg.x1, seg.x2);
        const minVy = Math.min(a.y, b.y), maxVy = Math.max(a.y, b.y);
        if (a.x > minHx + 1 && a.x < maxHx - 1 && seg.y1 > minVy + 1 && seg.y1 < maxVy - 1) {
          crossings.push({ x: a.x, y: seg.y1 });
        }
      }
    }
  }
  return crossings;
}

// ─── Divergence dots (renderer support — VISUAL_VOCAB junction dots) ────────

/** VISUAL_VOCAB: a split is drawn as a dot at the junction — r=4, #333. */
export const SPLIT_DOT_RADIUS = 4;

/** A displayed (rendered) wire path: what the student actually sees —
 *  routed points AFTER manual segment offsets are applied. */
export interface DisplayedWirePath {
  /** "compId:portId" of the source port — fan-out wires share this key. */
  sourcePortKey: string;
  points: Point[];
}

/** Unit axis direction of an axis-aligned displayed segment (null if
 *  zero-length or diagonal — displayed wire segments are always H/V). */
function axisDir(from: Point, to: Point): { dx: number; dy: number } | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dy) < 0.5 && Math.abs(dx) >= 0.5) return { dx: Math.sign(dx), dy: 0 };
  if (Math.abs(dx) < 0.5 && Math.abs(dy) >= 0.5) return { dx: 0, dy: Math.sign(dy) };
  return null;
}

/** Walk two same-source displayed paths from their shared port and return the
 *  point where they part ways, or null if one path is a prefix of the other
 *  (or they are identical). Geometric, not pointwise: the two paths may
 *  segment the shared trunk differently (extra collinear waypoints, manual
 *  drags on later segments), so we advance along the COMMON direction by the
 *  shorter remaining run and only declare divergence where directions differ. */
function pairDivergencePoint(a: Point[], b: Point[]): Point | null {
  if (a.length < 2 || b.length < 2) return null;
  if (Math.abs(a[0].x - b[0].x) >= 0.5 || Math.abs(a[0].y - b[0].y) >= 0.5) return null;

  let pos = { x: a[0].x, y: a[0].y };
  let ai = 1;
  let bi = 1;
  const maxSteps = a.length + b.length + 4; // walk is strictly consuming; guard anyway
  for (let step = 0; step < maxSteps; step++) {
    // Skip waypoints already consumed (or zero-length segments).
    while (ai < a.length && Math.abs(a[ai].x - pos.x) < 0.5 && Math.abs(a[ai].y - pos.y) < 0.5) ai++;
    while (bi < b.length && Math.abs(b[bi].x - pos.x) < 0.5 && Math.abs(b[bi].y - pos.y) < 0.5) bi++;
    if (ai >= a.length || bi >= b.length) return null; // ran off an end — no junction

    const da = axisDir(pos, a[ai]);
    const db = axisDir(pos, b[bi]);
    if (!da || !db) return null; // degenerate/diagonal — bail, draw nothing
    if (da.dx !== db.dx || da.dy !== db.dy) return { x: pos.x, y: pos.y }; // the junction

    const lenA = Math.abs(a[ai].x - pos.x) + Math.abs(a[ai].y - pos.y);
    const lenB = Math.abs(b[bi].x - pos.x) + Math.abs(b[bi].y - pos.y);
    const advance = Math.min(lenA, lenB);
    pos = { x: pos.x + da.dx * advance, y: pos.y + da.dy * advance };
  }
  return null;
}

/**
 * Junction dots for fan-out wires (VISUAL_VOCAB: splitting one output to many
 * inputs draws a dot at the junction). Pure — the canvas renders the result.
 *
 * Per source-port group, every wire pair contributes the point where the two
 * displayed paths diverge; a shared trunk therefore gets its dot at the elbow
 * where branches actually part, not at the source port (the stub-tip case
 * subsumes the old always-at-the-port dot). Points are deduped, and any dot
 * within collision range of a CANVAS-side crossing is skipped — the canvas
 * recomputes crossings from displayed points and bakes bump arcs into pathD
 * (superseding the router's own crossing set), so callers must pass THAT set
 * or the skip would miss bumps introduced by manual segment drags.
 */
export function findDivergencePoints(
  wires: DisplayedWirePath[],
  crossings: Point[] = [],
  skipRadius: number = CROSSING_BUMP_RADIUS + SPLIT_DOT_RADIUS,
): Point[] {
  const groups = new Map<string, DisplayedWirePath[]>();
  for (const w of wires) {
    const list = groups.get(w.sourcePortKey);
    if (list) list.push(w);
    else groups.set(w.sourcePortKey, [w]);
  }

  const dots: Point[] = [];
  const seen = new Set<string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const p = pairDivergencePoint(group[i].points, group[j].points);
        if (!p) continue;
        const key = `${Math.round(p.x)},${Math.round(p.y)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const onBump = crossings.some(
          (c) => Math.hypot(c.x - p.x, c.y - p.y) <= skipRadius,
        );
        if (!onBump) dots.push(p);
      }
    }
  }
  return dots;
}

/** Check if a path passes through any element bounds.
 *
 *  With `ownComps`, the wire's own endpoint components are exempt on the
 *  first and last segments — mirroring the layout oracle's own-stub
 *  exemption (layoutCheck.ts). On a SIMPLIFIED path the first segment is
 *  the source stub merged with its collinear approach run (A* forces the
 *  first move along the stub direction and the arrival along the target
 *  stub axis, so stub + approach always merge), likewise the last — so
 *  exempting exactly these two segments covers the whole own-endpoint
 *  landing and nothing more. */
function isPathBlockedByBounds(
  path: Point[],
  bounds: Bounds[],
  ownComps?: OwnComponents
): boolean {
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    for (let bi = 0; bi < bounds.length; bi++) {
      if (ownComps) {
        if (i === 0 && bi === ownComps.sourceIdx) continue;
        if (i === path.length - 2 && bi === ownComps.targetIdx) continue;
      }
      if (segmentIntersectsBounds(a.x, a.y, b.x, b.y, bounds[bi])) return true;
    }
  }
  return false;
}

/** Update occupancy after routing a wire */
function updateOccupancy(
  grid: RoutingGrid,
  path: Point[],
  occupancy: OccupancyState,
  sourcePortKey: string,
  wireId: string
) {
  // Record segments for crossing detection
  for (let i = 0; i < path.length - 1; i++) {
    occupancy.segments.push({
      x1: path[i].x, y1: path[i].y,
      x2: path[i + 1].x, y2: path[i + 1].y,
      wireId,
      sourcePortKey,
    });
  }

  // Record bend points (where direction changes between consecutive segments)
  for (let i = 1; i < path.length - 1; i++) {
    const prev = path[i - 1];
    const curr = path[i];
    const next = path[i + 1];
    const d1h = Math.abs(curr.x - prev.x) > 0.5; // prev→curr is horizontal
    const d2h = Math.abs(next.x - curr.x) > 0.5; // curr→next is horizontal
    if (d1h !== d2h) {
      // Direction changed at curr → this is a bend point
      occupancy.occupiedBends.set(`${Math.round(curr.x)},${Math.round(curr.y)}`, wireId);
    }
  }

  // Record occupied edges (map path segments back to grid edges)
  for (let i = 0; i < path.length - 1; i++) {
    const aKey = `${Math.round(path[i].x)},${Math.round(path[i].y)}`;
    const bKey = `${Math.round(path[i + 1].x)},${Math.round(path[i + 1].y)}`;
    const aId = grid.nodeIndex.get(aKey);
    const bId = grid.nodeIndex.get(bKey);
    if (aId === undefined || bId === undefined) continue;

    const neighbors = grid.adj.get(aId);
    if (!neighbors) continue;
    for (const { neighbor, edge } of neighbors) {
      if (neighbor === bId) {
        occupancy.occupiedEdges.set(edge, sourcePortKey);
        break;
      }
    }
  }
}

// ─── Exported validation for manual drag constraint feedback (§9.4) ──────

/**
 * Check if a wire segment at a proposed position would violate H2 (element crossing).
 * Used during manual wire segment dragging to provide real-time visual feedback.
 */
export function validateSegmentPosition(
  p1: Point, p2: Point,
  components: CircuitComponent[]
): boolean {
  for (const comp of components) {
    const bounds = expandBounds(getCompBounds(comp), ELEMENT_MARGIN);
    if (segmentIntersectsBounds(p1.x, p1.y, p2.x, p2.y, bounds)) {
      return false; // violates H2
    }
  }
  return true; // valid
}
