// Headless checks for the Grading tab's view logic (task 065;
// src/instructor/gradingViews.ts over the 064 summaries; memo
// docs/buildout/designs/grading-interface.md §6.1–§6.2).
//
//   cd app && npx tsx tools/gradingViewCheck.ts
//
// A synthetic summary (buildAssignmentSummary — the one builder both backends
// run) over a toy assignment (one machine question, one open question) and
// made-up students covering every cell state: auto 1 / ½ / 0, a human grade,
// an override, a pending open answer, a changed answer, a late attempt, a
// missing student past due, an off-roster submitter and a stale result.
// Pins: [cells] cellOf for every state; [filters] each chip's predicate and
// its count (the roster only); [problems] problemStats; [tiles] the
// Overview's counts; [grades] progress.grades over submitted roster rows;
// [release] the warning; [adjacent students] the submission page's
// Previous / Next in matrix order (task 067); [sort] counting assignments first; [claims] the
// hand-grading queue's soft claims (task 066; storage/gradingClaims.ts — TTL,
// renewal, never stolen, one per grader); [queue] the queue's pure logic
// (src/instructor/gradingQueueViews.ts — states, Save & next's skips, J/K,
// the counts line, hidden names); [feed] buildQuestionResponses over the same
// fixture (who is in it and in what order, answers by kind, the suggestion,
// no answer key or circuit); [no view grades] the grep gate (no view imports
// the grader or a scorer) and the retired gradebook's files are gone.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { AssignmentData, AssignmentQuestion, HumanGrade, Points, QuestionResult, SubmissionData, SubmissionRecord } from '../src/types';
import { answerKey } from '../src/engine/score';
import { homeworkContentHash } from '../src/devData/homeworkSync';
import {
  buildAssignmentSummary,
  buildQuestionResponses,
  type CourseAssignmentRow,
  type GradingIdentity,
  type QueueResponse,
} from '../src/storage/gradingSummary';
import { ClaimBook, CLAIM_TTL_MS, type ClaimView } from '../src/storage/gradingClaims';
import {
  hideNamesPrefKey,
  nextToGrade,
  queueCounts,
  queueProblemIds,
  queueState,
  responseLabel,
  stateText,
  step,
  studentsWithWork,
  submitterKeys,
} from '../src/instructor/gradingQueueViews';
import {
  adjacentStudents,
  cellOf,
  filterCounts,
  filterTest,
  isCounted,
  matchesSearch,
  MATRIX_FILTERS,
  overviewTiles,
  problemStats,
  releaseWarning,
  sectionsOf,
  sortGradingRows,
  splitRows,
} from '../src/instructor/gradingViews';

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

// ── The fixture (synthetic identities only — PROFILE §8.9) ─────────────────
const M: AssignmentQuestion = {
  id: 1, label: 'Problem 1', statement: 'A machine.', buildMode: 'CC', representation: 'binary', half_credit_at: 2,
} as AssignmentQuestion;
const O: AssignmentQuestion = { id: 2, label: 'Problem 2', statement: 'Explain.', buildMode: 'open', representation: 'binary' } as AssignmentQuestion;
const asg: AssignmentData = { id: 'toy', title: 'Toy set', dueDate: '2026-10-01T00:00:00.000Z', questions: [M, O] };
const HASH = homeworkContentHash(asg);
const NOW = Date.parse('2026-10-10T00:00:00Z');
const ON_TIME = '2026-09-30T12:00:00.000Z';
const LATE = '2026-10-02T12:00:00.000Z';

const who = (key: string, name: string, section: string | null = null): GradingIdentity =>
  ({ key, name, sortName: name, uid: `90000000${key.slice(-1)}`, section, hasAccount: true });
const roster = [who('ka', 'Student A', '1A'), who('kb', 'Student B', '1A'), who('kc', 'Student C', '1B'),
  who('kd', 'Student D', '1B'), who('ke', 'Student E'), who('kf', 'Student F')];

const machineResult = (passed: number): QuestionResult =>
  ({ questionId: M.id, status: 'graded', passed, total: 4, cases: [] }) as unknown as QuestionResult;
