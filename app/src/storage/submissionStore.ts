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
import { emptyQuestionCircuit } from './workbookStore';
import { gradeSubmission } from '../engine/grader';
import { applyManualReview } from './manualReview';

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
      if (q.buildMode === 'open') answer.responseText = c.responseText ?? '';
      return answer;
    }),
  };
}

// Promise-returning (a remote backend is intrinsically async); the local
// implementation resolves immediately. Note `clearSubmissions` is NOT on the
// seam — it's a dev-only capability of the local store (devData/seed.ts pins
// the concrete class); a server never exposes "delete all submissions".
export interface SubmissionStore {
  /** Append a new attempt and return the recorded (immutable) record. */
  submit(id: string, submission: SubmissionData): Promise<SubmissionRecord>;
  listSubmissions(id: string): Promise<SubmissionRecord[]>;
  getLatest(id: string): Promise<SubmissionRecord | null>;
  /**
   * Record (or overwrite) the instructor's verdict on a pending open question
   * of one stored attempt. Returns the updated record, or null if the attempt
   * has no pending question with that id. An instructor/server capability —
   * nothing student-facing calls this.
   *
   * `student` identifies WHOSE attempt: the server counts attempt numbers per
   * (assignment, student), so the attempt alone is ambiguous remotely. The
   * local store numbers attempts per assignment and ignores it (its lookup by
   * attempt is already unique) — the parameter exists so both implementations
   * share one signature.
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

  async listSubmissions(id: string): Promise<SubmissionRecord[]> {
    return this.read(id);
  }

  async getLatest(id: string): Promise<SubmissionRecord | null> {
    const all = this.read(id);
    return all.length ? all[all.length - 1] : null;
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
    const record: SubmissionRecord = {
      assignmentId: id,
      attempt: all.length + 1,
      submittedAt: submission.submittedAt,
      submission,
      result,
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
    _student: string,
    attempt: number,
    questionId: number,
    review: { pass: boolean; note?: string },
  ): Promise<SubmissionRecord | null> {
    // `_student` is unused locally: local attempt numbers are unique per
    // assignment (see the interface note), so the attempt alone identifies
    // the record — behavior is byte-identical to the pre-S3 seam.
    const all = this.read(id);
    const updated = applyManualReview(all, attempt, questionId, {
      pass: review.pass,
      note: review.note?.trim() || undefined,
      reviewedAt: new Date().toISOString(),
    });
    if (!updated) return null;
    try {
      localStorage.setItem(KEY_PREFIX + id, JSON.stringify(updated));
    } catch {
      // localStorage full or unavailable — silent fail (matches submit).
    }
    return updated.find((r) => r.attempt === attempt) ?? null;
  }
}

// Exported as the concrete class (not the interface) so dev-only capabilities
// off the seam (`clearSubmissions`) stay reachable for devData/seed.ts.
export const localSubmissionStore = new LocalSubmissionStore();
