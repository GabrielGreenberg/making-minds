// A student's own grade sheet: one row per question of the assignment, with
// what the autograder (or the instructor's review) made of it.
//
// Shown only once the instructor has RELEASED grades — before that a student
// sees nothing, not even on submit (the release flag on the AssignmentStore
// seam; remotely the server withholds the whole result until then). Per-case
// detail is now safe-widened (notes/todos.md item 4): the student sees which
// INPUT they failed on, tucked into a per-question "Failed inputs" dropdown,
// never the answer key (server/src/sanitize.ts still strips expected/got —
// in local mode the full detail was always present, this panel just never
// rendered it before).

import { useEffect, useState } from 'react';
import type { QuestionResult, SubmissionRecord } from '../types';
import { questionModeLabel } from '../types';
import { getAssignment } from '../assignments';
import { questionVerdict } from '../gradeDisplay';
import { useAsyncValue } from '../useAsyncValue';
import { navigate } from '../routing';

/** The failing rows for one question's result, in whatever shape it graded
 *  under — always the SAFE fields only (never expected/got/the answer key). */
function FailedInputs({ qr }: { qr: QuestionResult }) {
  if (qr.turbotCases) {
    const failed = qr.turbotCases.map((c, i) => ({ ...c, arena: i + 1 })).filter((c) => !c.pass);
    if (failed.length === 0) return null;
    return (
      <ul className="grades-failed-list">
        {failed.map((c) => (
          <li key={c.arena}>
            arena #{c.arena} — {c.stepsTaken} step{c.stepsTaken === 1 ? '' : 's'}, ended at ({c.finalPosition.x}, {c.finalPosition.y}) {c.finalPosition.facing}
            {c.reason && <> — {c.reason}</>}
          </li>
        ))}
      </ul>
    );
  }
  if (qr.perceptionCases) {
    const failed = qr.perceptionCases.filter((c) => !c.pass);
    if (failed.length === 0) return null;
    return (
      <ul className="grades-failed-list">
        {failed.map((c, i) => (
          <li key={i}>frames {c.frames.map((f) => f.join('')).join(' → ')}{c.failStep != null && ` — first wrong at step ${c.failStep}`}</li>
        ))}
      </ul>
    );
  }
  if (qr.fillCases) {
    const failed = qr.fillCases.filter((c) => !c.pass);
    if (failed.length === 0) return null;
    return (
      <ul className="grades-failed-list">
        {failed.map((c, i) => <li key={i}>blank "{c.label}"</li>)}
      </ul>
    );
  }
  const failed = qr.cases.filter((c) => !c.pass);
  if (failed.length === 0) return null;
  return (
    <ul className="grades-failed-list">
      {failed.map((c, i) => <li key={i}>input {c.input.join(', ')}{c.reason && ` — ${c.reason}`}</li>)}
    </ul>
  );
}

function hasFailedCases(qr: QuestionResult | undefined): boolean {
  if (!qr) return false;
  if (qr.turbotCases) return qr.turbotCases.some((c) => !c.pass);
  if (qr.perceptionCases) return qr.perceptionCases.some((c) => !c.pass);
  if (qr.fillCases) return qr.fillCases.some((c) => !c.pass);
  return qr.cases.some((c) => !c.pass);
}

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
  const [expanded, setExpanded] = useState<number | null>(null);

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

  const goToQuestion = (i: number) => {
    onClose();
    navigate({ kind: 'assignment', id: assignmentId, questionIndex: i });
  };

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
                {questions.map((q, i) => {
                  const qr = byId.get(q.id);
                  const v = questionVerdict(qr);
                  const note = qr?.manual?.note?.trim();
                  const failed = hasFailedCases(qr);
                  return (
                    <tr key={q.id}>
                      <td>
                        <button className="grades-q-link" onClick={() => goToQuestion(i)} title="Go to this question">
                          {q.label}
                        </button>
                        {q.title && <span className="grades-q-title">{q.title}</span>}
                        {note && (
                          <p className="grades-feedback-note">
                            <span className="grades-feedback-label">Instructor feedback:</span> {note}
                          </p>
                        )}
                        {failed && (
                          <button
                            className="grades-failed-toggle"
                            onClick={() => setExpanded(expanded === q.id ? null : q.id)}
                          >
                            {expanded === q.id ? '▾' : '▸'} failed inputs
                          </button>
                        )}
                        {failed && expanded === q.id && qr && (
                          <div className="grades-failed-dropdown">
                            <FailedInputs qr={qr} />
                            <button className="grades-q-link" onClick={() => goToQuestion(i)}>
                              Open my submission →
                            </button>
                          </div>
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
