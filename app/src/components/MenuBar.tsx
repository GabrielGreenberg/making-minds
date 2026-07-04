import { useStore } from '../store';
import { getCurrentUserEmail, useAuth } from '../auth';
import { navigate } from '../routing';

export function MenuBar() {
  const { user, logout } = useAuth();
  const { assignment, submitAssignment, submissions } = useStore();

  const handleSubmitAssignment = () => {
    if (!assignment) return;
    const ok = confirm(
      `Submit "${assignment.title}"? This records a snapshot of your current work.\n\n` +
      'Note: only your most recent submission is graded — submitting again replaces any earlier submission for grading purposes.'
    );
    if (!ok) return;
    submitAssignment(assignment.id, getCurrentUserEmail());
  };

  return (
    <div className="menu-bar">
      {/* Home — back to the assignment catalog */}
      <div className="menu-item" onClick={() => navigate({ kind: 'home' })}>
        ⌂ Home
      </div>

      {/* Submit — record an immutable snapshot of the current assignment. */}
      {assignment && (
        <div
          className="menu-item menu-submit"
          onClick={handleSubmitAssignment}
          title={
            submissions[assignment.id]
              ? `Last submitted ${new Date(submissions[assignment.id].submittedAt).toLocaleString()}`
              : 'Submit this assignment'
          }
        >
          {submissions[assignment.id] ? 'Submit ✓' : 'Submit'}
        </div>
      )}

      {/* Session controls — right-aligned. The instructor link is shown only to
          instructor accounts; students never see it (typing #/instructor hits the
          access-denied gate). */}
      <div className="menu-right">
        {user?.role === 'instructor' && (
          <button
            className="menu-link-button"
            onClick={() => navigate({ kind: 'instructor' })}
          >
            Instructor view
          </button>
        )}
        {user && <span className="session-chip">{user.name} · {user.role === 'instructor' ? 'Instructor' : 'Student'}</span>}
        <button className="menu-link-button" onClick={() => { logout(); navigate({ kind: 'home' }); }}>
          Log out
        </button>
      </div>
    </div>
  );
}
