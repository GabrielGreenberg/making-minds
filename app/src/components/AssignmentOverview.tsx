import { useStore } from '../store';
import { navigate } from '../routing';
import { getCurrentUserEmail, useAuth } from '../auth';
import { questionModeLabel } from '../types';
import { statementProse } from '../statementFormat';
import { GradesPanel } from './GradesPanel';
import { useState } from 'react';
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
  const { user } = useAuth();
  const [showGrades, setShowGrades] = useState(false);
  // Release is policy on the seam, not part of the assignment, so the page has
  // to ask for it (the home catalog gets it on the summary).
  const { value: released } = useAsyncValue(
    () => (assignment ? assignmentStore.getGradesReleased(assignment.id) : Promise.resolve(false)),
    [assignment?.id],
  );

  if (!assignment) return null;
  const sub = submissions[assignment.id];

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
    <div className="page">
      <header className="page-bar page-bar--split">
        <button className="menu-link-button" onClick={() => navigate({ kind: 'home' })}>
          ← All assignments
        </button>
        {user && (
          <span className="session-chip">
            {user.name}
            {user.role === 'instructor' ? ' · Instructor' : ''}
          </span>
        )}
      </header>
      <div className="page-body">
        <h1 className="page-title">{assignment.title}</h1>
        <p className="page-subtitle">
          {assignment.questions.length} question{assignment.questions.length === 1 ? '' : 's'} — pick one to work on
        </p>

        <section className="home-section">
          <div className="assignment-overview-list">
            {assignment.questions.map((q, i) => (
              <button
                key={q.id}
                className="assignment-overview-item"
                onClick={() => navigate({ kind: 'assignment', id: assignment.id, questionIndex: i })}
              >
                <span className="assignment-overview-label">{q.label}</span>
                <span className="assignment-overview-mode">{questionModeLabel(q)}</span>
                <span className="assignment-overview-statement">
                  {q.title && <strong className="assignment-overview-title">{q.title}. </strong>}
                  {statementProse(q.statement)}
                </span>
              </button>
            ))}
            {assignment.questions.length === 0 && (
              <p className="home-empty">This assignment has no questions yet.</p>
            )}
          </div>
        </section>

        <section className="home-section">
          <div className="assignment-overview-submit">
            {sub ? (
              <span className="home-tile-status home-tile-status--done" title={`Attempt ${sub.attempt}`}>
                ✓ Submitted {new Date(sub.submittedAt).toLocaleString()}
              </span>
            ) : (
              <span className="home-tile-status">Not submitted</span>
            )}
            <span className="assignment-overview-submit-actions">
              {released && sub?.result && (
                <button className="menu-link-button" onClick={() => setShowGrades(true)}>
                  View grades
                </button>
              )}
              <button className="home-tile-submit" onClick={handleSubmit}>
                Submit assignment
              </button>
            </span>
          </div>
        </section>
      </div>
      {showGrades && sub && (
        <GradesPanel
          assignmentId={assignment.id}
          record={sub}
          onClose={() => setShowGrades(false)}
        />
      )}
    </div>
  );
}
