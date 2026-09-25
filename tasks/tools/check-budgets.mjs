#!/usr/bin/env node
// Size guard for the always-loaded and routine-written files. Why: an instructions file
// that grows without a limit is loaded into EVERY session and subagent; see
// tasks/PROFILE.md §"Context budget". Runs in CI (deploy.yml) and in app `npm run check`.
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const budgets = [
  ['CLAUDE.md', 40_000],
  ['tasks/PROFILE.md', 12_000],
  ['tasks/README.md', 12_000],
  ['tasks/CATCHER.md', 14_000],
  ['tasks/WORK.md', 14_000],
  ['tasks/LOOP.md', 14_000],
  ['tasks/WORKER.md', 14_000],
];
let failed = 0;
for (const [rel, max] of budgets) {
  const size = statSync(join(repo, rel)).size;
  const ok = size <= max;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${rel}: ${size} bytes (budget ${max})`);
}
const LOG_LINE_MAX = 300;
const log = readFileSync(join(repo, 'tasks/log.md'), 'utf8').split('\n');
log.forEach((line, i) => {
  if (line.length > LOG_LINE_MAX) {
    failed++;
    console.log(`FAIL tasks/log.md:${i + 1}: ${line.length} chars (max ${LOG_LINE_MAX})`);
  }
});
if (failed) {
  console.error(`\n${failed} context-budget violation(s). See tasks/PROFILE.md §"Context budget".`);
  process.exit(1);
}
console.log('\nAll context budgets respected.');
