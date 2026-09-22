// A student's grade sheet for one assignment: one row per question, with what
// the autograder (or the instructor's review) made of it. Rendered inline on
// the Grades page (GradesView) under the assignment's row.
//
// Shown only once the instructor has RELEASED grades — before that a student
// sees nothing, not even on submit (the release flag on the AssignmentStore
// seam; remotely the server withholds the whole result until then). Per-case
// detail is safe-widened: the student sees which INPUT they failed on, tucked
// into a per-question "failed inputs" dropdown, never the answer key
// (server/src/sanitize.ts strips expected/got; in local mode the full detail
// was always present, this sheet just never renders it).

import { useState } from 'react';
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

export function GradeSheet({ assignmentId, record }: { assignmentId: string; record: SubmissionRecord }) {
  const { value: assignment, loading } = useAsyncValue(
    () => getAssignment(assignmentId),
    [assignmentId],
  );
  const [expanded, setExpanded] = useState<number | null>(null);

  const byId = new Map((record.result?.questions ?? []).map((q) => [q.questionId, q]));
  const questions = assignment?.questions ?? [];
  const counted = questions.filter((q) => {
    const v = questionVerdict(byId.get(q.id));
    return v.tone === 'pass' || v.tone === 'fail';
  });
  const correct = counted.filter((q) => questionVerdict(byId.get(q.id)).tone === 'pass').length;

  const goToQuestion = (i: number) => navigate({ kind: 'assignment', id: assignmentId, questionIndex: i });

  if (loading && questions.length === 0) return <p className="mm-empty">Loading…</p>;

  return (
    <div className="grade-sheet">
      <table className="mm-table grades-table">
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
                  <button className="mm-link" onClick={() => goToQuestion(i)} title="Go to this question">
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
                      <button className="mm-link" onClick={() => goToQuestion(i)}>
                        Open my submission →
                      </button>
                    </div>
                  )}
                </td>
                <td><span className="tag">{questionModeLabel(q)}</span></td>
                <td className={`grades-verdict grades-verdict--${v.tone}`}>{v.text}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="grades-foot">
        {correct} of {counted.length} graded question{counted.length === 1 ? '' : 's'} correct.
        {counted.length < questions.length &&
          ` ${questions.length - counted.length} not counted yet.`}
      </p>
    </div>
  );
}
