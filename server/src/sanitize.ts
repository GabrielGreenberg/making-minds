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
// Grading detail is instructor-only too: students never see per-case
// input/expected/got (spec: "Failing cases are recorded for the INSTRUCTOR
// only"), so student-facing results keep only the per-question roll-up.

import type {
  AssignmentData,
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

function stripQuestionResult(qr: QuestionResult): QuestionResult {
  return {
    ...qr,
    cases: [],
    turbotCases: qr.turbotCases ? [] : undefined,
    // perceptionCases carry frames + expected + got — the perception answer
    // key. Leaked to students until 2026-07-08; pinned by tools/parityCheck.ts.
    perceptionCases: qr.perceptionCases ? [] : undefined,
    // fillCases carry the expected answer per blank — the fill-in key.
    fillCases: qr.fillCases ? [] : undefined,
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
