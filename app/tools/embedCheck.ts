// Headless pins for the embeddable sandbox (task 087): embed.html, one example
// machine in the editor's frame for the course website, never saving, never
// the course client.
//
//   cd app && npx tsx tools/embedCheck.ts          (part of `npm run check`)
//   cd app && npx tsx tools/embedCheck.ts --dist   (manual, after `npm run build`)
//
// [examples]      every public/embed-examples/*.json: a file name, a workbook
//                 (parseWorkbookFile) of exactly ONE worksheet with a human
//                 title, a poster (.png) beside it; openExample leaves one
//                 tab, no assignment, no undo, the sheet's machine; the modes
//                 cover CC, FSM and turbot; the default exists; each machine
//                 validates by the engine's own validators (law 4: no label
//                 is dissected here) and does what its title says;
//                 exampleNameFrom and loadExample fall back to the default
//                 (a missing, malformed or path-like name; a network failure,
//                 a 404, the SPA's HTML answered with a 200).
// [not homework]  no example earns any credit — not even ½ — on any HW1–HW7
//                 machine problem, graded by the real grader; a turbot
//                 example not even with the problem's brain swapped for its own.
// [ephemeral]     with the page ephemeral (its <html data-persistence=
//                 "ephemeral">, read by persistence.ts as it evaluates), an
//                 open, edits, a Reset, the debounce and its max wait, the
//                 unload flushes and the UI prefs touch NO storage — not even
//                 the localStorage accessor — and the save chip never says
//                 'unsaved'; the mode is the page's word, never set by code.
// [reset]         Reset re-opens the example through the File menu's Open
//                 path: the machine as it was, no undo, the run stopped, a
//                 canvas swap (law 6).
// [module graph]  the embed entry's static + dynamic imports (types skipped)
//                 reach no auth/, api/, instructor/, assignments/, remote store
//                 or backend module, and no KaTeX / marked / DOMPurify; the
//                 app's entry does reach them (the walker's control); the
//                 store and routing import no backend, auth or registry.
// [host]          the app's host leaves the wheel and touch as they were; on
//                 the embed's host the claim (editorHost.ts gestureClaim,
//                 driven here) takes a mouse or pen press at once, a touch
//                 only as a tap — a swipe the browser takes never claims, and
//                 an unclaimed touch is kept from the canvas — and a release
//                 hands the gestures back; the canvas's wheel handler stands
//                 down before preventDefault, and its touch-action (and the
//                 palette's) lets the page pan until claimed; EmbedApp
//                 provides that host.
// [headers]       public/_headers, as Pages applies it (splat, exact, `!`
//                 detach, merge): every page framable by itself only; /embed
//                 and /embed.html by makingminds.org alone.
// [wiring]        vite builds embed.html; it declares itself ephemeral on its
//                 <html> (index.html does not), loads the embed entry and the
//                 Plex fonts; the entry mounts no auth, routing or health
//                 probe; persistence.ts decides from the page, as it
//                 evaluates, and nothing can switch it later.
// --dist          the BUILT embed page still declares itself ephemeral (the
//                 built app page does not); its scripts (its entry and every
//                 chunk it preloads) carry none of the app-only code's
//                 markers, which the app's own chunks do carry; prints their
//                 gzipped size.
//
// What a headless run cannot prove — the frame on the course website, the
// scroll handoff under a real trackpad, the served headers — is owed to a
// browser and to `curl -I` after release (the task file's ## Verify).

