import { useState, type ReactNode } from 'react';
import type { AssignmentData, AssignmentQuestion, HumanGrade, Points, QuestionResult, SubmissionRecord } from '../types';
import { questionTask } from '../types';
import { getAssignment } from '../assignments';
import { gradingStore, submissionStore } from '../storage/backend';
import type { AttemptDetail, GradeWriteOutcome, GradingRow } from '../storage/gradingStore';
import type { Route } from '../routing';
import { hashLink } from '../components/PageShell';
import { formatDateTime, formatDueDate, formatDuration, lateBy, lateLabel } from '../dueDates';
import { useAsyncValue } from '../useAsyncValue';
import { halfCreditProblem, pointsLabel, type ProblemScore, type Score } from '../engine/score';
import { fillInCaseNoun } from '../engine/fillIn';
import { GradeValue } from './GradingParts';
import { adjacentStudents, OFF_ROSTER_LABEL } from './gradingViews';
import { LateAdjustControls } from './LateAdjustControls';

/**
 * One student's submission on an assignment — the matrix row's page (task
 * 067; memo grading-interface.md §6.3). The header: who (name, UID, section,
 * account), the counting attempt (submitted, late, grade), the group, the
 * integrity summary and the previous / next student in matrix order. Then
 * every problem: the autograde in full (expected/got — instructor-only — and
 * every case on demand), the ½ rule's count, **Run this input** / **Open in
 * viewer** (the student's machine in the read-only editor, store
 * openSubmissionOf), and the 0 · ½ · 1 points control on every problem of the
 * counting attempt. Earlier attempts read-only on demand. Everything is read
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

  if (!value) return <p className="mm-empty">{loading ? 'Loading…' : 'Couldn’t load this submission. The server may be unreachable.'}</p>;
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

  const { name, uid, section, hasAccount, offRoster } = row.student;
  const { prev, next } = adjacentStudents(summary, student);
  const flagged = detail?.record.integrity?.questions.filter((q) => q.flags.length > 0).length;
  return (
    <div className="student-submission">
      <div className="mm-head">
        <div className="gr-pager">
          {back}
          <span className="gr-pager-links">
            <StudentLink id={id} row={prev} label="← Previous" />
            <StudentLink id={id} row={next} label="Next →" />
          </span>
        </div>
        <h1>{name}</h1>
        <p className="mm-lede">
          {[uid && `UID ${uid}`, section && `section ${section}`, hasAccount ? 'account set up' : 'no account yet']
            .filter(Boolean)
            .join(' · ')}
          {offRoster && <span className="tag gr-tag-gap">{OFF_ROSTER_LABEL[offRoster] ?? 'not on the roster'}</span>}
          {' · '}
          <a className="mm-link" {...hashLink({ kind: 'instructor-student', student })}>
            All assignments →
          </a>
        </p>
      </div>

      {!row.latest || !detail ? (
        <>
          <p className="gr-subline">
            <span className="mm-label">Due</span>
            {row.extendedTo ? `${formatDueDate(row.extendedTo)} (extended)` : assignment.dueDate ? formatDueDate(assignment.dueDate) : 'no due date'}
            <LateAdjustControls
              assignmentId={id}
              studentKey={student}
              assignmentDue={assignment.dueDate}
              extendedTo={row.extendedTo}
              canWaive={false}
              onChanged={reload}
            />
          </p>
          <p className="mm-empty">{row.grade.missing ? 'Missing. Nothing was submitted by the due date.' : 'Nothing submitted yet.'}</p>
        </>
      ) : (
        <>
          <div className="gr-header">
            <p className="gr-subline">
              <span className="mm-label">Counting attempt</span> #{detail.record.attempt}, {formatDateTime(detail.record.submittedAt)}
              <LateLine assignment={assignment} due={detail.due} submittedAt={detail.record.submittedAt} late={detail.score.late} />
              {' · '}grade <b><GradeValue value={detail.score.final} provisional={detail.score.provisional} /></b> / 100
              {row.latest.stale && <span className="mm-warn"> · graded against an older version</span>}
              {' · '}
              <a className="mm-link" {...hashLink(viewerRoute(id, student, detail.record.attempt, 0))}>
                Open in viewer →
              </a>
            </p>
            <p className="gr-subline">
              <span className="mm-label">Due</span>
              {detail.extension
                ? `${formatDueDate(detail.extension.dueDate)} (extended from ${assignment.dueDate ? formatDueDate(assignment.dueDate) : 'no due date'})`
                : assignment.dueDate
                  ? formatDueDate(assignment.dueDate)
                  : 'no due date'}
              {detail.waiver && ` · ${detail.waiver.points} late point${detail.waiver.points === 1 ? '' : 's'} waived${detail.waiver.note ? ` — ${detail.waiver.note}` : ''}`}
              <LateAdjustControls
                assignmentId={id}
                studentKey={student}
                assignmentDue={assignment.dueDate}
                extendedTo={detail.extension?.dueDate}
                waiver={detail.waiver}
                onChanged={reload}
              />
            </p>
            {detail.record.attempt > 1 && (
              <p className="gr-subline">
                <span className="mm-label">Older attempts</span> {detail.record.attempt - 1}, read-only below. Only the latest counts.
              </p>
            )}
            {detail.record.submission.group?.length ? <GroupLine keys={detail.record.submission.group} /> : null}
            {flagged !== undefined && (
              <p className="gr-subline">
                <span className="mm-label">Integrity</span>{' '}
                {flagged === 0 ? (
                  'nothing to look at'
                ) : (
                  <button className="mm-link" onClick={() => document.getElementById('gr-integrity')?.scrollIntoView({ behavior: 'smooth' })}>
                    {flagged} problem{flagged === 1 ? '' : 's'} to look at ↓
                  </button>
                )}
              </p>
            )}
          </div>
          <SubmissionDetail detail={detail} isLatest assignment={assignment} studentKey={student} onReviewed={reload} />
          {detail.record.attempt > 1 && (
            <section className="mm-section">
              <h2>Earlier attempts</h2>
              <p className="mm-note">Read-only. Only the latest attempt counts and takes grades.</p>
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

/** The viewer route (task 067): `student`'s attempt in the read-only editor,
 *  at a question, optionally with one graded case loaded. */
