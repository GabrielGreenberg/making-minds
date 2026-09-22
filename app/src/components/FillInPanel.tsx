// The workspace for a fill-in-the-blank question — the open question's
// writing panel narrowed to a list of labelled boxes. Same chrome as every
// other question (nav bar, autosave, Submit); the answers live in the store's
// fillAnswers and persist/travel exactly like a circuit.
//
// Unlike an open question this one IS autograded (engine/fillIn.ts), so the
// boxes are the whole answer: no prose, and under `numericOnly` no characters
// but digits reach the store.

import { useStore, selectQuestionLocked } from '../store';
import { ProblemBody, ProblemContext } from './ProblemSetDocument';

export function FillInPanel() {
  const assignment = useStore((s) => s.assignment);
  const currentQuestionIndex = useStore((s) => s.currentQuestionIndex);
  const question = assignment?.questions[currentQuestionIndex];
  const answers = useStore((s) => s.fillAnswers);
  const setFillAnswer = useStore((s) => s.setFillAnswer);
  const locked = useStore(selectQuestionLocked);

  const spec = question?.fill_in;
  if (!assignment || !question || !spec) return null;

  const filled = spec.labels.filter((_, i) => (answers[i] ?? '').trim() !== '').length;

  return (
    <div className="open-response">
      <div className="open-response-card">
        <div className="open-response-head">
          <h2 className="open-response-label">{question.label}</h2>
          <span className="open-response-mode">fill in the blanks</span>
        </div>
        <div className="open-response-statement">
          <ProblemContext assignment={assignment} questionId={question.id} />
          <ProblemBody question={question} />
        </div>
        <div className="fill-in-grid">
          {spec.labels.map((label, i) => (
            <label key={label} className="fill-in-row">
              <span className="fill-in-label">{label}</span>
              <input
                className="fill-in-input"
                value={answers[i] ?? ''}
                inputMode={spec.numericOnly ? 'numeric' : 'text'}
                autoComplete="off"
                spellCheck={false}
                readOnly={locked}
                onChange={(e) =>
                  setFillAnswer(
                    i,
                    spec.numericOnly ? e.target.value.replace(/\D/g, '') : e.target.value,
                  )
                }
              />
            </label>
          ))}
        </div>
        <div className="open-response-foot">
          <span>{filled} of {spec.labels.length} filled in</span>
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
