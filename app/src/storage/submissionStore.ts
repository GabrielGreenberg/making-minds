// Submission seam.
//
// The Submit action records an immutable, timestamped snapshot of a student's
// work. The UI/store talk to the `SubmissionStore` interface, never to
// localStorage directly, so the future "POST to the server, autograde there"
// endpoint drops in without touching the UI. Mirrors the `WorkbookStore` seam.
//
// Students cannot autograde: this layer only *records* the snapshot. No grading
// happens here — the server holds the test vectors and grades on receipt.

import type {
  AssignmentData,
  QuestionCircuit,
  SubmissionData,
  SubmissionRecord,
} from '../types';
import { emptyQuestionCircuit } from './workbookStore';

/**
 * Build a submission snapshot from an assignment definition and the student's
 * per-question canvases. Pure (no storage/clock), so it's testable and works
 * identically whether the circuits come from live store state or persisted
 * state. Only the gradeable circuit (components + wires) is included per answer.
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
      return { questionId: q.id, circuit: { components: c.components, wires: c.wires } };
    }),
  };
}

export interface SubmissionStore {
  /** Append a new attempt and return the recorded (immutable) record. */
  submit(id: string, submission: SubmissionData): SubmissionRecord;
  listSubmissions(id: string): SubmissionRecord[];
  getLatest(id: string): SubmissionRecord | null;
}

const KEY_PREFIX = 'mm:sub:';

class LocalSubmissionStore implements SubmissionStore {
  listSubmissions(id: string): SubmissionRecord[] {
    try {
      const raw = localStorage.getItem(KEY_PREFIX + id);
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data) ? (data as SubmissionRecord[]) : [];
    } catch {
      return [];
    }
  }

  getLatest(id: string): SubmissionRecord | null {
    const all = this.listSubmissions(id);
    return all.length ? all[all.length - 1] : null;
  }

  submit(id: string, submission: SubmissionData): SubmissionRecord {
    const all = this.listSubmissions(id);
    const record: SubmissionRecord = {
      assignmentId: id,
      attempt: all.length + 1,
      submittedAt: submission.submittedAt,
      submission,
    };
    try {
      localStorage.setItem(KEY_PREFIX + id, JSON.stringify([...all, record]));
    } catch {
      // localStorage full or unavailable — silent fail (matches autosave).
    }
    return record;
  }
}

export const localSubmissionStore: SubmissionStore = new LocalSubmissionStore();
