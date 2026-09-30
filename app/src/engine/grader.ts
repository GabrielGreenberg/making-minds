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
// The grader judges CASES: a case passes iff its output is accepted and
// decodes to f(x) — a rejected output and a wrong value fail identically. A
// Stage-1-invalid machine fails every case (0/total), never `skipped`. Points —
// 1 when every case passes, ½ by a question's `half_credit_at` rule, a human's
// grade over either — are NOT decided here: engine/score.ts is the one grade
// definition (task 061). The answer key in each case (expected/got) is recorded for
// the INSTRUCTOR only (server/src/sanitize.ts).
//
// Everything up to "decode" — Stage 1, the grading circuit, running one case —
// lives in engine/caseRun.ts, which never sees an expected output; this module
// is that plus the comparison. The student's replay of a failed case (store
// `loadCaseInput`) runs the same functions, so it is the grader's run.

import type {
  CircuitData,
  AssignmentData,
  AssignmentQuestion,
  SubmissionData,
  TestCase,
  TurbotCaseResult,
  PerceptionTestCase,
  PerceptionCaseResult,
  CaseResult,
  QuestionResult,
  SubmissionResult,
} from '../types';
import { questionTask } from '../types';
import { fillInKeyProblem, gradeFillIn, isReviewTable } from './fillIn';
import { notationForRepresentation } from './tmCodec';
import {
  gradingCircuit,
  questionLayout,
  validateQuestionMachine,
  runValidatedValueCase,
  runValidatedTurbotCase,
  rejectedTurbotCase,
  runPerceptionFilm,
  type ValueCaseRun,
} from './caseRun';

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

/** A case's TM block separations, carried onto its result only when the case
 *  has them: they are part of the INPUT (the tape the grader laid out), so a
 *  student replaying the case — whose copy of the question has no bank —
 *  gets the grader's tape (engine/caseRun.ts, store loadCaseInput). */
function layoutHint(tc: TestCase): Pick<CaseResult, 'separations'> {
  return tc.separations ? { separations: tc.separations } : {};
}

function reject(tc: TestCase, reason: string): CaseResult {
  return { input: tc.inputs, expected: tc.outputs, got: [], pass: false, reason, ...layoutHint(tc) };
}

/** Hold one case's run (engine/caseRun.ts) against the bank's answer. The
 *  tape axis decodes a single value and compares it alone. */
function caseResult(tc: TestCase, run: ValueCaseRun, tape: boolean): CaseResult {
  if (run.reason !== undefined) return reject(tc, run.reason);
  const pass = tape ? run.got[0] === tc.outputs[0] : valuesEqual(run.got, tc.outputs);
  return { input: tc.inputs, expected: tc.outputs, got: run.got, pass, ...layoutHint(tc) };
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
    reason: 'open question (needs manual review)',
    response: responseText ?? '',
    passed: 0,
    total: 0,
    cases: [],
  };
}

/**
 * Fill-in grading: one case per blank (a string comparison), per key row of
 * a table (graded as a function, order-free) or per box of an invented
 * numeral (graded by rule against the student's own symbols, task 080 — no
 * key, so its empty `fill_in_answers` is sound: whether a key fits is the
 * shape's to say, engine/fillIn.ts fillInKeyProblem), all-or-nothing at the
 * question level like every other mode (passed === total ⇒ the question
 * passes). The per-case detail carries the expected answers, so it is
 * instructor-only — server/src/sanitize.ts strips it. A review table (no key
 * at all, task 048) is left `pending` for a person, like an open question;
 * its cells stay on the submission's answer (`fillAnswers`).
 */
function gradeFillInQuestion(
  question: AssignmentQuestion,
  fillAnswers: string[] | undefined,
): QuestionResult {
  const spec = question.fill_in!;
  const answers = question.fill_in_answers ?? [];
  if (isReviewTable(spec, answers)) {
    return { questionId: question.id, status: 'pending', reason: 'table (needs manual review)', passed: 0, total: 0, cases: [] };
  }
  const problem = fillInKeyProblem(spec, answers);
  if (problem) return skip(question.id, problem);
  const fillCases = gradeFillIn(spec, answers, fillAnswers);
  return {
    questionId: question.id,
    status: 'graded',
    passed: fillCases.filter((c) => c.pass).length,
    total: fillCases.length,
    cases: [],
    fillCases,
  };
}

/**
 * Grade a single question's circuit against its numeric test cases.
 * `responseText` is the free-text answer for open questions, `fillAnswers`
 * the typed blanks of a fill-in question (each unused otherwise).
 *
 * Results are PARALLEL to the question's banks: `cases[k]` is `test_cases[k]`
 * and `turbotCases[k]` is `turbot_cases[k]` (a replay of case k relies on it).
 */
