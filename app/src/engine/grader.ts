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
// Two question kinds grade OUTSIDE the codec: turbots (positional arena
// criteria — gradeTurbot) and perception questions (raw bit-level frames in,
// one classification bit out per step — gradePerception, engine/perception.ts).
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
  TurbotTestCase,
  TurbotCaseResult,
  PerceptionTestCase,
  PerceptionCaseResult,
  RepSystem,
  BuildMode,
  TMNotation,
  CaseResult,
  QuestionResult,
  SubmissionResult,
} from '../types';
import { evaluateCCInputs } from './cc';
import { evaluateSCSequence } from './sc';
import { evaluateFSMSymbolSequence } from './fsm';
import { fsmNotation } from './notation';
import { evaluateTMSequence } from './tm';
import { runTurbot, evaluateTurbotCriterion, criterionRequiresStop, validateTurbotTM, validateTurbotFSM } from './turbot';
import { validatePerceptionMachine, runPerceptionCase } from './perception';
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
 * Open questions cannot be autograded: the result is `pending` (manual review;
 * an LLM-grading pass could later consume the same `response` field and
 * replace the pending result with a scored one). Contributes 0/0 to the
 * tallies so it never moves the autograded score.
 */
function pendingOpen(questionId: number, responseText: string | undefined): QuestionResult {
  return {
    questionId,
    status: 'pending',
    reason: 'open question — needs manual review',
    response: responseText ?? '',
    passed: 0,
    total: 0,
    cases: [],
  };
}

/**
 * Grade a single question's circuit against its numeric test cases.
 * `responseText` is the free-text answer for open questions (unused otherwise).
 */
export function gradeQuestion(
  question: AssignmentQuestion,
  circuit: CircuitData | undefined,
  responseText?: string,
): QuestionResult {
  if (question.buildMode === 'open') return pendingOpen(question.id, responseText);
  if (!circuit) return skip(question.id, 'no circuit submitted');
  if (question.buildMode === 'turbot') return gradeTurbot(question, circuit);
  if (question.perception) return gradePerception(question, circuit);

  const cases = question.test_cases;
  if (!cases || cases.length === 0) return skip(question.id, 'question has no test cases');

  const mode = question.buildMode;
  const rep: RepSystem = question.representation ?? 'binary';
  const axis = axisForMode(mode);

  // Tape axis (TM): widths are content-relative — the tape codec lays values out
  // and locates the output block by content, so no cc_spec is required.
  if (axis === 'tape') {
    return gradeTape(question.id, circuit, cases, rep, question.requireStandardHaltPosition);
  }

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
    // FSM — feed the FULL encoded row per step as one input symbol: symbol
    // char i = input wire i (cc_spec declaration order = codec wire order).
    // Stage 1 validated totality over this notation's whole alphabet, so a
    // valid FSM cannot halt mid-run; guard anyway.
    const notation = fsmNotation(layout.inputWidths.length, layout.outputWidths.length);
    const symbols = enc.steps.map((s) => s.join(''));
    const r = evaluateFSMSymbolSequence(circuit.components, circuit.wires, symbols, notation);
    if (r.halted) return reject(tc, 'machine halted before consuming the input');
    raw = { axis: 'time', steps: r.outputs.map((sym) => sym.split('').map(Number)) };
  }

  // Acceptor (rep-level) before decoding; decode is total.
  if (!outputAccepted(raw, layout)) return reject(tc, 'malformed output');
  const got = decodeOutput(raw, layout);
  return { input: tc.inputs, expected: tc.outputs, got, pass: valuesEqual(got, tc.outputs) };
}

/** TM grading — the codec's tape axis, delegated to tmCodec.
 *  `requireStandardHaltPosition` (question-level, optional) tightens the
 *  acceptor: the head must halt on the output block's rightmost cell.
 *  Absent/false keeps the default position-agnostic acceptance. */
function gradeTape(
  questionId: number,
  circuit: CircuitData,
  cases: TestCase[],
  rep: RepSystem,
  requireStandardHaltPosition?: boolean,
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
      // The case's optional layout hint (block separations) rides through
      // untouched — the codec owns what it means; the grader stays agnostic.
      encodeTM(notation, tc.inputs, tc.separations),
      notation,
    );
    const rej = acceptTM(notation, run, { requireStandardHaltPosition });
    if (rej) return reject(tc, rej.reason);
    const got = decodeTM(notation, run.tape);
    return { input: tc.inputs, expected: tc.outputs, got: [got], pass: got === tc.outputs[0] };
  });
  return tally(questionId, results);
}

/**
 * Perception grading — bit-level, outside the value codec (engine/perception.ts).
 * The retina's raw frames go straight to the CC/SC engine and the single output
 * bit is compared per time step; a case passes iff every step matches.
 */
function gradePerception(question: AssignmentQuestion, circuit: CircuitData): QuestionResult {
  const spec = question.perception!;
  const mode = question.buildMode;
  if (mode !== 'CC' && mode !== 'SC') {
    return skip(question.id, `perception questions must be CC or SC (got ${mode})`);
  }

  const cases = question.perception_cases;
  if (!cases || cases.length === 0) return skip(question.id, 'question has no perception cases');

  // Stage 1: the retina interface (width input wires, one output wire).
  // Invalid ⇒ fail every case with the reason, never `skipped`.
  const valid = validatePerceptionMachine(circuit, spec.width);
  if (!valid.ok) {
    const rejected: PerceptionCaseResult[] = cases.map((tc) => ({
      pass: false,
      frames: tc.frames,
      expected: tc.expected,
      got: [],
      reason: valid.reason,
    }));
    return { questionId: question.id, status: 'graded', passed: 0, total: rejected.length, cases: [], perceptionCases: rejected };
  }

  const results = cases.map((tc) => gradePerceptionCase(circuit, mode, tc));
  const passed = results.filter((c) => c.pass).length;
  return { questionId: question.id, status: 'graded', passed, total: results.length, cases: [], perceptionCases: results };
}

