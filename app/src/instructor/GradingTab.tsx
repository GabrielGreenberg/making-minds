import { useState } from 'react';
import { gradingStore } from '../storage/backend';
import type { CourseGrading, FlagThresholds } from '../storage/gradingStore';
import { FLAG_THRESHOLD_RANGE } from '../storage/gradingFlags';
import { hashLink } from '../components/PageShell';
import { formatDueDate } from '../dueDates';
import { useAsyncValue } from '../useAsyncValue';
import { flagKindCounts, flagLabel, isCounted, plural, sortGradingRows } from './gradingViews';
import { ExportCsvButton, FlagChip, GradeValue, Prog } from './GradingParts';

/**
 * The Grading tab (task 065; memo grading-interface.md §6.1, mockup 1): every
 * assignment's grading status in one table — submitted of the roster,
 * whether the autograde is current, hand grading done, the mean, released or
 * not. One read (GradingStore.course()), the 064 summary's progress per row;
 * nothing here computes a grade. Counting assignments first; one that does
 * not count toward the course grade (HW7) is dimmed and listed last.
 * Above it the Needs-attention box, below it the flagged students (task
 * 070; memo §8 — prompts to look, never verdicts, over published
 * assignments), a Settings panel for the flags' thresholds, and Export CSV
 * (task 071: the counted published sets and the average).
 */
export function GradingTab() {
  const { value: course, loading, error, reload } = useAsyncValue(() => gradingStore.course(), []);
  const [settings, setSettings] = useState(false);
  const rows = course ? sortGradingRows(course.assignments) : [];

  return (
    <div className="grading-tab">
      <div className="mm-head mm-head--row">
        <div>
          <h1>Grading</h1>
          <p className="mm-lede">
            The latest submission counts. A grade is 40 + 60·P, less any late
            deduction.
          </p>
        </div>
        {course && (
          <div className="mm-actions">
            <ExportCsvButton />
            <button type="button" className="mm-btn mm-btn--quiet" aria-expanded={settings} onClick={() => setSettings(!settings)}>
              Settings
            </button>
          </div>
        )}
      </div>

      {course && settings && (
        <FlagSettings
          thresholds={course.thresholds}
          onSaved={() => {
            setSettings(false);
            reload();
          }}
        />
      )}
      {course && <NeedsAttention course={course} />}

      {rows.length === 0 ? (
        <p className="mm-empty">
          {loading ? (
            'Loading…'
          ) : error ? (
            <>
              Couldn’t load grading. The server may be unreachable.{' '}
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
            <span className="gr-prov">*</span> provisional (hand grading still pending). Submitted, missing and the mean count
            roster students only.
          </p>
        </>
      )}
      {course && course.flagged.length > 0 && <FlaggedList course={course} />}
    </div>
  );
}

const titleIn = (course: CourseGrading) => (id: string) => course.assignments.find((a) => a.id === id)?.title;

/** The Needs-attention box: how many roster students are flagged, per kind. */
function NeedsAttention({ course }: { course: CourseGrading }) {
  const { total, kinds } = flagKindCounts(course.flagged);
  return (
    <div className="gr-attention" role="status">
      <b className="gr-attention-title">Needs attention</b>
      {total === 0 ? (
        <span className="dim">Nobody is flagged.</span>
      ) : (
        <>
          {kinds.map((k) => (
            <span key={k.kind}>
              <b>{k.count}</b> {flagLabel(k.kind).toLowerCase()}
            </span>
          ))}
          <button
            type="button"
            className="mm-link gr-attention-all"
            onClick={() => document.getElementById('gr-flagged')?.scrollIntoView({ behavior: 'smooth' })}
          >
            See all {plural(total, 'student')} →
          </button>
        </>
      )}
    </div>
  );
}

/** Every flagged roster student: their name (→ the student page) and flags. */
function FlaggedList({ course }: { course: CourseGrading }) {
  const titleOf = titleIn(course);
  const names = new Map(course.flagged.map((f) => [f.student.key, f.student.name]));
  return (
    <section className="gr-flagged" id="gr-flagged">
      <h2>Flagged students</h2>
      <div className="mm-tablewrap">
        <table className="mm-table gr-table">
          <thead>
            <tr>
              <th>Student</th>
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>
            {course.flagged.map((f) => (
              <tr key={f.student.key}>
                <td>
                  <a className="mm-row-title" {...hashLink({ kind: 'instructor-student', student: f.student.key })}>
                    {f.student.sortName}
                  </a>
                </td>
                <td>
                  <div className="gr-flagchips">
                    {f.flags.map((flag, i) => (
                      <FlagChip key={i} flag={flag} titleOf={titleOf} nameOf={(k) => names.get(k)} />
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mm-note gr-footnote">
        Flags are prompts to look, not verdicts. They cover published assignments. Hover a flag for its detail. The
        thresholds are in Settings.
      </p>
    </section>
  );
}

/** The flags' thresholds, each a whole number (the store normalizes). */
const THRESHOLD_FIELDS: { key: keyof FlagThresholds; label: string; unit: string }[] = [
  { key: 'veryLateDays', label: 'Very late after', unit: 'days' },
  { key: 'struggleBelow', label: 'Struggling below', unit: 'points' },
  { key: 'struggleRun', label: '…on consecutive counted sets', unit: 'sets' },
  { key: 'noAccountDays', label: 'No account after the first meeting', unit: 'days' },
  { key: 'maxGroupSize', label: 'Largest group', unit: 'people' },
  { key: 'identicalTextMinChars', label: 'Compare open answers from', unit: 'characters' },
];

function FlagSettings({ thresholds, onSaved }: { thresholds: FlagThresholds; onSaved: () => void }) {
  const [draft, setDraft] = useState<FlagThresholds>(thresholds);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await gradingStore.setFlagThresholds(draft);
      onSaved();
    } catch {
      setProblem('Couldn’t save. The server may be unreachable.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="gr-settings">
      <h2>Flag thresholds</h2>
      <div className="gr-settings-grid">
        {THRESHOLD_FIELDS.map((f) => (
          <label key={f.key} className="mm-field">
            <span>{f.label}</span>
            <span className="gr-settings-input">
              <input
                className="mm-input mm-input--num"
                type="number"
                min={FLAG_THRESHOLD_RANGE[f.key].min}
                max={FLAG_THRESHOLD_RANGE[f.key].max}
                step={1}
                value={draft[f.key]}
                onChange={(e) => setDraft({ ...draft, [f.key]: Number(e.target.value) })}
              />
              <span className="dim">{f.unit}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="gr-settings-actions">
        <button type="button" className="mm-btn mm-btn--primary" disabled={busy} onClick={save}>
          Save
        </button>
        {problem && <span className="mm-danger">{problem}</span>}
      </div>
    </div>
  );
}
