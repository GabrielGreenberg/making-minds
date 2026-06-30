// Autograder built on the headless CC engine.
//
// Framework-agnostic (no React/Zustand/DOM): runs in the browser and in the
// Node grading CLI from the same source. Scope: CC problems graded against
// `test_vectors` with bit-exact comparison. Anything else is reported as
// `skipped` with a reason rather than silently passing.

import type {
  CircuitData,
  AssignmentData,
  AssignmentQuestion,
  SubmissionData,
  CaseResult,
  QuestionResult,
  SubmissionResult,
} from '../types';
import { evaluateCCInputs } from './cc';
import { evaluateSCSequence } from './sc';
import { evaluateFSMSequence } from './fsm';
import { makeTape, readTape, evaluateTMSequence } from './tm';

// The grading result types live in types.ts (so SubmissionRecord can carry a
// result without a types→engine dependency). Re-exported here for the existing
// call sites that import them from the grader.
export type { CaseResult, QuestionResult, SubmissionResult } from '../types';

function bitsEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function skip(questionId: number, reason: string): QuestionResult {
  return { questionId, status: 'skipped', reason, passed: 0, total: 0, cases: [] };
}

// ---------------------------------------------------------------------------
// Test-vector format adapters.
// These are the most likely part to change as the question-design workflow
// evolves. Keep them here, isolated, so the engines stay untouched.
// ---------------------------------------------------------------------------

/**
 * Chunk a flat input_sequence and expected_output into per-time-step arrays
 * for SC grading. The number of inputs/outputs per step is inferred from the
 * submitted circuit's INPUT/OUTPUT component counts.
 */
function parseSCTestVector(
  inputSequence: number[],
  expectedOutput: number[],
  numInputs: number,
  numOutputs: number
): { inputSteps: number[][]; expectedSteps: number[][] } {
  const numSteps = numInputs > 0 ? Math.floor(inputSequence.length / numInputs) : 0;
  const inputSteps: number[][] = [];
  const expectedSteps: number[][] = [];
  for (let i = 0; i < numSteps; i++) {
    inputSteps.push(inputSequence.slice(i * numInputs, (i + 1) * numInputs));
    expectedSteps.push(expectedOutput.slice(i * numOutputs, (i + 1) * numOutputs));
  }
  return { inputSteps, expectedSteps };
}

/**
 * For FSM: single input bit per step, single output bit per step.
 */
function parseFSMTestVector(
  inputSequence: number[],
  expectedOutput: number[]
): { inputBits: number[]; expectedBits: number[] } {
  return { inputBits: inputSequence, expectedBits: expectedOutput };
}

// ---------------------------------------------------------------------------

/**
 * Grade a single question's circuit against its test vectors.
 */
export function gradeQuestion(question: AssignmentQuestion, circuit: CircuitData | undefined): QuestionResult {
  if (!circuit) return skip(question.id, 'no circuit submitted');
  if (!question.test_vectors || question.test_vectors.length === 0) {
    return skip(question.id, 'question has no test vectors');
  }

  if (question.buildMode === 'CC') {
    const cases: CaseResult[] = question.test_vectors.map((tv) => {
      const got = evaluateCCInputs(circuit.components, circuit.wires, tv.input_sequence);
      return {
        input: tv.input_sequence,
        expected: tv.expected_output,
        got,
        pass: bitsEqual(got, tv.expected_output),
      };
    });
    const passed = cases.filter((c) => c.pass).length;
    return { questionId: question.id, status: 'graded', passed, total: cases.length, cases };
  }

  if (question.buildMode === 'SC') {
    const numInputs = circuit.components.filter((c) => c.type === 'INPUT').length;
    const numOutputs = circuit.components.filter((c) => c.type === 'OUTPUT').length;

    const cases: CaseResult[] = question.test_vectors.map((tv) => {
      const { inputSteps, expectedSteps } = parseSCTestVector(
        tv.input_sequence, tv.expected_output, numInputs, numOutputs
      );
      const gotSteps = evaluateSCSequence(circuit.components, circuit.wires, inputSteps);
      const got = gotSteps.flat();
      const expected = expectedSteps.flat();
      return {
        input: tv.input_sequence,
        expected: tv.expected_output,
        got,
        pass: bitsEqual(got, expected),
      };
    });
    const passed = cases.filter((c) => c.pass).length;
    return { questionId: question.id, status: 'graded', passed, total: cases.length, cases };
  }

  if (question.buildMode === 'FSM') {
    const cases: CaseResult[] = question.test_vectors.map((tv) => {
      const { inputBits, expectedBits } = parseFSMTestVector(tv.input_sequence, tv.expected_output);
      const result = evaluateFSMSequence(circuit.components, circuit.wires, inputBits);
      const got = result.outputBits;
      return {
        input: tv.input_sequence,
        expected: tv.expected_output,
        got,
        pass: !result.halted && bitsEqual(got, expectedBits),
      };
    });
    const passed = cases.filter((c) => c.pass).length;
    return { questionId: question.id, status: 'graded', passed, total: cases.length, cases };
  }

  if (question.buildMode === 'TM') {
    // Each test vector's input_sequence is the initial tape (written to cells
    // 0..n-1, head at 0); expected_output is the tape window read back after the
    // machine halts. Same input→output framing as CC/SC. A machine that hits the
    // step limit (probable infinite loop) fails the vector with a partial `got`.
    const cases: CaseResult[] = question.test_vectors.map((tv) => {
      const result = evaluateTMSequence(
        circuit.components,
        circuit.wires,
        makeTape(tv.input_sequence)
      );
      const got = readTape(result.tape, tv.expected_output.length);
      return {
        input: tv.input_sequence,
        expected: tv.expected_output,
        got,
        pass: result.halted && !result.hitStepLimit && bitsEqual(got, tv.expected_output),
      };
    });
    const passed = cases.filter((c) => c.pass).length;
    return { questionId: question.id, status: 'graded', passed, total: cases.length, cases };
  }

  if (question.buildMode === 'turbot') {
    return skip(question.id, 'turbot grading not yet implemented');
  }

  return skip(question.id, `grading not yet supported for mode "${question.buildMode}"`);
}

/**
 * Grade a full submission against an assignment definition. Matches each
 * assignment question to its submitted answer by question id.
 */
export function gradeSubmission(assignment: AssignmentData, submission: SubmissionData): SubmissionResult {
  const byId = new Map(submission.answers.map((a) => [a.questionId, a.circuit]));

  const questions = assignment.questions.map((q) => gradeQuestion(q, byId.get(q.id)));

  const passed = questions.reduce((n, r) => n + r.passed, 0);
  const total = questions.reduce((n, r) => n + r.total, 0);

  return {
    student: submission.student ?? 'unknown',
    questions,
    passed,
    total,
  };
}

/**
 * Roll a SubmissionResult up into headline counts for display. "Questions
 * passed" counts a question as passed only when it was graded and every one of
 * its test vectors matched; skipped questions are excluded from the question
 * total so they don't penalise the student. "Vectors" are the finer-grained
 * test-vector tallies already on the result.
 */
export function summarizeResult(result: SubmissionResult): {
  questionsPassed: number;
  questionsTotal: number;
  vectorsPassed: number;
  vectorsTotal: number;
} {
  const graded = result.questions.filter((q) => q.status === 'graded');
  const questionsPassed = graded.filter((q) => q.total > 0 && q.passed === q.total).length;
  return {
    questionsPassed,
    questionsTotal: graded.length,
    vectorsPassed: result.passed,
    vectorsTotal: result.total,
  };
}
