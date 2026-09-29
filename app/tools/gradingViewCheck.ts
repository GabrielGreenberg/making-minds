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
// the counts line, hidden names; a review table — task 048 — is a hand
// problem the queue offers); [feed] buildQuestionResponses over the same
// fixture (who is in it and in what order, answers by kind, the suggestion,
// no answer key or circuit); [regrade dialog] the re-grade's rows and
// summary line (task 069 — an autograde's move, the grade's, the override
// that stays); [flags] task 070's flag rules, each both ways (not
// submitted and extensions, very late, group mismatch incl. a chained group
// of four and groupKey, integrity per row, identical text and "same group",
// off-roster never flagged, the Flagged chip, struggling over settled (due)
// counted sets in catalog order, no account, hidden assignments dropped,
// custom thresholds, normalizeThresholds, countedAverage, the history line,
// gradingFlags.ts grader-free); [export] the grades CSV (task 071 — shape,
// quoting, formula guard, cells ≡ the summary's finals, the average,
// one-assignment mode, gradesExport.ts scorer-free); [no view grades] the grep gate (no view — the re-grade dialog
// too — imports the grader or a scorer) and the retired gradebook's files
// are gone.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { AssignmentData, AssignmentQuestion, HumanGrade, Points, QuestionResult, SubmissionData, SubmissionRecord } from '../src/types';
import { courseFlags, DEFAULT_FLAG_THRESHOLDS, normalizeThresholds, type FlaggedStudent, type FlagThresholds } from '../src/storage/gradingFlags';
import { answerKey } from '../src/engine/score';
import { homeworkContentHash } from '../src/devData/homeworkSync';
import {
  buildAssignmentSummary,
  buildQuestionResponses,
  countedAverage,
  type AssignmentGradingSummary,
  type CourseAssignmentRow,
  type GradingIdentity,
  type GradingRow,
  type LateContext,
  type StudentHistoryEntry,
  type QueueResponse,
} from '../src/storage/gradingSummary';
import { ClaimBook, CLAIM_TTL_MS, type ClaimView } from '../src/storage/gradingClaims';
import { buildGradesExport, csvCell, exportColumnLabel, exportFilename } from '../src/storage/gradesExport';
import type { RegradeChange, RegradePlan } from '../src/storage/regrade';
import {
  hideNamesPrefKey,
  nextToGrade,
  queueCounts,
  queueKeyAction,
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
  flagKindCounts,
  historyLine,
  isCounted,
  isHandQuestion,
  matchesSearch,
  MATRIX_FILTERS,
  overviewTiles,
  problemStats,
  regradeRow,
  regradeSummary,
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
check('the chips, in order (memo §6.2)',
  MATRIX_FILTERS.map((f) => f.label).join('|') === 'All|Needs grading|Changed|Late|Missing|Flagged|Below 70');
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
  // A REVIEW table (task 048): a fill-in table authored with no key is
  // graded by hand — the queue offers it before anyone submits, as it does a
  // prose problem; a keyed table is the autograder's.
  const R = { id: 7, label: 'Problem 7', statement: 'Define f with a table.', buildMode: 'open', representation: 'binary',
    fill_in: { table: { columns: ['x', 'f(x)'], argColumns: 1, rows: 2 } }, fill_in_answers: [] } as AssignmentQuestion;
  const K = { ...R, id: 8, label: 'Problem 8', fill_in_answers: ['0', '1', '1', '0'] } as AssignmentQuestion;
  check('isHandQuestion: prose and a review table are hand problems; a keyed table and a machine are not',
    isHandQuestion(O) && isHandQuestion(R) && !isHandQuestion(K) && !isHandQuestion(M));
  const asgR: AssignmentData = { ...asg, questions: [M, O, R, K] };
  const noneYet = buildAssignmentSummary({ assignment: asgR, roster, latest: [], identify: (key) => who(key, 'x'), released: false, now: NOW });
  check('…so the queue offers a review table before anyone submits (a keyed one only once a response waits)',
    queueProblemIds(noneYet, asgR).join() === `${O.id},${R.id}`);
  const pendingR = latest.map((r) => ({
    ...r,
    submission: { ...r.submission, answers: [...r.submission.answers, { questionId: R.id, circuit: EMPTY, fillAnswers: ['0', '1'] }] },
    result: { ...r.result!, questions: [...r.result!.questions, { questionId: R.id, status: 'pending', passed: 0, total: 0, cases: [] } as unknown as QuestionResult] },
  }));
  const withR = buildAssignmentSummary({ assignment: asgR, roster, latest: pendingR, identify: (key) => who(key, 'x'), released: false, now: NOW });
  check('…and a submitted review table waits on a person in the queue',
    queueProblemIds(withR, asgR).includes(R.id) && withR.rows.some((r) => r.latest && r.problems[2]?.source === 'pending'));
  const order = submitterKeys(summary);
  check('by student: submitters in the stable key order (roster, then the rest); the ones with work waiting',
    order.join() === 'ka,kb,kc,kd,kf,kx' && studentsWithWork(summary).map((r) => r.student.key).join() === 'kb,kc,kd,kx');

  // The keys (queueKeyAction). Enter saves & moves on only from the card's
  // own note or the page — never from another textarea: since task 076 the
  // topbar's Feedback form can sit over the queue, and Enter in its message
  // must type a newline, not save a grade behind the modal.
  const press = (key: string, target: Parameters<typeof queueKeyAction>[1], modal = false, shift = false, modifier = false) =>
    queueKeyAction({ key, shift, modifier }, target, modal);
  check('keys: Enter in the note or on the page → Save & next; Shift+Enter → nothing (a newline)',
    press('Enter', 'note') === 'save-next' && press('Enter', 'page') === 'save-next' &&
      press('Enter', 'note', false, true) === null && press('Enter', 'page', false, true) === null);
  check("keys: Enter in any other field (another textarea — the Feedback form's message) → nothing; on a button/link → nothing (it clicks)",
    press('Enter', 'field') === null && press('Enter', 'control') === null);
  check('keys: 0 / h / 1 choose, J / K step — on the page or a button, case-insensitive',
    press('0', 'page') === 'choose-0' && press('h', 'page') === 'choose-half' && press('H', 'control') === 'choose-half' &&
      press('1', 'page') === 'choose-1' && press('j', 'page') === 'next' && press('K', 'page') === 'prev' && press('x', 'page') === null);
  check('keys: typed in a field or the note, they are text (nothing)',
    (['0', 'h', '1', 'j', 'k'] as const).every((k) => press(k, 'field') === null && press(k, 'note') === null));
  check('keys: a modal over the queue owns the keyboard — nothing, wherever focus is',
    (['Enter', '0', 'h', '1', 'j', 'k'] as const).every((k) =>
      (['note', 'field', 'control', 'page'] as const).every((t) => press(k, t, true) === null)));
  check('keys: with a modifier (Cmd/Ctrl/Alt) → nothing', press('Enter', 'page', false, false, true) === null && press('1', 'page', false, false, true) === null);
  const queueSrc = readFileSync(new URL('../src/instructor/GradingQueue.tsx', import.meta.url), 'utf8');
  check("GradingQueue's key handler goes through queueKeyAction, placing the note by ref and asking for an open modal",
    /queueKeyAction\(/.test(queueSrc) && /keyTarget\(e\.target, noteRef\.current\)/.test(queueSrc) &&
      /<textarea ref=\{noteRef\}/.test(queueSrc) && /querySelector\('\.mm-modal-backdrop'\)/.test(queueSrc) &&
      !/tagName !== 'TEXTAREA'/.test(queueSrc));
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

console.log('[regrade dialog]');
{
  const who = { key: 'k1', name: 'Descartes, René', sortName: 'Descartes' };
  const change = (over: Partial<RegradeChange>): RegradeChange => ({
    student: who, questionId: 7, number: '7', attempt: 2,
    before: { auto: 1, points: 1 }, after: { auto: 0, points: 0 },
    gradeBefore: 77.1, gradeAfter: 73.5, underOverride: false, ...over,
  });
  const down = regradeRow(change({}));
  check('an autograde that falls: "1 → 0", the grade "77.1 → 73.5", marked down',
    down.student === 'Descartes, René' && down.problem === 'P7' && down.autograde === '1 → 0' && down.up === false &&
      down.grade === '77.1 → 73.5' && down.override === null, JSON.stringify(down));
  const up = regradeRow(change({ before: { auto: 0, points: 0 }, after: { auto: 0.5, points: 0.5 }, gradeBefore: 40, gradeAfter: 55 }));
  check('…one that rises to ½: "0 → ½", "40 → 55", marked up', up.autograde === '0 → ½' && up.up === true && up.grade === '40 → 55');
  const over = regradeRow(change({ number: '5', before: { auto: 0, points: 0.5 }, after: { auto: 1, points: 0.5 }, underOverride: true, gradeBefore: 60, gradeAfter: 60 }));
  check('under an override: the override that stays (½), no grade move', over.override === '½' && over.grade === '' && over.autograde === '0 → 1',
    JSON.stringify(over));
  const plan: RegradePlan = {
    assignmentId: 'hw2', assignmentHash: 'h', latest: 74, stale: 9, changed: [change({}), change({}), change({ underOverride: true })],
    unchanged: 71, humanGrades: { hand: 108, overrides: 2 },
  };
  const line = regradeSummary(plan);
  check('the summary line: "3 results would change · 71 unchanged · 108 hand grades and 2 overrides untouched."',
    line.changes === '3 results would change' && line.rest === '71 unchanged · 108 hand grades and 2 overrides untouched.',
    JSON.stringify(line));
  check('…singular when one', regradeSummary({ ...plan, changed: [change({})], humanGrades: { hand: 1, overrides: 1 } }).rest ===
    '71 unchanged · 1 hand grade and 1 override untouched.');
}

console.log('[flags]');
{
  // Task 070: each flag rule both ways, over summaries the one builder makes
  // (buildAssignmentSummary with thresholds) — synthetic students only.
  const DAY = 86_400_000;
  const DUE = '2026-10-01T00:00:00.000Z';
  const due = Date.parse(DUE);
  const at = (days: number) => new Date(due + days * DAY).toISOString();
  const T = DEFAULT_FLAG_THRESHOLDS;
  const mkAsg = (id: string, qs: AssignmentQuestion[], extra: Partial<AssignmentData> = {}): AssignmentData =>
    ({ id, title: id.toUpperCase(), dueDate: DUE, questions: qs, ...extra });
  const rec = (
    a: AssignmentData,
    key: string,
    o: { m?: number; text?: string; at?: string; group?: string[]; gradeO?: Points; flag?: boolean } = {},
  ): SubmissionRecord => {
    const submission: SubmissionData = {
      assignmentTitle: a.title,
      submittedAt: o.at ?? at(-1),
      answers: a.questions.map((q) => (q.id === O.id ? { questionId: q.id, circuit: EMPTY, responseText: o.text ?? '' } : { questionId: q.id, circuit: EMPTY })),
      ...(o.group ? { group: o.group } : {}),
    };
    const grades: HumanGrade[] = o.gradeO !== undefined
      ? [{ questionId: O.id, points: o.gradeO, answerKey: answerKey(O, submission.answers.find((x) => x.questionId === O.id)), gradedAt: at(2), grader: 'g', attempt: 1, version: 1 }]
      : [];
    return {
      assignmentId: a.id,
      attempt: 1,
      submittedAt: submission.submittedAt,
      submission,
      result: { student: key, questions: a.questions.map((q) => (q.id === O.id ? openResult : machineResult(o.m ?? 4))), passed: o.m ?? 4, total: 4 },
      grades,
      studentKey: key,
      assignmentHash: homeworkContentHash(a),
      ...(o.flag
        ? { integrity: { v: 1 as const, flagged: 1, questions: [{ questionId: M.id, ids: { total: 0, self: 0, unbound: 0, legacy: 0, others: [] }, text: 'none' as const, record: 'none' as const, flags: [{ code: 'one-save' as const, detail: 'x' }] }] } }
        : {}),
    };
  };
  const sum = (a: AssignmentData, ros: GradingIdentity[], recs: SubmissionRecord[], now: number, extra: { thresholds?: FlagThresholds; late?: LateContext } = {}) =>
    buildAssignmentSummary({
      assignment: a, roster: ros, latest: recs, identify: (k) => ({ ...who(k, 'Off'), offRoster: 'not-rostered' }),
      released: false, now, thresholds: extra.thresholds ?? T, ...(extra.late ? { late: extra.late } : {}),
    });
  const kinds = (s: AssignmentGradingSummary, key: string) => (s.rows.find((r) => r.student.key === key)?.flags ?? []).map((f) => f.kind);
  const has = (s: AssignmentGradingSummary, key: string, kind: string) => kinds(s, key).includes(kind as never);
  const flagOf = (s: AssignmentGradingSummary, key: string, kind: string) => s.rows.find((r) => r.student.key === key)?.flags?.find((f) => f.kind === kind);
  const A1 = mkAsg('fa', [M, O]);

  // Not submitted / very late.
  {
    const ros = [who('n1', 'N1'), who('n2', 'N2'), who('n3', 'N3'), who('n4', 'N4'), who('n5', 'N5')];
    const ext = { dueDate: at(30), setBy: 'i', setAt: at(0) };
    const late: LateContext = { byStudent: new Map([['n2', { extension: ext }]]) };
    const s15 = sum(A1, ros, [rec(A1, 'n3', { at: at(15) }), rec(A1, 'n4', { at: at(13) })], due + 15 * DAY + 1000, { late });
    check('not submitted: fires past the effective due date', has(s15, 'n1', 'not-submitted'), kinds(s15, 'n1').join());
    check('…NOT when an extension moves the due date past now', !has(s15, 'n2', 'not-submitted') && !has(s15, 'n2', 'very-late'),
      kinds(s15, 'n2').join());
    check('very late: a submission 15 days after the due date fires; 13 days does not',
      has(s15, 'n3', 'very-late') && !has(s15, 'n4', 'very-late') && !has(s15, 'n3', 'not-submitted'),
      `${kinds(s15, 'n3')} / ${kinds(s15, 'n4')}`);
    check('…nothing by due + 15 days fires too', has(s15, 'n1', 'very-late') && has(s15, 'n5', 'very-late'));
    const s13 = sum(A1, ros, [], due + 13 * DAY);
    check('…nothing by due + 13 days: not submitted, not (yet) very late', has(s13, 'n1', 'not-submitted') && !has(s13, 'n1', 'very-late'));
    const custom = sum(A1, ros, [rec(A1, 'n3', { at: at(15) })], due + 15 * DAY + 1000, { thresholds: { ...T, veryLateDays: 20 } });
    check('custom thresholds change the outcome: veryLateDays 20 → 15 days late is not very late', !has(custom, 'n3', 'very-late'));
    const before = sum(A1, ros, [], due - DAY);
    check('before the due date nobody is flagged', before.rows.every((r) => !r.flags));
  }

  // Group mismatch.
  {
    const ros = ['ga', 'gb', 'gc', 'gd', 'gg', 'gh', 'k1', 'k2', 'k3', 'k4'].map((k) => who(k, k.toUpperCase()));
    const s = sum(A1, ros, [
      rec(A1, 'ga', { group: ['gb'] }), rec(A1, 'gb'), //                    B submitted, didn't list A
      rec(A1, 'gc', { group: ['gd'] }), //                                   D never submitted, due passed
      rec(A1, 'gg', { group: ['gh'] }), rec(A1, 'gh', { group: ['gg'] }), // reciprocal
      rec(A1, 'k1', { group: ['k2'] }), rec(A1, 'k2', { group: ['k1', 'k3'] }), rec(A1, 'k3', { group: ['k2', 'k4'] }), rec(A1, 'k4', { group: ['k3'] }),
    ], due + DAY);
    check('group mismatch: B submitted without listing A → both flagged, each naming the other by key',
      flagOf(s, 'ga', 'group-mismatch')?.others?.join() === 'gb' && flagOf(s, 'gb', 'group-mismatch')?.others?.join() === 'ga');
    check('…B missing past the due date → both flagged', has(s, 'gc', 'group-mismatch') && has(s, 'gd', 'group-mismatch'));
    check('…a reciprocal pair → neither', !has(s, 'gg', 'group-mismatch') && !has(s, 'gh', 'group-mismatch'));
    check('…four listed together through chained listings (all reciprocal) → all four flagged',
      ['k1', 'k2', 'k3', 'k4'].every((k) => flagOf(s, k, 'group-mismatch')?.detail.includes('4 people')),
      JSON.stringify(flagOf(s, 'k1', 'group-mismatch')));
    check('…a row carries its group listing (keys)', s.rows.find((r) => r.student.key === 'k2')?.group?.join() === 'k1,k3' &&
      !('group' in s.rows.find((r) => r.student.key === 'gb')!));
    const early = sum(A1, ros, [rec(A1, 'ga', { group: ['gb'] })], due - DAY);
    check('…NOT while B has not submitted before the due date', !has(early, 'ga', 'group-mismatch') && !has(early, 'gb', 'group-mismatch'));
    const mapped = buildAssignmentSummary({
      assignment: A1, roster: ros, latest: [rec(A1, 'ga', { group: ['toy-gb'] })], identify: (k) => who(k, 'x'),
      released: false, now: due - DAY, thresholds: T, groupKey: (raw) => (raw.startsWith('toy-') ? raw.slice(4) : null),
    });
    check('…groupKey maps a listing to identity keys (local: toy id → email)', mapped.rows.find((r) => r.student.key === 'ga')?.group?.join() === 'gb');
  }

  // Integrity and identical text.
  {
    const ros = ['i1', 'i2', 'i3', 'i4', 'i5', 'i6'].map((k) => who(k, k.toUpperCase()));
    const text = 'The machine counts the ones, then halts.';
    const s = sum(A1, ros, [
      rec(A1, 'i1', { flag: true, text }),
      rec(A1, 'i2', { text: `  the machine   counts THE ones, then halts. ` }),
      rec(A1, 'i3', { text: 'Different words entirely, and long enough.' }),
      rec(A1, 'i4', { text: 'yes it does' }), rec(A1, 'i5', { text: 'yes it does' }),
    ], due + DAY);
    check('integrity: a row with a flagged problem is flagged, counted per row',
      flagOf(s, 'i1', 'integrity')?.detail === '1 problem with integrity flags' && !has(s, 'i2', 'integrity'));
    const same = flagOf(s, 'i1', 'identical-text');
    check('identical text: the same open answer (whitespace, case aside) flags both, naming the problem and each other',
      same?.questionId === O.id && same.others?.join() === 'i2' && same.sameGroup === false &&
        flagOf(s, 'i2', 'identical-text')?.others?.join() === 'i1' && !has(s, 'i3', 'identical-text'), JSON.stringify(same));
    check('…never below identicalTextMinChars', !has(s, 'i4', 'identical-text') && !has(s, 'i5', 'identical-text'));
    check('…the fingerprints never ship: no answer text in the summary', !JSON.stringify(s).includes('halts') && !JSON.stringify(s).includes('yes it does'));
    const grouped = sum(A1, ros, [rec(A1, 'i1', { text, group: ['i2'] }), rec(A1, 'i2', { text, group: ['i1'] })], due + DAY);
    check('…annotated "same group" when the two list each other', flagOf(grouped, 'i1', 'identical-text')?.sameGroup === true &&
      flagOf(grouped, 'i1', 'identical-text')!.detail.includes('same group'));
    const strict = sum(A1, ros, [rec(A1, 'i1', { text }), rec(A1, 'i2', { text })], due + DAY, { thresholds: { ...T, identicalTextMinChars: 100 } });
    check('…custom identicalTextMinChars 100 → not compared', !has(strict, 'i1', 'identical-text'));
    const off = buildAssignmentSummary({
      assignment: A1, roster: [who('i1', 'I1')], latest: [rec(A1, 'i1', { text }), rec(A1, 'zz', { text, flag: true })],
      identify: (k) => ({ ...who(k, 'Off'), offRoster: 'not-rostered' }), released: false, now: due + 20 * DAY, thresholds: T,
    });
    check('an off-roster submitter is never flagged (nor compared)', !off.rows.find((r) => r.student.key === 'zz')?.flags && !has(off, 'i1', 'identical-text'));
    check('the Flagged chip: rows with any flag, counted over the roster',
      filterCounts(s).flagged === s.rows.filter((r) => !r.student.offRoster && r.flags?.length).length && filterCounts(s).flagged >= 3 &&
        filterTest('flagged')(s.rows.find((r) => r.student.key === 'i1')!) && !filterTest('flagged')(s.rows.find((r) => r.student.key === 'i3')!) &&
        filterCounts(off).flagged === 0);
  }

  // Course-wide: struggling, no account, hidden assignments.
  {
    const S1 = mkAsg('s1', [M], { order: 1 });
    const S2 = mkAsg('s2', [M, O], { order: 2 });
    const S3 = mkAsg('s3', [M], { order: 3, countsTowardGrade: false });
    const S4 = mkAsg('s4', [M], { order: 4 });
    const ros = [who('sa', 'SA'), who('sb', 'SB'), who('sc', 'SC'), who('sd', 'SD')];
    const now = due + 3 * DAY;
    const low = { m: 0, gradeO: 0 as Points };
    const high = { m: 4, gradeO: 1 as Points };
    const plan: Record<string, [typeof low, typeof low, typeof low, typeof low]> = {
      sa: [low, low, high, high], //                             40, 40 → struggling
      sb: [low, high, low, low], //                              40, 100, (uncounted 40), 40 → not
      sc: [high, high, low, low], //                             …, (uncounted 40), 40 → not (the uncounted set is skipped)
      sd: [low, { m: 0 } as typeof low, high, high], //         40, 40* provisional → not
    };
    const sets = [S1, S2, S3, S4];
    const summaries = sets.map((a, i) => ({
      summary: sum(a, ros, ros.map((r) => rec(a, r.key, plan[r.key][i])), now),
      visible: true,
      order: a.order,
    }));
    const flagged = (extra: Partial<Parameters<typeof courseFlags>[0]> = {}) =>
      courseFlags({ roster: ros, summaries, thresholds: T, now, ...extra });
    const struggling = (f: FlaggedStudent[]) => f.filter((x) => x.flags.some((y) => y.kind === 'struggling')).map((x) => x.student.key).join();
    check('struggling: two consecutive counted settled sets below 70 — not across a set ≥ 70, an uncounted set or a provisional grade',
      struggling(flagged()) === 'sa', struggling(flagged()));
    check('…the provisional grade is < 70 but unsettled', summaries[1].summary.rows.find((r) => r.student.key === 'sd')!.grade.provisional &&
      summaries[1].summary.rows.find((r) => r.student.key === 'sd')!.grade.final! < 70);
    check('…custom struggleRun 1 flags every one with a settled grade under 70', struggling(flagged({ thresholds: { ...T, struggleRun: 1 } })) === 'sa,sb,sc,sd');
    check('…counted sets in catalog order, whatever order they arrive in', struggling(courseFlags({ roster: ros, summaries: [...summaries].reverse(), thresholds: T, now })) === 'sa');
    // A set not yet due is unsettled even if submitted and fully autograded:
    // sa's two lows, the second due after now → no run of two.
    const early = mkAsg('s2', [M], { order: 2, dueDate: at(10) });
    const earlySum = { summary: sum(early, ros, ros.map((r) => rec(early, r.key, low)), now), visible: true, order: 2 };
    const earlyRow = earlySum.summary.rows.find((r) => r.student.key === 'sa')!;
    check('…a submitted set not yet due breaks the run (settled only past its effective due date)',
      !earlyRow.grade.provisional && earlyRow.grade.final! < 70 &&
        struggling(courseFlags({ roster: ros, summaries: [summaries[0], earlySum], thresholds: T, now })) === '' &&
        struggling(courseFlags({ roster: ros, summaries: [summaries[0], earlySum], thresholds: T, now: due + 11 * DAY })).includes('sa'),
      JSON.stringify(earlyRow.grade));
    const cal = { meetings: [{ start: at(-10), end: at(-10) }] };
    const noAcc = [{ ...who('na', 'NA'), hasAccount: false }, who('nb', 'NB')];
    const acct = (days: number) => courseFlags({ roster: noAcc, summaries: [], thresholds: T, calendar: cal, now: due - 10 * DAY + days * DAY })
      .filter((x) => x.flags.some((y) => y.kind === 'no-account')).map((x) => x.student.key).join();
    check('no account: fires 8 days after the first meeting; not at 6 days; never with an account; never without a calendar',
      acct(8) === 'na' && acct(6) === '' &&
        courseFlags({ roster: noAcc, summaries: [], thresholds: T, now: due + 30 * DAY }).length === 0, `${acct(8)} / ${acct(6)}`);
    const missing = sum(S1, ros, [], now);
    const withHidden = (visible: boolean) => courseFlags({ roster: ros, summaries: [{ summary: missing, visible }], thresholds: T, now })
      .filter((x) => x.flags.some((y) => y.kind === 'not-submitted' && y.assignmentId === 's1')).length;
    check('courseFlags carries a published assignment\'s row flags, and drops a hidden one\'s', withHidden(true) === 4 && withHidden(false) === 0);
    const counts = flagKindCounts(flagged());
    check('the Needs-attention counts: students flagged, per kind (a student once per kind)',
      counts.total === flagged().length && counts.kinds.find((k) => k.kind === 'struggling')?.count === 1, JSON.stringify(counts));
  }

  // Thresholds.
  check('normalizeThresholds: defaults for nothing or junk', JSON.stringify(normalizeThresholds(undefined)) === JSON.stringify(T) &&
    JSON.stringify(normalizeThresholds('junk')) === JSON.stringify(T) && JSON.stringify(normalizeThresholds([3])) === JSON.stringify(T));
  const n = normalizeThresholds({ veryLateDays: 3.6, struggleBelow: 'x', maxGroupSize: -5, noAccountDays: Infinity, extra: 1 });
  check('…whole numbers, clamped into range; a bad field is its default; unknown fields dropped',
    n.veryLateDays === 4 && n.struggleBelow === 70 && n.maxGroupSize === 1 && n.noAccountDays === 7 && !('extra' in n), JSON.stringify(n));

  // The counted average (the student page; 071's export).
  {
    const row = (final: number | null, o: { provisional?: boolean; extendedTo?: string } = {}): GradingRow => ({
      student: who('av', 'AV'), latest: null, problems: [], ...(o.extendedTo ? { extendedTo: o.extendedTo } : {}),
      grade: { raw: final, final, provisional: !!o.provisional, missing: false },
    });
    const now = due + DAY;
    const avg = countedAverage([
      { dueDate: DUE, row: row(40) },
      { dueDate: DUE, row: row(100, { provisional: true }) },
      { dueDate: DUE, countsTowardGrade: false, row: row(0) },
      { dueDate: at(10), row: row(0) },
      { dueDate: DUE, row: row(0, { extendedTo: at(5) }) },
      { row: row(10) },
    ], now);
    check('countedAverage: counted sets whose effective due date passed — not uncounted, not due yet, not extended past now',
      avg.value === 70 && avg.sets === 2 && avg.provisional, JSON.stringify(avg));
    check('…none due → null', countedAverage([{ dueDate: at(10), row: row(50) }], now).value === null);
  }

  // The history line.
  {
    const base = { assignmentId: 'hw2', title: 'HW2' };
    const g = (points: Points, note?: string) => ({ questionId: 3, points, answerKey: 'k', gradedAt: 'x', ...(note ? { note } : {}) });
    const fmt = (iso: string) => iso.slice(0, 10);
    const line = (event: StudentHistoryEntry['event']) => historyLine({ ...base, event }, fmt);
    check('history: a hand grade, an override (with its note), a clear',
      line({ at: 'a', actor: 'i', questionId: 3, kind: 'grade', before: null, after: g(0.5) }) === 'HW2 P3: — → ½ (hand grade)' &&
        line({ at: 'a', actor: 'i', questionId: 3, kind: 'override', before: g(1), after: g(0.5, 'one wire off') }) === 'HW2 P3: 1 → ½ (override) — “one wire off”' &&
        line({ at: 'a', actor: 'i', questionId: 3, kind: 'clear', before: g(1), after: null }) === 'HW2 P3: grade cleared (was 1)',
      line({ at: 'a', actor: 'i', questionId: 3, kind: 'override', before: g(1), after: g(0.5, 'one wire off') }));
    check('…an extension and a waiver (no problem number), set and cleared',
      line({ at: 'a', actor: 'i', kind: 'extension', before: null, after: { dueDate: '2026-10-08T06:59:00.000Z', setBy: 'i', setAt: 'x' } }) === 'HW2: extension to 2026-10-08' &&
        line({ at: 'a', actor: 'i', kind: 'extension', before: { dueDate: 'd', setBy: 'i', setAt: 'x' }, after: null }) === 'HW2: extension cleared' &&
        line({ at: 'a', actor: 'i', kind: 'waiver', before: null, after: { points: 5, by: 'i', at: 'x' } }) === 'HW2: 5 late points waived');
    check('…a re-grade', line({
      at: 'a', actor: 'i', questionId: 3, kind: 'regrade', attempt: 1, fromHash: null, toHash: 'h',
      before: { auto: 0, points: 0 }, after: { auto: 1, points: 1 }, underOverride: false,
    }) === 'HW2 P3: re-graded, 0 → 1');
  }

  // The flags module stays grader-free (the remote store's graph imports it — remoteStoreCheck).
  const src = readFileSync(new URL('../src/storage/gradingFlags.ts', import.meta.url), 'utf8');
  check('gradingFlags.ts imports no grader or scorer (types from engine/score only)',
    !/engine\/grader|\bscoreRecord\b|\bscoreSubmission\b/.test(src) && !/^import (?!type )[^;]*engine\//m.test(src));
}

console.log('[export]');
{
  // The grades CSV (task 071; storage/gradesExport.ts): a rendering of the
  // summaries — every cell is a row's grade.final, the average countedAverage.
  const parse = (csv: string): string[][] => {
    const out: string[][] = [];
    let rowCells: string[] = [];
    let cellText = '';
    let quoted = false;
    for (let i = 0; i < csv.length; i++) {
      const ch = csv[i]!;
      if (quoted) {
        if (ch === '"' && csv[i + 1] === '"') { cellText += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cellText += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { rowCells.push(cellText); cellText = ''; }
      else if (ch === '\r' && csv[i + 1] === '\n') { rowCells.push(cellText); out.push(rowCells); rowCells = []; cellText = ''; i++; }
      else cellText += ch;
    }
    return out;
  };
  const people = [who('e1', 'Doe, "Jo"', '2A'), who('e2', '=HYPERLINK("x")'), who('e3', 'Line\nBreak', '2B')];
  const PAST = '2026-10-01T00:00:00.000Z';
  const FUTURE = '2026-10-20T00:00:00.000Z';
  const set = (id: string, title: string, dueDate: string, extra: Partial<AssignmentData> = {}): AssignmentData =>
    ({ ...asg, id, title, dueDate, ...extra });
  const rec = (a: AssignmentData, key: string, passed: number): SubmissionRecord => {
    const r = record(key, { passed, text: 'a' });
    return { ...r, assignmentId: a.id, assignmentHash: homeworkContentHash(a) };
  };
  const extended: LateContext = {
    byStudent: new Map([['e3', { extension: { dueDate: '2026-10-15T00:00:00.000Z', setBy: 'i', setAt: 'x' } }]]),
  };
  const build = (a: AssignmentData, latestRecs: SubmissionRecord[], late?: LateContext) =>
    buildAssignmentSummary({
      assignment: a, roster: people, latest: latestRecs, released: false, now: NOW,
      identify: (key) => ({ ...who(key, 'Someone else'), offRoster: 'not-rostered' }), ...(late ? { late } : {}),
    });
  const h1 = set('h1', 'HW1. Basics: Circuits', PAST);
  const h2 = set('h2', 'HW2. Later', FUTURE);
  const h1b = set('h1b', 'HW1 redux', PAST);
  const h7 = set('h7', 'HW7. Final Project', PAST, { countsTowardGrade: false });
  const hid = set('hid', 'HW3. Hidden', PAST);
  const odd = set('odd', 'Bonus set', PAST);
  const sets = [
    { summary: build(h2, [rec(h2, 'e1', 4)]), order: 2, visible: true },
    { summary: build(h1, [rec(h1, 'e1', 4), rec(h1, 'e3', 2), rec(h1, 'kx', 4)], extended), order: 1, visible: true },
    { summary: build(h1b, [rec(h1b, 'e1', 0)]), order: 3, visible: true },
    { summary: build(h7, [rec(h7, 'e1', 4)]), order: 7, visible: true },
    { summary: build(hid, [rec(hid, 'e1', 4)]), order: 4, visible: false },
    { summary: build(odd, []), order: 5, visible: true },
  ];
  const emailOf = (key: string) => `${key}@toy.example`;
  const out = buildGradesExport({ assignments: sets, emailOf, now: NOW })!;
  check('the file: UTF-8 BOM, CRLF line ends only, a dated filename',
    out.csv.startsWith('﻿') && out.csv.endsWith('\r\n') && !/[^\r]\n/.test(out.csv.replace(/"[^"]*"/g, '')) &&
      out.filename === 'making-minds-grades-2026-10-09.csv', out.filename);
  const table = parse(out.csv.slice(1));
  check('header: UID, name, email, section, the counted published sets in catalog order (labels HW<n>, deduped, else the id), average',
    table[0]!.join() === 'UID,name,email,section,HW1,HW2,HW1 (2),odd,average' && out.columns.join() === 'HW1,HW2,HW1 (2),odd', table[0]!.join());
  const order = sets[0]!.summary.rows.filter((r) => !r.student.offRoster).map((r) => emailOf(r.student.key));
  check('rows: the roster only (no off-roster submitter), in the summaries’ order',
    out.rows === 3 && table.length === 4 && table.slice(1).map((r) => r[2]).join() === order.join() && order.length === 3,
    table.slice(1).map((r) => r[2]).join());
  const line = (key: string) => table.find((r) => r[2] === emailOf(key))!;
  check('quoting: comma, quote and newline survive a round trip',
    line('e1')[1] === 'Doe, "Jo"' && line('e3')[1] === 'Line\nBreak' && out.csv.includes('"Doe, ""Jo"""'));
  check('formula guard: a text cell starting with = gets a leading apostrophe', line('e2')[1] === `'=HYPERLINK("x")`, line('e2')[1]);
  check('csvCell: + - @ tab guarded, numbers never', csvCell('+1') === "'+1" && csvCell('-x') === "'-x" && csvCell('@a') === "'@a" &&
    csvCell('\tx') === "'\tx" && csvCell('-5', true) === '-5' && csvCell('plain') === 'plain');
  const byId = new Map(sets.map((x) => [x.summary.assignmentId, x.summary]));
  const cols = ['h1', 'h2', 'h1b', 'odd'];
  const rowOf = (id: string, key: string) => byId.get(id)!.rows.find((x) => x.student.key === key)!;
  const cellsMatch = people.every((p) => cols.every((id, c) => {
    const final = rowOf(id, p.key).grade.final;
    return line(p.key)[4 + c] === (final === null ? '' : String(final));
  }));
  check('every grade cell is the summary row’s grade.final (blank when null)', cellsMatch);
  check('…a missing set past due is 0, one not yet due blank', line('e2')[4] === '0' && line('e2')[5] === '' && line('e1')[5] !== '', line('e2').join('|'));
  const avgOf = (key: string) => countedAverage(cols.map((id) => {
    const sm = byId.get(id)!;
    return { countsTowardGrade: sm.countsTowardGrade, dueDate: sm.dueDate, row: rowOf(id, key) };
  }), NOW).value;
  // e1: HW1 70, HW1 (2) 40, odd 0 (missing) — HW2 (not yet due), HW7 (not counted), HW3 (hidden) out.
  check('average = countedAverage over exactly the columns (not-yet-due, not-counted and hidden sets left out)',
    people.every((p) => line(p.key)[8] === String(avgOf(p.key) ?? '')) && line('e1')[8] === '36.7',
    table.slice(1).map((r) => r[8]).join('|'));
  check('…an extension past now keeps that set out of the student’s average (e3: HW1 extended → only HW1 (2), odd)',
    line('e3')[8] === '0' && line('e3')[4] !== '', line('e3').join('|'));
  const one = buildGradesExport({ assignments: sets, emailOf, now: NOW, only: 'h7' })!;
  const oneTable = parse(one.csv.slice(1));
  check('one assignment: just its column, no average — any set, even one not counted',
    oneTable[0]!.join() === 'UID,name,email,section,HW7' && oneTable.length === 4 && one.filename === 'making-minds-h7-grades-2026-10-09.csv',
    oneTable[0]!.join() + ' ' + one.filename);
  check('…an unknown assignment → null', buildGradesExport({ assignments: sets, emailOf, now: NOW, only: 'nope' }) === null);
  check('labels: "HW1. Basics…" → HW1, "hw 12 x" → HW12, none → the id',
    exportColumnLabel('HW1. Basics: Circuits', 'a') === 'HW1' && exportColumnLabel('hw 12 x', 'a') === 'HW12' && exportColumnLabel('Final', 'fin') === 'fin');
  check('the filename is the course’s date and carries no student data; an odd id is made safe',
    exportFilename(Date.parse('2026-10-10T06:30:00Z')) === 'making-minds-grades-2026-10-09.csv' &&
      exportFilename(Date.parse('2026-10-10T08:00:00Z'), 'a"b/c') === 'making-minds-a_b_c-grades-2026-10-10.csv');
  const src = readFileSync(new URL('../src/storage/gradesExport.ts', import.meta.url), 'utf8');
  check('gradesExport.ts renders the summary: no grader, no scorer, no engine import (no third grade computation)',
    !/engine\/grader|engine\/score|\bscoreRecord\b|\bscoreSubmission\b|^import[^;]*engine\//m.test(src));
}

console.log('[no view grades]');
{
  const dir = new URL('../src/instructor/', import.meta.url);
  const views = readdirSync(dir).filter((f) => /^Grading.*\.tsx$|^Student(Submission|Grading)View\.tsx$|^RegradeDialog\.tsx$|^gradingViews\.ts$|^gradingQueueViews\.ts$/.test(f));
  const offenders = views.filter((f) => /engine\/grader|\bscoreRecord\b|\bscoreSubmission\b/.test(readFileSync(new URL(f, dir), 'utf8')));
  check(`the grading views read the summaries; none imports the grader or a scorer (${views.length} files)`,
    views.length >= 8 && views.includes('RegradeDialog.tsx') && offenders.length === 0, offenders.join(', '));
  check('the retired gradebook is gone (GradebookView.tsx, Gradebook.ts)',
    !existsSync(new URL('GradebookView.tsx', dir)) && !existsSync(new URL('Gradebook.ts', dir)));
}

console.log(failures === 0 ? '\ngradingViewCheck: all checks passed' : `\ngradingViewCheck: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
