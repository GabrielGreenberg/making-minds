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
// was always present, this sheet just never renders it). Each failed value
// input and each failed turbot arena links into the question with that case
// loaded into a live run ("Run this input" — store loadCaseInput), so the
// student sees the output their machine gave without the sheet ever showing it.
// That run is on the student's CURRENT machine (task 002's settled wording
// says so when it has changed); "Open my submission" instead opens the attempt
// this sheet grades — `record`, the latest, the one that counts — read-only,
// at any due date (#/a/:id/submission/:n, store viewSubmission; task 003).

import { useState } from 'react';
import type { AssignmentQuestion, QuestionResult, SubmissionRecord } from '../types';
import { questionModeLabel } from '../types';
import { getAssignment } from '../assignments';
import { questionVerdict, describeCaseInput } from '../gradeDisplay';
import { recordedCaseSeparations } from '../engine/caseRun';
import { useAsyncValue } from '../useAsyncValue';
import { navigate } from '../routing';

/** The failing rows for one question's result, in whatever shape it graded
 *  under — always the SAFE fields only (never expected/got/the answer key).
 *  Value and turbot rows carry a "Run this input" link: the question opens
 *  with that case (its index in the result, parallel to the bank) loaded. */
function FailedInputs({
  qr,
  question,
  runCase,
}: {
  qr: QuestionResult;
  question: AssignmentQuestion | undefined;
  runCase: (caseIndex: number) => void;
}) {
  const runLink = (k: number) => (
    <button className="mm-link grades-run-case" onClick={() => runCase(k)} title="Open the question with this input loaded and run">
      Run this input →
    </button>
  );
  if (qr.turbotCases) {
    // Keep each arena's index in the bank (map before filter): it is the case.
    const failed = qr.turbotCases.map((c, k) => ({ ...c, k })).filter((c) => !c.pass);
    if (failed.length === 0) return null;
    return (
      <ul className="grades-failed-list">
        {failed.map((c) => (
          <li key={c.k}>
            arena #{c.k + 1} — {c.stepsTaken} step{c.stepsTaken === 1 ? '' : 's'}, ended at ({c.finalPosition.x}, {c.finalPosition.y}) {c.finalPosition.facing}
            {c.reason && <> — {c.reason}</>} {runLink(c.k)}
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
  const failed = qr.cases.map((c, k) => ({ c, k })).filter(({ c }) => !c.pass);
  if (failed.length === 0) return null;
  return (
    <ul className="grades-failed-list">
      {failed.map(({ c, k }) => (
        <li key={k}>
          input{' '}
          {describeCaseInput(question, {
            input: c.input,
            // An older result's TM gaps, from the bank when this copy has it
            // (a remote student's arrive filled in — sanitize.ts).
            separations: question ? recordedCaseSeparations(question, k, c) : c.separations,
          })}
          {c.reason && ` — ${c.reason}`} {runLink(k)}
        </li>
      ))}
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
  // The graded attempt, read-only (one question, or the whole problem set).
  const openSubmission = (i?: number) =>
    navigate({ kind: 'assignment', id: assignmentId, attempt: record.attempt, questionIndex: i });
  const runCase = (i: number, caseIndex: number) =>
    navigate({ kind: 'assignment', id: assignmentId, questionIndex: i, caseIndex });

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
                      <FailedInputs qr={qr} question={q} runCase={(k) => runCase(i, k)} />
                      <button className="mm-link" onClick={() => openSubmission(i)} title={`This question as submitted in attempt ${record.attempt}, read-only`}>
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
          ` ${questions.length - counted.length} not counted yet.`}{' '}
        <button className="mm-link" onClick={() => openSubmission()} title="Every answer as submitted in this attempt, read-only">
          Open submission {record.attempt} →
        </button>
      </p>
    </div>
  );
}
