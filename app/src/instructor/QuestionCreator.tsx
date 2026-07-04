import { useEffect, useState } from 'react';
import type {
  AssignmentQuestion,
  BuildMode,
  CCInputGroup,
  CCOutputGroup,
  RepSystem,
} from '../types';
import { getAssignment } from '../assignments';
import { generateTestCases } from '../engine/testVectorGen';
import { FormulaError } from '../engine/formulaEval';
import {
  buildExamples,
  countCombos,
  maxValue,
  probeFormulas,
  validateGroups,
  MAX_COMBOS,
  DEFAULT_EXAMPLE_LIMIT,
  type ExamplesResult,
  type PreviewRow,
} from './ccPreview';

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

  // The single input the live probe evaluates the formulas on. Keyed by group
  // name (robust to add/remove/reorder); unset groups default to their max value.
  const [probeOverrides, setProbeOverrides] = useState<Record<string, number>>({});

  // The bounded example table is computed on demand (the "confirm formula" step),
  // not per keystroke. It goes stale — and is cleared — whenever the spec changes.
  const [examples, setExamples] = useState<ExamplesResult | null>(null);
  // Surfaced only if the exhaustive save-time generation rejects a formula on some
  // input the single-input probe never exercised (e.g. a value that goes negative).
  const [saveError, setSaveError] = useState<string | null>(null);

  // Clear the stale example table when the spec changes — including the mode, since
  // it changes how TM values render and whether outputs are width-truncated.
  useEffect(() => {
    setExamples(null);
    setSaveError(null);
  }, [inputs, outputs, rep, mode]);

  // ── Live, per-keystroke validation (all O(#groups), no space enumeration) ──
  const structuralErrors = validateGroups(inputs, outputs);
  const structurallyValid = structuralErrors.length === 0;
  const totalCombos = countCombos(inputs, rep);
  const tooLarge = totalCombos > MAX_COMBOS;

  // Probe values aligned to input order, clamped to each group's range.
  const probeValues = inputs.map((g) => {
    const max = maxValue(g.width, rep);
    const raw = probeOverrides[g.name];
    const v = raw == null ? max : Math.trunc(raw);
    return Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : 0;
  });

  // Single-input evaluation: cheap, and enough to catch formula syntax/reference
  // errors. Only run when the group shapes are valid (probe assumes valid widths).
  const probe = structurallyValid
    ? probeFormulas(inputs, outputs, rep, probeValues, mode)
    : null;
  const formulasOk = probe ? probe.outputErrors.every((e) => e == null) : false;

  const saveable =
    structurallyValid && !tooLarge && formulasOk && statement.trim().length > 0;

  const totalInputWires = inputs.reduce((n, g) => n + (g.width || 0), 0);
  const totalOutputWires = outputs.reduce((n, g) => n + (g.width || 0), 0);
  const widthCaption = WIDTH_CAPTION[mode];
  const widthCaveat = WIDTH_CAVEAT[mode];

  // ── Group editing helpers ──────────────────────────────────────
  const updateInput = (i: number, patch: Partial<CCInputGroup>) =>
    setInputs((gs) => gs.map((g, idx) => (idx === i ? { ...g, ...patch } : g)));
  const updateOutput = (i: number, patch: Partial<CCOutputGroup>) =>
    setOutputs((gs) => gs.map((g, idx) => (idx === i ? { ...g, ...patch } : g)));

  const handleGenerate = () => {
    if (!structurallyValid) return;
    setExamples(buildExamples(inputs, outputs, rep, mode));
  };

  const handleSave = () => {
    if (!saveable) return;
    const spec = { inputs, outputs };
    // The exhaustive test bank is generated here — and only here — at save.
    let test_cases;
    try {
      test_cases = generateTestCases(spec, rep, mode);
    } catch (e) {
      setSaveError(
        e instanceof FormulaError
          ? `A formula fails on some input: ${e.message}`
          : 'Could not generate test cases from these formulas.',
      );
      return;
    }

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
              {probe?.outputErrors[i] && (
                <span className="instructor-formula-error">{probe.outputErrors[i]}</span>
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

      {/* Live single-input behavior (updates as you type; no full enumeration) */}
      <section className="instructor-creator-section">
        <div className="instructor-section-head">
          <h4 className="instructor-subhead">Live check</h4>
          <span className="instructor-count">one input, updates as you type</span>
        </div>
        {structuralErrors.length > 0 ? (
          <ul className="instructor-preview-errors">
            {structuralErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        ) : (
          <ProbePanel
            inputs={inputs}
            rep={rep}
            probeValues={probeValues}
            row={probe!.row}
            onProbeChange={(name, value) =>
              setProbeOverrides((o) => ({ ...o, [name]: value }))
            }
          />
        )}
      </section>

      {/* Bounded examples, computed only when the instructor confirms the formula */}
      <section className="instructor-creator-section">
        <div className="instructor-section-head">
          <h4 className="instructor-subhead">Examples</h4>
          <button
            className="instructor-btn"
            disabled={!structurallyValid}
            onClick={handleGenerate}
          >
            {examples ? 'Refresh examples' : `Preview up to ${DEFAULT_EXAMPLE_LIMIT} examples`}
          </button>
        </div>
        <ExamplesPanel inputs={inputs} outputs={outputs} examples={examples} />
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
        {saveError && <span className="instructor-formula-error">{saveError}</span>}
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

/** The live single-input row: editable input values → the formulas' outputs. */
function ProbePanel({
  inputs,
  rep,
  probeValues,
  row,
  onProbeChange,
}: {
  inputs: CCInputGroup[];
  rep: RepSystem;
  probeValues: number[];
  row: PreviewRow;
  onProbeChange: (name: string, value: number) => void;
}) {
  return (
    <div className="instructor-probe">
      <div className="instructor-probe-inputs">
        {inputs.map((g, i) => (
          <label key={i} className="instructor-probe-field">
            <span className="instructor-probe-name">{g.name}</span>
            <input
              className="instructor-input instructor-input--num"
              type="number"
              min={0}
              max={maxValue(g.width, rep)}
              value={probeValues[i]}
              onChange={(e) => onProbeChange(g.name, Number(e.target.value))}
            />
            <span className="instructor-bits">
              {row.inputs[i]?.display ?? row.inputs[i]?.bits.join('')}
            </span>
          </label>
        ))}
      </div>
      <span className="instructor-probe-arrow">→</span>
      <div className="instructor-probe-outputs">
        {row.outputs.map((c, ci) => (
          <span key={ci} className="instructor-probe-out">
            <span className="instructor-probe-name">{c.name} =</span>{' '}
            {c.result != null ? (
              <>
                <span className="instructor-bits">{c.display ?? c.bits?.join('')}</span>
                <span className="instructor-int">({c.result})</span>
              </>
            ) : (
              <span className="instructor-formula-error">error</span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The on-demand, bounded example table (or a hint / warning when not shown). */
function ExamplesPanel({
  inputs,
  outputs,
  examples,
}: {
  inputs: CCInputGroup[];
  outputs: CCOutputGroup[];
  examples: ExamplesResult | null;
}) {
  if (!examples) {
    return (
      <p className="instructor-empty">
        Confirm the formulas by generating a few worked examples before saving.
      </p>
    );
  }
  if (examples.tooLarge) {
    return (
      <p className="instructor-preview-warning">
        Input space is too large to enumerate ({examples.totalCombos.toLocaleString()}{' '}
        combinations). Reduce the input widths.
      </p>
    );
  }
  if (examples.rows.length === 0) {
    return <p className="instructor-empty">No rows to preview.</p>;
  }

  return (
    <>
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
        <tbody>{examples.rows.map((r, i) => renderRow(r, i))}</tbody>
      </table>
      <p className="instructor-count">
        {examples.truncated
          ? `Showing first ${examples.shown} of ${examples.totalCombos.toLocaleString()} inputs. The full test bank is generated on save.`
          : `Showing all ${examples.shown} inputs.`}
      </p>
    </>
  );
}

function renderRow(row: PreviewRow, key: number) {
  return (
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
}