const openResult: QuestionResult = { questionId: O.id, status: 'pending', passed: 0, total: 0, cases: [] } as unknown as QuestionResult;
const EMPTY = { components: [], wires: [] };

function record(key: string, opts: { passed: number; text: string; at?: string; hash?: string; flag?: string; grades?: { q: AssignmentQuestion; points: Points; text?: string }[] }): SubmissionRecord {
  const submission: SubmissionData = {
    assignmentTitle: asg.title,
    submittedAt: opts.at ?? ON_TIME,
    answers: [{ questionId: M.id, circuit: EMPTY }, { questionId: O.id, circuit: EMPTY, responseText: opts.text }],
  };
  const grades: HumanGrade[] = (opts.grades ?? []).map(({ q, points, text }) => ({
    questionId: q.id,
    points,
    note: 'n',
    // A grade judges an answer; `text` = it judged a different one (changed since).
    answerKey: answerKey(q, text !== undefined ? { questionId: q.id, circuit: EMPTY, responseText: text } : submission.answers.find((a) => a.questionId === q.id)),
    gradedAt: ON_TIME,
    grader: 'grader',
    attempt: 1,
    version: 1,
  }));
  return {
    assignmentId: asg.id,
    attempt: 1,
    submittedAt: submission.submittedAt,
    submission,
    result: { student: key, questions: [machineResult(opts.passed), openResult], passed: opts.passed, total: 4 },
    grades,
    studentKey: key,
    assignmentHash: opts.hash ?? HASH,
    ...(opts.flag
      ? {
          integrity: {
            v: 1 as const,
            flagged: 1,
            questions: [
              {
                questionId: M.id,
                ids: { total: 0, self: 0, unbound: 0, legacy: 0, others: [] },
                text: 'none' as const,
                record: 'none' as const,
                flags: [{ code: 'one-save' as const, detail: opts.flag }],
              },
            ],
          },
        }
      : {}),
  };
}

const latest = [
  record('ka', { passed: 4, text: 'yes', grades: [{ q: O, points: 1 }] }), //           1 · 1(human)        → 100
  record('kb', { passed: 2, text: 'maybe' }), //                                          ½ · ✎               → 55*
  record('kc', { passed: 0, text: 'no', at: LATE, grades: [{ q: M, points: 1 }] }), //  1(override) · ✎, late → 70*
  record('kd', { passed: 4, text: 'new', hash: 'older', grades: [{ q: O, points: 1, text: 'old' }] }), // 1 · ↻, stale → 70*
  record('kf', { passed: 0, text: 'nothing', flag: 'x@y.edu did it', grades: [{ q: O, points: 0 }] }), // 0⚑ · 0(human) → 40
  record('kx', { passed: 4, text: 'test' }), //                                           an off-roster submitter
];
const summary = buildAssignmentSummary({
  assignment: asg,
  roster,
  latest,
  identify: (key) => ({ ...who(key, 'Someone else'), offRoster: 'not-rostered' }),
  released: false,
  now: NOW,
});
const row = (key: string) => summary.rows.find((r) => r.student.key === key)!;
const cell = (key: string, qi: number) => cellOf(row(key).problems[qi], row(key));

console.log('[cells]');
check('auto pass → 1, no underline', cell('ka', 0).state === '1' && cell('ka', 0).text === '1' && !cell('ka', 0).human);
check('a hand grade of 1 → 1, underlined', cell('ka', 1).state === '1' && cell('ka', 1).human);
check('the ½ rule → ½ (h)', cell('kb', 0).state === 'h' && cell('kb', 0).text === '½' && !cell('kb', 0).human);
check('an open answer with no grade → ✎ (pending)', cell('kb', 1).state === 'p' && cell('kb', 1).text === '✎');
check('an override of an autograde → its points, underlined', cell('kc', 0).state === '1' && cell('kc', 0).human);
check('auto fail → 0', cell('kf', 0).state === '0' && cell('kf', 0).text === '0' && !cell('kf', 0).human);
check('a hand grade of 0 → 0, underlined', cell('kf', 1).state === '0' && cell('kf', 1).human);
check('a grade on an older answer → ↻ (changed), not underlined', cell('kd', 1).state === 'c' && cell('kd', 1).text === '↻' && !cell('kd', 1).human);
check('an integrity flag rides on its problem\'s cell (⚑), only there',
  cell('kf', 0).flags.join() === 'most of the work appeared between two saves' && cell('kf', 1).flags.length === 0 &&
    cell('ka', 0).flags.length === 0 && !('flags' in row('ka').problems[0]));
