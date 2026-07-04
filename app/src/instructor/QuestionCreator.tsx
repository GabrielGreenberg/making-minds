import { useMemo, useState } from 'react';
import type {
  AssignmentQuestion,
  BuildMode,
  CCInputGroup,
  CCOutputGroup,
  RepSystem,
} from '../types';
import { getAssignment } from '../assignments';
import { generateTestCases } from '../engine/testVectorGen';
import { buildPreview, canSave, type PreviewRow } from './ccPreview';

interface Props {
  assignmentId: string;
  existingQuestion?: AssignmentQuestion;
  onSave: (q: AssignmentQuestion) => void;
  onCancel: () => void;
}

// All four machine modes are authorable through this one form: the CCSpec shape,
// the DSL, the representation toggle, and the preview are all mode-agnostic. Only
// the width caption (below) and the TM preview rendering differ per mode.
const MODES: { mode: BuildMode; label: string }[] = [
  { mode: 'CC', label: 'CC' },
  { mode: 'SC', label: 'SC' },
  { mode: 'FSM', label: 'FSM' },
  { mode: 'TM', label: 'TM' },
];

// `width` bounds something different per mode; caption it honestly rather than
// hiding it (see CLAUDE_KB/plans/question-editor-unification.md §4).
const WIDTH_CAPTION: Record<BuildMode, string> = {
  CC: 'width (wires)',
  SC: 'width (time steps to test)',
  FSM: 'width (time steps to test)',
  TM: 'width (max input value to test)',
  turbot: 'width',
};

// For SC/FSM/TM, `width` is not a structural capacity of the machine — it only
// bounds how large a value this question happens to test. Surface that caveat.
const WIDTH_CAVEAT: Partial<Record<BuildMode, string>> = {
  SC: 'For SC, width is only how many time steps this question tests — not a limit on what the machine can compute.',
  FSM: 'For FSM, width is only how many time steps this question tests — a valid FSM must handle input streams of any length.',
  TM: 'For TM, width only bounds which input values are tested; the tape is unbounded, so outputs are never truncated.',
};

function blankInput(): CCInputGroup {
  return { name: '', width: 1 };
}
function blankOutput(): CCOutputGroup {
  return { name: '', width: 1, formula: '' };
}

// Representation systems the codec grades against (the display-only 'plus' is not
// a grading representation, so it isn't offered here).
const REPS: RepSystem[] = ['binary', 'tally'];

export function QuestionCreator({ assignmentId, existingQuestion, onSave, onCancel }: Props) {
  // Mode is an ordinary field of the shared form: new questions default to CC,
  // existing ones keep their mode. Switching it must NOT reset the groups/formulas
  // below — they're valid regardless of mode (the whole point of the shared shape).
  const [mode, setMode] = useState<BuildMode>(existingQuestion?.buildMode ?? 'CC');

  const [inputs, setInputs] = useState<CCInputGroup[]>(
    () => existingQuestion?.cc_spec?.inputs.map((g) => ({ ...g })) ?? [blankInput()],
  );
  const [outputs, setOutputs] = useState<CCOutputGroup[]>(
    () => existingQuestion?.cc_spec?.outputs.map((g) => ({ ...g })) ?? [blankOutput()],
  );
  // One representation system per question (governs grading + the preview).
  const [rep, setRep] = useState<RepSystem>(
    () => existingQuestion?.representation === 'tally' ? 'tally' : 'binary',
  );
  const [statement, setStatement] = useState(existingQuestion?.statement ?? '');

  const preview = useMemo(
    () => buildPreview(inputs, outputs, rep, mode),
    [inputs, outputs, rep, mode],
  );
  const saveable = canSave(preview, statement);

  const totalInputWires = inputs.reduce((n, g) => n + (g.width || 0), 0);
  const totalOutputWires = outputs.reduce((n, g) => n + (g.width || 0), 0);
  const widthCaption = WIDTH_CAPTION[mode];
  const widthCaveat = WIDTH_CAVEAT[mode];

  // ── Group editing helpers ──────────────────────────────────────
  const updateInput = (i: number, patch: Partial<CCInputGroup>) =>
    setInputs((gs) => gs.map((g, idx) => (idx === i ? { ...g, ...patch } : g)));
  const updateOutput = (i: number, patch: Partial<CCOutputGroup>) =>
    setOutputs((gs) => gs.map((g, idx) => (idx === i ? { ...g, ...patch } : g)));

  const handleSave = () => {
    if (!saveable) return;
    const spec = { inputs, outputs };
    const test_cases = generateTestCases(spec, rep, mode);

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
      buildMode: mode,
      representation: rep,
      cc_spec: spec,
      test_cases,
    });
  };

  return (
    <div className="instructor-creator">
      <div className="instructor-page-head">
        <h3 className="instructor-section-title">
          {existingQuestion ? `Edit ${existingQuestion.label}` : `New ${mode} question`}
        </h3>
        <button className="instructor-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>

      {/* Mode + representation (both per-question; govern grading + the preview) */}
      <section className="instructor-creator-section">
        <div className="instructor-section-head">
          <h4 className="instructor-subhead">Mode</h4>
          <div className="instructor-encoding-toggle">
            {MODES.map((m) => (
              <button
                key={m.mode}
                className={
                  'instructor-encoding-btn' +
                  (mode === m.mode ? ' instructor-encoding-btn--active' : '')
                }
                onClick={() => setMode(m.mode)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div className="instructor-section-head">
          <h4 className="instructor-subhead">Representation</h4>
          <RepToggle value={rep} onChange={setRep} />
        </div>
      </section>

      {/* Inputs */}
      <section className="instructor-creator-section">
        <div className="instructor-section-head">
          <h4 className="instructor-subhead">Input groups</h4>
          <span className="instructor-count">{totalInputWires} input wires total</span>
        </div>
        {widthCaveat && <p className="instructor-hint">{widthCaveat}</p>}
        {inputs.map((g, i) => (
          <div key={i} className="instructor-group-row">
            <input
              className="instructor-input instructor-input--name"
              placeholder="name"
              value={g.name}
              onChange={(e) => updateInput(i, { name: e.target.value })}
            />
            <label className="instructor-inline-field">
              {widthCaption}
              <input
                className="instructor-input instructor-input--num"
                type="number"
                min={1}
                max={8}
                value={g.width}
                onChange={(e) => updateInput(i, { width: Number(e.target.value) })}
              />
            </label>
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
                {widthCaption}
                <input
                  className="instructor-input instructor-input--num"
                  type="number"
                  min={1}
                  max={8}
                  value={g.width}
                  onChange={(e) => updateOutput(i, { width: Number(e.target.value) })}
                />
              </label>
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

function RepToggle({
  value,
  onChange,
}: {
  value: RepSystem;
  onChange: (r: RepSystem) => void;
}) {
  return (
    <div className="instructor-encoding-toggle">
      {REPS.map((r) => (
        <button
          key={r}
          className={
            'instructor-encoding-btn' + (value === r ? ' instructor-encoding-btn--active' : '')
          }
          onClick={() => onChange(r)}
        >
          {r}
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
          <span className="instructor-bits">{c.display ?? c.bits.join('')}</span>
          <span className="instructor-int">({c.value})</span>
        </td>
      ))}
      {row.outputs.map((c, ci) => (
        <td key={`o${ci}`} className="instructor-preview-bits">
          {c.result != null ? (
            <>
              <span className="instructor-bits">{c.display ?? c.bits?.join('')}</span>
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
