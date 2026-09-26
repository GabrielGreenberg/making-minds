// Headless pins for the sandbox workbook FILE (task 028): File ▸ New / Open… /
// Save / Save as… in the sandbox chrome (components/WorkbookFileMenu.tsx),
// over the store's newWorkbook / exportWorkbook / importWorkbook /
// markWorkbookSaved, the pure workbookFile.ts and the browser fileHandle.ts.
//
//   cd app && npx tsx tools/workbookFileCheck.ts
//
// [round trip]     export → New → import gives the same workbook: a fixed
//                  point of exportWorkbook, every tab / circuit / box / saved
//                  box / brain / arena / active tab as it was, no assignment,
//                  no undo, and the imported CC sheet still computes.
// [legacy]         a single-circuit file opens as one worksheet.
// [invalid files]  each bad file says why and changes nothing; a dangling
//                  active sheet falls back to the first.
// [unsaved]        the unsaved-changes baseline: edits count, toggles / runs /
//                  tab switches / zoom don't; the baseline is what was WRITTEN.
// [download]       a download is not a save: the baseline stays, New / Open
//                  still ask (saying it was downloaded) until a file holds it.
// [file size]      Save never writes a file Open refuses: indented while that
//                  fits under the cap, compact past it; over the cap (in UTF-8
//                  bytes) or invalid → refused before writing; what WAS
//                  written is read back without the cap.
// [sandbox only]   an open assignment is never exported, never written over
//                  by an import (its live edit is folded and saved), and a
//                  copy from an opened file can't be pasted into it (law 8).
// [principal]      the baseline moves with the sandbox (the visitor's to a
//                  first-time signer-in); the file handle never does (law 6).
// [file handle]    fileHandle.ts's tagged results on both paths — the File
//                  System Access pickers (stubbed) and the download / file
//                  input fallback — cancel ≠ failure ≠ save.
// [names]          suggestedFileName / titleFromFileName.
// [menu wiring]    the menu's contract, pinned in its source (no DOM here).
// [grep gate]      the file code is local (law 5), workbookFile.ts is pure,
//                  openWorkbook is gone, importWorkbook has two callers.
//
// What a headless run cannot prove — the real native Save/Open dialogs — is
// owed to a browser (the task file's ## Verify).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// The store registers window/document listeners at import time, so install
// minimal shims BEFORE importing it. The document also serves fileHandle.ts
// (createElement / body) and the window its pickers, stubbed per case below.
const noop = () => {};
const backing = new Map<string, string>();
(globalThis as unknown as Record<string, unknown>).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
  get length() { return backing.size; },
  key: (i: number) => [...backing.keys()][i] ?? null,
};
type FakeWindow = Record<string, unknown>;
const win: FakeWindow = {
  setInterval: setInterval.bind(globalThis),
  clearInterval: clearInterval.bind(globalThis),
  addEventListener: noop,
  removeEventListener: noop,
};
(globalThis as unknown as Record<string, unknown>).window = win;

/** What the fake DOM saw fileHandle.ts do. */
const dom = {
  appended: [] as FakeEl[],
  clicked: [] as FakeEl[],
  removed: [] as FakeEl[],
  // How a clicked file input behaves: 'cancel' fires cancel, a file fires change.
  inputBehaviour: 'cancel' as 'cancel' | { name: string; text: string } | 'nothing',
};
class FakeEl {
  tag: string;
  style: Record<string, string> = {};
  href = '';
  download = '';
  type = '';
  accept = '';
  files: unknown[] | null = null;
  listeners = new Map<string, () => void>();
  constructor(tag: string) { this.tag = tag; }
  addEventListener(ev: string, fn: () => void) { this.listeners.set(ev, fn); }
  remove() { dom.removed.push(this); }
  click() {
    dom.clicked.push(this);
    if (this.tag !== 'input') return;
    const b = dom.inputBehaviour;
    if (b === 'cancel') this.listeners.get('cancel')?.();
    else if (b !== 'nothing') {
      this.files = [fakeFile(b.name, b.text)];
      this.listeners.get('change')?.();
    }
  }
}
(globalThis as unknown as Record<string, unknown>).document = {
  addEventListener: noop,
  removeEventListener: noop,
  visibilityState: 'visible',
  createElement: (tag: string) => new FakeEl(tag),
  body: { appendChild: (el: FakeEl) => { dom.appended.push(el); return el; } },
};
let activation = true;
Object.defineProperty(globalThis, 'navigator', {
  value: { platform: 'test', get userActivation() { return { isActive: activation }; } },
  configurable: true,
  writable: true,
});
const objectUrls = { created: 0, revoked: 0 };
URL.createObjectURL = () => `blob:fake/${++objectUrls.created}`;
URL.revokeObjectURL = () => void objectUrls.revoked++;

function fakeFile(name: string, text: string) {
  return { name, size: text.length, text: async () => text };
}

const { useStore, hasUnsavedWorkbookChanges, workbookSaveState, captureSandboxSession } = await import('../src/store');
const {
  parseWorkbookFile, suggestedFileName, titleFromFileName, MAX_WORKBOOK_FILE_CHARS,
  serializeWorkbook, unopenableReason, oversizeReason,
} = await import('../src/workbookFile');
const { saveFile, saveFileAs, downloadFile, openWorkbookFile } = await import('../src/fileHandle');
const { refusalMessage } = await import('../src/provenance');
const { INTEGRITY_NOTICE } = await import('../src/provenance/notice');
const { buildSampleAssignment, SAMPLE_ASSIGNMENT_ID } = await import('../src/devData/sampleData');
const { localAssignmentStore } = await import('../src/storage/AssignmentStore');
const { workbookStore } = await import('../src/storage/backend');

