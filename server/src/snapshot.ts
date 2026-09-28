// The re-grade's pre-commit snapshot (task 069; memo grading-interface.md §5):
// before a commit rewrites any result, the whole database is copied with
// `VACUUM INTO` (Db.snapshotTo) into its own folder beside the daily backups —
// deploy/README.md §Backups. Its own folder and its own `regrade-*` names, so
// neither this rotation nor the daily job's (deploy/backup-daily.sh, which
// prunes only `daily-*` in `backups/daily`) can touch the other's files.
//
// Owner-only (the copy holds password hashes, like every backup); the newest
// KEEP_REGRADE_SNAPSHOTS are kept. Every name ends in `.sqlite`, which
// .gitignore covers, so a dev server's copies (repo-root backups/) never
// reach git.

import { chmodSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Db } from './db';

export const KEEP_REGRADE_SNAPSHOTS = 20;

/** Where snapshots go: the configured folder, else `backups/regrade` beside
 *  the database's directory (the box: /srv/making-minds/backups/regrade); an
 *  in-memory database's go to the system temp folder. */
export function snapshotDirFor(dbPath: string, configured?: string): string {
  if (configured) return configured;
  if (dbPath === ':memory:') return join(tmpdir(), 'mm-regrade');
  return join(dirname(dirname(resolve(dbPath))), 'backups', 'regrade');
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/\.(\d{3})Z$/, '-$1Z');

/** Snapshot the database before a re-grade of `assignmentId`; returns the
 *  file's name (the path stays on the server). Throws when the copy fails —
 *  the caller then writes nothing. */
export function takeRegradeSnapshot(db: Db, dir: string, assignmentId: string, now: Date): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const safeId = assignmentId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  const base = `regrade-${safeId}-${stamp(now)}`;
  const taken = new Set(readdirSync(dir));
  let name = `${base}.sqlite`;
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}.sqlite`;
  const path = join(dir, name);
  db.snapshotTo(path);
  chmodSync(path, 0o600);
  prune(dir);
  return basename(path);
}

/** Keep the newest KEEP_REGRADE_SNAPSHOTS `regrade-*.sqlite` files (names
 *  sort by time within an assignment; across assignments, by mtime). */
function prune(dir: string): void {
  const files = readdirSync(dir, { withFileTypes: true })
    .filter((f) => f.isFile() && /^regrade-.*\.sqlite$/.test(f.name))
    .map((f) => f.name);
  if (files.length <= KEEP_REGRADE_SNAPSHOTS) return;
  const byAge = files
    .map((name) => ({ name, t: statTime(join(dir, name)) }))
    .sort((a, b) => b.t - a.t || (a.name < b.name ? 1 : -1));
  for (const f of byAge.slice(KEEP_REGRADE_SNAPSHOTS)) rmSync(join(dir, f.name), { force: true });
}

function statTime(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}
