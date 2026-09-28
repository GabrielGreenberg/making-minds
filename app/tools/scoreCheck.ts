// Headless checks for the ONE grade definition (src/engine/score.ts, task 061;
// design memo docs/buildout/designs/grading-interface.md §4).
//
//   cd app && npx tsx tools/scoreCheck.ts
//
// Covers: the autograde's points (1 / ½ by the `half_credit_at` rule / 0; open
// and case-less → nothing to autograde), precedence (a human grade wins only
// while it judges the answer the latest attempt holds; otherwise "changed",
// with the old grade as a suggestion), 40 + 60·P and its rounding, pending =
// 0 earned + provisional, Missing, and the late math over a fixture calendar
// (a meeting passes when it ENDS; a holiday week; an in-class exam meeting;
// per-day; the floor at 0; waivers). Task 068, [real calendar]: the same
// math over the COMMITTED course calendar (src/courseCalendar.ts) and the
// homeworks' real due dates and policies, through lateContext.ts dueInput.

import type { AssignmentQuestion, QuestionResult, SubmissionData } from '../src/types';
import {
  answerKey,
  autoPoints,
  formatGrade,
  gradesFromLegacyReviews,
  halfCreditProblem,
  lateDeduction,
  questionCaseCount,
  scoreSubmission,
  type CourseCalendar,
  type HumanGrade,
} from '../src/engine/score';
import { gradeSubmission } from '../src/engine/grader';
import { readFileSync } from 'node:fs';
import type { AssignmentData } from '../src/types';
import { COURSE_CALENDAR } from '../src/courseCalendar';
import { dueInput } from '../src/lateContext';
import { validateDocument } from '../src/problemSet';
import { buildSampleAssignment, buildCorrectSubmission, buildIncorrectSubmission } from '../src/devData/sampleData';

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

const asg = buildSampleAssignment();
const Q = (id: number) => asg.questions.find((q) => q.id === id)!;
const OPEN = 14;
const qr = (over: Partial<QuestionResult>): QuestionResult =>
  ({ questionId: 1, status: 'graded', passed: 0, total: 0, cases: [], ...over }) as QuestionResult;
const withHalf = (q: AssignmentQuestion, k: number | undefined): AssignmentQuestion => ({ ...q, half_credit_at: k });

// ─── [autoPoints] ─────────────────────────────────────────────────────────
console.log('[autoPoints]');
{
  const q = Q(1);
  check('every case passes → 1', autoPoints(q, qr({ passed: 16, total: 16 })) === 1);
  check('a case fails, no rule → 0', autoPoints(q, qr({ passed: 15, total: 16 })) === 0);
  check('the ½ rule met (≥ K of N) → ½', autoPoints(withHalf(q, 12), qr({ passed: 12, total: 16 })) === 0.5);
  check('…one short of K → 0', autoPoints(withHalf(q, 12), qr({ passed: 11, total: 16 })) === 0);
  check('"½ for 1 of 2 arenas"', autoPoints(withHalf(Q(5), 1), qr({ passed: 1, total: 2 })) === 0.5);
  check('a nonsense rule (K ≥ N, K < 1, not an integer) never gives ½',
    [2, 0, -1, 1.5].every((k) => autoPoints(withHalf(q, k), qr({ passed: 1, total: 2 })) === 0));
  check('skipped (the question had nothing to grade against) → nothing; a person decides', autoPoints(q, qr({ status: 'skipped' })) === null);
  check('an open problem has nothing to autograde', autoPoints(Q(OPEN), qr({ status: 'pending' })) === null);
  check('a result with no cases has nothing to autograde', autoPoints(q, qr({ total: 0 })) === null);
  check('no result at all (a problem added after grading) → nothing', autoPoints(q, undefined) === null);
  // A machine refused before any case runs passes none, so no ½ rule reaches it.
  const empty: SubmissionData = { assignmentTitle: asg.title, submittedAt: '2026-10-01T00:00:00Z',
    answers: asg.questions.map((x) => ({ questionId: x.id, circuit: { components: [], wires: [] } })) };
  const refused = gradeSubmission(asg, empty).questions.find((r) => r.questionId === 1)!;
  check('a machine refused at Stage 1 passes no case, so a ½ rule gives it 0',
    refused.passed === 0 && autoPoints(withHalf(Q(1), 1), refused) === 0, JSON.stringify({ s: refused.status, p: refused.passed, t: refused.total }));
}

