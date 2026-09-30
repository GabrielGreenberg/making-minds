import { useState } from 'react';
import { gradingStore } from '../storage/backend';
import type { StudentGrading } from '../storage/gradingStore';
import type { Route } from '../routing';
import { hashLink } from '../components/PageShell';
import { formatDateTime, formatDueDate } from '../dueDates';
import { useAsyncValue } from '../useAsyncValue';
import { formatGrade } from '../engine/score';
import { MAX_STUDENT_NOTE } from '../storage/gradeWrites';
import { historyLine } from './gradingViews';
import { FlagChip, GradeValue } from './GradingParts';
import { LateAdjustControls } from './LateAdjustControls';

/**
 * The student page (task 2026-09-26-070; memo grading-interface.md §6.5,
 * mockup 6), reached from the matrix, Roster & accounts and the Grading
 * tab's flagged list: who they are and their account, their active flags
 * (prompts, never verdicts), a row per assignment — submitted, late, the
 * extension, the grade / 100, released — with **Extension…** / **Waive…**
 * (task 068), the average of the counted sets so far, the private notes log
 * (dated, append-only, instructors only) and the grade history from the log.
 * One read (GradingStore.student()); nothing here computes a grade.
 */
export function StudentGradingView({ route }: { route: Extract<Route, { kind: 'instructor-student' }> }) {
  const { value: one, loading, error, reload } = useAsyncValue(() => gradingStore.student(route.student), [route.student]);
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
          {loading ? 'Loading…' : error ? 'Couldn’t load this student. The server may be unreachable.' : 'No such student.'}
        </p>
      </div>
    );
  }
  const { student, average } = one;
  const titleOf = (id: string) => one.assignments.find((a) => a.assignmentId === id)?.title;
  return (
    <div className="student-grading">
      <div className="mm-head">
        {back}
        <h1>{student.name}</h1>
        <p className="mm-lede">
          {[student.uid && `UID ${student.uid}`, student.section && `section ${student.section}`, student.hasAccount ? 'has an account' : 'no account yet']
            .filter(Boolean)
            .join(' · ')}
          {student.offRoster && <span className="tag gr-tag-gap">not on the roster</span>}
        </p>
        {one.flags.length > 0 && (
          <div className="gr-flagchips" aria-label="Flags">
            {one.flags.map((flag, i) => (
              <FlagChip key={i} flag={flag} titleOf={titleOf} />
            ))}
          </div>
        )}
      </div>

      <div className="sg-columns">
        <div className="sg-main">
          <h2>Problem sets</h2>
          <div className="mm-tablewrap">
            <table className="mm-table gr-table">
              <thead>
                <tr>
                  <th>Assignment</th>
                  <th>Due</th>
                  <th>Submitted</th>
                  <th className="num">Grade</th>
                  <th>Grades</th>
                  <th>Late</th>
                </tr>
              </thead>
              <tbody>
                {one.assignments.map((a) => {
                  const { latest, grade } = a.row;
                  return (
                    <tr key={a.assignmentId} className={a.countsTowardGrade === false ? 'gr-dimrow' : undefined}>
                      <td>
                        <a className="mm-row-title" {...hashLink({ kind: 'instructor-grading-student', id: a.assignmentId, student: student.key })}>
                          {a.title}
                        </a>
                        {a.countsTowardGrade === false && <span className="tag gr-tag-gap">not counted</span>}
                      </td>
                      <td className="date">
                        {a.row.extendedTo ? `${formatDueDate(a.row.extendedTo)} (extended)` : a.dueDate ? formatDueDate(a.dueDate) : '—'}
                      </td>
                      <td>
                        {latest ? (
                          <>
                            {formatDateTime(latest.submittedAt)}
                            {latest.late.late && (
                              <span className="tag tag--danger gr-tag-gap">
                                late{latest.late.deduction ? ` −${latest.late.deduction}` : ''}
                              </span>
                            )}
                          </>
                        ) : grade.missing ? (
                          <span className="tag tag--danger">Missing</span>
                        ) : (
                          <span className="dim">not yet</span>
                        )}
                      </td>
                      <td className="num">{latest || grade.missing ? <GradeValue value={grade.final} provisional={grade.provisional} /> : '—'}</td>
                      <td>{a.released ? <span className="tag tag--ok">Released</span> : <span className="tag">Hidden</span>}</td>
                      <td>
                        <LateAdjustControls
                          assignmentId={a.assignmentId}
                          studentKey={student.key}
                          assignmentDue={a.dueDate}
                          extendedTo={a.row.extendedTo}
                          waiver={a.row.waived ? { points: a.row.waived } : undefined}
                          loadWaiverNote={
                            latest
                              ? async () => (await gradingStore.attempt(a.assignmentId, student.key, latest.attempt))?.waiver?.note
                              : undefined
                          }
                          canWaive={latest !== null}
                          onChanged={reload}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mm-note gr-footnote">
            {average.value === null ? (
              'Average so far: no counted set is due yet.'
            ) : (
              <>
                Average so far ({average.sets} counted {average.sets === 1 ? 'set' : 'sets'}):{' '}
                <b>
                  {formatGrade(average.value)}
                  {average.provisional && <span className="gr-prov">*</span>}
                </b>
                {average.provisional && ' (provisional, hand grading still pending)'}
              </>
            )}
          </p>

          <h2 className="sg-section">Grade history</h2>
          {one.history.length === 0 ? (
            <p className="mm-note">No grade changes, extensions or waivers yet.</p>
          ) : (
            <ul className="sg-history">
              {one.history.map((h, i) => (
                <li key={i}>
                  <span className="date">{formatDateTime(h.event.at)}</span>
                  <span className="dim">{h.event.actor}</span>
                  <span>{historyLine(h, formatDueDate)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside className="sg-aside">
          <StudentNotes one={one} onAdded={reload} />
        </aside>
      </div>
    </div>
  );
}

/** The private notes log: newest first, add-only (no edit, no delete). */
function StudentNotes({ one, onAdded }: { one: StudentGrading; onAdded: () => void }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const add = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const out = await gradingStore.addStudentNote(one.student.key, draft);
      if (out.ok) {
        setDraft('');
        onAdded();
      } else {
        setProblem(out.error);
      }
    } catch {
      setProblem('Couldn’t save the note. The server may be unreachable.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="sg-notes">
      <h2>Private notes</h2>
      <p className="mm-note">Only instructors see these notes. They can't be edited or deleted.</p>
      {one.notes.length > 0 && (
        <ul className="sg-notelist">
          {one.notes.map((n) => (
            <li key={n.id}>
              <div className="sg-note-meta">
                {formatDateTime(n.at)} · {n.authorName ?? n.author}
              </div>
              <div className="sg-note-body">{n.body}</div>
            </li>
          ))}
        </ul>
      )}
      <label className="mm-field sg-note-add">
        <span>Add a note</span>
        <textarea
          className="mm-input mm-input--area"
          rows={4}
          maxLength={MAX_STUDENT_NOTE}
          placeholder="No medical or accommodation details"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </label>
      <div className="sg-note-actions">
        {problem && <span className="mm-danger">{problem}</span>}
        <button type="button" className="mm-btn mm-btn--primary" disabled={busy || !draft.trim()} onClick={add}>
          Add note
        </button>
      </div>
    </section>
  );
}
