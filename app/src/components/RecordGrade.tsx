// A released submission's grade, "82.5 / 100" — from engine/score.ts, the one
// grade definition (task 061), so Home's row, the Grades tab's row and the
// grade sheet can't disagree. It needs the assignment's questions (the score
// is per problem), which a row's summary doesn't carry, so it reads them —
// the student's served copy, whose due date is their effective one, priced
// by the course calendar net of any waiver (task 068).

import type { SubmissionRecord } from '../types';
import { getAssignment } from '../assignments';
import { useAsyncValue } from '../useAsyncValue';
import { formatGrade, scoreRecord } from '../engine/score';
import { dueInput } from '../lateContext';
import { COURSE_CALENDAR } from '../courseCalendar';

export function RecordGrade({ assignmentId, record }: { assignmentId: string; record: SubmissionRecord }) {
  const { value: assignment } = useAsyncValue(() => getAssignment(assignmentId), [assignmentId]);
  if (!assignment || !record.result) return <>…</>;
  const score = scoreRecord(assignment.questions, record, Date.now(), dueInput(assignment, { waived: record.lateWaived }, COURSE_CALENDAR));
  if (score.final === null) return null;
  return (
    <span title={score.provisional ? 'Some problems are still awaiting review. The grade may rise.' : undefined}>
      {formatGrade(score.final)} / 100{score.provisional ? ' (provisional)' : ''}
    </span>
  );
}
