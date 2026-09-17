// Due-date display policy (pure, framework-agnostic — imported by the student
// home screen, the instructor gradebook, and tools/dueDateCheck.ts).
//
// A due date never gates SUBMITTING: submissions are accepted and graded
// whenever they arrive. `dueStatus`/`lateBy`/`formatDuration`/`formatDueDate`
// only ANSWER how to present a due date ("due soon", "overdue") and how late a
// given submission was. On-time submissions get no signal at all — `lateBy`
// returns 0 and callers render nothing.
//
// `isFrozen` (notes/todos.md item 3) is the one exception, and it gates
// EDITING, not submitting: once the due date has passed AND the student has
// at least one submission on file, their workbook stops being "the thing
// they're still working on" and becomes a read-only view of what they last
// submitted (store.ts's `selectAssignmentFrozen`/`isCurrentQuestionLocked`).
// A student who has never submitted is never frozen — nothing exists to
// freeze — so they can keep editing and submit late exactly as before; the
// moment they do, THAT submission is what freezes their view from then on.

/** "Due soon" horizon: less than this long until the deadline turns the badge amber. */
export const DUE_SOON_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

export type DueStatus = 'due-later' | 'due-soon' | 'overdue';

/**
 * Status of a due date as of `now`: 'due-later' (more than 3 days away, green),
 * 'due-soon' (less than 3 days away, amber), 'overdue' (deadline passed, red).
 */
export function dueStatus(dueDate: string, now: number): DueStatus {
  const due = new Date(dueDate).getTime();
  if (due < now) return 'overdue';
  return due - now < DUE_SOON_MS ? 'due-soon' : 'due-later';
}

/**
 * How late a submission was, in milliseconds. 0 when submitted at or before
 * the deadline — the "no signal" value.
 */
export function lateBy(dueDate: string, submittedAt: string): number {
  const ms = new Date(submittedAt).getTime() - new Date(dueDate).getTime();
  return ms > 0 ? ms : 0;
}

/**
 * A positive lateness in human terms: the largest unit plus one refinement
 * ("2 days, 4 hours" / "3 hours, 12 minutes" / "45 minutes"); anything under a
 * minute reads "less than a minute". Callers must not pass 0 — an on-time
 * submission gets no text at all.
 */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return 'less than a minute';
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const unit = (n: number, name: string) => `${n} ${name}${n === 1 ? '' : 's'}`;
  if (days > 0) return hours > 0 ? `${unit(days, 'day')}, ${unit(hours, 'hour')}` : unit(days, 'day');
  if (hours > 0)
    return minutes > 0 ? `${unit(hours, 'hour')}, ${unit(minutes, 'minute')}` : unit(hours, 'hour');
  return unit(minutes, 'minute');
}

/**
 * Should a submitted assignment's workbook show read-only? True only once
 * the due date has passed AND a submission already exists — see the header
 * comment. `dueDate` absent, or no submission yet, is never frozen.
 */
export function isFrozen(dueDate: string | undefined, now: number, hasSubmission: boolean): boolean {
  return hasSubmission && dueDate != null && dueStatus(dueDate, now) === 'overdue';
}

/** Short display form for a due date, e.g. "Jul 22, 5:00 PM". */
export function formatDueDate(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ', ' +
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  );
}
