// Dev-only seeding of the sample assignment + artificial submissions.
//
// Drives the *real* pipeline: it saves the sample assignment to the
// AssignmentStore, then submits each artificial student through
// `localSubmissionStore.submit`, which autogrades on receipt exactly as a live
// student submission would. The instructor gradebook then reflects the stored
// grades — no special-casing anywhere in the UI.

import {
  buildSampleAssignment,
  buildSampleSubmissions,
  SAMPLE_ASSIGNMENT_ID,
} from './sampleData';
import { localAssignmentStore } from '../storage/AssignmentStore';
import { localSubmissionStore } from '../storage/submissionStore';

export { SAMPLE_ASSIGNMENT_ID };

/**
 * Seed (or reseed) the sample assignment and its submissions. Idempotent:
 * clears any prior sample submissions first so repeated clicks don't pile up.
 * Returns the assignment id and how many submissions were recorded.
 */
export async function seedSampleData(): Promise<{
  assignmentId: string;
  submissionCount: number;
}> {
  const assignment = buildSampleAssignment();
  await localAssignmentStore.save(assignment);

  // clearSubmissions is deliberately OFF the SubmissionStore seam (a server
  // never exposes it); seeding pins the concrete local store, dev-only.
  await localSubmissionStore.clearSubmissions(SAMPLE_ASSIGNMENT_ID);

  const submissions = buildSampleSubmissions();
  for (const s of submissions) {
    // Stamp a real submit time; the store autogrades against the saved assignment.
    await localSubmissionStore.submit(SAMPLE_ASSIGNMENT_ID, {
      ...s,
      submittedAt: new Date().toISOString(),
    });
  }

  return { assignmentId: SAMPLE_ASSIGNMENT_ID, submissionCount: submissions.length };
}

/** Remove the sample assignment and all its submissions. */
export async function clearSampleData(): Promise<void> {
  await localSubmissionStore.clearSubmissions(SAMPLE_ASSIGNMENT_ID);
  await localAssignmentStore.remove(SAMPLE_ASSIGNMENT_ID);
}
