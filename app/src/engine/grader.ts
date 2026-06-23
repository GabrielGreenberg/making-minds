// Autograder built on the headless CC engine.
//
// Framework-agnostic (no React/Zustand/DOM): runs in the browser and in the
// Node grading CLI from the same source. Scope: CC problems graded against
// `test_vectors` with bit-exact comparison. Anything else is reported as
// `skipped` with a reason rather than silently passing.

import type {
  CircuitData,
  HomeworkData,
  HomeworkProblem,
  SubmissionData,
} from '../types';
import { evaluateCCInputs } from './cc';

export interface CaseResult {
  input: number[];
  expected: number[];
  got: number[];
  pass: boolean;
}

export interface ProblemResult {
  problemId: number;
  status: 'graded' | 'skipped';
  reason?: string; // why it was skipped
  passed: number;
  total: number;
  cases: CaseResult[];
}

export interface SubmissionResult {
  student: string;
  problems: ProblemResult[];
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

function skip(problemId: number, reason: string): ProblemResult {
  return { problemId, status: 'skipped', reason, passed: 0, total: 0, cases: [] };
}

/**
 * Grade a single problem's circuit against its test vectors. Only CC problems
 * with test vectors are gradeable today; everything else is skipped with a reason.
 */
export function gradeProblem(problem: HomeworkProblem, circuit: CircuitData | undefined): ProblemResult {
  if (!circuit) return skip(problem.id, 'no circuit submitted');
  if (problem.type !== 'CC') return skip(problem.id, `grading not yet supported for type "${problem.type}"`);
  if (!problem.test_vectors || problem.test_vectors.length === 0) {
    return skip(problem.id, 'problem has no test vectors');
  }

  const cases: CaseResult[] = problem.test_vectors.map((tv) => {
    const got = evaluateCCInputs(circuit.components, circuit.wires, tv.input_sequence);
    return {
      input: tv.input_sequence,
      expected: tv.expected_output,
      got,
      pass: bitsEqual(got, tv.expected_output),
    };
  });

  const passed = cases.filter((c) => c.pass).length;
  return { problemId: problem.id, status: 'graded', passed, total: cases.length, cases };
}

/**
 * Grade a full submission against a homework definition. Matches each homework
 * problem to its submitted answer by problem id.
 */
export function gradeSubmission(homework: HomeworkData, submission: SubmissionData): SubmissionResult {
  const byId = new Map(submission.answers.map((a) => [a.problemId, a.circuit]));

  const problems = homework.problems.map((p) => gradeProblem(p, byId.get(p.id)));

  const passed = problems.reduce((n, r) => n + r.passed, 0);
  const total = problems.reduce((n, r) => n + r.total, 0);

  return {
    student: submission.student ?? 'unknown',
    problems,
    passed,
    total,
  };
}
