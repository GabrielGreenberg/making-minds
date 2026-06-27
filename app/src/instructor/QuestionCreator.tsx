import { useMemo, useState } from 'react';
import type {
  AssignmentQuestion,
  BuildMode,
  CCInputGroup,
  CCOutputGroup,
  CCEncoding,
  RepSystem,
} from '../types';
import { getAssignment } from '../assignments';
import { generateCCTestVectors } from '../engine/testVectorGen';
import { buildPreview, canSave, type PreviewRow } from './ccPreview';

interface Props {
  assignmentId: string;
  existingQuestion?: AssignmentQuestion;
  onSave: (q: AssignmentQuestion) => void;
  onCancel: () => void;
}

const MODES: { mode: BuildMode; label: string; enabled: boolean }[] = [
  { mode: 'CC', label: 'CC', enabled: true },
  { mode: 'SC', label: 'SC', enabled: false },
  { mode: 'FSM', label: 'FSM', enabled: false },
  { mode: 'TM', label: 'TM', enabled: false },
];

function blankInput(): CCInputGroup {
  return { name: '', width: 1, encoding: 'binary' };
}
function blankOutput(): CCOutputGroup {
  return { name: '', width: 1, encoding: 'binary', formula: '' };
}

function encodingToRep(encoding: CCEncoding): RepSystem {
  return encoding === 'unary' ? 'tally' : 'binary';
}

