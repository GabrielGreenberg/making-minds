import { Fragment, useEffect } from 'react';
import { useStore } from '../store';
import { listAssignments } from '../assignments';
import { navigate } from '../routing';
import { useAuth } from '../auth';
import { summarizeResult } from '../engine/grader';
import { formatDateTime } from '../dueDates';
import { useAsyncValue } from '../useAsyncValue';
import { GradeSheet } from './GradeSheet';
import { StudentLayout } from './StudentLayout';

/**
 * The Grades tab of the student Home: one row per published assignment with
 * when it was submitted and the result once the instructor has released
 * grades ("N of M correct"; "Not released yet"; "Not submitted"). A released
 * row opens into its question-by-question sheet; the open row is the route's
 * id (#/grades/:id), so a grade sheet is linkable and Back closes it.
 */
export function GradesView({ openId }: { openId?: string }) {
  const submissions = useStore((s) => s.submissions);
  const hydrateSubmissions = useStore((s) => s.hydrateSubmissions);
  const { user } = useAuth();

  // Re-fetch on every visit so a grade released after the last reload shows up.
  useEffect(() => {
    void hydrateSubmissions();
  }, [hydrateSubmissions]);

  const { value: assignmentList, loading, error, reload } = useAsyncValue(
    () => listAssignments(),
    [],
  );
  // Same visibility rule as the catalog: students never see hidden drafts.
  const assignments = (assignmentList ?? []).filter(
    (a) => a.visible || user?.role === 'instructor',
  );

  const toggle = (id: string) =>
    navigate({ kind: 'grades', ...(openId === id ? {} : { id }) }, { replace: true });

  return (
    <StudentLayout current="grades">
      <div className="mm-head">
        <h1>Grades</h1>
        <p className="mm-lede">
          Your result for each homework, once your instructor releases it. Open a row for
          the question-by-question sheet.
        </p>
      </div>

      {assignments.length === 0 ? (
        <p className="mm-empty">
          {loading ? 'Loading…' : error ? (
            <>
              Couldn't load your grades — the server may be unreachable.{' '}
              <button className="mm-link" onClick={reload}>Retry</button>
            </>
          ) : 'No assignments yet.'}
        </p>
      ) : (
        <table className="mm-table grades-list">
          <thead>
            <tr>
              <th>Assignment</th>
              <th>Submitted</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {assignments.map((a) => {
              const sub = submissions[a.id];
              const released = a.gradesReleased && sub?.result != null;
              const summary = released && sub?.result ? summarizeResult(sub.result) : null;
              const open = released && openId === a.id;
              return (
                <Fragment key={a.id}>
                  <tr className={released ? `grades-row grades-row--openable${open ? ' grades-row--open' : ''}` : 'grades-row'}>
                    <td>
                      {released ? (
                        <button className="grades-toggle" onClick={() => toggle(a.id)} aria-expanded={open}>
                          <span className="grades-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
                          {a.title}
                        </button>
                      ) : (
                        <span className="grades-title">{a.title}</span>
                      )}
                    </td>
                    <td className="date">
                      {sub ? `${formatDateTime(sub.submittedAt)} · attempt ${sub.attempt}` : '—'}
                    </td>
                    <td>
                      {!sub ? (
                        <span className="dim">Not submitted</span>
                      ) : summary ? (
                        <span className="mm-ok grades-score">
                          {summary.questionsPassed} of {summary.questionsTotal} correct
                        </span>
                      ) : (
                        <span className="dim">Not released yet</span>
                      )}
                    </td>
                  </tr>
                  {open && sub && (
                    <tr className="grades-detail">
                      <td colSpan={3}>
                        <GradeSheet assignmentId={a.id} record={sub} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </StudentLayout>
  );
}
