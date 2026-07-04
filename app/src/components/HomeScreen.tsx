import { useStore } from '../store';
import { listAssignments } from '../assignments';
import { navigate } from '../routing';
import { getCurrentUserEmail, useAuth } from '../auth';
import { summarizeResult } from '../engine/grader';

function formatSubmittedAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function HomeScreen() {
  const submissions = useStore((s) => s.submissions);
  const submitAssignment = useStore((s) => s.submitAssignment);
  const { user, logout } = useAuth();

  const assignments = listAssignments();

  const handleSubmit = (id: string, title: string) => {
    const ok = confirm(
      `Submit "${title}"? This records a snapshot of your saved work.\n\n` +
      'Note: only your most recent submission is graded — submitting again replaces any earlier submission for grading purposes.'
    );
    if (!ok) return;
    const rec = submitAssignment(id, getCurrentUserEmail());
    if (!rec) return;
    // The submission is autograded on receipt — report the result to the student.
    if (rec.result) {
      const s = summarizeResult(rec.result);
      const detail = s.questionsTotal > 0
        ? `Autograded: ${s.questionsPassed}/${s.questionsTotal} questions passed (${s.vectorsPassed}/${s.vectorsTotal} test cases).`
        : 'No autogradable questions in this assignment yet.';
      alert(`Submitted "${title}" (attempt ${rec.attempt}).\n${detail}`);
    }
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
                  </button>
                  {sub ? (
                    <span
                      className="home-tile-status home-tile-status--done"
                      title={`Attempt ${sub.attempt}`}
                    >
                      ✓ Submitted {formatSubmittedAt(sub.submittedAt)}
                    </span>
                  ) : (
                    <span className="home-tile-status">Not submitted</span>
                  )}
                  <button
                    className="home-tile-submit"
                    onClick={() => handleSubmit(a.id, a.title)}
                  >
                    Submit
                  </button>
                </div>
              );
            })}
            {assignments.length === 0 && (
              <p className="home-empty">No assignments available.</p>
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
