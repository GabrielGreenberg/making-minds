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
  QuestionCircuit,
  SubmissionData,
  SubmissionRecord,
} from '../types';
import { questionTask } from '../types';
import { emptyQuestionCircuit } from './workbookStore';
import { gradeSubmission } from '../engine/grader';
import { applyManualReview } from './manualReview';
import { assessIntegrity } from '../provenance/integrity';
import { deriveMintKey, DEV_MINT_SECRET } from '../provenance/ids';
import { TOY_ACCOUNTS } from '../auth/accounts';

// The pure review helper lives in storage/manualReview.ts (a types-only leaf)
// so the server's review endpoint can import it without pulling this
// localStorage-backed module into its graph; re-exported here so app-side
// consumers keep one import path.
export { applyManualReview } from './manualReview';

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
  opts: { student?: string; submittedAt: string },
): SubmissionData {
  return {
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
  /** Append a new attempt and return the recorded (immutable) record. */
  submit(id: string, submission: SubmissionData): Promise<SubmissionRecord>;
  /** The principal's own attempts, oldest first. */
  listOwn(id: string, email: string | null): Promise<SubmissionRecord[]>;
  /** The principal's own latest attempt, or null if they never submitted. */
  getLatestOwn(id: string, email: string | null): Promise<SubmissionRecord | null>;
  /** Every student's attempts, full detail — the instructor gradebook's feed. */
  listAll(id: string): Promise<SubmissionRecord[]>;
  /**
   * Record (or overwrite) the instructor's verdict on a pending open question
   * of one stored attempt. Returns the updated record, or null if the attempt
   * has no pending question with that id. An instructor/server capability —
   * nothing student-facing calls this.
   *
   * `student` identifies WHOSE attempt: attempt numbers count per
   * (assignment, student) in both stores, so the attempt alone is ambiguous.
   */
  recordManualReview(
    id: string,
    student: string,
    attempt: number,
    questionId: number,
    review: { pass: boolean; note?: string },
  ): Promise<SubmissionRecord | null>;
}

const KEY_PREFIX = 'mm:sub:';

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
    return this.read(id).filter((r) => sameStudent(r.submission.student, email));
  }

  async getLatestOwn(id: string, email: string | null): Promise<SubmissionRecord | null> {
    const own = await this.listOwn(id, email);
    return own.length ? own[own.length - 1] : null;
  }

  async listAll(id: string): Promise<SubmissionRecord[]> {
    return this.read(id);
  }

  /**
   * Drop all stored submissions for an assignment (e.g. reseeding dev data).
   * Deliberately OFF the `SubmissionStore` seam — dev/local-mode only.
   */
  async clearSubmissions(id: string): Promise<void> {
    try {
      localStorage.removeItem(KEY_PREFIX + id);
    } catch {
      // ignore
    }
  }

  async submit(id: string, submission: SubmissionData): Promise<SubmissionRecord> {
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
    };
    try {
      localStorage.setItem(KEY_PREFIX + id, JSON.stringify([...all, record]));
    } catch {
      // localStorage full or unavailable — silent fail (matches autosave).
    }
    return record;
  }

  async recordManualReview(
    id: string,
    student: string,
    attempt: number,
    questionId: number,
    review: { pass: boolean; note?: string },
  ): Promise<SubmissionRecord | null> {
    // Attempt numbers are per student, so review within that student's
    // records and write them back into their own positions (applyManualReview
    // maps, so the subset keeps its length and order).
    const all = this.read(id);
    const positions = all
      .map((r, i) => (sameStudent(r.submission.student, student) ? i : -1))
      .filter((i) => i >= 0);
    const updated = applyManualReview(
      positions.map((i) => all[i]),
      attempt,
      questionId,
      {
        pass: review.pass,
        note: review.note?.trim() || undefined,
        reviewedAt: new Date().toISOString(),
      },
    );
    if (!updated) return null;
    const merged = [...all];
    positions.forEach((pos, k) => {
      merged[pos] = updated[k];
    });
    try {
      localStorage.setItem(KEY_PREFIX + id, JSON.stringify(merged));
    } catch {
      // localStorage full or unavailable — silent fail (matches submit).
    }
    return updated.find((r) => r.attempt === attempt) ?? null;
  }
}

// Exported as the concrete class (not the interface) so dev-only capabilities
// off the seam (`clearSubmissions`) stay reachable for devData/seed.ts.
export const localSubmissionStore = new LocalSubmissionStore();
