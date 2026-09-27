// A released submission's grade, "82.5 / 100" — from engine/score.ts, the one
// grade definition (task 061), so Home's row, the Grades tab's row and the
// grade sheet can't disagree. It needs the assignment's questions (the score
// is per problem), which a row's summary doesn't carry, so it reads them.

import type { SubmissionRecord } from '../types';
import { getAssignment } from '../assignments';
import { useAsyncValue } from '../useAsyncValue';
import { formatGrade, scoreRecord } from '../engine/score';

export function RecordGrade({ assignmentId, record }: { assignmentId: string; record: SubmissionRecord }) {
  const { value: assignment } = useAsyncValue(() => getAssignment(assignmentId), [assignmentId]);
  if (!assignment || !record.result) return <>…</>;
  const score = scoreRecord(assignment.questions, record, Date.now());
  if (score.final === null) return null;
  return (
    <span title={score.provisional ? 'Some problems are still awaiting review — the grade may rise.' : undefined}>
      {formatGrade(score.final)} / 100{score.provisional ? ' (provisional)' : ''}
    </span>
  );
}
