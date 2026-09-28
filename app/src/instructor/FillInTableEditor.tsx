// The question creator's argument–value table (task 079): the columns (header
// and digits-only flag, added, removed and moved with their key cells), how
// many lead as arguments, the rows students see, and the key — one row per
// case of the function, in any order (grading is order-free). The draft, its
// defects and the saved fields are the pure ./fillInAuthoring.ts; this is
// only the widget over them.
//
// Students' answers are stored cell by cell, row by row, so changing the
// saved columns or taking rows away misreads the answers already given: the
// editor says so, live, above the columns (and QuestionCreator confirms
// before saving).

import { FILL_IN_TABLE_MAX_ROWS } from '../engine/fillIn';
import {
  addTableColumn,
  fillInTableDefects,
  misplacedTableWarning,
  moveTableColumn,
  newTableKeyRow,
  removeTableColumn,
  type FillInTableDraft,
} from './fillInAuthoring';

export function FillInTableEditor({
  draft,
  saved,
  onChange,
}: {
  draft: FillInTableDraft;
  /** The table the question opened with (null: it was not one). */
  saved: FillInTableDraft | null;
  onChange: (next: FillInTableDraft) => void;
}) {
  const defects = fillInTableDefects(draft);
  const misplaced = misplacedTableWarning(saved, draft);
  const c = draft.columns.length;
  const setColumn = (j: number, patch: Partial<FillInTableDraft['columns'][number]>) =>
    onChange({ ...draft, columns: draft.columns.map((col, i) => (i === j ? { ...col, ...patch } : col)) });
  const setCell = (r: number, j: number, value: string) =>
    onChange({
      ...draft,
      keyRows: draft.keyRows.map((row, i) =>
        i === r ? { ...row, cells: draft.columns.map((_, k) => (k === j ? value : row.cells[k] ?? '')) } : row),
    });

  return (
    <div className="doc-editor">
      {misplaced && (
        <p className="instructor-preview-warning" role="alert">{misplaced}</p>
      )}
      {defects
        .filter((d) => d.column === null && d.keyRow === null)
        .map((d) => (
          <p key={d.message} className="instructor-preview-warning">{d.message}</p>
        ))}

      <div className="doc-editor-head">
        <span className="mm-label">Columns</span>
        <button type="button" className="mm-btn mm-btn--small" onClick={() => onChange(addTableColumn(draft))}>
          Add column
        </button>
      </div>
      {draft.columns.map((col, j) => {
        const colDefects = defects.filter((d) => d.column === j);
        return (
          <div key={col.key} className="doc-editor-row">
            <div className="doc-editor-inline">
              <span className="mm-label">#{j + 1} · {j < draft.argColumns ? 'argument' : 'value'}</span>
              <label className="mm-inline-field doc-editor-grow">
                Header
                <input
                  className="mm-input"
                  placeholder={j < draft.argColumns ? 'e.g. x' : 'e.g. f(x)'}
                  value={col.header}
                  onChange={(e) => setColumn(j, { header: e.target.value })}
                />
              </label>
              <label className="mm-inline-field">
                <input
                  type="checkbox"
                  checked={col.digitsOnly}
                  onChange={(e) => setColumn(j, { digitsOnly: e.target.checked })}
                />
                digits only
              </label>
              <span className="instructor-section-actions">
                <button
                  type="button"
                  className="mm-btn mm-btn--small"
                  disabled={j === 0}
                  onClick={() => onChange(moveTableColumn(draft, j, j - 1))}
                  title="Move left"
                >
                  ←
                </button>
                <button
                  type="button"
                  className="mm-btn mm-btn--small"
                  disabled={j === c - 1}
                  onClick={() => onChange(moveTableColumn(draft, j, j + 1))}
                  title="Move right"
                >
                  →
                </button>
                <button
                  type="button"
                  className="mm-btn mm-btn--small mm-btn--danger"
                  disabled={c <= 2}
                  onClick={() => onChange(removeTableColumn(draft, j))}
                >
                  Remove
                </button>
              </span>
            </div>
            {colDefects.map((x) => (
              <p key={x.message} className="instructor-preview-warning">This column {x.message}.</p>
            ))}
          </div>
        );
      })}

      <div className="doc-editor-inline">
        <label className="mm-inline-field">
          Argument columns
          <select
            className="mm-input"
            value={draft.argColumns}
            onChange={(e) => onChange({ ...draft, argColumns: Number(e.target.value) })}
          >
            {Array.from({ length: Math.max(1, c - 1) }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <label className="mm-inline-field">
          Rows students see
          <input
            className="mm-input mm-input--num"
            type="number"
            min={1}
            max={FILL_IN_TABLE_MAX_ROWS}
            placeholder={String(draft.keyRows.length)}
            value={draft.rows}
            onChange={(e) => onChange({ ...draft, rows: e.target.value })}
          />
          <span className="instructor-count">blank = one per key row</span>
        </label>
      </div>

      <div className="doc-editor-head">
        <span className="mm-label">Key — one row per case, any order</span>
        <button
          type="button"
          className="mm-btn mm-btn--small"
          onClick={() => onChange({ ...draft, keyRows: [...draft.keyRows, newTableKeyRow(draft)] })}
        >
          Add key row
        </button>
      </div>
      {draft.keyRows.length > 0 && (
        <div className="mm-tablewrap">
          <table className="mm-table">
            <thead>
              <tr>
                <th>#</th>
                {draft.columns.map((col, j) => <th key={col.key}>{col.header.trim() || `column #${j + 1}`}</th>)}
                <th />
              </tr>
            </thead>
            <tbody>
              {draft.keyRows.map((row, r) => (
                <tr key={row.key}>
                  <td>{r + 1}</td>
                  {draft.columns.map((col, j) => (
                    <td key={col.key}>
                      <input
                        className="mm-input"
                        aria-label={`Key row ${r + 1}, ${col.header.trim() || `column #${j + 1}`}`}
                        inputMode={col.digitsOnly ? 'numeric' : 'text'}
                        autoComplete="off"
                        spellCheck={false}
                        value={row.cells[j] ?? ''}
                        onChange={(e) => setCell(r, j, e.target.value)}
                      />
                    </td>
                  ))}
                  <td>
                    <button
                      type="button"
                      className="mm-btn mm-btn--small mm-btn--danger"
                      onClick={() => onChange({ ...draft, keyRows: draft.keyRows.filter((_, i) => i !== r) })}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {defects
        .filter((d) => d.keyRow !== null)
        .map((d, i) => (
          <p key={i} className="instructor-preview-warning">
            Key row #{d.keyRow! + 1} {d.message}.
          </p>
        ))}
    </div>
  );
}
