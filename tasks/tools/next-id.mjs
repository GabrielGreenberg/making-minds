#!/usr/bin/env node
// Mints the next task id. The rule itself is stated ONCE, in tasks/README.md ("The id
// rule"); this script implements it: YYYY-MM-DD (today) + NNN, where NNN is one past the
// highest NNN found anywhere in incoming/, in-progress/, blocked/, done/ — regardless of
// date. Run it immediately before writing a task file, and again after; rename on a
// collision.
//
// Two machines mint (task 029: Gabriel's laptop and the robot), and a rejected task's file is
// deleted, so it also counts every id ever committed on any fetched ref (`git log --all`,
// deleted files and the last-fetched `origin/main` included): a retired number is never
// re-issued. The caller fetches first (CATCHER §0) and pushes the filing at once, which
// makes a collision need two mints inside one push's window.
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dirs = ['incoming', 'in-progress', 'blocked', 'done'];
const names = [];
for (const d of dirs) {
  try { names.push(...readdirSync(join(root, d))); } catch { continue; }
}
try {
  const everCommitted = execFileSync(
    'git',
    ['-C', root, 'log', '--all', '--format=', '--name-only', '--', ...dirs.map((d) => `${d}/`)],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 },
  );
  names.push(...everCommitted.split('\n').filter(Boolean).map((p) => basename(p)));
} catch {
  // Not a git checkout: the local folders are all there is.
}
let max = 0;
for (const n of names) {
  const m = /^\d{4}-\d{2}-\d{2}-(\d{3,})/.exec(n);
  if (m) max = Math.max(max, Number(m[1]));
}
const now = new Date();
const pad = (x) => String(x).padStart(2, '0');
const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
console.log(`${date}-${String(max + 1).padStart(3, '0')}`);
