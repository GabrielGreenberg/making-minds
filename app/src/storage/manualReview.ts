// applyManualReview — the ONE implementation of "record an instructor's
// verdict on a pending open question", shared verbatim by the local
// SubmissionStore and the server's review endpoint
// (POST /api/assignments/:id/submissions/:attempt/review), exactly as the
// server imports engine/grader. It lives in its own leaf module (types-only
// imports, no browser globals) so the server can import it without dragging
// the localStorage-backed store — or the assignment registry — into its
// module graph.

import type { ManualReview, SubmissionRecord } from '../types';

/**
 * Record an instructor's verdict on a pending (open) question of one attempt.
 * Pure: returns a new records array with the review set on the matching
 * question's result, or null if no such pending question exists. The
 * submission snapshot itself is untouched — only the grade side of the record
 * (`result`), which the server owns and may amend, is updated; re-reviewing
 * overwrites the previous verdict (the question's status stays `pending`, so
 * it remains re-reviewable and distinguishable from an autograde).
 */
export function applyManualReview(
  records: SubmissionRecord[],
  attempt: number,
  questionId: number,
  review: ManualReview,
): SubmissionRecord[] | null {
  const idx = records.findIndex((r) => r.attempt === attempt);
  const result = records[idx]?.result;
  if (!result) return null;
  const qIdx = result.questions.findIndex(
    (q) => q.questionId === questionId && q.status === 'pending',
  );
  if (qIdx < 0) return null;
  const questions = result.questions.map((q, i) =>
    i === qIdx ? { ...q, manual: review } : q,
  );
  return records.map((r, i) =>
    i === idx ? { ...r, result: { ...result, questions } } : r,
  );
}