function viewerRoute(id: string, student: string, attempt: number, questionIndex: number, caseIndex?: number): Route {
  return caseIndex !== undefined
    ? { kind: 'assignment', id, student, attempt, questionIndex, caseIndex }
    : { kind: 'assignment', id, student, attempt, questionIndex };
}

/** Previous / next student in the matrix's order, or a dimmed label at an end. */
function StudentLink({ id, row, label }: { id: string; row: GradingRow | null; label: string }) {
  if (!row) return <span className="gr-pager-end">{label}</span>;
  return (
    <a className="mm-link" {...hashLink({ kind: 'instructor-grading-student', id, student: row.student.key })} title={row.student.name}>
      {label}
    </a>
  );
}

/** "· late by 2 class meetings: −15; 5 waived" next to a submission time —
 *  the score's price against the student's EFFECTIVE due date (`due`: their
 *  extension, else the assignment's; task 068). Without a course calendar
 *  the plain lateness, never a silent −5. Nothing when on time / no due date. */
function LateLine({
  assignment,
  due,
  submittedAt,
  late,
}: {
  assignment: AssignmentData;
  due: string | undefined;
  submittedAt: string;
  late: Score['late'];
}) {
  if (!due) return null;
  const ms = lateBy(due, submittedAt);
  if (ms === 0) return null;
  if (late?.late) return <span className="instructor-late"> · {lateLabel(late, assignment.latePolicy)}</span>;
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
        <LateLine assignment={assignment} due={detail.due} submittedAt={detail.record.submittedAt} late={detail.score.late} />
        {' · '}would grade <GradeValue value={detail.score.final} provisional={detail.score.provisional} />
        {' · '}
        <a className="mm-link" {...hashLink(viewerRoute(assignment.id, studentKey, attempt, 0))}>
          Open in viewer →
        </a>
      </p>
      <SubmissionDetail detail={detail} isLatest={false} assignment={assignment} studentKey={studentKey} onReviewed={() => {}} />
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
      return `${pointsLabel(p.points!)} by the ½ rule`;
    default:
      return `${pointsLabel(p.points!)} point${p.points === 1 ? '' : 's'}`;
  }
}

