#!/usr/bin/env node
// Mints the next task id. The rule itself is stated ONCE, in tasks/README.md ("The id
// rule"); this script implements it: YYYY-MM-DD (today) + NNN, where NNN is one past the
// highest NNN found anywhere in incoming/, in-progress/, blocked/, done/ — regardless of
// date. Run it immediately before writing a task file, and again after; rename on a
// collision.
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dirs = ['incoming', 'in-progress', 'blocked', 'done'];
let max = 0;
for (const d of dirs) {
  let names = [];
  try { names = readdirSync(join(root, d)); } catch { continue; }
  for (const n of names) {
    const m = /^\d{4}-\d{2}-\d{2}-(\d{3,})/.exec(n);
    if (m) max = Math.max(max, Number(m[1]));
  }
}
const now = new Date();
const pad = (x) => String(x).padStart(2, '0');
const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
console.log(`${date}-${String(max + 1).padStart(3, '0')}`);
