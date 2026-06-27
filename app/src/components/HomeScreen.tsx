import { useStore } from '../store';
import { listAssignments } from '../assignments';
import { navigate } from '../routing';
import { getCurrentUserEmail } from '../auth';

function formatSubmittedAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function HomeScreen() {
  const submissions = useStore((s) => s.submissions);
  const submitAssignment = useStore((s) => s.submitAssignment);

  const assignments = listAssignments();

  const handleSubmit = (id: string, title: string) => {
    const ok = confirm(`Submit "${title}"? This records a snapshot of your saved work.`);
    if (!ok) return;
    const rec = submitAssignment(id, getCurrentUserEmail());
    if (rec) alert(`Submitted "${title}" — attempt ${rec.attempt}.`);
  };

  return (
    <div className="welcome-screen">
      <div className="home-card">
        <h1 className="welcome-title">Making Minds</h1>
        <p className="welcome-subtitle">Design circuits, state machines, and more</p>

        <section className="home-section">
          <h2 className="home-section-title">Assignments</h2>
          <div className="home-grid">
            {assignments.map((a) => {
              const sub = submissions[a.id];
              return (
                <div key={a.id} className="home-tile">
                  <button
                    className="home-tile-main"
                    onClick={() => navigate({ kind: 'assignment', id: a.id })}
                  >
                    <span className="home-tile-title">{a.title}</span>
                    <span className="home-tile-meta">
                      {a.questionCount} question{a.questionCount === 1 ? '' : 's'}
                    </span>
                  </button>
                  <div className="home-tile-footer">
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