export function QuestionCreator({ assignmentId, existingQuestion, onSave, onCancel }: Props) {
  // Step 1: mode. CC is the only implemented mode; existing questions skip this.
  const [mode, setMode] = useState<BuildMode | null>(existingQuestion?.buildMode ?? null);

  const [inputs, setInputs] = useState<CCInputGroup[]>(
    () => existingQuestion?.cc_spec?.inputs.map((g) => ({ ...g })) ?? [blankInput()],
  );
  const [outputs, setOutputs] = useState<CCOutputGroup[]>(
    () => existingQuestion?.cc_spec?.outputs.map((g) => ({ ...g })) ?? [blankOutput()],
  );
  const [statement, setStatement] = useState(existingQuestion?.statement ?? '');

  const preview = useMemo(() => buildPreview(inputs, outputs), [inputs, outputs]);
  const saveable = canSave(preview, statement);

  const totalInputWires = inputs.reduce((n, g) => n + (g.width || 0), 0);
  const totalOutputWires = outputs.reduce((n, g) => n + (g.width || 0), 0);

  // ── Step 1: mode picker ────────────────────────────────────────
  if (mode == null) {
    return (
      <div className="instructor-creator">
        <h3 className="instructor-section-title">New question — pick a mode</h3>
        <div className="instructor-mode-group">
          {MODES.map((m) => (
            <button
              key={m.mode}
              className="instructor-mode-btn"
              disabled={!m.enabled}
              title={m.enabled ? '' : 'Coming soon'}
              onClick={() => m.enabled && setMode(m.mode)}
            >
              {m.label}
              {!m.enabled && <span className="instructor-mode-soon">coming soon</span>}
            </button>
          ))}
        </div>
        <div className="instructor-creator-foot">
          <button className="instructor-btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── Group editing helpers ──────────────────────────────────────
  const updateInput = (i: number, patch: Partial<CCInputGroup>) =>
    setInputs((gs) => gs.map((g, idx) => (idx === i ? { ...g, ...patch } : g)));
  const updateOutput = (i: number, patch: Partial<CCOutputGroup>) =>
    setOutputs((gs) => gs.map((g, idx) => (idx === i ? { ...g, ...patch } : g)));

  const handleSave = () => {
    if (!saveable) return;
    const spec = { inputs, outputs };
    const test_vectors = generateCCTestVectors(spec);

    const def = getAssignment(assignmentId);
    const existingQs = def?.questions ?? [];
    const id =
      existingQuestion?.id ??
      existingQs.reduce((max, q) => Math.max(max, q.id), 0) + 1;
    const label = existingQuestion?.label ?? `Problem ${existingQs.length + 1}`;

    onSave({
      id,
      label,
      statement: statement.trim(),
      buildMode: 'CC',
      representation: encodingToRep(inputs[0]?.encoding ?? 'binary'),
      cc_spec: spec,
      test_vectors,
      grading_mode: 'exhaustive',
    });
  };

  return (
    <div className="instructor-creator">
      <div className="instructor-page-head">
        <h3 className="instructor-section-title">
          {existingQuestion ? `Edit ${existingQuestion.label}` : 'New CC question'}
        </h3>
        <button className="instructor-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>

      {/* Inputs */}
      <section className="instructor-creator-section">
        <div className="instructor-section-head">
          <h4 className="instructor-subhead">Input groups</h4>
          <span className="instructor-count">{totalInputWires} input wires total</span>
        </div>
        {inputs.map((g, i) => (
          <div key={i} className="instructor-group-row">
            <input
              className="instructor-input instructor-input--name"
              placeholder="name"
              value={g.name}
              onChange={(e) => updateInput(i, { name: e.target.value })}
            />
            <label className="instructor-inline-field">
              width
              <input
                className="instructor-input instructor-input--num"
                type="number"
                min={1}
                max={8}
                value={g.width}
                onChange={(e) => updateInput(i, { width: Number(e.target.value) })}
              />
            </label>
            <EncodingToggle
              value={g.encoding}
              onChange={(encoding) => updateInput(i, { encoding })}
            />
            <button
              className="instructor-btn instructor-btn--icon instructor-btn--danger"
              onClick={() => setInputs((gs) => gs.filter((_, idx) => idx !== i))}
              title="Remove input group"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          className="instructor-btn"
          onClick={() => setInputs((gs) => [...gs, blankInput()])}
        >
          Add input group
        </button>
      </section>

      {/* Outputs */}
      <section className="instructor-creator-section">
        <div className="instructor-section-head">
          <h4 className="instructor-subhead">Output groups</h4>
          <span className="instructor-count">{totalOutputWires} output wires total</span>
        </div>
        {outputs.map((g, i) => (
          <div key={i} className="instructor-group-block">
            <div className="instructor-group-row">
              <input
                className="instructor-input instructor-input--name"
                placeholder="name"
                value={g.name}
                onChange={(e) => updateOutput(i, { name: e.target.value })}
              />
              <label className="instructor-inline-field">
                width
                <input
                  className="instructor-input instructor-input--num"
                  type="number"
                  min={1}
                  max={8}
                  value={g.width}
                  onChange={(e) => updateOutput(i, { width: Number(e.target.value) })}
                />
              </label>
              <EncodingToggle
                value={g.encoding}
                onChange={(encoding) => updateOutput(i, { encoding })}
              />
              <button
                className="instructor-btn instructor-btn--icon instructor-btn--danger"
                onClick={() => setOutputs((gs) => gs.filter((_, idx) => idx !== i))}
                title="Remove output group"
              >
                ✕
              </button>
            </div>
            <div className="instructor-formula-row">
              <label className="instructor-inline-field instructor-formula-field">
                {g.name || 'f'} =
                <input
                  className="instructor-input instructor-input--formula"
                  placeholder="e.g. 2 * x"
                  value={g.formula}
                  onChange={(e) => updateOutput(i, { formula: e.target.value })}
                />
              </label>
              {preview.outputErrors[i] && (
                <span className="instructor-formula-error">{preview.outputErrors[i]}</span>
              )}
            </div>
          </div>
        ))}
        <button
          className="instructor-btn"
          onClick={() => setOutputs((gs) => [...gs, blankOutput()])}
        >
          Add output group
        </button>
      </section>

      {/* Preview */}
      <section className="instructor-creator-section">
        <h4 className="instructor-subhead">Preview</h4>
        <PreviewTable
          inputs={inputs}
          outputs={outputs}
          rows={preview.rows}
          totalCombos={preview.totalCombos}
          tooLarge={preview.tooLarge}
          structuralErrors={preview.structuralErrors}
        />
      </section>

      {/* Statement */}
      <section className="instructor-creator-section">
        <label className="instructor-field">
          <span className="instructor-field-label">Instructions shown to students</span>
          <textarea
            className="instructor-textarea"
            rows={4}
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
            placeholder="Describe the function the student's circuit must compute…"
          />
        </label>
      </section>

      <div className="instructor-creator-foot">
        <button className="instructor-btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="instructor-btn instructor-btn--primary"
          disabled={!saveable}
          onClick={handleSave}
        >
          {existingQuestion ? 'Save Question' : 'Add to Assignment'}
        </button>
      </div>
    </div>
  );
}

function EncodingToggle({
  value,
  onChange,
}: {
  value: CCEncoding;
  onChange: (e: CCEncoding) => void;
}) {
  return (
    <div className="instructor-encoding-toggle">
      {(['binary', 'unary'] as CCEncoding[]).map((enc) => (
        <button
          key={enc}
          className={
            'instructor-encoding-btn' + (value === enc ? ' instructor-encoding-btn--active' : '')
          }
          onClick={() => onChange(enc)}
        >
          {enc}
        </button>
      ))}
    </div>
  );
}

function PreviewTable({
  inputs,
  outputs,
  rows,
  totalCombos,
  tooLarge,
  structuralErrors,
}: {
  inputs: CCInputGroup[];
  outputs: CCOutputGroup[];
  rows: PreviewRow[];
  totalCombos: number;
  tooLarge: boolean;
  structuralErrors: string[];
}) {
  if (structuralErrors.length > 0) {
    return (
      <ul className="instructor-preview-errors">
        {structuralErrors.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
    );
  }
  if (tooLarge) {
    return (
      <p className="instructor-preview-warning">
        Input space is too large to enumerate ({totalCombos.toLocaleString()} combinations).
        Reduce the input widths.
      </p>
    );
  }
  if (rows.length === 0) return <p className="instructor-empty">No rows to preview.</p>;

  // Show all rows up to 16; otherwise first 8 + last 8 with an elision marker.
  const HEAD = 8;
  const TAIL = 8;
  const truncated = rows.length > 16;
  const head = truncated ? rows.slice(0, HEAD) : rows;
  const tail = truncated ? rows.slice(rows.length - TAIL) : [];

  const renderRow = (row: PreviewRow, key: number) => (
    <tr key={key}>
      {row.inputs.map((c, ci) => (
        <td key={`i${ci}`} className="instructor-preview-bits">
          <span className="instructor-bits">{c.bits.join('')}</span>
          <span className="instructor-int">({c.value})</span>
        </td>
      ))}
      {row.outputs.map((c, ci) => (
        <td key={`o${ci}`} className="instructor-preview-bits">
          {c.bits ? (
            <>
              <span className="instructor-bits">{c.bits.join('')}</span>
              <span className="instructor-int">({c.result})</span>
            </>
          ) : (
            <span className="instructor-formula-error">error</span>
          )}
        </td>
      ))}
    </tr>
  );

  return (
    <table className="instructor-preview-table">
      <thead>
        <tr>
          {inputs.map((g, i) => (
            <th key={`hi${i}`}>{g.name || '?'} (in)</th>
          ))}
          {outputs.map((g, i) => (
            <th key={`ho${i}`}>{g.name || '?'} (out)</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {head.map((r, i) => renderRow(r, i))}
        {truncated && (
          <tr className="instructor-preview-elision">
            <td colSpan={inputs.length + outputs.length}>
              … {totalCombos} rows total …
            </td>
          </tr>
        )}
        {tail.map((r, i) => renderRow(r, HEAD + i))}
      </tbody>
    </table>
  );
}
