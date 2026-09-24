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
//
//   [turbot arena authoring]  (task 010) the question creator's arena family:
//                        drafts → `turbot_cases` round-trips every sample and
//                        HW1–HW7 turbot question exactly (the homework sync
//                        keeps them pristine), add / duplicate (a deep copy)
//                        / remove (never the last) / reorder move an arena
//                        with its criterion and budget, the saved arenas an
//                        edit would shift (graded runs are positional: warned
//                        and confirmed at save), the per-arena defects
//                        that block a save, an authored 2-arena question kept
//                        whole in the student copy and graded per arena in
//                        order (`turbotCases[k]` is `turbot_cases[k]`), and a
//                        grep pin: no single-arena path left in the creator.

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
  turbotCorrect,
  turbotIncorrect,
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
import {
  describeTurbotCase,
  duplicateTurbotCase,
  misplacedArenas,
  misplacedArenasWarning,
  newTurbotCaseDraft,
  removeTurbotCase,
  turbotCaseDraftsOf,
  turbotCaseIndexOf,
  turbotCaseProblems,
  turbotCasesField,
  DEFAULT_CRITERION,
  DEFAULT_MAX_STEPS,
  type TurbotCaseDraft,
} from '../src/instructor/turbotCaseAuthoring';
import { resizeArena, setArenaCell } from '../src/instructor/arenaEditing';
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