check('…as a code: the summary never carries a flag\'s detail (it can name a classmate\'s email)',
  JSON.stringify(row('kf').problems[0].flags) === '["one-save"]' && !JSON.stringify(summary).includes('@'));
check('a late attempt with no late policy: late, no units, no deduction (no "−0")',
  row('kc').latest?.late.late === true && row('kc').latest?.late.deduction === null && row('kc').latest?.late.units === null);
check('an on-time attempt: not late, no deduction',
  row('ka').latest?.late.late === false && row('ka').latest?.late.deduction === null);
check('no attempt → — (every problem)', [0, 1].every((i) => cell('ke', i).state === 'm' && cell('ke', i).text === '—'));

console.log('[filters]');
const { roster: rosterRows, offRoster } = splitRows(summary);
const keysOf = (id: (typeof MATRIX_FILTERS)[number]['id']) => rosterRows.filter(filterTest(id)).map((r) => r.student.key).join();
check('the chips, in order (Flagged waits for task 070)',
  MATRIX_FILTERS.map((f) => f.label).join('|') === 'All|Needs grading|Changed|Late|Missing|Below 70');
check('Needs grading = a pending or changed problem', keysOf('needs-grading') === 'kb,kc,kd', keysOf('needs-grading'));
check('Changed', keysOf('changed') === 'kd');
check('Late', keysOf('late') === 'kc');
check('Missing = past due, no submission', keysOf('missing') === 'ke');
check('Below 70 = a submitted grade under 70 (Missing is its own chip)', keysOf('below-70') === 'kb,kf', keysOf('below-70'));
const counts = filterCounts(summary);
check('chip counts over the roster only (the off-roster submitter, pending, is not in Needs grading)',
  counts.all === 6 && counts['needs-grading'] === 3 && counts.changed === 1 && counts.late === 1 && counts.missing === 1 &&
    counts['below-70'] === 2 && offRoster.length === 1 && filterTest('needs-grading')(offRoster[0]), JSON.stringify(counts));
check('the section select lists the rows\' sections', sectionsOf(summary).join() === '1A,1B');
check('search: name or UID, any case', matchesSearch(row('kb'), 'student b') && matchesSearch(row('kb'), '900000000'.slice(0, 5)) &&
  !matchesSearch(row('kb'), 'student c') && matchesSearch(row('kb'), '  '));

console.log('[problems]');
const [pm, po] = problemStats(summary, asg);
const sum = (d: typeof pm.dist) => d.one + d.half + d.zero + d.pending;
check('each problem: its printed number, kind and hand flag',
  pm.number === '1' && po.number === '2' && pm.kind === 'CC' && po.kind === 'open' && !pm.hand && po.hand);
check('the machine: 1 · ½ · 0 · pending = 3 · 1 · 1 · 0, mean 0.7, one override',
  pm.dist.one === 3 && pm.dist.half === 1 && pm.dist.zero === 1 && pm.dist.pending === 0 && Math.abs(pm.mean! - 0.7) < 1e-9 &&
    pm.overrides === 1, JSON.stringify(pm));
check('the open problem: 1 · 0 · pending 3 (changed counts as pending), mean over graded 0.5',
  po.dist.one === 1 && po.dist.zero === 1 && po.dist.pending === 3 && po.mean === 0.5, JSON.stringify(po));
check('the distribution sums to the submitted count', sum(pm.dist) === summary.progress.submitted && sum(po.dist) === summary.progress.submitted);
check('hand x / y only for hand problems', pm.handGraded === null && po.handGraded?.x === 2 && po.handGraded.y === 5);

