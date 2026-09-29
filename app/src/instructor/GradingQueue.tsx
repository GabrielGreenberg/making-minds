import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AssignmentData, AssignmentQuestion, HumanGrade, Points } from '../types';
import { questionModeLabel } from '../types';
import { gradingStore } from '../storage/backend';
import type { AssignmentGradingSummary, QueueResponse } from '../storage/gradingStore';
import { navigate, type Route } from '../routing';
import { hashLink } from '../components/PageShell';
import { StatementBody } from '../components/StatementBody';
import { formatDateTime } from '../dueDates';
import { pageIndexOf, problemNumber } from '../problemSet';
import { fillInShape, fillInTableRows } from '../engine/fillIn';
import { useAsyncValue } from '../useAsyncValue';
import { useAuth } from '../auth/authProvider';
import { loadUiPrefs, saveUiPref } from '../uiPrefs';
import {
  firstQueueProblem,
  hideNamesPrefKey,
  nextToGrade,
  pendingProblems,
  pointsText,
  queueCounts,
  queueKeyAction,
  queueProblemIds,
  queueState,
  responseLabel,
  stateText,
  step,
  studentsWithWork,
  submitterKeys,
  wordCount,
} from './gradingQueueViews';
import type { QueueKeyTarget } from './gradingQueueViews';

/** How often the open queue re-reads the feed (others' grades and claims). */
const POLL_MS = 30_000;
/** How often a held claim is renewed — only while the grader is active. */
const RENEW_MS = 60_000;
/** "Active" = a key, pointer or input event within this long. */
const ACTIVE_MS = 5 * 60_000;
const PROMPT_PREF = 'gradingPromptOpen';

type QueueRoute = Extract<Route, { kind: 'instructor-grading-assignment' }>;

/**
 * The hand-grading queue (task 066; memo grading-interface.md §6.4, mockup
 * 4). **By problem** (`/queue/:qid`): the problem's statement, one response
 * at a time, 0 / ½ / 1 by key, Save & next — skipping responses already
 * graded or open in another grader's queue (a soft claim, advisory: the
 * grade's version is the real guard, and a 409 shows the other grade instead
 * of overwriting it). **By student** (`/queue/student/:sid`): the same card,
 * walking one student's problems still waiting on a person. Reads the queue
 * feed and the 064 summary; it never computes a grade.
 */