// ─── [precedence] ─────────────────────────────────────────────────────────
console.log('[precedence]');
const NOW = Date.parse('2026-10-20T00:00:00Z');
const correct = buildCorrectSubmission('pat@example.com');
const correctResult = gradeSubmission(asg, correct);
const latest = (submission: SubmissionData, result = gradeSubmission(asg, submission)) =>
  ({ submission, submittedAt: submission.submittedAt, result });
{
  const s = scoreSubmission({ questions: asg.questions, latest: latest(correct, correctResult), now: NOW });
  const n = asg.questions.length;
  check('all machines right, the open problem unreviewed: pending → 0 earned, provisional',
    s.earned === n - 1 && s.provisional && s.problems.find((p) => p.questionId === OPEN)?.source === 'pending');
  check('raw = 40 + 60·P, rounded to 0.1', s.raw === Math.round((40 + 60 * (n - 1) / n) * 10) / 10 && s.final === s.raw);

  const reviewed = { ...correctResult, questions: correctResult.questions.map((r) =>
    r.questionId === OPEN ? { ...r, manual: { pass: true, note: 'Nice.', reviewedAt: '2026-10-19T10:00:00Z' } } : r) };
  const hand = gradesFromLegacyReviews(asg.questions, correct, reviewed);
  check("today's ✓ review reads as a 1-point human grade on this attempt's answer",
    hand.length === 1 && hand[0].points === 1 && hand[0].answerKey === answerKey(Q(OPEN), correct.answers.find((a) => a.questionId === OPEN)));
  const full = scoreSubmission({ questions: asg.questions, latest: latest(correct, reviewed), grades: hand, now: NOW });
  check('…so the problem set scores 100, not provisional', full.final === 100 && !full.provisional);
  check('…and its note reaches the problem', full.problems.find((p) => p.questionId === OPEN)?.note === 'Nice.');

  const changed: SubmissionData = { ...correct, answers: correct.answers.map((a) =>
    a.questionId === OPEN ? { ...a, responseText: 'A different answer altogether.' } : a) };
  const c = scoreSubmission({ questions: asg.questions, latest: latest(changed), grades: hand, now: NOW });
  const cp = c.problems.find((p) => p.questionId === OPEN)!;
  check('the student changed the answer: "changed", 0 earned, provisional, the old grade as a suggestion',
    cp.source === 'changed' && cp.points === null && c.provisional && cp.suggestion?.points === 1);
  const respaced: SubmissionData = { ...correct, answers: correct.answers.map((a) =>
    a.questionId === OPEN ? { ...a, responseText: `  ${a.responseText!.replace(/ /g, '  ')}\n` } : a) };
  check('…but whitespace alone is the same answer (the grade holds)',
    scoreSubmission({ questions: asg.questions, latest: latest(respaced), grades: hand, now: NOW })
      .problems.find((p) => p.questionId === OPEN)?.source === 'human');

  const override: HumanGrade = { questionId: 1, points: 0.5, note: 'Half.', answerKey: answerKey(Q(1), correct.answers[0]), gradedAt: 'x' };
  const o = scoreSubmission({ questions: asg.questions, latest: latest(correct, correctResult), grades: [override], now: NOW });
  const op = o.problems.find((p) => p.questionId === 1)!;
  check('an override wins over the autograde, which stays visible beside it',
    op.source === 'human' && op.points === 0.5 && op.autoPoints === 1);
  const moved = { ...correct, answers: correct.answers.map((a) => a.questionId === 1
    ? { ...a, circuit: { ...a.circuit, components: a.circuit.components.map((k) => ({ ...k, x: k.x + 40, y: k.y + 7 })) } } : a) };
  check('…and moving parts around is the same machine (the override holds)',
    scoreSubmission({ questions: asg.questions, latest: latest(moved), grades: [override], now: NOW })
      .problems.find((p) => p.questionId === 1)?.source === 'human');

  const wrong = buildIncorrectSubmission('pat@example.com');
  const w = scoreSubmission({ questions: asg.questions, latest: latest(wrong), now: NOW });
  check('everything wrong and the open answer blank: 40 + 0 (floor of the scale), provisional',
    w.earned === 0 && w.raw === 40 && w.provisional);
  const halves = asg.questions.map((q) => (q.buildMode === 'turbot' ? withHalf(q, 1) : q));
  const hr = gradeSubmission(asg, wrong);
  const oneArena = { ...hr, questions: hr.questions.map((r) =>
    Q(r.questionId).buildMode === 'turbot' ? { ...r, passed: 1, total: 2 } : r) };
  const h = scoreSubmission({ questions: halves, latest: latest(wrong, oneArena), now: NOW });
  check('four turbots at 1 of 2 arenas with a "½ at 1" rule earn 2 points, marked auto-half',
    h.earned === 2 && h.problems.filter((p) => p.source === 'auto-half').length === 4);
}

