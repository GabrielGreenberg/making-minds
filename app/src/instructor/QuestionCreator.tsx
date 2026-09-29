import { useState } from 'react';
import type { Callout, Figure } from '../types';
import { CalloutsEditor, FiguresEditor } from './DocumentEditors';
import type {
  AssignmentData,
  AssignmentQuestion,
  BuildMode,
  ComponentType,
  RepSystem,
  QuestionTask,
} from '../types';
import { QUESTION_TASKS, questionTask, modeHoldsMemory } from '../types';
import { FillInBlanksEditor } from './FillInBlanksEditor';
import { FillInNumeralEditor } from './FillInNumeralEditor';
import { FillInTableEditor } from './FillInTableEditor';
import {
  blankDraftsOf,
  fillInFields,
  fillInNumeralFields,
  fillInNumeralProblems,
  fillInProblems,
  fillInTableFields,
  fillInTableProblems,
  misplacedAnswersWarning,
  misplacedBlanks,
  misplacedNumeralWarning,
  misplacedTableWarning,
  newBlankDraft,
  newNumeralDraft,
  newTableDraft,
  numeralCaseCount,
  numeralDraftOf,
  tableDraftOf,
} from './fillInAuthoring';
import { PerceptionEditor } from './PerceptionEditor';
import { draftFromQuestion, draftProblems, perceptionFields } from './perceptionAuthoring';
import { TurbotArenasEditor } from './TurbotArenasEditor';
import {
  misplacedArenas,
  misplacedArenasWarning,
  turbotCaseDraftsOf,
  turbotCaseProblems,
  turbotCasesField,
} from './turbotCaseAuthoring';
import {
  buildQuestionBank,
  type AuthoredInputGroup,
  type AuthoredOutputGroup,
} from '../engine/testVectorGen';
import { FormulaError } from '../engine/formulaEval';
import { halfCreditProblem, questionCaseCount } from '../engine/score';
import { StatementBody } from '../components/StatementBody';
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
  // The assignment being edited. The creator reads its question list for the
  // default label and new-question id allocation; the parent editor already
  // holds the fetched value, so no seam read happens here.
  assignment: AssignmentData;
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
// reviewed manually instead of autograded; its fill-in task adds labelled
// blanks with an answer each, and is autograded by string comparison.
const MODES: { mode: BuildMode; label: string }[] = [
  { mode: 'CC', label: 'CC' },
  { mode: 'SC', label: 'SC' },
  { mode: 'FSM', label: 'FSM' },
  { mode: 'TM', label: 'TM' },
  { mode: 'turbot', label: 'Turbot' },
  { mode: 'open', label: 'Open' },
];

