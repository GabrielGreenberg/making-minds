import { useStore, selectQuestionLocked } from '../store';
import { usePasteGuard } from '../usePasteGuard';
import { ProblemBody, ProblemContext } from './ProblemSetDocument';

/**
 * The workspace for an open (free-text) question — the text-panel analogue of
 * the circuit canvas. Same chrome as every other question (nav bar, autosave,
 * Submit), but the "canvas" is one writing area bound to the store's
 * openResponse, which persists/travels exactly like a circuit.
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
  const locked = useStore(selectQuestionLocked);
  const { ref: pasteGuardRef, notice: pasteNotice } = usePasteGuard();

  if (!assignment || !question) return null;

  const words = response.trim() === '' ? 0 : response.trim().split(/\s+/).length;

  return (
    <div className="open-response">
      <div className="open-response-card">
        <div className="open-response-head">
          <h2 className="open-response-label">{question.label}</h2>
          <span className="open-response-mode">open question</span>
        </div>
        <div className="open-response-statement">
          <ProblemContext assignment={assignment} questionId={question.id} />
          <ProblemBody question={question} />
        </div>
        <textarea
          className="open-response-textarea"
          value={response}
          onChange={(e) => setOpenResponse(e.target.value)}
          ref={pasteGuardRef}
          placeholder="Type your answer here…"
          spellCheck
          readOnly={locked}
        />
        <div className="open-response-foot">
          <span>{words} word{words === 1 ? '' : 's'}</span>
          {pasteNotice ? (
            <span className="paste-notice" role="status">{pasteNotice}</span>
          ) : (
            <span>
              {locked
                ? 'Marked done — unlock this question to keep editing.'
                : "Saved automatically — submit the assignment when you're done."}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
