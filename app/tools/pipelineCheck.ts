// Headless end-to-end check of the autograding pipeline for CC, SC, FSM, TM,
// turbot, perception, open, and fill-in-the-blank questions, plus the pure
// display policies both sides read a result through.
//
//   npx tsx tools/pipelineCheck.ts
//
// Builds the sample assignment and grades a known-correct and a known-incorrect
// submission per mode, asserting the correct one scores 100% and the incorrect
// one scores below 100%. This validates the grader + the per-mode codec
// adapters against real circuits, independent of the browser/UI. The open
// question is asserted to come back `pending` (not autogradeable) with the
// student's response attached for manual review.
//
//   [fill-in authoring]  (task 005) the question creator's fill-in blanks:
//                        drafts → saved fields round-trip HW1 P11 exactly,
//                        the canonical per-blank digits-only flag, reorder
//                        moves label + answer + flag together, which saved
//                        blanks an edit strips of students' answers (they
//                        are stored by position), the defects
//                        that block a save, the student copy stripped
//                        (server/src/sanitize.ts — no answer rides inside
//                        `fill_in`), submit → graded, the questionTask
//                        classifier, and a grep pin: one reader and one
//                        writer of `numericOnly`.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AssignmentData, AssignmentQuestion, QuestionResult, SubmissionRecord } from '../src/types';
import { QUESTION_TASKS, questionModeLabel, questionTask } from '../src/types';
import {
  buildSampleAssignment,
  buildCorrectSubmission,
  buildIncorrectSubmission,
  scCorrect,
} from '../src/devData/sampleData';
import { boxWhole } from './builder';
import { gradeQuestion, gradeSubmission, summarizeResult } from '../src/engine/grader';
import { applyManualReview, buildSubmission } from '../src/storage/submissionStore';
import { emptyQuestionCircuit } from '../src/storage/workbookStore';
import { gradeSubmissions } from '../src/instructor/Gradebook';
import { questionVerdict } from '../src/gradeDisplay';
import { fillInBlanks } from '../src/engine/fillIn';
import {
  blankDraftsOf,
  fillInFields,
  fillInProblems,
  misplacedAnswersWarning,
  misplacedBlanks,
  newBlankDraft,
  type FillInBlankDraft,
} from '../src/instructor/fillInAuthoring';
import { moveItem } from '../src/instructor/dragReorder';
import { canonicalJson } from '../src/devData/homeworkSync';
import { stripAnswers } from '../../server/src/sanitize';

const NOW_ISO = '2026-09-10T00:00:00.000Z';

const assignment = buildSampleAssignment();

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}

console.log('Assignment:', assignment.title);
for (const q of assignment.questions) {
  if (q.buildMode === 'open') {
    console.log(`  ${q.label}: open question (manual review)`);
    continue;
  }
  const n = q.buildMode === 'turbot' ? q.turbot_cases?.length
    : q.perception ? q.perception_cases?.length
    : q.test_cases?.length;
  const unit = q.buildMode === 'turbot' ? 'arenas' : q.perception ? 'perception cases' : 'test cases';
  console.log(`  ${q.label}: ${n ?? 0} ${unit}`);
}

console.log('\n[correct submission]');
const correct = gradeSubmission(assignment, buildCorrectSubmission());
for (const q of correct.questions) {
  const def = assignment.questions.find((x) => x.id === q.questionId);
  console.log(`  ${def?.label}: ${q.status} ${q.passed}/${q.total}`);
  if (def?.buildMode === 'open') {
    check(`${def.label} is pending with the response attached`,
      q.status === 'pending' && q.total === 0 && (q.response ?? '').length > 0);
  } else {
    check(`${def?.label} all vectors pass`, q.status === 'graded' && q.total > 0 && q.passed === q.total);
  }
}
const cs = summarizeResult(correct);
check('correct: 13/13 autograded questions', cs.questionsPassed === 13 && cs.questionsTotal === 13);

