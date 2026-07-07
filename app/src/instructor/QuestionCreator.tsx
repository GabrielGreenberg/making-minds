import { useState } from 'react';
import type {
  AssignmentQuestion,
  BuildMode,
  ComponentType,
  RepSystem,
  ArenaConfig,
  TurbotSuccessCriterion,
  PerceptionRule,
} from '../types';
import {
  buildPerceptionCases,
  describePerceptionRule,
  MAX_PERCEPTION_WIDTH,
  MIN_PERCEPTION_WIDTH,
} from '../engine/perception';
import { getAssignment } from '../assignments';
import { ArenaCanvas } from '../components/ArenaCanvas';
import { blankArena, resizeArena, setArenaCell, placeStart, MAX_ARENA_SIZE } from './arenaEditing';
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

// All modes are authorable through this one form: the group shapes, the DSL,
// and the representation toggle are all mode-agnostic. Only the input-size
// field differs: CC (the one finite, exhaustively tested space) asks for each
// group's max input value; SC/FSM/TM input spaces are unbounded, so they are
// tested on a fixed sample of values across a range of input lengths and have
// no size field at all. 'Open' is the odd one out: a free-text question is
// just a name + statement — no representation, formula, or test bank — and is
// reviewed manually instead of autograded.
const MODES: { mode: BuildMode; label: string }[] = [
  { mode: 'CC', label: 'CC' },
  { mode: 'SC', label: 'SC' },
  { mode: 'FSM', label: 'FSM' },
  { mode: 'TM', label: 'TM' },
  { mode: 'turbot', label: 'Turbot' },
  { mode: 'open', label: 'Open' },
];

// A turbot's brain is one of the four machine kinds (spec §9.3); the arena
// and criterion are shared regardless of which brain drives the turbot.
const INNER_MODES: { mode: BuildMode; label: string }[] = [
  { mode: 'CC', label: 'CC' },
  { mode: 'SC', label: 'SC' },
  { mode: 'FSM', label: 'FSM' },
  { mode: 'TM', label: 'TM' },
];

const CRITERIA: { value: TurbotSuccessCriterion; label: string; hint: string }[] = [
  { value: 'reach-and-stop', label: 'Reach goal and stop', hint: 'The turbot must halt itself (motor 00) on the goal cell.' },
  { value: 'pass-through', label: 'Pass through goal', hint: 'The turbot must visit the goal cell at some step.' },
  { value: 'return-to-start', label: 'Return to start', hint: 'The turbot must end on its starting cell — first visiting the goal cell, if the arena has one.' },
];

// The restrictable gate vocabulary (`allowed_components`, semantics in
// engine/machineValidation.ts): the CC/SC palette's placeable circuit
// components, in palette order. INPUT/OUTPUT are infrastructure — always
// allowed, so not offered as checkboxes (they're saved into the field
// explicitly for readability, matching the HW1 fixtures). FSM/TM canvases
// have a STATE-only vocabulary, so the restriction isn't offered there.
const RESTRICTABLE_GATES: { type: ComponentType; label: string }[] = [
  { type: 'AND', label: 'AND' },
  { type: 'OR', label: 'OR' },
  { type: 'NOT', label: 'NOT' },
  { type: 'MEM', label: 'MEM' },
];

type ArenaTool = 'block' | 'goal' | 'erase' | 'start';

const ARENA_TOOLS: { tool: ArenaTool; label: string }[] = [
  { tool: 'block', label: 'Block' },
  { tool: 'goal', label: 'Goal' },
  { tool: 'erase', label: 'Erase' },
  { tool: 'start', label: 'Turbot' },
];

const SAMPLING_NOTE: Partial<Record<BuildMode, string>> = {
  SC: 'SC inputs stream over time, so this question is tested on a sample of input values across a range of input lengths.',
  FSM: 'FSM inputs stream over time, so this question is tested on a sample of input values across a range of input lengths.',
  TM: 'The tape is unbounded, so this question is tested on a sample of input values across a range of input lengths.',
};

