import { useEffect, useState, type ReactNode } from 'react';
import { gradingStore } from '../storage/backend';
import type { LateWriteOutcome } from '../storage/gradingStore';
import { formatDueDate, toLocalInputValue } from '../dueDates';

/**
 * **Extension…** and **Waive…** for one student on one assignment (task 068;
 * memo grading-interface.md §4.6–§4.7) — on the submission page (067) and
 * the student page (interim StudentGradingView; task 070 rebuilds that page
 * and keeps these). Each opens a small dialog that writes through the
 * GradingStore (logged, both backends) and then `onChanged` re-reads.
 *
 * An extension is a date only — no reason field, by design; a waiver's note
 * says why the points were waived, never accommodation details (memo §9).
 */
export function LateAdjustControls({
  assignmentId,
  studentKey,
  assignmentDue,
  extendedTo,
  waiver,
  loadWaiverNote,
  canWaive = true,
  onChanged,
}: {
  assignmentId: string;
  studentKey: string;
  /** The assignment's own due date (the extension dialog starts from it). */
  assignmentDue?: string;
  /** The student's extension, when they have one. */
  extendedTo?: string;
  /** The current waiver; its note may be absent where the page lacks it —
   *  then `loadWaiverNote` fetches it when the dialog opens. */
  waiver?: { points: number; note?: string };
  loadWaiverNote?: () => Promise<string | undefined>;
  canWaive?: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState<'extension' | 'waiver' | null>(null);
  const done = () => {
    setOpen(null);
    onChanged();
  };
  return (
    <span className="late-adjust">
      <button type="button" className="mm-btn mm-btn--small" onClick={() => setOpen('extension')}>
        {extendedTo ? 'Extension ✎' : 'Extension…'}
      </button>
      {canWaive && (
        <button type="button" className="mm-btn mm-btn--small" onClick={() => setOpen('waiver')}>
          {waiver ? `Waived ${waiver.points} ✎` : 'Waive…'}
        </button>
      )}
      {open === 'extension' && (
        <ExtensionDialog
          current={extendedTo}
          start={extendedTo ?? assignmentDue}
          assignmentDue={assignmentDue}
          onClose={() => setOpen(null)}
          write={(dueDate) => gradingStore.setExtension(assignmentId, studentKey, dueDate)}
          onDone={done}
        />
      )}
      {open === 'waiver' && (
        <WaiverDialog
          current={waiver}
          loadNote={loadWaiverNote}
          onClose={() => setOpen(null)}
          write={(w) => gradingStore.setWaiver(assignmentId, studentKey, w)}
          onDone={done}
        />
      )}
    </span>
  );
}

/** The shared dialog frame: title, body, error, Clear (when there is
 *  something to clear), Cancel and Save. */
function LateDialog({
  title,
  sub,
  children,
  error,
  busy,
  canClear,
  onClear,
  onSave,
  onClose,
}: {
  title: string;
  sub: string;
  children: ReactNode;
  error: string | null;
  busy: boolean;
  canClear: boolean;
  onClear: () => void;
  onSave: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <div className="mm-modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="mm-modal mm-modal--narrow mm-surface" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="mm-modal-head">
          <h2>{title}</h2>
        </div>
        <p className="mm-modal-sub">{sub}</p>
        <div className="mm-form">{children}</div>
        {error && <p className="mm-error">{error}</p>}
        <div className="mm-actions late-adjust-actions">
          {canClear && (
            <button type="button" className="mm-btn" disabled={busy} onClick={onClear}>
              Clear
            </button>
          )}
          <button type="button" className="mm-btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="mm-btn mm-btn--primary" disabled={busy} onClick={onSave}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Run one write; a refusal stays in the dialog, success closes it. */
function useLateWrite<T, A>(write: (arg: A) => Promise<LateWriteOutcome<T>>, onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (arg: A) => {
    setBusy(true);
    setError(null);
    try {
      const out = await write(arg);
      if (out.ok) onDone();
      else setError(out.error);
    } catch {
      setError('Could not save — the server may be unreachable. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

function ExtensionDialog({
  current,
  start,
  assignmentDue,
  write,
  onClose,
  onDone,
}: {
  current?: string;
  start?: string;
  assignmentDue?: string;
  write: (dueDate: string | null) => Promise<LateWriteOutcome<unknown>>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [value, setValue] = useState(start ? toLocalInputValue(start) : '');
  const { busy, error, setError, run } = useLateWrite(write, onDone);
  const save = () => {
    if (!value) {
      setError('Pick a date and time — or Clear to remove the extension.');
      return;
    }
    void run(new Date(value).toISOString());
  };
  return (
    <LateDialog
      title="Extension"
      sub={
        (assignmentDue ? `The assignment is due ${formatDueDate(assignmentDue)}. ` : '') +
        'This student’s own due date replaces it for lateness, the late deduction and the freeze.'
      }
      error={error}
      busy={busy}
      canClear={current !== undefined}
      onClear={() => void run(null)}
      onSave={save}
      onClose={onClose}
    >
      <label className="mm-field">
        <span className="mm-label">Due for this student</span>
        <input className="mm-input" type="datetime-local" value={value} autoFocus onChange={(e) => setValue(e.target.value)} />
      </label>
      <p className="mm-note dim">No reason is recorded — accommodation details stay off the platform.</p>
    </LateDialog>
  );
}

function WaiverDialog({
  current,
  loadNote,
  write,
  onClose,
  onDone,
}: {
  current?: { points: number; note?: string };
  loadNote?: () => Promise<string | undefined>;
  write: (w: { points: number; note?: string } | null) => Promise<LateWriteOutcome<unknown>>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [points, setPoints] = useState(current ? String(current.points) : '');
  const [note, setNote] = useState(current?.note ?? '');
  const { busy, error, setError, run } = useLateWrite(write, onDone);
  useEffect(() => {
    if (!current || current.note !== undefined || !loadNote) return;
    let live = true;
    void loadNote().then((n) => {
      if (live && n) setNote((typed) => typed || n);
    });
    return () => {
      live = false;
    };
  }, [current, loadNote]);
  const save = () => {
    const n = Number(points);
    if (!Number.isInteger(n) || n < 1) {
      setError('Waive a whole number of points, at least 1 — or Clear to remove the waiver.');
      return;
    }
    void run({ points: n, ...(note.trim() ? { note: note.trim() } : {}) });
  };
  return (
    <LateDialog
      title="Waive late points"
      sub="Reduces this student’s late deduction on this assignment — never below zero. The student sees the points, not the note."
      error={error}
      busy={busy}
      canClear={current !== undefined}
      onClear={() => void run(null)}
      onSave={save}
      onClose={onClose}
    >
      <label className="mm-field">
        <span className="mm-label">Points waived</span>
        <input className="mm-input" type="number" min={1} max={100} step={1} value={points} autoFocus onChange={(e) => setPoints(e.target.value)} />
      </label>
      <label className="mm-field">
        <span className="mm-label">Note (optional, instructors only)</span>
        <textarea
          className="mm-input mm-input--area"
          rows={2}
          value={note}
          placeholder="No medical or accommodation details"
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
    </LateDialog>
  );
}
