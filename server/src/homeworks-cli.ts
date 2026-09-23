// Admin CLI for the homework sync (server/src/homeworks.ts). `deploy/release.sh`
// runs `sync` on the box after every pull.
//
//   MM_DB_PATH=making-minds.sqlite npm run homeworks -- status
//   MM_DB_PATH=making-minds.sqlite npm run homeworks -- sync [--dry-run] [--force=hw1,hw3]
//
// `status` is `sync --dry-run`. An edited copy is reported and left alone; the
// exit code stays 0 so a release never fails over an instructor's edit.

import { loadConfig } from './config';
import { Db } from './db';
import { syncHomeworks } from './homeworks';
import { describeSyncStep } from '../../app/src/devData/homeworkSync';

const [command = 'status', ...rest] = process.argv.slice(2);
if (command !== 'sync' && command !== 'status') {
  console.error('usage: npm run homeworks -- status | sync [--dry-run] [--force=hw1,hw3]');
  process.exit(2);
}
const dryRun = command === 'status' || rest.includes('--dry-run');
const forceArg = rest.find((a) => a.startsWith('--force='));
const force = forceArg ? forceArg.slice('--force='.length).split(',').map((s) => s.trim()).filter(Boolean) : [];

const config = loadConfig();
const db = new Db(config.dbPath);
try {
  const steps = syncHomeworks(db, { dryRun, force });
  for (const step of steps) console.log(`  ${describeSyncStep(step, dryRun)}`);
  const count = (a: string) => steps.filter((s) => s.action === a).length;
  console.log(
    `homeworks: ${count('insert')} added, ${count('refresh')} refreshed, ${count('unchanged')} current, ` +
      `${count('edited')} left as edited${dryRun ? ' — dry run, nothing written' : ''} (${config.dbPath})`,
  );
  const edited = steps.filter((s) => s.action === 'edited').map((s) => s.id);
  if (edited.length) {
    console.log(`  to replace an edited copy with the repo's: npm run homeworks -- sync --force=${edited.join(',')}`);
  }
} catch (e) {
  console.error(`homeworks: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  db.close();
}
