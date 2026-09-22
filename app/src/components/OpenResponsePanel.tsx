import type { ClipboardEvent, DragEvent } from 'react';
import { useStore, selectQuestionLocked } from '../store';
import { ProblemBody, ProblemContext } from './ProblemSetDocument';

/**
 * The workspace for an open (free-text) question — the text-panel analogue of
 * the circuit canvas. Same chrome as every other question (nav bar, autosave,
 * Submit), but the "canvas" is one writing area bound to the store's
 * openResponse, which persists/travels exactly like a circuit.
 *
 * Copy, cut, paste, and drag-and-drop are blocked in the writing area to
 * discourage pasting in prepared (or generated) text and copying answers out —
 * students type their answer here. This is a soft deterrent, not a security
 * boundary.
 */
export function OpenResponsePanel() {
  const assignment = useStore((s) => s.assignment);
  const currentQuestionIndex = useStore((s) => s.currentQuestionIndex);
  const question = assignment?.questions[currentQuestionIndex];
  const response = useStore((s) => s.openResponse);
  const setOpenResponse = useStore((s) => s.setOpenResponse);
  const locked = useStore(selectQuestionLocked);

  if (!assignment || !question) return null;

  const block = (e: ClipboardEvent | DragEvent) => e.preventDefault();
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
          onCopy={block}
          onCut={block}
          onPaste={block}
          onDrop={block}
          placeholder="Type your answer here…"
          spellCheck
          readOnly={locked}
        />
        <div className="open-response-foot">
          <span>{words} word{words === 1 ? '' : 's'}</span>
          <span>
            {locked
              ? 'Marked done — unlock this question to keep editing.'
              : "Saved automatically — submit the assignment when you're done."}
          </span>
        </div>
      </div>
    </div>
  );
}
