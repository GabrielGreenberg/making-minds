// The canvas's floating palette and its Boxes pop-out, the pure parts (task
// 054; the design memo is docs/buildout/designs/editor-workbench.md
// §Floating palette, §Boxes). No React, no store: components/Palette.tsx
// renders what these decide, store.ts places through `placementOrigin`, and
// app/tools/workbenchCheck.ts pins them.
//
// The armed tool is ONE tagged value (`ArmedTool`): a part type, the NEW_BOX
// draw tool, or a box from the library. A gate tile, a box row and a pinned
// box tile all arm, drag and place through it — the canvas has one branch
// per gesture, never one per source.

import type { CircuitComponent, ComponentType, ConfirmedBoxDef, Port } from './types';
import { getPortsForType } from './types';
import { getComponentSize } from './componentGeometry';
import { disallowedComponentTypes, isComponentTypeAllowed } from './engine/machineValidation';

// ── The armed tool ─────────────────────────────────────────────────────────

export type ArmedTool = ComponentType | 'NEW_BOX' | { box: string };

/** A tool as a string: comparison, React keys. 'AND' · 'NEW_BOX' · 'box:<id>'. */
export function toolKey(tool: ArmedTool): string {
  return typeof tool === 'object' ? `box:${tool.box}` : tool;
}

export function sameTool(a: ArmedTool | null, b: ArmedTool | null): boolean {
  if (a === null || b === null) return a === b;
  return toolKey(a) === toolKey(b);
}

// ── What the palette offers ────────────────────────────────────────────────

export type PaletteGroup = 'io' | 'gates' | 'states';

export interface PalettePart {
  type: ComponentType;
  label: string;
  group: PaletteGroup;
}

const CIRCUIT_PARTS: PalettePart[] = [
  { type: 'INPUT', label: 'Input', group: 'io' },
  { type: 'OUTPUT', label: 'Output', group: 'io' },
  { type: 'AND', label: 'AND', group: 'gates' },
  { type: 'OR', label: 'OR', group: 'gates' },
  { type: 'NOT', label: 'NOT', group: 'gates' },
  { type: 'MEM', label: 'MEM', group: 'gates' },
];
const STATE_PARTS: PalettePart[] = [{ type: 'STATE', label: 'State', group: 'states' }];

/** The parts a canvas offers, in palette order. FSM and TM canvases (a TM
 *  shares the FSM editor) offer STATE only; a circuit canvas offers MEM only
 *  where it may hold memory (store.ts selectMayHoldMemory). A turbot follows
 *  its inner mode — the caller passes the effective mode. */
export function paletteParts(effectiveMode: string, mayHoldMemory: boolean): PalettePart[] {
  if (effectiveMode === 'FSM' || effectiveMode === 'TM') return STATE_PARTS;
  return CIRCUIT_PARTS.filter((p) => p.type !== 'MEM' || mayHoldMemory);
}

/** Does this canvas box circuits (the New box tool, the Boxes group)? Boxing
 *  a TM or an FSM is refused by design (types.ts placeableBoxKinds). */
export function paletteHasBoxes(effectiveMode: string): boolean {
  return effectiveMode === 'CC' || effectiveMode === 'SC';
}

/** Why a tile is dimmed, or null when it may be used. Decision 3: a part the
 *  question's `allowed_components` excludes is DIMMED with this tooltip, not
 *  hidden — presentation only; Stage-1 grading and the paste seam enforce it. */
export function partRefusal(part: Pick<PalettePart, 'type' | 'label'>, allowed: readonly ComponentType[] | null): string | null {
  return isComponentTypeAllowed(part.type, allowed) ? null : `${part.label} is not used in this problem`;
}

// ── The box library, as the pop-out lists it ──────────────────────────────

export interface BoxRow {
  box: ConfirmedBoxDef;
  numIn: number;
  numOut: number;
  /** "2 in · 1 out · Problem 1" — the problem only when the box's origin is known. */
  meta: string;
  /** Why it is dimmed (a part inside it is excluded here), or null. */
  refusal: string | null;
  pinned: boolean;
}

/** The library as this canvas may use it: kinds it may place
 *  (store.ts selectPlaceableBoxKinds — never a retired 'FSM' box), in library
 *  order; a box whose insides use an excluded part is dimmed, not hidden
 *  (decision 3 — a boxed OR must still not smuggle an OR in, so it can't be
 *  armed or placed from here). `problemOf` names the question a box came from
 *  (F11), or null when unknown. */
