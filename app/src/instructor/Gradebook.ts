// Gradebook seam (pure helpers).
//
// Grades stored submission records against an assignment by delegating to the
// existing autograder (engine/grader.ts) — this module never re-implements
// grading, it only rolls the per-question results up into the shapes the
// gradebook UI needs. Reads from the SubmissionStore today; a server query drops
// in at the call site (GradebookView) without changing these helpers.

import type { AssignmentData, SubmissionRecord } from '../types';
import { gradeSubmission, type QuestionResult } from '../engine/grader';

export interface QuestionGrade {
  questionId: number;
  passed: boolean; // all gradeable test vectors matched
  failedCount: number; // number of test vectors that didn't match
}

export interface SubmissionGrade {
  record: SubmissionRecord;
  grades: QuestionGrade[];
  score: number; // fraction: passed questions / total questions (0..1)
}

function toQuestionGrade(r: QuestionResult): QuestionGrade {
  const passed = r.status === 'graded' && r.total > 0 && r.passed === r.total;
  return { questionId: r.questionId, passed, failedCount: r.total - r.passed };
}

export function gradeSubmissions(
  assignment: AssignmentData,
  records: SubmissionRecord[],
): SubmissionGrade[] {
  const totalQuestions = assignment.questions.length;
  return records.map((record) => {
    const result = gradeSubmission(assignment, record.submission);
    const grades = result.questions.map(toQuestionGrade);
    const passedQuestions = grades.filter((g) => g.passed).length;
    const score = totalQuestions > 0 ? passedQuestions / totalQuestions : 0;
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