export function GradingQueue({
  summary,
  assignment,
  route,
  onChanged,
}: {
  summary: AssignmentGradingSummary;
  assignment: AssignmentData;
  route: QueueRoute;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const prefKey = hideNamesPrefKey(user?.email ?? 'local');
  const [hideNames, setHideNames] = useState(() => loadUiPrefs()[prefKey] === true);
  useEffect(() => setHideNames(loadUiPrefs()[prefKey] === true), [prefKey]);
  const toggleNames = () => {
    saveUiPref(prefKey, !hideNames);
    setHideNames(!hideNames);
  };

  const id = assignment.id;
  const byStudent = route.student !== undefined;
  const problemIds = useMemo(() => queueProblemIds(summary, assignment), [summary, assignment]);
  const landing = route.questionId ?? null;

  // The bare /queue lands on the first problem with work left.
  useEffect(() => {
    if (byStudent || landing !== null) return;
    const first = firstQueueProblem(summary, assignment);
    if (first !== null) navigate({ kind: 'instructor-grading-assignment', id, view: 'queue', questionId: first }, { replace: true });
  }, [byStudent, landing, summary, assignment, id]);

  const toStudentMode = () => {
    const first = route.student ?? studentsWithWork(summary)[0]?.student.key;
    if (first) navigate({ kind: 'instructor-grading-assignment', id, view: 'queue', student: first });
  };
  const toProblemMode = () =>
    navigate({ kind: 'instructor-grading-assignment', id, view: 'queue', ...(landing !== null ? { questionId: landing } : {}) });

  const numberOf = (qid: number) => {
    const i = assignment.questions.findIndex((q) => q.id === qid);
    return i < 0 ? String(qid) : problemNumber(assignment.questions[i].label, i);
  };

  return (
    <div className="gr-queue-wrap">
      <div className="gr-qhead">
        <div className="mm-segmented" role="tablist" aria-label="Queue order">
          <button type="button" role="tab" aria-selected={!byStudent}
            className={`mm-segmented-btn${!byStudent ? ' mm-segmented-btn--active' : ''}`} onClick={toProblemMode}>
            By problem
          </button>
          <button type="button" role="tab" aria-selected={byStudent}
            className={`mm-segmented-btn${byStudent ? ' mm-segmented-btn--active' : ''}`} onClick={toStudentMode}
            disabled={!byStudent && studentsWithWork(summary).length === 0}
            title={!byStudent && studentsWithWork(summary).length === 0 ? 'Nobody has a problem waiting on a person' : undefined}>
            By student
          </button>
        </div>
        {byStudent ? (
          <StudentPicker summary={summary} current={route.student!} hideNames={hideNames}
            onPick={(key) => navigate({ kind: 'instructor-grading-assignment', id, view: 'queue', student: key })} />
        ) : (
          problemIds.length > 0 && (
            <select className="mm-input gr-qselect" aria-label="Problem" value={landing ?? ''}
              onChange={(e) => navigate({ kind: 'instructor-grading-assignment', id, view: 'queue', questionId: Number(e.target.value) })}>
              {landing !== null && !problemIds.includes(landing) && <option value={landing}>Problem {numberOf(landing)}</option>}
              {problemIds.map((qid) => {
                const q = assignment.questions.find((x) => x.id === qid)!;
                return (
                  <option key={qid} value={qid}>
                    Problem {numberOf(qid)} — {questionModeLabel(q)}
                  </option>
                );
              })}
            </select>
          )
        )}
        <span className="gr-spacer" />
        <button type="button" role="switch" aria-checked={hideNames} onMouseDown={keepFocus} className={`gr-switch${hideNames ? '' : ' gr-switch--off'}`} onClick={toggleNames}>
          <i aria-hidden="true" />
          Hide names
        </button>
      </div>

      {byStudent ? (
        <ByStudent key={route.student} summary={summary} assignment={assignment} studentKey={route.student!} hideNames={hideNames}
          numberOf={numberOf} onChanged={onChanged} />
      ) : landing === null ? (
        <p className="mm-empty">No problem here needs a person — every answer is autograded.</p>
      ) : !assignment.questions.some((q) => q.id === landing) ? (
        <p className="mm-empty">No such problem on this assignment.</p>
      ) : (
        <ByProblem key={landing} assignment={assignment} questionId={landing} hideNames={hideNames} number={numberOf(landing)}
          onChanged={onChanged} />
      )}
    </div>
  );
}

// ── By problem ───────────────────────────────────────────────────────────

/** ByProblem's "every response is done" state. */
const CAUGHT_UP = 'caught-up' as const;

/** The feed for one problem, re-read every POLL_MS, with local patches
 *  (a save, a 409's current grade) laid over it until the next read. */
function useFeed(assignmentId: string, questionId: number) {
  const feed = useAsyncValue(() => gradingStore.responses(assignmentId, questionId), [assignmentId, questionId]);
  const { reload } = feed;
  useEffect(() => {
    const t = window.setInterval(reload, POLL_MS);
    return () => window.clearInterval(t);
  }, [reload]);
  const [items, setItems] = useState<QueueResponse[] | null>(null);
  useEffect(() => {
    if (feed.value) setItems(feed.value.responses);
  }, [feed.value]);
  return { feed, items, setItems };
}

function ByProblem({
  assignment,
  questionId,
  hideNames,
  number,
  onChanged,
}: {
  assignment: AssignmentData;
  questionId: number;
  hideNames: boolean;
  number: string;
  onChanged: () => void;
}) {
  const question = assignment.questions.find((q) => q.id === questionId)!;
  const { feed, items, setItems } = useFeed(assignment.id, questionId);
  // The current response, by student key (stable across re-reads); null =
  // not chosen yet; CAUGHT_UP = none left. Never a sentinel string: a key
  // may be anything, even '' (a local dev seed's anonymous submitter).
  const [cur, setCur] = useState<{ key: string } | typeof CAUGHT_UP | null>(null);
  useEffect(() => {
    if (!items || cur !== null) return;
    const i = nextToGrade(items, -1, Date.now());
    setCur(i === null ? CAUGHT_UP : { key: items[i].student.key });
  }, [items, cur]);

  if (!items) {
    return <p className="mm-empty">{feed.loading ? 'Loading responses…' : feed.value === null ? 'No such problem.' : 'Couldn’t load the responses.'}</p>;
  }
  const curKey = cur !== null && cur !== CAUGHT_UP ? cur.key : null;
  const index = curKey !== null ? items.findIndex((r) => r.student.key === curKey) : -1;
  const item = index >= 0 ? items[index] : null;
  const counts = queueCounts(items);

  /** Lay a result over the item and, when asked, move to the next one to grade. */
  const apply = (key: string, patch: Partial<QueueResponse> | null, advance: boolean) => {
    const next = patch ? items.map((r) => (r.student.key === key ? { ...r, ...patch } : r)) : items;
    if (patch) setItems(next);
    if (advance) {
      const from = next.findIndex((r) => r.student.key === key);
      const i = nextToGrade(next, from, Date.now());
      setCur(i === null ? CAUGHT_UP : { key: next[i].student.key });
    }
    if (patch) {
      feed.reload();
      onChanged();
    }
  };
  const go = (dir: 1 | -1) => {
    const i = step(items, index, dir, Date.now());
    if (i !== null) setCur({ key: items[i].student.key });
  };

  return (
    <div className="gr-queue">
      <div>
        <p className="dim gr-qcounts">{counts.text}</p>
        <Prompt assignment={assignment} question={question} number={number} />
        {items.length === 0 ? (
          <p className="mm-empty">Nobody has submitted this assignment yet.</p>
        ) : !item ? (
          <div className="mm-empty gr-caughtup">
            <b>All caught up.</b> Every response is graded or open in another grader’s queue.{' '}
            <button type="button" className="mm-btn mm-btn--small" onClick={() => setCur({ key: items[0].student.key })}>
              Review from the top
            </button>
          </div>
        ) : (
          <ResponseCard key={`${questionId}:${item.student.key}`} assignmentId={assignment.id} question={question} item={item}
            label={responseLabel(index, item.student, hideNames)}
            position={hideNames ? `of ${items.length}` : `${index + 1} of ${items.length}`}
            hasPrev={step(items, index, -1, Date.now()) !== null} hasNext={step(items, index, 1, Date.now()) !== null}
            onResult={(patch, advance) => apply(item.student.key, patch, advance)} onStep={go} />
        )}
      </div>
      <aside className="gr-side">
        <h3>Responses</h3>
        <ul className="gr-sidelist">
          {items.map((r, i) => {
            const now = Date.now();
            const state = queueState(r, now);
            const current = r.student.key === curKey;
            return (
              <li key={r.student.key} className={current ? 'cur' : ''}>
                <button type="button" className="gr-sidebtn" onMouseDown={keepFocus} onClick={() => setCur({ key: r.student.key })}>
                  {responseLabel(i, r.student, hideNames)}
                </button>
                {current ? (
                  <span>grading</span>
                ) : state === 'claimed' ? (
                  <span className="gr-claim">{stateText(r, now)}</span>
                ) : (
                  <span className={`st ${stateClass(r)}`}>{stateText(r, now)}</span>
                )}
              </li>
            );
          })}
        </ul>
        <SideNotes items={items} hideNames={hideNames} />
      </aside>
    </div>
  );
}

function stateClass(r: QueueResponse): string {
  if (r.source === 'changed') return 'gr-st-changed';
  if (r.points === null) return 'dim';
  return r.points === 1 ? 'mm-ok' : r.points === 0.5 ? 'mm-warn' : 'mm-danger';
}

function SideNotes({ items, hideNames }: { items: QueueResponse[]; hideNames: boolean }) {
  const now = Date.now();
  const claimed = items.map((r, i) => ({ r, i })).filter(({ r }) => queueState(r, now) === 'claimed');
  const changed = items.map((r, i) => ({ r, i })).filter(({ r }) => r.source === 'changed');
  return (
    <>
      {claimed.length > 0 && (
        <>
          <h3>Being graded</h3>
          <p className="mm-note gr-sidenote">
            {claimed.map(({ r, i }) => `${responseLabel(i, r.student, hideNames)} — ${r.claim!.by}`).join('; ')}. Claims lapse after
            5 minutes idle; nothing is locked.
          </p>
        </>
      )}
      {changed.length > 0 && (
        <>
          <h3>Changed since graded</h3>
          <p className="mm-note gr-sidenote">
            {changed.map(({ r, i }) => responseLabel(i, r.student, hideNames)).join(', ')}{' '}
            {changed.length === 1 ? 'was' : 'were'} resubmitted with a different answer. The old grade is offered as a suggestion.
          </p>
        </>
      )}
    </>
  );
}

/** The problem's statement, collapsible (the choice is remembered). A part
 *  of a multi-part problem (task 048) is graded on its own, so it shows its
 *  problem's stem, then its own prompt, then the closing. */
function Prompt({ assignment, question, number }: { assignment: AssignmentData; question: AssignmentQuestion; number: string }) {
  const [open, setOpen] = useState(() => loadUiPrefs()[PROMPT_PREF] !== false);
  const toggle = () => {
    saveUiPref(PROMPT_PREF, !open);
    setOpen(!open);
  };
  const index = assignment.questions.findIndex((q) => q.id === question.id);
  const first = assignment.questions[pageIndexOf(assignment, index)] ?? question;
  return (
    <div className="gr-prompt">
      <button type="button" className="eyebrow gr-prompt-toggle" onMouseDown={keepFocus} aria-expanded={open} onClick={toggle}>
        Problem {number} {open ? '▾' : '▸'}
      </button>
      {open && (
        <>
          {first.stem?.trim() && <StatementBody text={first.stem} />}
          <StatementBody text={question.statement} />
          {first.closing?.trim() && <StatementBody text={first.closing} />}
        </>
      )}
    </div>
  );
}

// ── By student ───────────────────────────────────────────────────────────

function StudentPicker({
  summary,
  current,
  hideNames,
  onPick,
}: {
  summary: AssignmentGradingSummary;
  current: string;
  hideNames: boolean;
  onPick: (key: string) => void;
}) {
  const order = submitterKeys(summary);
  const rows = studentsWithWork(summary);
  const label = (key: string) => {
    const row = summary.rows.find((r) => r.student.key === key);
    return responseLabel(order.indexOf(key), row?.student ?? { name: 'Unknown student' }, hideNames);
  };
  const keys = rows.map((r) => r.student.key);
  if (!keys.includes(current)) keys.unshift(current);
  return (
    <select className="mm-input gr-qselect" aria-label="Student" value={current} onChange={(e) => onPick(e.target.value)}>
      {keys.map((k) => {
        const row = summary.rows.find((r) => r.student.key === k);
        const n = row ? pendingProblems(summary, row).length : 0;
        return (
          <option key={k} value={k}>
            {label(k)} — {n} waiting
          </option>
        );
      })}
    </select>
  );
}

function ByStudent({
  summary,
  assignment,
  studentKey,
  hideNames,
  numberOf,
  onChanged,
}: {
  summary: AssignmentGradingSummary;
  assignment: AssignmentData;
  studentKey: string;
  hideNames: boolean;
  numberOf: (qid: number) => string;
  onChanged: () => void;
}) {
  const row = summary.rows.find((r) => r.student.key === studentKey);
  // The problems to walk, fixed when the student is opened (a graded one stays
  // reachable by Previous); `done` tracks what was saved here since.
  const [walk] = useState(() => (row ? pendingProblems(summary, row) : []));
  const [at, setAt] = useState(0);
  const [done, setDone] = useState<Set<number>>(new Set());
  const qid = walk[at];
  const order = submitterKeys(summary);
  const label = row ? responseLabel(order.indexOf(studentKey), row.student, hideNames) : 'Unknown student';

  if (!row) return <p className="mm-empty">No such student on this assignment.</p>;
  if (walk.length === 0) {
    return <NextStudent summary={summary} assignmentId={assignment.id} from={studentKey} lead={`${label} has nothing waiting on a person.`} />;
  }
  if (qid === undefined) {
    return <NextStudent summary={summary} assignmentId={assignment.id} from={studentKey} lead={`Done with ${label}.`} />;
  }
  const advance = (savedQid: number | null) => {
    const nowDone = new Set(done);
    if (savedQid !== null) nowDone.add(savedQid);
    setDone(nowDone);
    const next = walk.findIndex((q, i) => i > at && !nowDone.has(q));
    setAt(next < 0 ? walk.length : next);
  };
  return (
    <div className="gr-queue">
      <div>
        <p className="dim gr-qcounts">
          {label} · problem {at + 1} of {walk.length} waiting · {done.size} graded here
        </p>
        <StudentProblem key={qid} assignment={assignment} questionId={qid} studentKey={studentKey} label={label} number={numberOf(qid)}
          hasPrev={at > 0} hasNext={at < walk.length - 1}
          onStep={(dir) => setAt(Math.max(0, Math.min(walk.length - 1, at + dir)))}
          onAdvance={(saved) => {
            advance(saved ? qid : null);
            if (saved) onChanged();
          }} />
      </div>
      <aside className="gr-side">
        <h3>Problems</h3>
        <ul className="gr-sidelist">
          {walk.map((q, i) => (
            <li key={q} className={i === at ? 'cur' : ''}>
              <button type="button" className="gr-sidebtn" onMouseDown={keepFocus} onClick={() => setAt(i)}>
                Problem {numberOf(q)}
              </button>
              <span className={`st${done.has(q) ? ' mm-ok' : ' dim'}`}>{i === at ? 'grading' : done.has(q) ? 'saved' : '✎'}</span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

function NextStudent({ summary, assignmentId, from, lead }: { summary: AssignmentGradingSummary; assignmentId: string; from: string; lead: string }) {
  const rest = studentsWithWork(summary).filter((r) => r.student.key !== from);
  return (
    <div className="mm-empty gr-caughtup">
      <b>{lead}</b>{' '}
      {rest.length > 0 ? (
        <button type="button" className="mm-btn mm-btn--small mm-btn--primary"
          onClick={() => navigate({ kind: 'instructor-grading-assignment', id: assignmentId, view: 'queue', student: rest[0].student.key })}>
          Next student →
        </button>
      ) : (
        'All caught up — nobody else has a problem waiting.'
      )}
    </div>
  );
}

/** One student's response to one problem, from that problem's feed. */
function StudentProblem({
  assignment,
  questionId,
  studentKey,
  label,
  number,
  hasPrev,
  hasNext,
  onStep,
  onAdvance,
}: {
  assignment: AssignmentData;
  questionId: number;
  studentKey: string;
  label: string;
  number: string;
  hasPrev: boolean;
  hasNext: boolean;
  onStep: (dir: 1 | -1) => void;
  onAdvance: (saved: boolean) => void;
}) {
  const question = assignment.questions.find((q) => q.id === questionId)!;
  const { feed, items, setItems } = useFeed(assignment.id, questionId);
  if (!items) return <p className="mm-empty">{feed.loading ? 'Loading…' : 'Couldn’t load this response.'}</p>;
  const item = items.find((r) => r.student.key === studentKey);
  return (
    <>
      <Prompt assignment={assignment} question={question} number={number} />
      {!item ? (
        <p className="mm-empty">No response from this student to Problem {number}.</p>
      ) : (
        <ResponseCard assignmentId={assignment.id} question={question} item={item} label={label} position={`Problem ${number}`}
          hasPrev={hasPrev} hasNext={hasNext} onStep={onStep}
          onResult={(patch, advance) => {
            if (patch) {
              setItems(items.map((r) => (r.student.key === studentKey ? { ...r, ...patch } : r)));
              feed.reload();
            }
            if (advance) onAdvance(!!patch);
          }} />
      )}
    </>
  );
}

// ── The response card ────────────────────────────────────────────────────

/** A 409: someone else wrote (or cleared) this grade since it was read. */
interface Conflict {
  current: HumanGrade | null;
  mine: { points: Points; note: string };
}

const KEYS: { points: Points; key: string; text: string }[] = [
  { points: 0, key: '0', text: '0' },
  { points: 0.5, key: 'H', text: '½' },
  { points: 1, key: '1', text: '1' },
];

/** Where a keystroke landed, for queueKeyAction: the card's own note, any
 *  other field (a textarea included — the topbar's Feedback form sits over
 *  the queue, task 076), a button or link, or the page. */
function keyTarget(t: EventTarget | null, note: HTMLTextAreaElement | null): QueueKeyTarget {
  if (!(t instanceof HTMLElement)) return 'page';
  if (note !== null && t === note) return 'note';
  if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return 'field';
  if (t.tagName === 'BUTTON' || t.tagName === 'A') return 'control';
  return 'page';
}

/** A modal is up over the page (the shared `.mm-modal-backdrop`): it owns
 *  the keyboard, not the queue behind it. */
function modalOpen(): boolean {
  return document.querySelector('.mm-modal-backdrop') !== null;
}

/** A mouse click must not leave focus on a button: Enter would re-click it
 *  instead of meaning "save & next". Keyboard focus (Tab) is untouched. */
function keepFocus(e: { preventDefault: () => void }) {
  e.preventDefault();
}

function ResponseCard({
  assignmentId,
  question,
  item,
  label,
  position,
  hasPrev,
  hasNext,
  onResult,
  onStep,
}: {
  assignmentId: string;
  question: AssignmentQuestion;
  item: QueueResponse;
  label: string;
  position: string;
  hasPrev: boolean;
  hasNext: boolean;
  /** A write's effect on the item (null = nothing written) and whether to move on. */
  onResult: (patch: Partial<QueueResponse> | null, advance: boolean) => void;
  onStep: (dir: 1 | -1) => void;
}) {
  const key = item.student.key;
  const qid = question.id;
  const current = item.source === 'human' ? item.grade : null;
  const [sel, setSel] = useState<Points | null>(item.source === 'changed' ? null : item.points);
  const [note, setNote] = useState(current?.note ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [busy, setBusy] = useState(false);
  const [claimedBy, setClaimedBy] = useState<string | null>(null);
  // The grade this grader started from, pinned when the card mounts: the
  // 30 s poll and a 409 both refresh `item`, but a write must carry the
  // version the grader SAW, so a grade saved meanwhile answers 409 rather
  // than being overwritten. Rebased only by an explicit "Save mine over it"
  // or a successful save.
  const base = useRef({
    version: item.grade?.version ?? null,
    points: item.points,
    source: item.source,
    note: current?.note ?? '',
  });

  // The soft claim: taken on showing the response, renewed every RENEW_MS
  // while the grader is active, released on leaving it. Advisory only.
  const lastActive = useRef(Date.now());
  useEffect(() => {
    const touch = () => {
      lastActive.current = Date.now();
    };
    const take = () =>
      gradingStore.claim(assignmentId, key, qid).then(
        (out) => setClaimedBy(out && !out.held ? out.by : null),
        () => undefined,
      );
    void take();
    const renew = window.setInterval(() => {
      if (Date.now() - lastActive.current < ACTIVE_MS) void take();
    }, RENEW_MS);
    window.addEventListener('keydown', touch);
    window.addEventListener('pointerdown', touch);
    window.addEventListener('input', touch);
    return () => {
      window.clearInterval(renew);
      window.removeEventListener('keydown', touch);
      window.removeEventListener('pointerdown', touch);
      window.removeEventListener('input', touch);
      gradingStore.claim(assignmentId, key, qid, { release: true }).catch(() => undefined);
    };
  }, [assignmentId, key, qid]);

  const write = useCallback(
    async (points: Points, text: string, version: number | null) => {
      setBusy(true);
      setMessage(null);
      const trimmed = text.trim();
      try {
        const out = await gradingStore.setGrade(assignmentId, key, qid, { points, ...(trimmed ? { note: trimmed } : {}), version });
        if (out.ok) {
          base.current = { version: out.grade?.version ?? null, points, source: 'human', note: trimmed };
          setConflict(null);
          onResult({ grade: out.grade, points, source: 'human', suggestion: undefined }, true);
        } else if (out.conflict) {
          setConflict({ current: out.current, mine: { points, note: trimmed } });
          onResult({ grade: out.current }, false);
        } else {
          setMessage(out.error);
        }
      } catch {
        setMessage('Couldn’t save — the server may be unreachable. Try again.');
      } finally {
        setBusy(false);
      }
    },
    [assignmentId, key, qid, onResult],
  );

  const saveNext = useCallback(() => {
    if (busy) return;
    if (sel === null) {
      setMessage('Choose 0, ½ or 1 first.');
      return;
    }
    // A conflict on show: theirs stands unless "Save mine over it" is
    // clicked, so Enter means "Keep theirs & next".
    if (conflict) {
      onResult(null, true);
      return;
    }
    // Unchanged from what the grader started with: nothing to write.
    const b = base.current;
    const standing = b.source === 'human' ? b.note : '';
    if (b.source !== 'changed' && b.points === sel && note.trim() === standing) {
      onResult(null, true);
      return;
    }
    void write(sel, note, b.version);
  }, [busy, sel, note, conflict, write, onResult]);

  // The keys: 0 / h / 1 choose; Enter saves & moves on (Shift+Enter is a
  // newline in the note); J / K next / previous — what each keystroke means
  // is queueKeyAction's (typing in a field is left alone except Enter in THIS
  // card's note; a modal over the queue owns the keyboard).
  const noteRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const action = queueKeyAction(
        { key: e.key, shift: e.shiftKey, modifier: e.metaKey || e.ctrlKey || e.altKey },
        keyTarget(e.target, noteRef.current),
        modalOpen(),
      );
      if (action === null) return;
      if (action === 'save-next') {
        e.preventDefault();
        saveNext();
        return;
      }
      if (action === 'choose-0') setSel(0);
      else if (action === 'choose-half') setSel(0.5);
      else if (action === 'choose-1') setSel(1);
      else if (action === 'next' && hasNext) onStep(1);
      else if (action === 'prev' && hasPrev) onStep(-1);
      else return;
      e.preventDefault();
      setMessage(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveNext, hasNext, hasPrev, onStep]);

  const suggestion = item.source === 'changed' ? item.suggestion : undefined;
  const text = item.answer.kind === 'text' ? item.answer.text : '';

  return (
    <div className="gr-card">
      <div className="gr-resp-meta">
        <b>{label}</b>
        <span>{position}</span>
        <span>·</span>
        <span>submitted {formatDateTime(item.submittedAt)}</span>
        {item.attempt > 1 && <span>· attempt {item.attempt}</span>}
        {item.answer.kind === 'text' && <span>· {wordCount(text)} words</span>}
        {item.student.offRoster && <span className="tag">not on the roster</span>}
      </div>

      {claimedBy && (
        <p className="gr-notice" role="status">
          Being graded by {claimedBy} right now. Nothing is locked — but a grade saved over theirs will ask first.
        </p>
      )}

      <Answer item={item} question={question} assignmentId={assignmentId} />

      {suggestion && (
        <p className="gr-notice gr-notice--changed" role="status">
          Graded {pointsText(suggestion.points)} on attempt {suggestion.attempt ?? '?'} — the answer has since changed.{' '}
          <button type="button" className="mm-btn mm-btn--small" disabled={busy}
            onClick={() => void write(suggestion.points, suggestion.note ?? '', base.current.version)}>
            Keep {pointsText(suggestion.points)}
          </button>
        </p>
      )}

      {conflict && (
        <p className="gr-notice gr-notice--conflict" role="alert">
          {conflict.current
            ? `Graded ${pointsText(conflict.current.points)} by ${conflict.current.grader ?? 'someone else'} meanwhile — theirs stands.`
            : 'The grade was cleared meanwhile.'}{' '}
          <button type="button" className="mm-btn mm-btn--small" onClick={() => onResult(null, true)}>
            Keep theirs &amp; next
          </button>{' '}
          <button type="button" className="mm-btn mm-btn--small" disabled={busy}
            onClick={() => {
              base.current = { ...base.current, version: conflict.current?.version ?? null };
              void write(conflict.mine.points, conflict.mine.note, base.current.version);
            }}>
            Save mine over it
          </button>
        </p>
      )}

      <div className="gr-gradebar">
        <div>
          <span className="mm-label">Points</span>
          <div className="gr-keys">
            {KEYS.map((k) => (
              <button key={k.key} type="button"
                className={`gr-key${sel === k.points ? ' gr-key--on' : suggestion?.points === k.points ? ' gr-key--sugg' : ''}`}
                aria-pressed={sel === k.points}
                // Keep focus off the key, so Enter still means "save & next".
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setSel(k.points);
                  setMessage(null);
                }}>
                {k.text}
                <kbd>{k.key}</kbd>
              </button>
            ))}
          </div>
        </div>
        <label className="mm-field gr-note">
          <span>Note to the student ({item.autoPoints === null ? 'optional on a hand grade' : 'required to override the autograde'})</span>
          <textarea ref={noteRef} className="mm-input" rows={2} placeholder="No medical or accommodation details" value={note}
            onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="gr-qfoot">
          <span>
            {message ? (
              <span className="mm-danger">{message}</span>
            ) : (
              <>
                <kbd className="mono">0</kbd> <kbd className="mono">H</kbd> <kbd className="mono">1</kbd> points ·{' '}
                <kbd className="mono">J</kbd>/<kbd className="mono">K</kbd> next / previous · <kbd className="mono">↵</kbd> save &amp; next
              </>
            )}
          </span>
          <button type="button" className="mm-btn" disabled={!hasPrev} onMouseDown={keepFocus} onClick={() => onStep(-1)}>
            ← Previous
          </button>
          <button type="button" className="mm-btn mm-btn--primary" disabled={busy} onClick={saveNext}>
            Save &amp; next →
          </button>
        </div>
      </div>
    </div>
  );
}

function Answer({ item, question, assignmentId }: { item: QueueResponse; question: AssignmentQuestion; assignmentId: string }) {
  const a = item.answer;
  if (a.kind === 'machine') {
    return (
      <div className="gr-answer">
        <p>
          A machine answer ({questionModeLabel(question)}), autograded {item.autoPoints === null ? '— nothing to grade against' : pointsText(item.autoPoints)}.{' '}
          <a className="mm-link" {...hashLink({ kind: 'instructor-grading-student', id: assignmentId, student: item.student.key })}>
            Open the submission →
          </a>
        </p>
      </div>
    );
  }
  if (a.kind === 'fill') {
    const shape = question.fill_in ? fillInShape(question.fill_in) : null;
    // A table answer reads as the table the student filled — plain text,
    // row-major like the answer (engine/fillIn.ts fillInTableRows).
    if (shape?.kind === 'table') {
      return (
        <div className="gr-answer">
          <div className="mm-tablewrap gr-fill-table">
            <table className="mm-table">
              <thead>
                <tr>{shape.columns.map((col, j) => <th key={j}>{col.header}</th>)}</tr>
              </thead>
              <tbody>
                {fillInTableRows(shape, a.blanks).map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, j) => <td key={j} className="mono">{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }
    const blanks = shape?.blanks ?? [];
    return (
      <div className="gr-answer">
        <dl className="gr-blanks">
          {blanks.map((b, i) => (
            <div key={i}>
              <dt>{b.label}</dt>
              <dd className="mono">{a.blanks[i]?.trim() ? a.blanks[i] : <span className="dim">(blank)</span>}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }
  const paras = a.text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return (
    <div className="gr-answer">
      {paras.length ? paras.map((p, i) => <p key={i}>{p}</p>) : <p className="dim">(no answer)</p>}
    </div>
  );
}
