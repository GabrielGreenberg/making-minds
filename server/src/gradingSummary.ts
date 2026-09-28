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
//
// Flags (task 070): every summary is built under the course's thresholds
// (course_settings.flagThresholds, normalized), so its rows carry their
// flags; the student page adds course-wide ones, their notes and log.

import { createHash } from 'node:crypto';
import type { Db, GradingUserRow } from './db';
import type { GradeEvent, LateExtension, LateWaiver, StudentNote, SubmissionRecord } from '../../app/src/types';
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
  type LateContext,
  type QuestionResponses,
  type StudentGrading,
} from '../../app/src/storage/gradingSummary';
import { buildGradesExport, type GradesExport } from '../../app/src/storage/gradesExport';
import type { ClaimBook } from '../../app/src/storage/gradingClaims';
import { planRegrade, type RegradePlan, type RegradeWrite } from '../../app/src/storage/regrade';
import { courseFlags, normalizeThresholds, type FlagThresholds } from '../../app/src/storage/gradingFlags';

/** The course's flag thresholds: what an instructor stored, defaults filled. */
export function flagThresholds(db: Db): FlagThresholds {
  return normalizeThresholds(db.getCourseSetting('flagThresholds'));
}

function derivedKey(secret: string, email: string): string {
  return 'x' + createHash('sha256').update(`${secret}\0grading\0${email}`).digest('base64url').slice(0, 12);
}

/** Who is who, for one request: the roster, and email ↔ key ↔ identity. */
class Directory {
  readonly roster: GradingIdentity[];
  private readonly byEmail = new Map<string, GradingUserRow>();
  /** Each account's key → its address (the export's email column). */
  private readonly emailByKey = new Map<string, string>();
  private readonly db: Db;
  private readonly secret: string;

  constructor(db: Db, secret: string) {
    this.db = db;
    this.secret = secret;
    const users = db.listGradingUsers();
    for (const u of users) this.byEmail.set(u.email, u);
    this.roster = users.filter((u) => u.role === 'student').map((u) => this.identity(u));
    for (const u of users) this.emailByKey.set(this.identity(u).key, u.email);
  }

