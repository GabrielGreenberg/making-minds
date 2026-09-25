// Homework sync — the pure planner (task 2026-09-21-007). No DOM, no storage,
// no Node: the server's sync (server/src/homeworks.ts, run by every release)
// and local mode's "Load HW1–HW7" (./homeworks.ts) both plan with it.
//
// The repo's app/src/devData/homeworks/hw*.json is the SOURCE of the homework
// content; a deployment's stored copy is a cache of it. A cache refreshes
// whenever nobody has edited it — decided by content lineage, not by "does the
// id already exist" (the fill-empty rule that left the pilot on the 2026-07-12
// transcription for months). Per homework:
//
//   insert     the target has no copy
//   unchanged  the copy's content equals the repo's
//   refresh    the copy is PRISTINE — equal to a version the caller knows was
//              once the repo's (a committed version, or one a sync wrote)
//   edited     anything else: an instructor changed it on the target, so it
//              is left alone and reported (a forced id refreshes anyway)
//
// "Content" is the assignment minus the fields the deployment owns: the
// dashboard's `order` and the instructor's `dueDate`. They are ignored when
// comparing and carried over by a refresh. Publish and release flags are not
// in the JSON at all (they are store-level flags), so no sync can touch them.

import type { AssignmentData } from '../types';
import { canonicalJson } from '../canonicalJson';

// Re-exported: the sync's comparison, which pipelineCheck imports from here.
export { canonicalJson };

/** Fields a deployment sets on its copy; never part of the repo's content. */
export const INSTRUCTOR_OWNED_FIELDS = ['order', 'dueDate'] as const;
type InstructorOwned = (typeof INSTRUCTOR_OWNED_FIELDS)[number];

/** The assignment without its instructor-owned fields. */
export function homeworkContent(a: AssignmentData): Omit<AssignmentData, InstructorOwned> {
  const { order: _order, dueDate: _dueDate, ...content } = a;
  return content;
}

/** cyrb53 — a small, fast, well-mixed 53-bit string hash (public domain, bryc).
 *  Not cryptographic; it only has to tell a handful of versions apart. */
function cyrb53(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** The identity of a homework's content: equal hashes = the same homework. */
export function homeworkContentHash(a: AssignmentData): string {
  return cyrb53(canonicalJson(homeworkContent(a)));
}

/** The repo's version with the target copy's instructor-owned fields kept. */
export function withInstructorOwned(repo: AssignmentData, current: AssignmentData): AssignmentData {
  const next: AssignmentData = { ...homeworkContent(repo) };
  for (const key of INSTRUCTOR_OWNED_FIELDS) {
    const value = current[key] ?? repo[key];
    if (value !== undefined) (next as unknown as Record<string, unknown>)[key] = value;
  }
  return next;
}

export type SyncAction = 'insert' | 'unchanged' | 'refresh' | 'edited';

export interface SyncStep {
  id: string;
  title: string;
  action: SyncAction;
  /** The repo version's content hash — what a sync records as written. */
  repoHash: string;
  /** The target copy's content hash, when it has one. */
  currentHash?: string;
  /** For a refresh: which known version the copy matched ("forced" if none). */
  matched?: string;
  /** What to store, for insert and refresh. */
  next?: AssignmentData;
}

/**
 * Plan a sync of `repo` onto a target. `current(id)` is the target's copy
 * (undefined/null if none); `known(id, hash)` names a version the caller
 * knows was once the repo's content for that id (a commit, "last sync"), or
 * returns undefined; `force` lists ids to refresh even when edited.
 */
export function planHomeworkSync(
  repo: AssignmentData[],
  current: (id: string) => AssignmentData | null | undefined,
  known: (id: string, hash: string) => string | undefined,
  force: ReadonlySet<string> = new Set(),
): SyncStep[] {
  const ids = new Set(repo.map((a) => a.id));
  for (const id of force) {
    if (!ids.has(id)) throw new Error(`--force ${id}: no such homework in the repo (have ${[...ids].join(', ')})`);
  }
  return repo.map((a) => {
    const repoHash = homeworkContentHash(a);
    const base = { id: a.id, title: a.title, repoHash };
    const copy = current(a.id);
    if (!copy) return { ...base, action: 'insert', next: { ...a } };
    const currentHash = homeworkContentHash(copy);
    if (currentHash === repoHash) return { ...base, action: 'unchanged', currentHash };
    const matched = known(a.id, currentHash) ?? (force.has(a.id) ? 'forced' : undefined);
    if (matched) return { ...base, action: 'refresh', currentHash, matched, next: withInstructorOwned(a, copy) };
    return { ...base, action: 'edited', currentHash };
  });
}

/** One line per step, for the CLI, the release log and the dashboard alert;
 *  `planned` words it as a dry run's forecast. */
export function describeSyncStep(step: SyncStep, planned = false): string {
  const will = (done: string, todo: string) => (planned ? todo : done);
  switch (step.action) {
    case 'insert': return `${step.id}: ${will('added', 'would be added')} (unpublished)`;
    case 'unchanged': return `${step.id}: already current`;
    case 'refresh': return `${step.id}: ${will('refreshed', 'would be refreshed')} from the repo (${step.matched === 'forced' ? 'forced' : `the copy was the ${step.matched} version`})`;
    case 'edited': return `${step.id}: left as is — edited here since it was loaded`;
  }
}
