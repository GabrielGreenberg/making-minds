// Headless end-to-end check of the autograding pipeline for CC, SC, FSM, and TM.
//
//   npx tsx tools/pipelineCheck.ts
//
// Builds the sample assignment and grades a known-correct and a known-incorrect
// submission per mode, asserting the correct one scores 100% and the incorrect
// one scores below 100%. This validates the grader + the per-mode codec
// adapters against real circuits, independent of the browser/UI.

import {
  buildSampleAssignment,
  buildCorrectSubmission,
  buildIncorrectSubmission,
} from '../src/devData/sampleData';
import { gradeSubmission, summarizeResult } from '../src/engine/grader';

const assignment = buildSampleAssignment();

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}

console.log('Assignment:', assignment.title);
for (const q of assignment.questions) {
  console.log(`  ${q.label}: ${q.test_cases?.length ?? 0} test cases`);
}

console.log('\n[correct submission]');
const correct = gradeSubmission(assignment, buildCorrectSubmission());
for (const q of correct.questions) {
  const def = assignment.questions.find((x) => x.id === q.questionId);
  console.log(`  ${def?.label}: ${q.status} ${q.passed}/${q.total}`);
  check(`${def?.label} all vectors pass`, q.status === 'graded' && q.total > 0 && q.passed === q.total);
}
const cs = summarizeResult(correct);
check('correct: 4/4 questions', cs.questionsPassed === 4 && cs.questionsTotal === 4);

console.log('\n[incorrect submission]');
const wrong = gradeSubmission(assignment, buildIncorrectSubmission());
for (const q of wrong.questions) {
  const def = assignment.questions.find((x) => x.id === q.questionId);
  console.log(`  ${def?.label}: ${q.status} ${q.passed}/${q.total}`);
  check(`${def?.label} fails at least one vector`, q.status === 'graded' && q.passed < q.total);
}
const ws = summarizeResult(wrong);
check('incorrect: 0/4 questions', ws.questionsPassed === 0 && ws.questionsTotal === 4);

console.log(`\n${failures === 0 ? 'PIPELINE OK' : `PIPELINE FAILED (${failures} checks)`}`);
process.exit(failures === 0 ? 0 : 1);