console.log('[tiles]');
const t = overviewTiles(summary, asg);
check('Submitted: 5 / 6, on time = submitted − late, 1 missing',
  t.submitted.x === 5 && t.submitted.of === 6 && t.submitted.onTime === 4 && t.submitted.late === 1 && t.submitted.missing === 1, JSON.stringify(t.submitted));
check('Autograded: 5 / 5, 1 against an older version', t.autograded.x === 5 && t.autograded.of === 5 && t.autograded.stale === 1);
check('Hand-graded: 2 / 5, 1 changed, 1 override (a human grade on an autograded problem)',
  t.handGraded.x === 2 && t.handGraded.y === 5 && t.handGraded.changed === 1 && t.handGraded.overrides === 1, JSON.stringify(t.handGraded));
check('Grade: mean and median from the summary, provisional, 3 problems pending, not released',
  t.grade.mean === 67 && t.grade.median === 70 && t.grade.provisional && t.grade.pendingProblems === 3 && !t.grade.released, JSON.stringify(t.grade));

console.log('[grades]');
check('progress.grades: mean 67, median 70 over the 5 submitted roster rows (100, 55, 70, 70, 40), 3 provisional',
  summary.progress.grades.mean === 67 && summary.progress.grades.median === 70 && summary.progress.grades.provisional === 3,
  JSON.stringify(summary.progress.grades));
check('…the off-roster submitter and the missing student are not in it',
  row('kx').grade.final !== null && row('ke').grade.final === 0 && summary.progress.submitted === 5);
const none = buildAssignmentSummary({ assignment: asg, roster, latest: [], identify: (k) => who(k, 'x'), released: false, now: NOW });
check('no submission → no mean or median', none.progress.grades.mean === null && none.progress.grades.median === null);

console.log('[release]');
const warn = releaseWarning(summary) ?? '';
check('the release warning names pending hand grades, changed answers and stale autogrades',
  warn.includes('2 problems still awaiting a hand grade') && warn.includes('1 answer changed since graded') &&
    warn.includes('1 submission graded against an older version'), warn);
const done = buildAssignmentSummary({ assignment: asg, roster, latest: [latest[0]], identify: (k) => who(k, 'x'), released: false, now: NOW });
check('…and nothing once nothing is open', releaseWarning(done) === null);

console.log('[adjacent students]');
{
  // The submission page's Previous / Next (task 067): the matrix's unfiltered
  // order — the roster by sort name, then the off-roster submitters.
  const { roster: rr, offRoster: off } = splitRows(summary);
  const order = [...rr, ...off].map((r) => r.student.key);
  const sorted = rr.map((r) => r.student.sortName);
  check('the roster rows are in sort-name order, off-roster after them',
    JSON.stringify(sorted) === JSON.stringify([...sorted].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))) &&
      off.length > 0 && order.length === summary.rows.length);
  const walk = order.map((k) => adjacentStudents(summary, k));
  check('each student\'s prev/next are its neighbours in that order',
    walk.every((a, i) => (a.prev?.student.key ?? null) === (order[i - 1] ?? null) && (a.next?.student.key ?? null) === (order[i + 1] ?? null)));
  check('no previous at the first, no next at the last', walk[0].prev === null && walk[walk.length - 1].next === null);
  check('the last roster student leads to the first off-roster submitter',
    adjacentStudents(summary, rr[rr.length - 1].student.key).next?.student.key === off[0].student.key);
  const unknown = adjacentStudents(summary, 'nobody');
  check('an unknown key → both null', unknown.prev === null && unknown.next === null);
}

console.log('[sort]');
const course = (id: string, countsTowardGrade?: boolean): CourseAssignmentRow =>
  ({ id, title: id, visible: true, released: false, progress: summary.progress, ...(countsTowardGrade !== undefined ? { countsTowardGrade } : {}) });
const sorted = sortGradingRows([course('hw7', false), course('hw1'), course('hw2', true), course('x', false)]);
check('counting assignments first, in order; countsTowardGrade: false after', sorted.map((r) => r.id).join() === 'hw1,hw2,hw7,x');
check('a not-counted row is dimmed; absent counts', !isCounted(course('hw7', false)) && isCounted(course('hw1')) && isCounted(course('hw2', true)));

