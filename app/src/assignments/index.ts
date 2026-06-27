// Assignment registry.
//
// Merges two sources behind a stable API: bundled assignments (built in at
// compile time, read-only) and instructor-authored assignments (mutable, stored
// behind the `AssignmentStore` seam). `listAssignments`/`getAssignment` stay
// stable; only their implementation changes when assignments move server-side.

import type { AssignmentData } from '../types';
import { localAssignmentStore } from '../storage/AssignmentStore';
import ccBasics from './cc-basics.json';

// JSON is inferred with widened types (e.g. buildMode: string), so assert to
// the domain type. Add new assignments by importing their JSON here.
const ASSIGNMENTS: AssignmentData[] = [ccBasics as unknown as AssignmentData];

const BUNDLED_IDS = new Set(ASSIGNMENTS.map((a) => a.id));

export interface AssignmentSummary {
  id: string;
  title: string;
  questionCount: number;
}

/** True if `id` is a bundled (read-only) assignment, not an instructor-authored one. */
export function isBundledAssignment(id: string): boolean {
  return BUNDLED_IDS.has(id);
}

/**
 * Lightweight list for a catalog/home/dashboard screen — no question details.
 * Bundled assignments come first, then instructor-authored ones. If an id
 * appears in both, the bundled (authoritative, read-only) one wins.
 */
export function listAssignments(): AssignmentSummary[] {
  const bundled: AssignmentSummary[] = ASSIGNMENTS.map((a) => ({
    id: a.id,
    title: a.title,
    questionCount: a.questions.length,
  }));
  const custom = localAssignmentStore.list().filter((a) => !BUNDLED_IDS.has(a.id));
  return [...bundled, ...custom];
}

/** Full definition for one assignment, or undefined if the id is unknown. */
export function getAssignment(id: string): AssignmentData | undefined {
  const bundled = ASSIGNMENTS.find((a) => a.id === id);
  if (bundled) return bundled;
  return localAssignmentStore.get(id);
}

/** Turn a title into a url-safe slug; empty input falls back to "assignment". */
function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'assignment';
}

/**
 * Create a new, empty instructor-authored assignment from a title, persist it
 * via the AssignmentStore, and return it. The id is a slug plus a short
 * base-36 timestamp suffix so re-using a title never collides with an existing
 * assignment (bundled or custom).
 */
export function createAssignment(title: string): AssignmentData {
  const suffix = Date.now().toString(36).slice(-4);
  let id = `${slugify(title)}-${suffix}`;
  // Extremely unlikely, but guarantee uniqueness against anything that exists.
  while (isBundledAssignment(id) || localAssignmentStore.get(id)) {
    id = `${slugify(title)}-${suffix}-${Math.floor(performance.now()).toString(36)}`;
  }
  const assignment: AssignmentData = {
    id,
    title: title.trim() || 'Untitled assignment',
    questions: [],
  };
  localAssignmentStore.save(assignment);
  return assignment;
}