import ts from 'typescript';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const APP = fileURLToPath(new URL('..', import.meta.url));
const EXAMPLES_DIR = join(APP, 'public', 'embed-examples');
const read = (rel: string) => readFileSync(join(APP, rel), 'utf8');

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? `\n       ${detail}` : ''}`);
  if (!ok) failures++;
}

// ═══ --dist: the built page ═════════════════════════════════════════════
if (process.argv.includes('--dist')) {
  const DIST = join(APP, 'dist');
  console.log('[dist]');
  const html = existsSync(join(DIST, 'embed.html')) ? readFileSync(join(DIST, 'embed.html'), 'utf8') : '';
  check('(setup) dist/embed.html exists — run `npm run build` first', html !== '');
  // The mode is the page's word, read before any chunk's module can keep
  // anything — whatever order the bundle evaluates its shared chunks in.
  check('the built embed page declares itself ephemeral on its <html>', /<html\b[^>]*\bdata-persistence="ephemeral"/.test(html));
  check('the built app page does not', !/data-persistence/.test(readFileSync(join(DIST, 'index.html'), 'utf8')));
  const scriptsOf = (page: string) =>
    [...page.matchAll(/<script[^>]*\bsrc="([^"]+)"|<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)]
      .map((m) => (m[1] ?? m[2]).replace(/^.*?\/assets\//, 'assets/'));
  const embedChunks = scriptsOf(html);
  const mainChunks = scriptsOf(readFileSync(join(DIST, 'index.html'), 'utf8'));
  const embedOnly = embedChunks.map((f) => readFileSync(join(DIST, f), 'utf8'));
  // The app's own chunks minus those the embed shares: where the app-only code lives.
  const appOnly = mainChunks.filter((f) => !embedChunks.includes(f)).map((f) => readFileSync(join(DIST, f), 'utf8'));
  check('(setup) the embed page loads an entry and its preloads', embedChunks.length >= 1, embedChunks.join(', '));
  const MARKERS: { what: string; marker: string; required: boolean }[] = [
    { what: 'the auth session token (auth/, api/client)', marker: 'mm:auth:token', required: true },
    { what: 'KaTeX', marker: 'KaTeX', required: true },
    { what: 'DOMPurify', marker: 'DOMPurify', required: true },
    { what: 'marked (its own error text)', marker: 'marked(): input parameter is undefined or null', required: true },
    { what: 'the instructor UI (a Dashboard tab)', marker: 'Roster & accounts', required: true },
    // A local build compiles the remote client out; a remote (Pages) build has it.
    { what: 'the API client (remote builds)', marker: '/api/', required: false },
  ];
  for (const { what, marker, required } of MARKERS) {
    const inApp = appOnly.some((c) => c.includes(marker));
    if (!inApp && !required) {
      console.log(`skip ${what}: not in this build's app chunks either (a local build) — build with VITE_API_BASE to check it`);
      continue;
    }
    check(`control: the app's chunks carry ${what}`, inApp);
    check(`the embed's chunks are free of ${what}`, embedOnly.every((c) => !c.includes(marker)));
  }
  const raw = embedOnly.reduce((n, c) => n + Buffer.byteLength(c), 0);
  const gz = embedOnly.reduce((n, c) => n + gzipSync(c).length, 0);
  const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
  console.log(`embed JS: ${embedChunks.length} chunks, ${kb(raw)} raw, ${kb(gz)} gzipped (${embedChunks.join(', ')})`);
  console.log(failures === 0 ? '\nembedCheck --dist: all checks passed' : `\nembedCheck --dist: ${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

// ═══ Shims: storage that records every touch, listeners captured ═════════
// Installed BEFORE anything imports the store (static imports would hoist).
const storageLog: string[] = [];
const backing = new Map<string, string>();
function recordingStorage(label: string) {
  return {
    getItem: (k: string) => { storageLog.push(`${label}.getItem(${k})`); return backing.get(k) ?? null; },
    setItem: (k: string, v: string) => { storageLog.push(`${label}.setItem(${k})`); backing.set(k, String(v)); },
    removeItem: (k: string) => { storageLog.push(`${label}.removeItem(${k})`); backing.delete(k); },
    clear: () => { storageLog.push(`${label}.clear()`); backing.clear(); },
    key: (i: number) => { storageLog.push(`${label}.key(${i})`); return [...backing.keys()][i] ?? null; },
    get length() { storageLog.push(`${label}.length`); return backing.size; },
  };
}
/** A storage global whose mere ACCESS is recorded — a blocked third-party
 *  frame throws right there, before any method is called. */
function recordedAccessor(target: object, name: 'localStorage' | 'sessionStorage') {
  const storage = recordingStorage(name);
  Object.defineProperty(target, name, {
    configurable: true,
    get() { storageLog.push(`access ${name}`); return storage; },
  });
}
recordedAccessor(globalThis, 'localStorage');
recordedAccessor(globalThis, 'sessionStorage');
type Listener = (e?: unknown) => void;
const listeners: { target: 'window' | 'document'; type: string; fn: Listener }[] = [];
const win: Record<string, unknown> = {
  setInterval: setInterval.bind(globalThis),
  clearInterval: clearInterval.bind(globalThis),
  setTimeout: setTimeout.bind(globalThis),
  clearTimeout: clearTimeout.bind(globalThis),
  addEventListener: (type: string, fn: Listener) => void listeners.push({ target: 'window', type, fn }),
  removeEventListener: () => {},
};
recordedAccessor(win, 'localStorage');
recordedAccessor(win, 'sessionStorage');
(globalThis as unknown as Record<string, unknown>).window = win;
const doc = {
  visibilityState: 'visible',
  // The embed page's <html data-persistence="ephemeral">, as a browser parses
  // it before any module runs (embed.html).
  documentElement: { getAttribute: (name: string) => (name === 'data-persistence' ? 'ephemeral' : null) },
  addEventListener: (type: string, fn: Listener) => void listeners.push({ target: 'document', type, fn }),
  removeEventListener: () => {},
};
(globalThis as unknown as Record<string, unknown>).document = doc;

// persistence.ts first, as in the embed's bundle it evaluates before any
// module that keeps anything (they all import it) — then the rest.
const { isEphemeral } = await import('../src/persistence');
const { useStore, AUTO_SAVE_MAX_WAIT, selectFsmNotation, selectTmNotation } = await import('../src/store');
const { loadUiPrefs, saveUiPref, setUiPrefDefaults } = await import('../src/uiPrefs');
const { DEFAULT_EXAMPLE, DEMO_FSM_INPUT, exampleNameFrom, exampleUrl, loadExample, openExample } = await import('../src/embed/example');
const { embedLayoutDefaults } = await import('../src/embed/layout');
const { parseWorkbookFile } = await import('../src/workbookFile');
const { APP_HOST, EMBED_HOST, gestureClaim } = await import('../src/editorHost');
const engine = await import('../src/engine');
const { gradeQuestion } = await import('../src/engine/grader');
const { autoPoints } = await import('../src/engine/score');
const { questionTask, getMemInputPortId } = await import('../src/types');
type AssignmentQuestion = import('../src/types').AssignmentQuestion;
type ParsedWorkbook = Extract<ReturnType<typeof parseWorkbookFile>, { ok: true }>['workbook'];

const S = () => useStore.getState();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const EXAMPLE_NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;
const exampleFiles = readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith('.json')).sort();
const examples: { name: string; text: string; workbook: ParsedWorkbook }[] = [];

// ═══ [examples] ══════════════════════════════════════════════════════════
console.log('[examples]');
check('(setup) the page is ephemeral', isEphemeral());
check('at least three examples', exampleFiles.length >= 3, exampleFiles.join(', '));
for (const file of exampleFiles) {
  const name = file.slice(0, -'.json'.length);
  const text = readFileSync(join(EXAMPLES_DIR, file), 'utf8');
  const parsed = parseWorkbookFile(text);
  check(`${name}: a plain name (what ?example= accepts)`, EXAMPLE_NAME.test(name));
  check(`${name}: a workbook file (parseWorkbookFile)`, parsed.ok, parsed.ok ? '' : parsed.reason);
  if (!parsed.ok) continue;
  const wb = parsed.workbook;
  check(`${name}: exactly one worksheet (one machine per embed)`, wb.worksheets.length === 1, String(wb.worksheets.length));
  check(`${name}: a human title`, wb.metadata.title.trim().length > 0 && wb.metadata.title !== 'Untitled Workbook', wb.metadata.title);
  check(`${name}: its poster is beside it (${name}.png)`, existsSync(join(EXAMPLES_DIR, `${name}.png`)));
  examples.push({ name, text, workbook: wb });
}
const sheetOf = (e: (typeof examples)[number]) => e.workbook.worksheets[0];
const modes = new Set(examples.map((e) => sheetOf(e).buildMode));
check('the examples cover the circuit, state machine and turbot editors', ['CC', 'FSM', 'turbot'].every((m) => modes.has(m as never)), [...modes].join(', '));
check(`the default example (${DEFAULT_EXAMPLE}) exists`, examples.some((e) => e.name === DEFAULT_EXAMPLE));

for (const e of examples) {
  const sheet = sheetOf(e);
  openExample(e.text);
  const s = S();
  check(`${e.name}: opens as the only tab, no assignment, no undo, its machine and title`,
    s.tabs.length === 1 && s.workbookOpen && s.assignment === null && s.undoStack.length === 0 && s.redoStack.length === 0 &&
      s.buildMode === sheet.buildMode && s.workbookTitle === e.workbook.metadata.title &&
      s.components.length === sheet.circuit.components.length && s.wires.length === sheet.circuit.wires.length);
  // Validation: the engine's validators — the label grammar stays notation.ts's (law 4).
  const { components, wires } = sheet.circuit;
  const brain = sheet.buildMode === 'turbot' ? sheet.innerMode ?? 'CC' : sheet.buildMode;
  // Every machine kind the sandbox builds has one — a new example of any
  // kind is checked without touching this tool (deploy/README.md §Embedding).
  let problems: string[];
  if (brain === 'CC' || brain === 'SC') {
    // Wired through: no loop a MEM does not break, no free input — a gate's
    // or box's left port, a MEM's input side (M_IN; which side that is, its
    // wiring decided).
    const drivenPorts = new Set(wires.map((w) => `${w.targetComponentId}:${w.targetPortId}`));
    const sinks = (c: (typeof components)[number]) =>
      c.type === 'INPUT' ? [] : c.type === 'MEM' ? (c.memDirection ? [getMemInputPortId(c)] : ['(unwired)']) : c.ports.filter((p) => p.side === 'left').map((p) => p.id);
    const undriven = components.flatMap((c) => sinks(c).filter((port) => !drivenPorts.has(`${c.id}:${port}`)).map((port) => `${c.id}.${port}`));
    problems = [...(engine.hasCombinationalLoop(components, wires) ? ['a combinational loop'] : []), ...undriven.map((p) => `free input ${p}`)];
  } else if (sheet.buildMode === 'FSM') {
    const notation = selectFsmNotation(s);
    problems = engine.validateTransitionTable(engine.sortStateComponents(components), wires, () => notation, 'total').map((x) => x.message);
  } else if (sheet.buildMode === 'TM') {
    problems = engine.sortStateComponents(components).length === 0
      ? ['no states']
      : engine.validateTMTable(components, wires, selectTmNotation(s)).map((x) => x.message);
  } else if (brain === 'FSM') {
    problems = engine.validateTurbotFSM(components, wires).map((x) => x.message);
  } else if (brain === 'TM') {
    problems = engine.validateTurbotTM(components, wires, selectTmNotation(s)).map((x) => x.message);
  } else {
    problems = [`no validator pinned for a ${sheet.buildMode}${brain !== sheet.buildMode ? `/${brain}` : ''} example — add one here`];
  }
  check(`${e.name}: the machine validates cleanly`, problems.length === 0, problems.join('; '));
}

// What each example is for — the machine does what its title says.
{
  const byName = (n: string) => examples.find((e) => e.name === n);
  const majority = byName('majority');
  if (majority) {
    const { components, wires } = sheetOf(majority).circuit;
    const table = engine.truthTableCC(components, wires);
    check('majority: OUT1 is 1 exactly when two or three of IN1–IN3 are',
      table !== null && table !== 'too-many' && table.rows.length === 8 &&
        table.rows.every((r) => r.outputBits.join('') === (r.inputBits.reduce((a, b) => a + b, 0) >= 2 ? '1' : '0')));
  }
  const parity = byName('parity');
  if (parity) {
    openExample(parity.text);
    check('parity: the demo stream is seeded, so Run shows something at once',
      JSON.stringify(S().fsmInputSequence) === JSON.stringify(DEMO_FSM_INPUT));
    for (let i = 0; i < DEMO_FSM_INPUT.length; i++) S().fsmStep();
    // The sandbox feeds the typed digits rightmost first (t1).
    const fed = [...DEMO_FSM_INPUT].reverse();
    let ones = 0;
    const want = fed.map((b) => ((ones += b) % 2));
    check('parity: each output is 1 exactly when an odd number of 1s has come in',
      JSON.stringify(S().fsmHistory.map((h) => h.output)) === JSON.stringify(want),
      `${JSON.stringify(S().fsmHistory.map((h) => h.output))} vs ${JSON.stringify(want)}`);
  }
  const patrol = byName('square-patrol');
  if (patrol) {
    const sheet = sheetOf(patrol);
    const arena = sheet.arena!;
    const run = engine.runTurbot(sheet.circuit.components, sheet.circuit.wires, 'FSM', arena, 24);
    const cells = new Set(run.history.map((h) => `${h.x},${h.y}`));
    const back = run.history.filter((h) => h.x === arena.start.x && h.y === arena.start.y && h.facing === arena.start.facing);
    check('square-patrol: goes round a square of four cells, back where it started every 8 moves, never stopping in the open',
      cells.size === 4 && back.length === 3 && !run.stopped && run.hitStepLimit,
      `${cells.size} cells, back ${back.length}×, stopped ${run.stopped}`);
    const walled = { ...arena, cells: arena.cells.map((row, y) => row.map((c, x) => (x === arena.start.x && y === arena.start.y - 1 ? 'block' as const : c))) };
    check('square-patrol: a block in its way stops it (the embed demo\'s "Edit map" moment)',
      engine.runTurbot(sheet.circuit.components, sheet.circuit.wires, 'FSM', walled, 24).stopped);
  }
}

// The name in the URL, and the fetch.
check('exampleNameFrom: missing, empty, unknown-shaped and path-like names fall back to the default',
  exampleNameFrom('') === DEFAULT_EXAMPLE && exampleNameFrom('?example=') === DEFAULT_EXAMPLE &&
    exampleNameFrom('?example=../x') === DEFAULT_EXAMPLE && exampleNameFrom('?example=Majority') === DEFAULT_EXAMPLE &&
    exampleNameFrom('?example=a/b') === DEFAULT_EXAMPLE && exampleNameFrom(`?example=${'a'.repeat(42)}`) === DEFAULT_EXAMPLE &&
    exampleNameFrom('?example=-x') === DEFAULT_EXAMPLE);
check('exampleNameFrom: a plain name passes through', exampleNameFrom('?example=parity') === 'parity' && exampleNameFrom('?x=1&example=square-patrol') === 'square-patrol');
check('examples are served from the build\'s base', exampleUrl('parity') === '/embed-examples/parity.json' && exampleUrl('parity', 'png') === '/embed-examples/parity.png');
{
  const served = (url: string) => {
    const m = /^\/embed-examples\/([a-z0-9-]+)\.json$/.exec(url);
    const file = m ? join(EXAMPLES_DIR, `${m[1]}.json`) : '';
    return m && existsSync(file) ? { ok: true, text: async () => readFileSync(file, 'utf8') } : null;
  };
  const spaHtml = { ok: true, text: async () => read('index.html') }; // Pages' SPA fallback: a 200
  const notFound = { ok: false, text: async () => 'Not found' };
  const fetchWith = (failing: 'reject' | '404' | 'html') => async (url: string) => {
    if (!url.endsWith(`/${DEFAULT_EXAMPLE}.json`)) {
      if (failing === 'reject') throw new TypeError('network down');
      return failing === '404' ? notFound : spaHtml;
    }
    return served(url)!;
  };
  for (const failing of ['reject', '404', 'html'] as const) {
    const got = await loadExample('parity', fetchWith(failing));
    check(`loadExample: a ${failing === 'reject' ? 'network failure' : failing === '404' ? '404' : 'page of HTML with a 200'} falls back to the default`,
      got.name === DEFAULT_EXAMPLE && parseWorkbookFile(got.text).ok);
  }
  const direct = await loadExample('square-patrol', async (url) => served(url) ?? notFound);
  check('loadExample: a named example loads as itself, with its machine kind and arena size',
    direct.name === 'square-patrol' && direct.buildMode === 'turbot' && direct.arena != null);
  const nothing = await loadExample('parity', async () => notFound).then(() => 'loaded', () => 'rejected');
  check('loadExample: rejects only when the default fails too', nothing === 'rejected');
}
{
  const turbot = embedLayoutDefaults({ width: 640, height: 420 }, { buildMode: 'turbot', arena: { width: 7, height: 6 } });
  const cc = embedLayoutDefaults({ width: 640, height: 420 }, { buildMode: 'CC' });
  check('the compact layout: a narrow combinational circuit (live as its inputs toggle) starts with the output panel folded, a wide one open',
    cc['editor.rightOpen'] === false && embedLayoutDefaults({ width: 1000, height: 560 }, { buildMode: 'CC' })['editor.rightOpen'] === true);
  check('…every machine that needs Run keeps the panel (its Run and Step; a turbot\'s Map) open at the smallest frame',
    (['SC', 'FSM', 'TM'] as const).every((m) => embedLayoutDefaults({ width: 640, height: 420 }, { buildMode: m })['editor.rightOpen'] === true) &&
      turbot['editor.rightOpen'] === true);
  check('…and sizes the Map\'s cells to show the whole arena', typeof turbot.arenaCellSize === 'number' && !('arenaCellSize' in cc));
}

// ═══ [not homework] ══════════════════════════════════════════════════════
console.log('\n[not homework]');
{
  const homeworks = [1, 2, 3, 4, 5, 6, 7].map((i) => ({
    i,
    questions: (JSON.parse(read(`src/devData/homeworks/hw${i}.json`)) as { questions: AssignmentQuestion[] }).questions,
  }));
  const machineTasks = new Set(['function', 'perception', 'turbot']);
  let graded = 0;
  for (const e of examples) {
    const sheet = sheetOf(e);
    const credits: string[] = [];
    for (const hw of homeworks) {
      for (const q of hw.questions) {
        if (!machineTasks.has(questionTask(q))) continue;
        // A turbot example also against the problem with ITS brain kind:
        // the arenas are the problem, whatever brain a student builds.
        const variants = [q];
        if (q.buildMode === 'turbot' && sheet.innerMode && q.innerMode !== sheet.innerMode) variants.push({ ...q, innerMode: sheet.innerMode });
        for (const v of variants) {
          graded++;
          const points = autoPoints(v, gradeQuestion(v, sheet.circuit));
          if (points !== null && points !== 0) credits.push(`HW${hw.i} ${v.label ?? `#${v.id}`} (${v.buildMode}${v.innerMode ? `/${v.innerMode}` : ''}): ${points}`);
        }
      }
    }
    check(`${e.name} earns no credit on any HW1–HW7 machine problem`, credits.length === 0, credits.join('; '));
  }
  check('(setup) the homework machine problems were graded', graded > examples.length * 40, String(graded));
}

// ═══ [ephemeral] ═════════════════════════════════════════════════════════
console.log('\n[ephemeral]');
{
  const statuses = new Set<string>();
  const unsubscribe = useStore.subscribe((st) => void statuses.add(st.autoSaveStatus));
  storageLog.length = 0;
  const majority = examples.find((e) => e.name === DEFAULT_EXAMPLE)!;
  openExample(majority.text);
  const before = S().components.length;
  S().placeTool('NOT', 600, 300);
  S().placeTool('AND', 600, 400);
  check('(setup) the edits landed (through the store\'s own actions)', S().components.length === before + 2 && S().undoStack.length > 0);
  openExample(majority.text); // Reset
  S().placeTool('OR', 640, 320);
  S().goHome();
  S().enterSandbox();
  // Past the debounce AND its max wait: an armed save would have fired.
  await sleep(AUTO_SAVE_MAX_WAIT + 250);
  // The page going away: every captured unload handler (flushAutoSave).
  doc.visibilityState = 'hidden';
  for (const l of listeners) if (['beforeunload', 'pagehide', 'visibilitychange'].includes(l.type)) l.fn();
  doc.visibilityState = 'visible';
  check('(setup) the unload handlers were captured and fired',
    ['beforeunload', 'pagehide', 'visibilitychange'].every((t) => listeners.some((l) => l.type === t)));
  // The UI prefs go through the page's storage too; the defaults layer writes nothing.
  setUiPrefDefaults({ 'editor.rightOpen': false, localOpen: true });
  saveUiPref('runSpeed', 2);
  const prefs = loadUiPrefs();
  check('the UI prefs still work within the page (memory): a saved pref reads back, over the page\'s defaults',
    prefs.runSpeed === 2 && prefs['editor.rightOpen'] === false && prefs.localOpen === true);
  setUiPrefDefaults({});
  unsubscribe();
  check('no storage was touched — not a key, not even the localStorage accessor', storageLog.length === 0, storageLog.slice(0, 6).join(', '));
  check('the save chip never said "unsaved" (nothing is kept, so nothing is pending)', !statuses.has('unsaved') && !statuses.has('saving'), [...statuses].join(', '));
}

// ═══ [reset] ═════════════════════════════════════════════════════════════
console.log('\n[reset]');
{
  const ids = (xs: readonly { id: string }[]) => xs.map((x) => x.id).join(',');
  for (const name of ['parity', 'square-patrol']) {
    const e = examples.find((x) => x.name === name);
    if (!e) { check(`(setup) the ${name} example exists`, false); continue; }
    const sheet = sheetOf(e);
    openExample(e.text);
    S().runControl('run', { intervalMs: 5 });
    await sleep(30);
    const running = () => S().fsmRunning || S().turbotRunning;
    check(`${name}: (setup) a run is going`, running());
    S().placeTool('STATE', 700, 420);
    check(`${name}: (setup) an edit landed`, S().components.length === sheet.circuit.components.length + 1 && S().undoStack.length > 0);
    const seq = S().canvasSwapSeq;
    openExample(e.text); // Reset
    const s = S();
    check(`${name}: Reset puts the example back — its components and wires as they were`,
      ids(s.components) === ids(sheet.circuit.components) && ids(s.wires) === ids(sheet.circuit.wires));
    check(`${name}: …with no undo or redo, the run stopped and a canvas swap (resetAllSimState, law 6)`,
      s.undoStack.length === 0 && s.redoStack.length === 0 && !running() && s.canvasSwapSeq > seq &&
        s.fsmHistory.length === 0 && s.turbotHistory.length === 0);
    if (sheet.buildMode === 'turbot') {
      check(`${name}: …the turbot back on its start`,
        s.turbotState.x === sheet.arena!.start.x && s.turbotState.y === sheet.arena!.start.y && s.turbotState.facing === sheet.arena!.start.facing);
    }
  }
}

// ═══ [module graph] ══════════════════════════════════════════════════════
console.log('\n[module graph]');
{
  /** The runtime imports of a module: static and dynamic, with every
   *  `import type` and all-type clause skipped (verbatimModuleSyntax makes
   *  them explicit, so what remains is exactly what the bundler follows). */
  function runtimeImports(file: string): string[] {
    const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, kind);
    const out: string[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
        const c = n.importClause;
        const allTypes = !!c && (c.isTypeOnly ||
          (!c.name && !!c.namedBindings && ts.isNamedImports(c.namedBindings) &&
            c.namedBindings.elements.length > 0 && c.namedBindings.elements.every((el) => el.isTypeOnly)));
        if (!allTypes) out.push(n.moduleSpecifier.text);
      } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier) && !n.isTypeOnly) {
        out.push(n.moduleSpecifier.text);
      } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) {
        out.push(n.arguments[0].text);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
  }
  const isFile = (p: string) => existsSync(p) && statSync(p).isFile();
  /** A specifier's target: an app file (repo-relative), or `pkg:<name>`. */
  function target(from: string, spec: string): string {
    if (!spec.startsWith('.')) {
      const parts = spec.split('/');
      return `pkg:${spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]}`;
    }
    const base = resolve(dirname(from), spec);
    const hit = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')].find(isFile);
    return hit ?? base;
  }
  /** Everything reachable from `entry`, each with the module that pulled it in. */
  function reach(entryRel: string): Map<string, string> {
    const entry = join(APP, entryRel);
    const via = new Map<string, string>([[entry, '']]);
    const queue = [entry];
    while (queue.length > 0) {
      const file = queue.shift()!;
      if (!/\.tsx?$/.test(file)) continue; // css, json: leaves
      for (const spec of runtimeImports(file)) {
        const t = target(file, spec);
        if (via.has(t)) continue;
        via.set(t, file);
        if (!t.startsWith('pkg:')) queue.push(t);
      }
    }
    return via;
  }
  const name = (m: string) => (m.startsWith('pkg:') ? m : relative(APP, m));
  const chain = (via: Map<string, string>, m: string) => {
    const out = [name(m)];
    for (let p = via.get(m); p; p = via.get(p)) out.push(name(p));
    return out.join(' ← ');
  };
  const FORBIDDEN: { what: string; test: (m: string) => boolean }[] = [
    { what: 'auth/', test: (m) => m.startsWith('src/auth/') },
    { what: 'api/', test: (m) => m.startsWith('src/api/') },
    { what: 'instructor/', test: (m) => m.startsWith('src/instructor/') },
    { what: 'assignments/', test: (m) => m.startsWith('src/assignments/') },
    { what: 'storage/remoteStores.ts', test: (m) => m === 'src/storage/remoteStores.ts' },
    { what: 'storage/backend.ts', test: (m) => m === 'src/storage/backend.ts' },
    { what: 'storage/appBackend.ts', test: (m) => m === 'src/storage/appBackend.ts' },
    { what: 'KaTeX', test: (m) => m === 'pkg:katex' },
    { what: 'marked', test: (m) => m === 'pkg:marked' },
    { what: 'DOMPurify', test: (m) => m === 'pkg:dompurify' },
  ];
  const embed = reach('src/embed/main.tsx');
  const app = reach('src/main.tsx');
  const embedNames = [...embed.keys()].map(name);
  check('(setup) the walker reaches the editor from the embed entry',
    ['src/store.ts', 'src/components/CircuitCanvas.tsx', 'src/components/OutputPanel.tsx', 'src/components/EditorShell.tsx', 'src/embed/EmbedApp.tsx'].every((m) => embedNames.includes(m)),
    `${embed.size} modules`);
  for (const f of FORBIDDEN) {
    const hits = [...embed.keys()].filter((m) => f.test(name(m)));
    check(`the embed reaches no ${f.what}`, hits.length === 0, hits.map((m) => chain(embed, m)).slice(0, 3).join(' | '));
  }
  const appNames = [...app.keys()].map(name);
  check('control: the same walker from the app\'s entry reaches api/client.ts, auth/, instructor/ and KaTeX',
    appNames.includes('src/api/client.ts') && appNames.some((m) => m.startsWith('src/auth/')) &&
      appNames.some((m) => m.startsWith('src/instructor/')) && appNames.includes('pkg:katex'));
  console.log(`     (embed: ${embed.size} modules; app: ${app.size})`);
  for (const rel of ['src/store.ts', 'src/routing.ts']) {
    const imports = runtimeImports(join(APP, rel)).map((s) => name(target(join(APP, rel), s)));
    check(`${rel} imports no backend, auth or assignment registry (the page's installed backend instead)`,
      imports.every((m) => !/^src\/(auth\/|assignments\/|storage\/(backend|appBackend|remoteStores|submissionStore)\.ts$)/.test(m)),
      imports.filter((m) => /auth|assignments|backend|remote|submissionStore/.test(m)).join(', '));
  }
  check('the app installs its backend before App (main.tsx)', (() => {
    const main = read('src/main.tsx');
    const at = main.indexOf("import './storage/appBackend");
    return at >= 0 && at < main.indexOf("import App from './App");
  })());
}

