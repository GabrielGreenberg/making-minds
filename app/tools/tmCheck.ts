// Headless smoke test for the Turing-machine engine + grader TM branch.
//
//   npx tsx tools/tmCheck.ts
//
// Builds a unary-increment TM (scan right over 1s, write 1 into the first
// blank, halt) and grades a correct and an incorrect circuit against
// input→output test vectors, the same framing the CC/SC graders use.

import type { CircuitComponent, Wire, AssignmentData, SubmissionData } from '../src/types';
import { getPortsForType } from '../src/types';
import { evaluateTMSequence, makeTape, readTape } from '../src/engine/tm';
import { gradeSubmission } from '../src/engine/grader';

function comp(id: string, label: string): CircuitComponent {
  return { id, type: 'STATE', x: 0, y: 0, label, ports: getPortsForType('STATE') };
}
function wire(id: string, src: string, tgt: string, transitionLabel: string): Wire {
  return {
    id, sourceComponentId: src, sourcePortId: 'right',
    targetComponentId: tgt, targetPortId: 'left', value: 0, transitionLabel,
  };
}

// Correct: S₀ on 1 → move R (stay S₀); S₀ on 0 → write 1 (go S₁, which halts).
function tmCorrect() {
  return {
    components: [comp('s0', 'S₀'), comp('s1', 'S₁')],
    wires: [
      wire('t1', 's0', 's0', '1:R'),
      wire('t2', 's0', 's1', '0:1'),
    ],
  };
}

// Incorrect: S₀ on 0 → move R (stay S₀) instead of writing. Never writes the 1,
// scans right forever over blanks → hits the step limit → fails.
function tmIncorrect() {
  return {
    components: [comp('s0', 'S₀')],
    wires: [
      wire('t1', 's0', 's0', '1:R'),
      wire('t2', 's0', 's0', '0:R'),
    ],
  };
}

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}

// ── direct engine checks ───────────────────────────────────────
console.log('[engine]');
const r = evaluateTMSequence(tmCorrect().components, tmCorrect().wires, makeTape([1, 1, 0]));
check('halts', r.halted && !r.hitStepLimit);
check('unary 2 → 3: tape window [1,1,1]', JSON.stringify(readTape(r.tape, 3)) === JSON.stringify([1, 1, 1]));

const loop = evaluateTMSequence(tmIncorrect().components, tmIncorrect().wires, makeTape([1, 1, 0]));
check('non-terminating machine hits step limit', loop.hitStepLimit && !loop.halted);

// ── grader checks ──────────────────────────────────────────────
console.log('\n[grader]');
const assignment: AssignmentData = {
  id: 'tm-smoke',
  title: 'TM smoke',
  questions: [{
    id: 1,
    label: 'Q1 (TM)',
    statement: 'Unary increment',
    buildMode: 'TM',
    test_vectors: [
      { input_sequence: [1, 1, 0], expected_output: [1, 1, 1] },
      { input_sequence: [1, 0],    expected_output: [1, 1] },
      { input_sequence: [0],       expected_output: [1] },
    ],
  }],
};

function sub(student: string, circuit: { components: CircuitComponent[]; wires: Wire[] }): SubmissionData {
  return {
    assignmentTitle: 'TM smoke',
    student,
    submittedAt: '2026-06-29T00:00:00Z',
    answers: [{ questionId: 1, circuit }],
  };
}

const correct = gradeSubmission(assignment, sub('correct@example.com', tmCorrect()));
check('correct: all vectors pass', correct.questions[0].status === 'graded' &&
  correct.questions[0].passed === correct.questions[0].total && correct.questions[0].total === 3);

const wrong = gradeSubmission(assignment, sub('wrong@example.com', tmIncorrect()));
check('incorrect: fails at least one vector', wrong.questions[0].status === 'graded' &&
  wrong.questions[0].passed < wrong.questions[0].total);

console.log(`\n${failures === 0 ? 'TM CHECK OK' : `TM CHECK FAILED (${failures} checks)`}`);
process.exit(failures === 0 ? 0 : 1);
