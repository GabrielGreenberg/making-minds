// Feedback reports the task pipeline has closed, resolved on its own (task 086).
//
// A report's triage mark (task 018; `tasks/tools/feedback.mjs mark`) says what
// the pipeline made of it. Two marks close it:
//   dismissed  resolved when the mark lands: the pipeline's word is final;
//   filed      resolved once EVERY task it names is done and live, i.e. its
//              file is in tasks/done/ of the code this server runs. A `merged`
//              task counts once the task it merged into does (the chain is
//              followed, cycle-safe).
// `personal`, `review` and unmarked reports are never resolved here: they
// wait for Gabriel.
//
// "Live" is the boot snapshot. On the box the server runs from the release
// clone (robotStatus.ts repoDirFor), which only a release moves, and
// release.sh pulls, syncs and then restarts; so the done set is read ONCE per
// process, when createApp builds it, and a task done on main but not yet
// released is not in it. The boot sweep resolves what the release made live;
// the triage route resolves a dismissal, or a late filing into tasks already
// live, as the mark lands.
//
// Once per report: the resolve is stamped inside the triage JSON
// (`autoResolved`; no schema change), the planner skips a stamped report, and
// the triage route carries the stamp across a re-mark, so a report Gabriel
// reopens after an automatic resolve stays open. (One he resolved by hand and
// then reopened carries no stamp, so a later boot may resolve it once: the
// accepted edge, and the docs say only "reopened after the pipeline resolved
// it". The reopen that must stick is the one after the pipeline's.)
// The status goes first, then the stamp: a crash between the two can only
// cost one more resolve on the next boot, never a report stuck half-closed.
//
// After the resolve: the status route notes the instructor's first reopen on
// the stamp (`reopenedAt`, reopenedMark below), so the pipeline's resolve
// stops standing (types.ts autoResolveStands) and the Feedback tab stops
// crediting it, even once he resolves the report again by hand. The triage
// route's `{clear: true}` undoes a resolve that still stands: it reopens the
// report before dropping the mark, stamp and all (reopen first, so a crash
// between leaves it open and stamped, never resolved and unmarked).
//
// Where the done set comes from (doneDirFor): a configured MM_REPO_DIR; else
// none for an in-memory database (the harnesses, kept deterministic: dismissed
// still resolves, filed never does); else the repo this code runs from. In dev
// that is the checkout itself, so a dev server resolves its dev database
// against the local tasks/done/: harmless.
//
// Law 9 (student data never enters git): only task file NAMES and each file's
// frontmatter `status` / `merged_into` are read, and only task ids are written,
// into the database, never the repo.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FeedbackStatus, FeedbackTriage, PlatformFeedback } from '../../app/src/types';
import type { Db } from './db';
import { repoDirFor } from './robotStatus';

/** A task id, as the triage route takes it: `2026-09-24-040`. */
export const TASK_ID = /^\d{4}-\d{2}-\d{2}-\d{3}$/;
/** A task file's name: its id, a slug, `.md` (tasks/README.md). */
const TASK_FILE = /^(\d{4}-\d{2}-\d{2}-\d{3})-.*\.md$/;
/** Frontmatter is short; a file whose closing `---` never comes has none. */
const MAX_FRONTMATTER_LINES = 60;

/** What tasks/done/ says of one task: `done`, or `merged` into another. */
export interface DoneTask {
  status: string;
  mergedInto?: string;
}
export type DoneTasks = ReadonlyMap<string, DoneTask>;

export interface AutoResolve {
  id: string;
  /** The report's mark, stamped `autoResolved`. */
  triage: FeedbackTriage;
}

// ── pure ────────────────────────────────────────────────────────

/** One file of tasks/done/: the id from its name, `status` and `merged_into`
 *  from its frontmatter. Null for a name that is not a task's (a README). */
