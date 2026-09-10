// Headless end-to-end check of the autograding pipeline for CC, SC, FSM, TM,
// turbot, perception, open, and fill-in-the-blank questions.
//
//   npx tsx tools/pipelineCheck.ts
//
// Builds the sample assignment and grades a known-correct and a known-incorrect
// submission per mode, asserting the correct one scores 100% and the incorrect
// one scores below 100%. This validates the grader + the per-mode codec
// adapters against real circuits, independent of the browser/UI. The open
// question is asserted to come back `pending` (not autogradeable) with the
// student's response attached for manual review.

import { readFileSync } from 'node:fs';
import type { AssignmentData, SubmissionRecord } from '../src/types';
import {
  buildSampleAssignment,
  buildCorrectSubmission,
  buildIncorrectSubmission,
} from '../src/devData/sampleData';
import { gradeQuestion, gradeSubmission, summarizeResult } from '../src/engine/grader';
import { applyManualReview, buildSubmission } from '../src/storage/submissionStore';
import { emptyQuestionCircuit } from '../src/storage/workbookStore';
import { gradeSubmissions } from '../src/instructor/Gradebook';

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
    submittedAt: '2026-09-10T00:00:00.000Z',
  });
  const answer = built.answers.find((a) => a.questionId === 11);
  check('buildSubmission carries the blanks, not a responseText',
    answer?.fillAnswers?.length === 11 && answer.responseText === undefined);
  const wholeHw = gradeSubmission(hw1, built);
  check('the fill-in question grades 11/11 through gradeSubmission',
    wholeHw.questions.find((r) => r.questionId === 11)?.passed === 11);
}

console.log(`\n${failures === 0 ? 'PIPELINE OK' : `PIPELINE FAILED (${failures} checks)`}`);
process.exit(failures === 0 ? 0 : 1);
