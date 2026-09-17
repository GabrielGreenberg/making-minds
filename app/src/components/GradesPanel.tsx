// A student's own grade sheet: one row per question of the assignment, with
// what the autograder (or the instructor's review) made of it.
//
// Shown only once the instructor has RELEASED grades — before that a student
// sees nothing, not even on submit (the release flag on the AssignmentStore
// seam; remotely the server withholds the whole result until then). Scores
// only: which cases failed is instructor-only, so nothing here reaches for
// per-case detail — and in remote mode the student's copy carries none.

import { useEffect } from 'react';
import type { SubmissionRecord } from '../types';
import { questionModeLabel } from '../types';
import { getAssignment } from '../assignments';
import { questionVerdict } from '../gradeDisplay';
import { useAsyncValue } from '../useAsyncValue';

export function GradesPanel({
  assignmentId,
  record,
  onClose,
}: {
  assignmentId: string;
  record: SubmissionRecord;
  onClose: () => void;
}) {
  const { value: assignment, loading } = useAsyncValue(
    () => getAssignment(assignmentId),
    [assignmentId],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const byId = new Map((record.result?.questions ?? []).map((q) => [q.questionId, q]));
  const questions = assignment?.questions ?? [];
  const counted = questions.filter((q) => {
    const v = questionVerdict(byId.get(q.id));
    return v.tone === 'pass' || v.tone === 'fail';
  });
  const correct = counted.filter((q) => questionVerdict(byId.get(q.id)).tone === 'pass').length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 className="modal-title">Your grades</h2>
          <button className="menu-link-button" onClick={onClose}>Close</button>
        </div>
        <p className="modal-sub">
          {record.submission.assignmentTitle} · attempt {record.attempt} ·
          {' '}submitted {new Date(record.submittedAt).toLocaleString()}
        </p>
        {loading && questions.length === 0 ? (
          <p className="home-empty">Loading…</p>
        ) : (
          <>
            <table className="grades-table">
              <thead>
                <tr>
                  <th>Question</th>
                  <th>Mode</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {questions.map((q) => {
                  const qr = byId.get(q.id);
                  const v = questionVerdict(qr);
                  const note = qr?.manual?.note?.trim();
                  return (
                    <tr key={q.id}>
                      <td>
                        {q.label}
                        {q.title && <span className="grades-q-title">{q.title}</span>}
                        {note && (
                          <p className="grades-feedback-note">
                            <span className="grades-feedback-label">Instructor feedback:</span> {note}
                          </p>
                        )}
                      </td>
                      <td className="grades-mode">{questionModeLabel(q)}</td>
                      <td className={`grades-verdict grades-verdict--${v.tone}`}>{v.text}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="modal-foot">
              {correct} of {counted.length} graded question{counted.length === 1 ? '' : 's'} correct.
              {counted.length < questions.length &&
                ` ${questions.length - counted.length} not counted yet.`}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
