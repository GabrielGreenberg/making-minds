// shootEmbedPosters — the embeddable sandbox's still pictures (task 087): each
// example in public/embed-examples/ shot on the real embed page at 800×500,
// written beside it as <name>.png (the poster a phone-narrow frame shows).
// Headless Chrome through the DevTools Protocol on node 22's built-in
// WebSocket, like shootCircuits.mjs; no npm dependency. The built page is
// served from dist/ by this script itself (no dev server), the examples from
// public/ (so a re-authored example shoots without a rebuild). Examples only —
// never a student's work (the repo is public; PROFILE §8 law 9).
//
//   cd app && npm run build
//   node tools/shootEmbedPosters.mjs                 # write the posters
//   node tools/shootEmbedPosters.mjs --measure <dir> # every example at
//        640×420, 800×500 and 1000×560, and the phone poster at 375×640,
//        into <dir> (the layout measurement; nothing in public/ changes)
//
// Needs macOS Chrome at the path below; the throwaway profile is deleted
// afterwards.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const APP = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(APP, 'dist');
const EXAMPLES = join(APP, 'public', 'embed-examples');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = 9336;
const POSTER = { width: 800, height: 500 };
const MEASURE = [
  { width: 640, height: 420 },
  { width: 800, height: 500 },
  { width: 1000, height: 560 },
];
const PHONE = { width: 375, height: 640 };

const args = process.argv.slice(2);
const measureDir = args[0] === '--measure' ? args[1] : null;
if (args[0] === '--measure' && !measureDir) {
  console.error('usage: node tools/shootEmbedPosters.mjs [--measure <outDir>]');
  process.exit(2);
}
if (!existsSync(join(DIST, 'embed.html'))) {
  console.error('no dist/embed.html — run `npm run build` first');
  process.exit(2);
}

// The build's base, read off the built page (the Vite base: '/making-minds/'
// by default, '/' on Pages).
const embedHtml = readFileSync(join(DIST, 'embed.html'), 'utf8');
const BASE = /src="(\/[^"]*?)assets\//.exec(embedHtml)?.[1] ?? '/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };

const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!path.startsWith(BASE)) { res.writeHead(404).end(); return; }
  let rel = path.slice(BASE.length);
  if (rel === 'embed') rel = 'embed.html'; // Pages' pretty URL
  const file = rel.startsWith('embed-examples/') ? join(EXAMPLES, rel.slice('embed-examples/'.length)) : join(DIST, rel || 'index.html');
  if (!file.startsWith(APP) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const names = readdirSync(EXAMPLES).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
const profile = join(tmpdir(), `mm-shoot-embed-${process.pid}`);
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1200,800', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function targets() {
  for (let i = 0; i < 40; i++) {
    try { return await (await fetch(`http://localhost:${DEBUG_PORT}/json`)).json(); } catch { await sleep(250); }
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

await send('Page.enable');
await send('Runtime.enable');

/** The embed at `size`, showing `name`, settled (fonts, the fit's two frames). */
async function open(name, size, ready) {
  await send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${ORIGIN}${BASE}embed.html?example=${name}` });
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    const ok = await evaluate(`(() => { try { return document.readyState === 'complete' && (${ready}); } catch { return false; } })()`).catch(() => false);
    if (ok) {
      await evaluate('document.fonts.ready.then(() => true)');
      await sleep(600);
      return;
    }
  }
  throw new Error(`the embed never showed ${name} at ${size.width}×${size.height}`);
}
async function shoot(file) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log(file.split('/').slice(-2).join('/'));
}
const EDITOR = '!!document.querySelector(".canvas-container")';

try {
  if (measureDir) {
    mkdirSync(measureDir, { recursive: true });
    for (const name of names) {
      for (const size of MEASURE) {
        await open(name, size, EDITOR);
        await shoot(join(measureDir, `${name}-${size.width}x${size.height}.png`));
      }
      await open(name, PHONE, '!!document.querySelector(".wb-embed-poster img")?.complete');
      await shoot(join(measureDir, `${name}-phone.png`));
    }
  } else {
    for (const name of names) {
      await open(name, POSTER, EDITOR);
      await shoot(join(EXAMPLES, `${name}.png`));
    }
  }
} finally {
  ws.close();
  chrome.kill();
  server.close();
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
}
