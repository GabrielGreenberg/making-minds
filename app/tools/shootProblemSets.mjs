// shootProblemSets — headless-Chrome screenshots of the problem-set documents
// (task 2026-09-21-020), through the Chrome DevTools Protocol on node 22's
// built-in WebSocket; no npm dependency. It seeds LOCAL mode in a throwaway
// Chrome profile first (logs in the toy instructor, loads HW1–HW7 through the
// app's own seed module, publishes them), then shoots every HW overview, two
// canvas panels and the instructor's editor as full pages. It is the visual
// proof recipe when the desktop app's browser pane is unavailable.
//
//   cd app && npm run dev            # the Vite dev server on :5173
//   node tools/shootProblemSets.mjs /tmp/shots [1280|700]
//
// Needs macOS Chrome at the path below; the profile is deleted afterwards.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const [outDir, widthArg] = process.argv.slice(2);
const WIDTH = Number(widthArg ?? 1280);
const BASE = 'http://localhost:5173/making-minds/';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
if (!outDir) { console.error('usage: node tools/shootProblemSets.mjs <outDir> [width]'); process.exit(2); }
const profile = join(outDir, `.profile-${WIDTH}`);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
mkdirSync(outDir, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  `--window-size=${WIDTH},900`, '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://localhost:${PORT}/json`); return await r.json(); } catch { await sleep(250); }
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
const goto = async (url, settle = 1200) => { await send('Page.navigate', { url }); await sleep(settle); };
// The page scrolls inside a container, so the document's own height is the
// viewport's: measure the lowest element instead.
const CONTENT_HEIGHT = `Math.ceil(Math.max(...[...document.querySelectorAll('body *')].map((e) => e.getBoundingClientRect().bottom + window.scrollY))) + 24`;
const metrics = (height) => send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height, deviceScaleFactor: 1, mobile: false });

await send('Page.enable');
await send('Runtime.enable');
await metrics(900);

// ── seed as the instructor ──
await goto(BASE, 1500);
await evaluate(`(async () => {
  localStorage.setItem('mm:auth:current', 'instructor-ada');
  for (const k of Object.keys(localStorage)) if (/^mm:(inst-asg|published|sub|asg):hw\\d$/.test(k)) localStorage.removeItem(k);
  const mod = await import('/making-minds/src/devData/homeworks.ts');
  const r = await mod.seedHomeworks();
  for (const id of ['hw1','hw2','hw3','hw4','hw5','hw6','hw7']) localStorage.setItem('mm:published:' + id, '1');
  return JSON.stringify(r.seeded);
})()`);

// ── shoot as the student ──
await goto(BASE, 800);
await evaluate(`localStorage.setItem('mm:auth:current', 'student-john'); 'ok'`);
const shots = [
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => [`hw${n}`, `${BASE}#/a/hw${n}`]),
  ['hw1-q1-canvas', `${BASE}#/a/hw1/q/0`],
  ['hw3-q1-canvas', `${BASE}#/a/hw3/q/0`],
];
for (const [name, url] of shots) {
  await goto(url.replace('#', `?r=${name}#`), 1800);
  const full = !/canvas/.test(name);
  const height = full ? Math.min(6000, await evaluate(CONTENT_HEIGHT)) : 900;
  await metrics(height);
  await sleep(400);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full });
  const file = join(outDir, `2026-09-21-020-${name}${WIDTH === 1280 ? '' : `-${WIDTH}`}.png`);
  writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log(`${file.split('/').pop()}  ${WIDTH}x${height}`);
  await metrics(900);
}
// ── the instructor's editor ──
await evaluate(`localStorage.setItem('mm:auth:current', 'instructor-ada'); 'ok'`);
await goto(`${BASE}?r=edit#/instructor/assignments/hw1/edit`, 1800);
await evaluate(`(() => { const d = document.querySelector('.instructor-doc-preview'); if (d) d.open = true; return 'ok'; })()`);
await sleep(400);
{
  const height = Math.min(6000, await evaluate(CONTENT_HEIGHT));
  await metrics(height); await sleep(400);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const file = join(outDir, `2026-09-21-020-editor${WIDTH === 1280 ? '' : `-${WIDTH}`}.png`);
  writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log(`${file.split('/').pop()}  ${WIDTH}x${height}`);
}
ws.close();
chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch {}