// ═══ [host] ══════════════════════════════════════════════════════════════
console.log('\n[host]');
{
  check("the app's host leaves the wheel and touch as they were", APP_HOST.gesturesNeedActivation === false);
  check("the embed's host asks for activation", EMBED_HOST.gesturesNeedActivation === true);
  // The claim, driven as the canvas's capture listeners feed it.
  const mouse = (id = 1) => ({ pointerType: 'mouse', pointerId: id });
  const pen = (id = 2) => ({ pointerType: 'pen', pointerId: id });
  const touch = (id: number) => ({ pointerType: 'touch', pointerId: id });
  {
    const app = gestureClaim(APP_HOST);
    check("on the app's host the canvas has the gestures from the start, and a touch reaches it",
      app.claimed && app.down(touch(5)) === false && app.claimed && (app.release(), app.claimed));
  }
  {
    const changes: boolean[] = [];
    const g = gestureClaim(EMBED_HOST, (on) => changes.push(on));
    check('embed: unclaimed at first', !g.claimed);
    const swallowed = g.down(touch(7));
    g.cancel(touch(7)); // the browser took it: the page scrolled
    check('embed: a touch swipe the browser takes (pointercancel) is kept from the canvas and never claims', swallowed && !g.claimed);
    const again = g.down(touch(8));
    g.cancel(touch(8));
    check('…nor does the next one (a visitor swiping past the frame is never caught)', again && !g.claimed);
    const tapped = g.down(touch(9));
    g.up(touch(10)); // another finger's lift is not this tap
    const before = g.claimed;
    g.up(touch(9));
    check('embed: a tap (down, then up, no cancel) claims — and only its own pointer\'s lift', tapped && !before && g.claimed);
    check('…and once claimed a touch reaches the canvas', g.down(touch(11)) === false);
    g.release();
    check('embed: a release (pointer left the page, focus lost) hands the gestures back', !g.claimed);
    check('embed: a mouse press claims at once, and reaches the canvas', g.down(mouse()) === false && g.claimed);
    g.release();
    check('embed: so does a pen press', g.down(pen()) === false && g.claimed);
    g.release();
    g.down(touch(12));
    g.release();
    g.up(touch(12));
    check('embed: a touch cut off by a release does not claim when it lifts', !g.claimed);
    check('embed: the canvas is told each change, once', JSON.stringify(changes) === JSON.stringify([true, false, true, false, true, false]), JSON.stringify(changes));
  }
  const canvas = read('src/components/CircuitCanvas.tsx');
  const at = canvas.indexOf('// ─── Wheel and touch: zoom / pan');
  const effect = at < 0 ? '' : canvas.slice(at, canvas.indexOf('// ─── Track container size', at));
  const handler = effect.slice(effect.indexOf('const handler = (e: WheelEvent) => {'));
  check('(setup) the canvas\'s gesture effect is found', effect.length > 0 && handler.length > 0);
  check('the wheel handler returns while unclaimed BEFORE it prevents the page\'s scroll',
    handler.indexOf('if (!gate.claimed) return;') >= 0 && handler.indexOf('if (!gate.claimed) return;') < handler.indexOf('e.preventDefault()'));
  check('…the claim is gestureClaim over the host, fed by capture listeners (down / up / cancel) and released on blur or the pointer leaving the page',
    /const gate = gestureClaim\(host, setGesturesClaimed\);/.test(effect) &&
      /if \(gate\.down\(e\)\) e\.stopPropagation\(\);/.test(effect) &&
      ["'pointerdown', down, true", "'pointerup', up, true", "'pointercancel', cancel, true"].every((l) => effect.includes(`el.addEventListener(${l})`)) &&
      /window\.addEventListener\('blur', release\)/.test(effect) &&
      /document\.documentElement\.addEventListener\('mouseleave', release\)/.test(effect) && /\}, \[host\]\);/.test(effect));
  check('touch is the page\'s until claimed: the canvas\'s touch-action, and the palette\'s under the unclaimed class',
    /touchAction: gesturesClaimed \? 'none' : 'manipulation'/.test(canvas) &&
      /className=\{`canvas-container\$\{gesturesClaimed \? '' : ' cv-page-gestures'\}`\}/.test(canvas) &&
      /\.cv-page-gestures \.pal, \.cv-page-gestures \.pal-row \{ touch-action: manipulation; \}/.test(read('src/workbench.css')));
  const embedApp = read('src/embed/EmbedApp.tsx');
  check('EmbedApp provides the embed\'s host around the frame',
    /<EditorHostContext\.Provider value=\{EMBED_HOST\}>[\s\S]*<EditorShell\b[\s\S]*<\/EditorHostContext\.Provider>/.test(embedApp));
  check('the app provides no host of its own (APP_HOST, the default)', !/EditorHostContext/.test(read('src/App.tsx')));
  check('EmbedApp renders no File menu, tabs, session controls, visitor banner or feedback',
    !/WorkbookFileMenu|TabBar|SessionControls|VisitorBanner|FeedbackPanel|EditorTopBar/.test(embedApp));
  check('Reset re-opens the kept example text; nothing else loads a canvas (no enterSandbox, resetForPrincipal or a store set)',
    /openExample\(exampleText\.current\)/.test(embedApp) && !/enterSandbox|resetForPrincipal|setState\(\{ components|importWorkbook/.test(embedApp));
  check('the full sandbox opens in a new tab, from the build\'s base',
    /href=\{SANDBOX_URL\} target="_blank" rel="noopener"/.test(embedApp) && /BASE_URL \?\? '\/'\}#\/sandbox`/.test(embedApp));
}

// ═══ [headers] ═══════════════════════════════════════════════════════════
console.log('\n[headers]');
{
  type Rule = { pattern: string; set: [string, string][]; detach: string[] };
  const rules: Rule[] = [];
  for (const line of read('public/_headers').split('\n')) {
    if (/^\s*(#|$)/.test(line)) continue;
    if (!/^\s/.test(line)) { rules.push({ pattern: line.trim(), set: [], detach: [] }); continue; }
    const rule = rules[rules.length - 1];
    const body = line.trim();
    if (body.startsWith('!')) rule.detach.push(body.slice(1).trim().toLowerCase());
    else {
      const i = body.indexOf(':');
      rule.set.push([body.slice(0, i).trim().toLowerCase(), body.slice(i + 1).trim()]);
    }
  }
  const matches = (pattern: string, path: string) =>
    new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(path);
  /** The headers Pages sends for `path`: every matching rule, top to bottom —
   *  a `!` detaches what earlier rules set, a repeated header joins with ", ". */
  const headersFor = (path: string) => {
    const out = new Map<string, string>();
    for (const r of rules.filter((x) => matches(x.pattern, path))) {
      for (const name of r.detach) out.delete(name);
      for (const [name, value] of r.set) out.set(name, out.has(name) ? `${out.get(name)}, ${value}` : value);
    }
    return out;
  };
  for (const path of ['/', '/index.html', '/assets/index-abc.js', '/embed-examples/parity.json']) {
    const h = headersFor(path);
    check(`${path}: framable by this site only`,
      h.get('content-security-policy') === "frame-ancestors 'self'" && h.get('x-frame-options') === 'SAMEORIGIN', JSON.stringify([...h]));
  }
  for (const path of ['/embed', '/embed.html']) {
    const h = headersFor(path);
    check(`${path}: framable by makingminds.org alone (and no X-Frame-Options to veto it)`,
      h.get('content-security-policy') === 'frame-ancestors https://makingminds.org https://www.makingminds.org' && !h.has('x-frame-options'),
      JSON.stringify([...h]));
  }
}

// ═══ [wiring] ════════════════════════════════════════════════════════════
console.log('\n[wiring]');
{
  const vite = read('vite.config.ts');
  check('vite builds both pages (build.rolldownOptions.input: index.html and embed.html)',
    /rolldownOptions:\s*\{\s*input:\s*\{[^}]*'\.\/index\.html'[^}]*'\.\/embed\.html'/.test(vite));
  const html = read('embed.html');
  check('embed.html loads the embed entry', /<script type="module" src="\/src\/embed\/main\.tsx"><\/script>/.test(html));
  check('embed.html loads the IBM Plex fonts', /fonts\.googleapis\.com\/css2\?[^"]*IBM\+Plex\+Sans[^"]*IBM\+Plex\+Serif[^"]*IBM\+Plex\+Mono/.test(html));
  check('embed.html declares the page ephemeral on its <html>', /<html\b[^>]*\bdata-persistence="ephemeral"/.test(html));
  check('index.html does not (the app keeps its sandbox)', !/data-persistence/.test(read('index.html')));
  const main = read('src/embed/main.tsx');
  check('the embed entry mounts no auth, routing, health probe or integrity banner',
    !/auth|initRouting|routing|HealthGate|ServerHealthProvider|printIntegrityBanner|appBackend/.test(main.replace(/^\s*\/\/.*$/gm, '')));
  // The mode must not hang on module order: a bundle runs the embed's shared
  // chunks (store, uiPrefs, persistence) before its entry, so a switch the
  // entry flips would come after any module-level storage read.
  const persistence = read('src/persistence.ts');
  check('persistence.ts reads the page\'s declaration as it evaluates, and exports no switch',
    /const ephemeral = declaredEphemeral\(\);/.test(persistence) && /PERSISTENCE_ATTRIBUTE = 'data-persistence'/.test(persistence) &&
      !/let ephemeral|export function make|ephemeral = true/.test(persistence));
  const readers: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(f) && p !== join(APP, 'src', 'persistence.ts') && /data-persistence|PERSISTENCE_ATTRIBUTE/.test(readFileSync(p, 'utf8'))) {
        readers.push(relative(APP, p));
      }
    }
  };
  walk(join(APP, 'src'));
  check('no module outside persistence.ts reads the declaration', readers.length === 0, readers.join(', '));
}

console.log(failures === 0 ? '\nembedCheck: all checks passed' : `\nembedCheck: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
