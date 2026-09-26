// shootCircuits — headless-Chrome screenshots of chosen circuits on the real
// canvas (task 2026-09-25-056's before/after pass), through the Chrome
// DevTools Protocol on node 22's built-in WebSocket; no npm dependency. Each
// circuit is loaded into a visitor's sandbox (a public route: no sign-in, no
// server), framed whole, and shot as the canvas alone. Fixtures and sample
// data only — never a student's work (the repo is public; PROFILE §8 law 9).
//
//   cd app && npm run dev            # the Vite dev server on :5173
//   node tools/shootCircuits.mjs <outDir> <label> [prefix]
//
// Writes <outDir>/<prefix>-<nn>-<name>-<label>.png (prefix defaults to
// "circuit"); run it once on the old code ("before") and once on the new
// ("after") for a pair per circuit. Needs macOS Chrome at the path below;
// the throwaway profile is deleted afterwards.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const [outDir, label, prefixArg] = process.argv.slice(2);
if (!outDir || !label) { console.error('usage: node tools/shootCircuits.mjs <outDir> <label> [prefix]'); process.exit(2); }
const PREFIX = prefixArg ?? 'circuit';
const WIDTH = 1600;
const HEIGHT = 1000;
const BASE = 'http://localhost:5173/making-minds/';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9335;

// What to shoot: a reference fixture's correct machine, or one built from it
// by tools/builder.ts (placed boxes), or a sample-data circuit.
const CIRCUITS = [
  ['hw1-p1', { fixture: 'hw1-p1' }],
  ['hw1-p2', { fixture: 'hw1-p2' }],
  ['hw1-p3', { fixture: 'hw1-p3' }],
  ['hw1-p4', { fixture: 'hw1-p4' }],
  ['hw1-p5', { fixture: 'hw1-p5' }],
  ['hw1-p16', { fixture: 'hw1-p16' }],
  ['hw1-p17', { fixture: 'hw1-p17' }],
  ['hw1-p3-boxed-whole', { fixture: 'hw1-p3', build: 'boxWhole' }],
  ['hw1-p4-boxed-across', { fixture: 'hw1-p4', build: 'boxAcross' }],
  ['hw2-p6-placed-boxes', { fixture: 'hw2-p6' }],
  ['hw3-p1-sc', { fixture: 'hw3-p1' }],
  ['hw3-p12-sc', { fixture: 'hw3-p12' }],
  ['hw2-p13-turbot-cc-brain', { fixture: 'hw2-p13' }],
];

const profile = join(outDir, `.profile-shoot-${label}`);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
mkdirSync(outDir, { recursive: true });
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  `--window-size=${WIDTH},${HEIGHT}`, '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function targets() {
  for (let i = 0; i < 40; i++) {
    try { return await (await fetch(`http://localhost:${PORT}/json`)).json(); } catch { await sleep(250); }
  }
  throw new Error('chrome did not come up');
}
const page = (await targets()).find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq; pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('page threw: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
  return r.result.value;
};

/** Navigate, then wait until the app is really there (a dev server that has
 *  just started can take a while to answer the first load). */
async function goto(url, ready) {
  await send('Page.navigate', { url });
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    const ok = await evaluate(`(() => { try { return location.origin === 'http://localhost:5173' && document.readyState === 'complete' && (${ready}); } catch { return false; } })()`).catch(() => false);
    if (ok) return;
  }
  throw new Error(`page never became ready: ${url}`);
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
// A visitor's sandbox, the output panel folded away so the canvas is wide.
await goto(BASE, 'true');
await evaluate(`(() => {
  localStorage.clear();
  localStorage.setItem('making-minds-ui-prefs', JSON.stringify({ 'editor.rightOpen': false, 'editor.palette': { x: 14, y: 14, horiz: false } }));
  sessionStorage.setItem('mm:visitor-banner-dismissed', '1');
  return 'ok';
})()`);
await goto(`${BASE}#/sandbox`, '!!window.__store && !!document.querySelector(".canvas-container")');
await sleep(800);

let n = 0;
for (const [name, spec] of CIRCUITS) {
  n++;
  const result = await evaluate(`(async () => {
    const spec = ${JSON.stringify(spec)};
    const fixture = await (await fetch('/making-minds/tools/fixtures/reference/' + spec.fixture + '.json')).json();
    let machine = fixture.correct;
    if (spec.build) {
      const builder = await import('/making-minds/tools/builder.ts');
      machine = builder[spec.build](machine);
    }
    const store = window.__store;
    store.setState({ components: machine.components, wires: machine.wires, boxes: [], selectedIds: [], selectedTool: null });
    store.getState().evaluateCircuit();
    await new Promise((r) => setTimeout(r, 300));
    // Frame the whole circuit (Fit's floor of 80% would crop a big one).
    const view = await import('/making-minds/src/canvasView.ts');
    const el = document.querySelector('.canvas-container');
    const rect = el.getBoundingClientRect();
    const b = view.circuitBounds(store.getState().components);
    const pad = 110; // the palette's column, and a margin
    const zoom = view.clampZoom(Math.min(1.4, (rect.width - pad - 30) / (b.x1 - b.x0), (rect.height - 80) / (b.y1 - b.y0)));
    store.getState().setZoom(zoom);
    store.getState().setPan(pad - b.x0 * zoom, 40 + ((rect.height - 80) - (b.y1 - b.y0) * zoom) / 2 - b.y0 * zoom);
    await new Promise((r) => setTimeout(r, 500));
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height, zoom, parts: machine.components.length };
  })()`);
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { ...result, zoom: undefined, parts: undefined, scale: 1 } });
  const file = join(outDir, `${PREFIX}-${String(n).padStart(2, '0')}-${name}-${label}.png`);
  writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log(`${file.split('/').pop()}  ${result.parts} parts at ${Math.round(result.zoom * 100)}%`);
}
ws.close();
chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch {}