// ─── [missing] ────────────────────────────────────────────────────────────
console.log('[missing]');
{
  const past = scoreSubmission({ questions: asg.questions, latest: null, due: { at: '2026-10-05T06:59:00Z' }, now: NOW });
  check('no submission, past due → Missing, final 0', past.missing && past.final === 0);
  const ahead = scoreSubmission({ questions: asg.questions, latest: null, due: { at: '2026-11-05T06:59:00Z' }, now: NOW });
  check('no submission, not yet due → no grade', !ahead.missing && ahead.final === null);
  const unreleased = scoreSubmission({ questions: asg.questions,
    latest: { submission: correct, submittedAt: correct.submittedAt }, now: NOW });
  check("a student's copy before release (no result) → no grade", unreleased.final === null && !unreleased.missing);
}

// ─── [late] ───────────────────────────────────────────────────────────────
console.log('[late]');
// Tue/Thu 12:30–13:45 Pacific (UTC−7 until Nov 1, UTC−8 after). The Oct 29
// meeting is the in-class midterm; there is no Nov 26 meeting (Thanksgiving).
const meet = (date: string, off: string) => ({ start: `${date}T12:30:00${off}`, end: `${date}T13:45:00${off}` });
const CAL: CourseCalendar = { meetings: [
  meet('2026-10-20', '-07:00'), meet('2026-10-22', '-07:00'), meet('2026-10-27', '-07:00'), meet('2026-10-29', '-07:00'),
  meet('2026-11-24', '-08:00'), meet('2026-12-01', '-08:00'), meet('2026-12-03', '-08:00'),
] };
const HW2_DUE = '2026-10-18T23:59:00-07:00';
const at = (iso: string) => lateDeduction(iso, HW2_DUE, 'per-meeting', CAL);
check('on time, even at the due minute → none', !at(HW2_DUE).late && at('2026-10-18T20:00:00-07:00').deduction === 0);
check('Monday → −5 (late, no meeting has passed)', at('2026-10-19T09:00:00-07:00').deduction === 5);
check('Tuesday DURING lecture → still −5 (a meeting passes when it ends)', at('2026-10-20T13:00:00-07:00').deduction === 5);
check('Tuesday after lecture → −10', at('2026-10-20T14:00:00-07:00').deduction === 10 && at('2026-10-20T14:00:00-07:00').units === 1);
check('the next Friday → −15 (Tue + Thu)', at('2026-10-23T09:00:00-07:00').deduction === 15);
check('the in-class midterm counts as a meeting', at('2026-10-30T09:00:00-07:00').units === 4);
const HW5_DUE = '2026-11-22T23:59:00-08:00';
check('Thanksgiving week: only Tuesday passes (no Thursday meeting)',
  lateDeduction('2026-11-30T09:00:00-08:00', HW5_DUE, 'per-meeting', CAL).units === 1);