function blankInput(): AuthoredInputGroup {
  return { name: '', maxVal: 1 };
}

// Representation systems the codec grades against (the display-only 'plus' is not
// a grading representation, so it isn't offered here).
const REPS: RepSystem[] = ['binary', 'tally'];

// Perception rules, by the mode they belong to: run rules & patterns are
// spatial (one CC frame), change & motion are temporal (an SC frame stream).
type PerceptionKind = PerceptionRule['kind'];
const PERCEPTION_KINDS: Record<'CC' | 'SC', { kind: PerceptionKind; label: string }[]> = {
  CC: [
    { kind: 'min-run', label: 'At least k consecutive 1s (edge detector)' },
    { kind: 'exact-run', label: 'Exactly k consecutive 1s (object detector)' },
    { kind: 'pattern', label: 'Match an exact pattern (landmark recognition)' },
  ],
  SC: [
    { kind: 'change', label: 'Change detector (input differs from previous)' },
    { kind: 'motion', label: 'Motion detector (object moving upwards)' },
  ],
};

export function QuestionCreator({ assignmentId, existingQuestion, onSave, onCancel }: Props) {
  // Mode is an ordinary field of the shared form: new questions default to CC,
  // existing ones keep their mode. Switching it must NOT reset the groups/formulas
  // below — they're valid regardless of mode (the whole point of the shared shape).
  const [mode, setMode] = useState<BuildMode>(existingQuestion?.buildMode ?? 'CC');

  // One representation system per question (governs grading + the live check).
  const [rep, setRep] = useState<RepSystem>(
    () => existingQuestion?.representation === 'tally' ? 'tally' : 'binary',
  );

  // TM-only acceptance strictness: require the head to halt on the output
  // block's rightmost cell (standard position). Off = position-agnostic.
  const [requireStandardHalt, setRequireStandardHalt] = useState<boolean>(
    () => existingQuestion?.requireStandardHaltPosition ?? false,
  );

  // Component restriction (`allowed_components`). Off = unrestricted (the
  // field is omitted). On = students may use only the checked gates (plus
  // INPUT/OUTPUT, which are always allowed — see engine/machineValidation.ts).
  const [restrictComponents, setRestrictComponents] = useState<boolean>(
    () => (existingQuestion?.allowed_components?.length ?? 0) > 0,
  );
  const [allowedGates, setAllowedGates] = useState<ComponentType[]>(() => {
    const existing = existingQuestion?.allowed_components;
    const vocabulary = RESTRICTABLE_GATES.map((g) => g.type);
    return existing && existing.length > 0
      ? vocabulary.filter((t) => existing.includes(t))
      : vocabulary; // default when first enabled: everything checked
  });

  const [inputs, setInputs] = useState<AuthoredInputGroup[]>(() =>
    existingQuestion?.cc_spec?.inputs.map((g) => ({
      name: g.name,
      // Prefer the authored max value; older width-based questions fall back to
      // the largest value the stored width can hold.
      maxVal: g.max_value ??
        (existingQuestion.representation === 'tally' ? g.width : Math.pow(2, g.width) - 1),
    })) ?? [blankInput()],
  );
  // The target function: every question computes exactly ONE output, so the
  // instructor authors a single formula (the output group's name is fixed).
  const [formula, setFormula] = useState<string>(
    () => existingQuestion?.cc_spec?.outputs[0]?.formula ?? '',
  );
  const outputs: AuthoredOutputGroup[] = [{ name: 'f', formula }];
  const [label, setLabel] = useState(() => {
    if (existingQuestion) return existingQuestion.label;
    const count = getAssignment(assignmentId)?.questions.length ?? 0;
    return `Problem ${count + 1}`;
  });
  const [statement, setStatement] = useState(existingQuestion?.statement ?? '');

  // ── Perception fields (CC/SC questions with task === 'perception') ──
  // Perception questions grade raw bit frames against a rule, not a formula
  // (engine/perception.ts); representation is implicitly binary bits.
  const [task, setTask] = useState<'function' | 'perception'>(
    existingQuestion?.perception ? 'perception' : 'function',
  );
  const [pKind, setPKind] = useState<PerceptionKind>(
    existingQuestion?.perception?.rule.kind ?? 'min-run',
  );
  const [pWidth, setPWidth] = useState<number>(existingQuestion?.perception?.width ?? 8);
  const [pRunLength, setPRunLength] = useState<number>(() => {
    const r = existingQuestion?.perception?.rule;
    if (r?.kind === 'min-run' || r?.kind === 'exact-run') return r.runLength;
    if (r?.kind === 'motion') return r.objectLength;
    return 3;
  });
  const [pPattern, setPPattern] = useState<string>(() => {
    const r = existingQuestion?.perception?.rule;
    return r?.kind === 'pattern' ? r.pattern : '';
  });

  // ── Turbot-only fields (mode === 'turbot') ─────────────────────
  // One primary arena per question for now; the data model (`turbot_cases`)
  // is a list so held-out grading arenas can be added without a migration.
  const [innerMode, setInnerMode] = useState<BuildMode>(existingQuestion?.innerMode ?? 'CC');
  const [arena, setArena] = useState<ArenaConfig>(
    () => existingQuestion?.turbot_cases?.[0]?.arena ?? blankArena(),
  );
  const [maxSteps, setMaxSteps] = useState<number>(
    existingQuestion?.turbot_cases?.[0]?.maxSteps ?? 100,
  );
  const [criterion, setCriterion] = useState<TurbotSuccessCriterion>(
    existingQuestion?.turbot_cases?.[0]?.criterion ?? 'reach-and-stop',
  );
  const [arenaTool, setArenaTool] = useState<ArenaTool>('block');

  const handleArenaClick = (x: number, y: number) => {
    setArena((a) => {
      switch (arenaTool) {
        case 'block': return setArenaCell(a, x, y, 'block');
        case 'goal': return setArenaCell(a, x, y, 'goal');
        case 'erase': return setArenaCell(a, x, y, 'empty');
        case 'start': return placeStart(a, x, y);
      }
    });
  };

  // The single input the live probe evaluates the formulas on. Keyed by group
  // name (robust to add/remove/reorder); unset groups default to their max value.
  const [probeOverrides, setProbeOverrides] = useState<Record<string, number>>({});

  // Surfaced only if the save-time generation rejects a formula on some input
  // the single-input probe never exercised (e.g. a value that goes negative).
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Live, per-keystroke validation (all O(#groups), no space enumeration) ──
  const isTurbot = mode === 'turbot';
  const isOpen = mode === 'open';
  const canPerceive = mode === 'CC' || mode === 'SC';
  const isPerception = canPerceive && task === 'perception';

  // The restriction applies to gate-vocabulary canvases: CC/SC questions
  // (function or perception) and turbot questions whose brain is CC/SC.
  const canRestrictComponents =
    mode === 'CC' || mode === 'SC' || (isTurbot && (innerMode === 'CC' || innerMode === 'SC'));
  const allowedComponentsField: Pick<AssignmentQuestion, 'allowed_components'> =
    canRestrictComponents && restrictComponents
      ? { allowed_components: ['INPUT', 'OUTPUT', ...allowedGates] }
      : {};

  // The rule kind must match the mode's family; coerce when the mode flips.
  const kindChoices = mode === 'CC' || mode === 'SC' ? PERCEPTION_KINDS[mode] : [];
  const kind: PerceptionKind = kindChoices.some((k) => k.kind === pKind)
    ? pKind
    : (mode === 'SC' ? 'change' : 'min-run');

  // The effective retina width: a pattern rule's width IS its pattern length.
  const effWidth = kind === 'pattern' ? pPattern.length : pWidth;
  const rule: PerceptionRule =
    kind === 'min-run' ? { kind, runLength: pRunLength } :
    kind === 'exact-run' ? { kind, runLength: pRunLength } :
    kind === 'pattern' ? { kind, pattern: pPattern } :
    kind === 'change' ? { kind } :
    { kind: 'motion', objectLength: pRunLength };

  const perceptionError = !isPerception
    ? null
    : kind === 'pattern' && !/^[01]+$/.test(pPattern)
      ? 'The pattern must be a non-empty string of 0s and 1s.'
      : effWidth < MIN_PERCEPTION_WIDTH || effWidth > MAX_PERCEPTION_WIDTH
        ? `The number of inputs must be between ${MIN_PERCEPTION_WIDTH} and ${MAX_PERCEPTION_WIDTH}.`
        : (kind === 'min-run' || kind === 'exact-run' || kind === 'motion') &&
            (pRunLength < 1 || pRunLength > effWidth)
          ? 'The run length must be between 1 and the number of inputs.'
          : null;

  const structuralErrors =
    isTurbot || isOpen || isPerception ? [] : validateGroups(inputs, outputs, rep, mode);
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
  const probe = structurallyValid && !isTurbot && !isOpen && !isPerception
    ? probeFormulas(inputs, outputs, rep, probeValues, mode)
    : null;
  const formulasOk = probe ? probe.outputErrors.every((e) => e == null) : false;

  // Turbot questions are gated on the arena instead of the formula pipeline:
  // goal-directed criteria need at least one goal cell to be satisfiable.
  const arenaHasGoal = arena.cells.some((row) => row.some((c) => c === 'goal'));
  const needsGoal = criterion === 'reach-and-stop' || criterion === 'pass-through';
  const arenaError = isTurbot && needsGoal && !arenaHasGoal
    ? 'This success criterion needs at least one goal cell in the arena.'
    : null;

  // Open questions are just a name + statement; nothing else gates saving.
  const saveable =
    label.trim().length > 0 &&
    statement.trim().length > 0 &&
    (isOpen
      ? true
      : isTurbot
        ? maxSteps >= 1 && !arenaError
        : isPerception
          ? !perceptionError
          : structurallyValid && !tooLarge && formulasOk);

  // ── Group editing helpers ──────────────────────────────────────
  const updateInput = (i: number, patch: Partial<AuthoredInputGroup>) =>
    setInputs((gs) => gs.map((g, idx) => (idx === i ? { ...g, ...patch } : g)));

  const handleSave = () => {
    if (!saveable) return;

    const existingQsForId = getAssignment(assignmentId)?.questions ?? [];
    const newId =
      existingQuestion?.id ??
      existingQsForId.reduce((max, q) => Math.max(max, q.id), 0) + 1;

    // Open questions carry only their prompt — no test bank, no grading
    // machinery. The representation field is meaningless for them; store the
    // default so the type stays uniform.
    if (mode === 'open') {
      onSave({
        id: newId,
        label: label.trim(),
        statement: statement.trim(),
        buildMode: 'open',
        representation: 'binary',
      });
      return;
    }

    // Turbot questions carry an arena + criterion, not a generated test bank.
    // The authored encoding still matters: it picks a turbot-TM brain's
    // internal tape alphabet (binary {0,1,*}, unary {0,1}) for the editor,
    // the arena driver loop, and grading.
    if (mode === 'turbot') {
      onSave({
        id: newId,
        label: label.trim(),
        statement: statement.trim(),
        buildMode: 'turbot',
        representation: rep,
        ...allowedComponentsField,
        innerMode,
        turbot_cases: [{ arena, maxSteps, criterion }],
      });
      return;
    }

    // Perception questions carry a rule + generated bit-level frame bank; the
    // representation is implicitly binary (raw bits, no numeral system).
    if (isPerception) {
      let perception_cases;
      try {
        perception_cases = buildPerceptionCases({ rule, width: effWidth });
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : 'Could not generate perception cases.');
        return;
      }
      onSave({
        id: newId,
        label: label.trim(),
        statement: statement.trim(),
        buildMode: mode,
        representation: 'binary',
        ...allowedComponentsField,
        perception: { rule, width: effWidth },
        perception_cases,
      });
      return;
    }

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

    onSave({
      id: newId,
      label: label.trim(),
      statement: statement.trim(),
      buildMode: mode,
      representation: rep,
      // TM-only acceptance strictness; omitted (default) unless checked.
      ...(mode === 'TM' && requireStandardHalt ? { requireStandardHaltPosition: true } : {}),
      // Component restriction; omitted (default = unrestricted) unless enabled.
      ...allowedComponentsField,
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
        <div className="instructor-page-head-actions">
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
        {canPerceive && (
          <div className="instructor-section-head">
            <h4 className="instructor-subhead">Task</h4>
            <div className="instructor-encoding-toggle">
              {(['function', 'perception'] as const).map((t) => (
                <button
                  key={t}
                  className={
                    'instructor-encoding-btn' + (task === t ? ' instructor-encoding-btn--active' : '')
                  }
                  onClick={() => setTask(t)}
                >
                  {t === 'function' ? 'Function' : 'Perception'}
                </button>
              ))}
            </div>
          </div>
        )}
        {!isTurbot && !isOpen && !isPerception && (
          <div className="instructor-section-head">
            <h4 className="instructor-subhead">Representation</h4>
            <RepToggle value={rep} onChange={setRep} />
          </div>
        )}
        {mode === 'TM' && (
          <label className="instructor-inline-field">
            <input
              type="checkbox"
              checked={requireStandardHalt}
              onChange={(e) => setRequireStandardHalt(e.target.checked)}
            />
            Require standard halt position (the head must halt on the output block&#8217;s
            rightmost cell)
          </label>
        )}
        {isOpen && (
          <p className="instructor-hint">
            An open question is answered in free text and is not autograded — review the
            responses in the gradebook. (LLM-assisted grading may plug in here later.)
          </p>
        )}
        {isTurbot && (
          <>
            <div className="instructor-section-head">
              <h4 className="instructor-subhead">Internal machine</h4>
              <div className="instructor-encoding-toggle">
                {INNER_MODES.map((m) => (
                  <button
                    key={m.mode}
                    className={
                      'instructor-encoding-btn' +
                      (innerMode === m.mode ? ' instructor-encoding-btn--active' : '')
                    }
                    onClick={() => setInnerMode(m.mode)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            {/* The machine's encoding (stored as the question's representation;
                'tally' is the unary system). For a TM brain it picks the
                internal tape alphabet: binary {0,1,*}, unary {0,1}. */}
            <div className="instructor-section-head">
              <h4 className="instructor-subhead">Encoding</h4>
              <div className="instructor-encoding-toggle">
                {REPS.map((r) => (
                  <button
                    key={r}
                    className={
                      'instructor-encoding-btn' +
                      (rep === r ? ' instructor-encoding-btn--active' : '')
                    }
                    onClick={() => setRep(r)}
                  >
                    {r === 'tally' ? 'unary' : r}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
        {canRestrictComponents && (
          <>
            <label className="instructor-inline-field">
              <input
                type="checkbox"
                checked={restrictComponents}
                onChange={(e) => setRestrictComponents(e.target.checked)}
              />
              Restrict available components (students may build only with the checked
              components; inputs and outputs are always available, and boxed circuits
              may not contain anything else)
            </label>
            {restrictComponents && (
              <div className="instructor-criterion-row">
                {RESTRICTABLE_GATES.map((g) => (
                  <label key={g.type} className="instructor-inline-field">
                    <input
                      type="checkbox"
                      checked={allowedGates.includes(g.type)}
                      onChange={(e) =>
                        setAllowedGates(
                          RESTRICTABLE_GATES.map((r) => r.type).filter((t) =>
                            t === g.type ? e.target.checked : allowedGates.includes(t),
                          ),
                        )
                      }
                    />
                    {g.label}
                  </label>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {/* Turbot: arena editor + success criterion (replaces the value-based
          inputs/target-function pipeline below) */}
      {isTurbot && (
        <>
          <section className="instructor-creator-section">
            <div className="instructor-section-head">
              <h4 className="instructor-subhead">Arena</h4>
              <div className="instructor-encoding-toggle">
                {ARENA_TOOLS.map((t) => (
                  <button
                    key={t.tool}
                    className={
                      'instructor-encoding-btn' +
                      (arenaTool === t.tool ? ' instructor-encoding-btn--active' : '')
                    }
                    onClick={() => setArenaTool(t.tool)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <p className="instructor-hint">
              Click cells to paint with the selected tool. With the Turbot tool, click a cell to
              move the start there; click the turbot again to rotate it.
            </p>
            <div className="instructor-arena-size">
              <label className="instructor-inline-field">
                width
                <input
                  className="instructor-input instructor-input--num"
                  type="number"
                  min={1}
                  max={MAX_ARENA_SIZE}
                  value={arena.width}
                  onChange={(e) => setArena((a) => resizeArena(a, Number(e.target.value), a.height))}
                />
              </label>
              <label className="instructor-inline-field">
                height
                <input
                  className="instructor-input instructor-input--num"
                  type="number"
                  min={1}
                  max={MAX_ARENA_SIZE}
                  value={arena.height}
                  onChange={(e) => setArena((a) => resizeArena(a, a.width, Number(e.target.value)))}
                />
              </label>
            </div>
            <ArenaCanvas arena={arena} onCellClick={handleArenaClick} />
            {arenaError && <p className="instructor-preview-warning">{arenaError}</p>}
          </section>

          <section className="instructor-creator-section">
            <div className="instructor-section-head">
              <h4 className="instructor-subhead">Success criterion</h4>
            </div>
            <div className="instructor-criterion-row">
              <select
                className="instructor-input"
                value={criterion}
                onChange={(e) => setCriterion(e.target.value as TurbotSuccessCriterion)}
              >
                {CRITERIA.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
              <label className="instructor-inline-field">
                max steps
                <input
                  className="instructor-input instructor-input--num"
                  type="number"
                  min={1}
                  max={10000}
                  value={maxSteps}
                  onChange={(e) => setMaxSteps(Math.max(1, Math.trunc(Number(e.target.value)) || 1))}
                />
              </label>
            </div>
            <p className="instructor-hint">
              {CRITERIA.find((c) => c.value === criterion)?.hint} The turbot fails if it exceeds
              the step budget.
            </p>
          </section>
        </>
      )}

      {/* Perception: rule + retina size (replaces the value-based
          inputs/target-function pipeline below; grading is raw bits) */}
      {isPerception && (
        <section className="instructor-creator-section">
          <div className="instructor-section-head">
            <h4 className="instructor-subhead">Perception rule</h4>
          </div>
          <p className="instructor-hint">
            The machine's inputs are an array of stimulations (like light hitting a retina) and
            its single output classifies them. Grading feeds raw bit patterns
            {mode === 'SC' ? ' — one frame per clock tick — ' : ' '}to the circuit and checks the
            output bit{mode === 'SC' ? ' at every step. The "previous input" before the first frame is all 0s (what fresh MEM blocks hold).' : '.'}
          </p>
          <div className="instructor-criterion-row">
            <select
              className="instructor-input"
              value={kind}
              onChange={(e) => setPKind(e.target.value as PerceptionKind)}
            >
              {kindChoices.map((k) => (
                <option key={k.kind} value={k.kind}>{k.label}</option>
              ))}
            </select>
            {(kind === 'min-run' || kind === 'exact-run' || kind === 'motion') && (
              <label className="instructor-inline-field">
                {kind === 'motion' ? 'object length' : 'run length k'}
                <input
                  className="instructor-input instructor-input--num"
                  type="number"
                  min={1}
                  max={effWidth}
                  value={pRunLength}
                  onChange={(e) => setPRunLength(Math.max(1, Math.trunc(Number(e.target.value)) || 1))}
                />
              </label>
            )}
            {kind === 'pattern' ? (
              <label className="instructor-inline-field">
                pattern
                <input
                  className="instructor-input"
                  placeholder="e.g. 110010111"
                  value={pPattern}
                  onChange={(e) => setPPattern(e.target.value.replace(/[^01]/g, ''))}
                />
              </label>
            ) : (
              <label className="instructor-inline-field">
                inputs
                <input
                  className="instructor-input instructor-input--num"
                  type="number"
                  min={MIN_PERCEPTION_WIDTH}
                  max={MAX_PERCEPTION_WIDTH}
                  value={pWidth}
                  onChange={(e) => setPWidth(Math.trunc(Number(e.target.value)) || 0)}
                />
              </label>
            )}
          </div>
          {kind === 'pattern' && (
            <p className="instructor-hint">
              The number of inputs equals the pattern length ({effWidth || '—'}).
            </p>
          )}
          {perceptionError ? (
            <p className="instructor-preview-warning">{perceptionError}</p>
          ) : (
            <p className="instructor-hint">
              Rule: {describePerceptionRule(rule)}. The circuit needs {effWidth} inputs and 1 output.
            </p>
          )}
        </section>
      )}

      {/* Inputs */}
      {!isTurbot && !isOpen && !isPerception && (
      <>
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

      {/* Target function — one formula, one output. The live single-input
          check sits right next to the formula (no separate section). */}
      <section className="instructor-creator-section">
        <div className="instructor-section-head">
          <h4 className="instructor-subhead">Target function</h4>
        </div>
        <div className="instructor-formula-row">
          <label className="instructor-inline-field instructor-formula-field">
            f({inputs.map((g) => g.name.trim() || '?').join(', ')}) =
            <input
              className="instructor-input instructor-input--formula"
              placeholder="e.g. 2 * x"
              value={formula}
              onChange={(e) => setFormula(e.target.value)}
            />
          </label>
          {probe?.outputErrors[0] && (
            <span className="instructor-formula-error">{probe.outputErrors[0]}</span>
          )}
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
      </>
      )}

      {/* Statement — for an open question this IS the question. */}
      <section className="instructor-creator-section">
        <label className="instructor-field">
          <span className="instructor-field-label">
            {isOpen ? 'Question shown to students' : 'Instructions shown to students'}
          </span>
          <textarea
            className="instructor-textarea"
            rows={isOpen ? 8 : 4}
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
            placeholder={
              isOpen
                ? 'Write the question the student answers in prose (mention the expected length, e.g. ~1 paragraph)…'
                : "Describe the function the student's circuit must compute…"
            }
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
      <span className="instructor-probe-name">check:</span>
      <div className="instructor-probe-inputs">
        {inputs.map((g, i) => (
          <label key={i} className="instructor-probe-field">
            <span className="instructor-probe-name">{g.name}</span>
            <input
              className="instructor-input instructor-input--num"
              type="text"
              inputMode="numeric"
              title={`0 to ${probeMax(g, rep, mode)}`}
              value={probeValues[i]}
              onChange={(e) => {
                const v = Number(e.target.value.replace(/[^0-9]/g, ''));
                onProbeChange(g.name, Number.isFinite(v) ? v : 0);
              }}
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
            <span className="instructor-probe-name">f =</span>{' '}
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