  /** The address of an account's key, without a query ('' for none). */
  accountEmail(key: string): string {
    return this.emailByKey.get(key) ?? '';
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

  /** An account's display name (a note's author); undefined for none. */
  nameOf(email: string): string | undefined {
    return this.byEmail.get(email)?.name;
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

/** The latest attempts, each carrying its student's key and human grades;
 *  who each key is, and the address it names. */
function latestRecords(db: Db, dir: Directory, assignmentId: string, email?: string) {
  const grades = db.listGrades(assignmentId);
  const identities = new Map<string, GradingIdentity>();
  const emails = new Map<string, string>();
  const latest = db.listLatestSubmissions(assignmentId, email).map(({ email: e, record }): SubmissionRecord => {
    const who = dir.identityOf(e);
    identities.set(who.key, who);
    emails.set(who.key, e);
    const mine = grades.get(e) ?? [];
    return { ...record, studentKey: who.key, ...(mine.length ? { grades: mine } : {}) };
  });
  return { latest, identities, emails };
}

/** One assignment's late context (task 068): the synced course calendar and
 *  each student's extension and waiver, re-keyed from account email to the
 *  opaque key the builder names students by. */
function lateContext(db: Db, dir: Directory, assignmentId: string): LateContext {
  const byStudent = new Map<string, { extension?: LateExtension; waiver?: LateWaiver }>();
  const at = (email: string) => {
    const key = dir.identityOf(email).key;
    if (!byStudent.has(key)) byStudent.set(key, {});
    return byStudent.get(key)!;
  };
  for (const [email, extension] of db.listExtensions(assignmentId)) at(email).extension = extension;
  for (const [email, waiver] of db.listWaivers(assignmentId)) at(email).waiver = waiver;
  const calendar = db.courseCalendar();
  return { ...(calendar ? { calendar } : {}), byStudent };
}

function summaryWith(db: Db, dir: Directory, id: string, now: number, thresholds: FlagThresholds): AssignmentGradingSummary | null {
  const assignment = db.getAssignment(id);
  if (!assignment) return null;
  const { latest, identities } = latestRecords(db, dir, id);
  // Group listings are public_ids — the identity keys already (no groupKey).
  return buildAssignmentSummary({
    assignment,
    roster: dir.roster,
    latest,
    identify: (key) => identities.get(key)!,
    released: db.getGradesReleased(id),
    now,
    late: lateContext(db, dir, id),
    thresholds,
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
  return summaryWith(db, new Directory(db, secret), id, now, flagThresholds(db));
}

/** GET /api/grading. */
export function courseGrading(db: Db, secret: string, now: number): CourseGrading {
  const dir = new Directory(db, secret);
  const thresholds = flagThresholds(db);
  const calendar = db.courseCalendar();
  return buildCourseGrading({
    roster: dir.roster,
    assignments: allSummaries(db, dir, now, thresholds),
    thresholds,
    ...(calendar ? { calendar } : {}),
    now,
  });
}

/** GET /api/grading/export.csv (task 071): the grades CSV over the same
 *  full summaries the Grading tab reads, the email column from the account
 *  table (no query per row); with `assignmentId`, that one column — null =
 *  no such assignment. */
export function gradesExport(db: Db, secret: string, now: number, assignmentId?: string): GradesExport | null {
  const dir = new Directory(db, secret);
  const thresholds = flagThresholds(db);
  const assignments = assignmentId === undefined
    ? allSummaries(db, dir, now, thresholds)
    : [summaryWith(db, dir, assignmentId, now, thresholds)].filter((s) => s !== null).map((summary) => ({ summary, visible: true }));
  return buildGradesExport({
    assignments,
    emailOf: (key) => dir.accountEmail(key),
    now,
    ...(assignmentId !== undefined ? { only: assignmentId } : {}),
  });
}

/** Every assignment's full summary, with its place and visibility. */
function allSummaries(db: Db, dir: Directory, now: number, thresholds: FlagThresholds) {
  const visible = db.listVisible();
  return db.listAssignments().map((a) => ({
    summary: summaryWith(db, dir, a.id, now, thresholds)!,
    ...(a.order !== undefined ? { order: a.order } : {}),
    visible: visible.get(a.id) ?? false,
  }));
}

/** GET /api/students/:sid; null = no student by that key. */
export function studentGrading(db: Db, secret: string, key: string, now: number): StudentGrading | null {
  const dir = new Directory(db, secret);
  const email = dir.emailOf(key);
  if (!email) return null;
  const student = dir.identityOf(email);
  const released = db.listGradesReleased();
  const thresholds = flagThresholds(db);
  const calendar = db.courseCalendar();
  // The full summaries once: the rows (and their flags) see the whole class.
  const summaries = allSummaries(db, dir, now, thresholds);
  const byId = new Map(summaries.map((s) => [s.summary.assignmentId, s.summary]));
  const visible = db.listVisible();
  const flagged = courseFlags({ roster: dir.roster, summaries, thresholds, ...(calendar ? { calendar } : {}), now });
  const notes: StudentNote[] = db.listStudentNotes(email).map((n) => {
    const authorName = dir.nameOf(n.author);
    return { ...n, ...(authorName ? { authorName } : {}) };
  });
  return buildStudentGrading({
    student,
    assignments: db.listAssignments().map((assignment) => {
      const { latest } = latestRecords(db, dir, assignment.id, email);
      const events: GradeEvent[] = db.listGradeEvents(assignment.id).filter((e) => e.student === email);
      return {
        assignment,
        released: released.get(assignment.id) ?? false,
        visible: visible.get(assignment.id) ?? false,
        latest: latest[0] ?? null,
        late: lateContext(db, dir, assignment.id),
        summary: byId.get(assignment.id),
        events,
      };
    }),
    flags: flagged.find((f) => f.student.key === student.key)?.flags ?? [],
    notes,
    now,
  });
}

/** POST /api/students/:sid/notes — append one note under the author's
 *  address; null = no student by that key. */
export function addStudentNote(db: Db, secret: string, key: string, body: string, author: string): StudentNote | null {
  const dir = new Directory(db, secret);
  const email = dir.emailOf(key);
  if (!email) return null;
  const note = db.addStudentNote(email, body, author);
  const authorName = dir.nameOf(author);
  return { ...note, ...(authorName ? { authorName } : {}) };
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
    late: lateContext(db, dir, id),
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
    late: lateContext(db, dir, id),
  });
}

/** POST /api/assignments/:id/regrade (task 069): the re-grade's plan over
 *  every latest attempt, its writes, and the address each write's key names
 *  (the write and the log are by email; the plan never carries one). null =
 *  no such assignment. */
export function regradeInputs(
  db: Db,
  secret: string,
  id: string,
  now: number,
): { plan: RegradePlan; writes: RegradeWrite[]; emailOf: (key: string) => string } | null {
  const assignment = db.getAssignment(id);
  if (!assignment) return null;
  const { latest, identities, emails } = latestRecords(db, new Directory(db, secret), id);
  const { plan, writes } = planRegrade({ assignment, latest, identify: (key) => identities.get(key)!, now });
  return { plan, writes, emailOf: (key) => emails.get(key)! };
}