console.log('\n[incorrect submission]');
const wrong = gradeSubmission(assignment, buildIncorrectSubmission());
for (const q of wrong.questions) {
  const def = assignment.questions.find((x) => x.id === q.questionId);
  console.log(`  ${def?.label}: ${q.status} ${q.passed}/${q.total}`);
  if (def?.buildMode === 'open') {
    check(`${def.label} is pending with an empty response`,
      q.status === 'pending' && q.response === '');
  } else {
    check(`${def?.label} fails at least one vector`, q.status === 'graded' && q.passed < q.total);
  }
}
const ws = summarizeResult(wrong);
check('incorrect: 0/13 autograded questions', ws.questionsPassed === 0 && ws.questionsTotal === 13);

// A sequential sub-circuit boxed (task 004): the SC answer with its whole
// circuit — MEM included — inside one placed box grades exactly as unboxed,
// through the same submit path.
console.log('\n[boxed SC answer]');
{
  const boxedSub = buildCorrectSubmission('boxed@example.com');
  boxedSub.answers = boxedSub.answers.map((a) =>
    a.questionId === 2 ? { ...a, circuit: boxWhole(scCorrect()) } : a);
  const boxedResult = gradeSubmission(assignment, boxedSub);
  const boxedQ = boxedResult.questions.find((q) => q.questionId === 2)!;
  const plainQ = correct.questions.find((q) => q.questionId === 2)!;
  check(`the SC answer boxed whole grades 100% (${boxedQ.passed}/${boxedQ.total})`,
    boxedQ.status === 'graded' && boxedQ.total > 0 && boxedQ.passed === boxedQ.total);
  check('...its per-case results equal the unboxed grade',
    JSON.stringify(boxedQ) === JSON.stringify(plainQ));
}

// Manual review of the pending open question (the instructor grading seam):
// the verdict lands on the stored record's result and the gradebook then
// counts the question like any other.
console.log('\n[manual review]');
const openQ = assignment.questions.find((q) => q.buildMode === 'open')!;
const machineQ = assignment.questions.find((q) => q.buildMode !== 'open')!;
const review = { pass: true, note: 'well argued', reviewedAt: '2026-07-07T00:00:00.000Z' };
const records: SubmissionRecord[] = [
  {
    assignmentId: 'sample',
    attempt: 1,
    submittedAt: '2026-07-07T00:00:00.000Z',
    submission: buildCorrectSubmission(),
    result: correct,
  },
];
const reviewed = applyManualReview(records, 1, openQ.id, review);
const reviewedQ = reviewed?.[0].result?.questions.find((q) => q.questionId === openQ.id);
check('review lands on the pending question', reviewedQ?.manual?.pass === true);
check('reviewed result stays pending (annotated, not replaced)', reviewedQ?.status === 'pending');
check('original records are not mutated',
  records[0].result!.questions.find((q) => q.questionId === openQ.id)!.manual === undefined);
check('review of a non-pending question is rejected',
  applyManualReview(records, 1, machineQ.id, review) === null);
check('review of a missing attempt is rejected',
  applyManualReview(records, 2, openQ.id, review) === null);
if (reviewed) {
  const [before] = gradeSubmissions(assignment, records);
  const [after] = gradeSubmissions(assignment, reviewed);
  const qg = after.grades.find((g) => g.questionId === openQ.id);
  check('gradebook counts the reviewed question as passed',
    qg?.pending === false && qg?.passed === true);
  check('score now includes the reviewed open question',
    before.score === 1 && after.score === 1 &&
    after.grades.filter((g) => !g.pending).length ===
      before.grades.filter((g) => !g.pending).length + 1);
}

