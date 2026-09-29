// The question creator's invented numeral system (task 080): the base — how
// many digit symbols the student invents, one box each — and the numbers the
// student then writes in it, each a value and the label its box wears. No
// key: the grader checks the student's own symbols by rule
// (engine/fillIn.ts gradeInventedNumeral). The draft, its defects and the
// saved field are the pure ./fillInAuthoring.ts; this is only the widget
// over them.
//
// Students' answers are stored box by box, so changing the base or moving a
// saved number misplaces the answers already given: the editor says so,
// live, above the fields (and QuestionCreator confirms before saving).

import { FILL_IN_NUMERAL_MAX_BASE, numberWord, numeralDigits } from '../engine/fillIn';
import {
  fillInNumeralDefects,
  misplacedNumeralWarning,
  newNumeralNumber,
  type FillInNumeralDraft,
} from './fillInAuthoring';

export function FillInNumeralEditor({
  draft,
  saved,
  onChange,
}: {
  draft: FillInNumeralDraft;
  /** The numeral the question opened with (null: it was not one). */
  saved: FillInNumeralDraft | null;
  onChange: (next: FillInNumeralDraft) => void;
}) {
  const defects = fillInNumeralDefects(draft);
  const misplaced = misplacedNumeralWarning(saved, draft);
  const base = Number(draft.base.trim());
  const baseOk = draft.base.trim() !== '' && Number.isInteger(base) && base >= 2 && base <= FILL_IN_NUMERAL_MAX_BASE;
  const setNumber = (j: number, patch: Partial<FillInNumeralDraft['numbers'][number]>) =>
    onChange({ ...draft, numbers: draft.numbers.map((n, i) => (i === j ? { ...n, ...patch } : n)) });
  // What the student must write for a value: its digits in the base, named
  // ("five then two") — the rule the grader holds each answer to.
  const spelled = (raw: string): string | null => {
    const value = Number(raw.trim());
    if (!baseOk || raw.trim() === '' || !Number.isSafeInteger(value) || value < 0) return null;
    return numeralDigits(value, base).map(numberWord).join(' then ');
  };

  return (
    <div className="doc-editor">
      {misplaced && (
        <p className="instructor-preview-warning" role="alert">{misplaced}</p>
      )}
      {defects
        .filter((d) => d.number === null)
        .map((d) => (
          <p key={d.message} className="instructor-preview-warning">{d.message}</p>
        ))}
      <div className="doc-editor-inline">
        <label className="mm-inline-field">
          Base
          <input
            className="mm-input mm-input--num"
            type="number"
            min={2}
            max={FILL_IN_NUMERAL_MAX_BASE}
            value={draft.base}
            onChange={(e) => onChange({ ...draft, base: e.target.value })}
          />
          <span className="instructor-count">
            {baseOk
              ? `students invent ${base} symbols, one box each: ${numberWord(0)} to ${numberWord(base - 1)}`
              : `2 to ${FILL_IN_NUMERAL_MAX_BASE}`}
          </span>
        </label>
      </div>

      <div className="doc-editor-head">
        <span className="mm-label">Numbers to write in it</span>
        <button
          type="button"
          className="mm-btn mm-btn--small"
          onClick={() => onChange({ ...draft, numbers: [...draft.numbers, newNumeralNumber()] })}
        >
          Add number
        </button>
      </div>
      {draft.numbers.map((n, j) => {
        const rowDefects = defects.filter((d) => d.number === j);
        const digits = spelled(n.value);
        return (
          <div key={n.key} className="doc-editor-row">
            <div className="doc-editor-inline">
              <span className="mm-label">#{j + 1}</span>
              <label className="mm-inline-field">
                Value
                <input
                  className="mm-input mm-input--num"
                  type="number"
                  min={0}
                  placeholder="e.g. 32"
                  value={n.value}
                  onChange={(e) => setNumber(j, { value: e.target.value })}
                />
              </label>
              <label className="mm-inline-field doc-editor-grow">
                Label
                <input
                  className="mm-input"
                  placeholder="e.g. thirty-two"
                  value={n.label}
                  onChange={(e) => setNumber(j, { label: e.target.value })}
                />
              </label>
              <span className="instructor-section-actions">
                <button
                  type="button"
                  className="mm-btn mm-btn--small mm-btn--danger"
                  onClick={() => onChange({ ...draft, numbers: draft.numbers.filter((_, i) => i !== j) })}
                >
                  Remove
                </button>
              </span>
            </div>
            {digits && (
              <p className="instructor-count">The student&#8217;s symbols for {digits}.</p>
            )}
            {rowDefects.map((x) => (
              <p key={x.message} className="instructor-preview-warning">This number {x.message}.</p>
            ))}
          </div>
        );
      })}
    </div>
  );
}
