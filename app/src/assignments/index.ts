// Assignment registry.
//
// A thin layer over the `AssignmentStore` seam: every assignment — seeded or
// instructor-authored, local or remote — is a row in the store, so these
// functions add only the shared ordering rule and id minting. Nothing is
// bundled into the app: the registry once merged in a compile-time JSON
// assignment carrying its answer key (which could never ship to students in
// remote mode); it is gone, so local mode starts with an empty catalog until
// the instructor dashboard's dev seeds load content.

import type { AssignmentData } from '../types';
import { assignmentStore } from '../storage/backend';
import { sortAssignments } from '../assignmentOrder';

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

// The ordering rule lives in a pure module the server imports too (task 064).
export { sortAssignments };

/** Lightweight list for a catalog/home/dashboard screen — no question
 *  details — in the instructor's chosen order (see sortAssignments). */
export async function listAssignments(): Promise<AssignmentSummary[]> {
  return sortAssignments(await assignmentStore.list());
}

/** Full definition for one assignment, or undefined if the id is unknown. */
export async function getAssignment(id: string): Promise<AssignmentData | undefined> {
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
 * assignment.
 */
export async function createAssignment(title: string): Promise<AssignmentData> {
  const suffix = Date.now().toString(36).slice(-4);
  let id = `${slugify(title)}-${suffix}`;
  // Extremely unlikely, but guarantee uniqueness against anything that exists.
  while (await assignmentStore.get(id)) {
    id = `${slugify(title)}-${suffix}-${Math.floor(performance.now()).toString(36)}`;
  }
  const assignment: AssignmentData = {
    id,
    title: title.trim() || 'Untitled assignment',
    questions: [],
  };
  await assignmentStore.save(assignment);
  // No setVisible call: unpublished is the default, so a brand-new (empty)
  // assignment is already invisible to students until it is released.
  return assignment;
}
