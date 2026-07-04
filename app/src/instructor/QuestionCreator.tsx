import { useState } from 'react';
import type { AssignmentQuestion, BuildMode, RepSystem } from '../types';
import { getAssignment } from '../assignments';
import {
  buildQuestionBank,
  type AuthoredInputGroup,
  type AuthoredOutputGroup,
} from '../engine/testVectorGen';
import { FormulaError } from '../engine/formulaEval';
import {
  countCombos,
  maxInputLimit,
  probeFormulas,
  probeMax,
  validateGroups,
  MAX_COMBOS,
  type PreviewRow,
} from './ccPreview';

interface Props {
  assignmentId: string;
  existingQuestion?: AssignmentQuestion;
  onSave: (q: AssignmentQuestion) => void;
  onCancel: () => void;
}

// All four machine modes are authorable through this one form: the group
// shapes, the DSL, and the representation toggle are all mode-agnostic. Only
// the input-size field differs: CC (the one finite, exhaustively tested space)
// asks for each group's max input value; SC/FSM/TM input spaces are unbounded,
// so they are tested on a fixed sample of values across a range of input
// lengths and have no size field at all.
const MODES: { mode: BuildMode; label: string }[] = [
  { mode: 'CC', label: 'CC' },
  { mode: 'SC', label: 'SC' },
  { mode: 'FSM', label: 'FSM' },
  { mode: 'TM', label: 'TM' },
];

const SAMPLING_NOTE: Partial<Record<BuildMode, string>> = {
  SC: 'SC inputs stream over time, so this question is tested on a sample of input values across a range of input lengths.',
  FSM: 'FSM inputs stream over time, so this question is tested on a sample of input values across a range of input lengths.',
  TM: 'The tape is unbounded, so this question is tested on a sample of input values across a range of input lengths.',
};

function blankInput(): AuthoredInputGroup {
  return { name: '', maxVal: 1 };
}
function blankOutput(): AuthoredOutputGroup {
  return { name: '', formula: '' };
}

// Representation systems the codec grades against (the display-only 'plus' is not
// a grading representation, so it isn't offered here).
const REPS: RepSystem[] = ['binary', 'tally'];

