import { useStore } from '../store';
import { listAssignments } from '../assignments';
import { navigate } from '../routing';
import { getCurrentUserEmail, useAuth } from '../auth';
import { summarizeResult } from '../engine/grader';
import { dueStatus, formatDueDate, formatDuration, isFrozen, lateBy } from '../dueDates';
import { useAsyncValue } from '../useAsyncValue';
import { GradesPanel } from './GradesPanel';
import { PageShell, appNav } from './PageShell';
import { SessionControls } from './SessionControls';
import { useState, useEffect } from 'react';

function formatSubmittedAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * The student home: the assignment catalog. One row per published homework —
 * title and meta, the submission status (which is also the way into the grade
 * sheet once grades are released), and ONE action: Submit, or the past-due
 * lock. Opening a row leads to its question list (AssignmentOverview).
 */
export function HomeScreen() {
  const submissions = useStore((s) => s.submissions);
  const submitAssignment = useStore((s) => s.submitAssignment);
  const hydrateSubmissions = useStore((s) => s.hydrateSubmissions);
  const { user } = useAuth();
  // Which assignment's grade sheet is open, if any.
  const [gradesFor, setGradesFor] = useState<string | null>(null);

  // Re-fetch on every visit to this screen (not just once at app boot) so a
  // grade or feedback note the instructor recorded after the student's last
  // reload shows up without the student having to hard-refresh the tab.
  useEffect(() => {
    void hydrateSubmissions();
  }, [hydrateSubmissions]);

  const { value: assignmentList, loading, error, reload } = useAsyncValue(
    () => listAssignments(),
    [],
  );
  // Hidden assignments are the instructor's drafts. Remotely the server never
  // sends them to a student at all; this filter is what makes local mode
  // agree, and it keeps an instructor's own catalog view honest by marking
  // them rather than hiding them.
  const assignments = (assignmentList ?? []).filter(
    (a) => a.visible || user?.role === 'instructor',
  );

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
    <PageShell nav={appNav('student', user?.role === 'instructor' ? 'instructor' : 'student')} session={<SessionControls />}>
      <div className="mm-head">
        <h1>Assignments</h1>
        <p className="mm-lede">
          Open a homework to work on it — each question has its own canvas, and your work
          saves as you go. Submit when you're done; grades appear here once they're released.
        </p>
      </div>

      <div className="mm-list">
        {assignments.map((a) => {
          const sub = submissions[a.id];
          const frozen = isFrozen(a.dueDate, Date.now(), sub != null);
          const late = a.dueDate && sub ? lateBy(a.dueDate, sub.submittedAt) : 0;
          const status = a.dueDate ? dueStatus(a.dueDate, Date.now()) : null;
          const summary = a.gradesReleased && sub?.result ? summarizeResult(sub.result) : null;
          return (
            <div key={a.id} className="home-row">
              <button
                className="home-row-main"
                onClick={() => navigate({ kind: 'assignment', id: a.id })}
              >
                <span className="home-row-title">{a.title}</span>
                <span className="home-row-meta">
                  <span>{a.questionCount} question{a.questionCount === 1 ? '' : 's'}</span>
                  {a.dueDate && status && (
                    <span className={`home-due home-due--${status}`}>
                      Due {formatDueDate(a.dueDate)}
                      {status === 'overdue' && ' · overdue'}
                    </span>
                  )}
                  {!a.visible && <span className="tag">hidden from students</span>}
                </span>
              </button>
              <span className="home-status">
                {sub ? (
                  <>
                    <span className="home-status--done" title={`Attempt ${sub.attempt}`}>
                      ✓ Submitted {formatSubmittedAt(sub.submittedAt)}
                      {late > 0 && (
                        <span className="home-late"> · late by {formatDuration(late)}</span>
                      )}
                    </span>
                    {summary && (
                      <button
                        className="mm-link"
                        onClick={() => setGradesFor(a.id)}
                        title="See your result for each question"
                      >
                        {summary.questionsTotal > 0
                          ? `${summary.questionsPassed} of ${summary.questionsTotal} correct · `
                          : ''}
                        View grades
                      </button>
                    )}
                  </>
                ) : (
                  <span>Not submitted</span>
                )}
              </span>
              {frozen ? (
                <span
                  className="home-locked"
                  title="This assignment closed after its due date — open it to see your submission, read-only."
                >
                  🔒 Past due
                </span>
              ) : (
                <button className="mm-btn" onClick={() => void handleSubmit(a.id, a.title)}>
                  Submit
                </button>
              )}
            </div>
          );
        })}
        {assignments.length === 0 && !error && (
          <p className="mm-empty">{loading ? 'Loading…' : 'No assignments available yet.'}</p>
        )}
        {error && !loading && (
          <p className="mm-empty">
            Couldn't load assignments — the server may be unreachable.{' '}
            <button className="mm-link" onClick={reload}>Retry</button>
          </p>
        )}
      </div>


      {gradesFor && submissions[gradesFor] && (
        <GradesPanel
          assignmentId={gradesFor}
          record={submissions[gradesFor]}
          onClose={() => setGradesFor(null)}
        />
      )}
    </PageShell>
  );
}
