// The server's adapter over the ONE grading-summary builder (task 064;
// app/src/storage/gradingSummary.ts — the local GradingStore is the other
// adapter): gathers roster rows and each student's latest attempt from the
// Db, names every student by an opaque key, and hands them to the builder.
// The routes are app.ts's (all instructor-only).
//
// Keys: an account's `public_id`. A submitter whose account has since been
// removed from the roster has none; they are named by a key derived from the
// server's secret and their address ('x' + 12 url-safe characters — a
// public_id is 12, so the two never collide), stable and opaque, so no email
// ever reaches a path or a row.

import { createHash } from 'node:crypto';
import type { Db, GradingUserRow } from './db';
import type { SubmissionRecord } from '../../app/src/types';
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
} from '../../app/src/storage/gradingSummary';
import type { ClaimBook } from '../../app/src/storage/gradingClaims';

function derivedKey(secret: string, email: string): string {
  return 'x' + createHash('sha256').update(`${secret}\0grading\0${email}`).digest('base64url').slice(0, 12);
}

/** Who is who, for one request: the roster, and email ↔ key ↔ identity. */
class Directory {
  readonly roster: GradingIdentity[];
  private readonly byEmail = new Map<string, GradingUserRow>();
  private readonly db: Db;
  private readonly secret: string;

  constructor(db: Db, secret: string) {
    this.db = db;
    this.secret = secret;
    const users = db.listGradingUsers();
    for (const u of users) this.byEmail.set(u.email, u);
    this.roster = users.filter((u) => u.role === 'student').map((u) => this.identity(u));
  }

  private identity(u: GradingUserRow): GradingIdentity {
    return {
      key: u.publicId ?? derivedKey(this.secret, u.email),
      name: u.name,
      sortName: u.sortName,
      uid: u.uid,
      section: u.section,
      hasAccount: u.hasAccount,
      ...(u.role === 'instructor' ? { offRoster: 'instructor' as const } : {}),
    };
  }

  /** The identity an attempt filed under this address belongs to. */
  identityOf(email: string): GradingIdentity {
    const u = this.byEmail.get(email);
    if (u) return this.identity(u);
    const name = 'Removed from the roster';
    return { key: derivedKey(this.secret, email), name, sortName: name, uid: '', section: null, hasAccount: false, offRoster: 'removed' };
  }

  /** The address a key names: an account's public_id, else a removed
   *  submitter's derived key; null for neither. */
  emailOf(key: string): string | null {
    const email = this.db.emailOfPublicId(key);
    if (email) return email;
    if (!key.startsWith('x')) return null;
    return this.db.listSubmitterEmails().find((e) => !this.byEmail.has(e) && derivedKey(this.secret, e) === key) ?? null;
  }
}

/** The latest attempts, each carrying its student's key and human grades. */
function latestRecords(db: Db, dir: Directory, assignmentId: string, email?: string) {
  const grades = db.listGrades(assignmentId);
  const identities = new Map<string, GradingIdentity>();
  const latest = db.listLatestSubmissions(assignmentId, email).map(({ email: e, record }): SubmissionRecord => {
    const who = dir.identityOf(e);
    identities.set(who.key, who);
    const mine = grades.get(e) ?? [];
    return { ...record, studentKey: who.key, ...(mine.length ? { grades: mine } : {}) };
  });
  return { latest, identities };
}

function summaryWith(db: Db, dir: Directory, id: string, now: number): AssignmentGradingSummary | null {
  const assignment = db.getAssignment(id);
  if (!assignment) return null;
  const { latest, identities } = latestRecords(db, dir, id);
  return buildAssignmentSummary({
    assignment,
    roster: dir.roster,
    latest,
    identify: (key) => identities.get(key)!,
    released: db.getGradesReleased(id),
    now,
  });
}

/** The address a student key names — an account's public_id, or a removed
 *  submitter's derived key (the one a summary row carries); null for
 *  neither. The ONE key resolver: the grade writes (app.ts gradeRoute) take
 *  every key a summary hands out. */
export function studentEmailOf(db: Db, secret: string, key: string): string | null {
  return new Directory(db, secret).emailOf(key);
}

/** GET /api/assignments/:id/summary; null = no such assignment. */
export function assignmentSummary(db: Db, secret: string, id: string, now: number): AssignmentGradingSummary | null {
  return summaryWith(db, new Directory(db, secret), id, now);
}

/** GET /api/grading. */
export function courseGrading(db: Db, secret: string, now: number): CourseGrading {
  const dir = new Directory(db, secret);
  const visible = db.listVisible();
  return buildCourseGrading({
    roster: dir.roster,
    assignments: db.listAssignments().map((a) => ({
      summary: summaryWith(db, dir, a.id, now)!,
      ...(a.order !== undefined ? { order: a.order } : {}),
      visible: visible.get(a.id) ?? false,
    })),
  });
}

/** GET /api/students/:sid; null = no student by that key. */
export function studentGrading(db: Db, secret: string, key: string, now: number): StudentGrading | null {
  const dir = new Directory(db, secret);
  const email = dir.emailOf(key);
  if (!email) return null;
  const student = dir.identityOf(email);
  const released = db.listGradesReleased();
  return buildStudentGrading({
    student,
    assignments: db.listAssignments().map((assignment) => {
      const { latest } = latestRecords(db, dir, assignment.id, email);
      return { assignment, released: released.get(assignment.id) ?? false, latest: latest[0] ?? null };
    }),
    now,
  });
}

/** GET /api/assignments/:id/submissions/:sid/:attempt; null = no such
 *  assignment, student or attempt. */
export function attemptDetail(db: Db, secret: string, id: string, key: string, attempt: number, now: number): AttemptDetail | null {
  const dir = new Directory(db, secret);
  const assignment = db.getAssignment(id);
  const email = dir.emailOf(key);
  const record = assignment && email && Number.isInteger(attempt) ? db.getSubmission(id, email, attempt) : null;
  if (!assignment || !email || !record) return null;
  const student = dir.identityOf(email);
  const grades = db.listGrades(id).get(email) ?? [];
  return buildAttemptDetail({
    assignment,
    student,
    record: { ...record, studentKey: student.key, ...(grades.length ? { grades } : {}) },
    events: db.listGradeEvents(id).filter((e) => e.student === email),
    now,
  });
}

/** GET /api/assignments/:id/questions/:qid/responses — the hand-grading
 *  queue's feed (task 066), with the live claims as `viewer` (the grader's
 *  email; never sent) sees them; null = no such assignment or question. */
export function questionResponses(
  db: Db,
  secret: string,
  id: string,
  questionId: number,
  claims: ClaimBook,
  viewer: string,
  now: number,
): QuestionResponses | null {
  const assignment = db.getAssignment(id);
  if (!assignment) return null;
  const dir = new Directory(db, secret);
  const { latest, identities } = latestRecords(db, dir, id);
  return buildQuestionResponses({
    assignment,
    questionId,
    roster: dir.roster,
    latest,
    identify: (key) => identities.get(key)!,
    claims: claims.active(id, questionId, now, viewer),
    released: db.getGradesReleased(id),
    now,
  });
}