export function boxRows(
  library: readonly ConfirmedBoxDef[],
  placeableKinds: ReadonlyArray<'CC' | 'SC'>,
  allowed: readonly ComponentType[] | null,
  pins: readonly string[],
  problemOf: (origin: number | undefined) => string | null,
): BoxRow[] {
  return library
    .filter((b) => {
      const kind = b.kind ?? 'CC';
      return kind !== 'FSM' && placeableKinds.includes(kind);
    })
    .map((box) => {
      const excluded = disallowedComponentTypes(box.internalComponents, allowed);
      const numIn = box.inputPortIds.length;
      const numOut = box.outputPortIds.length;
      return {
        box,
        numIn,
        numOut,
        meta: boxMetaLine(numIn, numOut, problemOf(box.origin)),
        refusal: excluded.length === 0 ? null : `This box uses ${excluded.join(', ')}, which ${excluded.length === 1 ? 'is' : 'are'} not used in this problem`,
        pinned: pins.includes(box.id),
      };
    });
}

export function boxMetaLine(numIn: number, numOut: number, problem: string | null): string {
  const ports = `${numIn} in · ${numOut} out`;
  return problem ? `${ports} · Problem ${problem}` : ports;
}

/** The pinned tiles, in pin order: each pin that resolves to a row. A pin
 *  whose box is gone (deleted, another person's on a shared browser, another
 *  canvas kind) is skipped silently (F12). */
export function pinnedRows(pins: readonly string[], rows: readonly BoxRow[]): BoxRow[] {
  const byId = new Map(rows.map((r) => [r.box.id, r]));
  const out: BoxRow[] = [];
  for (const id of pins) {
    const row = byId.get(id);
    if (row && !out.includes(row)) out.push(row);
  }
  return out;
}

/** A tool as the hint line names it: a part by its tile label ("AND",
 *  "Input"), a box by its name, NEW_BOX as itself. */
export function toolLabel(tool: ArmedTool, library: readonly ConfirmedBoxDef[]): string {
  if (tool === 'NEW_BOX') return 'NEW_BOX';
  if (typeof tool === 'object') return library.find((b) => b.id === tool.box)?.name ?? 'the box';
  return [...CIRCUIT_PARTS, ...STATE_PARTS].find((p) => p.type === tool)?.label ?? tool;
}

/** Pin or unpin a box (a new list; pinning appends, never duplicates). */
export function togglePin(pins: readonly string[], id: string, on: boolean): string[] {
  const rest = pins.filter((p) => p !== id);
  return on ? [...rest, id] : rest;
}

// ── Prefs (uiPrefs.ts: one bag per browser, cosmetic — F7, F12) ───────────

export const PALETTE_PREF_KEY = 'editor.palette';

export interface PalettePlacement { x: number; y: number; horiz: boolean }
export const PALETTE_DEFAULT: PalettePlacement = { x: 14, y: 14, horiz: false };
/** How far inside the canvas the palette always stays. */
export const PALETTE_MARGIN = 8;

export function palettePlacementFromPrefs(prefs: Record<string, unknown>): PalettePlacement {
  const v = prefs[PALETTE_PREF_KEY];
  if (!v || typeof v !== 'object') return PALETTE_DEFAULT;
  const o = v as Record<string, unknown>;
  const num = (n: unknown, d: number) => (typeof n === 'number' && Number.isFinite(n) ? n : d);
  return { x: num(o.x, PALETTE_DEFAULT.x), y: num(o.y, PALETTE_DEFAULT.y), horiz: o.horiz === true };
}

/** The palette's top-left, kept PALETTE_MARGIN inside the canvas. A canvas
 *  smaller than the palette pins it to the top-left margin. */
export function clampPalette(
  pos: { x: number; y: number },
  size: { w: number; h: number },
  canvas: { w: number; h: number },
): { x: number; y: number } {
  const clamp = (v: number, span: number, room: number) =>
    Math.round(Math.max(PALETTE_MARGIN, Math.min(room - span - PALETTE_MARGIN, v)));
  return { x: clamp(pos.x, size.w, canvas.w), y: clamp(pos.y, size.h, canvas.h) };
}

/** The palette's length along its run, in px, for `tiles` tiles and
 *  `dividers` hairlines: the grip (16), the turn button (24), the border,
 *  each tile at its 58px width (the widest a tile runs, so an estimate that
 *  never undershoots). */
export function paletteLength(tiles: number, dividers: number): number {
  return 16 + 24 + 2 + dividers + tiles * 58;
}

/** Which way the palette runs: the student's choice when it fits the canvas,
 *  else the other way when THAT fits — a flat palette in a narrow canvas
 *  would clip its own tiles and turn button, and a student could lose the
 *  way back. Neither fitting keeps the choice (the clamp pins it top-left).
 *  An unknown canvas (0 × 0, first paint) keeps the choice. */
