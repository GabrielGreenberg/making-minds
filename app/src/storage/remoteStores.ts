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
//     The same fetch carries the user's mint key (task 034, loadForOpen).
//   - RemoteAssignmentStore: what `get` returns depends on the session's role
//     — students receive the assignment with `test_cases`/`perception_cases`
//     stripped by the server (sanitize.ts). Nothing here compensates: remote
//     students are never supposed to see answers or grade locally.
//   - RemoteSubmissionStore.submit sends ANSWERS ONLY. Identity and timestamp
//     are the server's word (app.ts stamps both), so whatever the client put
//     in `submission.student`/`submittedAt` is deliberately dropped. Grading
//     happens on the server, on receipt; pre-release, a student's returned
//     record carries no `result` at all. The Own reads ignore their `email`:
//     the session names the person, for every role; `listAll` is the
//     instructor-only /submissions/all.
//
// GRADER-FREE ZONE: this module (with backend.ts and api/client.ts) must not
// import the engine grader — remote students must never grade client-side.
// tools/remoteStoreCheck.ts grep-gates this.

import type {
  AssignmentData,
  AssignmentState,
  FeedbackCategory,
  FeedbackScreenshot,
  FeedbackStatus,
  InstructorNote,
  PlatformFeedback,
  SubmissionData,
  SubmissionRecord,
} from '../types';
import type { AssignmentSummary } from '../assignments';
import type { WorkbookStore } from './workbookStore';
import type { AssignmentStore } from './AssignmentStore';
import type { SubmissionStore } from './submissionStore';
import type { FeedbackStore } from './feedbackStore';
import type { Role } from '../auth/accounts';
import type { NotesStore } from './NotesStore';
import {
  ApiError,
  getWorkbook,
  getWorkbookFull,
  putWorkbook,
  listAssignments as apiListAssignments,
  getAssignment as apiGetAssignment,
  putAssignment,
  deleteAssignment,
  setGradesReleased as apiSetGradesReleased,
  setVisible as apiSetVisible,
  submitAssignment as apiSubmitAssignment,
  listSubmissions as apiListSubmissions,
  listAllSubmissions as apiListAllSubmissions,
  reviewSubmission,
  submitFeedback,
  listFeedback,
  setFeedbackStatus,
  getInstructorNote,
  saveInstructorNote,
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

  async loadForOpen(id: string): Promise<{ state: AssignmentState | null; mintKey: string | null }> {
    // One GET: the session names the person; the server derives their key
    // and returns it beside the state.
    const { state, mintKey } = await getWorkbookFull(id);
    return { state, mintKey: mintKey ?? null };
  }
}

class RemoteAssignmentStore implements AssignmentStore {
  list(): Promise<AssignmentSummary[]> {
    return apiListAssignments();
  }

  get(id: string): Promise<
    { assignment: AssignmentData; gradesReleased: boolean; visible?: boolean } | null
  > {
    return or404(apiGetAssignment(id), null);
  }

  save(assignment: AssignmentData): Promise<void> {
    return putAssignment(assignment);
  }

  remove(id: string): Promise<void> {
    return deleteAssignment(id);
  }

  async getGradesReleased(id: string): Promise<boolean> {
    // Release rides the assignment row server-side, so an unknown id is
    // simply unreleased.
    return (await this.get(id))?.gradesReleased ?? false;
  }

  setGradesReleased(id: string, released: boolean): Promise<void> {
    return apiSetGradesReleased(id, released);
  }

  async getVisible(id: string): Promise<boolean> {
    // A hidden assignment 404s for a student, so or404's null already means
    // "not visible to me"; for an instructor the fetch carries the flag.
    return (await this.get(id))?.visible ?? false;
  }

  setVisible(id: string, visible: boolean): Promise<void> {
    return apiSetVisible(id, visible);
  }
}

class RemoteSubmissionStore implements SubmissionStore {
  submit(id: string, submission: SubmissionData): Promise<SubmissionRecord> {
    // Answers only — identity + timestamp are the server's word (see header).
    return apiSubmitAssignment(id, submission.answers);
  }

  listOwn(id: string, _email: string | null): Promise<SubmissionRecord[]> {
    // The session names the person (any role), so the email is not sent —
    // the WorkbookStore.loadForOpen precedent.
    return apiListSubmissions(id);
  }

  async getLatestOwn(id: string, email: string | null): Promise<SubmissionRecord | null> {
    // Own attempts arrive in order — the last one is the latest (mirrors the
    // local store's read).
    const own = await this.listOwn(id, email);
    return own.length ? own[own.length - 1] : null;
  }

  listAll(id: string): Promise<SubmissionRecord[]> {
    return apiListAllSubmissions(id);
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

class RemoteFeedbackStore implements FeedbackStore {
  submit(input: {
    student: string;
    authorRole: Role;
    category: FeedbackCategory;
    message: string;
    screenshots: FeedbackScreenshot[];
    context?: { assignmentId?: string; questionId?: number };
  }): Promise<PlatformFeedback> {
    // `student` and `authorRole` are the server's word (the session
    // identifies who is posting, and in what role), same discipline as
    // submissions — the client's values are not sent.
    return submitFeedback({
      category: input.category,
      message: input.message,
      screenshots: input.screenshots,
      context: input.context,
    });
  }

  list(): Promise<PlatformFeedback[]> {
    return listFeedback();
  }

  setStatus(id: string, status: FeedbackStatus): Promise<void> {
    return setFeedbackStatus(id, status);
  }
}

class RemoteNotesStore implements NotesStore {
  get(): Promise<InstructorNote | null> {
    return getInstructorNote();
  }

  save(content: string, _updatedBy: string): Promise<InstructorNote> {
    // `_updatedBy` is unused remotely: the server stamps the caller's own
    // session identity, same discipline as submissions/feedback.
    return saveInstructorNote(content);
  }
}

export const remoteWorkbookStore: WorkbookStore = new RemoteWorkbookStore();
export const remoteAssignmentStore: AssignmentStore = new RemoteAssignmentStore();
export const remoteSubmissionStore: SubmissionStore = new RemoteSubmissionStore();
export const remoteFeedbackStore: FeedbackStore = new RemoteFeedbackStore();
export const remoteNotesStore: NotesStore = new RemoteNotesStore();
