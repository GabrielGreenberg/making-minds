// The GradingStore seam (task 063; design memo
// docs/buildout/designs/grading-interface.md §7.3): where a person's grade is
// WRITTEN. Human grades live apart from the autograde output — keyed
// (assignment, student, question), anchored to the answer they judged, every
// change logged — so a re-grade can never wipe one and a resubmission turns it
// into a suggestion rather than silently carrying it. They are READ with the
// submissions they judge (SubmissionStore: `record.grades`).
//
// Promise-returning like every seam; storage/backend.ts is the one mode
// decision. Local: the local SubmissionStore persists (it owns the records a
// grade is anchored to). Remote: the server's grade routes. Both run the ONE
// planner, storage/gradeWrites.ts.
//
// And where grading is READ in bulk (task 064): the summaries every grading
// view and the Activity tab share — one roster join, one score — built by
// the ONE pure builder, storage/gradingSummary.ts. Local: over the local
// SubmissionStore's records and the toy roster. Remote: the server's summary
// routes, which run the same builder over the Db.
//
// And the hand-grading queue (task 066): one problem across every
// submitter (`responses`, the same pure builder) and the soft claims on it
// (`claim`; storage/gradingClaims.ts — advisory, a write never checks one).
// Local: a ClaimBook in this page's memory, the signed-in toy account the
// grader. Remote: the server's, one per process.

import type { AssignmentData, HumanGrade, Points, SubmissionRecord } from '../types';
import { readPersistedAccount, TOY_ACCOUNTS } from '../auth/accounts';
import type { localSubmissionStore } from './submissionStore';
import type { AssignmentStore } from './AssignmentStore';
import {
  buildAssignmentSummary,
  buildAttemptDetail,
  buildCourseGrading,
  buildQuestionResponses,
  buildStudentGrading,
  type AssignmentGradingSummary,
  type AttemptDetail,
  type CourseGrading,
  type GradingIdentity,
  type QuestionResponses,
  type StudentGrading,
} from './gradingSummary';
import { ClaimBook, type ClaimOutcome } from './gradingClaims';

export type {
  AssignmentGradingSummary,
  AttemptDetail,
  CourseGrading,
  GradingIdentity,
  GradingProgress,
  GradingRow,
  QueueAnswer,
  QueueResponse,
  QuestionResponses,
  StudentGrading,
} from './gradingSummary';
export type { ClaimOutcome, ClaimView } from './gradingClaims';
export { CLAIM_TTL_MS } from './gradingClaims';

/** How a write came out. A conflict carries the grade someone else wrote
 *  since it was read (null = they cleared it); a refusal carries a reason. */
export type GradeWriteOutcome =
  | { ok: true; grade: HumanGrade | null }
  | { ok: false; conflict: true; current: HumanGrade | null }
  | { ok: false; conflict: false; error: string };

export interface GradingStore {
  /**
   * Write one grade (a hand grade, or an override — note required) on the
   * student's latest attempt. `version` is the grade's version as read (null
   * when there was none). `studentKey` is `SubmissionRecord.studentKey`.
   * Instructor-only.
   */
  setGrade(
    assignmentId: string,
    studentKey: string,
    questionId: number,
    write: { points: Points; note?: string; version: number | null },
  ): Promise<GradeWriteOutcome>;
  /** Clear one grade — the problem is the autograde's (or pending) again. */
  clearGrade(assignmentId: string, studentKey: string, questionId: number, version: number): Promise<GradeWriteOutcome>;
  /** One assignment's shared summary: a row per roster student (submitted or
   *  not) and per other submitter (flagged), latest attempt only, no
   *  circuits. null = no such assignment. Instructor-only. */
  summary(assignmentId: string): Promise<AssignmentGradingSummary | null>;
  /** Every assignment's progress + course-wide counts (the Grading tab). */
  course(): Promise<CourseGrading>;
  /** One student (by `GradingIdentity.key`) across assignments; null = unknown key. */
  student(studentKey: string): Promise<StudentGrading | null>;
  /** One attempt in full, on demand; null = no such assignment, student or attempt. */
  attempt(assignmentId: string, studentKey: string, attempt: number): Promise<AttemptDetail | null>;
  /** The hand-grading queue's feed: one problem across every submitter's
   *  latest attempt, with each response's grade and live claim. null = no
   *  such assignment or question. Instructor-only. */
  responses(assignmentId: string, questionId: number): Promise<QuestionResponses | null>;
  /** Claim (or renew) one response for the signed-in grader, or with
   *  `release` let go of it (the outcome is then `{held: false}`, `by` null
   *  unless someone else holds it). Another grader's live claim is never taken — the
   *  outcome names them. null = no such assignment, question or student. */
  claim(assignmentId: string, studentKey: string, questionId: number, opts?: { release?: boolean }): Promise<ClaimOutcome | null>;
}

/** The toy roster: its students, keyed as local records are (the email). */
function localRoster(): GradingIdentity[] {
  return TOY_ACCOUNTS.filter((a) => a.role === 'student').map((a) => localIdentity(a.email));
}

/** Who a local key (an email) is: a toy student, a toy instructor (flagged),
 *  or nobody on the toy roster (a dev seed's made-up student, flagged). */
function localIdentity(key: string): GradingIdentity {
  const account = TOY_ACCOUNTS.find((a) => a.email.toLowerCase() === key);
  const name = account?.name ?? 'Not on the roster';
  return {
    key,
    name,
    sortName: name,
    uid: '',
    section: null,
    hasAccount: true,
    ...(account?.role === 'student' ? {} : { offRoster: account ? ('instructor' as const) : ('not-rostered' as const) }),
  };
}