console.log('[claims]');
{
  const book = new ClaimBook();
  const T = (studentKey: string) => ({ assignmentId: 'toy', studentKey, questionId: O.id });
  const A = { actor: 'a@example.edu', name: 'Grader A' };
  const B = { actor: 'b@example.edu', name: 'Grader B' };
  const t0 = 1_000_000;
  const c1 = book.claim(T('ka'), A, t0);
  check('a claim at t lives until t + 5 minutes', CLAIM_TTL_MS === 300_000 && c1.held && Date.parse(c1.until) === t0 + CLAIM_TTL_MS);
  check('…live one ms before `until`, gone AT it',
    book.active('toy', O.id, t0 + CLAIM_TTL_MS - 1).has('ka') && !book.active('toy', O.id, t0 + CLAIM_TTL_MS).has('ka'));
  check('active() prunes what has lapsed', book.size === 0);
  book.claim(T('ka'), A, t0);
  const renewed = book.claim(T('ka'), A, t0 + 200_000);
  check('the same grader claiming again renews it', renewed.held && Date.parse(renewed.until) === t0 + 200_000 + CLAIM_TTL_MS &&
    book.active('toy', O.id, t0 + CLAIM_TTL_MS + 1).has('ka'));
  const stolen = book.claim(T('ka'), B, t0 + 250_000);
  check("another grader's live claim is not taken — the answer names who holds it",
    !stolen.held && stolen.by === 'Grader A' && book.active('toy', O.id, t0 + 250_000).get('ka')?.by === 'Grader A');
  const after = book.claim(T('ka'), B, t0 + 200_000 + CLAIM_TTL_MS);
  check('…but an expired one is', after.held && book.active('toy', O.id, t0 + 200_000 + CLAIM_TTL_MS).get('ka')?.by === 'Grader B');
  const t1 = t0 + 10_000_000;
  book.claim(T('kb'), A, t1);
  book.claim(T('kc'), A, t1 + 1);
  const live = book.active('toy', O.id, t1 + 2);
  check('one live claim per grader: claiming B drops A', !live.has('kb') && live.get('kc')?.by === 'Grader A');
  book.release(T('kc'), B.actor);
  check('a release by someone who does not hold it is a no-op', book.active('toy', O.id, t1 + 3).has('kc'));
  book.release(T('kc'), A.actor);
  check('…by the holder, it goes', !book.active('toy', O.id, t1 + 4).has('kc'));
  book.claim(T('kd'), A, t1 + 5);
  const views = book.active('toy', O.id, t1 + 6, A.actor);
  check("the viewer's own claim is `mine`; another's is not",
    views.get('kd')?.mine === true && book.active('toy', O.id, t1 + 6, B.actor).get('kd')?.mine === false &&
      book.active('toy', M.id, t1 + 6).size === 0);
}

