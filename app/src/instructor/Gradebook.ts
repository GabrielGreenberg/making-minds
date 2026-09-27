// Gradebook seam (pure helpers).
//
// Grades stored submission records against an assignment by delegating to the
// existing autograder (engine/grader.ts) and the one grade definition
// (engine/score.ts) — this module never re-implements grading or scoring, it
// only rolls them up into the shapes the gradebook UI needs. Reads from the SubmissionStore today; a server query drops
// in at the call site (GradebookView) without changing these helpers.

import type { AssignmentData, ManualReview, SubmissionRecord } from '../types';
import { gradeSubmission } from '../engine/grader';
import { scoreRecord, type Points, type ProblemSource, type Score } from '../engine/score';

export interface QuestionGrade {
  questionId: number;
  /** The problem's points, from engine/score.ts; null = awaiting a person. */
  points: Points | null;
  source: ProblemSource;
  passed: boolean; // full credit (points === 1)
  failedCount: number; // test vectors that didn't match (a ✗ review counts 1)
  pending: boolean; // awaiting a person — earns nothing yet, the grade is provisional
  manual?: ManualReview; // open question: the instructor's recorded verdict
}

export interface SubmissionGrade {
  record: SubmissionRecord;
  grades: QuestionGrade[];
  /** The one grade definition's verdict on this attempt (engine/score.ts). */
  score: Score;
}

/** Every record's per-problem points and grade, over the assignment as it is
 *  NOW (a problem added since shows as pending; a removed one is gone). */
export function gradeSubmissions(
  assignment: AssignmentData,
  records: SubmissionRecord[],
  now = Date.now(),
): SubmissionGrade[] {
  return records.map((record) => {
    // Prefer the grade computed at submission time (the "server" autogrades on
    // receipt). Fall back to grading on the fly for legacy records saved before
    // autograde-on-submit existed.
    const result = record.result ?? gradeSubmission(assignment, record.submission);
    const score = scoreRecord(assignment.questions, { ...record, result }, now);
    const byId = new Map(result.questions.map((r) => [r.questionId, r]));
    const grades = score.problems.map((p): QuestionGrade => {
      const r = byId.get(p.questionId);
      return {
        questionId: p.questionId,
        points: p.points,
        source: p.source,
        passed: p.points === 1,
        failedCount: !r ? 0 : r.status === 'pending' ? (p.points === 0 ? 1 : 0) : r.total - r.passed,
        pending: p.points === null,
        manual: r?.manual,
      };
    });
    return { record, grades, score };
  });
}

export interface GradebookStats {
  submissionCount: number;
  passByQuestion: Record<number, number>; // questionId → full-credit rate (0..1)
  /** Mean final grade out of 100 over the graded attempts (0 when none). */
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

  const finals = grades.flatMap((g) => (g.score.final === null ? [] : [g.score.final]));
  const meanScore = finals.length > 0 ? finals.reduce((sum, f) => sum + f, 0) / finals.length : 0;

  return { submissionCount, passByQuestion, meanScore };
}
