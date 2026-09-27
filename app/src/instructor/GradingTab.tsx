import { gradingStore } from '../storage/backend';
import { hashLink } from '../components/PageShell';
import { formatDueDate } from '../dueDates';
import { useAsyncValue } from '../useAsyncValue';
import { isCounted, plural, sortGradingRows } from './gradingViews';
import { GradeValue, Prog } from './GradingParts';

/**
 * The Grading tab (task 065; memo grading-interface.md §6.1, mockup 1): every
 * assignment's grading status in one table — submitted of the roster,
 * whether the autograde is current, hand grading done, the mean, released or
 * not. One read (GradingStore.course()), the 064 summary's progress per row;
 * nothing here computes a grade. Counting assignments first; one that does
 * not count toward the course grade (HW7) is dimmed and listed last.
 * (The Needs-attention box and the flagged list arrive with task 070.)
 */
export function GradingTab() {
  const { value: course, loading, error, reload } = useAsyncValue(() => gradingStore.course(), []);
  const rows = course ? sortGradingRows(course.assignments) : [];

  return (
    <div className="grading-tab">
      <div className="mm-head">
        <h1>Grading</h1>
        <p className="mm-lede">
          Every assignment's grading status. The latest submission counts; a grade is 40 + 60·P, less any late
          deduction.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="mm-empty">
          {loading ? (
            'Loading…'
          ) : error ? (
            <>
              Couldn’t load grading — the server may be unreachable.{' '}
              <button className="mm-link" onClick={reload}>
                Retry
              </button>
            </>
          ) : (
            'No assignments yet.'
          )}
        </p>
      ) : (
        <>
          <div className="mm-tablewrap">
            <table className="mm-table gr-table">
              <thead>
                <tr>
                  <th>Assignment</th>
                  <th>Due</th>
                  <th>Submitted</th>
                  <th>Autograde</th>
                  <th>Hand grading</th>
                  <th className="num">Mean</th>
                  <th>Grades</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const p = a.progress;
                  const counted = isCounted(a);
                  const graded = p.autograded.current + p.autograded.stale;
                  return (
                    <tr key={a.id} className={counted ? undefined : 'gr-dimrow'}>
                      <td>
                        <a className="mm-row-title" {...hashLink({ kind: 'instructor-grading-assignment', id: a.id, view: 'overview' })}>
                          {a.title}
                        </a>
                        {!a.visible && <span className="tag tag--danger gr-tag-gap">unpublished</span>}
                        {!counted && <span className="tag gr-tag-gap">not counted</span>}
                      </td>
                      <td className="date">{a.dueDate ? formatDueDate(a.dueDate) : '—'}</td>
                      <td>
                        <Prog
                          x={p.submitted}
                          of={p.roster}
                          sub={
                            <>
                              {p.late} late · {p.missing} missing
                              {p.offRosterSubmitted > 0 && ` · +${p.offRosterSubmitted} off-roster`}
                            </>
                          }
                        />
                      </td>
                      <td>
                        {p.autograded.stale > 0 ? (
                          <span className="mm-warn" title="Graded against an older version of the assignment">
                            ↻ {p.autograded.stale} stale
                          </span>
                        ) : graded > 0 ? (
                          <span className="mm-ok">✓ current</span>
                        ) : (
                          <span className="dim">—</span>
                        )}
                      </td>
                      <td>
                        {p.handGraded.y > 0 ? (
                          <Prog x={p.handGraded.x} of={p.handGraded.y} sub={`${plural(p.handGraded.y - p.handGraded.x, 'problem')} to grade`} />
                        ) : (
                          <span className="dim">—</span>
                        )}
                      </td>
                      <td className="num">
                        <GradeValue value={p.grades.mean} provisional={p.grades.provisional > 0} />
                      </td>
                      <td>{a.released ? <span className="tag tag--ok">Released</span> : <span className="tag">Hidden</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mm-note gr-footnote">
            <span className="gr-prov">*</span> provisional — hand grading still pending. Submitted, missing and the mean count
            roster students only.
          </p>
        </>
      )}
    </div>
  );
}