// ── Fill-in-the-blank questions (HW1 P11) ──────────────────────────
// An open question with a `fill_in` spec IS autogradable: string answers,
// leading zeros normalised away, no machine to run (engine/fillIn.ts).
console.log('\n[fill-in blanks]');
{
  const hw1 = JSON.parse(
    readFileSync(new URL('../src/devData/homeworks/hw1.json', import.meta.url), 'utf8'),
  ) as AssignmentData;
  const q = hw1.questions.find((x) => x.id === 11)!;
  check('HW1 P11 carries a fill-in spec and a same-length answer key',
    !!q.fill_in && q.fill_in.labels.length === 11 &&
    q.fill_in_answers?.length === 11);
  check('the boxes are labelled 0 through 10',
    q.fill_in!.labels.join(',') === '0,1,2,3,4,5,6,7,8,9,10');

  const correct = Array.from({ length: 11 }, (_, n) => n.toString(2));
  const graded = gradeQuestion(q, undefined, undefined, correct);
  check('correct binary numerals score 11/11',
    graded.status === 'graded' && graded.passed === 11 && graded.total === 11);
  check('leading zeros are ignored ("0011" === "11")',
    gradeQuestion(q, undefined, undefined, correct.map((a) => '00' + a)).passed === 11);
  check('surrounding whitespace is ignored',
    gradeQuestion(q, undefined, undefined, correct.map((a) => ` ${a} `)).passed === 11);
  check('"000" still reads as zero, not as blank',
    (gradeQuestion(q, undefined, undefined, ['000', ...correct.slice(1)]).fillCases ?? [])[0]?.pass === true);

  const oneWrong = gradeQuestion(q, undefined, undefined, correct.map((a, i) => (i === 4 ? '1000' : a)));
  check('one wrong numeral scores 10/11 and names the blank',
    oneWrong.passed === 10 &&
    (oneWrong.fillCases ?? []).filter((c) => !c.pass).map((c) => c.label).join('') === '4');

  const blank = gradeQuestion(q, undefined, undefined, []);
  check('no answers at all fails every blank (never "pending")',
    blank.status === 'graded' && blank.passed === 0 && blank.total === 11);
  check('a blank box is a failure, not a match against the empty string',
    (blank.fillCases ?? []).every((c) => !c.pass && c.got === ''));

  // Through the whole submit path, exactly as a student's Submit does.
  const circuits = new Map<number, ReturnType<typeof emptyQuestionCircuit>>();
  circuits.set(11, { ...emptyQuestionCircuit(), fillAnswers: correct });
  const built = buildSubmission(hw1, circuits, {
    student: 'fill@example.com',
    submittedAt: NOW_ISO,
  });
  const answer = built.answers.find((a) => a.questionId === 11);
  check('buildSubmission carries the blanks, not a responseText',
    answer?.fillAnswers?.length === 11 && answer.responseText === undefined);
  const wholeHw = gradeSubmission(hw1, built);
  check('the fill-in question grades 11/11 through gradeSubmission',
    wholeHw.questions.find((r) => r.questionId === 11)?.passed === 11);
}