let failures = 0;
let passes = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { passes++; console.log(`  ✓ ${name}`); }
  else { failures++; console.log(`  ✗ ${name}${detail ? `\n        → ${detail}` : ''}`); }
}
const S = () => useStore.getState();
const flush = () => new Promise((r) => setTimeout(r, 10));
/** An export with the timestamps (the only fields that change per call) blanked. */
const stable = (json: string) => {
  const wb = JSON.parse(json);
  return JSON.stringify({ ...wb, metadata: { ...wb.metadata, createdAt: '', updatedAt: '' } });
};
/** Every sheet's circuit with the live canvas folded in (the sandbox is live). */
const liveSheets = () => {
  const s = S();
  const m = new Map(s.tabCircuits);
  m.set(s.activeTabId, { components: s.components, wires: s.wires, boxes: s.boxes, confirmedBoxes: s.confirmedBoxLibrary });
  return Object.fromEntries(s.tabs.map((t) => [t.id, m.get(t.id)]));
};
/** A copy without the run state (values a toggle or a run writes). */
const structural = (x: unknown) =>
  JSON.stringify(x, (k, v) => (k === 'value' || k === 'inputValues' || k === 'storedValue' ? undefined : v));
/** The ids added by `fn` to the live canvas. */
function added(fn: () => void): string[] {
  const before = new Set(S().components.map((c) => c.id));
  fn();
  return S().components.filter((c) => !before.has(c.id)).map((c) => c.id);
}

// Build a wired INPUT×2 → AND → OUTPUT on the live canvas, draw a box
// around it and confirm it. Returns the component ids and the box id.
function buildBoxedAnd() {
  const [in1, in2, and, out] = added(() => {
    S().addComponent('INPUT', 200, 180);
    S().addComponent('INPUT', 200, 260);
    S().addComponent('AND', 320, 200);
    S().addComponent('OUTPUT', 460, 210);
  });
  S().addWire(in1, 'out', and, 'in1');
  S().addWire(in2, 'out', and, 'in2');
  S().addWire(and, 'out', out, 'in');
  const boxId = 'box-roundtrip';
  S().addBox({ id: boxId, name: '', x: 150, y: 120, width: 400, height: 220, componentIds: [], inputPortIds: [], outputPortIds: [] });
  const err = S().confirmBox(boxId);
  if (err) throw new Error(`confirmBox failed: ${err}`);
  return { in1, in2, and, out, boxId };
}
/** Two STATEs and one labelled transition with a curve point. */
function buildStates(label: string) {
  const [s1, s2] = added(() => {
    S().addComponent('STATE', 100, 100);
    S().addComponent('STATE', 300, 100);
  });
  S().addWire(s1, 'right', s2, 'left');
  const w = S().wires.find((x) => x.sourceComponentId === s1 && x.targetComponentId === s2)!;
  S().setTransitionLabel(w.id, label);
  S().setFsmControlPt(w.id, { x: 200, y: 40 });
  return { s1, s2, wireId: w.id };
}

// The visitor is in charge (a principal is reported before anything is saved).
S().resetForPrincipal(null);

// ─── [round trip] ─────────────────────────────────────────────────────
console.log('[round trip]');
const round = await (async () => {
  S().newWorkbook();
  await flush();
  const ccTab = S().activeTabId;
  const cc = buildBoxedAnd();
  S().renameTab(ccTab, 'Adder');

  S().addTab('Sequential 1', 'SC');
  const [scIn, mem] = added(() => {
    S().addComponent('INPUT', 60, 100);
    S().addComponent('MEM', 200, 100);
  });
  S().addWire(scIn, 'out', mem, 'mout');

  S().addTab('Finite State Machine 1', 'FSM');
  const fsmTab = S().activeTabId;
  const fsm = buildStates('1:0');

  S().addTab('Turing Machine 1', 'TM');
  buildStates('1:0,R');

  S().addTab('Turbot 1', 'turbot', 'turbot', 'FSM');
  const turbotTab = S().activeTabId;
  const arena = structuredClone(S().tabs.find((t) => t.id === turbotTab)!.arena!);
  arena.cells[2][3] = 'block';
  S().setTabArena(arena);
  buildStates('0:11');

  S().switchTab(fsmTab);
  await flush();

  const beforeTabs = JSON.stringify(S().tabs);
  const beforeSheets = structural(liveSheets());
  const json1 = S().exportWorkbook();
  check('the export carries the integrity notice', JSON.parse(json1).notice === INTEGRITY_NOTICE);

  S().newWorkbook();
  await flush();
  check('New leaves one empty sheet', S().tabs.length === 1 && S().components.length === 0);
  const r = S().importWorkbook(json1);
  check('importWorkbook(export) → ok', r.ok);
  const json2 = S().exportWorkbook(); // before the import's deferred evaluate
  check('export → import → export is a fixed point (timestamps aside)', stable(json2) === stable(json1));
  check('the tabs (titles, machines, brain, arena) are as they were', JSON.stringify(S().tabs) === beforeTabs);
  check('every sheet (circuit, drawn boxes, saved boxes) is as it was', structural(liveSheets()) === beforeSheets);
  check('the FSM tab is active again, its transition intact',
    S().activeTabId === fsmTab && S().buildMode === 'FSM' &&
    S().wires.some((w) => w.id === fsm.wireId && w.transitionLabel === '1:0' && w.fsmControlPt?.x === 200));
  check('the turbot tab keeps its FSM brain and edited arena',
    S().tabs.find((t) => t.id === turbotTab)?.innerMode === 'FSM' &&
    S().tabs.find((t) => t.id === turbotTab)?.arena?.cells[2][3] === 'block');
  check('no assignment, no undo, no redo', S().assignment === null && S().undoStack.length === 0 && S().redoStack.length === 0);
  check('the workbook is open', S().workbookOpen);

  S().switchTab(ccTab);
  await flush();
  check('the CC sheet keeps its confirmed box and drawn box',
    S().confirmedBoxLibrary.some((b) => b.id === cc.boxId) && S().boxes.some((b) => b.id === cc.boxId));
  S().setInputValue(cc.in1, 1);
  S().setInputValue(cc.in2, 1);
  S().evaluateCircuit();
  const outOn = S().components.find((c) => c.id === cc.out)?.value;
  S().setInputValue(cc.in2, 0);
  S().evaluateCircuit();
  const outOff = S().components.find((c) => c.id === cc.out)?.value;
  check(`the imported AND computes (1·1 → ${outOn}, 1·0 → ${outOff})`, outOn === 1 && outOff === 0);
  return { json1, ccTab };
})();

