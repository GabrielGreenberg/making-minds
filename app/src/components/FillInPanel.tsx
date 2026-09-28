// The workspace for a fill-in question — the open question's answer area
// narrowed to boxes, in the editor frame's centre (EditorShell; the question
// itself is in the question panel). The answers live in the store's
// fillAnswers and persist/travel exactly like a circuit.
//
// Two shapes (engine/fillIn.ts fillInShape, the one reader of the spec): a
// grid of labelled blanks, or a blank argument–value TABLE (task 079) whose
// cells the student fills whole, arguments too — cell (r, c) is
// fillAnswers[r·C + c]. The table is drawn from the spec's headers and row
// count, never from the key (a student's copy has none).
//
// Unlike an open question this one IS autograded (engine/fillIn.ts), so the
// boxes are the whole answer: no prose, and into a digits-only blank or
// column no characters but digits reach the store. Every box wears the one
// provenance guard (usePasteGuard; law 8): only text copied in the student's
// own assignments pastes in, and nothing copied here reaches the system
// clipboard. Locking is the store's (setFillAnswer asks
// isCurrentQuestionLocked; law 3) — `readOnly` here only shows it.

import { useStore, selectLockNotice } from '../store';
import { usePasteGuard } from '../usePasteGuard';
import { fillInShape, fillInTableRows, type FillInTableShape } from '../engine/fillIn';
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

  const shape = fillInShape(spec);

  return (
    <div className="wb-answer mm-surface">
      <div className="wb-answer-inner">
        <div className="eyebrow wb-answer-eyebrow">Your answer</div>
        {shape.kind === 'table' ? (
          <FillInTable
            shape={shape}
            answers={answers}
            locked={locked}
            pasteGuardRef={pasteGuardRef}
            onChange={setFillAnswer}
          />
        ) : (
          <div className="wb-fill-grid">
            {/* Keyed by position: answers are positional (fillAnswers[i] is
                blank i), and labels are unique only by authoring. */}
            {shape.blanks.map((blank, i) => (
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
        )}
        <AnswerFoot pasteNotice={pasteNotice} lockNotice={lockNotice} />
      </div>
    </div>
  );
}

/** The blank argument–value table: the headers, then `rows` rows of empty
 *  cells, every one wearing the panel's one paste guard. */
function FillInTable({
  shape,
  answers,
  locked,
  pasteGuardRef,
  onChange,
}: {
  shape: FillInTableShape;
  answers: readonly string[];
  locked: boolean;
  pasteGuardRef: ReturnType<typeof usePasteGuard>['ref'];
  onChange: (index: number, value: string) => void;
}) {
  const c = shape.columns.length;
  return (
    <div className="mm-tablewrap wb-fill-tablewrap">
      <table className="mm-table wb-fill-table">
        <thead>
          <tr>
            {shape.columns.map((col, j) => (
              <th key={j} className={j === shape.argColumns ? 'wb-fill-value-start' : undefined}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Keyed by position: cell (r, j) is fillAnswers[r·C + j]. */}
          {fillInTableRows(shape, answers).map((row, r) => (
            <tr key={r}>
              {row.map((cell, j) => {
                const col = shape.columns[j];
                return (
                  <td key={j} className={j === shape.argColumns ? 'wb-fill-value-start' : undefined}>
                    <input
                      className="wb-fill-cell"
                      value={cell}
                      aria-label={`${col.header}, row ${r + 1}`}
                      inputMode={col.digitsOnly ? 'numeric' : 'text'}
                      autoComplete="off"
                      spellCheck={false}
                      readOnly={locked}
                      ref={pasteGuardRef}
                      onChange={(e) =>
                        onChange(
                          r * c + j,
                          col.digitsOnly ? e.target.value.replace(/\D/g, '') : e.target.value,
                        )
                      }
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