// ── Authoring a fill-in question (task 005) ────────────────────────
// The creator's blanks are drafts (instructor/fillInAuthoring.ts) saved as
// `fill_in` + `fill_in_answers`; the server strips the answers for students
// and keeps the spec whole, so nothing that is a key may live in the spec.
console.log('\n[fill-in authoring]');
{
  const readHw = (n: number) => JSON.parse(
    readFileSync(new URL(`../src/devData/homeworks/hw${n}.json`, import.meta.url), 'utf8'),
  ) as AssignmentData;
  const hw1 = readHw(1);
  const p11 = hw1.questions.find((x) => x.id === 11)!;

  // (1) A no-op creator edit reproduces the hand-written question exactly —
  // canonicalJson is the homework sync's own comparison, so P11 stays pristine.
  const p11Drafts = blankDraftsOf(p11);
  check('HW1 P11 loads as 11 drafts, each with its answer and the digits-only flag',
    p11Drafts.length === 11 && p11Drafts.every((d, i) =>
      d.label === String(i) && d.answer === p11.fill_in_answers![i] && d.digitsOnly));
  check('drafts → fields round-trips HW1 P11 byte-for-byte (canonicalJson)',
    canonicalJson(fillInFields(p11Drafts)) ===
      canonicalJson({ fill_in: p11.fill_in, fill_in_answers: p11.fill_in_answers }));
  check('...and keeps P11 in its `numericOnly: true` form',
    fillInFields(p11Drafts).fill_in.numericOnly === true);
  const added = newBlankDraft(p11Drafts);
  check('a new blank after 0–10 is labelled "11" and inherits digits-only',
    added.label === '11' && added.digitsOnly && added.answer === '' &&
      !p11Drafts.some((d) => d.key === added.key));
  check('a question without a spec (new, or free response) has no drafts',
    blankDraftsOf(undefined).length === 0 &&
      blankDraftsOf(hw1.questions.find((x) => x.id === 10)).length === 0);

  // An authored question with a MIX of digits-only and free-text blanks.
  const draft = (label: string, digitsOnly: boolean, answer: string): FillInBlankDraft =>
    ({ ...newBlankDraft([]), label, digitsOnly, answer });
  const drafts = [
    draft(' seven in binary ', true, ' 111 '),
    draft('the capital of France', false, 'Paris'),
    draft('four in binary', true, '100'),
  ];
  const fields = fillInFields(drafts);

  // (2) numericOnly: all → true, none → absent, mixed → one flag per blank.
  check('mixed blanks save one flag per blank [true, false, true]',
    JSON.stringify(fields.fill_in.numericOnly) === '[true,false,true]');
  check('...read back per blank by fillInBlanks',
    fillInBlanks(fields.fill_in).map((b) => b.digitsOnly).join() === 'true,false,true');
  check('all digits-only saves `numericOnly: true`',
    fillInFields(drafts.map((d) => ({ ...d, digitsOnly: true }))).fill_in.numericOnly === true);
  check('no digits-only blank omits the key',
    !('numericOnly' in fillInFields(drafts.map((d) => ({ ...d, digitsOnly: false }))).fill_in));
  check('labels and answers are saved trimmed, parallel, in row order',
    fields.fill_in.labels.join('|') === 'seven in binary|the capital of France|four in binary' &&
      fields.fill_in_answers.join('|') === '111|Paris|100');
  check('a lone array entry that is not true reads as a free-text blank',
    fillInBlanks({ labels: ['a', 'b'], numericOnly: [true] }).map((b) => b.digitsOnly).join() === 'true,false');

  // (3) Reordering moves a whole row: label, answer and flag stay together.
  const moved = fillInFields(moveItem(drafts, 0, 2));
  check('moving blank #1 to the end moves its label, answer and flag together',
    moved.fill_in.labels.join('|') === 'the capital of France|four in binary|seven in binary' &&
      moved.fill_in_answers.join('|') === 'Paris|100|111' &&
      JSON.stringify(moved.fill_in.numericOnly) === '[false,true,true]');

  // (3b) Students' answers are stored by position, so the creator warns (and
  // confirms at save) exactly when a saved blank loses its slot.
  const labelsOf = (ls: string[]) => ls.join('|');
  const edited = p11Drafts.map((d, i) =>
    i === 4 ? { ...d, label: 'four', answer: '0100', digitsOnly: false } : d);
  check('relabelling a saved blank, or changing its answer or flag, misplaces nothing',
    misplacedBlanks(p11Drafts, edited).length === 0);
  check('appending blanks misplaces nothing',
    misplacedBlanks(p11Drafts, [...p11Drafts, newBlankDraft(p11Drafts)]).length === 0);
  check('removing blank "3" misplaces the answers to "3" and every blank after it',
    labelsOf(misplacedBlanks(p11Drafts, p11Drafts.filter((_, i) => i !== 3))) ===
      '3|4|5|6|7|8|9|10');
  check('swapping two blanks misplaces exactly those two',
    labelsOf(misplacedBlanks(p11Drafts, moveItem(p11Drafts, 0, 1))) === '0|1');
  check('inserting a new blank first misplaces every saved one',
    misplacedBlanks(p11Drafts, [newBlankDraft(p11Drafts), ...p11Drafts]).length === 11);
  check('saving no blanks (the question stops being fill-in) misplaces every saved one',
    misplacedBlanks(p11Drafts, []).length === 11);
  check('a new question has no saved blanks to misplace',
    misplacedBlanks([], [newBlankDraft([])]).length === 0);
  const warning = misplacedAnswersWarning(['3', '4', '5', '6', '7', '8', '9', '10']);
  check('the warning names the first five blanks and counts the rest',
    warning.includes('blanks "3", "4", "5", "6", "7" and 3 more') &&
      misplacedAnswersWarning(['0']).includes('blank "0" will'));

  // (4) What blocks a save, each named by its blank.
  const problems = (ds: FillInBlankDraft[]) => fillInProblems(ds);
  check('a sound list has no problems', problems(drafts).length === 0);
  check('zero blanks cannot be saved', problems([]).length === 1);
  check('an empty label is named',
    problems([draft('  ', false, 'x')]).includes('Blank #1 needs a label.'));
  check('a repeated label is named, pointing at the first',
    problems([draft('a', false, 'x'), draft(' a ', false, 'y')])
      .includes('Blank #2 repeats the label "a" of blank #1.'));
  check('an empty answer is named (the grader never passes an empty box)',
    problems([draft('a', false, '   ')]).includes('Blank #1 needs an answer.'));
  check('letters in a digits-only answer are named (the student could never type them)',
    problems([draft('a', false, 'x'), draft('b', true, '1O1')])
      .some((p) => p.startsWith('Blank #2 is digits-only')));

  // (5) The student's copy: the key is gone and the spec carries nothing else.
  const authoredQ: AssignmentQuestion = {
    id: 1,
    label: 'Problem 1',
    statement: 'Fill in the blanks.',
    buildMode: 'open',
    representation: 'binary',
    ...fields,
  };
  const authored: AssignmentData = { id: 'authored-fill-in', title: 'Authored', questions: [authoredQ] };
  const studentQ = stripAnswers(authored).questions[0];
  check('the student copy has an empty answer key', studentQ.fill_in_answers?.length === 0);
  check('the student copy\'s fill_in has only labels and numericOnly',
    Object.keys(studentQ.fill_in ?? {}).every((k) => k === 'labels' || k === 'numericOnly'));
  check('...and is the authored spec unchanged (the prompts and per-blank flags)',
    canonicalJson(studentQ.fill_in) === canonicalJson(authoredQ.fill_in));
  check('no answer appears anywhere in the student copy',
    !['111', 'Paris'].some((a) => JSON.stringify(studentQ).includes(a)));

  // (6) Submit → graded, as one pipeline: the student builds the submission from
  // the STRIPPED copy they were sent, and the key-holding side grades it.
  const studentCopy = stripAnswers(authored);
  const submitWith = (fillAnswers: string[]) => {
    const circuits = new Map([[1, { ...emptyQuestionCircuit(), fillAnswers }]]);
    const built = buildSubmission(studentCopy, circuits, { student: 'author@example.com', submittedAt: NOW_ISO });
    return gradeSubmission(authored, built).questions[0];
  };
  const right = submitWith(['111', ' Paris ', '0100']);
  check('the right answers grade 3/3 through buildSubmission → gradeSubmission',
    right.status === 'graded' && right.passed === 3 && right.total === 3);
  const oneOff = submitWith(['111', 'London', '100']);
  check('one wrong answer grades 2/3 and names that blank',
    oneOff.passed === 2 && (oneOff.fillCases ?? []).filter((c) => !c.pass).map((c) => c.label).join() === 'the capital of France');
  check('letters on a digits-only blank fail',
    (submitWith(['seven', 'Paris', '100']).fillCases ?? [])[0]?.pass === false);

  // (7) One classifier decides the panel, the grader branch and the answer.
  check('HW1 P11 is a fill-in task, chipped "open - fill-in"',
    questionTask(p11) === 'fill-in' && questionModeLabel(p11) === 'open - fill-in');
  const prose = hw1.questions.find((x) => x.id === 10)!;
  check('a prose open question is an open task, graded pending',
    questionTask(prose) === 'open' && gradeQuestion(prose, undefined, 'my answer').status === 'pending');
  const everyQ = [assignment, ...[1, 2, 3, 4, 5, 6, 7].map(readHw)].flatMap((a) => a.questions);
  const offMode = everyQ.filter((q) => !QUESTION_TASKS[q.buildMode].includes(questionTask(q)));
  check(`every sample + HW1–HW7 question's task is one its mode offers (${everyQ.length} questions)`,
    offMode.length === 0);
  const ccWithBlanks: AssignmentQuestion = {
    id: 99, label: 'x', statement: '', buildMode: 'CC', representation: 'binary',
    fill_in: { labels: ['a'] }, fill_in_answers: ['1'],
  };
  check('a fill_in on a CC question is NOT a fill-in task (nor graded as one)',
    questionTask(ccWithBlanks) === 'function' &&
      gradeQuestion(ccWithBlanks, undefined, undefined, ['1']).fillCases === undefined);

  // (8) One reader (engine/fillIn.ts fillInBlanks) and one writer
  // (instructor/fillInAuthoring.ts fillInFields) of `numericOnly`: an array
  // is truthy, so any other `if (spec.numericOnly)` would lock every blank.
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (name === 'node_modules') return [];
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
    });
  const allowed = ['app/src/types.ts', 'app/src/engine/fillIn.ts', 'app/src/instructor/fillInAuthoring.ts'];
  const mentions = [...walk(join(root, 'app/src')), ...walk(join(root, 'server/src'))]
    .filter((f) => readFileSync(f, 'utf8').includes('numericOnly'))
    .map((f) => relative(root, f).split('\\').join('/'));
  const strays = mentions.filter((f) => !allowed.includes(f));
  check('`numericOnly` is named only in types.ts, engine/fillIn.ts and instructor/fillInAuthoring.ts',
    strays.length === 0 && allowed.every((f) => mentions.includes(f)));
  for (const f of strays) console.log(`        → ${f}`);
}

