// Local mode's extensions and late waivers (task 068) — the localStorage
// mirror of the server's `extensions` and `late_waivers` tables, keyed by
// the student's email (the local studentKey):
//
//   mm:extensions:<assignmentId>   { email: LateExtension }
//   mm:late-waivers:<assignmentId> { email: LateWaiver }
//
// The local SubmissionStore writes them (with the grade log); the local
// AssignmentStore reads the extensions to serve a student their effective
// due date; the local GradingStore reads both into its LateContext. Its own
// module so neither store has to import the other.

import type { LateExtension, LateWaiver } from '../types';

export const EXTENSIONS_PREFIX = 'mm:extensions:';
export const WAIVERS_PREFIX = 'mm:late-waivers:';

function readTable<T>(key: string): Record<string, T> {
  try {
    const raw = localStorage.getItem(key);
    const data: unknown = raw ? JSON.parse(raw) : {};
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, T>) : {};
  } catch {
    return {};
  }
}

export function readExtensions(assignmentId: string): Record<string, LateExtension> {
  return readTable<LateExtension>(EXTENSIONS_PREFIX + assignmentId);
}

export function readWaivers(assignmentId: string): Record<string, LateWaiver> {
  return readTable<LateWaiver>(WAIVERS_PREFIX + assignmentId);
}

/** Set (value) or remove (null) one student's row. */
export function writeLateRow<T>(prefix: typeof EXTENSIONS_PREFIX | typeof WAIVERS_PREFIX, assignmentId: string, student: string, value: T | null): void {
  const table = readTable<T>(prefix + assignmentId);
  if (value) table[student] = value;
  else delete table[student];
  try {
    localStorage.setItem(prefix + assignmentId, JSON.stringify(table));
  } catch {
    // localStorage full or unavailable — silent fail (matches the grades).
  }
}
