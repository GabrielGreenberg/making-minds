// The student's effective due date and late policy, as ONE pair of helpers
// (task 068; design memo docs/buildout/designs/grading-interface.md §4.6–§4.7)
// — every surface that prices lateness asks here, so the matrix, the
// submission page, the student's sheet and the submit dialog can't disagree:
//
//   dueInput     what engine/score.ts takes as `due`: the extension ?? the
//                assignment's date, and — only with a calendar — the policy
//                and any waiver. No calendar, no deduction (never a silent −5).
//   studentCopy  the assignment as served to THAT student: their effective
//                date as `dueDate`, marked `dueExtended`. Only ever a
//                student's copy — an instructor's is the one the editor saves
//                back, and an overlaid date would be written into it.
//
// Pure: no storage, no clock — the server imports it.

import type { AssignmentData, LateExtension } from './types';
import type { CourseCalendar, ScoreInput } from './engine/score';

export function dueInput(
  assignment: Pick<AssignmentData, 'dueDate' | 'latePolicy'>,
  student: { extension?: Pick<LateExtension, 'dueDate'>; waived?: number } = {},
  calendar?: CourseCalendar,
): ScoreInput['due'] {
  const at = student.extension?.dueDate ?? assignment.dueDate;
  if (!at) return undefined;
  return {
    at,
    ...(calendar
      ? { late: { policy: assignment.latePolicy ?? 'per-meeting', calendar, ...(student.waived ? { waived: student.waived } : {}) } }
      : {}),
  };
}

export function studentCopy<T extends Pick<AssignmentData, 'dueDate'>>(
  assignment: T,
  extension?: Pick<LateExtension, 'dueDate'>,
): T & { dueExtended?: true } {
  return extension ? { ...assignment, dueDate: extension.dueDate, dueExtended: true } : assignment;
}
