// The sandbox workbook FILE (task 028) — what File ▸ Save writes and File ▸
// Open reads: exportWorkbook's JSON (WorkbookData, formatVersion 2), or the
// legacy single-circuit file ({ circuit, metadata, boxes, … }).
//
//   parseWorkbookFile   an opened file → a WorkbookData, or the reason it
//                       can't be one (spec §1.6 step 3: structure, required
//                       fields, component types; §1.7: the details). The
//                       legacy format is converted here, so the store has
//                       ONE apply path (importWorkbook).
//   serializeWorkbook   a workbook → the file's text (indented while that
//                       fits under Open's size cap, compact when it doesn't).
//   unopenableReason    why Open would refuse this text — asked by Save
//                       before it writes, so Save never writes a file Open
//                       refuses.
//   workbookContentKey  the content the "unsaved changes" prompt compares:
//   workbookKeyHash     the worksheets, minus ids, titles of the workbook,
//                       view state and run state (a toggle or a run is not
//                       an edit).
//   suggestedFileName / titleFromFileName   the workbook title ↔ its file.
//
// Structure only: a transition label is checked to be a string and nothing
// more — its syntax lives in engine/notation.ts alone (law 4). The file's ids
// pass through as they are; a file opens only as sandbox tabs (importWorkbook),
// so the paste seam treats everything in it as sandbox content (law 8).
//
// Pure: no DOM, no React, no store — the headless harness imports it, and so
// does fileHandle.ts (the browser side). Nothing here reaches /api (law 5).

import type {
  ActiveTask,
  ArenaConfig,
  BuildMode,
  CircuitComponent,
  CircuitData,
  RepSystem,
  WorkbookData,
  WorksheetData,
  Wire,
} from './types';
import { COMPONENT_TYPES } from './types';
import { canonicalJson } from './canonicalJson';
import { sha256, toHex, utf8 } from './provenance/sha256';
import { mintId } from './provenance/ids';
import { MAX_ARENA_SIZE } from './instructor/arenaEditing';

/** The largest file Open reads — the class of a browser's localStorage quota,
 *  where the sandbox has to live once it is open (autosave). A picked file is
 *  measured in bytes, text in hand in characters (never more than its bytes). */
export const MAX_WORKBOOK_FILE_CHARS = 5_000_000;

/** Why a file of `size` (bytes, or characters) is too large to open, or null. */
export function oversizeReason(size: number): string | null {
  return size > MAX_WORKBOOK_FILE_CHARS
    ? `the file is ${(size / 1e6).toFixed(1)} MB; a workbook file is at most ${MAX_WORKBOOK_FILE_CHARS / 1e6} MB`
    : null;
}

/** An opened file, normalized: the defaults a hand-written file may leave
 *  out are filled in (activeTask, boxes, confirmedBoxes, a dangling
 *  activeWorksheetId), the view preferences are only those that parsed. */
export type ParsedWorkbook = Omit<WorkbookData, 'viewPreferences' | 'notice'> & {
  viewPreferences: Partial<WorkbookData['viewPreferences']>;
};

export type ParseResult = { ok: true; workbook: ParsedWorkbook } | { ok: false; reason: string };

/** Machines a sandbox sheet can be ('open' has no canvas). */
const SHEET_MODES: readonly BuildMode[] = ['CC', 'SC', 'FSM', 'TM', 'turbot'];
/** Machines a turbot's brain can be. */
const INNER_MODES: readonly BuildMode[] = ['CC', 'SC', 'FSM', 'TM'];
const ACTIVE_TASKS: readonly ActiveTask[] = ['arithmetic', 'turbot', 'navigation', 'perception'];
const REP_SYSTEMS: readonly RepSystem[] = ['tally', 'binary', 'plus'];
const ARENA_CELLS = ['empty', 'block', 'goal'];
const FACINGS = ['N', 'E', 'S', 'W'];
/** How deep boxes may nest inside boxes before a file is refused. */
const MAX_BOX_DEPTH = 16;

/** Thrown inside the parse with the reason shown to the person. */
class FileProblem extends Error {}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);
const fail = (reason: string): never => {
  throw new FileProblem(reason);
};
const quote = (v: unknown) => (typeof v === 'string' ? `"${v.slice(0, 40)}"` : String(v));

