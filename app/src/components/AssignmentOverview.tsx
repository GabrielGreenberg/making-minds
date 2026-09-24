import { useStore, selectAssignmentFrozen } from '../store';
import { navigate } from '../routing';
import { getCurrentUserEmail } from '../auth';
import { StudentLayout } from './StudentLayout';
import { ProblemSetDocument, type ProblemStatus } from './ProblemSetDocument';
import { useEffect } from 'react';
import { useAsyncValue } from '../useAsyncValue';
import { assignmentStore } from '../storage/backend';
import { figureUrl } from '../problemSet';
import { questionVerdict } from '../gradeDisplay';
import { formatDueDate } from '../dueDates';
import { submitConfirmMessage } from '../provenance/notice';
import type { AssignmentQuestion } from '../types';

/**
 * The page an assignment opens to: the problem set as a document (title, due
 * date, preamble, sections, numbered problems — components/ProblemSetDocument).
 * Clicking a problem opens its dedicated canvas (#/a/:id/q/:i); the canvas's
 * nav bar leads back here or to the neighbouring problems. Submit covers the
 * whole assignment.
 */
export function AssignmentOverview() {
  const assignment = useStore((s) => s.assignment);
  const submissions = useStore((s) => s.submissions);
  const submitAssignment = useStore((s) => s.submitAssignment);
  const hydrateSubmissions = useStore((s) => s.hydrateSubmissions);
  const questionCircuits = useStore((s) => s.questionCircuits);
  const frozen = useStore(selectAssignmentFrozen);
  // Release is policy on the seam, not part of the assignment, so the page has
  // to ask for it (the home catalog gets it on the summary).
  const { value: released } = useAsyncValue(
    () => (assignment ? assignmentStore.getGradesReleased(assignment.id) : Promise.resolve(false)),
    [assignment?.id],
  );

  // Re-fetch on every visit (not just once at app boot) so a grade or
  // feedback note recorded after the student's last reload shows up here
  // without requiring a hard refresh.
  useEffect(() => {
    void hydrateSubmissions();
  }, [hydrateSubmissions, assignment?.id]);

  if (!assignment) return null;
  const sub = submissions[assignment.id];
  const total = assignment.questions.length;
  const done = assignment.questions.filter((q) => questionCircuits.get(q.id)?.done).length;
  const results = released && sub?.result
    ? new Map(sub.result.questions.map((r) => [r.questionId, r]))
    : null;
  const status = (q: AssignmentQuestion): ProblemStatus => ({
    done: questionCircuits.get(q.id)?.done,
    verdict: results ? questionVerdict(results.get(q.id)) : undefined,
  });

  const handleSubmit = () => {
    const ok = confirm(submitConfirmMessage(assignment.title));
    if (!ok) return;
    // Online-only submit: a failure records nothing and asks for a visible
    // retry — never a silent (late) queue. See MenuBar's handler.
    void submitAssignment(assignment.id, getCurrentUserEmail()).catch(() => {
      alert(
        'Submission failed — the server could not be reached, and nothing was recorded.\n\n' +
        'Your work is still saved. Please try Submit again in a moment.'
      );
    });
  };

  return (
    <StudentLayout current="assignments">
      <div className="mm-head">
        <a
          className="eyebrow"
          href="#/"
          onClick={(e) => { e.preventDefault(); navigate({ kind: 'home' }); }}
        >
          ← All assignments
        </a>
        <h1>{assignment.title}</h1>
        <p className="mm-lede overview-meta">
          {assignment.dueDate && <span>Due {formatDueDate(assignment.dueDate)}</span>}
          <span>
            {total} problem{total === 1 ? '' : 's'}
            {total > 0 && ` · ${done} of ${total} marked done`}
          </span>
          {assignment.sourcePdf && (
            <a
              className="mm-link"
              href={figureUrl(assignment.sourcePdf, import.meta.env.BASE_URL)}
              target="_blank"
              rel="noopener"
            >
              Original PDF ↗
            </a>
          )}
        </p>
      </div>

      <ProblemSetDocument
        assignment={assignment}
        route={(index) => ({ kind: 'assignment', id: assignment.id, questionIndex: index })}
        status={status}
      />

      <div className="overview-submit">
        {sub ? (
          <span className="home-status--done" title={`Attempt ${sub.attempt}`}>
            ✓ Submitted {new Date(sub.submittedAt).toLocaleString()}
          </span>
        ) : (
          <span className="dim">Not submitted</span>
        )}
        <span className="mm-actions">
          {released && sub?.result && (
            <button className="mm-btn" onClick={() => navigate({ kind: 'grades', id: assignment.id })}>
              View grades
            </button>
          )}
          {frozen ? (
            <span
              className="home-locked"
              title="This assignment closed after its due date — each question shows your submission, read-only."
            >
              🔒 Past due — showing your submission
            </span>
          ) : (
            <button className="mm-btn mm-btn--primary" onClick={handleSubmit}>
              Submit assignment
            </button>
          )}
        </span>
      </div>

    </StudentLayout>
  );
}