check('no calendar → late, but no meetings counted', lateDeduction('2026-10-23T09:00:00-07:00', HW2_DUE, 'per-meeting', undefined).deduction === 5);
const HW6_DUE = '2026-12-04T23:59:00-08:00';
check('per-day: the next morning → −5', lateDeduction('2026-12-05T10:00:00-08:00', HW6_DUE, 'per-day', CAL).deduction === 5);
check('per-day: a full day and more → −10', lateDeduction('2026-12-06T10:00:00-08:00', HW6_DUE, 'per-day', CAL).deduction === 10);
{
  const lateSub = { ...correct, submittedAt: '2026-10-23T09:00:00-07:00' };
  const graded = gradeSubmission(asg, lateSub);
  const base = { questions: asg.questions, latest: latest(lateSub, graded), now: NOW };
  const plain = scoreSubmission(base);
  const docked = scoreSubmission({ ...base, due: { at: HW2_DUE, late: { policy: 'per-meeting', calendar: CAL } } });
  check('the deduction comes off the scaled grade', docked.late?.deduction === 15 && docked.final === Math.round((plain.raw! - 15) * 10) / 10);
  check('no late input → no deduction computed (no calendar given)', plain.late === null && plain.final === plain.raw);
  const waived = scoreSubmission({ ...base, due: { at: HW2_DUE, late: { policy: 'per-meeting', calendar: CAL, waived: 5 } } });
  check('a waiver reduces it', waived.late?.waived === 5 && waived.final === Math.round((plain.raw! - 10) * 10) / 10);
  const over = scoreSubmission({ ...base, due: { at: HW2_DUE, late: { policy: 'per-meeting', calendar: CAL, waived: 99 } } });
  check('…never below none', over.late?.waived === 15 && over.final === plain.raw);
  const wrongLate = { ...buildIncorrectSubmission('pat@example.com'), submittedAt: '2026-12-01T20:00:00-08:00' };
  const floor = scoreSubmission({ questions: asg.questions, latest: latest(wrongLate), now: NOW,
    due: { at: HW2_DUE, late: { policy: 'per-day', calendar: CAL } } });
  check('it may carry the grade below 40, never below 0', floor.raw === 40 && floor.late!.deduction > 40 && floor.final === 0);
}