/** Parse an opened file into a workbook, or say why it can't be one.
 *  `sizeCap: false` skips Open's size cap — for reading back what Save just
 *  wrote (the store's markWorkbookSaved), never for a file being opened. */
export function parseWorkbookFile(text: string, opts: { sizeCap?: boolean } = {}): ParseResult {
  try {
    const tooBig = opts.sizeCap === false ? null : oversizeReason(text.length);
    if (tooBig) fail(tooBig);
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (e) {
      fail(`it isn't valid JSON (${e instanceof Error ? e.message : 'unreadable'})`);
    }
    if (!isObj(data)) fail("it isn't a workbook file (expected a JSON object)");
    const d = data as Obj;
    if (d.formatVersion === 2) return { ok: true, workbook: workbookFrom(d) };
    if (d.formatVersion !== undefined) fail(`it has an unsupported format version (${quote(d.formatVersion)})`);
    if (d.circuit !== undefined) return { ok: true, workbook: legacyWorkbookFrom(d) };
    return fail("it isn't a workbook file (no worksheets and no circuit)");
  } catch (e) {
    if (e instanceof FileProblem) return { ok: false, reason: e.message };
    // Anything else (a stack overflow on a pathological file) is still a
    // file that can't be opened — never a crash of the menu.
    return { ok: false, reason: 'it could not be read as a workbook' };
  }
}

function workbookFrom(d: Obj): ParsedWorkbook {
  if (!Array.isArray(d.worksheets)) fail('it has no worksheets list');
  const raw = d.worksheets as unknown[];
  if (raw.length === 0) fail('it has no worksheets');
  const seen = new Set<string>();
  const worksheets = raw.map((ws, i) => {
    const sheet = worksheetFrom(ws, i);
    if (seen.has(sheet.id)) fail(`two worksheets share the id ${quote(sheet.id)}`);
    seen.add(sheet.id);
    return sheet;
  });
  // A dangling active sheet falls back to the first one.
  const activeWorksheetId =
    typeof d.activeWorksheetId === 'string' && seen.has(d.activeWorksheetId)
      ? d.activeWorksheetId
      : worksheets[0].id;
  return {
    formatVersion: 2,
    metadata: metadataFrom(d.metadata, ''),
    worksheets,
    activeWorksheetId,
    viewPreferences: viewPreferencesFrom(d.viewPreferences),
  };
}

function worksheetFrom(ws: unknown, i: number): WorksheetData {
  const where = `worksheet ${i + 1}`;
  if (!isObj(ws)) return fail(`${where} isn't an object`);
  if (typeof ws.id !== 'string' || ws.id === '') fail(`${where} has no id`);
  if (typeof ws.title !== 'string') fail(`${where} has no title`);
  const named = `worksheet ${i + 1} (${quote(ws.title)})`;
  const buildMode = ws.buildMode as BuildMode;
  if (!SHEET_MODES.includes(buildMode)) fail(`${named} is an unsupported machine (${quote(ws.buildMode)})`);
  const turbot = buildMode === 'turbot';
  let activeTask: ActiveTask = turbot ? 'turbot' : 'arithmetic';
  if (ws.activeTask !== undefined) {
    if (!ACTIVE_TASKS.includes(ws.activeTask as ActiveTask)) fail(`${named} has an unknown task (${quote(ws.activeTask)})`);
    activeTask = ws.activeTask as ActiveTask;
  }
  if (!isObj(ws.circuit)) fail(`${named} has no circuit`);
  const circuit = circuitFrom(ws.circuit as Obj, named, 0);
  const boxes = ws.boxes === undefined ? [] : boxesFrom(ws.boxes, named);
  const confirmedBoxes = ws.confirmedBoxes === undefined ? [] : confirmedBoxesFrom(ws.confirmedBoxes, named);
  const sheet: WorksheetData = {
    id: ws.id as string,
    title: ws.title as string,
    buildMode,
    activeTask,
    circuit,
    boxes,
    confirmedBoxes,
  };
  // Brain kind + arena belong to turbot sheets only (the store seeds a
  // missing arena with the sandbox default).
  if (turbot) {
    if (ws.innerMode !== undefined) {
      if (!INNER_MODES.includes(ws.innerMode as BuildMode)) fail(`${named} has an unsupported brain (${quote(ws.innerMode)})`);
      sheet.innerMode = ws.innerMode as BuildMode;
    }
    if (ws.arena !== undefined) sheet.arena = arenaFrom(ws.arena, named);
  }
  return sheet;
}

