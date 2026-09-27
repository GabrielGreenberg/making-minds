import { gradingStore } from '../storage/backend';
import type { Route } from '../routing';
import { hashLink } from '../components/PageShell';
import { formatDateTime, formatDueDate } from '../dueDates';
import { useAsyncValue } from '../useAsyncValue';
import { GradeValue } from './GradingParts';

/**
 * One student across assignments (task 065, interim — task 070 builds the
 * memo's §6.5 student page here): their identity and a row per assignment
 * from GradingStore.student(), the same row each assignment's summary holds
 * for them. Each row opens that assignment's submission.
 */
export function StudentGradingView({ route }: { route: Extract<Route, { kind: 'instructor-student' }> }) {
  const { value: one, loading, error } = useAsyncValue(() => gradingStore.student(route.student), [route.student]);
  const back = (
    <a className="eyebrow" {...hashLink({ kind: 'instructor-grading' })}>
      ← Grading
    </a>
  );

  if (!one) {
    return (
      <div className="mm-head">
        {back}
        <p className="mm-empty">
          {loading ? 'Loading…' : error ? 'Couldn’t load this student — the server may be unreachable.' : 'No such student.'}
        </p>
      </div>
    );
  }
  const { student } = one;
  return (
    <div className="student-grading">
      <div className="mm-head">
        {back}
        <h1>{student.name}</h1>
        <p className="mm-lede">
          {[student.uid && `UID ${student.uid}`, student.section && `section ${student.section}`, !student.hasAccount && 'no account yet']
            .filter(Boolean)
            .join(' · ')}
          {student.offRoster && <span className="tag gr-tag-gap">not on the roster</span>}
        </p>
      </div>
      <div className="mm-tablewrap">
        <table className="mm-table gr-table">
          <thead>
            <tr>
              <th>Assignment</th>
              <th>Due</th>
              <th>Submitted</th>
              <th className="num">Grade</th>
              <th>Grades</th>
            </tr>
          </thead>
          <tbody>
            {one.assignments.map((a) => {
              const { latest, grade } = a.row;
              return (
                <tr key={a.assignmentId}>
                  <td>
                    <a className="mm-row-title" {...hashLink({ kind: 'instructor-grading-student', id: a.assignmentId, student: student.key })}>
                      {a.title}
                    </a>
                  </td>
                  <td className="date">{a.dueDate ? formatDueDate(a.dueDate) : '—'}</td>
                  <td>
                    {latest ? (
                      <>
                        {formatDateTime(latest.submittedAt)}
                        {latest.late.late && <span className="tag tag--danger gr-tag-gap">late</span>}
                      </>
                    ) : grade.missing ? (
                      <span className="tag tag--danger">Missing</span>
                    ) : (
                      <span className="dim">not yet</span>
                    )}
                  </td>
                  <td className="num">{latest || grade.missing ? <GradeValue value={grade.final} provisional={grade.provisional} /> : '—'}</td>
                  <td>{a.released ? <span className="tag tag--ok">Released</span> : <span className="tag">Hidden</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