// ─── [real calendar] ──────────────────────────────────────────────────────
console.log('[real calendar]');
{
  const hw = (n: number) =>
    JSON.parse(readFileSync(new URL(`../src/devData/homeworks/hw${n}.json`, import.meta.url), 'utf8')) as AssignmentData;
  const [hw1, hw2, hw3, hw4, hw5, hw6] = [hw(1), hw(2), hw(3), hw(4), hw(5), hw(6)];
  /** The deduction for `a` submitted at `iso`, through the one due helper. */
  const cost = (a: AssignmentData, iso: string, student: Parameters<typeof dueInput>[1] = {}) => {
    const due = dueInput(a, student, COURSE_CALENDAR)!;
    return lateDeduction(iso, due.at, due.late!.policy, due.late!.calendar);
  };
  check('the homeworks\' due dates are the ones pinned here',
    hw1.dueDate === '2026-10-05T06:59:00.000Z' && hw2.dueDate === '2026-10-19T06:59:00.000Z' &&
      hw3.dueDate === '2026-10-26T06:59:00.000Z' && hw4.dueDate === '2026-11-09T07:59:00.000Z' && hw5.dueDate === '2026-11-23T07:59:00.000Z' && hw6.dueDate === '2026-12-05T07:59:00.000Z' && hw6.latePolicy === 'per-day');
  check('HW1 (due Sun Oct 4, 23:59) submitted Tue Oct 6, 10:00 → no meeting ended yet → −5',
    cost(hw1, '2026-10-06T10:00:00-07:00').units === 0 && cost(hw1, '2026-10-06T10:00:00-07:00').deduction === 5);
  check('…DURING the Oct 6 lecture → still −5 (a meeting counts once it has ended)', cost(hw1, '2026-10-06T13:00:00-07:00').deduction === 5);
  check('…Oct 6, 14:00, after the lecture ended → −10', cost(hw1, '2026-10-06T14:00:00-07:00').deduction === 10);
  const laLocal = (iso: string) => new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  check('every HW1–HW6 due date is a Sunday 23:59 in Los Angeles (HW4 on: past the Nov 1 DST change, 07:59Z)',
    [hw1, hw2, hw3, hw4, hw5].every((a) => laLocal(a.dueDate!) === 'Sun 23:59'),
    [hw1, hw2, hw3, hw4, hw5].map((a) => laLocal(a.dueDate!)).join(', '));
  check('HW2 (due Sun Oct 18) submitted Tue Oct 20, 14:00 → the Oct 20 lecture ended → −10',
    cost(hw2, '2026-10-20T14:00:00-07:00').units === 1 && cost(hw2, '2026-10-20T14:00:00-07:00').deduction === 10);
  check('HW2 submitted a minute after its due time → −5', cost(hw2, '2026-10-19T00:00:00-07:00').deduction === 5 &&
    cost(hw2, '2026-10-18T23:59:00-07:00').deduction === 0);
  check('HW4 (due Sun Nov 8, 23:59 PST) submitted Nov 8, 23:30 PST → on time (the standard-time offset holds)',
    cost(hw4, '2026-11-08T23:30:00-08:00').deduction === 0);
  check('HW4 submitted Mon Nov 9, 00:30 PST → −5; Thu Nov 12, 14:00 → Nov 10 + Nov 12 → −15',
    cost(hw4, '2026-11-09T00:30:00-08:00').deduction === 5 && cost(hw4, '2026-11-12T14:00:00-08:00').deduction === 15);
  check('HW3 submitted Oct 29, 14:00 → Oct 27 + the in-class midterm → −15', cost(hw3, '2026-10-29T14:00:00-07:00').deduction === 15);
  check('HW5 (due Nov 22) submitted Nov 30 → only Nov 24 (Thanksgiving has no meeting) → −10',
    cost(hw5, '2026-11-30T09:00:00-08:00').deduction === 10);
  check('HW5 submitted Dec 10 → Nov 24, Dec 1, Dec 3 — the Dec 9 final is no meeting → −20',
    cost(hw5, '2026-12-10T09:00:00-08:00').units === 3 && cost(hw5, '2026-12-10T09:00:00-08:00').deduction === 20);
  check('HW6 is per day (its JSON\'s latePolicy): Dec 6, 10:00 → a full day → −10', cost(hw6, '2026-12-06T10:00:00-08:00').deduction === 10);
  const lateSub = { ...correct, submittedAt: '2026-12-06T10:00:00-08:00' };
  const base = { questions: asg.questions, latest: latest(lateSub, gradeSubmission(asg, lateSub)), now: NOW };
  const raw = scoreSubmission(base).raw!;
  const netted = scoreSubmission({ ...base, due: dueInput(hw6, { waived: 5 }, COURSE_CALENDAR) });
  check('a waiver of 5 nets −10 to −5', netted.late?.deduction === 10 && netted.late.waived === 5 && netted.final === Math.round((raw - 5) * 10) / 10);
  const extended = scoreSubmission({ ...base, due: dueInput(hw6, { extension: { dueDate: '2026-12-07T07:59:00.000Z' } }, COURSE_CALENDAR) });
  check('an extension moves lateness: on time against the extension', extended.late?.late === false && extended.final === raw);
  const uncalendared = scoreSubmission({ ...base, due: dueInput(hw6, {}) });
  check('no calendar → no deduction computed (never a silent −5)', uncalendared.late === null && uncalendared.final === raw);
  check('no due date → no due input at all', dueInput({}, {}, COURSE_CALENDAR) === undefined);
  const wrongLate = { ...buildIncorrectSubmission('pat@example.com'), submittedAt: '2026-12-10T09:00:00-08:00' };
  const floor = scoreSubmission({ questions: asg.questions, latest: latest(wrongLate), now: NOW, due: dueInput(hw1, {}, COURSE_CALENDAR) });
  check('the floor at 0 holds over the real calendar', floor.late!.deduction > floor.raw! && floor.final === 0, JSON.stringify(floor.late));
}