export function paletteOrientation(preferHoriz: boolean, length: number, canvas: { w: number; h: number }): boolean {
  if (canvas.w <= 0 || canvas.h <= 0) return preferHoriz;
  const fitsHoriz = length + 2 * PALETTE_MARGIN <= canvas.w;
  const fitsVert = length + 2 * PALETTE_MARGIN <= canvas.h;
  return preferHoriz ? fitsHoriz || !fitsVert : !fitsVert && fitsHoriz;
}

/** Keep the palette off another piece of the canvas's furniture — the action
 *  group at the top right (Undo · Redo · Delete · …). Where they would
 *  overlap, the palette drops below it; a canvas too short for that keeps
 *  the clamped spot. Rects in canvas-container px. */
export function clearOf(
  pos: { x: number; y: number },
  size: { w: number; h: number },
  obstacle: { x0: number; y0: number; x1: number; y1: number } | null,
  canvas: { w: number; h: number },
): { x: number; y: number } {
  if (!obstacle) return pos;
  const overlaps = pos.x < obstacle.x1 && pos.x + size.w > obstacle.x0 && pos.y < obstacle.y1 && pos.y + size.h > obstacle.y0;
  if (!overlaps) return pos;
  const below = clampPalette({ x: pos.x, y: obstacle.y1 + PALETTE_MARGIN }, size, canvas);
  return below.y >= obstacle.y1 ? below : pos;
}

/** Pins are kept per homework; in the sandbox, whose library is per tab, per tab. */
export function pinsPrefKey(scope: { assignmentId: string } | { tabId: string }): string {
  return 'assignmentId' in scope ? `pinnedBoxes:${scope.assignmentId}` : `pinnedBoxes:tab:${scope.tabId}`;
}

export function pinsFromPrefs(prefs: Record<string, unknown>, key: string): string[] {
  const v = prefs[key];
  return Array.isArray(v) ? v.filter((id): id is string => typeof id === 'string') : [];
}

// ── Placing ────────────────────────────────────────────────────────────────

/** A box as it lands on a canvas — the shape the canvas draws for the ghost.
 *  (store.ts placeBoxInstance builds the real one: bound ports, own memory.) */
function boxPorts(numIn: number, numOut: number): Port[] {
  return [
    ...Array.from({ length: numIn }, (_, i) => ({ id: `in${i + 1}`, label: `in${i + 1}`, side: 'left' as const, index: i })),
    ...Array.from({ length: numOut }, (_, i) => ({ id: `out${i + 1}`, label: `out${i + 1}`, side: 'right' as const, index: i })),
  ];
}

/** The component a tool would place, at the canvas origin — what the drag
 *  ghost draws, and what the placement is sized by. Null for NEW_BOX (a draw
 *  tool, it places nothing) and for a box the library no longer holds. */
export function toolComponent(tool: ArmedTool, library: readonly ConfirmedBoxDef[]): CircuitComponent | null {
  if (tool === 'NEW_BOX') return null;
  if (typeof tool === 'object') {
    const box = library.find((b) => b.id === tool.box);
    if (!box) return null;
    return {
      id: 'palette-ghost', type: 'BOXED', x: 0, y: 0, label: box.name, value: 0,
      ports: boxPorts(box.inputPortIds.length, box.outputPortIds.length),
      boxedCircuitId: box.id,
      internalCircuit: { components: box.internalComponents, wires: box.internalWires },
    };
  }
  const label = tool === 'INPUT' ? 'IN' : tool === 'OUTPUT' ? 'OUT' : tool === 'MEM' ? 'M' : tool === 'STATE' ? 'S' : tool;
  return { id: 'palette-ghost', type: tool, x: 0, y: 0, label, ports: getPortsForType(tool), value: 0 };
}

/** Where a part dropped (or clicked) at canvas point (px, py) goes: centred
 *  on the point. (The store snaps it to the grid.) */
export function placementOrigin(comp: CircuitComponent | null, px: number, py: number): { x: number; y: number } {
  const { w, h } = comp ? getComponentSize(comp) : { w: 0, h: 0 };
  return { x: px - w / 2, y: py - h / 2 };
}

/** A pointer's position on the canvas: screen → canvas coordinates. */
export function clientToCanvas(
  client: { x: number; y: number },
  rect: { left: number; top: number },
  view: { panX: number; panY: number; zoom: number },
): { x: number; y: number } {
  return { x: (client.x - rect.left - view.panX) / view.zoom, y: (client.y - rect.top - view.panY) / view.zoom };
}

/** A pointer that moved less than this between down and up was a click. */
export const DRAG_THRESHOLD = 4;