// ─── [legacy] ─────────────────────────────────────────────────────────
console.log('\n[legacy]');
{
  const comp = (id: string, type: string, x: number) => ({ id, type, x, y: 40, label: type, ports: [] });
  const r = S().importWorkbook(JSON.stringify({
    metadata: { title: 'Old adder', buildType: 'CC' },
    circuit: { components: [comp('l1', 'INPUT', 0), comp('l2', 'NOT', 80)], wires: [] },
  }));
  check('a legacy single-circuit file opens', r.ok);
  check('…as one worksheet holding its circuit',
    S().tabs.length === 1 && S().tabs[0].title === 'Old adder' && S().components.map((c) => c.id).join() === 'l1,l2');
  check('…under its title', S().workbookTitle === 'Old adder');
}

// ─── [invalid files] ──────────────────────────────────────────────────
console.log('\n[invalid files]');
{
  S().importWorkbook(round.json1);
  const base = JSON.parse(round.json1);
  const mutate = (fn: (wb: typeof base) => void) => {
    const wb = structuredClone(base);
    fn(wb);
    return JSON.stringify(wb);
  };
  const turbotIdx = base.worksheets.findIndex((w: { buildMode: string }) => w.buildMode === 'turbot');
  const ccIdx = 0;
  const bad: [string, string][] = [
    ['not JSON', '{ "formatVersion": 2, '],
    ['a JSON array', '[1, 2, 3]'],
    ['formatVersion 2 without worksheets', JSON.stringify({ formatVersion: 2, metadata: { title: 'x' } })],
    ['no worksheets', mutate((wb) => { wb.worksheets = []; })],
    ['duplicate worksheet ids', mutate((wb) => { wb.worksheets[1].id = wb.worksheets[0].id; })],
    ["buildMode 'open'", mutate((wb) => { wb.worksheets[0].buildMode = 'open'; })],
    ['an unknown component type', mutate((wb) => { wb.worksheets[ccIdx].circuit.components[0].type = 'FLUX'; })],
    ['a duplicate component id', mutate((wb) => {
      const cs = wb.worksheets[ccIdx].circuit.components;
      cs[1].id = cs[0].id;
    })],
    ['a wire to a missing component', mutate((wb) => { wb.worksheets[ccIdx].circuit.wires[0].targetComponentId = 'nobody'; })],
    ['a turbot start outside its arena', mutate((wb) => { wb.worksheets[turbotIdx].arena.start.x = 99; })],
    ['an arena over the size cap', mutate((wb) => {
      const a = wb.worksheets[turbotIdx].arena;
      a.width = 31;
      a.cells = a.cells.map((row: string[]) => [...row, ...Array(31 - row.length).fill('empty')]);
    })],
    ['a transition label that is not a string', mutate((wb) => {
      const fsm = wb.worksheets.find((w: { buildMode: string }) => w.buildMode === 'FSM');
      fsm.circuit.wires[0].transitionLabel = 7;
    })],
    ['text over the size cap', ' '.repeat(MAX_WORKBOOK_FILE_CHARS) + '{}'],
  ];
  for (const [what, text] of bad) {
    const tabs = S().tabs;
    const key = S().workbookSavedKey;
    const comps = S().components;
    const r = S().importWorkbook(text);
    check(`${what}: refused with a reason, nothing changed${r.ok ? '' : ` ("${r.reason.slice(0, 70)}")`}`,
      !r.ok && r.reason.length > 0 && S().tabs === tabs && S().workbookSavedKey === key && S().components === comps);
  }
  const dangling = mutate((wb) => { wb.activeWorksheetId = 'no-such-sheet'; });
  const r = S().importWorkbook(dangling);
  check('a dangling activeWorksheetId opens on the first sheet', r.ok && S().activeTabId === base.worksheets[0].id);
  check('a label is never parsed by the file check (law 4): any string opens',
    parseWorkbookFile(mutate((wb) => {
      wb.worksheets.find((w: { buildMode: string }) => w.buildMode === 'FSM').circuit.wires[0].transitionLabel = '¿?';
    })).ok);
}

