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
// [release] the warning; [sort] counting assignments first; [no view grades]
// the grep gate (no view imports the grader or a scorer) and the retired
// gradebook's files are gone.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { AssignmentData, AssignmentQuestion, HumanGrade, Points, QuestionResult, SubmissionData, SubmissionRecord } from '../src/types';
import { answerKey } from '../src/engine/score';
import { homeworkContentHash } from '../src/devData/homeworkSync';
import { buildAssignmentSummary, type CourseAssignmentRow, type GradingIdentity } from '../src/storage/gradingSummary';
import {
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

console.log('[sort]');
const course = (id: string, countsTowardGrade?: boolean): CourseAssignmentRow =>
  ({ id, title: id, visible: true, released: false, progress: summary.progress, ...(countsTowardGrade !== undefined ? { countsTowardGrade } : {}) });
const sorted = sortGradingRows([course('hw7', false), course('hw1'), course('hw2', true), course('x', false)]);
check('counting assignments first, in order; countsTowardGrade: false after', sorted.map((r) => r.id).join() === 'hw1,hw2,hw7,x');
check('a not-counted row is dimmed; absent counts', !isCounted(course('hw7', false)) && isCounted(course('hw1')) && isCounted(course('hw2', true)));

console.log('[no view grades]');
{
  const dir = new URL('../src/instructor/', import.meta.url);
  const views = readdirSync(dir).filter((f) => /^Grading.*\.tsx$|^Student(Submission|Grading)View\.tsx$|^gradingViews\.ts$/.test(f));
  const offenders = views.filter((f) => /engine\/grader|\bscoreRecord\b|\bscoreSubmission\b/.test(readFileSync(new URL(f, dir), 'utf8')));
  check(`the grading views read the summaries; none imports the grader or a scorer (${views.length} files)`,
    views.length >= 5 && offenders.length === 0, offenders.join(', '));
  check('the retired gradebook is gone (GradebookView.tsx, Gradebook.ts)',
    !existsSync(new URL('GradebookView.tsx', dir)) && !existsSync(new URL('Gradebook.ts', dir)));
}

console.log(failures === 0 ? '\ngradingViewCheck: all checks passed' : `\ngradingViewCheck: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