function SubmissionDetail({
  detail,
  isLatest,
  assignment,
  studentKey,
  onReviewed,
}: {
  detail: AttemptDetail;
  /** Only the counting (latest) attempt takes grades — they judge its answers. */
  isLatest: boolean;
  assignment: AssignmentData;
  /** Whose attempt: the viewer route's key (the page's route). */
  studentKey: string;
  onReviewed: () => void;
}) {
  const { record, score } = detail;
  const result = record.result;
  if (!result) {
    return (
      <div className="instructor-detail">
        <p className="mm-note">Not autograded. This attempt was submitted before autograding began.</p>
      </div>
    );
  }
  const indexOf = (questionId: number) => Math.max(0, assignment.questions.findIndex((x) => x.id === questionId));
  const viewer = (questionId: number, caseIndex?: number) =>
    viewerRoute(assignment.id, studentKey, record.attempt, indexOf(questionId), caseIndex);

  return (
    <div className="instructor-detail">
      {result.questions.map((qr) => {
        const q = assignment.questions.find((x) => x.id === qr.questionId);
        const label = q?.label ?? `Q${qr.questionId}`;
        const problem = score.problems.find((x) => x.questionId === qr.questionId);
        // Grades judge the counting attempt's answer, so only the latest takes
        // them; a record with no studentKey (a legacy anonymous dev record)
        // stays display-only. Every problem takes one (memo §6.3): a hand
        // grade where nothing was autograded, an override elsewhere — whose
        // required note is the one planner's rule (storage/gradeWrites.ts
        // planGradeWrite); the controls only show its refusal.
        const existing = record.grades?.find((g) => g.questionId === qr.questionId);
        const controls = isLatest && record.studentKey !== undefined && problem && (
          <GradeControls
            record={record}
            questionId={qr.questionId}
            existing={existing}
            override={problem.autoPoints !== null}
            onReviewed={onReviewed}
          />
        );
        // "Run this input" replays one graded case in the viewer — only for
        // the case banks the replay understands (store loadCaseInput: value
        // cases, turbot arenas, perception films).
        const replayable = q ? ['function', 'turbot', 'perception'].includes(questionTask(q)) : false;
        const runLink = (caseIndex: number) =>
          replayable && (
            <a className="mm-link" {...hashLink(viewer(qr.questionId, caseIndex))}>
              Run this input →
            </a>
          );
        const head = (what: string) => (
          <>
            <strong>{label}</strong>: {what} — <span className="gr-state">{problemState(problem)}</span>
            {' · '}
            <a className="mm-link" {...hashLink(viewer(qr.questionId))}>
              Open in viewer →
            </a>
            {q && <HalfRuleLine question={q} qr={qr} problem={problem} />}
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
                      <th />
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
                        <td>{runLink(c.arenaIndex - 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {controls}
            </div>
          );
        }
        // Fill-in questions grade one typed string per blank, one key row of
        // a table (named by its arguments), or one box of an invented
        // numeral (by rule, with its reason; engine/fillIn.ts).
        if (qr.fillCases) {
          const wrong = qr.fillCases.filter((c) => !c.pass);
          const noun = fillInCaseNoun(q?.fill_in);
          return (
            <div className="instructor-detail-q" key={qr.questionId}>
              {head(`${qr.passed}/${qr.total} ${noun}s correct`)}
              {wrong.length > 0 && (
                <table className="instructor-detail-table">
                  <thead>
                    <tr>
                      <th>{noun}</th>
                      <th>expected</th>
                      <th>got</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wrong.map((c, ci) => (
                      <tr key={ci}>
                        <td>{c.label}</td>
                        <td className="instructor-bits">{c.expected}</td>
                        <td className="instructor-bits instructor-fail">
                          {c.got === '' ? (noun === 'row' ? '(no row)' : '(blank)') : c.got}
                          {c.reason && ` — ${c.reason}`}
                        </td>
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
          // Map before filter: a film's index in the bank is the case.
          const failedCases = qr.perceptionCases.map((c, k) => ({ ...c, k })).filter((c) => !c.pass);
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
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {failedCases.map((c) => (
                      <tr key={c.k}>
                        <td className="instructor-bits">{c.frames.map((f) => f.join('')).join(' → ')}</td>
                        <td className="instructor-bits">{c.expected.join('')}</td>
                        <td className="instructor-bits instructor-fail">{c.reason ?? c.got.join('')}</td>
                        <td className="instructor-bits">{c.failStep ?? '—'}</td>
                        <td>{runLink(c.k)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {controls}
            </div>
          );
        }
        const cases = qr.cases.map((c, caseIndex) => ({ ...c, caseIndex }));
        const failed = cases.filter((c) => !c.pass);
        return (
          <div className="instructor-detail-q" key={qr.questionId}>
            {head(`${qr.passed}/${qr.total} passed`)}
            {failed.length > 0 && <CaseTable cases={failed} runLink={runLink} />}
            {cases.length > 0 && (
              <details className="gr-cases">
                <summary>All {cases.length} case{cases.length === 1 ? '' : 's'}</summary>
                <CaseTable cases={cases} runLink={runLink} showPass />
              </details>
            )}
            {controls}
          </div>
        );
      })}
      <IntegrityNotes record={record} assignment={assignment} />
    </div>
  );
}

/** Value cases, as graded: input, expected, got (instructor-only), and a
 *  replay of each in the viewer. */
function CaseTable({
  cases,
  runLink,
  showPass,
}: {
  cases: (QuestionResult['cases'][number] & { caseIndex: number })[];
  runLink: (caseIndex: number) => ReactNode;
  showPass?: boolean;
}) {
  return (
    <table className="instructor-detail-table">
      <thead>
        <tr>
          {showPass && <th>#</th>}
          <th>input</th>
          <th>expected</th>
          <th>got</th>
          {showPass && <th>verdict</th>}
          <th />
        </tr>
      </thead>
      <tbody>
        {cases.map((c) => (
          <tr key={c.caseIndex}>
            {showPass && <td className="instructor-bits">{c.caseIndex + 1}</td>}
            <td className="instructor-bits">{c.input.join(', ')}</td>
            <td className="instructor-bits">{c.expected.join(', ')}</td>
            <td className={c.pass ? 'instructor-bits' : 'instructor-bits instructor-fail'}>{c.reason ?? c.got.join(', ')}</td>
            {showPass && <td className={c.pass ? 'instructor-pass' : 'instructor-fail'}>{c.pass ? '✓' : '✗'}</td>}
            <td>{runLink(c.caseIndex)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The ½ rule's count for one problem (when the question has one): ≥ K of
 *  its N cases, and whether this attempt met it — read off the score's
 *  autograde (engine/score.ts autoPoints), never recounted here. */
function HalfRuleLine({ question, qr, problem }: { question: AssignmentQuestion; qr: QuestionResult; problem: ProblemScore | undefined }) {
  const k = question.half_credit_at;
  if (k === undefined || halfCreditProblem(question) !== null) return null;
  const met = problem?.autoPoints != null && problem.autoPoints > 0;
  return (
    <p className="gr-half">
      ½ rule: at least {k} of {qr.total} case{qr.total === 1 ? '' : 's'} · passed {qr.passed},{' '}
      <span className={met ? 'instructor-pass' : 'instructor-fail'}>{met ? 'met' : 'not met'}</span>
    </p>
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
    <div className="instructor-detail-q instructor-review" id="gr-integrity">
      <strong>Integrity (to look at, not a verdict)</strong>
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
    else if (o.conflict) setMessage('Someone else changed this grade meanwhile. Their grade is shown.');
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
          placeholder={
            override
              ? 'Why override the autograde? (required, shown to the student on release, no medical or accommodation details)'
              : 'Feedback note (optional, shown to the student on release, no medical or accommodation details)'
          }
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