// ─── [unsaved] ────────────────────────────────────────────────────────
console.log('\n[unsaved]');
{
  const unsaved = () => hasUnsavedWorkbookChanges(S());
  const markSaved = () => S().markWorkbookSaved(S().exportWorkbook(), null);
  S().newWorkbook();
  check('after New: nothing unsaved', !unsaved());
  S().addComponent('AND', 100, 100);
  check('a component added: unsaved', unsaved());
  S().undo();
  check('…undone: nothing unsaved', !unsaved());

  const [inId, memId] = added(() => {
    S().addComponent('INPUT', 40, 40);
    S().addComponent('MEM', 160, 40);
  });
  S().addWire(inId, 'out', memId, 'mout');
  markSaved();
  check('markWorkbookSaved(the export): nothing unsaved', !unsaved());
  S().setInputValue(inId, 1);
  S().evaluateCircuit();
  check('an INPUT toggle: nothing unsaved', !unsaved());
  S().scStep();
  S().scStep();
  check(`a run (MEM holds ${S().components.find((c) => c.id === memId)?.storedValue}): nothing unsaved`, !unsaved());
  S().scGlobalReset();

  S().addTab('Circuit 2', 'CC');
  check('a new tab: unsaved', unsaved());
  markSaved();
  S().switchTab(S().tabs[0].id);
  S().switchTab(S().tabs[1].id);
  check('switching tabs: nothing unsaved', !unsaved());
  S().setZoom(2);
  S().setPan(40, -20);
  check('zoom and pan: nothing unsaved', !unsaved());

  S().switchTab(S().tabs[0].id);
  const inComp = S().components.find((c) => c.id === inId)!;
  S().moveComponent(inId, inComp.x + 40, inComp.y);
  check('moving a component: unsaved', unsaved());
  markSaved();
  S().renameTab(S().tabs[1].id, 'Scratch');
  check('renaming a tab: unsaved', unsaved());
  markSaved();
  check('saved again: nothing unsaved', !unsaved());

  // The baseline is the JSON WRITTEN, not the state at the time of marking:
  // an edit made while the picker was open is still unsaved.
  const written = S().exportWorkbook();
  S().addComponent('OR', 300, 300);
  S().markWorkbookSaved(written, null);
  check('an edit made after the JSON was written stays unsaved', unsaved());
  const titled = S().exportWorkbook();
  S().markWorkbookSaved(titled, null, 'my adder.json');
  check("the saved file's name titles the workbook", S().workbookTitle === 'my adder');
  check('…and a new title is not a change', !unsaved());

  S().importWorkbook(round.json1, null, 'from disk.json');
  check('after Open: nothing unsaved, titled by the file', !unsaved() && S().workbookTitle === 'from disk');

  useStore.setState({ scHistory: [{ t: 1, inputBits: [1], outputBits: [0], memValues: [0] }], fsmTimeStep: 4 });
  S().newWorkbook('FSM', undefined, 'Finite State Machine 1');
  const s = S();
  check("New ▸ FSM: one FSM sheet, nothing unsaved",
    s.tabs.length === 1 && s.tabs[0].buildMode === 'FSM' && s.buildMode === 'FSM' && !unsaved());
  check('…with every run fresh and no history',
    s.scHistory.length === 0 && s.fsmTimeStep === 1 && s.undoStack.length === 0 && s.redoStack.length === 0);
  S().newWorkbook('turbot', 'TM', 'Turbot 1');
  check('New ▸ Turbot ▸ TM brain: a turbot sheet with its brain and the starter arena',
    S().tabs[0].buildMode === 'turbot' && S().tabs[0].innerMode === 'TM' && S().tabs[0].arena != null && !unsaved());
}

// ─── [download] ───────────────────────────────────────────────────────
console.log('\n[download]');
{
  const state = () => workbookSaveState(S());
  S().newWorkbook();
  const handle = { name: 'kept.json' } as unknown as FileSystemFileHandle;
  S().markWorkbookSaved(S().exportWorkbook(), handle, 'kept.json');
  const baseline = S().workbookSavedKey;
  S().addComponent('AND', 100, 100);
  check('an edit: unsaved', state() === 'unsaved' && hasUnsavedWorkbookChanges(S()));
  S().markWorkbookDownloaded(S().exportWorkbook());
  check('a download is not a save: New and Open still ask (as downloaded)',
    state() === 'downloaded' && hasUnsavedWorkbookChanges(S()));
  check('…the baseline is untouched, the title kept, the handle dropped',
    S().workbookSavedKey === baseline && S().workbookTitle === 'kept' && S().workbookFileHandle === null);
  S().addComponent('OR', 300, 300);
  check('an edit after the download: plainly unsaved', state() === 'unsaved');
  S().undo();
  check('…undone: the downloaded content again', state() === 'downloaded');
  S().markWorkbookSaved(S().exportWorkbook(), handle, 'kept.json');
  check('a save to a picked file: saved, the download forgotten', state() === 'saved' && S().workbookDownloadedKey === null);

  const downloadThen = (label: string, fn: () => void) => {
    S().addComponent('XOR', 500, 100);
    S().markWorkbookDownloaded(S().exportWorkbook());
    fn();
    check(`${label} forgets the download`, S().workbookDownloadedKey === null);
  };
  downloadThen('New', () => S().newWorkbook());
  downloadThen('Open', () => S().importWorkbook(round.json1));
  downloadThen('closing the workbook', () => S().closeWorkbook());
  S().newWorkbook();
}

