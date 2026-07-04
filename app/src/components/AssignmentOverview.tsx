import { useStore } from '../store';
import { navigate } from '../routing';
import { getCurrentUserEmail, useAuth } from '../auth';

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

  if (!assignment) return null;
  const sub = submissions[assignment.id];

  const handleSubmit = () => {
    const ok = confirm(
      `Submit "${assignment.title}"? This records a snapshot of your current work.\n\n` +
      'Note: only your most recent submission is graded — submitting again replaces any earlier submission for grading purposes.'
    );
    if (!ok) return;
    submitAssignment(assignment.id, getCurrentUserEmail());
  };

  return (
    <div className="welcome-screen">
      <div className="home-card">
        <div className="home-session">
          <button className="menu-link-button" onClick={() => navigate({ kind: 'home' })}>
            ← All assignments
          </button>
          {user && <span className="session-chip">{user.name} · {user.role === 'instructor' ? 'Instructor' : 'Student'}</span>}
        </div>

        <h1 className="welcome-title">{assignment.title}</h1>
        <p className="welcome-subtitle">
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
                <span className="assignment-overview-mode">{q.buildMode}</span>
                <span className="assignment-overview-statement">{q.statement}</span>
              </button>
            ))}
            {assignment.questions.length === 0 && (
              <p className="home-empty">This assignment has no questions yet.</p>
            )}
          </div>
        </section>

        <section className="home-section">
          <div className="home-tile-footer" style={{ borderTop: 'none', paddingTop: 0 }}>
            {sub ? (
              <span className="home-tile-status home-tile-status--done" title={`Attempt ${sub.attempt}`}>
                ✓ Submitted {new Date(sub.submittedAt).toLocaleString()}
              </span>
            ) : (
              <span className="home-tile-status">Not submitted</span>
            )}
            <button className="home-tile-submit" onClick={handleSubmit}>
              Submit assignment
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
