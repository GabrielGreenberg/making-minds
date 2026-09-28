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
  Classmate,
  HumanGrade,
  LateExtension,
  LateWaiver,
  Points,
  FeedbackCategory,
  FeedbackContext,
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
import type {
  AssignmentGradingSummary,
  AttemptDetail,
  ClaimOutcome,
  CourseGrading,
  GradingStore,
  FlagThresholds,
  GradeWriteOutcome,
  LateWriteOutcome,
  NoteWriteOutcome,
  QuestionResponses,
  RegradeOutcome,
  StudentGrading,
} from './gradingStore';
import type { FeedbackStore } from './feedbackStore';
import type { Role } from '../auth/accounts';
import type { NotesStore } from './NotesStore';
import { SubmitRefused } from '../submissionGroup';
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
  getClassmates,
  listSubmissions as apiListSubmissions,
  listAllSubmissions as apiListAllSubmissions,
  putGrade,
  deleteGrade,
  getGradingSummary,
  getCourseGrading,
  getStudentGrading,
  getGradingAttempt,
  getQuestionResponses,
  postGradingClaim,
  postRegrade,
  putExtension,
  putWaiver,
  putGradingSettings,
  postStudentNote,
  getGradesExport,
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
  async submit(id: string, submission: SubmissionData): Promise<SubmissionRecord> {
    // Answers and the listed group only — identity + timestamp are the
    // server's word (see header); so is whether the group is valid: its 400
    // is the seam's SubmitRefused, with the server's reason.
    try {
      return await apiSubmitAssignment(id, submission.answers, submission.group);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) throw new SubmitRefused(err.message);
      throw err;
    }
  }

  listClassmates(): Promise<Classmate[]> {
    return getClassmates();
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
}

class RemoteGradingStore implements GradingStore {
  // The server plans every write (storage/gradeWrites.ts) and stamps the
  // grader and time; a 409 carries the grade someone else wrote meanwhile, a
  // 400 the refusal's reason.
  private async outcome(write: () => Promise<HumanGrade | null>): Promise<GradeWriteOutcome> {
    try {
      return { ok: true, grade: await write() };
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        return { ok: false, conflict: true, current: (err.body.current as HumanGrade | null | undefined) ?? null };
      }
      if (err instanceof ApiError && (err.status === 400 || err.status === 404)) {
        return { ok: false, conflict: false, error: err.message };
      }
      throw err;
    }
  }

  setGrade(
    assignmentId: string,
    studentKey: string,
    questionId: number,
    write: { points: Points; note?: string; version: number | null },
  ): Promise<GradeWriteOutcome> {
    return this.outcome(() => putGrade(assignmentId, studentKey, questionId, write));
  }

  clearGrade(assignmentId: string, studentKey: string, questionId: number, version: number): Promise<GradeWriteOutcome> {
    return this.outcome(async () => {
      await deleteGrade(assignmentId, studentKey, questionId, version);
      return null;
    });
  }

  // The summaries are the server's (the same builder over the Db, task 064);
  // a 404 is the seam's null.
  private async orNull<T>(read: () => Promise<T>): Promise<T | null> {
    try {
      return await read();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  }

  summary(assignmentId: string): Promise<AssignmentGradingSummary | null> {
    return this.orNull(() => getGradingSummary(assignmentId));
  }

  course(): Promise<CourseGrading> {
    return getCourseGrading();
  }

  student(studentKey: string): Promise<StudentGrading | null> {
    return this.orNull(() => getStudentGrading(studentKey));
  }

  attempt(assignmentId: string, studentKey: string, attempt: number): Promise<AttemptDetail | null> {
    return this.orNull(() => getGradingAttempt(assignmentId, studentKey, attempt));
  }

  responses(assignmentId: string, questionId: number): Promise<QuestionResponses | null> {
    return this.orNull(() => getQuestionResponses(assignmentId, questionId));
  }

  claim(assignmentId: string, studentKey: string, questionId: number, opts?: { release?: boolean }): Promise<ClaimOutcome | null> {
    return this.orNull(() => postGradingClaim({ assignmentId, studentKey, questionId, ...(opts?.release ? { release: true } : {}) }));
  }

  // The server plans, snapshots and writes (task 069); a 409 — the version
  // changed since the dry run — carries the fresh plan.
  regrade(assignmentId: string, opts: { dryRun: boolean; expectHash?: string }): Promise<RegradeOutcome | null> {
    return this.orNull(async () => {
      try {
        return await postRegrade(assignmentId, opts);
      } catch (err) {
        if (err instanceof ApiError && err.status === 409 && err.body.plan) {
          return { plan: err.body.plan as RegradeOutcome['plan'], committed: false, conflict: true };
        }
        throw err;
      }
    });
  }

  // Extensions and waivers (task 068): the server plans (gradeWrites.ts)
  // and stamps who and when; a 400 / 404 is the refusal's reason.
  private async lateOutcome<T>(write: () => Promise<T | null>): Promise<LateWriteOutcome<T>> {
    try {
      return { ok: true, value: await write() };
    } catch (err) {
      if (err instanceof ApiError && (err.status === 400 || err.status === 404)) return { ok: false, error: err.message };
      throw err;
    }
  }

  setExtension(assignmentId: string, studentKey: string, dueDate: string | null): Promise<LateWriteOutcome<LateExtension>> {
    return this.lateOutcome(() => putExtension(assignmentId, studentKey, dueDate));
  }

  setWaiver(assignmentId: string, studentKey: string, write: { points: number; note?: string } | null): Promise<LateWriteOutcome<LateWaiver>> {
    return this.lateOutcome(() => putWaiver(assignmentId, studentKey, write));
  }

  // Flags and notes (task 070): the server normalizes and stamps the author
  // and time; a 400 / 404 is the refusal's reason.
  setFlagThresholds(thresholds: Partial<FlagThresholds>): Promise<FlagThresholds> {
    return putGradingSettings(thresholds);
  }

  async addStudentNote(studentKey: string, body: string): Promise<NoteWriteOutcome> {
    try {
      return { ok: true, note: await postStudentNote(studentKey, body) };
    } catch (err) {
      if (err instanceof ApiError && (err.status === 400 || err.status === 404)) return { ok: false, error: err.message };
      throw err;
    }
  }

  // The server builds the CSV (storage/gradesExport.ts, over its summaries)
  // and logs the export; an unknown assignment's 404 is the seam's null.
  exportGrades(assignmentId?: string): Promise<{ filename: string; csv: string } | null> {
    return or404(getGradesExport(assignmentId), null);
  }
}

class RemoteFeedbackStore implements FeedbackStore {
  submit(input: {
    student: string;
    authorRole: Role;
    category: FeedbackCategory;
    message: string;
    screenshots: FeedbackScreenshot[];
    context?: FeedbackContext;
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
export const remoteGradingStore: GradingStore = new RemoteGradingStore();
export const remoteFeedbackStore: FeedbackStore = new RemoteFeedbackStore();
export const remoteNotesStore: NotesStore = new RemoteNotesStore();