// ─── [file size] ──────────────────────────────────────────────────────
console.log('\n[file size]');
{
  const cap = MAX_WORKBOOK_FILE_CHARS;
  const unsaved = () => hasUnsavedWorkbookChanges(S());
  // A big sandbox: a wired INPUT×2 → AND → OUTPUT, replicated on the live
  // canvas (set directly — a thousand undo snapshots would be the slow part).
  S().newWorkbook();
  const [in1, in2, and, out] = added(() => {
    S().addComponent('INPUT', 20, 20);
    S().addComponent('INPUT', 20, 80);
    S().addComponent('AND', 140, 40);
    S().addComponent('OUTPUT', 260, 50);
  });
  S().addWire(in1, 'out', and, 'in1');
  S().addWire(in2, 'out', and, 'in2');
  S().addWire(and, 'out', out, 'in');
  const unitComps = S().components;
  const unitWires = S().wires;
  const replicate = (n: number) => {
    const suffix = (id: string, i: number) => `${id}-r${i}`;
    const components = [];
    const wires = [];
    for (let i = 0; i < n; i++) {
      for (const c of unitComps) components.push({ ...c, id: suffix(c.id, i), y: c.y + 120 * i });
      for (const w of unitWires) {
        wires.push({ ...w, id: suffix(w.id, i), sourceComponentId: suffix(w.sourceComponentId, i), targetComponentId: suffix(w.targetComponentId, i) });
      }
    }
    useStore.setState({ components, wires });
  };
  replicate(100);
  const perUnit = JSON.stringify(JSON.parse(S().exportWorkbook()), null, 2).length / 100;
  const n = Math.ceil((cap * 1.15) / perUnit);
  replicate(n);
  const exported = S().exportWorkbook();
  const indentedLen = JSON.stringify(JSON.parse(exported), null, 2).length;
  check(`(setup) ${n} wired ANDs: ${(indentedLen / 1e6).toFixed(1)} MB indented, over the cap; ${(exported.length / 1e6).toFixed(1)} MB as exported`,
    indentedLen > cap);
  check('its export is compact (one line), under the cap', exported.length <= cap && !exported.includes('\n'));
  check('…so Save may write it (unopenableReason: none) and Open reads it back',
    unopenableReason(exported) === null && parseWorkbookFile(exported).ok);
  check('…and saving it leaves nothing unsaved', unsaved() && (S().markWorkbookSaved(exported, null), !unsaved()));
  S().newWorkbook();
  const small = S().exportWorkbook();
  check('a small workbook still exports indented', small.includes('\n  "worksheets"'));
  check('serializeWorkbook is the export (indented while it fits)', serializeWorkbook(JSON.parse(small)) === small);

  // What WAS written is saved, whatever its size: markWorkbookSaved reads it
  // back without Open's cap (else a save would leave the prompt up forever).
  S().addComponent('AND', 100, 100);
  const padded = S().exportWorkbook() + ' '.repeat(cap);
  check('(setup) Open refuses the padded text', !parseWorkbookFile(padded).ok);
  S().markWorkbookSaved(padded, null);
  check('markWorkbookSaved of an over-cap written file: nothing unsaved', !unsaved());

  // Save asks before writing — sized as the file's UTF-8 bytes, as Open
  // measures a picked file, and through Open's own parse.
  check('Save refuses text over the cap', unopenableReason(padded) === oversizeReason(padded.length) && oversizeReason(padded.length) !== null);
  const wide = JSON.stringify({ ...JSON.parse(small), pad: 'é'.repeat(Math.ceil(cap / 2) + 1000) });
  check(`Save refuses a file over the cap in bytes though not in characters (${(wide.length / 1e6).toFixed(1)} M chars)`,
    wide.length <= cap && parseWorkbookFile(wide).ok && unopenableReason(wide) !== null);
  const invalid = JSON.stringify({ ...JSON.parse(small), worksheets: [] });
  check("Save refuses content Open turns away, with Open's reason",
    unopenableReason(invalid) !== null && unopenableReason(invalid) === (parseWorkbookFile(invalid) as { reason: string }).reason);
  check('the cap itself is allowed; one over is not', oversizeReason(cap) === null && oversizeReason(cap + 1) !== null);
  S().newWorkbook();
}

// ─── [sandbox only] ───────────────────────────────────────────────────
console.log('\n[sandbox only]');
{
  const assignment = buildSampleAssignment();
  await localAssignmentStore.save(assignment);
  await localAssignmentStore.setVisible(SAMPLE_ASSIGNMENT_ID, true);

  S().importWorkbook(round.json1);
  const sandboxTabs = S().tabs.map((t) => t.id).join();
  S().goHome();
  check('the sample assignment opens', await S().openAssignment(SAMPLE_ASSIGNMENT_ID));
  S().switchQuestion(0);
  await flush();
  check('Q1 is a CC canvas', S().buildMode === 'CC');
  const [liveId] = added(() => S().addComponent('AND', 420, 420));
  const exported = S().exportWorkbook();
  check("with an assignment open, the export holds none of its canvas", !exported.includes(liveId));
  check('…and still holds the sandbox tabs',
    JSON.parse(exported).worksheets.map((w: { id: string }) => w.id).join() === sandboxTabs);

  const small = JSON.stringify({
    formatVersion: 2,
    metadata: { title: 'Small' },
    activeWorksheetId: 'imp-1',
    worksheets: [{
      id: 'imp-1', title: 'Imported', buildMode: 'CC', activeTask: 'arithmetic',
      circuit: { components: [{ id: 'imp-and', type: 'AND', x: 0, y: 0, label: 'AND', ports: [] }], wires: [] },
      boxes: [],
    }],
  });
  const r = S().importWorkbook(small);
  await flush();
  check('importing with an assignment open: ok, and the assignment is left', r.ok && S().assignment === null);
  check('…the file opened as sandbox tabs', S().tabs.map((t) => t.id).join() === 'imp-1' && S().components[0]?.id === 'imp-and');
  const saved = JSON.stringify(await workbookStore.loadAssignmentState(SAMPLE_ASSIGNMENT_ID));
  check("…the assignment's saved workbook kept the live edit (folded, not lost)", saved.includes(liveId));
  check('…and holds nothing from the file', !saved.includes('imp-and'));

  // A copy from an opened file is sandbox content: refused in an assignment.
  S().setSelectedIds(['imp-and']);
  S().copySelected();
  await S().openAssignment(SAMPLE_ASSIGNMENT_ID);
  S().switchQuestion(0);
  await flush();
  const count = S().components.length;
  const msg = S().paste();
  check("paste of a file's component into a CC question: refused as sandbox content",
    msg === refusalMessage('from-sandbox'), String(msg));
  check('…and the canvas is unchanged', S().components.length === count);
  S().goHome();
}

