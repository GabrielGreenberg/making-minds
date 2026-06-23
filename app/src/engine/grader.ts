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
} from '../types';
import { evaluateCCInputs } from './cc';

export interface CaseResult {
  input: number[];
  expected: number[];
  got: number[];
  pass: boolean;
}

export interface QuestionResult {
  questionId: number;
  status: 'graded' | 'skipped';
  reason?: string; // why it was skipped
  passed: number;
  total: number;
  cases: CaseResult[];
}

export interface SubmissionResult {
  student: string;
  questions: QuestionResult[];
  passed: number; // rolled up across graded cases
  total: number;
}

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

/**
 * Grade a single question's circuit against its test vectors. Only CC questions
 * with test vectors are gradeable today; everything else is skipped with a reason.
 */
export function gradeQuestion(question: AssignmentQuestion, circuit: CircuitData | undefined): QuestionResult {
  if (!circuit) return skip(question.id, 'no circuit submitted');
  if (question.buildMode !== 'CC') return skip(question.id, `grading not yet supported for mode "${question.buildMode}"`);
  if (!question.test_vectors || question.test_vectors.length === 0) {
    return skip(question.id, 'question has no test vectors');
  }

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
