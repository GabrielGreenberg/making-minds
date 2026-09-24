// The question creator's list of fill-in blanks (task 005): one row per blank
// — its label (the prompt beside the student's box), the answer, and whether
// only digits may be typed — added, removed and moved as one row, so a label
// never parts from its answer. The drafts, their defects and the saved fields
// are the pure ./fillInAuthoring.ts; this is only the widget over them.
//
// Students' answers are stored by position, so removing or moving a blank the
// question was saved with misplaces the answers already given to it: the list
// says so, live, above the rows (and QuestionCreator confirms before saving).

import { moveItem } from './dragReorder';
import {
  fillInDefects,
  misplacedAnswersWarning,
  misplacedBlanks,
  newBlankDraft,
  type FillInBlankDraft,
} from './fillInAuthoring';

export function FillInBlanksEditor({
  drafts,
  saved,
  onChange,
}: {
  drafts: FillInBlankDraft[];
  /** The drafts the question opened with (none for a new question). */
  saved: readonly FillInBlankDraft[];
  onChange: (next: FillInBlankDraft[]) => void;
}) {
  const defects = fillInDefects(drafts);
  const misplaced = misplacedBlanks(saved, drafts);
  const update = (i: number, patch: Partial<FillInBlankDraft>) =>
    onChange(drafts.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  return (
    <div className="doc-editor">
      <div className="doc-editor-head">
        <span className="mm-label">Blanks</span>
        <button
          type="button"
          className="mm-btn mm-btn--small"
          onClick={() => onChange([...drafts, newBlankDraft(drafts)])}
        >
          Add blank
        </button>
      </div>
      {misplaced.length > 0 && (
        <p className="instructor-preview-warning" role="alert">
          {misplacedAnswersWarning(misplaced)}
        </p>
      )}
      {defects
        .filter((d) => d.blank === null)
        .map((d) => (
          <p key={d.message} className="instructor-preview-warning">{d.message}</p>
        ))}
      {drafts.map((d, i) => {
        const rowDefects = defects.filter((x) => x.blank === i);
        return (
          <div key={d.key} className="doc-editor-row">
            <div className="doc-editor-inline">
              <span className="mm-label">#{i + 1}</span>
              <label className="mm-inline-field">
                Label
                <input
                  className="mm-input"
                  placeholder="e.g. 7"
                  value={d.label}
                  onChange={(e) => update(i, { label: e.target.value })}
                />
              </label>
              <label className="mm-inline-field doc-editor-grow">
                Answer
                <input
                  className="mm-input"
                  inputMode={d.digitsOnly ? 'numeric' : 'text'}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={d.digitsOnly ? 'e.g. 111' : 'the expected answer'}
                  value={d.answer}
                  onChange={(e) => update(i, { answer: e.target.value })}
                />
              </label>
              <label className="mm-inline-field">
                <input
                  type="checkbox"
                  checked={d.digitsOnly}
                  onChange={(e) => update(i, { digitsOnly: e.target.checked })}
                />
                digits only
              </label>
              <span className="instructor-section-actions">
                <button
                  type="button"
                  className="mm-btn mm-btn--small"
                  disabled={i === 0}
                  onClick={() => onChange(moveItem(drafts, i, i - 1))}
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="mm-btn mm-btn--small"
                  disabled={i === drafts.length - 1}
                  onClick={() => onChange(moveItem(drafts, i, i + 1))}
                  title="Move down"
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="mm-btn mm-btn--small mm-btn--danger"
                  onClick={() => onChange(drafts.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </span>
            </div>
            {rowDefects.map((x) => (
              <p key={x.message} className="instructor-preview-warning">
                This blank {x.message}.
              </p>
            ))}
          </div>
        );
      })}
    </div>
  );
}