console.log('[queue]');
{
  const NOW_Q = 5_000_000;
  const live = (by: string, mine: boolean): ClaimView => ({ by, mine, until: new Date(NOW_Q + 60_000).toISOString() });
  const lapsed: ClaimView = { by: 'Grader B', mine: false, until: new Date(NOW_Q).toISOString() };
  type Item = Pick<QueueResponse, 'source' | 'points' | 'claim' | 'suggestion'>;
  const it = (source: QueueResponse['source'], points: QueueResponse['points'], claim: ClaimView | null = null, suggestion?: HumanGrade): Item =>
    ({ source, points, claim, ...(suggestion ? { suggestion } : {}) });
  const half: HumanGrade = { questionId: O.id, points: 0.5, answerKey: 'x', gradedAt: ON_TIME, version: 2 };
  check('queueState: pending → to-grade; changed → changed; a hand grade or an autograde → graded',
    queueState(it('pending', null), NOW_Q) === 'to-grade' && queueState(it('changed', null), NOW_Q) === 'changed' &&
      queueState(it('human', 1), NOW_Q) === 'graded' && queueState(it('auto', 0), NOW_Q) === 'graded' &&
      queueState(it('auto-half', 0.5), NOW_Q) === 'graded');
  check("…another grader's live claim → claimed (whatever the work); the viewer's own on work left → mine; a lapsed claim is nothing",
    queueState(it('pending', null, live('Grader B', false)), NOW_Q) === 'claimed' &&
      queueState(it('human', 1, live('Grader B', false)), NOW_Q) === 'claimed' &&
      queueState(it('pending', null, live('Me', true)), NOW_Q) === 'mine' &&
      queueState(it('human', 1, live('Me', true)), NOW_Q) === 'graded' &&
      queueState(it('pending', null, lapsed), NOW_Q) === 'to-grade');
  const items: Item[] = [
    it('human', 1), //                               0 graded
    it('pending', null, live('Grader B', false)), // 1 claimed by B
    it('pending', null), //                          2 to grade
    it('changed', null, null, half), //              3 changed
    it('auto', 1), //                                4 graded
    it('pending', null, live('Me', true)), //        5 mine
  ];
  check('Save & next skips graded and claimed-by-others: from the top → 2, from 2 → 3, from 3 → 5 (own claim not a skip)',
    nextToGrade(items, -1, NOW_Q) === 2 && nextToGrade(items, 2, NOW_Q) === 3 && nextToGrade(items, 3, NOW_Q) === 5);
  check('…it wraps once: from 5 → 2', nextToGrade(items, 5, NOW_Q) === 2);
  const doneItems: Item[] = [it('human', 1), it('pending', null, live('Grader B', false)), it('auto', 0)];
  check('…null (All caught up) when only graded and claimed-by-others remain; empty → null',
    nextToGrade(doneItems, -1, NOW_Q) === null && nextToGrade(doneItems, 0, NOW_Q) === null && nextToGrade([], -1, NOW_Q) === null);
  check('…a lapsed claim is not a skip', nextToGrade([it('human', 1), it('pending', null, lapsed)], 0, NOW_Q) === 1);
  check('J/K: adjacent, skipping only claimed-by-others (graded ones are visited), no wrap',
    step(items, 0, 1, NOW_Q) === 2 && step(items, 2, -1, NOW_Q) === 0 && step(items, 3, 1, NOW_Q) === 4 &&
      step(items, 5, 1, NOW_Q) === null && step(items, 0, -1, NOW_Q) === null);
  check('the counts line: by the work, not the claims',
    queueCounts(items).text === '2 of 6 graded · 1 changed · 3 to go', queueCounts(items).text);
  check('the side list: ½ · claimed by name · ↻ was ½ · ✎',
    stateText(it('human', 0.5), NOW_Q) === '½' && stateText(items[1], NOW_Q) === 'claimed by Grader B' && stateText(items[3], NOW_Q) === '↻ was ½' &&
      stateText(items[2], NOW_Q) === '✎');
  const s = { name: 'Student B' };
  check('hidden names: "Response N" by the feed position; shown: the name',
    responseLabel(38, s, true) === 'Response 39' && responseLabel(38, s, false) === 'Student B');
  check('the Hide names pref is per person', hideNamesPrefKey('Ada@Example.edu') === 'gradingHideNames:ada@example.edu' &&
    hideNamesPrefKey('a@x.edu') !== hideNamesPrefKey('b@x.edu'));
  check('the problem picker: hand problems, and any other with a response waiting on a person',
    queueProblemIds(summary, asg).join() === String(O.id));
  const order = submitterKeys(summary);
  check('by student: submitters in the stable key order (roster, then the rest); the ones with work waiting',
    order.join() === 'ka,kb,kc,kd,kf,kx' && studentsWithWork(summary).map((r) => r.student.key).join() === 'kb,kc,kd,kx');
}