/** Each student's latest attempt (records carry `studentKey` from listAll). */
function latestPerStudent(all: readonly SubmissionRecord[]): SubmissionRecord[] {
  const byKey = new Map<string, SubmissionRecord>();
  for (const r of all) {
    const prev = byKey.get(r.studentKey ?? '');
    if (!prev || r.attempt > prev.attempt) byKey.set(r.studentKey ?? '', r);
  }
  return [...byKey.values()];
}

export class LocalGradingStore implements GradingStore {
  private readonly subs: typeof localSubmissionStore;
  private readonly assignments: AssignmentStore;
  /** This page's claims (local mode has one grader per browser tab). */
  private readonly claims = new ClaimBook();

  constructor(subs: typeof localSubmissionStore, assignments: AssignmentStore) {
    this.subs = subs;
    this.assignments = assignments;
  }

  /** Locally the grader is the signed-in toy account. */
  private actor(): string {
    return readPersistedAccount()?.email ?? 'local';
  }

  async setGrade(
    assignmentId: string,
    studentKey: string,
    questionId: number,
    write: { points: Points; note?: string; version: number | null },
  ): Promise<GradeWriteOutcome> {
    const plan = await this.subs.applyGradeWrite(assignmentId, studentKey, questionId, write, this.actor());
    return plan.ok ? { ok: true, grade: plan.grade } : plan;
  }

  async clearGrade(assignmentId: string, studentKey: string, questionId: number, version: number): Promise<GradeWriteOutcome> {
    const plan = await this.subs.applyGradeWrite(assignmentId, studentKey, questionId, { clear: true, version }, this.actor());
    return plan.ok ? { ok: true, grade: null } : plan;
  }

  private async summaryOf(assignment: AssignmentData, released: boolean, now: number): Promise<AssignmentGradingSummary> {
    return buildAssignmentSummary({
      assignment,
      roster: localRoster(),
      latest: latestPerStudent(await this.subs.listAll(assignment.id)),
      identify: localIdentity,
      released,
      now,
    });
  }

  async summary(assignmentId: string): Promise<AssignmentGradingSummary | null> {
    const got = await this.assignments.get(assignmentId);
    return got ? this.summaryOf(got.assignment, got.gradesReleased, Date.now()) : null;
  }

  async course(): Promise<CourseGrading> {
    const now = Date.now();
    const rows = await this.assignments.list();
    const assignments = [];
    for (const row of rows) {
      const got = await this.assignments.get(row.id);
      if (!got) continue;
      assignments.push({
        summary: await this.summaryOf(got.assignment, got.gradesReleased, now),
        ...(got.assignment.order !== undefined ? { order: got.assignment.order } : {}),
        visible: row.visible,
      });
    }
    return buildCourseGrading({ roster: localRoster(), assignments });
  }

  async student(studentKey: string): Promise<StudentGrading | null> {
    const now = Date.now();
    const assignments: { assignment: AssignmentData; released: boolean; latest: SubmissionRecord | null }[] = [];
    let seen = TOY_ACCOUNTS.some((a) => a.email.toLowerCase() === studentKey);
    for (const row of await this.assignments.list()) {
      const got = await this.assignments.get(row.id);
      if (!got) continue;
      const mine = (await this.subs.listAll(row.id)).filter((r) => r.studentKey === studentKey);
      if (mine.length) seen = true;
      assignments.push({ assignment: got.assignment, released: got.gradesReleased, latest: latestPerStudent(mine)[0] ?? null });
    }
    return seen ? buildStudentGrading({ student: localIdentity(studentKey), assignments, now }) : null;
  }

  async attempt(assignmentId: string, studentKey: string, attempt: number): Promise<AttemptDetail | null> {
    const got = await this.assignments.get(assignmentId);
    const record = got
      ? (await this.subs.listAll(assignmentId)).find((r) => r.studentKey === studentKey && r.attempt === attempt)
      : undefined;
    if (!got || !record) return null;
    return buildAttemptDetail({
      assignment: got.assignment,
      student: localIdentity(studentKey),
      record,
      events: this.subs.gradeLog(assignmentId).filter((e) => e.student === studentKey),
      now: Date.now(),
    });
  }

  async responses(assignmentId: string, questionId: number): Promise<QuestionResponses | null> {
    const got = await this.assignments.get(assignmentId);
    if (!got) return null;
    const now = Date.now();
    return buildQuestionResponses({
      assignment: got.assignment,
      questionId,
      roster: localRoster(),
      latest: latestPerStudent(await this.subs.listAll(assignmentId)),
      identify: localIdentity,
      claims: this.claims.active(assignmentId, questionId, now, this.actor()),
      released: got.gradesReleased,
      now,
    });
  }

  async claim(assignmentId: string, studentKey: string, questionId: number, opts?: { release?: boolean }): Promise<ClaimOutcome | null> {
    const got = await this.assignments.get(assignmentId);
    const known = got?.assignment.questions.some((q) => q.id === questionId) &&
      (await this.subs.listAll(assignmentId)).some((r) => r.studentKey === studentKey);
    if (!known) return null;
    const target = { assignmentId, studentKey, questionId };
    const now = Date.now();
    if (opts?.release) {
      this.claims.release(target, this.actor());
      const left = this.claims.active(assignmentId, questionId, now).get(studentKey);
      return { held: false, by: left?.by ?? null, until: left?.until ?? null };
    }
    const account = readPersistedAccount();
    return this.claims.claim(target, { actor: this.actor(), name: account?.name ?? 'Someone' }, now);
  }
}
