// Autograder — the unified, value-based grading pipeline (CLAUDE_KB/pipeline/
// codec.md).
//
// Framework-agnostic (no React/Zustand/DOM): runs in the browser and in the Node
// grading CLI from the same source. Every mode is graded the same way — a machine
// implements a function f, and we check it against a machine-agnostic bank of
// numeric (x, f(x)) test cases:
//
//   validate → encode → run → accept → decode → compare
//
// The only per-mode knowledge is the **axis** (how a number maps to/from bits
// over wires/time/tape), which lives entirely in the codec:
//   CC → space, SC/FSM → time, TM → tape (delegated to tmCodec).
//
// Scoring is all-or-nothing at the question level: a question passes iff the
// machine is valid AND every case passes. A case passes iff its output is
// accepted and decodes to f(x). No partial credit — a rejected output and a wrong
// value fail identically. A Stage-1-invalid machine fails every case (0/total),
// never `skipped`. Failing cases are recorded for the INSTRUCTOR only.

import type {
  CircuitData,
  AssignmentData,
  AssignmentQuestion,
  SubmissionData,
  TestCase,
  RepSystem,
  BuildMode,
  CaseResult,
  QuestionResult,
  SubmissionResult,
} from '../types';
import { evaluateCCInputs } from './cc';
import { evaluateSCSequence } from './sc';
import { evaluateFSMSequence } from './fsm';
import { evaluateTMSequence } from './tm';
import { validateMachine } from './machineValidation';
import {
  axisForMode,
  encodeInput,
  decodeOutput,
  outputAccepted,
  type CodecLayout,
  type RawOutput,
} from './codec';
import { encodeTM, acceptTM, decodeTM, notationForRepresentation } from './tmCodec';

// The grading result types live in types.ts (so SubmissionRecord can carry a
// result without a types→engine dependency). Re-exported here for the existing
// call sites that import them from the grader.
export type { CaseResult, QuestionResult, SubmissionResult } from '../types';

function valuesEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function skip(questionId: number, reason: string): QuestionResult {
  return { questionId, status: 'skipped', reason, passed: 0, total: 0, cases: [] };
}

function reject(tc: TestCase, reason: string): CaseResult {
  return { input: tc.inputs, expected: tc.outputs, got: [], pass: false, reason };
}

/** Stage-1 failure: an invalid machine fails every case (never `skipped`). */
function failEvery(questionId: number, cases: TestCase[], reason: string): QuestionResult {
  const out = cases.map((tc) => reject(tc, reason));
  return { questionId, status: 'graded', passed: 0, total: out.length, cases: out };
}

function tally(questionId: number, cases: CaseResult[]): QuestionResult {
  const passed = cases.filter((c) => c.pass).length;
  return { questionId, status: 'graded', passed, total: cases.length, cases };
}

/**
 * Grade a single question's circuit against its numeric test cases.
 */
export function gradeQuestion(question: AssignmentQuestion, circuit: CircuitData | undefined): QuestionResult {
  if (!circuit) return skip(question.id, 'no circuit submitted');
  if (question.buildMode === 'turbot') return skip(question.id, 'turbot grading not yet implemented');

  const cases = question.test_cases;
  if (!cases || cases.length === 0) return skip(question.id, 'question has no test cases');

  const mode = question.buildMode;
  const rep: RepSystem = question.representation ?? 'binary';
  const axis = axisForMode(mode);

  // Tape axis (TM): widths are content-relative — the tape codec lays values out
  // and locates the output block by content, so no cc_spec is required.
  if (axis === 'tape') return gradeTape(question.id, circuit, cases, rep);

  // Space/time axes need the per-group widths from the authoring spec.
  const spec = question.cc_spec;
  if (!spec) return skip(question.id, 'question has no spec (group widths unknown)');
  const layout: CodecLayout = {
    axis,
    rep,
    inputWidths: spec.inputs.map((g) => g.width),
    outputWidths: spec.outputs.map((g) => g.width),
  };

  // Stage 1: machine validation. Invalid ⇒ fail every case with no testing.
  const valid = validateMachine(circuit, mode, layout, rep);
  if (!valid.ok) return failEvery(question.id, cases, valid.reason ?? 'invalid machine');

  // Stage 2: test each case through the codec.
  const results = cases.map((tc) => gradeSpaceTimeCase(circuit, mode, layout, tc));
  return tally(question.id, results);
}

/** One case on the space (CC) or time (SC/FSM) axis. */
function gradeSpaceTimeCase(
  circuit: CircuitData,
  mode: BuildMode,
  layout: CodecLayout,
  tc: TestCase,
): CaseResult {
  const enc = encodeInput(tc.inputs, layout);

  let raw: RawOutput;
  if (enc.axis === 'space') {
    // CC — one combinational evaluation.
    const bits = evaluateCCInputs(circuit.components, circuit.wires, enc.bits);
    raw = { axis: 'space', bits };
  } else if (mode === 'SC') {
    const steps = evaluateSCSequence(circuit.components, circuit.wires, enc.steps);
    raw = { axis: 'time', steps };
  } else {
    // FSM — n=1: flatten the single wire to one input bit per step. Stage 1
    // guarantees totality, so a valid FSM cannot halt mid-run; guard anyway.
    const inputBits = enc.steps.map((s) => s[0]);
    const r = evaluateFSMSequence(circuit.components, circuit.wires, inputBits);
    if (r.halted) return reject(tc, 'machine halted before consuming the input');
    raw = { axis: 'time', steps: r.outputBits.map((b) => [b]) };
  }

  // Acceptor (rep-level) before decoding; decode is total.
  if (!outputAccepted(raw, layout)) return reject(tc, 'malformed output');
  const got = decodeOutput(raw, layout);
  return { input: tc.inputs, expected: tc.outputs, got, pass: valuesEqual(got, tc.outputs) };
}

/** TM grading — the codec's tape axis, delegated to tmCodec. */
function gradeTape(
  questionId: number,
  circuit: CircuitData,
  cases: TestCase[],
  rep: RepSystem,
): QuestionResult {
  const notation = notationForRepresentation(rep);
  const layout: CodecLayout = { axis: 'tape', rep, inputWidths: [], outputWidths: [] };

  // Stage 1: an ill-formed table fails every case with the syntax error.
  const valid = validateMachine(circuit, 'TM', layout, rep);
  if (!valid.ok) return failEvery(questionId, cases, valid.reason ?? 'invalid machine');

  const results = cases.map((tc) => {
    const run = evaluateTMSequence(
      circuit.components,
      circuit.wires,
      encodeTM(notation, tc.inputs),
      notation,
    );
    const rej = acceptTM(notation, run);
    if (rej) return reject(tc, rej.reason);
    const got = decodeTM(notation, run.tape);
    return { input: tc.inputs, expected: tc.outputs, got: [got], pass: got === tc.outputs[0] };
  });
  return tally(questionId, results);
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
 * Roll a SubmissionResult up into headline counts for display. "Questions passed"
 * counts a question as passed only when it was graded and every one of its cases
 * matched; skipped questions are excluded from the question total so they don't
 * penalise the student. "Cases" are the finer-grained per-case tallies already on
 * the result.
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