function circuitFrom(c: Obj, where: string, depth: number): CircuitData {
  if (depth > MAX_BOX_DEPTH) fail(`${where}: boxes are nested too deep`);
  const components = c.components === undefined ? [] : c.components;
  const wires = c.wires === undefined ? [] : c.wires;
  if (!Array.isArray(components)) fail(`${where}: its components aren't a list`);
  if (!Array.isArray(wires)) fail(`${where}: its wires aren't a list`);
  const ids = new Set<string>();
  (components as unknown[]).forEach((comp, i) => {
    componentCheck(comp, `${where}, component ${i + 1}`, depth);
    const id = (comp as CircuitComponent).id;
    if (ids.has(id)) fail(`${where}: two components share the id ${quote(id)}`);
    ids.add(id);
  });
  (wires as unknown[]).forEach((w, i) => wireCheck(w, `${where}, wire ${i + 1}`, ids));
  return { components: components as CircuitComponent[], wires: wires as Wire[] };
}

function componentCheck(comp: unknown, where: string, depth: number): void {
  if (!isObj(comp)) return fail(`${where} isn't an object`);
  if (typeof comp.id !== 'string' || comp.id === '') fail(`${where} has no id`);
  if (!COMPONENT_TYPES.includes(comp.type as CircuitComponent['type'])) {
    fail(`${where} has an unknown component type (${quote(comp.type)})`);
  }
  if (!isFiniteNum(comp.x) || !isFiniteNum(comp.y)) fail(`${where} (${comp.type}) has no position`);
  if (typeof comp.label !== 'string') fail(`${where} (${comp.type}) has no label`);
  if (!Array.isArray(comp.ports) || !comp.ports.every((p) => isObj(p) && typeof p.id === 'string')) {
    fail(`${where} (${comp.type}) has no port list`);
  }
  if (comp.rotation !== undefined && !isFiniteNum(comp.rotation)) fail(`${where} (${comp.type}) has a bad rotation`);
  if (comp.internalCircuit !== undefined) {
    if (!isObj(comp.internalCircuit)) fail(`${where} (${comp.type}) has a bad boxed circuit`);
    circuitFrom(comp.internalCircuit as Obj, `${where} (${comp.type}) inside`, depth + 1);
  }
}

function wireCheck(w: unknown, where: string, componentIds: Set<string>): void {
  if (!isObj(w)) return fail(`${where} isn't an object`);
  if (typeof w.id !== 'string' || w.id === '') fail(`${where} has no id`);
  for (const end of ['source', 'target'] as const) {
    const comp = w[`${end}ComponentId`];
    if (typeof comp !== 'string' || !componentIds.has(comp)) {
      fail(`${where} connects to a component that isn't there (${quote(comp)})`);
    }
    if (typeof w[`${end}PortId`] !== 'string') fail(`${where} has no ${end} port`);
  }
  // A label is the notation seam's to read (law 4): only its type is checked.
  if (w.transitionLabel !== undefined && typeof w.transitionLabel !== 'string') fail(`${where} has a bad transition label`);
  if (w.fsmControlPt !== undefined && !(isObj(w.fsmControlPt) && isFiniteNum(w.fsmControlPt.x) && isFiniteNum(w.fsmControlPt.y))) {
    fail(`${where} has a bad curve point`);
  }
  if (w.manualSegments !== undefined && !Array.isArray(w.manualSegments)) fail(`${where} has bad segment overrides`);
}

function boxesFrom(boxes: unknown, where: string): WorksheetData['boxes'] {
  if (!Array.isArray(boxes)) fail(`${where}: its boxes aren't a list`);
  (boxes as unknown[]).forEach((b, i) => {
    const at = `${where}, box ${i + 1}`;
    if (!isObj(b) || typeof b.id !== 'string') return fail(`${at} has no id`);
    if (![b.x, b.y, b.width, b.height].every(isFiniteNum)) fail(`${at} has no rectangle`);
    if (!Array.isArray(b.componentIds)) fail(`${at} has no component list`);
  });
  return boxes as WorksheetData['boxes'];
}

