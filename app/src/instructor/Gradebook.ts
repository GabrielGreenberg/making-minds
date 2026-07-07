// Gradebook seam (pure helpers).
//
// Grades stored submission records against an assignment by delegating to the
// existing autograder (engine/grader.ts) — this module never re-implements
// grading, it only rolls the per-question results up into the shapes the
// gradebook UI needs. Reads from the SubmissionStore today; a server query drops
// in at the call site (GradebookView) without changing these helpers.

import type { AssignmentData, ManualReview, SubmissionRecord } from '../types';
import { gradeSubmission, type QuestionResult } from '../engine/grader';

export interface QuestionGrade {
  questionId: number;
  passed: boolean; // all gradeable test vectors matched / manual verdict = correct
  failedCount: number; // number of test vectors that didn't match
  pending: boolean; // open question still awaiting manual review — excluded from the score
  manual?: ManualReview; // open question: the instructor's recorded verdict
}

export interface SubmissionGrade {
  record: SubmissionRecord;
  grades: QuestionGrade[];
  score: number; // fraction: passed questions / scoreable questions (0..1)
}

function toQuestionGrade(r: QuestionResult): QuestionGrade {
  // An open question with a recorded manual verdict counts like any other
  // question (the verdict is its pass/fail); without one it stays pending.
  if (r.status === 'pending') {
    return {
      questionId: r.questionId,
      passed: r.manual?.pass ?? false,
      failedCount: r.manual && !r.manual.pass ? 1 : 0,
      pending: !r.manual,
      manual: r.manual,
    };
  }
  const passed = r.status === 'graded' && r.total > 0 && r.passed === r.total;
  return {
    questionId: r.questionId,
    passed,
    failedCount: r.total - r.passed,
    pending: false,
  };
}

export function gradeSubmissions(
  assignment: AssignmentData,
  records: SubmissionRecord[],
): SubmissionGrade[] {
  return records.map((record) => {
    // Prefer the grade computed at submission time (the "server" autogrades on
    // receipt). Fall back to grading on the fly for legacy records saved before
    // autograde-on-submit existed.
    const result = record.result ?? gradeSubmission(assignment, record.submission);
    const grades = result.questions.map(toQuestionGrade);
    // Unreviewed open questions have no grade yet, so the score is over the
    // autogradeable questions plus manually reviewed open questions.
    const gradeable = grades.filter((g) => !g.pending);
    const passedQuestions = gradeable.filter((g) => g.passed).length;
    const score = gradeable.length > 0 ? passedQuestions / gradeable.length : 0;
    return { record, grades, score };
  });
}

export interface GradebookStats {
  submissionCount: number;
  passByQuestion: Record<number, number>; // questionId → pass rate (0..1)
  meanScore: number;
}

export function computeStats(
  grades: SubmissionGrade[],
  assignment: AssignmentData,
): GradebookStats {
  const submissionCount = grades.length;
  const passByQuestion: Record<number, number> = {};

  for (const q of assignment.questions) {
    const passes = grades.filter(
      (g) => g.grades.find((qg) => qg.questionId === q.id)?.passed,
    ).length;
    passByQuestion[q.id] = submissionCount > 0 ? passes / submissionCount : 0;
  }

  const meanScore =
    submissionCount > 0
      ? grades.reduce((sum, g) => sum + g.score, 0) / submissionCount
      : 0;

  return { submissionCount, passByQuestion, meanScore };
}
