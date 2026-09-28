// Submission seam.
//
// The Submit action records an immutable, timestamped snapshot of a student's
// work. The UI/store talk to the `SubmissionStore` interface, never to
// localStorage directly, so the future "POST to the server, autograde there"
// endpoint drops in without touching the UI. Mirrors the `WorkbookStore` seam.
//
// This layer is the "server" stand-in: it records the snapshot AND autogrades it
// on receipt (the server holds the test vectors). Grading at submit time means
// the grade is persisted on the record, so the instructor frontend reads a
// stored result instead of recomputing. When a real server endpoint lands, it
// does exactly this and the UI is unchanged.

import type {
  AssignmentData,
  Classmate,
  GradeEvent,
  HumanGrade,
  LateExtension,
  LateWaiver,
  NoteEvent,
  ExportEvent,
  QuestionCircuit,
  SubmissionData,
  SubmissionRecord,
} from '../types';
import { COURSE_LOG_ID, questionTask } from '../types';
import { emptyQuestionCircuit } from './workbookStore';
import { gradeSubmission } from '../engine/grader';
import { assessIntegrity } from '../provenance/integrity';
import { deriveMintKey, DEV_MINT_SECRET } from '../provenance/ids';
import { TOY_ACCOUNTS, readPersistedAccount } from '../auth/accounts';
import { checkGroup, SubmitRefused } from '../submissionGroup';
import { homeworkContentHash } from '../devData/homeworkSync';
import {
  legacyGradesByStudent,
  planExtensionWrite,
  planGradeWrite,
  planWaiverWrite,
  studentGrade,
  type GradeWrite,
  type GradeWritePlan,
  type LateWritePlan,
} from './gradeWrites';
import { EXTENSIONS_PREFIX, WAIVERS_PREFIX, readExtensions, readWaivers, writeLateRow } from './lateLocal';
import type { RegradeWrite } from './regrade';


/**
 * Build a submission snapshot from an assignment definition and the student's
 * per-question canvases. Pure (no storage/clock), so it's testable and works
 * identically whether the circuits come from live store state or persisted
 * state. Only the gradeable circuit (components + wires) is included per answer;
 * an open question's answer carries its free-text `responseText` instead.
 */
export function buildSubmission(
  def: AssignmentData,
  questionCircuits: Map<number, QuestionCircuit>,
  opts: { student?: string; submittedAt: string; group?: string[] },
): SubmissionData {
  const submission: SubmissionData = {
    assignmentTitle: def.title,
    student: opts.student?.trim() || undefined,
    submittedAt: opts.submittedAt,
    answers: def.questions.map((q) => {
      const c = questionCircuits.get(q.id) ?? emptyQuestionCircuit();
      const answer: SubmissionData['answers'][number] = {
        questionId: q.id,
        circuit: { components: c.components, wires: c.wires },
      };
      // A fill-in question's answer is its typed blanks; an open question's
      // is its prose (types.ts questionTask — the grader reads the same).
      const task = questionTask(q);
      if (task === 'fill-in') answer.fillAnswers = c.fillAnswers ?? [];
      else if (task === 'open') answer.responseText = c.responseText ?? '';
      // The signed editing record rides beside the answer (task 034): the
      // integrity check reads it, the grader never does.
      if (c.provenance) answer.provenance = c.provenance;
      return answer;
    }),
  };
  // The classmates listed at submit (task 062); absent when none.
  if (opts.group?.length) submission.group = [...opts.group];
  return submission;
}

// Promise-returning (a remote backend is intrinsically async); the local
// implementation resolves immediately. Note `clearSubmissions` is NOT on the
// seam — it's a dev-only capability of the local store (devData/seed.ts pins
// the concrete class); a server never exposes "delete all submissions".
//
// WHOSE records a read returns is part of the method, never a caller's
// filter (task 037). Every student-side read — Home, the overview, the
// Submit chip, the frozen view, `viewSubmission`, the Grades tab, and an
// instructor's Student view alike — uses the Own pair: only the principal's
// own attempts. Remotely the session names the person and `email` is ignored
// (the WorkbookStore.loadForOpen precedent); locally, where every toy
// account's attempts share one list, it is the filter (trimmed,
// case-insensitive; null — a visitor — matches nothing). `listAll` is the
// instructor gradebook's, and nothing student-facing may call it
// (navResetCheck grep-gates where it appears).
export interface SubmissionStore {
  /** Append a new attempt and return the recorded (immutable) record. A
   *  `submission.group` that fails `checkGroup` rejects with `SubmitRefused`
   *  (submissionGroup.ts) and nothing is recorded. */
  submit(id: string, submission: SubmissionData): Promise<SubmissionRecord>;
  /**
   * The roster's students as the principal may see them — names and opaque
   * keys only, never an email or UID — for the submit dialog's group picker
   * (task 062). A student's list leaves themself out; an instructor's is the
   * whole roster, which is also how the gradebook turns a submission's
   * `group` keys back into names. Sorted by last name.
   */
  listClassmates(): Promise<Classmate[]>;
  /** The principal's own attempts, oldest first — each carrying the human
   *  grades on their work (`grades`, student-safe: no grader or version). */
  listOwn(id: string, email: string | null): Promise<SubmissionRecord[]>;
  /** The principal's own latest attempt, or null if they never submitted. */
  getLatestOwn(id: string, email: string | null): Promise<SubmissionRecord | null>;
  /** Every student's attempts, full detail — the instructor gradebook's feed:
   *  each with its student's human grades in full and the `studentKey` the
   *  GradingStore addresses them by. */
  listAll(id: string): Promise<SubmissionRecord[]>;
}

