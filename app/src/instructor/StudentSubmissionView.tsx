import { useState } from 'react';
import type { AssignmentData, HumanGrade, Points, SubmissionRecord } from '../types';
import { getAssignment } from '../assignments';
import { gradingStore, submissionStore } from '../storage/backend';
import type { AttemptDetail, GradeWriteOutcome } from '../storage/gradingStore';
import type { Route } from '../routing';
import { hashLink } from '../components/PageShell';
import { formatDateTime, formatDuration, lateBy } from '../dueDates';
import { useAsyncValue } from '../useAsyncValue';
import { pointsLabel, type ProblemScore } from '../engine/score';
import { GradeValue } from './GradingParts';

/**
 * One student's submission on an assignment — the matrix row's page (task
 * 065, interim: task 067 builds the memo's §6.3 page here). The gradebook's
 * old per-student detail, moved: the counting attempt in full (per-case
 * failed inputs, open answers, integrity, group) with the 0 / ½ / 1 grade
 * controls, and the earlier attempts read-only on demand. Everything is read
 * through the GradingStore (the summary's row, then `attempt()` for one
 * attempt in full, scored by the shared builder) — no grade is computed here,
 * and a record with no autograde says so rather than grading on the fly.
 */
export function StudentSubmissionView({ route }: { route: Extract<Route, { kind: 'instructor-grading-student' }> }) {
  const { id, student } = route;
  const { value, loading, reload } = useAsyncValue(
    async () => {
      const [summary, assignment] = await Promise.all([gradingStore.summary(id), getAssignment(id)]);
      const row = summary?.rows.find((r) => r.student.key === student) ?? null;
      const detail = row?.latest ? await gradingStore.attempt(id, student, row.latest.attempt) : null;
      return { summary, assignment, row, detail };
    },
    [id, student],
  );
  const matrix = { kind: 'instructor-grading-assignment', id, view: 'matrix' } as const;

  if (!value) return <p className="mm-empty">{loading ? 'Loading…' : 'Couldn’t load this submission — the server may be unreachable.'}</p>;
  const { summary, assignment, row, detail } = value;
  const back = (
    <a className="eyebrow" {...hashLink(summary ? matrix : { kind: 'instructor-grading' })}>
      ← {summary ? `${summary.title} · Matrix` : 'Grading'}
    </a>
  );
  if (!summary || !assignment || !row) {
    return (
      <div className="mm-head">
        {back}
        <p className="mm-empty">{!summary || !assignment ? 'No such assignment.' : 'No such student on this assignment.'}</p>
      </div>
    );
  }

  const { name, uid, section } = row.student;
  return (
    <div className="student-submission">
      <div className="mm-head">
        {back}
        <h1>{name}</h1>
        <p className="mm-lede">
          {[uid && `UID ${uid}`, section && `section ${section}`].filter(Boolean).join(' · ')}
          {(uid || section) && ' · '}
          <a className="mm-link" {...hashLink({ kind: 'instructor-student', student })}>
            All assignments →
          </a>
        </p>
      </div>

      {!row.latest || !detail ? (
        <p className="mm-empty">{row.grade.missing ? 'Missing — nothing submitted by the due date.' : 'Nothing submitted yet.'}</p>
      ) : (
        <>
          <p className="gr-subline">
            <span className="mm-label">Counting attempt</span> #{detail.record.attempt}, {formatDateTime(detail.record.submittedAt)}
            <LateTag assignment={assignment} submittedAt={detail.record.submittedAt} />
            {' · '}grade <b><GradeValue value={detail.score.final} provisional={detail.score.provisional} /></b> / 100
            {row.latest.stale && <span className="mm-warn"> · graded against an older version</span>}
          </p>
          <SubmissionDetail detail={detail} isLatest assignment={assignment} onReviewed={reload} />
          {detail.record.attempt > 1 && (
            <section className="mm-section">
              <h2>Earlier attempts</h2>
              <p className="mm-note">Read-only — only the latest attempt counts, and only it takes grades.</p>
              {Array.from({ length: detail.record.attempt - 1 }, (_, i) => detail.record.attempt - 1 - i).map((n) => (
                <EarlierAttempt key={n} assignment={assignment} studentKey={student} attempt={n} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}

/** "· late by …" next to a submission time, or nothing when on time / no due date. */
function LateTag({ assignment, submittedAt }: { assignment: AssignmentData; submittedAt: string }) {
  if (!assignment.dueDate) return null;
  const ms = lateBy(assignment.dueDate, submittedAt);
  if (ms === 0) return null;
  return <span className="instructor-late"> · late by {formatDuration(ms)}</span>;
}

/** An earlier attempt, fetched in full only when opened. */
function EarlierAttempt({ assignment, studentKey, attempt }: { assignment: AssignmentData; studentKey: string; attempt: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="gr-attempt">
      <button className="mm-link" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} Attempt #{attempt}
      </button>
      {open && <EarlierAttemptBody assignment={assignment} studentKey={studentKey} attempt={attempt} />}
    </div>
  );
}

function EarlierAttemptBody({ assignment, studentKey, attempt }: { assignment: AssignmentData; studentKey: string; attempt: number }) {
  const { value: detail, loading } = useAsyncValue(() => gradingStore.attempt(assignment.id, studentKey, attempt), [assignment.id, studentKey, attempt]);
  if (!detail) return <p className="mm-empty">{loading ? 'Loading…' : 'Couldn’t load this attempt.'}</p>;
  return (
    <>
      <p className="gr-subline">
        {formatDateTime(detail.record.submittedAt)}
        <LateTag assignment={assignment} submittedAt={detail.record.submittedAt} />
        {' · '}would grade <GradeValue value={detail.score.final} provisional={detail.score.provisional} />
      </p>
      <SubmissionDetail detail={detail} isLatest={false} assignment={assignment} onReviewed={() => {}} />
    </>
  );
}

/** The classmates a submission lists as its group (task 062), by name — the
 *  instructor's class list maps the opaque keys back. A key no longer on the
 *  roster shows as such rather than vanishing. Reciprocity is judged by the
 *  grading build's flags (task 2026-09-26-070), not here. */
function GroupLine({ keys }: { keys: string[] }) {
  const { value: classmates } = useAsyncValue(() => submissionStore.listClassmates(), []);
  const names = keys.map((k) => classmates?.find((c) => c.key === k)?.name ?? (classmates ? 'someone no longer on the roster' : '…'));
  return (
    <p className="instructor-group">
      <span className="mm-label">Group</span> {names.join(', ')}
    </p>
  );
}

/** Where one problem's points came from, in words (the builder's score). */
function problemState(p: ProblemScore | undefined): string {
  if (!p) return 'not in the assignment any more';
  const auto = p.autoPoints !== null ? ` (autograde ${pointsLabel(p.autoPoints)})` : '';
  switch (p.source) {
    case 'human':
      return `graded ${pointsLabel(p.points!)} by hand${auto}`;
    case 'changed':
      return `changed since graded (was ${p.suggestion ? pointsLabel(p.suggestion.points) : '—'})`;
    case 'pending':
      return 'needs a grade';
    case 'auto-half':
      return `${pointsLabel(p.points!)} — the ½ rule`;
    default:
      return `${pointsLabel(p.points!)} point${p.points === 1 ? '' : 's'}`;
  }
}

function SubmissionDetail({
  detail,
  isLatest,
  assignment,
  onReviewed,
}: {
  detail: AttemptDetail;
  /** Only the counting (latest) attempt takes grades — they judge its answers. */
  isLatest: boolean;
  assignment: AssignmentData;
  onReviewed: () => void;
}) {
  const { record, score } = detail;
  const result = record.result;
  if (!result) {
    return (
      <div className="instructor-detail">
        {record.submission.group?.length ? <GroupLine keys={record.submission.group} /> : null}
        <p className="mm-note">Not autograded — this attempt predates grading on receipt.</p>
      </div>
    );
  }

  return (
    <div className="instructor-detail">
      {record.submission.group?.length ? <GroupLine keys={record.submission.group} /> : null}
      {result.questions.map((qr) => {
        const q = assignment.questions.find((x) => x.id === qr.questionId);
        const label = q?.label ?? `Q${qr.questionId}`;
        const problem = score.problems.find((x) => x.questionId === qr.questionId);
        // Grades judge the counting attempt's answer, so only the latest takes
        // them; a record with no studentKey (a legacy anonymous dev record)
        // stays display-only. The controls sit on what a person must grade
        // (nothing to autograde) and on any grade already given; overriding
        // an autograde from scratch is task 067's page (a note required —
        // the one planner, storage/gradeWrites.ts).
        const existing = record.grades?.find((g) => g.questionId === qr.questionId);
        const controls = isLatest && record.studentKey !== undefined && problem && (problem.autoPoints === null || existing) && (
          <GradeControls
            record={record}
            questionId={qr.questionId}
            existing={existing}
            override={problem.autoPoints !== null}
            onReviewed={onReviewed}
          />
        );
        const head = (what: string) => (
          <>
            <strong>{label}</strong>: {what} — <span className="gr-state">{problemState(problem)}</span>
          </>
        );
        // Open question: nothing was autograded — show the student's response
        // for manual review. (Older results may predate the `response` field on
        // QuestionResult; fall back to the submission's answer.)
        if (qr.status === 'pending') {
          const response =
            qr.response ?? record.submission.answers.find((a) => a.questionId === qr.questionId)?.responseText;
          return (
            <div className="instructor-detail-q" key={qr.questionId}>
              {head('open question')}
              {response?.trim() ? (
                <blockquote className="instructor-open-response">{response}</blockquote>
              ) : (
                <p className="instructor-open-response instructor-open-response--empty">(no answer submitted)</p>
              )}
              {controls}
            </div>
          );
        }
        if (qr.status === 'skipped') {
          return (
            <div className="instructor-detail-q" key={qr.questionId}>
              {head(`skipped — ${qr.reason}`)}
              {controls}
            </div>
          );
        }
        // Turbot questions grade against arenas, not value cases — their
        // failures report steps taken + final pose instead of expected/got.
        if (qr.turbotCases) {
          const failedRuns = qr.turbotCases.map((c, i) => ({ ...c, arenaIndex: i + 1 })).filter((c) => !c.pass);
          return (
            <div className="instructor-detail-q" key={qr.questionId}>
              {head(`${qr.passed}/${qr.total} arenas passed`)}
              {failedRuns.length > 0 && (
                <table className="instructor-detail-table">
                  <thead>
                    <tr>
                      <th>arena</th>
                      <th>steps</th>
                      <th>final position</th>
                      <th>why it failed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {failedRuns.map((c, ci) => (
                      <tr key={ci}>
                        <td className="instructor-bits">#{c.arenaIndex}</td>
                        <td className="instructor-bits">{c.stepsTaken}</td>
                        <td className="instructor-bits">
                          ({c.finalPosition.x}, {c.finalPosition.y}) {c.finalPosition.facing}
                        </td>
                        <td className="instructor-bits instructor-fail">{c.reason ?? 'criterion not met'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {controls}
            </div>
          );
        }
        // Fill-in questions grade one typed string per blank.
        if (qr.fillCases) {
          const wrong = qr.fillCases.filter((c) => !c.pass);
          return (
            <div className="instructor-detail-q" key={qr.questionId}>
              {head(`${qr.passed}/${qr.total} blanks correct`)}
              {wrong.length > 0 && (
                <table className="instructor-detail-table">
                  <thead>
                    <tr>
                      <th>blank</th>
                      <th>expected</th>
                      <th>got</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wrong.map((c, ci) => (
                      <tr key={ci}>
                        <td>{c.label}</td>
                        <td className="instructor-bits">{c.expected}</td>
                        <td className="instructor-bits instructor-fail">{c.got === '' ? '(blank)' : c.got}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {controls}
            </div>
          );
        }
        // Perception questions grade raw frames bit-level — their failures
        // report the stimulus and the first mismatching time step.
        if (qr.perceptionCases) {
          const failedCases = qr.perceptionCases.filter((c) => !c.pass);
          return (
            <div className="instructor-detail-q" key={qr.questionId}>
              {head(`${qr.passed}/${qr.total} cases passed`)}
              {failedCases.length > 0 && (
                <table className="instructor-detail-table">
                  <thead>
                    <tr>
                      <th>input frames (t1 → tn)</th>
                      <th>expected</th>
                      <th>got</th>
                      <th>first wrong step</th>
                    </tr>
                  </thead>
                  <tbody>
                    {failedCases.map((c, ci) => (
                      <tr key={ci}>
                        <td className="instructor-bits">{c.frames.map((f) => f.join('')).join(' → ')}</td>
                        <td className="instructor-bits">{c.expected.join('')}</td>
                        <td className="instructor-bits instructor-fail">{c.reason ?? c.got.join('')}</td>
                        <td className="instructor-bits">{c.failStep ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {controls}
            </div>
          );
        }
        const failed = qr.cases.filter((c) => !c.pass);
        return (
          <div className="instructor-detail-q" key={qr.questionId}>
            {head(`${qr.passed}/${qr.total} passed`)}
            {failed.length > 0 && (
              <table className="instructor-detail-table">
                <thead>
                  <tr>
                    <th>input</th>
                    <th>expected</th>
                    <th>got</th>
                  </tr>
                </thead>
                <tbody>
                  {failed.map((c, ci) => (
                    <tr key={ci}>
                      <td className="instructor-bits">{c.input.join(', ')}</td>
                      <td className="instructor-bits">{c.expected.join(', ')}</td>
                      <td className="instructor-bits instructor-fail">{c.reason ?? c.got.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {controls}
          </div>
        );
      })}
      <IntegrityNotes record={record} assignment={assignment} />
    </div>
  );
}

/** The provenance check's flags for one attempt (task 034): what to look at
 *  — ids made in someone else's editor or outside this assignment, text or a
 *  circuit that arrived in one piece. Never a verdict; the score ignores it.
 *  Records from before the check carry none, and show nothing. */
function IntegrityNotes({ record, assignment }: { record: SubmissionRecord; assignment: AssignmentData }) {
  const integrity = record.integrity;
  if (!integrity) return null;
  const flagged = integrity.questions.filter((q) => q.flags.length > 0);
  return (
    <div className="instructor-detail-q instructor-review">
      <strong>Integrity — to look at, not a verdict</strong>
      {flagged.length === 0 ? (
        <p className="mm-note">Nothing to look at.</p>
      ) : (
        flagged.map((qi) => (
          <div key={qi.questionId}>
            <p className="mm-note">{assignment.questions.find((q) => q.id === qi.questionId)?.label ?? `Q${qi.questionId}`}:</p>
            <ul className="mm-note">
              {qi.flags.map((f, i) => (
                <li key={i}>{f.detail}</li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}

/** Grade one problem 0 / ½ / 1 with a note, through the GradingStore seam
 *  (task 063): stored apart from the autograde, anchored to this attempt's
 *  answer, every change logged. On an autograded problem it is an override,
 *  and its note is required. The version read travels with the write — if
 *  someone else graded meanwhile, the write is refused and the view reloads
 *  to show theirs. */
function GradeControls({
  record,
  questionId,
  existing,
  override,
  onReviewed,
}: {
  record: SubmissionRecord;
  questionId: number;
  existing: HumanGrade | undefined;
  override: boolean;
  onReviewed: () => void;
}) {
  const [note, setNote] = useState(existing?.note ?? '');
  const [message, setMessage] = useState<string | null>(null);

  const done = (o: GradeWriteOutcome) => {
    if (o.ok) setMessage(null);
    else if (o.conflict) setMessage('Someone else changed this grade meanwhile — showing theirs.');
    else setMessage(o.error);
    onReviewed();
  };
  const save = async (points: Points) =>
    done(await gradingStore.setGrade(record.assignmentId, record.studentKey!, questionId, { points, note, version: existing?.version ?? null }));
  const clear = async () =>
    done(await gradingStore.clearGrade(record.assignmentId, record.studentKey!, questionId, existing!.version ?? 0));

  return (
    <div className="instructor-review">
      {existing && (
        <p className="instructor-review-verdict">
          <span className={existing.points === 1 ? 'instructor-pass' : existing.points === 0 ? 'instructor-fail' : 'instructor-half'}>
            {pointsLabel(existing.points)} point{existing.points === 1 ? '' : 's'}
          </span>{' '}
          <span className="instructor-review-when">
            {existing.grader ? `by ${existing.grader}` : 'carried over from a ✓/✗ review'}, {formatDateTime(existing.gradedAt)}
            {existing.attempt !== undefined && existing.attempt !== record.attempt && ` (on attempt ${existing.attempt})`}
          </span>
        </p>
      )}
      <div className="instructor-review-controls">
        <input
          className="instructor-review-note"
          type="text"
          placeholder={override ? 'Why override the autograde? (required; the student sees it on release)' : 'Feedback note (optional; the student sees it on release)'}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        {([0, 0.5, 1] as const).map((p) => (
          <button key={p} className="mm-btn instructor-review-btn" onClick={() => void save(p)}>
            {pointsLabel(p)}
          </button>
        ))}
        {existing && (
          <button className="mm-btn mm-btn--quiet instructor-review-btn" onClick={() => void clear()}>
            Clear
          </button>
        )}
      </div>
      {message && <p className="mm-error">{message}</p>}
    </div>
  );
}
