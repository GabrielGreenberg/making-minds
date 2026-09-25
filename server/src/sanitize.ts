// What students are allowed to see.
//
// The DB stores full AssignmentData — including `test_cases` and (for
// perception questions) `perception_cases`, both of which are the answers
// ("Things to watch": test cases must not ship to the client in production;
// a perception case's `expected` bits are the classification key). Instructors
// get the full object; students get a copy with both banks removed.
// `turbot_cases` stay: the student UI renders the arena (the Map) from them,
// and an arena + success criterion is part of the question statement, not the
// answer key.
//
// Per-case grading detail: which INPUT a case used, whether it passed, and
// the (always-static, non-value-bearing) failure `reason` are safe — none of
// that is the answer key, and it's what notes/todos.md item 4 ("indicate
// failed test cases") shows students. What stays instructor-only is the
// ANSWER itself: `expected` (the key) and `got` (which the student can
// recompute live by loading the input into their own frozen circuit and
// running it, todos.md item 3 — no reason to ship it from the server too).
// TurbotCaseResult has no `expected`/`got` at all (grading is positional
// pass/fail against the arena's success criterion) so it passes through
// whole, same as `turbot_cases` above. A case's `separations` (TM block
// gaps, HW5 P4) stay too: they are INPUT layout — the tape the grader laid
// out — not the key, and without them a student replaying the case ("Run
// this input", store loadCaseInput) would get a different tape from the one
// that was graded. A result graded before cases recorded them gets them here,
// from this server's own bank (engine recordedCaseSeparations — case k, when
// it is still the same input): the student's copy has no bank to fall back on.

import { recordedCaseSeparations } from '../../app/src/engine/caseRun';
import type {
  AssignmentData,
  AssignmentQuestion,
  CaseResult,
  FillInCaseResult,
  PerceptionCaseResult,
  QuestionResult,
  SubmissionRecord,
  SubmissionResult,
} from '../../app/src/types';

/** Assignment as served to a student: no answer bank. */
export function stripAnswers(assignment: AssignmentData): AssignmentData {
  return {
    ...assignment,
    questions: assignment.questions.map((q) => {
      const {
        test_cases: _hidden,
        perception_cases: _alsoHidden,
        fill_in_answers: _key,
        ...rest
      } = q;
      // Perception questions keep their `perception` spec (retina width + rule
      // — that's the statement) but lose the generated case bank (the key);
      // fill-in questions keep their `fill_in` labels (they ARE the prompts)
      // and lose the answers.
      return { ...rest, test_cases: [], perception_cases: [], fill_in_answers: [] };
    }),
  };
}

/** Keep `input`/`pass`/`reason` and the case's `separations` (safe — see
 *  header); blank the answer key. `separations` is the recorded case's, or —
 *  a result graded before cases carried them — the bank's (`question`). */
function stripCaseResult(c: CaseResult, k: number, question: AssignmentQuestion | undefined): CaseResult {
  const separations = question ? recordedCaseSeparations(question, k, c) : c.separations;
  return {
    input: c.input,
    expected: [],
    got: [],
    pass: c.pass,
    reason: c.reason,
    ...(separations ? { separations } : {}),
  };
}

function stripPerceptionCaseResult(c: PerceptionCaseResult): PerceptionCaseResult {
  return { pass: c.pass, frames: c.frames, expected: [], got: [], failStep: c.failStep, reason: c.reason };
}

function stripFillInCaseResult(c: FillInCaseResult): FillInCaseResult {
  return { label: c.label, expected: '', got: '', pass: c.pass };
}

function stripQuestionResult(qr: QuestionResult, question: AssignmentQuestion | undefined): QuestionResult {
  return {
    ...qr,
    cases: qr.cases.map((c, k) => stripCaseResult(c, k, question)),
    turbotCases: qr.turbotCases, // no answer key in this shape — passes through whole
    perceptionCases: qr.perceptionCases?.map(stripPerceptionCaseResult),
    fillCases: qr.fillCases?.map(stripFillInCaseResult),
  };
}

/** Grade as shown to the student: scores only, no per-case detail.
 *  `assignment` (the full, server-side copy) fills in older results' case
 *  separations; without it they pass through as recorded. */
export function stripResultDetail(result: SubmissionResult, assignment?: AssignmentData): SubmissionResult {
  return {
    ...result,
    questions: result.questions.map((qr) =>
      stripQuestionResult(qr, assignment?.questions.find((q) => q.id === qr.questionId)),
    ),
  };
}

/**
 * A student's own submission record. Grades are withheld entirely until the
 * instructor releases them for the assignment ("release grades"); once
 * released, the student sees scores but never the per-case detail. The
 * integrity check (task 034) is instructor-only, released or not: it never
 * reaches a student. Pass the full `assignment` so a result graded before
 * cases recorded their TM block separations gets them (stripResultDetail).
 */
export function studentRecord(
  record: SubmissionRecord,
  gradesReleased: boolean,
  assignment?: AssignmentData,
): SubmissionRecord {
  const { integrity: _instructorOnly, ...rest } = record;
  return {
    ...rest,
    result: gradesReleased && record.result ? stripResultDetail(record.result, assignment) : undefined,
  };
}