function gradePerceptionCase(
  circuit: CircuitData,
  mode: 'CC' | 'SC',
  tc: PerceptionTestCase,
): PerceptionCaseResult {
  const got = runPerceptionCase(circuit, mode, tc);
  const mismatch = tc.expected.findIndex((e, t) => got[t] !== e);
  return {
    pass: mismatch < 0,
    frames: tc.frames,
    expected: tc.expected,
    got,
    failStep: mismatch < 0 ? undefined : mismatch + 1,
  };
}

/**
 * Structural layout for a turbot brain's fixed sensor/motor interface, keyed
 * by inner mode. Only CC/SC brains reach validateMachine (FSM brains
 * validate against turbotFsmNotation via validateTurbotFSM above; TM brains
 * against validateTurbotTM), so only those two rows are read.
 */
function turbotLayout(innerMode: BuildMode): CodecLayout {
  if (innerMode === 'SC') return { axis: 'time', rep: 'binary', inputWidths: [1], outputWidths: [1, 1] };
  return { axis: 'space', rep: 'binary', inputWidths: [1], outputWidths: [2] };
}

/** Turbot grading — runs the arena driver loop per case and checks the success criterion. */
function gradeTurbot(question: AssignmentQuestion, circuit: CircuitData): QuestionResult {
  const innerMode = question.innerMode;
  if (!innerMode) return skip(question.id, 'question has no inner mode (CC/SC/FSM/TM) set');

  const cases = question.turbot_cases;
  if (!cases || cases.length === 0) return skip(question.id, 'question has no turbot cases');

  // Stage 1: a TM brain is a *turbot TM* (per-state internal/external
  // grammar, single actions) with its own validator; an FSM brain validates
  // through validateTurbotFSM, which delegates to turbotFsmNotation — the
  // SAME notation runBrainStep executes and the store's label editor accepts
  // (legacy 1-bit aliases and canonical 2-bit motor labels alike); CC/SC
  // brains reuse the shared machine validation.
  // The question's encoding (representation) picks a turbot TM's internal
  // tape alphabet: binary {0,1,*}, unary (tally) {0,1}.
  const notation = notationForRepresentation(question.representation ?? 'binary');
  let valid: { ok: boolean; reason?: string };
  if (innerMode === 'TM' || innerMode === 'FSM') {
    const errors = innerMode === 'TM'
      ? validateTurbotTM(circuit.components, circuit.wires, notation)
      : validateTurbotFSM(circuit.components, circuit.wires);
    valid = errors.length === 0 ? { ok: true } : { ok: false, reason: errors.map((e) => e.message).join(' ') };
  } else {
    valid = validateMachine(circuit, innerMode, turbotLayout(innerMode), question.representation ?? 'binary');
  }
  if (!valid.ok) {
    const rejected: TurbotCaseResult[] = cases.map((tc) => ({
      pass: false,
      stepsTaken: 0,
      finalPosition: { ...tc.arena.start },
      hitStepLimit: false,
      reason: valid.reason,
    }));
    return { questionId: question.id, status: 'graded', passed: 0, total: rejected.length, cases: [], turbotCases: rejected };
  }

  const turbotCases = cases.map((tc) => gradeTurbotCase(circuit, innerMode, tc, notation));
  const passed = turbotCases.filter((c) => c.pass).length;
  return { questionId: question.id, status: 'graded', passed, total: turbotCases.length, cases: [], turbotCases };
}

function gradeTurbotCase(circuit: CircuitData, innerMode: BuildMode, tc: TurbotTestCase, notation: TMNotation): TurbotCaseResult {
  const run = runTurbot(circuit.components, circuit.wires, innerMode, tc.arena, tc.maxSteps, notation);
  // The step limit bounds SIMULATION; whether a truncated run also fails is
  // the criterion's call (criterionRequiresStop, engine/turbot.ts). Stop-
  // requiring criteria (reach-and-stop, return-to-start) judge how the run
  // ends, so a turbot that never came to rest fails outright. pass-through
  // is trace-satisfiable (HW2 §III: cross the goal, "need not stop"), so a
  // step-limited run is still judged on the trace it produced.
  if (run.hitStepLimit && criterionRequiresStop(tc.criterion)) {
    return { pass: false, stepsTaken: tc.maxSteps, finalPosition: run.finalState, hitStepLimit: true, reason: 'exceeded max steps' };
  }
  const pass = evaluateTurbotCriterion(tc.arena, run, tc.criterion);
  // Failure reasons: a step-limited trace that never satisfied its criterion
  // names the criterion (the limit is not why it failed); a halted-but-not-
  // stopped brain (a dead FSM — a turbot TM's halt counts as its stop) gets
  // the explanatory reason.
  const reason = pass
    ? undefined
    : run.hitStepLimit
      ? `'${tc.criterion}' criterion not satisfied within max steps`
      : run.haltedByBrain && !run.stopped
        ? 'brain halted without a matching transition'
        : undefined;
  return { pass, stepsTaken: run.history.length, finalPosition: run.finalState, hitStepLimit: run.hitStepLimit, reason };
}

/**
 * Grade a full submission against an assignment definition. Matches each
 * assignment question to its submitted answer by question id.
 */
export function gradeSubmission(assignment: AssignmentData, submission: SubmissionData): SubmissionResult {
  const byId = new Map(submission.answers.map((a) => [a.questionId, a]));

  const questions = assignment.questions.map((q) => {
    const answer = byId.get(q.id);
    return gradeQuestion(q, answer?.circuit, answer?.responseText);
  });

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