// ── Authoring a turbot arena family (task 010) ─────────────────────
// The creator's arenas are drafts (instructor/turbotCaseAuthoring.ts), one per
// `turbot_cases` entry, each with its own criterion and step budget. Arenas are
// the problem statement (the server keeps them whole for students); grading
// requires every one to pass, and results are positional.
console.log('\n[turbot arena authoring]');
{
  const readHw = (n: number) => JSON.parse(
    readFileSync(new URL(`../src/devData/homeworks/hw${n}.json`, import.meta.url), 'utf8'),
  ) as AssignmentData;
  const hws = [1, 2, 3, 4, 5, 6, 7].map(readHw);

  // (1) A no-op creator edit reproduces every arena family exactly —
  // canonicalJson is the homework sync's own comparison. (The old creator
  // kept only turbot_cases[0], so saving any HW family dropped arenas 2+.)
  const hwTurbots = hws.flatMap((a) => a.questions.filter((q) => q.buildMode === 'turbot'));
  const allTurbots = [...assignment.questions.filter((q) => q.buildMode === 'turbot'), ...hwTurbots];
  const drifted = allTurbots.filter((q) => {
    const drafts = turbotCaseDraftsOf(q);
    return drafts.length !== q.turbot_cases!.length ||
      new Set(drafts.map((d) => d.key)).size !== drafts.length ||
      canonicalJson(turbotCasesField(drafts)) !== canonicalJson(q.turbot_cases);
  });
  check(`drafts → turbot_cases round-trips every sample + HW turbot question (${allTurbots.length}; ${hwTurbots.length} HW families)`,
    hwTurbots.length === 10 && drifted.length === 0);
  for (const q of drifted) console.log(`        → ${q.label}`);
  check('every HW family has at least two arenas (none may silently shrink)',
    hwTurbots.every((q) => turbotCaseDraftsOf(q).length >= 2));
  const hw3p14 = hws[2].questions.find((q) => q.id === 14)!;
  check('HW3 P14 loads as three drafts, each with its own arena',
    turbotCaseDraftsOf(hw3p14).length === 3 &&
      turbotCaseDraftsOf(hw3p14).every((d, i) => d.arena === hw3p14.turbot_cases![i].arena));
  check('each saved case is exactly {arena, maxSteps, criterion} (no row key leaks)',
    turbotCasesField(turbotCaseDraftsOf(hw3p14)).every((c) =>
      Object.keys(c).join() === 'arena,maxSteps,criterion'));

  // (2) A new question (or one of another mode) starts with one default arena.
  const isDefault = (ds: TurbotCaseDraft[]) =>
    ds.length === 1 && ds[0].arena.width === 5 && ds[0].arena.height === 5 &&
    ds[0].arena.cells.flat().every((c) => c === 'empty') &&
    ds[0].criterion === 'reach-and-stop' && DEFAULT_CRITERION === 'reach-and-stop' &&
    ds[0].maxSteps === 100 && DEFAULT_MAX_STEPS === 100;
  check('a new question gets one blank 5×5 arena, reach-and-stop, 100 steps',
    isDefault(turbotCaseDraftsOf(undefined)));
  check('...and so does a non-turbot question (or one with an empty family)',
    isDefault(turbotCaseDraftsOf(assignment.questions[0])) &&
      isDefault(turbotCaseDraftsOf({ turbot_cases: [] })));

  // (3) The list operations.
  const family = turbotCaseDraftsOf(hw3p14);
  const tail = { ...family[2], criterion: 'pass-through' as const, maxSteps: 37 };
  const withTail = [family[0], family[1], tail];
  const added = newTurbotCaseDraft(withTail);
  check('a new arena is a blank 5×5 graded like the last arena (criterion + budget)',
    added.arena.width === 5 && added.arena.height === 5 &&
      added.arena.cells.flat().every((c) => c === 'empty') &&
      added.criterion === 'pass-through' && added.maxSteps === 37 &&
      withTail.every((d) => d.key !== added.key));
  const dup = duplicateTurbotCase(family, 0);
  check('duplicate inserts a copy right after the original, with a fresh key',
    dup.drafts.length === 4 && dup.drafts[1].key === dup.key &&
      dup.key !== family[0].key && dup.drafts[0] === family[0] && dup.drafts[2] === family[1] &&
      canonicalJson(turbotCasesField([dup.drafts[1]])) === canonicalJson(turbotCasesField([family[0]])));
  const before = canonicalJson(family[0].arena);
  const copy = dup.drafts[1];
  const free = copy.arena.cells.flatMap((row, y) =>
    row.map((c, x) => ({ c, x, y }))).find((p) =>
    p.c === 'empty' && !(p.x === copy.arena.start.x && p.y === copy.arena.start.y))!;
  const painted = setArenaCell(copy.arena, free.x, free.y, 'block');
  copy.arena.cells[free.y][free.x] = 'goal'; // even a stray in-place write
  copy.arena.start.facing = copy.arena.start.facing === 'N' ? 'S' : 'N';
  check('the copy owns its cells and start: painting or mutating it leaves the original untouched',
    painted.cells[free.y][free.x] === 'block' && canonicalJson(family[0].arena) === before);
  check('removing an arena drops exactly that one',
    removeTurbotCase(family, 1).map((d) => d.key).join() === [family[0].key, family[2].key].join());
  const one = turbotCaseDraftsOf(undefined);
  check('the last arena cannot be removed',
    removeTurbotCase(one, 0).length === 1 && removeTurbotCase(one, 0)[0] === one[0]);
  const moved = moveItem(withTail, 2, 0);
  check('reordering moves an arena with its criterion and budget',
    moved[0] === tail && moved[0].criterion === 'pass-through' && moved[0].maxSteps === 37 &&
      canonicalJson(turbotCasesField(moved)) ===
        canonicalJson(turbotCasesField([tail, family[0], family[1]])));
  check('the active arena is found by key after a reorder, and a stale key falls back to #1',
    turbotCaseIndexOf(moved, tail.key) === 0 && turbotCaseIndexOf(moved, family[0].key) === 1 &&
      turbotCaseIndexOf(moved, -1) === 0);
  check('a row summary reads "W×H · criterion · N steps"',
    describeTurbotCase(tail) === `${tail.arena.width}×${tail.arena.height} · Pass through goal · 37 steps`);

  // (3b) Graded runs are positional (the gradebook's "#k", a student's replay
  // of run k in the CURRENT turbot_cases[k]), so the creator warns — and
  // confirms at save — exactly when a saved arena loses its slot.
  const painted0 = { ...family[0], arena: setArenaCell(family[0].arena, 0, 0, 'block'), maxSteps: 7 };
  check('painting, re-budgeting or re-judging a saved arena where it stands misplaces nothing',
    misplacedArenas(family, [painted0, { ...family[1], criterion: 'pass-through' }, family[2]]).length === 0);
  check('appending an arena (Add, or duplicating the last) misplaces nothing',
    misplacedArenas(family, [...family, newTurbotCaseDraft(family)]).length === 0 &&
      misplacedArenas(family, duplicateTurbotCase(family, 2).drafts).length === 0);
  check('moving arena #3 to the top (↑↑) misplaces all three saved arenas',
    misplacedArenas(family, moveItem(family, 2, 0)).join() === '0,1,2');
  check('swapping arenas #2 and #3 misplaces exactly those two',
    misplacedArenas(family, moveItem(family, 1, 2)).join() === '1,2');
  check('removing arena #2 misplaces it and every arena after it',
    misplacedArenas(family, removeTurbotCase(family, 1)).join() === '1,2');
  check('duplicating arena #1 (an insert before #2) misplaces #2 and #3',
    misplacedArenas(family, duplicateTurbotCase(family, 0).drafts).join() === '1,2');
  check('saving no arenas (the question stops being a turbot) misplaces every saved one',
    misplacedArenas(family, []).join() === '0,1,2');
  check('a new question has no saved arenas to misplace',
    misplacedArenas([], turbotCaseDraftsOf(undefined)).length === 0);
  const arenaWarning = misplacedArenasWarning([1, 2]);
  check('the warning names the saved arenas by number, and counts past five',
    arenaWarning.includes('graded in arenas #2, #3 will') &&
      arenaWarning.includes('"Run this input"') &&
      misplacedArenasWarning([0]).includes('graded in arena #1 will') &&
      misplacedArenasWarning([0, 1, 2, 3, 4, 5, 6]).includes('#1, #2, #3, #4, #5 and 2 more'));

  // (4) What blocks a save, each named by its arena.
  const goalless = { ...one[0] };
  const withGoal = { ...one[0], arena: setArenaCell(one[0].arena, 4, 4, 'goal') };
  check('a sound family has no problems', turbotCaseProblems(family).length === 0);
  check('a goal-less reach-and-stop arena is named by its number',
    turbotCaseProblems([withGoal, { ...goalless, criterion: 'reach-and-stop' }])
      .includes('Arena #2: this success criterion needs at least one goal cell.'));
  check('...and so is a goal-less pass-through arena',
    turbotCaseProblems([withGoal, { ...goalless, criterion: 'pass-through' }])
      .some((p) => p.startsWith('Arena #2:')));
  check('a goal-less return-to-start arena is sound',
    turbotCaseProblems([withGoal, { ...goalless, criterion: 'return-to-start' }]).length === 0);
  check('zero arenas cannot be saved',
    turbotCaseProblems([]).join() === 'A turbot question needs at least one arena.');
  check('a step budget below 1 (or fractional) is named',
    turbotCaseProblems([withGoal, { ...withGoal, maxSteps: 0 }])
      .includes('Arena #2: max steps must be a whole number of at least 1.') &&
      turbotCaseProblems([{ ...withGoal, maxSteps: 2.5 }]).length === 1);

  // (5) An authored 2-arena CC question, built the way the creator builds it
  // (arenaEditing on the drafts): a 1×5 and a 1×3 corridor, goal against the
  // east wall, reach-and-stop.
  const corridor = (d: TurbotCaseDraft, w: number, goalX: number): TurbotCaseDraft =>
    ({ ...d, maxSteps: 20, arena: setArenaCell(resizeArena(d.arena, w, 1), goalX, 0, 'goal') });
  const first = corridor(turbotCaseDraftsOf(undefined)[0], 5, 4);
  const authoredDrafts = [first, corridor(newTurbotCaseDraft([first]), 3, 2)];
  const turbotQ = (cases: TurbotCaseDraft[]): AssignmentQuestion => ({
    id: 1,
    label: 'Problem 1',
    statement: 'Walk forward until blocked, then stop.',
    buildMode: 'turbot',
    representation: 'binary',
    innerMode: 'CC',
    turbot_cases: turbotCasesField(cases),
  });
  const authoredOf = (cases: TurbotCaseDraft[]): AssignmentData =>
    ({ id: 'authored-turbot', title: 'Authored', questions: [turbotQ(cases)] });
  const authored = authoredOf(authoredDrafts);
  check('the authored family is two corridors graded reach-and-stop in 20 steps',
    canonicalJson(authored.questions[0].turbot_cases!.map((c) => [c.arena.width, c.arena.height, c.criterion, c.maxSteps])) ===
      canonicalJson([[5, 1, 'reach-and-stop', 20], [3, 1, 'reach-and-stop', 20]]));
  const studentCopy = stripAnswers(authored);
  check('the student copy keeps both arenas unchanged (they are the statement, not a key)',
    canonicalJson(studentCopy.questions[0].turbot_cases) ===
      canonicalJson(authored.questions[0].turbot_cases));

  const gradeAgainst = (def: AssignmentData, brain: ReturnType<typeof turbotCorrect>) => {
    const circuits = new Map([[1, { ...emptyQuestionCircuit(), ...brain }]]);
    const built = buildSubmission(stripAnswers(def), circuits, { student: 'turbot@example.com', submittedAt: NOW_ISO });
    return gradeSubmission(def, built);
  };
  const right = gradeAgainst(authored, turbotCorrect()).questions[0];
  check('the reference brain passes both arenas (2/2, one result per arena)',
    right.status === 'graded' && right.passed === 2 && right.total === 2 &&
      right.turbotCases?.length === 2 && right.turbotCases.every((c) => c.pass));

  // Arena 2's goal moved mid-corridor: the brain walks past it to the wall.
  const midGoal = [authoredDrafts[0], corridor(authoredDrafts[1], 3, 1)];
  midGoal[1] = { ...midGoal[1], arena: setArenaCell(midGoal[1].arena, 2, 0, 'empty') };
  const halfDef = authoredOf(midGoal);
  const half = gradeAgainst(halfDef, turbotCorrect());
  const halfQ = half.questions[0];
  check('with arena 2\'s goal mid-corridor the brain grades 1/2, failing arena 2',
    halfQ.passed === 1 && halfQ.total === 2 &&
      halfQ.turbotCases?.[0].pass === true && halfQ.turbotCases?.[1].pass === false);
  check('...and the question fails as a whole (every arena must pass)',
    summarizeResult(half).questionsPassed === 0 && summarizeResult(half).questionsTotal === 1);
  const wrong = gradeAgainst(authored, turbotIncorrect()).questions[0];
  check('a brain that never leaves the start fails both arenas (0/2)',
    wrong.passed === 0 && wrong.total === 2 && wrong.turbotCases?.length === 2);
  const reversed = gradeAgainst(authoredOf([...midGoal].reverse()), turbotCorrect()).questions[0];
  check('reversing the arenas reverses the results (turbotCases[k] is turbot_cases[k])',
    canonicalJson(reversed.turbotCases) === canonicalJson([...(halfQ.turbotCases ?? [])].reverse()) &&
      reversed.turbotCases?.[0].pass === false && reversed.turbotCases?.[1].pass === true);

  // (6) No single-arena path may come back into the creator: every case goes
  // through the drafts, in and out.
  const creator = readFileSync(new URL('../src/instructor/QuestionCreator.tsx', import.meta.url), 'utf8');
  check('QuestionCreator reads and writes turbot_cases only through the drafts',
    !creator.includes('turbot_cases?.[') && !creator.includes('turbot_cases: [') &&
      creator.includes('turbotCaseDraftsOf(existingQuestion)') &&
      creator.includes('turbot_cases: turbotCasesField(caseDrafts)'));
  check('...and guards the saved arenas\' slots: warned in the list, confirmed at save',
    creator.includes('misplacedArenas(savedArenas, isTurbot ? caseDrafts : [])') &&
      creator.includes('misplacedArenasWarning(misplacedRuns)') &&
      creator.includes('saved={savedArenas}'));
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