// A turbot's brain is one of the four machine kinds (spec §9.3); the arenas
// and their criteria are the same whichever brain drives the turbot.
const INNER_MODES: { mode: BuildMode; label: string }[] = [
  { mode: 'CC', label: 'CC' },
  { mode: 'SC', label: 'SC' },
  { mode: 'FSM', label: 'FSM' },
  { mode: 'TM', label: 'TM' },
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

// Types a question can put a BUDGET on (`component_limits`). The gates, plus
// BOXED — "only use ONE sub-part" (HW2 P6) is the motivating case, and it is
// a cap on boxed instances. Blank = no cap on that type.
const BUDGETABLE_COMPONENTS: { type: ComponentType; label: string }[] = [
  ...RESTRICTABLE_GATES,
  { type: 'BOXED', label: 'Boxed sub-parts' },
];

const SAMPLING_NOTE: Partial<Record<BuildMode, string>> = {
  SC: 'SC inputs stream over time, so this question is tested on a sample of input values across a range of input lengths.',
  FSM: 'FSM inputs stream over time, so this question is tested on a sample of input values across a range of input lengths.',
  TM: 'The tape is unbounded, so this question is tested on a sample of input values across a range of input lengths.',
};

function blankInput(): AuthoredInputGroup {
  return { name: '', maxVal: 1 };
}

// The Task toggle's words for each task a mode offers (types.ts QUESTION_TASKS;
// a mode with one task shows no toggle).
const TASK_LABELS: Record<QuestionTask, string> = {
  function: 'Function',
  perception: 'Perception',
  turbot: 'Turbot',
  open: 'Free response',
  'fill-in': 'Fill-in',
};

// Representation systems the codec grades against (the display-only 'plus' is not
// a grading representation, so it isn't offered here).
const REPS: RepSystem[] = ['binary', 'tally'];

export function QuestionCreator({ assignment, existingQuestion, onSave, onCancel }: Props) {
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

  // Tape budget: the largest number of tape cells a run may occupy. Held as
  // text so the field can be cleared back to "unbudgeted"; TM questions and
  // TM-brained turbots only.
  const [maxTapeCells, setMaxTapeCells] = useState<string>(
    () => (existingQuestion?.maxTapeCells !== undefined ? String(existingQuestion.maxTapeCells) : ''),
  );

  // The automatic ½ rule (task 061): "½ when at least K of the N cases pass".
  // Held as text so it can be cleared back to "no half credit".
  const [halfCreditAt, setHalfCreditAt] = useState<string>(
    () => (existingQuestion?.half_credit_at !== undefined ? String(existingQuestion.half_credit_at) : ''),
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

  // Component budget (`component_limits`). Held as text so a field can be
  // cleared to "no cap"; only well-formed non-negative integers are saved.
  const [limitComponents, setLimitComponents] = useState<boolean>(
    () => Object.keys(existingQuestion?.component_limits ?? {}).length > 0,
  );
  const [componentLimits, setComponentLimits] = useState<Record<string, string>>(() => {
    const existing = existingQuestion?.component_limits ?? {};
    const out: Record<string, string> = {};
    for (const b of BUDGETABLE_COMPONENTS) {
      const v = existing[b.type];
      out[b.type] = typeof v === 'number' ? String(v) : '';
    }
    return out;
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
    return `Problem ${assignment.questions.length + 1}`;
  });
  const [statement, setStatement] = useState(existingQuestion?.statement ?? '');
  // Optional short name for the problem, shown bold above the statement.
  const [title, setTitle] = useState(existingQuestion?.title ?? '');
  // Optional nudge, rendered italic on its own line under the statement.
  const [hint, setHint] = useState(existingQuestion?.hint ?? '');
  // The problem's own callout boxes and figures (the document level).
  const [callouts, setCallouts] = useState<Callout[]>(existingQuestion?.callouts ?? []);
  const [figures, setFigures] = useState<Figure[]>(existingQuestion?.figures ?? []);
  // Multi-part problems (task 048; types.ts AssignmentQuestion.partOf): a
  // written question may take a one-line field, be a later part of another
  // written question's problem, or — standing as a problem, or as its first
  // part — carry the problem's stem and closing. Display only; every one is
  // rebuilt into the saved question below, or a save would drop it.
  const [answerField, setAnswerField] = useState<'paragraph' | 'line'>(
    existingQuestion?.answerField === 'line' ? 'line' : 'paragraph',
  );
  const [partOf, setPartOf] = useState<number | null>(existingQuestion?.partOf ?? null);
  const [stem, setStem] = useState(existingQuestion?.stem ?? '');
  const [closing, setClosing] = useState(existingQuestion?.closing ?? '');
  // A question others are parts of is a first part: it cannot become a part
  // itself (parts do not nest). The problems it may join: written questions
  // that are no part themselves.
  const ownParts = existingQuestion ? assignment.questions.filter((q) => q.partOf === existingQuestion.id) : [];
  const partOfChoices = assignment.questions.filter(
    (q) => q.buildMode === 'open' && q.partOf === undefined && q.id !== existingQuestion?.id,
  );

  // What the question asks for (types.ts questionTask) — a choice among the
  // tasks its mode offers: Function/Perception on CC and SC, Free response/
  // Fill-in on Open. Held as picked and coerced to the mode below, so
  // flipping the mode away and back keeps the choice.
  const [task, setTask] = useState<QuestionTask>(
    existingQuestion ? questionTask(existingQuestion) : 'function',
  );

  // ── Fill-in fields (open questions with task === 'fill-in') ────
  // Three shapes (engine/fillIn.ts fillInShape), all drafted in
  // ./fillInAuthoring.ts and saved as `fill_in` + the stripped
  // `fill_in_answers`: labelled blanks, one row per blank — label, digits-only
  // flag and answer together — an argument–value table (task 079), or an
  // invented numeral system (task 080 — no key at all). Each keeps its own
  // draft, so flipping the shape and back loses nothing.
  // `savedBlanks` / `savedTable` / `savedNumeral` are what the question
  // opened with: students' answers are stored by position, so an edit that
  // would misplace them is warned about in the editor and confirmed at save.
  const [savedBlanks] = useState(() => blankDraftsOf(existingQuestion));
  const [blankDrafts, setBlankDrafts] = useState(savedBlanks);
  const [savedTable] = useState(() => tableDraftOf(existingQuestion));
  const [tableDraft, setTableDraft] = useState(() => savedTable ?? newTableDraft());
  const [savedNumeral] = useState(() => numeralDraftOf(existingQuestion));
  const [numeralDraft, setNumeralDraft] = useState(() => savedNumeral ?? newNumeralDraft());
  const [fillShape, setFillShape] = useState<'blanks' | 'table' | 'numeral'>(
    savedTable ? 'table' : savedNumeral ? 'numeral' : 'blanks',
  );

  // ── Perception fields (CC/SC questions with task === 'perception') ──
  // Perception questions grade raw bit frames against a rule, not a formula
  // (engine/perception.ts); representation is implicitly binary bits. One
  // draft: the rule's fields and the instructor's own films
  // (./perceptionAuthoring.ts); the kind is coerced when the mode flips.
  const [perceptionDraft, setPerceptionDraft] = useState(() => draftFromQuestion(existingQuestion));

  // ── Turbot-only fields (mode === 'turbot') ─────────────────────
  // The arena family (`turbot_cases`): one draft per arena, each with its own
  // criterion and step budget (./turbotCaseAuthoring.ts), never fewer than
  // one. The arena being edited is held by its draft key, so reordering or
  // removing arenas never points the editor at another one. `savedArenas` are
  // the rows the question opened with (none for a new question or one of
  // another mode): graded runs are stored by position, so the saved arenas
  // that no longer keep their slot are warned about and confirmed at save.
  const [innerMode, setInnerMode] = useState<BuildMode>(existingQuestion?.innerMode ?? 'CC');
  const [caseDrafts, setCaseDrafts] = useState(() => turbotCaseDraftsOf(existingQuestion));
  const [savedArenas] = useState(() =>
    (existingQuestion?.turbot_cases?.length ?? 0) > 0 ? caseDrafts : []);
  const [activeArenaKey, setActiveArenaKey] = useState(() => caseDrafts[0].key);

  // The single input the live probe evaluates the formulas on. Keyed by group
  // name (robust to add/remove/reorder); unset groups default to their max value.
  const [probeOverrides, setProbeOverrides] = useState<Record<string, number>>({});

  // Surfaced only if the save-time generation rejects a formula on some input
  // the single-input probe never exercised (e.g. a value that goes negative).
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Live, per-keystroke validation (all O(#groups), no space enumeration) ──
  const isTurbot = mode === 'turbot';
  const isOpen = mode === 'open';
  const taskChoices = QUESTION_TASKS[mode];
  const effTask: QuestionTask = taskChoices.includes(task) ? task : taskChoices[0];
  const isPerception = effTask === 'perception';
  const isFillIn = effTask === 'fill-in';
  const isFillTable = isFillIn && fillShape === 'table';
  const isFillNumeral = isFillIn && fillShape === 'numeral';
  const isFillBlanks = isFillIn && fillShape === 'blanks';
  const fillInErrors = isFillIn
    ? isFillTable ? fillInTableProblems(tableDraft)
      : isFillNumeral ? fillInNumeralProblems(numeralDraft)
        : fillInProblems(blankDrafts)
    : [];
  // Saving anything but these blanks (a table, a numeral, another task,
  // another mode) drops them; likewise the table and the numeral.
  const misplacedAnswers = misplacedBlanks(savedBlanks, isFillBlanks ? blankDrafts : []);
  const misplacedTable = misplacedTableWarning(savedTable, isFillTable ? tableDraft : null);
  const misplacedNumeral = misplacedNumeralWarning(savedNumeral, isFillNumeral ? numeralDraft : null);

  // The restriction applies to gate-vocabulary canvases: CC/SC questions
  // (function or perception) and turbot questions whose brain is CC/SC.
  const canRestrictComponents =
    mode === 'CC' || mode === 'SC' || (isTurbot && (innerMode === 'CC' || innerMode === 'SC'));
  // The canvas's own vocabulary: a combinatorial canvas holds no memory
  // (types.ts modeHoldsMemory), so MEM is neither offered nor saved there.
  const canvasHoldsMemory = modeHoldsMemory(isTurbot ? innerMode : mode);
  const restrictableGates = RESTRICTABLE_GATES.filter((g) => g.type !== 'MEM' || canvasHoldsMemory);
  const budgetableComponents = BUDGETABLE_COMPONENTS.filter((b) => b.type !== 'MEM' || canvasHoldsMemory);
  const allowedComponentsField: Pick<AssignmentQuestion, 'allowed_components'> =
    canRestrictComponents && restrictComponents
      ? { allowed_components: ['INPUT', 'OUTPUT', ...allowedGates.filter((t) => restrictableGates.some((g) => g.type === t))] }
      : {};

  // A tape budget only means something where there is a tape.
  const hasTape = mode === 'TM' || (isTurbot && innerMode === 'TM');
  const maxTapeCellsField: Pick<AssignmentQuestion, 'maxTapeCells'> = (() => {
    if (!hasTape) return {};
    const raw = maxTapeCells.trim();
    if (raw === '') return {};
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? { maxTapeCells: n } : {};
  })();

  // Half credit needs cases to count: every autograded kind (a machine, a
  // turbot's arenas, a perception bank, fill-in blanks) — not free text.
  const canHalfCredit = !(isOpen && !isFillIn);
  const halfCreditField: Pick<AssignmentQuestion, 'half_credit_at'> = (() => {
    if (!canHalfCredit) return {};
    const raw = halfCreditAt.trim();
    return raw === '' ? {} : { half_credit_at: Number(raw) };
  })();
  // N as far as it is known before save: the drafts for turbot arenas,
  // fill-in blanks, a table's key rows and a numeral's boxes; an edited
  // question's own bank otherwise (a generated bank is rebuilt at save, where
  // the rule is checked against it).
  const knownCaseCount: number | null = isTurbot
    ? caseDrafts.length
    : isFillIn
      ? isFillTable ? tableDraft.keyRows.length : isFillNumeral ? numeralCaseCount(numeralDraft) : blankDrafts.length
      : existingQuestion && existingQuestion.buildMode === mode
        ? questionCaseCount(existingQuestion)
        : null;

  // Every save goes through here: the ½ rule is judged against the bank the
  // question will actually carry (engine/score.ts halfCreditProblem).
  const saveQuestion = (q: AssignmentQuestion) => {
    const next: AssignmentQuestion = { ...q, ...halfCreditField };
    const problem = halfCreditProblem(next);
    if (problem) {
      setSaveError(`Half credit: ${problem}.`);
      return;
    }
    onSave(next);
  };

  // A budget is meaningful on any canvas that has components to count.
  const canLimitComponents = mode !== 'open';
  const componentLimitsField: Pick<AssignmentQuestion, 'component_limits'> = (() => {
    if (!canLimitComponents || !limitComponents) return {};
    const limits: Partial<Record<ComponentType, number>> = {};
    for (const b of budgetableComponents) {
      const raw = (componentLimits[b.type] ?? '').trim();
      if (raw === '') continue;
      const n = Number(raw);
      if (Number.isInteger(n) && n >= 0) limits[b.type] = n;
    }
    return Object.keys(limits).length > 0 ? { component_limits: limits } : {};
  })();

  const perceptionMode = mode === 'SC' ? 'SC' : 'CC';
  const perceptionError = isPerception ? draftProblems(perceptionDraft, perceptionMode)[0] ?? null : null;

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

  // Turbot questions are gated on their arenas instead of the formula
  // pipeline: every arena must be passable (goal-directed criteria need a
  // goal cell) with a step budget of at least 1.
  const turbotProblems = isTurbot ? turbotCaseProblems(caseDrafts) : [];
  // Saving another mode drops every arena, so every graded run loses its own.
  const misplacedRuns = misplacedArenas(savedArenas, isTurbot ? caseDrafts : []);

  // A free-response question is just a name + statement; a fill-in one also
  // needs a sound list of blanks. A problem may be its title alone ("Spiral"
  // over an arena, "+1 T"), so either the title or the statement must say
  // something.
  const saveable =
    label.trim().length > 0 &&
    (statement.trim().length > 0 || title.trim().length > 0) &&
    (isOpen
      ? fillInErrors.length === 0
      : isTurbot
        ? turbotProblems.length === 0
        : isPerception
          ? !perceptionError
          : structurallyValid && !tooLarge && formulasOk);

  // ── Group editing helpers ──────────────────────────────────────
  const updateInput = (i: number, patch: Partial<AuthoredInputGroup>) =>
    setInputs((gs) => gs.map((g, idx) => (idx === i ? { ...g, ...patch } : g)));

  const handleSave = () => {
    if (!saveable) return;
    // What this save would misplace in work already stored by position.
    const misplacing = [
      ...(misplacedAnswers.length > 0 ? [misplacedAnswersWarning(misplacedAnswers)] : []),
      ...(misplacedTable ? [misplacedTable] : []),
      ...(misplacedNumeral ? [misplacedNumeral] : []),
      ...(misplacedRuns.length > 0 ? [misplacedArenasWarning(misplacedRuns)] : []),
    ];
    if (misplacing.length > 0 && !window.confirm(`${misplacing.join('\n\n')}\n\nSave anyway?`)) {
      return;
    }

    const existingQsForId = assignment.questions;
    const newId =
      existingQuestion?.id ??
      existingQsForId.reduce((max, q) => Math.max(max, q.id), 0) + 1;

    // Open questions carry their prompt and, for fill-in, the blanks + their
    // key — no test bank, no machine. A free-response save drops any blanks.
    // The representation field is meaningless for them; store the default so
    // the type stays uniform.
    if (mode === 'open') {
      const part = ownParts.length === 0 && partOf !== null ? partOf : null;
      saveQuestion({
        id: newId,
        label: label.trim(),
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(hint.trim() ? { hint: hint.trim() } : {}),
        ...(callouts.length ? { callouts } : {}),
        ...(figures.length ? { figures } : {}),
        statement: statement.trim(),
        buildMode: 'open',
        representation: 'binary',
        ...(isFillTable ? fillInTableFields(tableDraft)
          : isFillNumeral ? fillInNumeralFields(numeralDraft)
            : isFillBlanks ? fillInFields(blankDrafts) : {}),
        ...(!isFillIn && answerField === 'line' ? { answerField: 'line' as const } : {}),
        // A part's problem text lives on its first part; only a problem's
        // own first question keeps a stem and closing.
        ...(part !== null
          ? { partOf: part }
          : { ...(stem.trim() ? { stem: stem.trim() } : {}), ...(closing.trim() ? { closing: closing.trim() } : {}) }),
      });
      return;
    }

    // Turbot questions carry their arenas + criteria, not a generated test bank.
    // The authored encoding still matters: it picks a turbot-TM brain's
    // internal tape alphabet (binary {0,1,*}, unary {0,1}) for the editor,
    // the arena driver loop, and grading.
    if (mode === 'turbot') {
      saveQuestion({
        id: newId,
        label: label.trim(),
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(hint.trim() ? { hint: hint.trim() } : {}),
        ...(callouts.length ? { callouts } : {}),
        ...(figures.length ? { figures } : {}),
        statement: statement.trim(),
        buildMode: 'turbot',
        representation: rep,
        ...allowedComponentsField,
        ...componentLimitsField,
        ...maxTapeCellsField,
        innerMode,
        turbot_cases: turbotCasesField(caseDrafts),
      });
      return;
    }

    // Perception questions carry a rule + generated bit-level frame bank; the
    // representation is implicitly binary (raw bits, no numeral system).
    if (isPerception) {
      let fields;
      try {
        fields = perceptionFields(perceptionDraft, perceptionMode);
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : 'Could not generate perception cases.');
        return;
      }
      saveQuestion({
        id: newId,
        label: label.trim(),
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(hint.trim() ? { hint: hint.trim() } : {}),
        ...(callouts.length ? { callouts } : {}),
        ...(figures.length ? { figures } : {}),
        statement: statement.trim(),
        buildMode: mode,
        representation: 'binary',
        ...allowedComponentsField,
        ...componentLimitsField,
        ...maxTapeCellsField,
        ...fields,
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

    saveQuestion({
      id: newId,
      label: label.trim(),
      ...(title.trim() ? { title: title.trim() } : {}),
      ...(hint.trim() ? { hint: hint.trim() } : {}),
      ...(callouts.length ? { callouts } : {}),
      ...(figures.length ? { figures } : {}),
      statement: statement.trim(),
      buildMode: mode,
      representation: rep,
      // TM-only acceptance strictness; omitted (default) unless checked.
      ...(mode === 'TM' && requireStandardHalt ? { requireStandardHaltPosition: true } : {}),
      ...maxTapeCellsField,
      // Component restriction; omitted (default = unrestricted) unless enabled.
      ...allowedComponentsField,
      ...componentLimitsField,
      cc_spec: bank.spec,
      test_cases: bank.test_cases,
    });
  };

  return (
    <div className="instructor-creator">
      <div className="mm-head mm-head--row">
        <h1>
          {existingQuestion ? `Edit ${existingQuestion.label}` : `New ${mode} question`}
        </h1>
        <div className="mm-actions">
          {saveError && <span className="instructor-formula-error">{saveError}</span>}
          <button className="mm-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="mm-btn mm-btn--primary"
            disabled={!saveable}
            onClick={handleSave}
          >
            {existingQuestion ? 'Save Question' : 'Add to Assignment'}
          </button>
        </div>
      </div>

      {/* Name + mode + representation (all per-question) */}
      <section className="instructor-creator-section">
        <label className="mm-field">
          <span className="mm-label">Question name</span>
          <input
            className="mm-input mm-input--name"
            placeholder="e.g. Problem 1"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <label className="mm-field">
          <span className="mm-label">Title (optional)</span>
          <input
            className="mm-input"
            placeholder="e.g. Reconstructing OR"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <div className="mm-section-head">
          <h3>Mode</h3>
          <div className="mm-segmented">
            {MODES.map((m) => (
              <button
                key={m.mode}
                className={
                  'mm-segmented-btn' +
                  (mode === m.mode ? ' mm-segmented-btn--active' : '')
                }
                onClick={() => setMode(m.mode)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        {taskChoices.length > 1 && (
          <div className="mm-section-head">
            <h3>Task</h3>
            <div className="mm-segmented">
              {taskChoices.map((t) => (
                <button
                  key={t}
                  className={
                    'mm-segmented-btn' + (effTask === t ? ' mm-segmented-btn--active' : '')
                  }
                  onClick={() => {
                    setTask(t);
                    // A first switch to fill-in starts with one blank to fill.
                    if (t === 'fill-in' && blankDrafts.length === 0) setBlankDrafts([newBlankDraft([])]);
                  }}
                >
                  {TASK_LABELS[t]}
                </button>
              ))}
            </div>
          </div>
        )}
        {!isTurbot && !isOpen && !isPerception && (
          <div className="mm-section-head">
            <h3>Representation</h3>
            <RepToggle value={rep} onChange={setRep} />
          </div>
        )}
        {mode === 'TM' && (
          <label className="mm-inline-field">
            <input
              type="checkbox"
              checked={requireStandardHalt}
              onChange={(e) => setRequireStandardHalt(e.target.checked)}
            />
            Require standard halt position (the head must halt on the output block&#8217;s
            rightmost cell)
          </label>
        )}
        {hasTape && (
          <label className="mm-inline-field">
            Max tape cells
            <input
              className="mm-input mm-input--num"
              type="number"
              min={1}
              placeholder="—"
              value={maxTapeCells}
              onChange={(e) => setMaxTapeCells(e.target.value)}
            />
            <span className="instructor-count">
              blank = unbudgeted; counts the span of cells the head occupies
            </span>
          </label>
        )}
        {canHalfCredit && (
          <label className="mm-inline-field">
            Half credit
            <input
              className="mm-input mm-input--num"
              type="number"
              min={1}
              placeholder="—"
              aria-label="Half credit: the fewest passing cases that earn ½"
              value={halfCreditAt}
              onChange={(e) => setHalfCreditAt(e.target.value)}
            />
            <span className="instructor-count">
              {halfCreditAt.trim() === ''
                ? 'blank = 0 or 1 only; a number K gives ½ when at least K cases pass'
                : `½ if at least ${halfCreditAt.trim()} of ${knownCaseCount ?? 'N'} ${isTurbot ? 'arenas' : isFillTable ? 'rows' : isFillNumeral ? 'fields' : isFillIn ? 'blanks' : 'cases'} pass` +
                  (knownCaseCount === null ? ' (N is set when the bank is built at save)' : '')}
            </span>
          </label>
        )}
        {isOpen && !isFillIn && (
          <p className="mm-note mm-hint">
            An open question is answered in free text and is not autograded — review the
            responses in the gradebook. (LLM-assisted grading may plug in here later.)
          </p>
        )}
        {isFillIn && (
          <>
            <div className="mm-section-head">
              <h3>Answer shape</h3>
              <div className="mm-segmented">
                {(['blanks', 'table', 'numeral'] as const).map((shape) => (
                  <button
                    key={shape}
                    className={'mm-segmented-btn' + (fillShape === shape ? ' mm-segmented-btn--active' : '')}
                    onClick={() => {
                      setFillShape(shape);
                      // A first switch to blanks starts with one blank to fill.
                      if (shape === 'blanks' && blankDrafts.length === 0) setBlankDrafts([newBlankDraft([])]);
                    }}
                  >
                    {shape === 'blanks' ? 'Blanks' : shape === 'table' ? 'Table' : 'Numeral'}
                  </button>
                ))}
              </div>
            </div>
            {isFillTable ? (
              <>
                <p className="mm-note mm-hint">
                  The student fills a blank table — the arguments as well as the values — and it
                  is autograded as a function: each key row passes when exactly one of the
                  student&#8217;s rows has its arguments and that row&#8217;s values match. Row
                  order never matters, empty rows are ignored, and two rows with the same
                  arguments fail that key row. Cells compare as blanks do (surrounding spaces and
                  leading zeros ignored); a digits-only column refuses every other character.
                  With no key rows at all it is graded by hand instead (type the rows students see).
                </p>
                {misplacedAnswers.length > 0 && (
                  <p className="instructor-preview-warning" role="alert">
                    {misplacedAnswersWarning(misplacedAnswers)}
                  </p>
                )}
                {misplacedNumeral && (
                  <p className="instructor-preview-warning" role="alert">{misplacedNumeral}</p>
                )}
                <FillInTableEditor draft={tableDraft} saved={savedTable} onChange={setTableDraft} />
              </>
            ) : isFillNumeral ? (
              <>
                <p className="mm-note mm-hint">
                  The student invents a symbol for each digit of the base, typed in a box labelled
                  with its meaning, then writes each number below in that system. There is no answer
                  key: it is autograded by rule, against the student&#8217;s own symbols. A symbol
                  passes when it is one character (an emoji counts as one), not a digit 0&#8211;9, and
                  unlike the other symbols (&#8220;a&#8221; and &#8220;A&#8221; differ); a number
                  passes when it is exactly the student&#8217;s symbols for its digits in the base
                  (spaces ignored), and those symbols pass. Answers match boxes by position: once
                  students have started, keep the base, relabel numbers in place and add new ones at
                  the end.
                </p>
                {misplacedAnswers.length > 0 && (
                  <p className="instructor-preview-warning" role="alert">
                    {misplacedAnswersWarning(misplacedAnswers)}
                  </p>
                )}
                {misplacedTable && (
                  <p className="instructor-preview-warning" role="alert">{misplacedTable}</p>
                )}
                <FillInNumeralEditor draft={numeralDraft} saved={savedNumeral} onChange={setNumeralDraft} />
              </>
            ) : (
              <>
                <p className="mm-note mm-hint">
                  The student types an answer into each labelled blank, and it is autograded by
                  string comparison — surrounding spaces and leading zeros are ignored
                  (&#8220;0011&#8221; matches &#8220;11&#8221;). A digits-only blank refuses every
                  other character. Answers match blanks by position: once students have started,
                  relabel blanks in place and add new ones at the end.
                </p>
                {misplacedTable && (
                  <p className="instructor-preview-warning" role="alert">{misplacedTable}</p>
                )}
                {misplacedNumeral && (
                  <p className="instructor-preview-warning" role="alert">{misplacedNumeral}</p>
                )}
                <FillInBlanksEditor drafts={blankDrafts} saved={savedBlanks} onChange={setBlankDrafts} />
              </>
            )}
          </>
        )}
        {isTurbot && (
          <>
            <div className="mm-section-head">
              <h3>Internal machine</h3>
              <div className="mm-segmented">
                {INNER_MODES.map((m) => (
                  <button
                    key={m.mode}
                    className={
                      'mm-segmented-btn' +
                      (innerMode === m.mode ? ' mm-segmented-btn--active' : '')
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
            <div className="mm-section-head">
              <h3>Encoding</h3>
              <div className="mm-segmented">
                {REPS.map((r) => (
                  <button
                    key={r}
                    className={
                      'mm-segmented-btn' +
                      (rep === r ? ' mm-segmented-btn--active' : '')
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
            <label className="mm-inline-field">
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
                {restrictableGates.map((g) => (
                  <label key={g.type} className="mm-inline-field">
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
        {canLimitComponents && (
          <>
            <label className="mm-inline-field">
              <input
                type="checkbox"
                checked={limitComponents}
                onChange={(e) => setLimitComponents(e.target.checked)}
              />
              Limit how many components may be used (leave a box blank for no
              cap; components inside boxed circuits are counted too)
            </label>
            {limitComponents && (
              <div className="instructor-criterion-row">
                {budgetableComponents.map((b) => (
                  <label key={b.type} className="mm-inline-field">
                    {b.label}
                    <input
                      className="mm-input mm-input--num"
                      type="number"
                      min={0}
                      placeholder="—"
                      value={componentLimits[b.type] ?? ''}
                      onChange={(e) =>
                        setComponentLimits({ ...componentLimits, [b.type]: e.target.value })
                      }
                    />
                  </label>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {/* Turbot: the arena family, each arena with its own success criterion
          and step budget (replaces the value-based inputs/target-function
          pipeline below) */}
      {isTurbot && (
        <TurbotArenasEditor
          drafts={caseDrafts}
          saved={savedArenas}
          activeKey={activeArenaKey}
          onChange={setCaseDrafts}
          onSelect={setActiveArenaKey}
        />
      )}

      {/* Perception: rule + retina size + films (replaces the value-based
          inputs/target-function pipeline below; grading is raw bits) */}
      {isPerception && (
        <PerceptionEditor mode={perceptionMode} draft={perceptionDraft} onChange={setPerceptionDraft} />
      )}

      {/* Inputs */}
      {!isTurbot && !isOpen && !isPerception && (
      <>
      <section className="instructor-creator-section">
        <div className="mm-section-head">
          <h3>Input groups</h3>
        </div>
        {SAMPLING_NOTE[mode] && <p className="mm-note mm-hint">{SAMPLING_NOTE[mode]}</p>}
        {inputs.map((g, i) => (
          <div key={i} className="instructor-group-row">
            <input
              className="mm-input mm-input--name"
              placeholder="name"
              value={g.name}
              onChange={(e) => updateInput(i, { name: e.target.value })}
            />
            {isCC && (
              <label className="mm-inline-field">
                max input value
                <input
                  className="mm-input mm-input--num"
                  type="number"
                  min={1}
                  max={maxInputLimit(rep)}
                  value={g.maxVal}
                  onChange={(e) => updateInput(i, { maxVal: Number(e.target.value) })}
                />
              </label>
            )}
            <button
              className="mm-btn mm-btn--icon mm-btn--danger"
              onClick={() => setInputs((gs) => gs.filter((_, idx) => idx !== i))}
              title="Remove input group"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          className="mm-btn"
          onClick={() => setInputs((gs) => [...gs, blankInput()])}
        >
          Add input group
        </button>
      </section>

      {/* Target function — one formula, one output. The live single-input
          check sits right next to the formula (no separate section). */}
      <section className="instructor-creator-section">
        <div className="mm-section-head">
          <h3>Target function</h3>
        </div>
        <div className="instructor-formula-row">
          <label className="mm-inline-field instructor-formula-field">
            f({inputs.map((g) => g.name.trim() || '?').join(', ')}) =
            <input
              className="mm-input mm-input--formula"
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

      {/* A written question's place in a multi-part problem (task 048). */}
      {isOpen && (
        <section className="instructor-creator-section">
          <div className="mm-section-head">
            <h3>Problem</h3>
          </div>
          {ownParts.length > 0 ? (
            <p className="mm-note">
              The first part of a problem: {ownParts.map((q) => q.label).join(', ')}{' '}
              {ownParts.length === 1 ? 'is a later part' : 'are its later parts'}. Its stem and closing are the problem&#8217;s.
            </p>
          ) : (
            <label className="mm-inline-field">
              Part of
              <select
                className="mm-input"
                value={partOf ?? ''}
                onChange={(e) => setPartOf(e.target.value === '' ? null : Number(e.target.value))}
              >
                <option value="">its own problem</option>
                {partOfChoices.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
              </select>
            </label>
          )}
          {partOf !== null && ownParts.length === 0 ? (
            <p className="mm-note mm-hint">
              A part shows on its problem&#8217;s page, after the problem&#8217;s earlier parts —
              keep it directly after them in the list, in the same section. It is still graded
              on its own (1 point).
            </p>
          ) : (
            <>
              <label className="mm-field">
                <span className="mm-label">Stem (optional) — the problem&#8217;s text before its parts</span>
                <textarea className="mm-input mm-input--area" rows={3} value={stem} onChange={(e) => setStem(e.target.value)} />
              </label>
              <label className="mm-field">
                <span className="mm-label">Closing (optional) — the problem&#8217;s text after its parts</span>
                <textarea className="mm-input mm-input--area" rows={2} value={closing} onChange={(e) => setClosing(e.target.value)} />
              </label>
            </>
          )}
          {!isFillIn && (
            <div className="mm-section-head">
              <h3>Answer field</h3>
              <div className="mm-segmented">
                {(['paragraph', 'line'] as const).map((f) => (
                  <button
                    key={f}
                    className={'mm-segmented-btn' + (answerField === f ? ' mm-segmented-btn--active' : '')}
                    onClick={() => setAnswerField(f)}
                  >
                    {f === 'paragraph' ? 'Paragraph' : 'One line'}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Statement — for an open question this IS the question. */}
      <section className="instructor-creator-section">
        <label className="mm-field">
          <span className="mm-label">
            {isOpen ? (partOf !== null || ownParts.length > 0 ? 'This part, shown to students' : 'Question shown to students') : 'Instructions shown to students'}
          </span>
          <textarea
            className="mm-input mm-input--area"
            rows={isOpen ? 8 : 4}
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
            placeholder={
              isFillIn
                ? 'Write the question the blanks answer (e.g. Represent the numbers zero through ten in binary.)…'
                : isOpen
                  ? 'Write the question the student answers in prose (mention the expected length, e.g. ~1 paragraph)…'
                  : "Describe the function the student's circuit must compute…"
            }
          />
        </label>
        <p className="mm-note mm-hint">
          Math goes in LaTeX between dollar signs ($x + 1$, or $$…$$ on its own
          line); machine literals go in `backticks`; **bold** and *italic* work
          too. A blank line starts a new paragraph.
        </p>
        <label className="mm-field">
          <span className="mm-label">Hint (optional)</span>
          <input
            className="mm-input"
            placeholder="e.g. DeMorgan's Law is useful here!"
            value={hint}
            onChange={(e) => setHint(e.target.value)}
          />
        </label>
        <CalloutsEditor label="Callout boxes for this problem" callouts={callouts} onChange={setCallouts} />
        <FiguresEditor label="Figures for this problem" figures={figures} onChange={setFigures} />
        {statement.trim() && (
          <div className="instructor-statement-preview">
            <div className="mm-label">Preview</div>
            <StatementBody text={statement} />
            {hint.trim() && (
              <div className="question-hint"><StatementBody text={hint} /></div>
            )}
          </div>
        )}
      </section>

      <div className="instructor-creator-foot">
        {saveError && <span className="instructor-formula-error">{saveError}</span>}
        <button className="mm-btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="mm-btn mm-btn--primary"
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
    <div className="mm-segmented">
      {REPS.map((r) => (
        <button
          key={r}
          className={
            'mm-segmented-btn' + (value === r ? ' mm-segmented-btn--active' : '')
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
              className="mm-input mm-input--num"
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