export function QuestionCreator({ assignmentId, existingQuestion, onSave, onCancel }: Props) {
  // Mode is an ordinary field of the shared form: new questions default to CC,
  // existing ones keep their mode. Switching it must NOT reset the groups/formulas
  // below — they're valid regardless of mode (the whole point of the shared shape).
  const [mode, setMode] = useState<BuildMode>(existingQuestion?.buildMode ?? 'CC');

  // One representation system per question (governs grading + the live check).
  const [rep, setRep] = useState<RepSystem>(
    () => existingQuestion?.representation === 'tally' ? 'tally' : 'binary',
  );

  const [inputs, setInputs] = useState<AuthoredInputGroup[]>(() =>
    existingQuestion?.cc_spec?.inputs.map((g) => ({
      name: g.name,
      // Prefer the authored max value; older width-based questions fall back to
      // the largest value the stored width can hold.
      maxVal: g.max_value ??
        (existingQuestion.representation === 'tally' ? g.width : Math.pow(2, g.width) - 1),
    })) ?? [blankInput()],
  );
  const [outputs, setOutputs] = useState<AuthoredOutputGroup[]>(
    () =>
      existingQuestion?.cc_spec?.outputs.map((g) => ({ name: g.name, formula: g.formula })) ?? [
        blankOutput(),
      ],
  );
  const [label, setLabel] = useState(() => {
    if (existingQuestion) return existingQuestion.label;
    const count = getAssignment(assignmentId)?.questions.length ?? 0;
    return `Problem ${count + 1}`;
  });
  const [statement, setStatement] = useState(existingQuestion?.statement ?? '');

  // The single input the live probe evaluates the formulas on. Keyed by group
  // name (robust to add/remove/reorder); unset groups default to their max value.
  const [probeOverrides, setProbeOverrides] = useState<Record<string, number>>({});

  // Surfaced only if the save-time generation rejects a formula on some input
  // the single-input probe never exercised (e.g. a value that goes negative).
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Live, per-keystroke validation (all O(#groups), no space enumeration) ──
  const structuralErrors = validateGroups(inputs, outputs, rep, mode);
  const structurallyValid = structuralErrors.length === 0;
  const isCC = mode === 'CC';
  const tooLarge = isCC && countCombos(inputs) > MAX_COMBOS;

  // Probe values aligned to input order, clamped to each group's range.
  const probeValues = inputs.map((g) => {
    const max = probeMax(g, rep, mode);
    const raw = probeOverrides[g.name];
    const v = raw == null ? max : Math.trunc(raw);
    return Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : 0;
  });

  // Single-input evaluation: cheap, and enough to catch formula syntax/reference
  // errors. Only run when the group shapes are valid.
  const probe = structurallyValid
    ? probeFormulas(inputs, outputs, rep, probeValues, mode)
    : null;
  const formulasOk = probe ? probe.outputErrors.every((e) => e == null) : false;

  const saveable =
    structurallyValid &&
    !tooLarge &&
    formulasOk &&
    label.trim().length > 0 &&
    statement.trim().length > 0;

  // ── Group editing helpers ──────────────────────────────────────
  const updateInput = (i: number, patch: Partial<AuthoredInputGroup>) =>
    setInputs((gs) => gs.map((g, idx) => (idx === i ? { ...g, ...patch } : g)));
  const updateOutput = (i: number, patch: Partial<AuthoredOutputGroup>) =>
    setOutputs((gs) => gs.map((g, idx) => (idx === i ? { ...g, ...patch } : g)));

  const handleSave = () => {
    if (!saveable) return;
    // The test bank is generated here — and only here — at save.
    let bank;
    try {
      bank = buildQuestionBank(inputs, outputs, rep, mode);
    } catch (e) {
      setSaveError(
        e instanceof FormulaError
          ? `A formula fails on some input: ${e.message}`
          : 'Could not generate test cases from these formulas.',
      );
      return;
    }

    const existingQs = getAssignment(assignmentId)?.questions ?? [];
    const id =
      existingQuestion?.id ??
      existingQs.reduce((max, q) => Math.max(max, q.id), 0) + 1;

    onSave({
      id,
      label: label.trim(),
      statement: statement.trim(),
      buildMode: mode,
      representation: rep,
      cc_spec: bank.spec,
      test_cases: bank.test_cases,
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

      {/* Name + mode + representation (all per-question) */}
      <section className="instructor-creator-section">
        <label className="instructor-field">
          <span className="instructor-field-label">Question name</span>
          <input
            className="instructor-input instructor-input--name"
            placeholder="e.g. Problem 1"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
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
        </div>
        {SAMPLING_NOTE[mode] && <p className="instructor-hint">{SAMPLING_NOTE[mode]}</p>}
        {inputs.map((g, i) => (
          <div key={i} className="instructor-group-row">
            <input
              className="instructor-input instructor-input--name"
              placeholder="name"
              value={g.name}
              onChange={(e) => updateInput(i, { name: e.target.value })}
            />
            {isCC && (
              <label className="instructor-inline-field">
                max input value
                <input
                  className="instructor-input instructor-input--num"
                  type="number"
                  min={1}
                  max={maxInputLimit(rep)}
                  value={g.maxVal}
                  onChange={(e) => updateInput(i, { maxVal: Number(e.target.value) })}
                />
              </label>
            )}
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
        ) : tooLarge ? (
          <p className="instructor-preview-warning">
            Input space is too large to enumerate ({countCombos(inputs).toLocaleString()}{' '}
            combinations). Reduce the max input values.
          </p>
        ) : (
          <ProbePanel
            inputs={inputs}
            rep={rep}
            mode={mode}
            probeValues={probeValues}
            row={probe!.row}
            onProbeChange={(name, value) =>
              setProbeOverrides((o) => ({ ...o, [name]: value }))
            }
          />
        )}
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
  mode,
  probeValues,
  row,
  onProbeChange,
}: {
  inputs: AuthoredInputGroup[];
  rep: RepSystem;
  mode: BuildMode;
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
              max={probeMax(g, rep, mode)}
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
