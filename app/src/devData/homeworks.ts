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
// Seeding SYNCS the assignments with the repo (./homeworkSync.ts, the planner
// the server's release-time sync uses too): a missing homework is added, a
// copy untouched since this browser last loaded it is refreshed to the repo's
// current version (keeping its order and due date), and a copy edited here is
// left alone and reported — delete it in the dashboard to reload it. "Untouched"
// is a per-homework record of the content hashes this seed wrote
// (`mm:seeded-homework:<id>`). Sample SUBMISSIONS (three artificial students
// per homework, built from the fixtures' correct/broken circuits) are cleared
// and resubmitted on every seed, like the sample-data seed — they autograde on
// receipt through the real submission store.

import type { AssignmentData, SubmissionData } from '../types';
import { planHomeworkSync, type SyncStep } from './homeworkSync';
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

/** This browser's record of the homework content it loaded, per id. */
export const SEEDED_HOMEWORK_PREFIX = 'mm:seeded-homework:';

function seededHashes(id: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEDED_HOMEWORK_PREFIX + id) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function recordSeeded(id: string, hash: string): void {
  try {
    const hashes = seededHashes(id);
    hashes.add(hash);
    localStorage.setItem(SEEDED_HOMEWORK_PREFIX + id, JSON.stringify([...hashes]));
  } catch {
    // storage unavailable: the next load treats the copy as edited, never clobbers it
  }
}

/**
 * Sync the seven homework assignments into the instructor store (local mode,
 * like the sample-data seed) — see the header: missing ones are added, ones
 * untouched since they were loaded are refreshed, edited ones are left alone.
 * Sample submissions are cleared and resubmitted every time (they autograde on
 * receipt against the stored assignment), so the gradebook always has
 * something to show.
 */
export async function seedHomeworks(): Promise<{ steps: SyncStep[]; submissionCount: number }> {
  const current = new Map<string, AssignmentData | undefined>();
  for (const a of HOMEWORK_ASSIGNMENTS) current.set(a.id, (await localAssignmentStore.get(a.id))?.assignment);
  const steps = planHomeworkSync(
    HOMEWORK_ASSIGNMENTS,
    (id) => current.get(id),
    (id, hash) => (seededHashes(id).has(hash) ? 'previously loaded' : undefined),
  );
  for (const step of steps) {
    if (step.next) await localAssignmentStore.save(step.next);
    if (step.action !== 'edited') recordSeeded(step.id, step.repoHash);
  }
  let submissionCount = 0;
  for (const assignment of HOMEWORK_ASSIGNMENTS) {
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
  return { steps, submissionCount };
}