// ── The student's own grade sheet (gradeDisplay.questionVerdict) ────
// What a student is told about each question. The load-bearing cases are the
// ones that must NOT read as a failure: a question with no result at all, one
// that was never attempted, and an open question still awaiting review.
console.log('\n[student grade sheet]');
{
  const verdict = (r: Parameters<typeof questionVerdict>[0]) => questionVerdict(r);
  const q = (over: Partial<QuestionResult>): QuestionResult =>
    ({ questionId: 1, status: 'graded', passed: 0, total: 0, cases: [], ...over });

  check('no result at all is not a failure', verdict(undefined).tone === 'none');
  check('a skipped question is "Not attempted"',
    verdict(q({ status: 'skipped' })).tone === 'none' &&
    verdict(q({ status: 'skipped' })).text === 'Not attempted');
  check('a 0/0 result is not a failure either',
    verdict(q({ passed: 0, total: 0 })).tone === 'none');
  check('all cases passed reads as correct, with the count',
    verdict(q({ passed: 4, total: 4 })).tone === 'pass' &&
    verdict(q({ passed: 4, total: 4 })).text === 'Correct — 4/4');
  check('some cases failed shows the score, not "correct"',
    verdict(q({ passed: 3, total: 4 })).tone === 'fail' &&
    verdict(q({ passed: 3, total: 4 })).text === '3/4');
  check('an unreviewed open question is pending, not failed',
    verdict(q({ status: 'pending' })).tone === 'pending');
  check('a reviewed open question carries the instructor verdict',
    verdict(q({ status: 'pending', manual: { pass: true, reviewedAt: NOW_ISO } })).tone === 'pass' &&
    verdict(q({ status: 'pending', manual: { pass: false, reviewedAt: NOW_ISO } })).tone === 'fail');
}

console.log(`\n${failures === 0 ? 'PIPELINE OK' : `PIPELINE FAILED (${failures} checks)`}`);
process.exit(failures === 0 ? 0 : 1);
