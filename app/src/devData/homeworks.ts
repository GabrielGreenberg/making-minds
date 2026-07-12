// The real PHIL 133 homework assignments (HW1–HW7), seedable into the
// instructor-authored assignment store so they are fully editable in the app.
//
// The JSON files under ./homeworks/ were assembled from the two sources of
// truth: the machine-buildable problems reuse the hand-verified question
// objects from the reference fixtures (`app/tools/fixtures/reference/` — same
// statements, specs, and test banks the coverage harness pins), and the prose
// problems (functions/representations exercises, impossibility arguments,
// reflection paragraphs, flow-chart designs, the HW7 essay) are transcribed
// from `problem sets/hw*.pdf` as open questions. The PDFs' unnumbered
// "challenge problems" are deliberately omitted; HW4 Problems 1–2 reference
// circuit diagrams that only exist in the PDF, so their statements describe
// the drawn machines in words and point at the handout.
//
// Seeding is FILL-EMPTY for the assignments: an assignment id that already
// exists in the store is left untouched, so reseeding never clobbers
// instructor edits. Delete an assignment in the dashboard first to restore
// its pristine copy. Sample SUBMISSIONS (three artificial students per
// homework, built from the fixtures' correct/broken circuits) are cleared and
// resubmitted on every seed, like the sample-data seed — they autograde on
// receipt through the real submission store.

import type { AssignmentData, SubmissionData } from '../types';
import { localAssignmentStore } from '../storage/AssignmentStore';
import { localSubmissionStore } from '../storage/submissionStore';
import hw1 from './homeworks/hw1.json';
import hw2 from './homeworks/hw2.json';
import hw3 from './homeworks/hw3.json';
import hw4 from './homeworks/hw4.json';
import hw5 from './homeworks/hw5.json';
import hw6 from './homeworks/hw6.json';
import hw7 from './homeworks/hw7.json';
import hw1Subs from './homeworks/submissions/hw1.json';
import hw2Subs from './homeworks/submissions/hw2.json';
import hw3Subs from './homeworks/submissions/hw3.json';
import hw4Subs from './homeworks/submissions/hw4.json';
import hw5Subs from './homeworks/submissions/hw5.json';
import hw6Subs from './homeworks/submissions/hw6.json';
import hw7Subs from './homeworks/submissions/hw7.json';

// JSON imports widen literal types (buildMode: string), so assert per file.
export const HOMEWORK_ASSIGNMENTS: AssignmentData[] = [
  hw1,
  hw2,
  hw3,
  hw4,
  hw5,
  hw6,
  hw7,
] as unknown as AssignmentData[];

const HOMEWORK_SUBMISSIONS: Record<string, SubmissionData[]> = {
  hw1: hw1Subs,
  hw2: hw2Subs,
  hw3: hw3Subs,
  hw4: hw4Subs,
  hw5: hw5Subs,
  hw6: hw6Subs,
  hw7: hw7Subs,
} as unknown as Record<string, SubmissionData[]>;

/**
 * Seed the seven homework assignments into the instructor store (local mode,
 * like the sample-data seed). Fill-empty per assignment: existing ids are
 * skipped so instructor edits survive reseeding. Sample submissions are
 * cleared and resubmitted every time (they autograde on receipt against the
 * stored assignment), so the gradebook always has something to show.
 */
export async function seedHomeworks(): Promise<{
  seeded: string[];
  skipped: string[];
  submissionCount: number;
}> {
  const seeded: string[] = [];
  const skipped: string[] = [];
  let submissionCount = 0;
  for (const assignment of HOMEWORK_ASSIGNMENTS) {
    if (await localAssignmentStore.get(assignment.id)) {
      skipped.push(assignment.id);
    } else {
      await localAssignmentStore.save(assignment);
      seeded.push(assignment.id);
    }
    // clearSubmissions is deliberately OFF the SubmissionStore seam (a server
    // never exposes it); seeding pins the concrete local store, dev-only.
    await localSubmissionStore.clearSubmissions(assignment.id);
    for (const s of HOMEWORK_SUBMISSIONS[assignment.id] ?? []) {
      await localSubmissionStore.submit(assignment.id, {
        ...s,
        submittedAt: new Date().toISOString(),
      });
      submissionCount++;
    }
  }
  return { seeded, skipped, submissionCount };
}
