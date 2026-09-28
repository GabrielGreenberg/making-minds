import { useStore } from '../store';
import { listAssignments } from '../assignments';
import type { AssignmentSummary } from '../assignments';
import { navigate } from '../routing';
import { useAuth } from '../auth';
import {
  dueStatus,
  formatDateTime,
  formatDueDate,
  formatDueDay,
  formatDuration,
  isFrozen,
  lateBy,
} from '../dueDates';
import { useAsyncValue } from '../useAsyncValue';
import { useRoute } from '../useRoute';
import { GradesView } from './GradesView';
import { StudentLayout } from './StudentLayout';
import { SubmitDialog } from './SubmitDialog';
import { RecordGrade } from './RecordGrade';
import { useEffect, useState } from 'react';

/**
 * The student Home — what App renders whenever no workbook is open. Two tabs,
 * chosen by the route: Assignments (the catalog, below) and Grades
 * (GradesView, #/grades). The tab row itself is StudentLayout's.
 */
export function HomeScreen() {
  const route = useRoute();
  if (route.kind === 'grades') return <GradesView openId={route.id} />;
  return <AssignmentsTab />;
}

/** Among the visible assignments, the one due soonest that isn't past due. */
function nextDue(assignments: AssignmentSummary[], now: number): { a: AssignmentSummary; due: number } | null {
  const upcoming = assignments.flatMap((a) =>
    a.dueDate && dueStatus(a.dueDate, now) !== 'overdue' ? [{ a, due: Date.parse(a.dueDate) }] : [],
  );
  upcoming.sort((x, y) => x.due - y.due);
  return upcoming[0] ?? null;
}

/**
 * The catalog: the website's "up next" box (the soonest due homework) over one
 * row per published assignment — title and meta, the submission status (which
 * carries the score and the way into the Grades tab once grades are released),
 * and ONE action: Submit, or the past-due lock. Opening a row leads to its
 * question list (AssignmentOverview).
 */
function AssignmentsTab() {
  const submissions = useStore((s) => s.submissions);
  const hydrateSubmissions = useStore((s) => s.hydrateSubmissions);
  const { user } = useAuth();
  // The row whose Submit dialog is open (components/SubmitDialog.tsx) — it
  // records the SAVED work, since the assignment isn't open here.
  const [submitting, setSubmitting] = useState<AssignmentSummary | null>(null);

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
  const now = Date.now();
  const next = nextDue(assignments.filter((a) => a.visible), now);
  const nextSub = next ? submissions[next.a.id] : undefined;

  return (
    <StudentLayout current="assignments">
      <div className="mm-head">
        <h1>Assignments</h1>
        <p className="mm-lede">
          Open a homework to work on it — each question has its own canvas, and your work
          saves as you go. Submit when you're done; grades appear under Grades once they're released.
        </p>
      </div>

      {next && (
        <div className="mm-next" aria-label="Up next">
          <div className="mm-nx">
            <span className="chip">Next due</span>
            <div className="mm-nx-body">
              <button className="mm-nx-main" onClick={() => navigate({ kind: 'assignment', id: next.a.id })}>
                <span className="mm-nx-date">{next.a.dueDate ? formatDueDay(next.a.dueDate) : ''}</span>
                {next.a.title}
              </button>
              <div className="mm-nx-detail">
                in {formatDuration(next.due - now)}
                {nextSub
                  ? ` · submitted ${formatDateTime(nextSub.submittedAt)} — you can submit again until then`
                  : ' · not submitted yet'}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mm-list">
        {assignments.map((a) => {
          const sub = submissions[a.id];
          const frozen = isFrozen(a.dueDate, now, sub != null);
          const late = a.dueDate && sub ? lateBy(a.dueDate, sub.submittedAt) : 0;
          const status = a.dueDate ? dueStatus(a.dueDate, now) : null;
          const released = a.gradesReleased && sub?.result != null;
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
                      {a.dueExtended && ' (extended)'}
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
                      ✓ Submitted {formatDateTime(sub.submittedAt)}
                      {late > 0 && (
                        <span className="home-late"> · late by {formatDuration(late)}</span>
                      )}
                    </span>
                    {released && sub && (
                      <button
                        className="mm-link"
                        onClick={() => navigate({ kind: 'grades', id: a.id })}
                        title="See your result for each question"
                      >
                        <RecordGrade assignmentId={a.id} record={sub} /> · View grades
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
                <button className="mm-btn" onClick={() => setSubmitting(a)}>
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
      {submitting && (
        <SubmitDialog
          assignment={submitting}
          saved
          onClose={() => setSubmitting(null)}
        />
      )}
    </StudentLayout>
  );
}