// ─── [authoring the ½ rule] ───────────────────────────────────────────────
console.log('[authoring the ½ rule]');
{
  const vq = Q(1); // a value question: N is its bank
  const n = questionCaseCount(vq);
  check('N is the question\'s own cases (a value question\'s bank; a turbot\'s arenas)',
    n === (vq.test_cases?.length ?? -1) && n > 1 && questionCaseCount(Q(5)) === Q(5).turbot_cases?.length &&
    questionCaseCount(Q(OPEN)) === 0);
  check('absent, or 1 ≤ K < N, is sound', halfCreditProblem(vq) === null && halfCreditProblem(withHalf(vq, n - 1)) === null);
  check('K = N (all of them) is refused', /fewer than all/.test(halfCreditProblem(withHalf(vq, n)) ?? ''));
  check('K = 0, negative or fractional is refused',
    [0, -2, 1.5].every((k) => /whole number/.test(halfCreditProblem(withHalf(vq, k)) ?? '')));
  check('an open problem cannot carry one', /open problem/.test(halfCreditProblem(withHalf(Q(OPEN), 1)) ?? ''));
  const doc = { ...asg, questions: asg.questions.map((q) => (q.id === 1 ? withHalf(q, n) : q)) };
  check('validateDocument reports a bad rule by the problem\'s label',
    validateDocument(doc).some((p) => p.startsWith(`${Q(1).label}: `) && /½ rule/.test(p)) &&
    validateDocument(asg).every((p) => !/½ rule/.test(p)));

  // A fill-in table (task 079): N is its KEY rows — the cases it is graded
  // on — never its 27 cells, its 3 columns or the rows students see.
  const hw1 = JSON.parse(readFileSync(new URL('../src/devData/homeworks/hw1.json', import.meta.url), 'utf8')) as AssignmentData;
  const p9b = hw1.questions.find((q) => q.id === 20)!;
  const p14 = hw1.questions.find((q) => q.id === 14)!;
  const tallerP14 = { ...p14, fill_in: { ...p14.fill_in!, table: { ...p14.fill_in!.table!, rows: 5 } } };
  check('a fill-in table\'s N is its key rows: 9 for HW1 P9b, 2 for P14 (even shown 5 rows)',
    questionCaseCount(p9b) === 9 && questionCaseCount(p14) === 2 && questionCaseCount(tallerP14) === 2);
  check('...so ½ at 9 of 9 is refused and 8 is sound',
    /fewer than all/.test(halfCreditProblem(withHalf(p9b, 9)) ?? '') && halfCreditProblem(withHalf(p9b, 8)) === null);
  const j = (x: number, y: number) => [String(x), String(y), String(x * y)];
  const eightRight = [...[0, 1, 2].flatMap((x) => [0, 1, 2].map((y) => j(x, y))).slice(0, 8).flat(), '', '', ''];
  const graded = gradeSubmission(hw1, { assignmentTitle: hw1.title, submittedAt: '2026-10-01T00:00:00Z',
    answers: [{ questionId: 20, circuit: { components: [], wires: [] }, fillAnswers: eightRight }] })
    .questions.find((r) => r.questionId === 20)!;
  check('P9b graded 8/9 with half_credit_at 5 → autoPoints ½',
    graded.passed === 8 && graded.total === 9 && autoPoints(withHalf(p9b, 5), graded) === 0.5,
    JSON.stringify({ p: graded.passed, t: graded.total }));
}

// ─── [display] ────────────────────────────────────────────────────────────
console.log('[display]');
check('formatGrade: one decimal only when there is one', formatGrade(82.5) === '82.5' && formatGrade(100) === '100' && formatGrade(40) === '40');
{
  const P = 13.5 / 17;
  check('13.5 of 17 points → 87.6 (the memo\'s worked example)', Math.round((40 + 60 * P) * 10) / 10 === 87.6);
}

console.log(failures === 0 ? '\nscoreCheck: all checks passed' : `\nscoreCheck: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