export function gradeQuestion(
  question: AssignmentQuestion,
  circuit: CircuitData | undefined,
  responseText?: string,
  fillAnswers?: string[],
): QuestionResult {
  // The question's task (types.ts questionTask) picks the branch — the same
  // classifier that picks the student's panel and what the answer carries.
  const task = questionTask(question);
  // A fill-in question is an open question that CAN be autograded: string
  // answers, no machine to run (engine/fillIn.ts).
  if (task === 'fill-in') return gradeFillInQuestion(question, fillAnswers);
  if (task === 'open') return pendingOpen(question.id, responseText);
  if (!circuit) return skip(question.id, 'no circuit submitted');
  // Every machine is graded from rest: MEMs at 0, whatever the saved circuit
  // carried from the student's last UI run (engine/caseRun.ts).
  const machine = gradingCircuit(circuit);
  if (task === 'turbot') return gradeTurbot(question, machine);
  if (task === 'perception') return gradePerception(question, machine);

  const cases = question.test_cases;
  if (!cases || cases.length === 0) return skip(question.id, 'question has no test cases');

  // Stage 1 (engine/caseRun.ts validateQuestionMachine): the question-wide
  // component restriction and budget first, then the per-mode interface or
  // table check. A question whose group widths are unknown (no cc_spec on a
  // space/time axis) cannot be graded at all — skipped, not failed. An
  // invalid machine fails every case with the reason, no testing.
  const valid = validateQuestionMachine(question, machine);
  if (valid.skip) return skip(question.id, valid.reason!);
  if (!valid.ok) return failEvery(question.id, cases, valid.reason!);

  // Stage 2: run each case (encode → run → accept → decode) and compare.
  const layout = questionLayout(question)!;
  const tape = layout.axis === 'tape';
  const results = cases.map((tc) =>
    caseResult(tc, runValidatedValueCase(question, machine, layout, tc.inputs, tc.separations), tape),
  );
  return tally(question.id, results);
}

/**
 * Perception grading — bit-level, outside the value codec (engine/perception.ts).
 * The retina's raw frames go straight to the CC/SC engine and the single output
 * bit is compared per time step; a case passes iff every step matches.
 */
function gradePerception(question: AssignmentQuestion, circuit: CircuitData): QuestionResult {
  const mode = question.buildMode;
  if (mode !== 'CC' && mode !== 'SC') {
    return skip(question.id, `perception questions must be CC or SC (got ${mode})`);
  }

  const cases = question.perception_cases;
  if (!cases || cases.length === 0) return skip(question.id, 'question has no perception cases');

  // Stage 1 (validateQuestionMachine): the question-wide component rules,
  // then the retina interface (width input wires, one output wire). Invalid
  // ⇒ fail every case with the reason, never `skipped`.
  const valid = validateQuestionMachine(question, circuit);
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

  const results = cases.map((tc) => gradePerceptionCase(question, circuit, tc));
  const passed = results.filter((c) => c.pass).length;
  return { questionId: question.id, status: 'graded', passed, total: results.length, cases: [], perceptionCases: results };
}

function gradePerceptionCase(
  question: AssignmentQuestion,
  circuit: CircuitData,
  tc: PerceptionTestCase,
): PerceptionCaseResult {
  const got = runPerceptionFilm(question, circuit, tc.frames);
  const mismatch = tc.expected.findIndex((e, t) => got[t] !== e);
  return {
    pass: mismatch < 0,
    frames: tc.frames,
    expected: tc.expected,
    got,
    failStep: mismatch < 0 ? undefined : mismatch + 1,
  };
}

/** Turbot grading — runs the arena driver loop per case and checks the
 *  success criterion (engine/caseRun.ts runValidatedTurbotCase). */
function gradeTurbot(question: AssignmentQuestion, circuit: CircuitData): QuestionResult {
  const innerMode = question.innerMode;
  if (!innerMode) return skip(question.id, 'question has no inner mode (CC/SC/FSM/TM) set');

  const cases = question.turbot_cases;
  if (!cases || cases.length === 0) return skip(question.id, 'question has no turbot cases');

  // Stage 1 (validateQuestionMachine): the question-wide component rules,
  // then the brain's own validator per inner mode.
  const valid = validateQuestionMachine(question, circuit);
  if (!valid.ok) {
    const rejected: TurbotCaseResult[] = cases.map((tc) => rejectedTurbotCase(tc, valid.reason));
    return { questionId: question.id, status: 'graded', passed: 0, total: rejected.length, cases: [], turbotCases: rejected };
  }

  // The question's encoding (representation) picks a turbot TM's internal
  // tape alphabet: binary {0,1,*}, unary (tally) {0,1}.
  const notation = notationForRepresentation(question.representation ?? 'binary');
  const turbotCases = cases.map((tc) =>
    runValidatedTurbotCase(circuit, innerMode, tc, notation, question.maxTapeCells),
  );
  const passed = turbotCases.filter((c) => c.pass).length;
  return { questionId: question.id, status: 'graded', passed, total: turbotCases.length, cases: [], turbotCases };
}

/**
 * Grade a full submission against an assignment definition. Matches each
 * assignment question to its submitted answer by question id.
 */
export function gradeSubmission(assignment: AssignmentData, submission: SubmissionData): SubmissionResult {
  const byId = new Map(submission.answers.map((a) => [a.questionId, a]));

  const questions = assignment.questions.map((q) => {
    const answer = byId.get(q.id);
    return gradeQuestion(q, answer?.circuit, answer?.responseText, answer?.fillAnswers);
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

