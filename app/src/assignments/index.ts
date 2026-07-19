// Assignment registry.
//
// Merges two sources behind a stable API: bundled assignments (built in at
// compile time, read-only) and instructor-authored assignments (mutable,
// stored behind the `AssignmentStore` seam). `listAssignments`/`getAssignment`
// stay stable; the implementation switches with the backend.
//
// Bundled assignments are a LOCAL-mode concept only: in remote mode every
// assignment is a server row (served role-sanitized — students never receive
// `test_cases`), and shipping the bundled JSON's answer bank alongside would
// defeat that ("Things to watch": test cases must not ship to the client in
// production). With an empty bundled set, everything below reduces to the
// store, i.e. the server.

import type { AssignmentData } from '../types';
import { assignmentStore, backendMode } from '../storage/backend';
import ccBasics from './cc-basics.json';

// JSON is inferred with widened types (e.g. buildMode: string), so assert to
// the domain type. Add new assignments by importing their JSON here.
const ASSIGNMENTS: AssignmentData[] =
  backendMode === 'local' ? [ccBasics as unknown as AssignmentData] : [];

const BUNDLED_IDS = new Set(ASSIGNMENTS.map((a) => a.id));

export interface AssignmentSummary {
  id: string;
  title: string;
  questionCount: number;
  /** Whether the instructor has released grades for this assignment. */
  gradesReleased: boolean;
  /** Due date (ISO timestamp), if the instructor set one. */
  dueDate?: string;
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
export async function listAssignments(): Promise<AssignmentSummary[]> {
  // Bundled assignments live outside the AssignmentStore, but their release
  // flag still lives ON the seam (release is policy keyed by id, not a
  // property of a stored row) — so bundled summaries ask the store for it.
  const bundled: AssignmentSummary[] = await Promise.all(
    ASSIGNMENTS.map(async (a) => ({
      id: a.id,
      title: a.title,
      questionCount: a.questions.length,
      gradesReleased: await assignmentStore.getGradesReleased(a.id),
      dueDate: a.dueDate,
    })),
  );
  const custom = (await assignmentStore.list()).filter((a) => !BUNDLED_IDS.has(a.id));
  return [...bundled, ...custom];
}

/** Full definition for one assignment, or undefined if the id is unknown. */
export async function getAssignment(id: string): Promise<AssignmentData | undefined> {
  const bundled = ASSIGNMENTS.find((a) => a.id === id);
  if (bundled) return bundled;
  return (await assignmentStore.get(id))?.assignment;
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
export async function createAssignment(title: string): Promise<AssignmentData> {
  const suffix = Date.now().toString(36).slice(-4);
  let id = `${slugify(title)}-${suffix}`;
  // Extremely unlikely, but guarantee uniqueness against anything that exists.
  while (isBundledAssignment(id) || (await assignmentStore.get(id))) {
    id = `${slugify(title)}-${suffix}-${Math.floor(performance.now()).toString(36)}`;
  }
  const assignment: AssignmentData = {
    id,
    title: title.trim() || 'Untitled assignment',
    questions: [],
  };
  await assignmentStore.save(assignment);
  return assignment;
}