// ─── [principal] ──────────────────────────────────────────────────────
console.log('\n[principal]');
{
  const A = 'wf-a@x.test';
  const B = 'wf-b@x.test';
  S().resetForPrincipal(null);
  S().enterSandbox();
  S().importWorkbook(round.json1);
  const handle = { name: 'visitor.json' } as unknown as FileSystemFileHandle;
  S().markWorkbookSaved(S().exportWorkbook(), handle, 'visitor.json');
  const key = S().workbookSavedKey;
  const stillHere = captureSandboxSession();
  check('a session capture holds while nothing changes', stillHere());
  check('the visitor has a handle and nothing unsaved', S().workbookFileHandle === handle && !hasUnsavedWorkbookChanges(S()));

  S().resetForPrincipal(A); // A has no sandbox of their own: the visitor's moves
  check("A (no sandbox of their own) receives the visitor's opened tabs",
    S().tabs.map((t) => t.id).join() === JSON.parse(round.json1).worksheets.map((w: { id: string }) => w.id).join());
  check('…with its baseline: nothing unsaved', S().workbookSavedKey === key && !hasUnsavedWorkbookChanges(S()));
  check('…but not the file handle (it was the visitor\'s)', S().workbookFileHandle === null);
  check('the capture taken before the change no longer holds', !stillHere());

  S().enterSandbox();
  S().markWorkbookSaved(S().exportWorkbook(), handle, 'a.json');
  S().resetForPrincipal(B);
  check('a change to someone else clears the handle', S().workbookFileHandle === null);
  S().resetForPrincipal(A);
  check("A's baseline survives the round trip through the blob",
    S().workbookSavedKey === key && !hasUnsavedWorkbookChanges(S()) && S().workbookTitle === 'a');
  S().markWorkbookDownloaded(S().exportWorkbook());
  check('(setup) A has a download on record', S().workbookDownloadedKey !== null);
  S().resetForPrincipal(B);
  check("a change to someone else forgets the download record (A's, memory only)", S().workbookDownloadedKey === null);
}

// ─── [file handle] ────────────────────────────────────────────────────
console.log('\n[file handle]');
{
  const reset = () => {
    dom.appended.length = 0;
    dom.clicked.length = 0;
    dom.removed.length = 0;
    delete win.showSaveFilePicker;
    delete win.showOpenFilePicker;
    activation = true;
  };
  const writes: string[] = [];
  const handleNamed = (name: string, opts: { failWrite?: boolean } = {}) => ({
    name,
    createWritable: async () => {
      if (opts.failWrite) throw new DOMException('gone', 'NotFoundError');
      let buf = '';
      return { write: async (d: string) => void (buf += d), close: async () => void writes.push(buf) };
    },
  }) as unknown as FileSystemFileHandle;
  const json = '{"formatVersion":2}';

  // The fallback: no pickers in this browser.
  reset();
  const dl = await saveFile(json, null, 'adder.json');
  check('no save picker → a download named as suggested', dl.kind === 'downloaded' && dl.name === 'adder.json');
  const a = dom.appended[0];
  check('…through an anchor appended, clicked and removed',
    a?.tag === 'a' && a.download === 'adder.json' && dom.clicked.includes(a) && dom.removed.includes(a));
  check('…whose object URL is revoked later, not at once', objectUrls.created === 1 && objectUrls.revoked === 0);
  check('downloadFile names its file', downloadFile(json, 'x.json').kind === 'downloaded');

  // The picker path.
  reset();
  win.showSaveFilePicker = async () => handleNamed('picked.json');
  const saved = await saveFileAs(json, 'adder.json');
  check('Save as with a picker → saved, the handle and its name',
    saved.kind === 'saved' && saved.name === 'picked.json' && writes.at(-1) === json);
  let pickerCalls = 0;
  win.showSaveFilePicker = async () => { pickerCalls++; return handleNamed('other.json'); };
  const again = await saveFile(json + ' ', handleNamed('kept.json'), 'adder.json');
  check('Save with a handle writes it, no picker', again.kind === 'saved' && again.name === 'kept.json' && pickerCalls === 0);
  const moved = await saveFile(json, handleNamed('gone.json', { failWrite: true }), 'adder.json');
  check('a handle that can\'t be written any more → Save as', moved.kind === 'saved' && moved.name === 'other.json' && pickerCalls === 1);
  win.showSaveFilePicker = async () => { throw new DOMException('dismissed', 'AbortError'); };
  check('dismissing the save picker is a cancel', (await saveFileAs(json, 'a.json')).kind === 'cancelled');
  dom.appended.length = 0;
  win.showSaveFilePicker = async () => { throw new DOMException('no gesture', 'SecurityError'); };
  const refused = await saveFileAs(json, 'a.json');
  check('a picker refusing (SecurityError) → a download', refused.kind === 'downloaded' && dom.appended[0]?.tag === 'a');
  win.showSaveFilePicker = 'not a function';
  check('a non-callable showSaveFilePicker is no picker (typeof, not in)', (await saveFileAs(json, 'b.json')).kind === 'downloaded');

  // Open with the picker.
  reset();
  const file = fakeFile('adder.json', round.json1);
  win.showOpenFilePicker = async () => [{ name: 'adder.json', getFile: async () => file }];
  const opened = await openWorkbookFile();
  check('Open with a picker → the text, the handle and the name',
    opened.kind === 'opened' && opened.text === round.json1 && opened.handle !== null && opened.name === 'adder.json');
  win.showOpenFilePicker = async () => { throw new DOMException('dismissed', 'AbortError'); };
  const cancelled = await openWorkbookFile();
  check('dismissing the open picker is a cancel — never a second dialog',
    cancelled.kind === 'cancelled' && dom.appended.length === 0);
  win.showOpenFilePicker = async () => { throw new DOMException('no gesture', 'SecurityError'); };
  activation = false;
  const blocked = await openWorkbookFile();
  check('a refused picker with no activation → failed, no file input clicked (it would hang)',
    blocked.kind === 'failed' && dom.clicked.length === 0);
  win.showOpenFilePicker = async () => [{ name: 'huge.json', getFile: async () => ({ name: 'huge.json', size: MAX_WORKBOOK_FILE_CHARS + 1, text: async () => '' }) }];
  const huge = await openWorkbookFile();
  check('a file over the cap is refused before it is read', huge.kind === 'failed' && huge.name === 'huge.json');

  // Open with the file input (no picker).
  reset();
  dom.inputBehaviour = { name: 'legacy.json', text: '{"circuit":{"components":[],"wires":[]}}' };
  const viaInput = await openWorkbookFile();
  check('no open picker → the file input; a pick → the text, no handle',
    viaInput.kind === 'opened' && viaInput.handle === null && viaInput.name === 'legacy.json' &&
    dom.appended[0]?.tag === 'input' && dom.removed.includes(dom.appended[0]));
  reset();
  dom.inputBehaviour = 'cancel';
  const inputCancel = await openWorkbookFile();
  check("dismissing the file input resolves as a cancel (its 'cancel' event)", inputCancel.kind === 'cancelled');
  reset();
  activation = false;
  dom.inputBehaviour = 'nothing';
  const noGesture = await openWorkbookFile();
  check('no activation → the input is never clicked; failed with a reason', noGesture.kind === 'failed' && dom.clicked.length === 0);
  reset();
}

