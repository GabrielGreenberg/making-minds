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
// whole, same as `turbot_cases` above.

import type {
  AssignmentData,
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

/** Keep `input`/`pass`/`reason` (safe — see header); blank the answer key. */
function stripCaseResult(c: CaseResult): CaseResult {
  return { input: c.input, expected: [], got: [], pass: c.pass, reason: c.reason };
}

function stripPerceptionCaseResult(c: PerceptionCaseResult): PerceptionCaseResult {
  return { pass: c.pass, frames: c.frames, expected: [], got: [], failStep: c.failStep, reason: c.reason };
}

function stripFillInCaseResult(c: FillInCaseResult): FillInCaseResult {
  return { label: c.label, expected: '', got: '', pass: c.pass };
}

function stripQuestionResult(qr: QuestionResult): QuestionResult {
  return {
    ...qr,
    cases: qr.cases.map(stripCaseResult),
    turbotCases: qr.turbotCases, // no answer key in this shape — passes through whole
    perceptionCases: qr.perceptionCases?.map(stripPerceptionCaseResult),
    fillCases: qr.fillCases?.map(stripFillInCaseResult),
  };
}

/** Grade as shown to the student: scores only, no per-case detail. */
export function stripResultDetail(result: SubmissionResult): SubmissionResult {
  return { ...result, questions: result.questions.map(stripQuestionResult) };
}

/**
 * A student's own submission record. Grades are withheld entirely until the
 * instructor releases them for the assignment ("release grades"); once
 * released, the student sees scores but never the per-case detail.
 */
export function studentRecord(record: SubmissionRecord, gradesReleased: boolean): SubmissionRecord {
  return {
    ...record,
    result: gradesReleased && record.result ? stripResultDetail(record.result) : undefined,
  };
}
