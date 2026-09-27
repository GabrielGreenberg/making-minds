// The one Submit dialog (task 062). Every place a student submits — a Home
// row, the assignment's document page, the editor's top bar — opens this,
// so what a student is told before submitting (the snapshot, "only your most
// recent submission is graded", the integrity sentence: provenance/notice.ts;
// past the student's effective due date, what submitting now costs:
// dueDates.ts submitLateWarning, task 068) and how a failure is reported
// can't drift between them. It also carries
// the optional group listing: up to two classmates from the roster, names
// only (memo docs/buildout/designs/grading-interface.md §6.7).
//
// Submit stays online-only: a failure records nothing and asks for a visible
// retry, never a silent (late) queue; the work itself is autosaved. The grade
// is never shown here — students see grades only once they are released.

import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { getCurrentUserEmail } from '../auth';
import { submissionStore } from '../storage/backend';
import { useAsyncValue } from '../useAsyncValue';
import { submitConfirmMessage } from '../provenance/notice';
import { MAX_GROUP_OTHERS, SubmitRefused } from '../submissionGroup';
import { submitLateWarning } from '../dueDates';
import { COURSE_CALENDAR } from '../courseCalendar';
import type { AssignmentData, Classmate, SubmissionRecord } from '../types';

type Phase =
  | { kind: 'confirm'; error?: string }
  | { kind: 'busy' }
  | { kind: 'done'; record: SubmissionRecord };

export function SubmitDialog({
  assignment,
  saved = false,
  onClose,
}: {
  /** The assignment as served to this student — its `dueDate` is their
   *  effective one (an extension, task 068). */
  assignment: Pick<AssignmentData, 'id' | 'title' | 'dueDate' | 'latePolicy'>;
  /** Submitting from outside the editor records the SAVED work (a Home row). */
  saved?: boolean;
  onClose: () => void;
}) {
  const { id: assignmentId, title } = assignment;
  const submitAssignment = useStore((s) => s.submitAssignment);
  const lastGroup = useStore((s) => s.submissions[assignmentId]?.submission.group);
  const lastSubmittedAt = useStore((s) => s.submissions[assignmentId]?.submittedAt ?? null);
  // Past the effective due date: what submitting now costs, and whether it
  // unseats an on-time attempt (only the latest counts). Read once, on open.
  const [lateWarning] = useState(() =>
    submitLateWarning({
      now: Date.now(),
      dueDate: assignment.dueDate,
      policy: assignment.latePolicy,
      calendar: COURSE_CALENDAR,
      previousSubmittedAt: lastSubmittedAt,
    }),
  );
  const classmates = useAsyncValue(() => submissionStore.listClassmates(), []);
  const [members, setMembers] = useState<string[]>(() => Array(MAX_GROUP_OTHERS).fill(''));
  const [phase, setPhase] = useState<Phase>({ kind: 'confirm' });
  const busy = phase.kind === 'busy';

  // A resubmission starts from the group the last attempt listed — only the
  // keys still on the roster.
  const roster = classmates.value;
  useEffect(() => {
    if (!roster || !lastGroup?.length) return;
    const known = lastGroup.filter((k) => roster.some((c) => c.key === k)).slice(0, MAX_GROUP_OTHERS);
    setMembers((m) => (m.some(Boolean) ? m : [...known, ...Array(MAX_GROUP_OTHERS - known.length).fill('')]));
  }, [roster, lastGroup]);

  const close = () => {
    if (!busy) onClose();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const submit = async () => {
    setPhase({ kind: 'busy' });
    const group = members.filter(Boolean);
    try {
      const record = await submitAssignment(assignmentId, getCurrentUserEmail(), { group });
      if (!record) {
        setPhase({ kind: 'confirm', error: 'This assignment could not be found — reload the page and try again.' });
        return;
      }
      setPhase({ kind: 'done', record });
    } catch (err) {
      setPhase({
        kind: 'confirm',
        error:
          err instanceof SubmitRefused
            ? `Not submitted: ${err.message}`
            : 'Submission failed — the server could not be reached, and nothing was recorded. ' +
              'Your work is still saved. Please try Submit again in a moment.',
      });
    }
  };

  const nameOf = (key: string) => roster?.find((c) => c.key === key)?.name ?? 'a classmate';

  return (
    <div className="mm-modal-backdrop" onClick={close}>
      <div
        className="mm-modal mm-modal--narrow mm-surface"
        role="dialog"
        aria-modal="true"
        aria-labelledby="submit-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mm-modal-head">
          <h2 id="submit-dialog-title">{phase.kind === 'done' ? 'Submitted' : 'Submit assignment'}</h2>
        </div>
        {phase.kind === 'done' ? (
          <>
            <p className="mm-modal-sub">{title}</p>
            <p className="mm-note">
              Attempt {phase.record.attempt} is recorded. Grades will appear under Grades once your
              instructor releases them.
            </p>
            {phase.record.submission.group?.length ? (
              <p className="mm-note submit-group-done">
                Group listed: {phase.record.submission.group.map(nameOf).join(', ')}.
              </p>
            ) : null}
            <div className="mm-actions submit-actions">
              <button type="button" className="mm-btn mm-btn--primary" autoFocus onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            {/* The notice names the assignment in its first line. */}
            {submitConfirmMessage(title, { saved }).split('\n\n').map((para, i) => (
              <p key={i} className="mm-note submit-para">{para}</p>
            ))}
            {lateWarning && <p className="mm-warn submit-para">{lateWarning}</p>}
            <GroupPicker
              classmates={roster}
              loading={classmates.loading}
              failed={classmates.error != null}
              members={members}
              disabled={busy}
              onChange={setMembers}
            />
            {phase.kind === 'confirm' && phase.error && <p className="mm-error submit-error">{phase.error}</p>}
            <div className="mm-actions submit-actions">
              <button type="button" className="mm-btn" onClick={close} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="mm-btn mm-btn--primary" onClick={() => void submit()} disabled={busy}>
                {busy ? 'Submitting…' : 'Submit'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Up to MAX_GROUP_OTHERS classmates, each a select over the roster's names
 *  (a classmate chosen in one select is not offered in the other). Never
 *  blocks Submit: an empty or unreachable class list just means no group. */
function GroupPicker({
  classmates,
  loading,
  failed,
  members,
  disabled,
  onChange,
}: {
  classmates: Classmate[] | undefined;
  loading: boolean;
  failed: boolean;
  members: string[];
  disabled: boolean;
  onChange: (members: string[]) => void;
}) {
  return (
    <fieldset className="submit-group">
      <legend className="mm-label">Group members (optional)</legend>
      <p className="mm-note submit-group-note">
        Worked with classmates? List them here — groups are at most 3 people, and each member lists
        the others on their own submission.
      </p>
      {loading ? (
        <p className="mm-note dim">Loading the class list…</p>
      ) : failed ? (
        <p className="mm-note dim">The class list couldn't be loaded — you can still submit without listing a group.</p>
      ) : !classmates?.length ? (
        <p className="mm-note dim">No classmates are on the roster yet.</p>
      ) : (
        <div className="submit-group-selects">
          {members.map((key, i) => (
            <select
              key={i}
              className="mm-input"
              aria-label={`Group member ${i + 1}`}
              value={key}
              disabled={disabled}
              onChange={(e) => onChange(members.map((m, j) => (j === i ? e.target.value : m)))}
            >
              <option value="">— none —</option>
              {classmates
                .filter((c) => c.key === key || !members.includes(c.key))
                .map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.name}
                  </option>
                ))}
            </select>
          ))}
        </div>
      )}
    </fieldset>
  );
}
