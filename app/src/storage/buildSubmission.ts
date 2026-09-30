// The submission snapshot (task 087 split it out of submissionStore.ts, which
// re-exports it): pure — types and the empty canvas only — so the editor
// store builds a submission without importing the local submission store,
// its toy accounts or its grader.

import type { AssignmentData, QuestionCircuit, SubmissionData } from '../types';
import { questionTask } from '../types';
import { emptyQuestionCircuit } from './workbookStore';

/**
 * Build a submission snapshot from an assignment definition and the student's
 * per-question canvases. Pure (no storage/clock), so it's testable and works
 * identically whether the circuits come from live store state or persisted
 * state. Only the gradeable circuit (components + wires) is included per answer;
 * an open question's answer carries its free-text `responseText` instead.
 */
export function buildSubmission(
  def: AssignmentData,
  questionCircuits: Map<number, QuestionCircuit>,
  opts: { student?: string; submittedAt: string; group?: string[] },
): SubmissionData {
  const submission: SubmissionData = {
    assignmentTitle: def.title,
    student: opts.student?.trim() || undefined,
    submittedAt: opts.submittedAt,
    answers: def.questions.map((q) => {
      const c = questionCircuits.get(q.id) ?? emptyQuestionCircuit();
      const answer: SubmissionData['answers'][number] = {
        questionId: q.id,
        circuit: { components: c.components, wires: c.wires },
      };
      // A fill-in question's answer is its typed blanks; an open question's
      // is its prose (types.ts questionTask — the grader reads the same).
      const task = questionTask(q);
      if (task === 'fill-in') answer.fillAnswers = c.fillAnswers ?? [];
      else if (task === 'open') answer.responseText = c.responseText ?? '';
      // The signed editing record rides beside the answer (task 034): the
      // integrity check reads it, the grader never does.
      if (c.provenance) answer.provenance = c.provenance;
      return answer;
    }),
  };
  // The classmates listed at submit (task 062); absent when none.
  if (opts.group?.length) submission.group = [...opts.group];
  return submission;
}
