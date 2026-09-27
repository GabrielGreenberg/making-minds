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

import type { HumanGrade, Points } from '../types';
import { readPersistedAccount } from '../auth/accounts';
import type { localSubmissionStore } from './submissionStore';

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
}

export class LocalGradingStore implements GradingStore {
  private readonly subs: typeof localSubmissionStore;

  constructor(subs: typeof localSubmissionStore) {
    this.subs = subs;
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
}
