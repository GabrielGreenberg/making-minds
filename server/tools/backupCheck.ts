// The pilot's daily backup job (task 041): deploy/backup-daily.sh, run against a
// scratch database with the box's paths overridden (`npm run check`).
//
//   [copy]       a copy of a live WAL-mode database (a writer still open, its
//                changes not yet checkpointed) lands as daily-<today>.sqlite:
//                every row present, integrity ok, owner-only, no .partial left;
//                a second run the same day replaces it (one file per day)
//   [retention]  daily copies older than KEEP_DAYS go; younger ones stay; files
//                that are not this job's (release.sh's backup-*.sqlite, anything
//                else) are never touched, however old
//   [refusals]   no database → non-zero exit, nothing written
//   [units]      the systemd units run the installed script as the service user,
//                daily, persistently, with the box's paths
//
// Exits non-zero on any failed assertion.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}
function section(name: string) {
  console.log(`\n${name}`);
}

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(REPO, 'deploy', 'backup-daily.sh');
const tmp = mkdtempSync(join(tmpdir(), 'mm-backup-'));
const dbPath = join(tmp, 'live.sqlite');
const dir = join(tmp, 'daily');
const today = execFileSync('date', ['+%F']).toString().trim(); // the script's own clock
const todays = join(dir, `daily-${today}.sqlite`);

function run(db = dbPath, keepDays = '35') {
  return spawnSync('bash', [SCRIPT], {
    env: { ...process.env, MM_DB_PATH: db, MM_BACKUP_DIR: dir, MM_BACKUP_KEEP_DAYS: keepDays },
    encoding: 'utf8',
  });
}
/** Rows in the copy's users table; -1 when the copy lacks it (e.g. a plain
 *  file copy that left the WAL's changes behind). */
function rows(path: string): number {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  } catch {
    return -1;
  } finally {
    db.close();
  }
}

// ── [copy] ───────────────────────────────────────────────────────
section('[copy]');
const live = new DatabaseSync(dbPath);
live.exec('PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;');
live.exec('CREATE TABLE users (email TEXT PRIMARY KEY, name TEXT NOT NULL)');
const insert = live.prepare('INSERT INTO users (email, name) VALUES (?, ?)');
for (let i = 0; i < 250; i++) insert.run(`s${i}@ucla.edu`, `Student ${i}`);
check('the scratch database holds its latest rows only in the WAL', existsSync(`${dbPath}-wal`) && statSync(`${dbPath}-wal`).size > 0);

const first = run();
check('the backup exits 0', first.status === 0, first.stderr);
check("it writes daily-<today>.sqlite", existsSync(todays), readdirSync(existsSync(dir) ? dir : tmp).join(', '));
check('every row is in the copy, WAL included', existsSync(todays) && rows(todays) === 250, `rows: ${existsSync(todays) ? rows(todays) : 'no file'}`);
{
  const copy = new DatabaseSync(todays, { readOnly: true });
  const verdict = Object.values(copy.prepare('PRAGMA integrity_check').get() as object)[0];
  copy.close();
  check('the copy passes an integrity check', verdict === 'ok');
}
check('the copy is owner-only (it holds password hashes)', (statSync(todays).mode & 0o077) === 0, (statSync(todays).mode & 0o777).toString(8));
check('no .partial file is left behind', !readdirSync(dir).some((f) => f.endsWith('.partial')));
check('it says what it wrote', first.stdout.includes(`daily-${today}.sqlite`) && first.stdout.includes('1 daily copies kept'), first.stdout);

insert.run('late@ucla.edu', 'Late');
const again = run();
check(
  'a second run the same day replaces that day\'s copy (one file per day)',
  again.status === 0 && rows(todays) === 251 && readdirSync(dir).filter((f) => f.startsWith('daily-')).length === 1,
  again.stderr,
);

// ── [retention] ──────────────────────────────────────────────────
section('[retention]');
const DAY = 24 * 60 * 60;
const now = Date.now() / 1000;
function aged(name: string, days: number): string {
  const path = join(dir, name);
  writeFileSync(path, 'x');
  utimesSync(path, now - days * DAY, now - days * DAY);
  return path;
}
const old = aged('daily-2026-01-01.sqlite', 40);
const recent = aged('daily-2026-09-15.sqlite', 10);
const releaseStyle = aged('backup-2026-01-01-000000.sqlite', 400);
const other = aged('notes.txt', 400);
const pruned = run();
check('the run succeeds', pruned.status === 0, pruned.stderr);
check('a daily copy older than KEEP_DAYS is removed', !existsSync(old));
check('a younger daily copy stays', existsSync(recent));
check("release.sh's backups are never touched, however old", existsSync(releaseStyle));
check('files that are not backups are never touched', existsSync(other));
const tight = run(dbPath, '5');
check('KEEP_DAYS is honoured (5 days removes the 10-day copy)', tight.status === 0 && !existsSync(recent) && existsSync(todays));

// ── [refusals] ───────────────────────────────────────────────────
section('[refusals]');
rmSync(todays);
const missing = run(join(tmp, 'nope.sqlite'));
check('no database → a non-zero exit', missing.status !== 0);
check('… and nothing written', !existsSync(todays) && !readdirSync(dir).some((f) => f.endsWith('.partial')));

// ── [units] ──────────────────────────────────────────────────────
section('[units]');
{
  const service = readFileSync(join(REPO, 'deploy', 'systemd', 'makingminds-backup.service'), 'utf8');
  const timer = readFileSync(join(REPO, 'deploy', 'systemd', 'makingminds-backup.timer'), 'utf8');
  const installer = readFileSync(join(REPO, 'deploy', 'backup-install.sh'), 'utf8');
  check('the service runs as the service user', /^User=makingminds$/m.test(service));
  check('the service runs the installed copy, not the clone', /^ExecStart=\/usr\/local\/lib\/making-minds\/backup-daily\.sh$/m.test(service));
  check('the installer installs exactly that path', installer.includes('install -m 755 "$HERE/backup-daily.sh" "$LIB/backup-daily.sh"') && installer.includes('LIB=/usr/local/lib/making-minds'));
  check(
    "the service points at the box's database and a directory of its own",
    service.includes('MM_DB_PATH=/srv/making-minds/data/making-minds.sqlite') &&
      service.includes('MM_BACKUP_DIR=/srv/making-minds/backups/daily') &&
      service.includes('MM_BACKUP_KEEP_DAYS=35'),
  );
  check('the timer fires daily and catches up after downtime', /^OnCalendar=\*-\*-\* \d\d:\d\d:\d\d /m.test(timer) && /^Persistent=true$/m.test(timer));
  const release = readFileSync(join(REPO, 'deploy', 'release.sh'), 'utf8');
  check('every release reinstalls the job from the repo', release.includes('deploy/backup-install.sh'));
}

live.close();
rmSync(tmp, { recursive: true, force: true });
console.log(failures === 0 ? '\nbackupCheck: all passed' : `\nbackupCheck: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