function confirmedBoxesFrom(boxes: unknown, where: string): NonNullable<WorksheetData['confirmedBoxes']> {
  if (!Array.isArray(boxes)) fail(`${where}: its saved boxes aren't a list`);
  (boxes as unknown[]).forEach((b, i) => {
    const at = `${where}, saved box ${i + 1}`;
    if (!isObj(b) || typeof b.id !== 'string') return fail(`${at} has no id`);
    if (typeof b.name !== 'string') fail(`${at} has no name`);
    if (!Array.isArray(b.inputPortIds) || !Array.isArray(b.outputPortIds)) fail(`${at} has no port lists`);
    circuitFrom({ components: b.internalComponents ?? null, wires: b.internalWires ?? null }, `${at} (${quote(b.name)})`, 1);
  });
  return boxes as NonNullable<WorksheetData['confirmedBoxes']>;
}

function arenaFrom(a: unknown, where: string): ArenaConfig {
  const at = `${where}: its arena`;
  if (!isObj(a)) return fail(`${at} isn't an object`);
  const { width, height, cells, start } = a;
  if (!isInt(width) || !isInt(height) || width < 1 || height < 1 || width > MAX_ARENA_SIZE || height > MAX_ARENA_SIZE) {
    fail(`${at} must be 1–${MAX_ARENA_SIZE} cells on a side (it is ${quote(width)} × ${quote(height)})`);
  }
  const w = width as number;
  const h = height as number;
  if (!Array.isArray(cells) || cells.length !== h ||
      !cells.every((row) => Array.isArray(row) && row.length === w && row.every((c) => ARENA_CELLS.includes(c as string)))) {
    fail(`${at}'s cells don't match its ${w} × ${h} size`);
  }
  if (!isObj(start) || !isInt(start.x) || !isInt(start.y) || !FACINGS.includes(start.facing as string)) {
    fail(`${at} has no start pose`);
  }
  const s = start as { x: number; y: number };
  if (s.x < 0 || s.y < 0 || s.x >= w || s.y >= h) fail(`${at}'s start (${s.x}, ${s.y}) is outside it`);
  return a as unknown as ArenaConfig;
}

function metadataFrom(m: unknown, fallbackTitle: string): WorkbookData['metadata'] {
  const o = isObj(m) ? m : {};
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    title: typeof o.title === 'string' && o.title !== '' ? o.title : fallbackTitle,
    author: str(o.author),
    createdAt: str(o.createdAt),
    updatedAt: str(o.updatedAt),
  };
}

/** Only the view preferences that parse — a bad one is dropped, never fatal. */
function viewPreferencesFrom(v: unknown): ParsedWorkbook['viewPreferences'] {
  if (!isObj(v)) return {};
  const out: ParsedWorkbook['viewPreferences'] = {};
  if (isFiniteNum(v.zoom) && v.zoom > 0) out.zoom = v.zoom;
  if (isFiniteNum(v.panX)) out.panX = v.panX;
  if (isFiniteNum(v.panY)) out.panY = v.panY;
  if (typeof v.showGrid === 'boolean') out.showGrid = v.showGrid;
  if (typeof v.showWireValues === 'boolean') out.showWireValues = v.showWireValues;
  if (typeof v.snapToAlign === 'boolean') out.snapToAlign = v.snapToAlign;
  if (REP_SYSTEMS.includes(v.repSystem as RepSystem)) out.repSystem = v.repSystem as RepSystem;
  return out;
}

/** The legacy single-circuit file (the pre-workbook "Export Worksheet"
 *  format) as a one-sheet workbook. */
function legacyWorkbookFrom(d: Obj): ParsedWorkbook {
  if (!isObj(d.circuit)) fail('its circuit isn\'t an object');
  const meta = isObj(d.metadata) ? d.metadata : {};
  const buildMode = (meta.buildType ?? 'CC') as BuildMode;
  if (!SHEET_MODES.includes(buildMode)) fail(`it is an unsupported machine (${quote(meta.buildType)})`);
  const title = typeof meta.title === 'string' && meta.title !== '' ? meta.title : '';
  const sheet = worksheetFrom({
    id: mintId({ kind: 'sandbox' }),
    title: title || 'Circuit 1',
    buildMode,
    circuit: d.circuit,
    boxes: d.boxes,
    confirmedBoxes: d.confirmedBoxes,
  }, 0);
  return {
    formatVersion: 2,
    metadata: metadataFrom({ title: title || 'Imported Circuit' }, 'Imported Circuit'),
    worksheets: [sheet],
    activeWorksheetId: sheet.id,
    viewPreferences: viewPreferencesFrom({ repSystem: d.repSystem }),
  };
}

