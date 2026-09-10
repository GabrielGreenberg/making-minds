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
  /** Whether students can see this assignment at all (see AssignmentStore). */
  visible: boolean;
  /** Due date (ISO timestamp), if the instructor set one. */
  dueDate?: string;
  /** Instructor-chosen position; absent sorts last (see sortAssignments). */
  order?: number;
}

/** The order the catalog and the dashboard both list assignments in: the
 *  instructor's chosen positions first, in ascending order, then everything
 *  that has never been moved, alphabetically. Pure, so both backends and the
 *  headless checks agree. */
export function sortAssignments<T extends { title: string; order?: number }>(rows: T[]): T[] {
  return rows.slice().sort((a, b) => {
    const ao = a.order ?? Number.POSITIVE_INFINITY;
    const bo = b.order ?? Number.POSITIVE_INFINITY;
    if (ao !== bo) return ao - bo;
    return a.title.localeCompare(b.title);
  });
}

/** True if `id` is a bundled (read-only) assignment, not an instructor-authored one. */
export function isBundledAssignment(id: string): boolean {
  return BUNDLED_IDS.has(id);
}

/**
 * Lightweight list for a catalog/home/dashboard screen — no question details.
 * Bundled assignments come first, then instructor-authored ones (if an id
 * appears in both, the bundled read-only one wins); the combined list is then
 * put in the instructor's chosen order (see sortAssignments).
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
      visible: await assignmentStore.getVisible(a.id),
      dueDate: a.dueDate,
      // Bundled assignments cannot be renumbered (they live outside the
      // store), so they are pinned ahead of everything the instructor has
      // ordered rather than falling to the end with the unordered ones.
      order: a.order ?? -1,
    })),
  );
  const custom = (await assignmentStore.list()).filter((a) => !BUNDLED_IDS.has(a.id));
  return sortAssignments([...bundled, ...custom]);
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
  // A brand-new assignment is empty; publish it deliberately once it has
  // questions rather than flashing an empty shell into the student catalog.
  await assignmentStore.setVisible(id, false);
  return assignment;
}
