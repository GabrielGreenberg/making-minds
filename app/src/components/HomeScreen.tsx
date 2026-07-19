import { useStore } from '../store';
import { listAssignments } from '../assignments';
import { navigate } from '../routing';
import { getCurrentUserEmail, useAuth } from '../auth';
import { summarizeResult } from '../engine/grader';
import { dueStatus, formatDueDate, formatDuration, lateBy } from '../dueDates';
import { useAsyncValue } from '../useAsyncValue';

function formatSubmittedAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function HomeScreen() {
  const submissions = useStore((s) => s.submissions);
  const submitAssignment = useStore((s) => s.submitAssignment);
  const { user, logout } = useAuth();

  const { value: assignmentList, loading, error, reload } = useAsyncValue(
    () => listAssignments(),
    [],
  );
  const assignments = assignmentList ?? [];

  const handleSubmit = async (id: string, title: string) => {
    const ok = confirm(
      `Submit "${title}"? This records a snapshot of your saved work.\n\n` +
      'Note: only your most recent submission is graded — submitting again replaces any earlier submission for grading purposes.'
    );
    if (!ok) return;
    let rec;
    try {
      rec = await submitAssignment(id, getCurrentUserEmail());
    } catch {
      // Online-only submit: a failure records nothing and asks for a visible
      // retry — never a silent (late) queue. The work itself is autosaved.
      alert(
        'Submission failed — the server could not be reached, and nothing was recorded.\n\n' +
        'Your work is still saved. Please try Submit again in a moment.'
      );
      return;
    }
    if (!rec) return;
    // The submission is autograded on receipt, but the grade is NEVER shown at
    // submit time — students see grades only after the instructor releases
    // them for the assignment (the release flag on the AssignmentStore seam).
    alert(
      `Submitted "${title}" (attempt ${rec.attempt}).\n` +
        'Your work has been recorded. Grades will appear here once your instructor releases them.',
    );
  };

  return (
    <div className="welcome-screen">
      <div className="home-card">
        <div className="home-session">
          {user && <span className="session-chip">{user.name} · {user.role === 'instructor' ? 'Instructor' : 'Student'}</span>}
          {user?.role === 'instructor' && (
            <button className="menu-link-button" onClick={() => navigate({ kind: 'instructor' })}>
              Instructor view
            </button>
          )}
          <button className="menu-link-button" onClick={() => { logout(); navigate({ kind: 'home' }); }}>
            Log out
          </button>
        </div>
        <h1 className="welcome-title">Making Minds</h1>
        <p className="welcome-subtitle">Design circuits, state machines, and more</p>

        <section className="home-section">
          <h2 className="home-section-title">Assignments</h2>
          <div className="home-list">
            {assignments.map((a) => {
              const sub = submissions[a.id];
              return (
                <div key={a.id} className="home-list-item">
                  <button
                    className="home-list-main"
                    onClick={() => navigate({ kind: 'assignment', id: a.id })}
                  >
                    <span className="home-list-title">{a.title}</span>
                    <span className="home-list-meta">
                      {a.questionCount} question{a.questionCount === 1 ? '' : 's'}
                    </span>
                    {a.dueDate && (() => {
                      const status = dueStatus(a.dueDate, Date.now());
                      return (
                        <span className={`home-due home-due--${status}`}>
                          Due {formatDueDate(a.dueDate)}
                          {status === 'overdue' && ' · Overdue'}
                        </span>
                      );
                    })()}
                  </button>
                  {sub ? (
                    <span
                      className="home-tile-status home-tile-status--done"
                      title={`Attempt ${sub.attempt}`}
                    >
                      ✓ Submitted {formatSubmittedAt(sub.submittedAt)}
                      {a.dueDate && lateBy(a.dueDate, sub.submittedAt) > 0 && (
                        <span className="home-late">
                          {' '}· late by {formatDuration(lateBy(a.dueDate, sub.submittedAt))}
                        </span>
                      )}
                      {a.gradesReleased && sub.result && (() => {
                        const s = summarizeResult(sub.result);
                        return s.questionsTotal > 0
                          ? ` · Grade: ${s.questionsPassed}/${s.questionsTotal} questions`
                          : '';
                      })()}
                    </span>
                  ) : (
                    <span className="home-tile-status">Not submitted</span>
                  )}
                  <button
                    className="home-tile-submit"
                    onClick={() => void handleSubmit(a.id, a.title)}
                  >
                    Submit
                  </button>
                </div>
              );
            })}
            {assignments.length === 0 && !error && (
              <p className="home-empty">{loading ? 'Loading…' : 'No assignments available.'}</p>
            )}
            {error && !loading && (
              <p className="home-empty">
                Couldn’t load assignments — the server may be unreachable.{' '}
                <button className="menu-link-button" onClick={reload}>Retry</button>
              </p>
            )}
          </div>
        </section>

        <section className="home-section">
          <h2 className="home-section-title">Explore</h2>
          <div className="home-grid">
            <button className="home-tile" onClick={() => navigate({ kind: 'sandbox' })}>
              <span className="home-tile-title">Sandbox</span>
              <span className="home-tile-meta">A freeform workbook to experiment — saved automatically</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