// ─── The saved-content key ────────────────────────────────────────────

/** A component without its run state (a toggle's or a run's values), boxed
 *  internals included. */
function structureOfComponent(c: CircuitComponent): object {
  const rest: Partial<CircuitComponent> = { ...c };
  delete rest.value;
  delete rest.inputValues;
  delete rest.storedValue;
  return rest.internalCircuit ? { ...rest, internalCircuit: structureOfCircuit(rest.internalCircuit) } : rest;
}
function structureOfWire(w: Wire): object {
  const rest: Partial<Wire> = { ...w };
  delete rest.value;
  return rest;
}
function structureOfCircuit(c: CircuitData): { components: object[]; wires: object[] } {
  return { components: c.components.map(structureOfComponent), wires: c.wires.map(structureOfWire) };
}

/** What "unsaved changes" compares: every worksheet in order — its title,
 *  machine, task, a turbot's brain and arena, its circuit, drawn boxes and
 *  saved boxes — with the run state stripped. Not in it: tab ids, the
 *  workbook's title and metadata, the notice, which sheet is active, and the
 *  view (zoom, pan, grid) — none of those is work. */
export function workbookContentKey(wb: { worksheets: WorksheetData[] }): string {
  const sheets = wb.worksheets.map((ws) => ({
    title: ws.title,
    buildMode: ws.buildMode,
    activeTask: ws.activeTask,
    ...(ws.buildMode === 'turbot' ? { innerMode: ws.innerMode ?? 'CC', arena: ws.arena ?? null } : {}),
    circuit: structureOfCircuit(ws.circuit),
    boxes: ws.boxes ?? [],
    confirmedBoxes: (ws.confirmedBoxes ?? []).map((b) => ({
      ...b,
      internalComponents: b.internalComponents.map(structureOfComponent),
      internalWires: b.internalWires.map(structureOfWire),
    })),
  }));
  // Through JSON first, so live state (undefined fields, undefined array
  // slots) and a parsed file of the same content give the same string.
  return canonicalJson(JSON.parse(JSON.stringify(sheets)));
}

/** The key, hashed: what the store keeps as the last save's baseline. */
export function workbookKeyHash(wb: { worksheets: WorksheetData[] }): string {
  return toHex(sha256(utf8(workbookContentKey(wb))));
}

// ─── Writing a file ───────────────────────────────────────────────────

/** A workbook as the text of its file: indented for a person to read while
 *  that fits under Open's size cap, compact otherwise — the same data at less
 *  than half the size, so indentation alone never makes a file Open refuses. */
export function serializeWorkbook(workbook: WorkbookData): string {
  const indented = JSON.stringify(workbook, null, 2);
  return utf8(indented).length <= MAX_WORKBOOK_FILE_CHARS ? indented : JSON.stringify(workbook);
}

/** Why Open would refuse `text` as a workbook file, or null. The size is the
 *  UTF-8 bytes the saved file will hold — what Open's check reads from a
 *  picked file — and the content goes through Open's own parse. Save asks
 *  before it writes: a file Open refuses is not a save. */
export function unopenableReason(text: string): string | null {
  const tooBig = oversizeReason(utf8(text).length);
  if (tooBig) return tooBig;
  const parsed = parseWorkbookFile(text);
  return parsed.ok ? null : parsed.reason;
}

// ─── File names ───────────────────────────────────────────────────────

/** A file name for a workbook titled `title`: characters no file system takes
 *  replaced, `.json` on the end. */
export function suggestedFileName(title: string): string {
  const base = title
    // eslint-disable-next-line no-control-regex
    .replace(/[/\\:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/\.json$/i, '')
    .slice(0, 100)
    .trim();
  return `${base || 'workbook'}.json`;
}

/** The workbook title a file name stands for ('adder.json' → 'adder'); ''
 *  when there is none. */
export function titleFromFileName(name: string | null | undefined): string {
  if (!name) return '';
  const base = name.split(/[/\\]/).pop() ?? '';
  return base.replace(/\.json$/i, '').trim();
}
