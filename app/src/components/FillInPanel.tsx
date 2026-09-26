// The workspace for a fill-in-the-blank question — the open question's
// answer area narrowed to a grid of labelled boxes, in the editor frame's
// centre (EditorShell; the question itself is in the question panel). The
// answers live in the store's fillAnswers and persist/travel exactly like a
// circuit.
//
// Unlike an open question this one IS autograded (engine/fillIn.ts), so the
// boxes are the whole answer: no prose, and into a digits-only blank no
// characters but digits reach the store (engine/fillIn.ts fillInBlanks reads
// the flag, per blank). Every box wears the one provenance guard
// (usePasteGuard; law 8): only text copied in the student's own assignments
// pastes in, and nothing copied here reaches the system clipboard.

import { useStore, selectLockNotice } from '../store';
import { usePasteGuard } from '../usePasteGuard';
import { fillInBlanks } from '../engine/fillIn';
import { AnswerFoot } from './OpenResponsePanel';

export function FillInPanel() {
  const assignment = useStore((s) => s.assignment);
  const currentQuestionIndex = useStore((s) => s.currentQuestionIndex);
  const question = assignment?.questions[currentQuestionIndex];
  const answers = useStore((s) => s.fillAnswers);
  const setFillAnswer = useStore((s) => s.setFillAnswer);
  // Why the question refuses edits (marked done, or it shows a submission).
  const lockNotice = useStore(selectLockNotice);
  const locked = lockNotice !== null;
  const { ref: pasteGuardRef, notice: pasteNotice } = usePasteGuard();

  const spec = question?.fill_in;
  if (!assignment || !question || !spec) return null;

  const blanks = fillInBlanks(spec);

  return (
    <div className="wb-answer mm-surface">
      <div className="wb-answer-inner">
        <div className="eyebrow wb-answer-eyebrow">Your answer</div>
        <div className="wb-fill-grid">
          {/* Keyed by position: answers are positional (fillAnswers[i] is
              blank i), and labels are unique only by authoring. */}
          {blanks.map((blank, i) => (
            <label key={i} className="wb-fill-field">
              <span className="wb-fill-label">{blank.label}</span>
              <input
                className="wb-fill-input"
                value={answers[i] ?? ''}
                inputMode={blank.digitsOnly ? 'numeric' : 'text'}
                autoComplete="off"
                spellCheck={false}
                readOnly={locked}
                ref={pasteGuardRef}
                onChange={(e) =>
                  setFillAnswer(
                    i,
                    blank.digitsOnly ? e.target.value.replace(/\D/g, '') : e.target.value,
                  )
                }
              />
            </label>
          ))}
        </div>
        <AnswerFoot pasteNotice={pasteNotice} lockNotice={lockNotice} />
      </div>
    </div>
  );
}