export function parseDoneTaskFile(name: string, text: string): { id: string; task: DoneTask } | null {
  const named = TASK_FILE.exec(name);
  if (!named) return null;
  const lines = text.split(/\r?\n/, MAX_FRONTMATTER_LINES + 2);
  const close = lines[0]?.trim() === '---' ? lines.findIndex((l, i) => i > 0 && l.trim() === '---') : -1;
  let status = '';
  let mergedInto: string | undefined;
  for (const line of close > 0 ? lines.slice(1, close) : []) {
    const field = /^(status|merged_into):(.*)$/.exec(line);
    if (!field) continue;
    const value = field[2].replace(/\s#.*$/, '').trim();
    if (field[1] === 'status') status = value;
    else if (TASK_ID.test(value)) mergedInto = value;
  }
  return { id: named[1], task: { status, ...(mergedInto ? { mergedInto } : {}) } };
}

/** Done and live: `done` in the set, or `merged` into a task that is. Absent,
 *  any other status, a merge into nothing, or a cycle: not live. */
export function isTaskLive(id: string, done: DoneTasks): boolean {
  const seen = new Set<string>();
  for (let at: string | undefined = id; at !== undefined && !seen.has(at); ) {
    seen.add(at);
    const task = done.get(at);
    if (!task) return false;
    if (task.status === 'done') return true;
    if (task.status !== 'merged') return false;
    at = task.mergedInto;
  }
  return false;
}

/** Which reports the pipeline has closed, each with its stamped mark: open,
 *  never stamped before, and `dismissed`, or `filed` into tasks all live.
 *  `done` null (none could be read): filed ones stay open. */
export function planAutoResolves(
  reports: readonly Pick<PlatformFeedback, 'id' | 'status' | 'triage'>[],
  done: DoneTasks | null,
  now: string,
): AutoResolve[] {
  const plan: AutoResolve[] = [];
  for (const { id, status, triage } of reports) {
    if (status !== 'open' || !triage || triage.autoResolved) continue;
    if (triage.outcome === 'dismissed') {
      plan.push({ id, triage: { ...triage, autoResolved: { at: now, reason: 'dismissed' } } });
    } else if (
      triage.outcome === 'filed' &&
      done &&
      triage.tasks &&
      triage.tasks.length > 0 &&
      triage.tasks.every((task) => isTaskLive(task, done))
    ) {
      plan.push({ id, triage: { ...triage, autoResolved: { at: now, reason: 'filed', tasks: [...triage.tasks] } } });
    }
  }
  return plan;
}

/** The mark to store when the instructor sets a report's `status` (the
 *  status route): reopening a report the pipeline resolved notes the first
 *  reopen on its stamp. Null when the mark stays as it is. */
export function reopenedMark(
  report: Pick<PlatformFeedback, 'status' | 'triage'>,
  status: FeedbackStatus,
  now: string,
): FeedbackTriage | null {
  const triage = report.triage;
  if (status !== 'open' || report.status !== 'resolved' || !triage?.autoResolved || triage.autoResolved.reopenedAt) {
    return null;
  }
  return { ...triage, autoResolved: { ...triage.autoResolved, reopenedAt: now } };
}

// ── I/O ─────────────────────────────────────────────────────────

/** The tasks/done/ to read: the configured clone's, else none for an
 *  in-memory database, else the repo this code runs from (see the header). */
export function doneDirFor(dbPath: string, repoDir?: string): string | null {
  if (!repoDir && dbPath === ':memory:') return null;
  return join(repoDirFor(repoDir), 'tasks', 'done');
}

/** The done set, read once. Never throws: a checkout with no tasks/done/ has
 *  no pipeline (null, quietly); any other failure warns and is null too. */
export function readDoneTasks(dir: string | null): DoneTasks | null {
  if (!dir) return null;
  try {
    const done = new Map<string, DoneTask>();
    for (const name of readdirSync(dir)) {
      if (!TASK_FILE.test(name)) continue;
      const parsed = parseDoneTaskFile(name, readFileSync(join(dir, name), 'utf8'));
      if (parsed) done.set(parsed.id, parsed.task);
    }
    return done;
  } catch (e) {
    if ((e as { code?: unknown }).code !== 'ENOENT') {
      console.warn(`feedback: could not read ${dir} (${e instanceof Error ? e.message : String(e)}); filed reports stay open`);
    }
    return null;
  }
}

/** Resolve what the plan names (every open, marked report, or just `onlyId`):
 *  the status through the status route's own method, then the stamp. */
export function autoResolveFeedback(
  db: Pick<Db, 'listFeedback' | 'setFeedbackStatus' | 'setFeedbackTriage'>,
  done: DoneTasks | null,
  onlyId?: string,
): AutoResolve[] {
  const open = db.listFeedback({ status: 'open', triaged: true });
  const plan = planAutoResolves(
    onlyId === undefined ? open : open.filter((f) => f.id === onlyId),
    done,
    new Date().toISOString(),
  );
  for (const { id, triage } of plan) {
    db.setFeedbackStatus(id, 'resolved');
    db.setFeedbackTriage(id, triage);
  }
  return plan;
}
