// What students are allowed to see.
//
// The DB stores full AssignmentData — including `test_cases`, which are the
// answers ("Things to watch": test cases must not ship to the client in
// production). Instructors get the full object; students get a copy with
// `test_cases` removed. `turbot_cases` stay: the student UI renders the arena
// (the Map) from them, and an arena + success criterion is part of the question
// statement, not the answer key.
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
      const { test_cases: _hidden, ...rest } = q;
      return { ...rest, test_cases: [] };
    }),
  };
}

function stripQuestionResult(qr: QuestionResult): QuestionResult {
  return { ...qr, cases: [], turbotCases: qr.turbotCases ? [] : undefined };
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
