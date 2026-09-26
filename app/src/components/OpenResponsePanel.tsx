import { useStore, selectLockNotice } from '../store';
import { usePasteGuard } from '../usePasteGuard';

/**
 * The workspace for an open (free-text) question — the text-panel analogue of
 * the circuit canvas, in the editor frame's centre (EditorShell; the question
 * itself is in the question panel beside it). One writing area bound to the
 * store's openResponse, which persists/travels exactly like a circuit.
 *
 * The writing area wears the provenance guard (usePasteGuard; law 8): the
 * student may copy, cut and paste their OWN assignment text, but text from
 * outside the assignments (another app, a chat, the sandbox) is refused with a
 * notice, and nothing copied here reaches the system clipboard.
 */
export function OpenResponsePanel() {
  const assignment = useStore((s) => s.assignment);
  const currentQuestionIndex = useStore((s) => s.currentQuestionIndex);
  const question = assignment?.questions[currentQuestionIndex];
  const response = useStore((s) => s.openResponse);
  const setOpenResponse = useStore((s) => s.setOpenResponse);
  // Why the question refuses edits (marked done, or it shows a submission).
  const lockNotice = useStore(selectLockNotice);
  const locked = lockNotice !== null;
  const { ref: pasteGuardRef, notice: pasteNotice } = usePasteGuard();

  if (!assignment || !question) return null;

  return (
    <div className="wb-answer mm-surface">
      <div className="wb-answer-inner">
        <div className="eyebrow wb-answer-eyebrow">Your answer</div>
        <textarea
          className="wb-answer-text"
          value={response}
          onChange={(e) => setOpenResponse(e.target.value)}
          ref={pasteGuardRef}
          placeholder="Write your answer here."
          aria-label={`Your answer to ${question.label}`}
          spellCheck
          readOnly={locked}
        />
        <AnswerFoot pasteNotice={pasteNotice} lockNotice={lockNotice} />
      </div>
    </div>
  );
}

/** The answer area's one line: a refused paste, else why the question is
 *  read-only, else how saving is going — "Saved as you type." unless a
 *  remote save is failing, when it never claims to be saved. */
export function AnswerFoot({ pasteNotice, lockNotice }: { pasteNotice: string | null; lockNotice: string | null }) {
  const saveFailing = useStore((s) => s.autoSaveStatus === 'error');
  if (pasteNotice) return <div className="wb-answer-foot paste-notice" role="status">{pasteNotice}</div>;
  if (lockNotice) return <div className="wb-answer-foot">{lockNotice}</div>;
  if (saveFailing) {
    return (
      <div className="wb-answer-foot wb-answer-foot--error">
        Not saved yet — your answer is kept in this browser, and saving retries on its own.
      </div>
    );
  }
  return <div className="wb-answer-foot">Saved as you type.</div>;
}
