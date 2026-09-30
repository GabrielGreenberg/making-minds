// Group members on a submission (task 062; design memo
// docs/buildout/designs/grading-interface.md §6.7).
//
// The course policy: groups of at most three, every member lists the others
// on their own submission, and membership must be reciprocal. A submission
// therefore carries up to two classmates, named by the opaque keys the
// classmates list hands out (`Classmate.key`). This module is the ONE rule
// for what a valid listing is — the local store and the server both call
// `checkGroup` on receipt, so the two modes can't disagree. Reciprocity is
// judged later, across submissions (a flag, task 2026-09-26-070), never here.
//
// Pure: no storage, no DOM — the server imports it.

/** Policy: a group is at most 3 people, the submitter included. */
export const MAX_GROUP_OTHERS = 2;

export type GroupCheck = { ok: true; group: string[] } | { ok: false; error: string };

/**
 * A submission the store refused on its merits (today: a group listing that
 * fails `checkGroup`), as opposed to a server that couldn't be reached. Both
 * stores throw it — the remote one from the server's 400 — so the submit
 * dialog can show the reason without knowing which backend it talks to.
 * Nothing is recorded either way.
 */
export class SubmitRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubmitRefused';
  }
}

/**
 * Validate a submitted group listing against the roster's student keys.
 * Absent, null or an empty list is "no group" (`group: []`). Otherwise it
 * must be a list of at most MAX_GROUP_OTHERS distinct keys, each a roster
 * student's, none the submitter's own. Nothing is silently dropped: a bad
 * listing is refused whole, with a reason a student can act on.
 */
export function checkGroup(
  raw: unknown,
  studentKeys: ReadonlySet<string>,
  selfKey: string | null,
): GroupCheck {
  if (raw === undefined || raw === null) return { ok: true, group: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'The group must be a list of classmates.' };
  if (raw.length > MAX_GROUP_OTHERS) {
    return { ok: false, error: `List at most ${MAX_GROUP_OTHERS} group members. Groups are at most 3 people, including you.` };
  }
  const seen = new Set<string>();
  for (const key of raw) {
    if (typeof key !== 'string' || key === '') return { ok: false, error: 'A group member is missing.' };
    if (seen.has(key)) return { ok: false, error: 'The same classmate is listed twice.' };
    if (key === selfKey) return { ok: false, error: "Don't list yourself." };
    if (!studentKeys.has(key)) return { ok: false, error: 'A listed group member is not a student on the class roster.' };
    seen.add(key);
  }
  return { ok: true, group: [...seen] };
}
