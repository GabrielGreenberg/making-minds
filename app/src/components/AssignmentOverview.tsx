import { useStore, selectAssignmentFrozen } from '../store';
import { navigate } from '../routing';
import { getCurrentUserEmail, useAuth } from '../auth';
import { questionModeLabel } from '../types';
import { statementProse } from '../statementFormat';
import { GradesPanel } from './GradesPanel';
import { PageShell, appNav } from './PageShell';
import { SessionControls } from './SessionControls';
import { useState, useEffect } from 'react';
import { useAsyncValue } from '../useAsyncValue';
import { assignmentStore } from '../storage/backend';

/**
 * The question list an assignment opens to. Clicking a question opens its
 * dedicated canvas (#/a/:id/q/:i); the canvas's nav bar leads back here or to
 * the neighbouring questions. Submit covers the whole assignment.
 */
export function AssignmentOverview() {
  const assignment = useStore((s) => s.assignment);
  const submissions = useStore((s) => s.submissions);
  const submitAssignment = useStore((s) => s.submitAssignment);
  const hydrateSubmissions = useStore((s) => s.hydrateSubmissions);
  const questionCircuits = useStore((s) => s.questionCircuits);
  const frozen = useStore(selectAssignmentFrozen);
  const { user } = useAuth();
  const [showGrades, setShowGrades] = useState(false);
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

  const handleSubmit = () => {
    const ok = confirm(
      `Submit "${assignment.title}"? This records a snapshot of your current work.\n\n` +
      'Note: only your most recent submission is graded — submitting again replaces any earlier submission for grading purposes.'
    );
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
    <PageShell nav={appNav('student', user?.role === 'instructor' ? 'instructor' : 'student')} session={<SessionControls />}>
      <div className="mm-head">
        <a
          className="eyebrow"
          href="#/"
          onClick={(e) => { e.preventDefault(); navigate({ kind: 'home' }); }}
        >
          ← All assignments
        </a>
        <h1>{assignment.title}</h1>
        <p className="mm-lede">
          {total} question{total === 1 ? '' : 's'} — pick one to work on
          {total > 0 && ` · ${done} of ${total} marked done`}
        </p>
      </div>

      <div className="mm-list">
        {assignment.questions.map((q, i) => (
          <button
            key={q.id}
            className="overview-row"
            onClick={() => navigate({ kind: 'assignment', id: assignment.id, questionIndex: i })}
          >
            <span className="overview-label">
              {q.label}
              {questionCircuits.get(q.id)?.done && (
                <span className="overview-done" title="Marked done">✓</span>
              )}
            </span>
            <span className="tag tag--accent">{questionModeLabel(q)}</span>
            <span className="overview-statement">
              {q.title && <strong>{q.title}. </strong>}
              {statementProse(q.statement)}
            </span>
          </button>
        ))}
        {total === 0 && <p className="mm-empty">This assignment has no questions yet.</p>}
      </div>

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
            <button className="mm-btn" onClick={() => setShowGrades(true)}>
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

      {showGrades && sub && (
        <GradesPanel
          assignmentId={assignment.id}
          record={sub}
          onClose={() => setShowGrades(false)}
        />
      )}
    </PageShell>
  );
}
