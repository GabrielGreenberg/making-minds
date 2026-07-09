// Remote implementations of the three storage seams.
//
// Direct api/client.ts calls — no cache layer, no sync engine, no hydration
// mirror (docs/buildout/designs/remote-stores.md §2): a remote backend is
// intrinsically async, and the seams are already Promise-shaped, so each
// method is a straight delegation to its 1:1 endpoint. storage/backend.ts
// picks these over the Local* stores when `backendMode === 'remote'`.
//
// Contract notes, per seam:
//   - RemoteWorkbookStore: workbooks are per-(user, assignment) server-side;
//     the session token identifies the user, so the seam shape is unchanged.
//   - RemoteAssignmentStore: what `get` returns depends on the session's role
//     — students receive the assignment with `test_cases`/`perception_cases`
//     stripped by the server (sanitize.ts). Nothing here compensates: remote
//     students are never supposed to see answers or grade locally.
//   - RemoteSubmissionStore.submit sends ANSWERS ONLY. Identity and timestamp
//     are the server's word (app.ts stamps both), so whatever the client put
//     in `submission.student`/`submittedAt` is deliberately dropped. Grading
//     happens on the server, on receipt; pre-release, a student's returned
//     record carries no `result` at all.
//
// GRADER-FREE ZONE: this module (with backend.ts and api/client.ts) must not
// import the engine grader — remote students must never grade client-side.
// tools/remoteStoreCheck.ts grep-gates this.

import type { AssignmentData, AssignmentState, SubmissionData, SubmissionRecord } from '../types';
import type { AssignmentSummary } from '../assignments';
import type { WorkbookStore } from './workbookStore';
import type { AssignmentStore } from './AssignmentStore';
import type { SubmissionStore } from './submissionStore';
import {
  ApiError,
  getWorkbook,
  putWorkbook,
  listAssignments as apiListAssignments,
  getAssignment as apiGetAssignment,
  putAssignment,
  deleteAssignment,
  setGradesReleased as apiSetGradesReleased,
  submitAssignment as apiSubmitAssignment,
  listSubmissions as apiListSubmissions,
  reviewSubmission,
} from '../api/client';

/** Resolve a thrown ApiError 404 to `fallback` (the seams' "not found" shape). */
async function or404<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return fallback;
    throw e;
  }
}

class RemoteWorkbookStore implements WorkbookStore {
  loadAssignmentState(id: string): Promise<AssignmentState | null> {
    return getWorkbook(id);
  }

  saveAssignmentState(
    id: string,
    state: AssignmentState,
    opts?: { keepalive?: boolean },
  ): Promise<void> {
    return putWorkbook(id, state, opts);
  }
}

class RemoteAssignmentStore implements AssignmentStore {
  list(): Promise<AssignmentSummary[]> {
    return apiListAssignments();
  }

  get(id: string): Promise<{ assignment: AssignmentData; gradesReleased: boolean } | null> {
    return or404(apiGetAssignment(id), null);
  }

  save(assignment: AssignmentData): Promise<void> {
    return putAssignment(assignment);
  }

  remove(id: string): Promise<void> {
    return deleteAssignment(id);
  }

  async getGradesReleased(id: string): Promise<boolean> {
    // Release rides the assignment row server-side; there is no bundled-
    // outside-the-store case remotely, so an unknown id is simply unreleased.
    return (await this.get(id))?.gradesReleased ?? false;
  }

  setGradesReleased(id: string, released: boolean): Promise<void> {
    return apiSetGradesReleased(id, released);
  }
}

class RemoteSubmissionStore implements SubmissionStore {
  submit(id: string, submission: SubmissionData): Promise<SubmissionRecord> {
    // Answers only — identity + timestamp are the server's word (see header).
    return apiSubmitAssignment(id, submission.answers);
  }

  listSubmissions(id: string): Promise<SubmissionRecord[]> {
    return apiListSubmissions(id);
  }

  async getLatest(id: string): Promise<SubmissionRecord | null> {
    // Students receive only their own attempts, in order — the last one is
    // the graded latest (mirrors the local store's read).
    const all = await this.listSubmissions(id);
    return all.length ? all[all.length - 1] : null;
  }

  recordManualReview(
    id: string,
    student: string,
    attempt: number,
    questionId: number,
    review: { pass: boolean; note?: string },
  ): Promise<SubmissionRecord | null> {
    // 404 = no pending open question for that attempt — the seam's null.
    return or404(reviewSubmission(id, student, attempt, questionId, review), null);
  }
}

export const remoteWorkbookStore: WorkbookStore = new RemoteWorkbookStore();
export const remoteAssignmentStore: AssignmentStore = new RemoteAssignmentStore();
export const remoteSubmissionStore: SubmissionStore = new RemoteSubmissionStore();
