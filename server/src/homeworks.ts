// The homework sync — the repo's HW1–HW7 onto the server database (task
// 2026-09-21-007). `deploy/release.sh` runs it on the box after every pull, so
// a homework content change ships the way a code change does. The decisions
// are the pure planner's (app/src/devData/homeworkSync.ts); this module is its
// server adapter:
//
//   the repo      app/src/devData/homeworks/hw*.json, read from disk
//   the copies    the `assignments` table, written through Db.saveAssignment
//                 (an upsert of the JSON only — the publish and release flags
//                 are columns it never touches; submissions and workbooks are
//                 other tables)
//   "pristine"    a copy whose content hash is a COMMITTED version of its file
//                 (git history of the box's clone — the pilot's copies came from
//                 the 2026-07-12 commit via the local→remote migration) or a
//                 version this sync wrote before (the content_sync table, which
//                 also covers a shallow clone with no history)
//
// New homeworks arrive unpublished, like every other assignment.

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './db';
import type { AssignmentData } from '../../app/src/types';
import { homeworkContentHash, planHomeworkSync, type SyncStep } from '../../app/src/devData/homeworkSync';

export const HOMEWORK_DIR = fileURLToPath(new URL('../../app/src/devData/homeworks/', import.meta.url));

export interface RepoHomework {
  assignment: AssignmentData;
  file: string;
}

/** hw1.json … hwN.json from the repo, in numeric order. */
export function readRepoHomeworks(dir: string = HOMEWORK_DIR): RepoHomework[] {
  return readdirSync(dir)
    .filter((f) => /^hw\d+\.json$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
    .map((f) => {
      const file = path.join(dir, f);
      return { file, assignment: JSON.parse(readFileSync(file, 'utf8')) as AssignmentData };
    });
}

/** content hash → a label ("ec5c1ac 2026-07-12") for every committed version
 *  of `file`, plus the working-tree file. Without git or history (a shallow
 *  clone) it degrades to the working tree alone — the content_sync record
 *  then carries pristineness from one sync to the next. */
export function gitLineage(file: string): Map<string, string> {
  const lineage = new Map<string, string>();
  const add = (hash: string, label: string) => { if (!lineage.has(hash)) lineage.set(hash, label); };
  try {
    add(homeworkContentHash(JSON.parse(readFileSync(file, 'utf8')) as AssignmentData), 'working-tree');
  } catch {
    // unreadable file: nothing to add
  }
  try {
    const cwd = path.dirname(file);
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const rel = path.relative(root, file).split(path.sep).join('/');
    const log = execFileSync('git', ['log', '--format=%h %cs', '--', rel], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    for (const line of log ? log.split('\n') : []) {
      const [sha, date] = line.split(' ');
      try {
        const text = execFileSync('git', ['show', `${sha}:${rel}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
        add(homeworkContentHash(JSON.parse(text) as AssignmentData), `${sha} ${date}`);
      } catch {
        // a version that does not parse can never match a stored copy
      }
    }
  } catch {
    // no git, not a repository, or no history: the working tree is all we know
  }
  return lineage;
}

export interface SyncOptions {
  /** Plan only; write nothing. */
  dryRun?: boolean;
  /** Ids to refresh even though they were edited on this deployment. */
  force?: Iterable<string>;
  /** The repo homeworks (default: read from HOMEWORK_DIR). */
  homeworks?: RepoHomework[];
  /** Known versions per file (default: gitLineage). Tests inject their own. */
  lineage?: (file: string) => Map<string, string>;
}

/** Plan and (unless dryRun) apply the sync. Returns one step per homework. */
export function syncHomeworks(db: Db, opts: SyncOptions = {}): SyncStep[] {
  const homeworks = opts.homeworks ?? readRepoHomeworks();
  const lineageOf = opts.lineage ?? gitLineage;
  const fileOf = new Map(homeworks.map((h) => [h.assignment.id, h.file]));
  const lineages = new Map<string, Map<string, string>>();
  const known = (id: string, hash: string): string | undefined => {
    const file = fileOf.get(id)!;
    if (!lineages.has(id)) lineages.set(id, lineageOf(file));
    return lineages.get(id)!.get(hash) ?? (db.syncedHashes(id).has(hash) ? 'last synced' : undefined);
  };
  const steps = planHomeworkSync(
    homeworks.map((h) => h.assignment),
    (id) => db.getAssignment(id),
    known,
    new Set(opts.force ?? []),
  );
  if (!opts.dryRun) {
    for (const step of steps) {
      if (step.next) db.saveAssignment(step.next);
      // Record what the deployment now holds whenever it IS the repo's
      // content, so the next sync knows the copy was untouched since.
      if (step.action !== 'edited') db.recordSync(step.id, step.repoHash);
    }
  }
  return steps;
}