// ─── [names] ──────────────────────────────────────────────────────────
console.log('\n[names]');
{
  const odd = suggestedFileName('a/b\\c:d*e?f"g<h>i|j');
  check(`a title with / \\ : * ? " < > | gives a safe name (${odd})`, /^[^/\\:*?"<>|]+\.json$/.test(odd));
  check("'Adder' → 'Adder.json'", suggestedFileName('Adder') === 'Adder.json');
  check("an empty title → 'workbook.json'", suggestedFileName('   ') === 'workbook.json');
  check("'adder.json' stays 'adder.json'", suggestedFileName('adder.json') === 'adder.json');
  check("'adder.json' → 'adder'", titleFromFileName('adder.json') === 'adder');
  check("'Adder.JSON' → 'Adder'; none → ''", titleFromFileName('Adder.JSON') === 'Adder' && titleFromFileName(undefined) === '');
}

// ─── [menu wiring] + [grep gate] ─────────────────────────────────────
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '../src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\/|(?<=^|\s)\/\/[^\n]*/gm, '');

console.log('\n[menu wiring]');
{
  const menu = stripComments(read('components/WorkbookFileMenu.tsx'));
  const bar = stripComments(read('components/EditorTopBar.tsx'));
  /** Every token present, each after the one before (a missing one fails —
   *  never indexOf's -1 comparing as "before"). */
  const inOrder = (src: string, ...tokens: string[]) => {
    let at = 0;
    for (const t of tokens) {
      const i = src.indexOf(t, at);
      if (i < 0) return false;
      at = i + t.length;
    }
    return true;
  };
  /** The source between two markers, or '' when either is missing. */
  const between = (src: string, from: string, to: string) => {
    const i = src.indexOf(from);
    const j = i < 0 ? -1 : src.indexOf(to, i + from.length);
    return i < 0 || j < 0 ? '' : src.slice(i, j);
  };
  // The top bar's crumbs branch on the assignment: the File menu lives in the
  // sandbox branch (after its "Sandbox" crumb), never in an assignment's.
  const crumbs = between(bar, '<nav className="wb-crumbs"', '</nav>');
  check('the editor top bar shows the File menu only outside an assignment',
    inOrder(crumbs, '{assignment ? (', ') : (', 'Sandbox', '<WorkbookFileMenu />') &&
      (crumbs.match(/<WorkbookFileMenu/g) ?? []).length === 1 &&
      !between(crumbs, '{assignment ? (', ') : (').includes('WorkbookFileMenu'));
  check('…before the session controls (visitors and signed-in alike)',
    inOrder(bar, '<WorkbookFileMenu', '<SessionControls') && !/isVisitor[^\n]*WorkbookFileMenu|user[^\n]*&&[^\n]*WorkbookFileMenu/.test(bar));

  // The File ▾ dropdown's own markup — not the unsaved-changes modal, whose
  // buttons say Open… and Save too.
  const dropdown = between(menu, 'className="menu-dropdown"', 'className="workbook-name"');
  check('(setup) the File dropdown markup is found', dropdown.length > 0 && !dropdown.includes('mm-modal'));
  const item = (action: string, label: string) =>
    new RegExp(`className="menu-dropdown-item"\\s+onClick=\\{\\(\\)\\s*=>\\s*${action}\\s*\\}\\s*>\\s*${label}\\s*(<|\\{)`);
  check('the menu offers New worksheet ▸ — the shared machine list, each pick through the guard',
    /className="menu-dropdown-item"\s+onClick=\{\(\)\s*=>\s*setNewOpen\(true\)\s*\}\s*>\s*New worksheet\s*</.test(dropdown) &&
      /<MachineMenu\s+onPickMachine=\{newMachine\}\s+onPickTurbot=\{newTurbot\}/.test(dropdown) &&
      /const newMachine = [^;]*guarded\(\{ kind: 'new'/.test(menu) &&
      /const newTurbot = [^;]*guarded\(\{ kind: 'new'/.test(menu) &&
      /<MachineMenu\b/.test(read('components/TabBar.tsx')));
  check('the menu offers Open…, through the unsaved-changes guard',
    item(`guarded\\(\\{ kind: 'open' \\}\\)`, 'Open…').test(dropdown));
  check('the menu offers Save', item(`\\{ setOpen\\(false\\); void save\\(false\\); \\}`, 'Save').test(dropdown));
  check('the menu offers Save as… (always a picker)', item(`\\{ setOpen\\(false\\); void save\\(true\\); \\}`, 'Save as…').test(dropdown));

  const guarded = between(menu, 'const guarded', 'const saveThenContinue');
  check('New and Open ask workbookSaveState at click time, from the live store, before running',
    inOrder(guarded, 'workbookSaveState(useStore.getState())', "state !== 'saved'", "setPrompt({ step: 'ask'", 'else run(pending)'));
  const modal = menu.slice(Math.max(0, menu.indexOf('{prompt && (')));
  check("the question: Don't save · Cancel · Save",
    menu.includes('{prompt && (') && /Don't save/.test(modal) && />\s*Cancel\s*</.test(modal) && />\s*Save\s*</.test(modal));

  const openFn = between(menu, 'const openFile', 'const run');
  check('Open captures the session before the dialog and checks it before importing',
    inOrder(openFn, 'const stillHere = captureSandboxSession()', 'await openWorkbookFile()', 'if (!stillHere()) return', 'importWorkbook('));
  const saveFn = between(menu, 'const save =', 'const openFile');
  check('Save refuses, before any dialog, a file Open would refuse',
    inOrder(saveFn, 'exportWorkbook()', 'unopenableReason(json)', 'return null', 'await saveFile'));
  check('Save marks the WRITTEN json saved, only while the session holds',
    inOrder(saveFn, 'const stillHere = captureSandboxSession()', 'const json = ', 'await saveFile', 'if (!stillHere()) return null',
      'markWorkbookSaved(json, result.handle, result.name)'));
  const dlBranch = between(saveFn, "if (result.kind === 'downloaded')", "return { kind: 'downloaded'");
  check('a download is recorded as downloaded — never marked saved',
    inOrder(saveFn, 'if (!stillHere()) return null', "if (result.kind === 'downloaded')") &&
      dlBranch.includes('markWorkbookDownloaded(json)') && !dlBranch.includes('markWorkbookSaved') &&
      (saveFn.match(/markWorkbookSaved\(/g) ?? []).length === 1);
  const stc = between(menu, 'const saveThenContinue', 'useEffect(');
  check("the question's Save never replaces the work straight after a download: a second click does",
    inOrder(stc, 'await save(false)', "saved.kind === 'downloaded'", "setPrompt({ step: 'downloaded'", 'return;', 'run(pending)') &&
      /prompt\.step === 'downloaded' \?/.test(modal) &&
      inOrder(modal, "prompt.step === 'downloaded' ?", 'onClick={() => setPrompt(null)}', 'run(pending)'));
  check('…and the question says when the work was only downloaded',
    /prompt\.downloaded\s*\?/.test(modal) && /downloaded, but/.test(modal));
  check('an import that fails is reported (spec §1.7), never silent', /Couldn't open \$\{result\.name\}: \$\{imported\.reason\}/.test(menu));
  check('the menu holds no text field (the paste gate stays at its counts)', !/<(input|textarea)\b/.test(menu));
  check('Open after Save asks for a fresh click when the save used up the gesture',
    inOrder(stc, 'hasUserActivation()', "setPrompt({ step: 'pick-file'") &&
      inOrder(modal, 'Now choose the file to open', "run({ kind: 'open' })"));
}

console.log('\n[grep gate]');
{
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name)) files.push(p);
    }
  };
  walk(SRC);
  const rel = (f: string) => relative(SRC, f).split('\\').join('/');
  const importsOf = (src: string) => [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  for (const f of ['workbookFile.ts', 'fileHandle.ts', 'components/WorkbookFileMenu.tsx']) {
    const imports = importsOf(read(f));
    check(`${f} reaches no server (no api/, no storage/remote*)`,
      imports.every((i) => !/(^|\/)api(\/|$)|storage\/remote/.test(i)), imports.join(', '));
  }
  const pure = stripComments(read('workbookFile.ts'));
  check('workbookFile.ts is pure: no DOM or browser storage',
    !/\b(window|document|localStorage|sessionStorage|navigator|HTMLElement|Blob|alert)\b/.test(pure));
  check('workbookFile.ts imports no store and no React', importsOf(pure).every((i) => !/store|react/.test(i)));
  check('workbookFile.ts never dissects a transition label (law 4)', !/notation|\.split\(['"]:/.test(pure));
  const stragglers: string[] = [];
  const callers: string[] = [];
  for (const f of files) {
    stripComments(readFileSync(f, 'utf8')).split('\n').forEach((line, i) => {
      if (/\bopenWorkbook\b/.test(line)) stragglers.push(`${rel(f)}:${i + 1}`);
      if (/\bimportWorkbook\(/.test(line)) callers.push(rel(f));
    });
  }
  check('openWorkbook is gone', stragglers.length === 0, stragglers.join(', '));
  const callerFiles = [...new Set(callers)].sort();
  check("importWorkbook( is called only by the File menu (and the store itself)",
    callerFiles.includes('components/WorkbookFileMenu.tsx') &&
      callerFiles.every((f) => f === 'components/WorkbookFileMenu.tsx' || f === 'store.ts'), callerFiles.join(', '));
  const storeSrc = read('store.ts');
  const blob = storeSrc.slice(storeSrc.indexOf('function getAutoSaveData'), storeSrc.indexOf('function isCurrentQuestionLocked'));
  check('(setup) the sandbox blob is found (it carries the baseline)', /workbookSavedKey/.test(blob));
  check('the file handle is never persisted (not in the sandbox blob)', !/workbookFileHandle/.test(blob));
  check('nor the download record (memory only)', !/workbookDownloadedKey/.test(blob));
}

// ─── verdict ──────────────────────────────────────────────────────────
console.log(`\n${failures === 0 ? `WORKBOOK FILE CHECK OK (${passes} checks)` : `WORKBOOK FILE CHECK FAILED (${failures} of ${passes + failures} checks)`}`);
process.exit(failures === 0 ? 0 : 1);