console.log('[feed]');
{
  // A fill-in question joins the toy set; one submitter's grade is claimed.
  const F: AssignmentQuestion = {
    id: 3, label: 'Problem 3', statement: 'Fill in.', buildMode: 'open', representation: 'binary',
    fill_in: { labels: ['a', 'b'] }, fill_in_answers: ['1', '10'],
  } as AssignmentQuestion;
  const asgF: AssignmentData = { ...asg, questions: [M, O, F] };
  const withFill = latest.map((r) => ({
    ...r,
    submission: { ...r.submission, answers: [...r.submission.answers, { questionId: F.id, circuit: EMPTY, fillAnswers: ['1', '11'] }] },
    result: { ...r.result!, questions: [...r.result!.questions, { questionId: F.id, status: 'graded', passed: 1, total: 2, cases: [], fillCases: [{ expected: '10', got: '11', pass: false }] } as unknown as QuestionResult] },
  }));
  const claims = new Map<string, ClaimView>([['kb', { by: 'Grader B', mine: false, until: new Date(NOW + 60_000).toISOString() }]]);
  const feedOf = (qid: number) => buildQuestionResponses({
    assignment: asgF, questionId: qid, roster, latest: withFill,
    identify: (key) => ({ ...who(key, 'Someone else'), offRoster: 'not-rostered' }), claims, released: false, now: NOW,
  })!;
  const open = feedOf(O.id);
  check('every submitter: roster first, by key; then the off-roster one, flagged; a non-submitter absent',
    open.responses.map((r) => r.student.key).join() === 'ka,kb,kc,kd,kf,kx' && open.responses[5].student.offRoster === 'not-rostered' &&
      !open.responses.some((r) => r.student.key === 'ke'));
  check('an open answer is its text', open.responses[1].answer.kind === 'text' &&
    (open.responses[1].answer as { text: string }).text === 'maybe');
  const kd = open.responses[3];
  check('a changed answer: source changed, the stored grade (with its version) AND the suggestion',
    kd.source === 'changed' && kd.points === null && kd.grade?.version === 1 && kd.suggestion?.points === 1);
  check('the points as the one score says: a hand grade, and pending', open.responses[0].source === 'human' && open.responses[0].points === 1 &&
    open.responses[1].source === 'pending' && open.responses[1].points === null);
  check("another grader's claim shows by name, not mine", open.responses[1].claim?.by === 'Grader B' && open.responses[1].claim.mine === false &&
    open.responses[0].claim === null);
  const fill = feedOf(F.id).responses[0];
  check('a fill-in answer is its blanks', fill.answer.kind === 'fill' && (fill.answer as { blanks: string[] }).blanks.join() === '1,11');
  const machine = feedOf(M.id).responses[0];
  check('a machine answer is a reference to the attempt, never the circuit',
    JSON.stringify(machine.answer) === JSON.stringify({ kind: 'machine', attempt: 1 }));
  const text = JSON.stringify([open, feedOf(F.id), feedOf(M.id)]);
  const leaks = ['test_cases', 'perception_cases', 'fill_in_answers', 'expected', '"got"', 'components', 'wires', 'integrity', 'circuit', '@']
    .filter((k) => text.includes(k));
  check('the feed carries no answer key, case, circuit, integrity or email', leaks.length === 0, leaks.join());
  check('answer keys ride only as fingerprints (16 hex)', [open.responses[0].answerKey, open.responses[0].grade!.answerKey]
    .every((k) => /^[0-9a-f]{16}$/.test(k)));
  check('an unknown question → null', buildQuestionResponses({
    assignment: asgF, questionId: 99, roster, latest: withFill, identify: (k) => who(k, 'x'), claims, released: false, now: NOW,
  }) === null);
}

console.log('[no view grades]');
{
  const dir = new URL('../src/instructor/', import.meta.url);
  const views = readdirSync(dir).filter((f) => /^Grading.*\.tsx$|^Student(Submission|Grading)View\.tsx$|^gradingViews\.ts$|^gradingQueueViews\.ts$/.test(f));
  const offenders = views.filter((f) => /engine\/grader|\bscoreRecord\b|\bscoreSubmission\b/.test(readFileSync(new URL(f, dir), 'utf8')));
  check(`the grading views read the summaries; none imports the grader or a scorer (${views.length} files)`,
    views.length >= 7 && offenders.length === 0, offenders.join(', '));
  check('the retired gradebook is gone (GradebookView.tsx, Gradebook.ts)',
    !existsSync(new URL('GradebookView.tsx', dir)) && !existsSync(new URL('Gradebook.ts', dir)));
}

console.log(failures === 0 ? '\ngradingViewCheck: all checks passed' : `\ngradingViewCheck: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