const KEY_PREFIX = 'mm:sub:';
const GRADES_PREFIX = 'mm:grades:';
const GRADE_LOG_PREFIX = 'mm:grade-log:';
const REGRADE_SNAPSHOT_PREFIX = 'mm:regrade-snapshot:';

/** The local release flag (AssignmentStore's `mm:release:<id>`), read here
 *  without importing the assignment store. */
function readReleased(id: string): boolean {
  try {
    return localStorage.getItem('mm:release:' + id) === '1';
  } catch {
    return false;
  }
}

/** A record's student as the local grades are keyed — the email, lowercased
 *  (a dev-seed attempt with no student is ''). */
function studentOf(r: SubmissionRecord): string {
  return (r.submission.student ?? '').trim().toLowerCase();
}

/**
 * Is this record's student the principal? Trimmed and case-insensitive (the
 * server lowercases every email). A null principal (a visitor) matches no
 * record — not even an anonymous one seeded with no student.
 */
function sameStudent(recordStudent: string | undefined, email: string | null): boolean {
  if (email == null) return false;
  return (recordStudent ?? '').trim().toLowerCase() === email.trim().toLowerCase();
}

class LocalSubmissionStore implements SubmissionStore {
  /** Synchronous read shared by the async interface methods. */
  private read(id: string): SubmissionRecord[] {
    try {
      const raw = localStorage.getItem(KEY_PREFIX + id);
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data) ? (data as SubmissionRecord[]) : [];
    } catch {
      return [];
    }
  }

  async listOwn(id: string, email: string | null): Promise<SubmissionRecord[]> {
    const own = this.read(id).filter((r) => sameStudent(r.submission.student, email));
    if (own.length === 0) return own;
    const grades = ((await this.grades(id))[studentOf(own[0])] ?? []).map(studentGrade);
    // A waiver reaches the student as its points only, once grades are
    // released (the server's studentRecord rule; task 068).
    const waived = readReleased(id) ? readWaivers(id)[studentOf(own[0])]?.points : undefined;
    return own.map((r) => ({ ...r, ...(grades.length ? { grades } : {}), ...(waived ? { lateWaived: waived } : {}) }));
  }

  async getLatestOwn(id: string, email: string | null): Promise<SubmissionRecord | null> {
    const own = await this.listOwn(id, email);
    return own.length ? own[own.length - 1] : null;
  }

  async listAll(id: string): Promise<SubmissionRecord[]> {
    const all = this.read(id);
    if (all.length === 0) return all;
    const grades = await this.grades(id);
    return all.map((r) => {
      const who = studentOf(r);
      const mine = grades[who] ?? [];
      return { ...r, studentKey: who, ...(mine.length ? { grades: mine } : {}) };
    });
  }

  // ── Human grades (task 063): the local half of the GradingStore seam ──
  // `mm:grades:<id>` holds each student's grades ({ email: HumanGrade[] });
  // `mm:grade-log:<id>` the append-only change log. The first read of an
  // assignment carries its legacy ✓/✗ reviews over (gradeWrites.ts), once.

  private async grades(id: string): Promise<Record<string, HumanGrade[]>> {
    try {
      const raw = localStorage.getItem(GRADES_PREFIX + id);
      if (raw) return JSON.parse(raw) as Record<string, HumanGrade[]>;
    } catch {
      return {};
    }
    const { getAssignment } = await import('../assignments');
    const def = await getAssignment(id);
    const migrated = def ? legacyGradesByStudent(def.questions, this.read(id), studentOf) : new Map<string, HumanGrade[]>();
    const table = Object.fromEntries(migrated) as Record<string, HumanGrade[]>;
    const now = new Date().toISOString();
    this.appendLog(id, [...migrated].flatMap(([student, gs]) => gs.map((g): GradeEvent =>
      ({ at: now, actor: 'migration', student, questionId: g.questionId, kind: 'migrate', before: null, after: g }))));
    this.writeGrades(id, table);
    return table;
  }

  private writeGrades(id: string, table: Record<string, HumanGrade[]>): void {
    try {
      localStorage.setItem(GRADES_PREFIX + id, JSON.stringify(table));
    } catch {
      // localStorage full or unavailable — silent fail (matches submit).
    }
  }

  private appendLog(id: string, events: (GradeEvent | NoteEvent | ExportEvent)[]): void {
    if (events.length === 0) return;
    try {
      const raw = localStorage.getItem(GRADE_LOG_PREFIX + id);
      const log = raw ? (JSON.parse(raw) as (GradeEvent | NoteEvent | ExportEvent)[]) : [];
      localStorage.setItem(GRADE_LOG_PREFIX + id, JSON.stringify([...log, ...events]));
    } catch {
      // ignore
    }
  }

  /** Log a course-wide event — a private note (memo §9) or a grades export
   *  (task 071): under COURSE_LOG_ID, which no assignment's log (gradeLog)
   *  ever reads. */
  logCourseEvent(event: NoteEvent | ExportEvent): void {
    this.appendLog(COURSE_LOG_ID, [event]);
  }

  /** The change log, oldest first (dev / checks; the server's is the table). */
  gradeLog(id: string): GradeEvent[] {
    try {
      return JSON.parse(localStorage.getItem(GRADE_LOG_PREFIX + id) ?? '[]') as GradeEvent[];
    } catch {
      return [];
    }
  }

  /** Apply one grade write (gradeWrites.ts plans it; this persists the plan).
   *  `student` is the studentKey — locally, the email. */
  async applyGradeWrite(
    id: string,
    student: string,
    questionId: number,
    write: GradeWrite,
    actor: string,
  ): Promise<GradeWritePlan> {
    const { getAssignment } = await import('../assignments');
    const question = (await getAssignment(id))?.questions.find((q) => q.id === questionId);
    if (!question) return { ok: false, conflict: false, error: 'no such question' };
    const table = await this.grades(id);
    const mine = table[student] ?? [];
    const own = this.read(id).filter((r) => studentOf(r) === student);
    const plan = planGradeWrite({
      question,
      latest: own.length ? own.reduce((a, b) => (b.attempt > a.attempt ? b : a)) : null,
      student,
      existing: mine.find((g) => g.questionId === questionId) ?? null,
      write,
      actor,
      now: new Date().toISOString(),
    });
    if (!plan.ok) return plan;
    const rest = mine.filter((g) => g.questionId !== questionId);
    table[student] = plan.grade ? [...rest, plan.grade] : rest;
    this.writeGrades(id, table);
    this.appendLog(id, [plan.event]);
    return plan;
  }

  /**
   * A committed re-grade's writes (task 069; storage/regrade.ts plans them):
   * first the snapshot — the assignment's records as they were, copied to
   * `mm:regrade-snapshot:<id>` (the latest re-grade's; the server keeps
   * files) — then each written attempt's `result` and `assignmentHash`
   * replaced in place (the submission, its time and integrity never), and
   * the `regrade` events appended to the log. Human grades are not touched.
   * Returns the snapshot's key. Off the seam: LocalGradingStore's.
   */
  rewriteResults(id: string, writes: readonly RegradeWrite[], assignmentHash: string, events: GradeEvent[]): string {
    const raw = localStorage.getItem(KEY_PREFIX + id) ?? '[]';
    localStorage.setItem(REGRADE_SNAPSHOT_PREFIX + id, raw);
    const byAttempt = new Map(writes.map((w) => [`${w.studentKey}\0${w.attempt}`, w]));
    const next = this.read(id).map((r) => {
      const w = byAttempt.get(`${studentOf(r)}\0${r.attempt}`);
      return w ? { ...r, result: w.result, assignmentHash } : r;
    });
    localStorage.setItem(KEY_PREFIX + id, JSON.stringify(next));
    this.appendLog(id, events);
    return REGRADE_SNAPSHOT_PREFIX + id;
  }

  // ── Extensions and waivers (task 068): storage/lateLocal.ts keeps them;
  // gradeWrites.ts plans each write; every one lands in the grade log.

  /** Set or clear (null) one student's extension. */
  applyExtension(id: string, student: string, dueDate: string | null, actor: string): LateWritePlan<LateExtension> {
    const plan = planExtensionWrite({
      existing: readExtensions(id)[student] ?? null,
      dueDate,
      student,
      actor,
      now: new Date().toISOString(),
    });
    if (!plan.ok) return plan;
    writeLateRow(EXTENSIONS_PREFIX, id, student, plan.value);
    this.appendLog(id, [plan.event]);
    return plan;
  }

  /** Set or clear (null) one student's late waiver. */
  applyWaiver(id: string, student: string, write: { points: number; note?: string } | null, actor: string): LateWritePlan<LateWaiver> {
    const plan = planWaiverWrite({ existing: readWaivers(id)[student] ?? null, write, student, actor, now: new Date().toISOString() });
    if (!plan.ok) return plan;
    writeLateRow(WAIVERS_PREFIX, id, student, plan.value);
    this.appendLog(id, [plan.event]);
    return plan;
  }

  async listClassmates(): Promise<Classmate[]> {
    // Locally the toy accounts are the roster and an account's id is its key.
    const self = readPersistedAccount();
    return TOY_ACCOUNTS.filter((a) => a.role === 'student' && (self?.role !== 'student' || a.id !== self.id))
      .map((a) => ({ key: a.id, name: a.name }));
  }

  /**
   * Drop all stored submissions for an assignment (e.g. reseeding dev data).
   * Deliberately OFF the `SubmissionStore` seam — dev/local-mode only.
   */
  async clearSubmissions(id: string): Promise<void> {
    try {
      localStorage.removeItem(KEY_PREFIX + id);
      localStorage.removeItem(GRADES_PREFIX + id);
      localStorage.removeItem(GRADE_LOG_PREFIX + id);
      localStorage.removeItem(REGRADE_SNAPSHOT_PREFIX + id);
      localStorage.removeItem(EXTENSIONS_PREFIX + id);
      localStorage.removeItem(WAIVERS_PREFIX + id);
    } catch {
      // ignore
    }
  }

  async submit(id: string, submission: SubmissionData): Promise<SubmissionRecord> {
    // The group listing gets the server's check (submissionGroup.ts), against
    // the toy roster: a refused listing records nothing.
    const selfAccount = TOY_ACCOUNTS.find(
      (a) => a.email.toLowerCase() === (submission.student ?? '').trim().toLowerCase(),
    );
    const group = checkGroup(
      submission.group,
      new Set(TOY_ACCOUNTS.filter((a) => a.role === 'student').map((a) => a.id)),
      selfAccount?.id ?? null,
    );
    if (!group.ok) throw new SubmitRefused(group.error);
    const { group: _listed, ...rest } = submission;
    submission = group.group.length ? { ...rest, group: group.group } : rest;
    const all = this.read(id);
    // Autograde on receipt: the "server" holds the test vectors, so it can grade
    // the moment the submission lands and persist the result on the record.
    // The registry is imported at CALL time, not module time: statically,
    // assignments/index.ts → storage/backend.ts → this module is a cycle, and
    // whichever module a headless tool loads first would hit a TDZ on the
    // other's exports. This is the cycle's one runtime edge, so defer it.
    const { getAssignment } = await import('../assignments');
    const def = await getAssignment(id);
    const result = def ? gradeSubmission(def, submission) : undefined;
    // The integrity check the server runs (task 034), with the dev keys of the
    // toy accounts; no save history or legacy snapshot exists locally.
    const keyFor = (email: string) => deriveMintKey(DEV_MINT_SECRET, email, id);
    const self = (submission.student ?? '').toLowerCase();
    const integrity = assessIntegrity({
      questionIds: def?.questions.map((q) => q.id) ?? [],
      answers: submission.answers,
      self: { email: self, key: keyFor(self) },
      others: TOY_ACCOUNTS.map((a) => ({ email: a.email.toLowerCase(), key: keyFor(a.email) })),
    });
    // Attempts count per (assignment, student) — the server's
    // db.addSubmission rule — so one account's numbering never reveals how
    // often anyone else submitted. max + 1, not count + 1: data numbered
    // per assignment before task 037 stays unique per student. (Anonymous
    // dev-seed attempts, student '', count among themselves.)
    const attempts = all
      .filter((r) => sameStudent(r.submission.student, submission.student ?? ''))
      .map((r) => r.attempt);
    const record: SubmissionRecord = {
      assignmentId: id,
      attempt: Math.max(0, ...attempts) + 1,
      submittedAt: submission.submittedAt,
      submission,
      result,
      integrity,
      // What the result was graded against (task 063) — a later edit makes it stale.
      ...(def ? { assignmentHash: homeworkContentHash(def) } : {}),
    };
    try {
      localStorage.setItem(KEY_PREFIX + id, JSON.stringify([...all, record]));
    } catch {
      // localStorage full or unavailable — silent fail (matches autosave).
    }
    return record;
  }
}

// Exported as the concrete class (not the interface) so dev-only capabilities
// off the seam (`clearSubmissions`) stay reachable for devData/seed.ts.
export const localSubmissionStore = new LocalSubmissionStore();
