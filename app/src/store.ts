import { create } from 'zustand';
import type {
  BuildMode,
  RepSystem,
  DisplayMode,
  Scope,
  ActiveTask,
  CircuitComponent,
  Wire,
  ComponentType,
  AssignmentData,
  AssignmentState,
  BoxDefinition,
  ConfirmedBoxDef,
  WireManualSegment,
  FsmHistoryEntry,
  WorkbookData,
  WorksheetData,
  SubmissionRecord,
  QuestionCircuit,
  QuestionProvenance,
  TMTape,
  TMSymbol,
  TMNotation,
  TmHistoryEntry,
  ArenaCell,
  ArenaConfig,
  TurbotState,
  TurbotHistoryEntry,
  TurbotCaseResult,
} from './types';
import {
  getPortsForType,
  getMemOutputPortId,
  getMemInputPortId,
  isMemSinkPort,
  GRID_SIZE,
  toSubscript,
} from './types';
import { topologicalSort, evaluateGate, evaluateCC, evaluateSCSingleStep, sortStateComponents, evaluateFSMSymbolStep, evaluateTMSingleStep, evaluateTMSequence, DEFAULT_TM_MAX_STEPS, notationForRepresentation, encodeTM, stepCountFor, encodeInput, valueToBits, bitsToValue, bitsToTally, bitsToBinary, sortByLabel, fsmNotation, turbotFsmNotation, tmNotation, turbotInternalNotation, turbotExternalNotation, questionLayout, caseStimulus, recordedCaseSeparations, gradedMachineKey, gradingCircuit, type CodecLayout, type TransitionNotation } from './engine';
import { senseAheadSymbol, applyMotorCommand, initialBrainState, runBrainStep, stateKindOf, type BrainState } from './engine/turbot';
import { getAssignment, listAssignments } from './assignments';
import { emptyQuestionCircuit, restoreQuestionCircuits } from './storage/workbookStore';
import { buildSubmission } from './storage/submissionStore';
// Store INSTANCES come from the backend seam (local vs. remote is decided
// there, nowhere else); the modules above supply only pure helpers + types.
import { workbookStore, submissionStore, assignmentStore, backendMode } from './storage/backend';
import { writeJournal, clearJournal, clearJournalIfHolds, reconcileJournal } from './storage/journal';
import { isFrozen } from './dueDates';
import { getSessionUser } from './auth/session';
import { instructorRole } from './auth/instructorRole';
import {
  canvasKind,
  canvasPasteVerdict,
  peekClipboard,
  resetClipboard,
  stampCanvas,
  type CanvasClip,
  type PasteScope,
  type Provenance,
} from './provenance';
// The minting seam and the writing/build trace (task 034).
import { mintId, setMintKey, clearMintKeys, mintKeyFor, type MintScope } from './provenance/ids';
import { nextTrace, insertedChars, type TraceChange, type TextContent } from './provenance/trace';
import { INTEGRITY_NOTICE } from './provenance/notice';

/**
 * TM tape notation (alphabet) for the current context. Inside an assignment
 * the open question's `representation` is authoritative — a binary question
 * gets the {0, 1, *} alphabet, a tally question gets {0, 1} — regardless of
 * the global repSystem display toggle. The sandbox (no assignment open)
 * follows repSystem. Every TM surface (transition editor, tape clicks,
 * machine table, simulation) derives its alphabet from this one selector, so
 * an out-of-alphabet symbol can never be entered in the first place.
 */
export function selectTmNotation(s: {
  assignment: AssignmentData | null;
  currentQuestionIndex: number;
  repSystem: RepSystem;
}): TMNotation {
  const q = s.assignment?.questions[s.currentQuestionIndex];
  return notationForRepresentation(q ? q.representation : s.repSystem);
}

/**
 * Is the open assignment frozen (notes/todos.md item 3)? True once its due
 * date has passed AND the student already has a submission on file — see
 * dueDates.ts's `isFrozen` for the policy and why a never-submitted student
 * is never frozen. `now` defaults to the real clock; tests pass a fixed one.
 */
export function selectAssignmentFrozen(
  s: { assignment: AssignmentData | null; submissions: Record<string, SubmissionRecord> },
  now: number = Date.now(),
): boolean {
  if (!s.assignment) return false;
  return isFrozen(s.assignment.dueDate, now, s.submissions[s.assignment.id] != null);
}

/**
 * Is the open question locked against edits — either the student marked it
 * done, or the whole assignment is frozen past its due date (item 3)? The
 * single read-side answer UI components use; store.ts's mutating actions use
 * the module-private `isCurrentQuestionLocked(state)` on the full AppState.
 */
export function selectQuestionLocked(s: {
  assignment: AssignmentData | null;
  currentQuestionIndex: number;
  questionCircuits: Map<number, QuestionCircuit>;
  submissions: Record<string, SubmissionRecord>;
}): boolean {
  const q = s.assignment?.questions[s.currentQuestionIndex];
  if (!q) return false;
  if (selectAssignmentFrozen(s)) return true;
  return s.questionCircuits.get(q.id)?.done ?? false;
}

/**
 * The open question's component restriction (`allowed_components`), or null
 * when unrestricted — sandbox (no assignment), or the field absent/empty
 * (absent/empty = all allowed; semantics in engine/machineValidation.ts).
 * The palette (ComponentLibrary) filters its entries through this via
 * `isComponentTypeAllowed`, so a disallowed gate can never be placed; the
 * grader's Stage-1 check is the enforcement backstop.
 */
export function selectAllowedComponents(s: {
  assignment: AssignmentData | null;
  currentQuestionIndex: number;
}): ComponentType[] | null {
  const allowed = s.assignment?.questions[s.currentQuestionIndex]?.allowed_components;
  return allowed && allowed.length > 0 ? allowed : null;
}

/**
 * Where a copy is made or a paste lands, for the provenance seam
 * (provenance.ts): the open assignment, else the sandbox. The canvas and the
 * guarded answer fields (usePasteGuard) both read it, so they agree on scope.
 */
export function selectPasteScope(s: { assignment: AssignmentData | null }): PasteScope {
  return s.assignment ? { kind: 'assignment', assignmentId: s.assignment.id } : { kind: 'sandbox' };
}

/**
 * The codec layout of the open SC/FSM question (the grader's view of it —
 * engine/caseRun.ts questionLayout, the very function the grader reads), or
 * null in the sandbox (no open question, or a question without a time-axis
 * cc_spec). Everything question-run-specific — the run window, the exact input
 * stream to feed — derives from this one selector.
 */
export function selectCodecLayout(s: {
  assignment: AssignmentData | null;
  currentQuestionIndex: number;
}): CodecLayout | null {
  const q = s.assignment?.questions[s.currentQuestionIndex];
  if (!q || (q.buildMode !== 'SC' && q.buildMode !== 'FSM')) return null;
  return questionLayout(q);
}

/**
 * The canonical run window (in time steps) for the open SC/FSM question — the
 * grader's `stepCountFor` over the question's cc_spec group widths. Question
 * runs (Run/Step and the A/V decode) must execute/present exactly this window
 * so the student sees exactly what the grader grades. Returns null in the
 * sandbox — sandbox runs keep their own lengths (SC: L + one 0-drain step per
 * MEM; FSM: L).
 */
export function selectCodecWindow(s: {
  assignment: AssignmentData | null;
  currentQuestionIndex: number;
}): number | null {
  const layout = selectCodecLayout(s);
  return layout ? stepCountFor(layout) : null;
}

/** Parse display-order digits as a numeral under `rep` — exactly how the A/V
 *  ARG column reads typed input (tally "11" = 2; binary "110" = 6). Returns
 *  null when the digits are not a valid codeword (tally with a 1 after a 0 —
 *  the same strings the ARG column flags '/'). */
function numeralValue(digits: number[], rep: RepSystem): number | null {
  return rep === 'tally' ? bitsToTally(digits) : bitsToBinary(digits);
}

/**
 * The EXACT input stream the grader would feed for the student's typed input:
 * each input group's typed digits are read as a value and laid on the time
 * axis by the codec's own `encodeInput` (LSB at t1 — so a tally value's ones
 * arrive LAST, zeros leading; values wider than the group are clamped/masked
 * by `valueToBits` exactly as the codec does). Returns null when codec feeding
 * doesn't apply and the caller must fall back to raw typed bits: no open
 * question (sandbox), the machine's input count differs from the question
 * spec, or a typed string that is not a valid numeral for the representation.
 */
function codecInputSteps(
  layout: CodecLayout | null,
  numeralsPerGroup: number[][],
): number[][] | null {
  if (!layout || numeralsPerGroup.length !== layout.inputWidths.length) return null;
  const values: number[] = [];
  for (const numeral of numeralsPerGroup) {
    const v = numeralValue(numeral, layout.rep);
    if (v === null) return null;
    values.push(v);
  }
  const enc = encodeInput(values, layout);
  return enc.axis === 'time' ? enc.steps : null;
}

/**
 * Split the FSM IN field's typed digits into per-GROUP sequences, indexed
 * [group][timeStep] with t1 FIRST — the same chunking loadScGlobalSequence
 * applies to SC input strings: reading right-to-left, each chunk of
 * `numGroups` characters is one time step (rightmost chunk = t1), and within
 * a chunk character i belongs to input group i. For the common 1-group case
 * this is simply the typed digits reversed (rightmost char = t1). A group's
 * display-order numeral (for the codec) is its sequence reversed back.
 */
function fsmGroupSequences(digits: number[], numGroups: number): number[][] {
  const groups = Math.max(1, numGroups);
  const stepsCount = Math.floor(digits.length / groups);
  const seqs: number[][] = Array.from({ length: groups }, () => []);
  for (let t = 0; t < stepsCount; t++) {
    const chunkStart = (stepsCount - 1 - t) * groups; // rightmost chunk = t1
    for (let i = 0; i < groups; i++) {
      seqs[i].push(digits[chunkStart + i] ?? 0);
    }
  }
  return seqs;
}

/**
 * The typed-input digits (SC's global input string, FSM's IN field) that make
 * a question run feed EXACTLY the codec's stream for `values` — the inverse
 * of how scStep/fsmStep read typed input (codecInputSteps): each group's
 * value as one numeral of the widest group's width, chunked right-to-left
 * (rightmost chunk = t1) with group i at position i of every chunk. The value
 * is first clamped/masked to its OWN width exactly as encodeInput does, so
 * reading the numeral back re-encodes to the grader's bits. Numerals are
 * padded by width, never by prepending zeros: a left-padded tally numeral
 * ("011") is not a codeword, and codecInputSteps would silently fall back to
 * the raw typed bits.
 */
function codecTypedDigits(values: number[], layout: CodecLayout): number[] {
  const width = Math.max(1, ...layout.inputWidths);
  const numerals = layout.inputWidths.map((w, i) =>
    valueToBits(bitsToValue(valueToBits(values[i] ?? 0, w, layout.rep), layout.rep), width, layout.rep),
  );
  const digits: number[] = [];
  for (let c = 0; c < width; c++) for (const n of numerals) digits.push(n[c]);
  return digits;
}

/** A blank arena for the sandbox / question-authoring preview (no assignment context). */
export function defaultArenaConfig(): ArenaConfig {
  return {
    width: 5,
    height: 5,
    cells: Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => 'empty' as const)),
    start: { x: 0, y: 0, facing: 'E' },
  };
}

/**
 * The starter arena a sandbox turbot tab is born with: a 10×8 field walled in
 * by blocks, one goal in the far (NE) corner, the turbot starting in the near
 * (SW) corner facing east. Big enough to be worth driving around in, bounded
 * so a runaway brain visibly hits walls rather than marching off-grid.
 * Editable in place via the Map's "Edit map" mode (setTabArena).
 */
export function sandboxDefaultArena(): ArenaConfig {
  const width = 10;
  const height = 8;
  const cells: ArenaCell[][] = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) =>
      x === 0 || y === 0 || x === width - 1 || y === height - 1 ? 'block' : 'empty',
    ),
  );
  cells[1][width - 2] = 'goal'; // NE inner corner
  return { width, height, cells, start: { x: 1, y: height - 2, facing: 'E' } };
}

/** One sandbox worksheet tab. `innerMode`/`arena` are carried only by turbot tabs. */
export interface SandboxTab {
  id: string;
  title: string;
  buildMode: BuildMode;
  activeTask: ActiveTask;
  innerMode?: BuildMode;
  arena?: ArenaConfig;
}

// Stable fallback identity so selectors returning it don't churn subscribers.
const FALLBACK_ARENA: ArenaConfig = defaultArenaConfig();

/** The active sandbox tab, or undefined outside the sandbox (assignment open). */
function activeSandboxTab(s: {
  assignment: AssignmentData | null;
  tabs?: SandboxTab[];
  activeTabId?: string;
}): SandboxTab | undefined {
  if (s.assignment) return undefined;
  return s.tabs?.find((t) => t.id === s.activeTabId);
}

/**
 * The active turbot context's arena. Inside an assignment: one of the open
 * turbot question's `turbot_cases` arenas — `turbotCaseIndex`, which is 0
 * (the primary arena, the one the student sees and simulates against; see
 * engine/turbot.ts) unless a graded case was loaded into the run
 * (loadCaseInput); an index past the bank falls back to the primary. In the
 * sandbox: the active turbot tab's own arena (seeded by addTab, edited via
 * setTabArena). Falls back to a blank arena outside any turbot context.
 */
export function selectTurbotArena(s: {
  assignment: AssignmentData | null;
  currentQuestionIndex: number;
  turbotCaseIndex?: number;
  tabs?: SandboxTab[];
  activeTabId?: string;
}): ArenaConfig {
  const q = s.assignment?.questions[s.currentQuestionIndex];
  return (
    q?.turbot_cases?.[s.turbotCaseIndex ?? 0]?.arena ??
    q?.turbot_cases?.[0]?.arena ??
    activeSandboxTab(s)?.arena ??
    FALLBACK_ARENA
  );
}

/** The step cap on a sandbox TM or turbot Run (a runaway machine in the UI). */
export const UI_RUN_STEP_CAP = 1000;

/**
 * The GRADER's step budget for the open question's TM or turbot run, or null
 * outside one (the sandbox, other modes). Question runs ARE the grader's
 * runs (the SC/FSM codec-window rule, extended): a TM question's Step/Run
 * stop where the grader's TM run stops (DEFAULT_TM_MAX_STEPS), a turbot's at
 * the shown arena's `maxSteps` — so a run the grader cut off is cut off on
 * screen too, and one it let finish is never cut short. Sandbox runs keep
 * UI_RUN_STEP_CAP (Run only; sandbox Step is unbounded).
 */
export function selectQuestionStepBudget(s: {
  buildMode: BuildMode;
  assignment: AssignmentData | null;
  currentQuestionIndex: number;
  turbotCaseIndex?: number;
}): number | null {
  const q = s.assignment?.questions[s.currentQuestionIndex];
  if (!q) return null;
  if (s.buildMode === 'turbot') {
    const cases = q.turbot_cases;
    return cases?.[s.turbotCaseIndex ?? 0]?.maxSteps ?? cases?.[0]?.maxSteps ?? null;
  }
  return q.buildMode === 'TM' ? DEFAULT_TM_MAX_STEPS : null;
}

/**
 * The inner-circuit editor mode (CC/SC/FSM/TM) for the active turbot context —
 * the open turbot question's `innerMode`, or the sandbox turbot tab's.
 */
export function selectTurbotInnerMode(s: {
  assignment: AssignmentData | null;
  currentQuestionIndex: number;
  tabs?: SandboxTab[];
  activeTabId?: string;
}): BuildMode {
  const q = s.assignment?.questions[s.currentQuestionIndex];
  return q?.innerMode ?? activeSandboxTab(s)?.innerMode ?? 'CC';
}

/**
 * The mode the *editing surface* should behave as. For a turbot question the
 * canvas edits the inner brain circuit, so every editor-behavior branch
 * (palette items, transition-label grammar, STATE interactions, wire routing)
 * must key off the question's innerMode, not the literal 'turbot' buildMode.
 * Non-turbot modes pass through unchanged.
 */
export function selectEffectiveMode(s: {
  buildMode: BuildMode;
  assignment: AssignmentData | null;
  currentQuestionIndex: number;
  tabs?: SandboxTab[];
  activeTabId?: string;
}): BuildMode {
  return s.buildMode === 'turbot' ? selectTurbotInnerMode(s) : s.buildMode;
}

/**
 * The currently-live FSM control state (component id) — the ONE source of
 * truth for the canvas's green state highlight, fed by whichever simulation
 * is active. An FSM sim run carries it in fsmCurrentStateId; a turbot arena
 * run carries it inside the brain state (the turbot slice — turbotStep /
 * turbotRun — never writes fsmCurrentStateId, so there is exactly one writer
 * per sim and this selector picks the active one). The arena branch is gated
 * on the run having started (history non-empty) to match the FSM sim's
 * no-highlight-at-rest behavior — turbotReset re-seeds brainState.stateId to
 * S₀, which would otherwise light up before any step. TM canvases have no
 * live-state highlight (deliberate: the Current-state readout and machine
 * table carry it), so TM contexts return null here.
 */
export function selectLiveFsmStateId(s: {
  buildMode: BuildMode;
  assignment: AssignmentData | null;
  currentQuestionIndex: number;
  tabs?: SandboxTab[];
  activeTabId?: string;
  fsmCurrentStateId: string | null;
  turbotBrainState: BrainState;
  turbotHistory: TurbotHistoryEntry[];
}): string | null {
  if (s.buildMode === 'turbot') {
    if (selectTurbotInnerMode(s) !== 'FSM') return null;
    return s.turbotHistory.length > 0 ? s.turbotBrainState.stateId ?? null : null;
  }
  return s.fsmCurrentStateId;
}

/**
 * The FSM transition notation (engine/notation.ts) for the current editing
 * surface. Turbot-FSM brains use the fixed sensor/motor notation (1-bit
 * input, 2-bit motor output with the legacy 1-bit alias). An open FSM
 * question derives symbol widths from its cc_spec group counts — symbol char
 * i = input group i, exactly the alphabet the grader validates and feeds.
 * The sandbox is the classic 1-bit machine. Notation instances are memoized
 * in the engine, so this is selector-safe (stable identity).
 */
export function selectFsmNotation(s: {
  buildMode: BuildMode;
  assignment: AssignmentData | null;
  currentQuestionIndex: number;
  tabs?: SandboxTab[];
  activeTabId?: string;
}): TransitionNotation {
  if (selectEffectiveMode(s) !== 'FSM') return fsmNotation(1, 1);
  if (s.buildMode === 'turbot') return turbotFsmNotation;
  const q = s.assignment?.questions[s.currentQuestionIndex];
  if (q?.buildMode === 'FSM' && q.cc_spec) {
    return fsmNotation(q.cc_spec.inputs.length, q.cc_spec.outputs.length);
  }
  return fsmNotation(1, 1);
}

/**
 * The transition notation governing labels on wires leaving `source` — the
 * ONE authority the label editor, setTransitionLabel, and addWire defaults
 * all read (grammar per editing surface; per-state kind for turbot TMs).
 */
export function selectTransitionNotationForSource(
  s: {
    buildMode: BuildMode;
    assignment: AssignmentData | null;
    currentQuestionIndex: number;
    repSystem: RepSystem;
    tabs?: SandboxTab[];
    activeTabId?: string;
  },
  source: CircuitComponent | undefined,
): TransitionNotation {
  const eff = selectEffectiveMode(s);
  if (eff === 'TM') {
    if (s.buildMode === 'turbot') {
      // Internal states read/write the question's tape alphabet (binary
      // {0,1,*}, unary {0,1}) — same encoding rule as the base TM.
      return source && stateKindOf(source) === 'external'
        ? turbotExternalNotation
        : turbotInternalNotation(selectTmNotation(s));
    }
    return tmNotation(selectTmNotation(s));
  }
  return selectFsmNotation(s);
}

/**
 * A graded case loaded into the open question's run ("Run this input" on the
 * grade sheet, loadCaseInput): which case of which attempt, its INPUT, the
 * verdict recorded for it, and `gradedKey` — engine gradedMachineKey of the
 * machine THAT attempt submitted for the question (null when it submitted
 * none), so the banner can tell whether the canvas still holds the graded
 * machine even after a later attempt replaces the latest record. Never the
 * answer key — no expected/got, even in local mode where the full result is
 * at hand; the live output comes from running the canvas machine
 * (engine/caseRun.ts).
 */
export type LoadedCase =
  | {
      kind: 'value';
      questionId: number;
      caseIndex: number;
      attempt: number;
      gradedKey: string | null;
      input: number[];
      separations?: number[];
      recorded: { pass: boolean; reason?: string };
    }
  | {
      kind: 'turbot';
      questionId: number;
      caseIndex: number;
      attempt: number;
      gradedKey: string | null;
      // A turbot case's result has no answer key (positional pass/fail).
      recorded: TurbotCaseResult;
    };

interface HistoryEntry {
  components: CircuitComponent[];
  wires: Wire[];
  boxes: BoxDefinition[];
  confirmedBoxes: ConfirmedBoxDef[];
}


interface AppState {
  // Auto-save status
  // 'error' is remote-only: a seam save failed (server unreachable); the
  // crash buffer holds the state and a backoff retry is scheduled.
  autoSaveStatus: 'saved' | 'unsaved' | 'saving' | 'error';

  // Workbook
  workbookOpen: boolean;
  workbookTitle: string;
  workbookFileHandle: FileSystemFileHandle | null;
  closeWorkbook: () => void;
  newWorkbook: () => void;
  openWorkbook: (json: string, handle?: FileSystemFileHandle | null) => void;
  exportWorkbook: () => string;
  importWorkbook: (json: string, handle?: FileSystemFileHandle | null) => void;

  // Build mode
  buildMode: BuildMode;
  setBuildMode: (mode: BuildMode) => void;

  // Turbo toggle
  turboEnabled: boolean;
  setTurboEnabled: (v: boolean) => void;

  // Active task
  activeTask: ActiveTask;
  setActiveTask: (t: ActiveTask) => void;

  // Table settings
  repSystem: RepSystem;
  displayMode: DisplayMode;
  scope: Scope;
  setRepSystem: (r: RepSystem) => void;
  setDisplayMode: (d: DisplayMode) => void;
  setScope: (s: Scope) => void;

  // Circuit data
  components: CircuitComponent[];
  wires: Wire[];

  // Counters for labeling
  nextInputNum: number;
  nextOutputNum: number;
  nextMemNum: number;

  // Component operations
  addComponent: (type: ComponentType, x: number, y: number) => void;
  moveComponent: (id: string, x: number, y: number) => void;
  moveComponentRaw: (id: string, x: number, y: number) => void;
  snapComponentToGrid: (id: string) => void;
  removeComponent: (id: string) => void;
  setInputValue: (id: string, value: number | undefined) => void;
  setMemStoredValue: (id: string, value: number) => void;

  // Wire operations
  addWire: (
    sourceCompId: string,
    sourcePortId: string,
    targetCompId: string,
    targetPortId: string
  ) => void;
  removeWire: (id: string) => void;
  updateWireManualSegments: (wireId: string, segments: WireManualSegment[]) => void;

  // Selection
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
  toggleSelected: (id: string) => void;
  clearSelection: () => void;

  // Canvas
  zoom: number;
  panX: number;
  panY: number;
  showGrid: boolean;
  showWireValues: boolean;
  snapToAlign: boolean;
  setZoom: (z: number) => void;
  setPan: (x: number, y: number) => void;
  setShowGrid: (v: boolean) => void;
  setShowWireValues: (v: boolean) => void;
  setSnapToAlign: (v: boolean) => void;

  // Evaluation
  evaluateCircuit: () => void;
  wireValues: Map<string, number>;

  // Undo/Redo
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  // Every canvas edit's history step — and so the choke point where the
  // writing/build trace counts it (recordEdit). `added`: components this edit
  // adds (addComponent / placeBoxInstance 1, paste n).
  pushHistory: (added?: number) => void;
  undo: () => void;
  redo: () => void;

  // Assignment mode — one graded, multi-question assignment open at a time.
  assignment: AssignmentData | null;
  // What the open assignment shows: its question list ('overview') or one
  // question's dedicated canvas ('question'). Driven by the route (see
  // routing.applyRoute): #/a/:id → overview, #/a/:id/q/:i → question.
  assignmentView: 'overview' | 'question';
  currentQuestionIndex: number;
  // Per-question circuit + annotations, keyed by AssignmentQuestion.id.
  questionCircuits: Map<number, QuestionCircuit>;
  // The live free-text answer for the current OPEN question (the text-panel
  // analogue of components/wires for machine questions). Synced into
  // questionCircuits.responseText at the same points the canvas is.
  openResponse: string;
  setOpenResponse: (text: string) => void;
  // The live typed blanks for the current FILL-IN question, in the spec's
  // order. Synced into questionCircuits.fillAnswers alongside openResponse.
  fillAnswers: string[];
  setFillAnswer: (index: number, value: string) => void;
  // The live signed editing record of the current question (task 034,
  // provenance/trace.ts): advanced by recordEdit at every edit, synced into
  // questionCircuits.provenance at the same points as the canvas (one fold,
  // foldLiveQuestion). null before the question's first edit.
  questionTrace: QuestionProvenance | null;
  loadAssignment: (assignment: AssignmentData) => void;
  // Open an assignment by id and show its workbook. Resolves false if the id is
  // unknown. A stale open (one superseded by a newer navigation while its seam
  // reads were in flight) resolves true and applies nothing — the newer open
  // owns the outcome.
  openAssignment: (id: string) => Promise<boolean>;
  switchQuestion: (index: number) => void;
  // Toggle the current question's self-imposed "done" lock (notes/todos.md
  // item 8). No-op outside an assignment.
  toggleCurrentQuestionDone: () => void;
  closeAssignment: () => void;
  // Navigation between the catalog (Home) and the editor.
  goHome: () => void;          // hide the editor, return to the catalog (preserves in-memory work)
  enterSandbox: () => void;    // open the freeform sandbox workbook (clears any active assignment)

  // Legacy single-circuit export for "Export Worksheet". (Its importProject
  // twin wrote a whole canvas with no lock or provenance check and had no
  // caller — removed with task 033; imports go through importWorkbook, which
  // only ever writes sandbox tabs.)
  exportProject: () => string;
  // Submission export (null when no assignment is loaded)
  exportSubmission: (student?: string) => string | null;
  // Latest recorded submission per assignment id (reactive; for status badges).
  // Starts empty; hydrated from the submission seam via hydrateSubmissions().
  submissions: Record<string, SubmissionRecord>;
  // Refresh `submissions` from the seam. Called on auth-ready (App mount) —
  // the async replacement for the old sync-at-module-init hydration.
  hydrateSubmissions: () => Promise<void>;
  // Record an immutable snapshot for an assignment. Works whether the assignment
  // is open (live state) or not (persisted state). Resolves null if id is unknown.
  submitAssignment: (id: string, student?: string) => Promise<SubmissionRecord | null>;
  // exportWorkbook and importWorkbook are in the Workbook section above

  // Rotation
  rotateComponent: (id: string) => void;

  // Box definitions (draw-on-canvas boxing)
  boxes: BoxDefinition[];
  addBox: (box: BoxDefinition) => void;
  updateBox: (id: string, updates: Partial<BoxDefinition>) => void;
  removeBox: (id: string) => void;
  confirmBox: (id: string) => string | null; // returns error or null
  removeConfirmedBox: (id: string) => void;
  // Rename a box everywhere it appears — the library entry, the drawn box on
  // the canvas, and the label of every placed instance (in this assignment,
  // across every question). Returns an error string, or null on success.
  renameBox: (id: string, name: string) => string | null;
  placeBoxInstance: (boxId: string, x: number, y: number) => void; // place a copy of a box as a BOXED component

  // The confirmed-box library behind the palette's "Boxes" section. Its SCOPE
  // depends on where you are:
  //   - in an assignment: the whole ASSIGNMENT (notes item 8). A box built for
  //     one question is available in every question of that homework which can
  //     place its kind (`placeableBoxKinds`), so it does not swap on question
  //     navigation; it persists as `AssignmentState.boxLibrary`.
  //   - in the sandbox: per TAB. It swaps with `boxes` on tab navigation and
  //     persists as `WorksheetData.confirmedBoxes`, so scratch sheets stay
  //     independent of each other and of any assignment.
  confirmedBoxLibrary: ConfirmedBoxDef[];

  // Clear workspace
  clearWorkspace: () => void;

  // Delete selected
  deleteSelected: () => void;

  // Copy/paste. The clipboard is NOT store state: it lives in the provenance
  // seam (provenance.ts), stamped with where and by whom it was copied, so a
  // question or canvas swap keeps it and only a principal change clears it.
  // copySelected stamps the selection (an empty selection is a no-op). paste
  // returns the refusal message when the seam's policy, the canvas kind or
  // the question's allowed_components says no — or null (pasted, or the
  // question is locked).
  copySelected: () => void;
  paste: () => string | null;

  // Tabs (worksheets)
  tabs: SandboxTab[];
  activeTabId: string;
  addTab: (title: string, buildMode: BuildMode, activeTask?: ActiveTask, innerMode?: BuildMode) => void;
  switchTab: (id: string) => void;
  removeTab: (id: string) => void;
  renameTab: (id: string, title: string) => void;
  /** Sandbox turbot tabs only: replace the active tab's arena (Map editing). */
  setTabArena: (arena: ArenaConfig) => void;
  tabCircuits: Map<string, { components: CircuitComponent[]; wires: Wire[]; boxes: BoxDefinition[]; confirmedBoxes: ConfirmedBoxDef[] }>;

  // Batch move (for efficient multi-component drag)
  moveComponentsBatch: (moves: Map<string, { x: number; y: number }>) => void;
  snapComponentsToGrid: (ids: string[]) => void;

  // Table rows (step-by-step execution model for CC)
  tableRows: { inputBits: number[]; memBits?: number[]; outputBits: number[] }[];
  addTableRow: () => void;
  clearTableRows: () => void;

  // Local I/O stepping (per-component propagation)
  localStepIndex: number;
  localStepSorted: string[];
  localStepPortValues: Record<string, number | undefined>;
  localStepActive: boolean;
  localStepSelectedKey: string | null;
  localStepSelect: (inBits: number[], memBits?: number[]) => void;
  localStepOne: () => boolean;
  localStepReset: () => void;
  localStepClear: () => void;

  // Sequential circuit state
  scTimeStep: number; // current time step (starts at 1)
  scHistory: { t: number; inputBits: number[]; outputBits: number[]; memValues: number[] }[];
  scInputSequence: number[][]; // per-input arrays of bits across time steps
  scRunning: boolean;
  scRunIntervalId: number | null;
  scStep: () => void; // advance one clock cycle
  scRun: () => void; // start continuous execution
  scPause: () => void; // pause continuous execution
  scReset: () => void; // reset to t=1, preserve circuit structure and input sequence
  scGlobalReset: () => void; // reset to t=1, clear all inputs and memory
  setScInputBit: (inputIndex: number, timeStep: number, value: number) => void;

  // Global I/O sequences (each entry = one run with input string and output string)
  scGlobalSequences: { inputStr: string; outputStr: string }[];
  setScGlobalSequenceInput: (index: number, value: string) => void;
  loadScGlobalSequence: (index: number) => void;
  recordScGlobalSequenceOutput: () => void;

  // Selected tool (click-to-place mode)
  selectedTool: ComponentType | 'NEW_BOX' | null;
  setSelectedTool: (t: ComponentType | 'NEW_BOX' | null) => void;

  // Box drawing mode state
  boxDrawing: {
    phase: 'idle' | 'drawing' | 'adjusting';
    draftBox: BoxDefinition | null;
  };
  setBoxDrawingPhase: (phase: 'idle' | 'drawing' | 'adjusting') => void;
  setDraftBox: (box: BoxDefinition | null) => void;

  // FSM state
  nextStateNum: number;
  fsmCurrentStateId: string | null; // component ID of active state
  fsmInputSequence: number[]; // flat array of input bits
  fsmTimeStep: number; // starts at 1
  fsmHistory: import('./types').FsmHistoryEntry[];
  fsmRunning: boolean;
  fsmRunIntervalId: number | null;
  fsmHalted: boolean;
  setTransitionLabel: (wireId: string, label: string) => void;
  setFsmControlPt: (wireId: string, pt: { x: number; y: number } | undefined) => void;
  fsmStep: () => void;
  fsmRun: () => void;
  fsmPause: () => void;
  fsmReset: () => void;
  fsmGlobalReset: () => void;
  setFsmInputBit: (index: number, value: number) => void;
  setFsmInputSequence: (seq: number[]) => void;

  // TM state — the FSM editor plus a tape. The tape is edited by clicking
  // cells while idle (t=1); Reset returns to the edited initial tape.
  tmTape: TMTape;
  tmInitialTape: TMTape;
  tmCurrentStateId: string | null; // component ID of active state
  tmTimeStep: number; // starts at 1
  tmHistory: TmHistoryEntry[];
  tmRunning: boolean;
  tmRunIntervalId: number | null;
  tmHalted: boolean;
  setTmCell: (index: number) => void; // cycle the symbol at a cell (idle only)
  setTmHead: (index: number) => void; // move the head (idle only)
  tmStep: () => void;
  tmRun: () => void;
  tmPause: () => void;
  tmReset: () => void; // back to the initial tape, t=1
  tmGlobalReset: () => void; // blank the tape entirely

  // Turbot state — the arena pose plus whatever the inner brain (CC/SC/FSM/TM)
  // is carrying between cycles. A turbot's "circuit" is the brain, edited via
  // the normal per-mode canvas (see engine/turbot.ts); this slice only drives
  // the arena driver loop (runBrainStep/applyMotorCommand) one cycle at a
  // time, mirroring the tm* slice's step/run/reset shape.
  turbotState: TurbotState;
  turbotBrainState: BrainState;
  turbotHistory: TurbotHistoryEntry[];
  turbotRunning: boolean;
  turbotRunIntervalId: number | null;
  turbotHalted: boolean;
  turbotStopReason: 'motor' | 'brain' | 'limit' | null;
  turbotStep: () => void;
  turbotRun: () => void;
  turbotPause: () => void;
  turbotReset: () => void; // back to the arena's start pose, brain re-initialized
  // Turbot TM: flip a STATE between internal (circle, tape ops) and external
  // (square, sense/move ops). Outgoing transition labels are reset to the new
  // kind's default since the grammars are disjoint.
  toggleStateKind: (id: string) => void;
  // Which of the open turbot question's arenas (a `turbot_cases` index) the
  // Map shows and the turbot slice runs — 0 unless a graded case put another
  // there (loadCaseInput). Canvas-scoped: resetAllSimState zeroes it.
  turbotCaseIndex: number;

  // Graded-case replay ("Run this input" on the grade sheet): the recorded
  // case the run slices hold, or null. Canvas-scoped: resetAllSimState
  // clears it.
  loadedCase: LoadedCase | null;
  // Load case `caseIndex` of the open question's latest recorded result into
  // the run and run it to the grader's end: CC sets the INPUT toggles, SC/FSM
  // the typed input, TM the tape, a turbot the arena — each exactly the
  // grader's stimulus (engine/caseRun.ts). Every run slice restarts (Reset
  // then replays from t=1); the undo history stays — this is the same canvas,
  // and loading an input is not an edit. NOT gated by the question locks:
  // simulation is never locked. Resolves once the run has reached its end (or
  // was superseded); a no-op unless `questionId` is the open question and a
  // recorded result has that case.
  loadCaseInput: (questionId: number, caseIndex: number) => Promise<void>;
  // Drop the loaded case (the banner's ✕); the Map returns to the primary
  // arena if the case had put another there.
  clearLoadedCase: () => void;

  // Reset law 1 — the CANVAS swap. Flush EVERY mode's transient sim state
  // (SC/FSM/TM/turbot + the I/O table) AND the undo/redo history. Every canvas
  // swap must call this — question navigation and sandbox tab/workbook entry
  // alike — because the sim slices and the history stacks are shared
  // app-wide, not per-canvas: a run left in them shows up against the next
  // canvas's circuit, and an undo would write the previous canvas's snapshot
  // over this one.
  resetAllSimState: () => void;
  // Reset law 2 — the PRINCIPAL change (sign-in, sign-out, a 401, a restored
  // session; null = the visitor). Called by the auth provider in both modes,
  // synchronously, before React sees the new user. Saves what the leaving
  // principal had pending under ITS keys, then resets the WHOLE editor store
  // to its initial state (assignment, question circuits, box library,
  // history, submissions, every sim slice), empties the provenance seam's
  // clipboard (resetClipboard) and loads the arriving
  // principal's own sandbox — so the next openAssignment reads the seam, never
  // the previous person's memory. A repeat call for the same principal is a
  // no-op.
  resetForPrincipal: (email: string | null) => void;
}

function snapToGrid(val: number): number {
  return Math.round(val / GRID_SIZE) * GRID_SIZE;
}

// ─── Box naming ─────────────────────────────────────────────────────
// Default names must be unique across everything the student can see at once.
// The confirmed-box library is ASSIGNMENT-wide (notes item 8), so counting the
// boxes drawn on the live canvas alone hands out "Box 1" again for every
// question; the library names go into the pool too.
function takenBoxNames(
  library: ConfirmedBoxDef[],
  boxes: BoxDefinition[],
  exceptId?: string
): Set<string> {
  const taken = new Set<string>();
  for (const b of library) if (b.id !== exceptId) taken.add(b.name);
  for (const b of boxes) if (b.id !== exceptId && b.name) taken.add(b.name);
  return taken;
}

function nextBoxName(prefix: string, taken: Set<string>): string {
  let n = 1;
  while (taken.has(`${prefix} ${n}`)) n++;
  return `${prefix} ${n}`;
}

// ─── MEM direction auto-resolution ──────────────────────────────────
// Infer memDirection from wiring context. Cascades through MEM chains.
function resolveMemDirections(
  components: CircuitComponent[],
  wires: Wire[]
): CircuitComponent[] {
  const compMap = new Map(components.map((c) => [c.id, c]));
  // Track resolved directions (only for MEMs that were undecided)
  const resolved = new Map<string, 'left-to-right' | 'right-to-left'>();

  // Helper: is this port on a component a known signal source?
  function isKnownSource(comp: CircuitComponent, portId: string): boolean {
    if (comp.type !== 'MEM') {
      // Non-MEM: right-side ports are always sources
      const port = comp.ports.find((p) => p.id === portId);
      return port?.side === 'right';
    }
    // MEM with resolved or explicit direction
    const dir = comp.memDirection ?? resolved.get(comp.id);
    if (!dir) return false;
    const outputPortId = dir === 'left-to-right' ? 'min' : 'mout';
    return portId === outputPortId;
  }

  // Helper: is this port on a component a known signal sink?
  function isKnownSink(comp: CircuitComponent, portId: string): boolean {
    if (comp.type !== 'MEM') {
      const port = comp.ports.find((p) => p.id === portId);
      return port?.side === 'left';
    }
    const dir = comp.memDirection ?? resolved.get(comp.id);
    if (!dir) return false;
    const inputPortId = dir === 'left-to-right' ? 'mout' : 'min';
    return portId === inputPortId;
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const comp of components) {
      if (comp.type !== 'MEM') continue;
      if (comp.memDirection || resolved.has(comp.id)) continue;

      let inferred: 'left-to-right' | 'right-to-left' | null = null;

      for (const wire of wires) {
        if (inferred) break;

        // Wire targets this MEM's left port (mout) from a known source → left is input
        if (wire.targetComponentId === comp.id && wire.targetPortId === 'mout') {
          const source = compMap.get(wire.sourceComponentId);
          if (source && isKnownSource(source, wire.sourcePortId)) {
            inferred = 'left-to-right';
          }
        }
        // Wire targets this MEM's right port (min) from a known source → right is input
        if (wire.targetComponentId === comp.id && wire.targetPortId === 'min') {
          const source = compMap.get(wire.sourceComponentId);
          if (source && isKnownSource(source, wire.sourcePortId)) {
            inferred = 'right-to-left';
          }
        }
        // Wire from this MEM's left port (mout) to a known sink → left is output
        if (wire.sourceComponentId === comp.id && wire.sourcePortId === 'mout') {
          const target = compMap.get(wire.targetComponentId);
          if (target && isKnownSink(target, wire.targetPortId)) {
            inferred = 'right-to-left';
          }
        }
        // Wire from this MEM's right port (min) to a known sink → right is output
        if (wire.sourceComponentId === comp.id && wire.sourcePortId === 'min') {
          const target = compMap.get(wire.targetComponentId);
          if (target && isKnownSink(target, wire.targetPortId)) {
            inferred = 'left-to-right';
          }
        }
      }

      if (inferred) {
        resolved.set(comp.id, inferred);
        changed = true; // may cascade to adjacent MEMs
      }
    }
  }

  if (resolved.size === 0) return components;
  return components.map((c) =>
    resolved.has(c.id) ? { ...c, memDirection: resolved.get(c.id) } : c
  );
}

const defaultTabId = 'tab-1';

// When the circuit's structure changes, the table is wiped but input values are
// kept. This flag suppresses evaluateCircuit's auto-add so the re-evaluation
// that an edit triggers doesn't immediately re-populate the current row. It
// stays set until the user next acts on an input (setInputValue / row select),
// which is the signal that they want this combo evaluated again.
let suppressAutoAddRow = false;

// Monotonic token for openAssignment: each open bumps it, and an open whose
// seam reads resolve after a newer open started applies nothing — a stale
// resolve must never clobber a newer navigation.
let openAssignmentSeq = 0;

// Who the editor store currently belongs to (reset law 2, resetForPrincipal):
// the signed-in email, or null for the visitor. It keys the sandbox autosave.
// `principalReported` is false until the auth provider first reports, so the
// boot report (visitor included) always loads that principal's sandbox.
// `principalEpoch` bumps on every change: an async resolve that started under
// an earlier principal (hydrateSubmissions, submitAssignment, an autosave in
// flight) applies nothing to the next person's store.
let currentPrincipal: string | null = null;
let principalReported = false;
let principalEpoch = 0;

/** The provenance of a canvas copy made / paste landing in `state` now. */
function pasteProvenance(state: { assignment: AssignmentData | null }): Provenance {
  return { scope: selectPasteScope(state), user: currentPrincipal };
}

/** A copy of `clip` with every component and wire id freshly minted in
 *  `scope`, recursing into BOXED internals (their wires re-pointed with them).
 *  A box's boxedCircuitId is a library reference and stays; cc.ts evaluates
 *  internals self-contained, by label order, so fresh internal ids are safe. */
function remint(clip: CanvasClip, scope: MintScope): CanvasClip {
  const idMap = new Map<string, string>();
  const components = clip.components.map((c) => {
    const id = mintId(scope);
    idMap.set(c.id, id);
    return c.internalCircuit ? { ...c, id, internalCircuit: remint(c.internalCircuit, scope) } : { ...c, id };
  });
  const wires = clip.wires.map((w) => ({
    ...w,
    id: mintId(scope),
    sourceComponentId: idMap.get(w.sourceComponentId) ?? w.sourceComponentId,
    targetComponentId: idMap.get(w.targetComponentId) ?? w.targetComponentId,
  }));
  return { components, wires };
}

// ─── The writing/build trace (task 034, provenance/trace.ts) ────────
// When this window's previous edit happened (active-time gaps). Module
// memory; a principal change resets it.
let lastEditAt = 0;

// The values each answer field held recently in this window, per field
// (`<assignment>:<question>:r` for the prose answer, `…:f<i>` for a blank).
// A change BACK to one of them — the browser's own undo or redo in a text box
// — restores what the record already counted when it first arrived, so it
// inserts nothing new; everything else counts what it inserts. Module memory;
// a principal change resets it.
const RECENT_TEXTS_PER_FIELD = 50;
const recentTexts = new Map<string, string[]>();

/** Characters one text change inserts, for the record: 0 when it restores a
 *  value this field held recently (an undo/redo), else insertedChars. */
function textInsertion(field: string, before: string, after: string): number {
  let seen = recentTexts.get(field);
  if (!seen) recentTexts.set(field, (seen = []));
  const restores = seen.includes(after);
  if (seen[seen.length - 1] !== before) seen.push(before);
  if (seen.length > RECENT_TEXTS_PER_FIELD) seen.shift();
  return restores ? 0 : insertedChars(before, after);
}

/** The recent-values key of an answer field of the live question. */
function textFieldKey(state: AppState, field: string): string {
  const q = state.assignment?.questions[state.currentQuestionIndex];
  return `${state.assignment?.id ?? ''}:${q?.id ?? ''}:${field}`;
}

/**
 * The trace update for one edit of the live question, merged into that
 * edit's own set(). Called by every edit AFTER its isCurrentQuestionLocked
 * return — through pushHistory (every canvas edit), undo/redo and the two
 * text setters — and a no-op on a locked question anyway (belt and braces)
 * and in the sandbox, which keeps no trace. `textAfter`: the answer text the
 * edit leaves (text setters); canvas edits leave it as it was.
 */
function recordEdit(
  state: AppState,
  change: TraceChange,
  textAfter?: TextContent,
): Partial<Pick<AppState, 'questionTrace'>> {
  const a = state.assignment;
  const q = a?.questions[state.currentQuestionIndex];
  if (!a || !q || isCurrentQuestionLocked(state)) return {};
  const now = Date.now();
  const gapMs = lastEditAt > 0 ? now - lastEditAt : 0;
  lastEditAt = now;
  const textBefore: TextContent = { responseText: state.openResponse, fillAnswers: state.fillAnswers };
  return {
    questionTrace: nextTrace(
      state.questionTrace,
      change,
      {
        questionId: q.id,
        textBefore,
        textAfter: textAfter ?? textBefore,
        countBefore: state.components.length,
        gapMs,
      },
      mintKeyFor(a.id),
    ),
  };
}

/** The live question folded into its saved container — THE one fold, shared
 *  by every canvas swap and save (goHome, switchQuestion, the done toggle,
 *  syncedQuestionCircuits), so no live field (the done lock, the editing
 *  record) can be dropped on the way. */
function foldLiveQuestion(
  s: AppState,
  questionId: number,
  overrides: Partial<QuestionCircuit> = {},
): QuestionCircuit {
  return {
    components: s.components,
    wires: s.wires,
    boxes: s.boxes,
    responseText: s.openResponse,
    fillAnswers: s.fillAnswers,
    done: s.questionCircuits.get(questionId)?.done,
    ...(s.questionTrace ? { provenance: s.questionTrace } : {}),
    ...overrides,
  };
}

/** A saved question's live fields — THE one load, foldLiveQuestion's inverse
 *  (openAssignment, switchQuestion, the frozen view). */
function loadQuestionFields(saved: QuestionCircuit) {
  return {
    components: saved.components,
    wires: saved.wires,
    boxes: saved.boxes,
    openResponse: saved.responseText ?? '',
    fillAnswers: saved.fillAnswers ?? [],
    questionTrace: saved.provenance ?? null,
  };
}

export const useStore = create<AppState>()((set, get) => ({
  autoSaveStatus: 'saved' as const,

  // Workbook state
  workbookOpen: false,
  workbookTitle: 'Untitled Workbook',
  workbookFileHandle: null,
  submissions: {},

  hydrateSubmissions: async () => {
    const epoch = principalEpoch;
    const assignments = await listAssignments();
    const latests = await Promise.all(
      assignments.map((a) => submissionStore.getLatest(a.id)),
    );
    // The principal changed while this was in flight: these are the previous
    // person's submissions.
    if (epoch !== principalEpoch) return;
    const out: Record<string, SubmissionRecord> = {};
    assignments.forEach((a, i) => {
      const latest = latests[i];
      if (latest) out[a.id] = latest;
    });
    set({ submissions: out });
  },

  closeWorkbook: () => {
    set({
      workbookOpen: false,
      workbookTitle: 'Untitled Workbook',
      workbookFileHandle: null,
      tabs: [{ id: defaultTabId, title: 'Circuit 1', buildMode: 'CC' as BuildMode, activeTask: 'arithmetic' as ActiveTask }],
      activeTabId: defaultTabId,
      tabCircuits: new Map(),
      components: [],
      wires: [],
      boxes: [],
      confirmedBoxLibrary: [],
      buildMode: 'CC',
      activeTask: 'arithmetic',
      undoStack: [],
      redoStack: [],
    });
    // Clear THIS principal's sandbox autosave (never another person's).
    try { localStorage.removeItem(sandboxKey(currentPrincipal)); } catch { /* ignore */ }
  },

  newWorkbook: () => {
    const tabId = mintId({ kind: 'sandbox' });
    set({
      assignment: null,
      workbookOpen: true,
      workbookTitle: 'Untitled Workbook',
      workbookFileHandle: null,
      tabs: [{ id: tabId, title: 'Circuit 1', buildMode: 'CC' as BuildMode, activeTask: 'arithmetic' as ActiveTask }],
      activeTabId: tabId,
      tabCircuits: new Map(),
      components: [],
      wires: [],
      boxes: [],
      confirmedBoxLibrary: [],
      buildMode: 'CC',
      activeTask: 'arithmetic',
      undoStack: [],
      redoStack: [],
    });
    get().resetAllSimState();
  },

  openWorkbook: (json, handle) => {
    get().importWorkbook(json, handle);
  },

  exportWorkbook: () => {
    const state = get();
    // Save current tab's circuit into tabCircuits for serialization
    const allTabCircuits = new Map(state.tabCircuits);
    allTabCircuits.set(state.activeTabId, {
      components: state.components,
      wires: state.wires,
      boxes: state.boxes,
      confirmedBoxes: state.confirmedBoxLibrary,
    });

    const worksheets: WorksheetData[] = state.tabs.map((tab) => {
      const circuit = allTabCircuits.get(tab.id) || { components: [], wires: [], boxes: [], confirmedBoxes: [] };
      return {
        id: tab.id,
        title: tab.title,
        buildMode: tab.buildMode,
        activeTask: tab.activeTask,
        circuit: { components: circuit.components, wires: circuit.wires },
        boxes: circuit.boxes,
        confirmedBoxes: circuit.confirmedBoxes,
        // Turbot tabs: the brain kind + sandbox arena travel with the sheet.
        ...(tab.innerMode ? { innerMode: tab.innerMode } : {}),
        ...(tab.arena ? { arena: tab.arena } : {}),
      };
    });

    const workbook: WorkbookData = {
      formatVersion: 2,
      // Read by whoever opens the file — a person or an AI tool (task 034).
      notice: INTEGRITY_NOTICE,
      metadata: {
        title: state.workbookTitle,
        author: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      worksheets,
      activeWorksheetId: state.activeTabId,
      viewPreferences: {
        zoom: state.zoom,
        panX: state.panX,
        panY: state.panY,
        showGrid: state.showGrid,
        showWireValues: state.showWireValues,
        snapToAlign: state.snapToAlign,
        repSystem: state.repSystem,
      },
    };
    return JSON.stringify(workbook, null, 2);
  },

  importWorkbook: (json, handle) => {
    try {
      const data = JSON.parse(json);

      if (data.formatVersion === 2) {
        // New workbook format
        const wb = data as WorkbookData;
        const tabCircuits = new Map<string, TabCircuitData>();
        const tabs = wb.worksheets.map((ws) => {
          const resolvedComponents = resolveMemDirections(ws.circuit.components || [], ws.circuit.wires || []);
          tabCircuits.set(ws.id, {
            components: resolvedComponents,
            wires: ws.circuit.wires || [],
            boxes: ws.boxes || [],
            confirmedBoxes: ws.confirmedBoxes || [],
          });
          return {
            id: ws.id,
            title: ws.title,
            buildMode: ws.buildMode || 'CC' as BuildMode,
            activeTask: ws.activeTask || 'arithmetic' as ActiveTask,
            // Turbot worksheets: restore brain kind + arena (seed defaults for
            // files predating / hand-authored without them).
            ...(ws.buildMode === 'turbot'
              ? { innerMode: ws.innerMode ?? 'CC' as BuildMode, arena: ws.arena ?? sandboxDefaultArena() }
              : {}),
          };
        });

        const activeId = wb.activeWorksheetId || tabs[0]?.id || defaultTabId;
        const activeCircuit = tabCircuits.get(activeId) || { components: [], wires: [], boxes: [], confirmedBoxes: [] };
        const activeTab = tabs.find((t) => t.id === activeId);

        set({
          assignment: null,
          workbookOpen: true,
          workbookTitle: wb.metadata?.title || 'Untitled Workbook',
          workbookFileHandle: handle || null,
          tabs,
          activeTabId: activeId,
          tabCircuits,
          components: activeCircuit.components,
          wires: activeCircuit.wires,
          boxes: activeCircuit.boxes,
          confirmedBoxLibrary: activeCircuit.confirmedBoxes,
          buildMode: activeTab?.buildMode || 'CC',
          activeTask: activeTab?.activeTask || 'arithmetic',
          zoom: wb.viewPreferences?.zoom ?? 1,
          panX: wb.viewPreferences?.panX ?? 0,
          panY: wb.viewPreferences?.panY ?? 0,
          showGrid: wb.viewPreferences?.showGrid ?? true,
          showWireValues: wb.viewPreferences?.showWireValues ?? true,
          snapToAlign: wb.viewPreferences?.snapToAlign ?? true,
          repSystem: wb.viewPreferences?.repSystem || 'binary',
          undoStack: [],
          redoStack: [],
        });
        get().resetAllSimState();
        setTimeout(() => get().evaluateCircuit(), 0);
      } else if (data.circuit) {
        // Legacy single-circuit format — wrap in a one-worksheet workbook
        const wsId = mintId({ kind: 'sandbox' });
        const importedComponents = data.circuit.components || [];
        const importedWires = data.circuit.wires || [];
        const resolvedComponents = resolveMemDirections(importedComponents, importedWires);
        const tabCircuits = new Map<string, TabCircuitData>();
        tabCircuits.set(wsId, {
          components: resolvedComponents,
          wires: importedWires,
          boxes: data.boxes || [],
          confirmedBoxes: data.confirmedBoxes || [],
        });
        const bm = data.metadata?.buildType || 'CC';
        set({
          assignment: null,
          workbookOpen: true,
          workbookTitle: data.metadata?.title || 'Imported Circuit',
          workbookFileHandle: handle || null,
          tabs: [{ id: wsId, title: data.metadata?.title || 'Circuit 1', buildMode: bm, activeTask: 'arithmetic' as ActiveTask }],
          activeTabId: wsId,
          tabCircuits,
          components: resolvedComponents,
          wires: importedWires,
          boxes: data.boxes || [],
          confirmedBoxLibrary: data.confirmedBoxes || [],
          buildMode: bm,
          activeTask: 'arithmetic',
          repSystem: data.repSystem || 'binary',
          undoStack: [],
          redoStack: [],
        });
        get().resetAllSimState();
        setTimeout(() => get().evaluateCircuit(), 0);
      } else {
        alert('Invalid file format. Expected a workbook or circuit file.');
      }
    } catch (e) {
      console.error('Invalid workbook JSON:', e);
      alert('Invalid file. Please check the JSON format.');
    }
  },

  buildMode: 'CC',
  setBuildMode: (mode) => set({ buildMode: mode }),

  turboEnabled: false,
  setTurboEnabled: (v) => set({ turboEnabled: v }),

  activeTask: 'arithmetic',
  setActiveTask: (t) => {
    const state = get();
    set({
      activeTask: t,
      tabs: state.tabs.map((tab) =>
        tab.id === state.activeTabId ? { ...tab, activeTask: t } : tab
      ),
    });
  },

  repSystem: 'binary',
  displayMode: 'IO',
  scope: 'local',
  setRepSystem: (r) => set({ repSystem: r }),
  setDisplayMode: (d) => set({ displayMode: d }),
  setScope: (s) => set({ scope: s }),

  components: [],
  wires: [],
  nextInputNum: 1,
  nextOutputNum: 1,
  nextMemNum: 1,
  nextStateNum: 0,

  addComponent: (type, x, y) => {
    const state = get();
    if (isCurrentQuestionLocked(state)) return;
    state.pushHistory(1);
    const sx = snapToGrid(x);
    const sy = snapToGrid(y);
    let label = '';

    // Compute next available number from existing components on canvas
    if (type === 'INPUT') {
      const existing = state.components.filter((c) => c.type === 'INPUT');
      const usedNums = existing.map((c) => parseInt(c.label.replace('IN', '')) || 0);
      const next = usedNums.length === 0 ? 1 : Math.max(...usedNums) + 1;
      label = `IN${next}`;
    } else if (type === 'OUTPUT') {
      const existing = state.components.filter((c) => c.type === 'OUTPUT');
      const usedNums = existing.map((c) => parseInt(c.label.replace('OUT', '')) || 0);
      const next = usedNums.length === 0 ? 1 : Math.max(...usedNums) + 1;
      label = `OUT${next}`;
    } else if (type === 'MEM') {
      const existing = state.components.filter((c) => c.type === 'MEM');
      const usedNums = existing.map((c) => parseInt(c.label.replace('M', '')) || 0);
      const next = usedNums.length === 0 ? 1 : Math.max(...usedNums) + 1;
      label = `M${next}`;
    } else if (type === 'STATE') {
      const existing = state.components.filter((c) => c.type === 'STATE');
      // Extract numeric part from labels like "S₀", "S₁"
      const subDigits = '₀₁₂₃₄₅₆₇₈₉';
      const usedNums = existing.map((c) => {
        const numStr = c.label.replace('S', '').split('').map(ch => {
          const idx = subDigits.indexOf(ch);
          return idx >= 0 ? String(idx) : ch;
        }).join('');
        return parseInt(numStr) || 0;
      });
      const next = usedNums.length === 0 ? 0 : Math.max(...usedNums) + 1;
      label = `S${toSubscript(next)}`;
    } else {
      label = type;
    }

    const comp: CircuitComponent = {
      id: mintId(selectPasteScope(state)),
      type,
      x: sx,
      y: sy,
      label,
      ports: getPortsForType(type),
      value: type === 'INPUT' ? undefined : 0,
      inputValues: type === 'INPUT' ? [undefined as unknown as number] : undefined,
      storedValue: type === 'MEM' ? 0 : undefined,
    };

    set({
      components: [...state.components, comp],
    });
    // Evaluate after adding
    setTimeout(() => get().evaluateCircuit(), 0);
  },

  moveComponent: (id, x, y) => {
    if (isCurrentQuestionLocked(get())) return;
    const snappedX = snapToGrid(x);
    const snappedY = snapToGrid(y);
    set((state) => {
      // Skip update if position hasn't actually changed after snapping
      const comp = state.components.find((c) => c.id === id);
      if (comp && comp.x === snappedX && comp.y === snappedY) return state;
      return {
        components: state.components.map((c) =>
          c.id === id ? { ...c, x: snappedX, y: snappedY } : c
        ),
      };
    });
  },

  moveComponentRaw: (id, x, y) => {
    if (isCurrentQuestionLocked(get())) return;
    set((state) => ({
      components: state.components.map((c) =>
        c.id === id ? { ...c, x, y } : c
      ),
    }));
  },

  snapComponentToGrid: (id) => {
    set((state) => ({
      components: state.components.map((c) =>
        c.id === id ? { ...c, x: snapToGrid(c.x), y: snapToGrid(c.y) } : c
      ),
    }));
  },

  removeComponent: (id) => {
    const state = get();
    if (isCurrentQuestionLocked(state)) return;
    state.pushHistory();
    const newWires = state.wires.filter(
      (w) => w.sourceComponentId !== id && w.targetComponentId !== id
    );
    // Reset MEM directions and re-resolve with remaining wires
    const remainingComps = state.components.filter((c) => c.id !== id);
    const resetComps = remainingComps.map((c) =>
      c.type === 'MEM' ? { ...c, memDirection: undefined } : c
    );
    const resolvedComps = resolveMemDirections(resetComps, newWires);
    set({
      components: resolvedComps,
      wires: newWires,
    });
    setTimeout(() => get().evaluateCircuit(), 0);
  },

  setInputValue: (id, value) => {
    suppressAutoAddRow = false; // explicit input change → re-enable table auto-add
    set((state) => ({
      components: state.components.map((c) =>
        c.id === id ? { ...c, value, inputValues: [value] } : c
      ),
    }));
    if (!get().localStepActive) {
      setTimeout(() => get().evaluateCircuit(), 0);
    }
  },

  setMemStoredValue: (id, value) => {
    set((state) => ({
      components: state.components.map((c) =>
        c.id === id ? { ...c, storedValue: value } : c
      ),
    }));
    if (!get().localStepActive) {
      setTimeout(() => get().evaluateCircuit(), 0);
    }
  },

  addWire: (sourceCompId, sourcePortId, targetCompId, targetPortId) => {
    const state = get();
    if (isCurrentQuestionLocked(state)) return;
    const sourceComp = state.components.find((c) => c.id === sourceCompId);
    const targetComp = state.components.find((c) => c.id === targetCompId);
    const isFsmTransition = sourceComp?.type === 'STATE' && targetComp?.type === 'STATE';

    // Check: no merging - target port must not already have an incoming wire
    // (Except in FSM mode where STATE ports accept multiple transitions)
    if (!isFsmTransition) {
      const existing = state.wires.find(
        (w) =>
          w.targetComponentId === targetCompId &&
          w.targetPortId === targetPortId
      );
      if (existing) {
        console.warn('Merge violation: input port already has a connection');
        return;
      }
    }

    state.pushHistory();
    // Default transition label: the source state's notation owns it (FSM
    // "in:out" sized to the question's group counts, base TM "in:writeMove",
    // turbot TM per state kind, turbot FSM canonical 2-bit motor — default
    // "0:11": sensor clear → both motors on, i.e. forward).
    const defaultLabel = isFsmTransition
      ? selectTransitionNotationForSource(state, sourceComp).defaultLabel
      : undefined;
    const wire: Wire = {
      id: mintId(selectPasteScope(state)),
      sourceComponentId: sourceCompId,
      sourcePortId: sourcePortId,
      targetComponentId: targetCompId,
      targetPortId: targetPortId,
      value: 0,
      transitionLabel: defaultLabel,
    };
    const newWires = [...state.wires, wire];
    const resolvedComponents = resolveMemDirections(state.components, newWires);
    set({ wires: newWires, components: resolvedComponents });
    setTimeout(() => get().evaluateCircuit(), 0);
  },

  removeWire: (id) => {
    const state = get();
    if (isCurrentQuestionLocked(state)) return;
    state.pushHistory();
    const newWires = state.wires.filter((w) => w.id !== id);
    // Reset all MEM directions, then re-resolve from remaining wires
    const resetComponents = state.components.map((c) =>
      c.type === 'MEM' ? { ...c, memDirection: undefined } : c
    );
    const resolvedComponents = resolveMemDirections(resetComponents, newWires);
    set({
      wires: newWires,
      components: resolvedComponents,
    });
    setTimeout(() => get().evaluateCircuit(), 0);
  },

  updateWireManualSegments: (wireId, segments) => {
    if (isCurrentQuestionLocked(get())) return;
    set((state) => ({
      wires: state.wires.map((w) =>
        w.id === wireId ? { ...w, manualSegments: segments } : w
      ),
    }));
  },

  selectedIds: [],
  setSelectedIds: (ids) => set({ selectedIds: ids }),
  toggleSelected: (id) =>
    set((state) => ({
      selectedIds: state.selectedIds.includes(id)
        ? state.selectedIds.filter((i) => i !== id)
        : [...state.selectedIds, id],
    })),
  clearSelection: () => set({ selectedIds: [] }),

  zoom: 1,
  panX: 0,
  panY: 0,
  showGrid: true,
  showWireValues: true,
  snapToAlign: true,
  setZoom: (z) => set({ zoom: Math.max(0.25, Math.min(3, z)) }),
  setPan: (x, y) => set({ panX: x, panY: y }),
  setShowGrid: (v) => set({ showGrid: v }),
  setShowWireValues: (v) => set({ showWireValues: v }),
  setSnapToAlign: (v) => set({ snapToAlign: v }),

  wireValues: new Map(),

  evaluateCircuit: () => {
    const state = get();
    const { components, wires } = state;
    if (components.length === 0) return;

    // Pure evaluation lives in the framework-agnostic engine; the store keeps
    // the UI-facing work below (writing .value, the -1 wire sentinel, tableRows).
    const { portValues, wireValues: newWireValues } = evaluateCC(components, wires);

    // Update components with computed values
    const updatedComponents = components.map((c) => {
      if (c.type === 'OUTPUT') {
        const val = portValues.has(`${c.id}:in`)
          ? portValues.get(`${c.id}:in`)
          : undefined;
        return { ...c, value: val };
      }
      if (c.type !== 'INPUT') {
        const outputPort = c.ports.find((p) => p.side === 'right');
        if (outputPort) {
          const val = portValues.get(`${c.id}:${outputPort.id}`);
          return { ...c, value: val };
        }
      }
      return c;
    });

    const updates: Record<string, unknown> = {
      components: updatedComponents,
      wires: wires.map((w) => ({
        ...w,
        // Use -1 as sentinel for "undefined/blank" since Wire.value is number
        value: newWireValues.has(w.id) ? newWireValues.get(w.id)! : -1,
      })),
      wireValues: newWireValues,
    };

    // CC mode: auto-populate the I/O table with the current input→output row
    // Auto-populate the I/O table with the current input→output row
    const hasMem = updatedComponents.some((c) => c.type === 'MEM');
    if ((state.buildMode === 'CC' || hasMem) && !suppressAutoAddRow) {
      const inputs = updatedComponents
        .filter((c) => c.type === 'INPUT')
        .sort((a, b) => {
          const numA = parseInt(a.label.replace('IN', ''));
          const numB = parseInt(b.label.replace('IN', ''));
          return numA - numB;
        });
      const outputs = updatedComponents
        .filter((c) => c.type === 'OUTPUT')
        .sort((a, b) => {
          const numA = parseInt(a.label.replace('OUT', ''));
          const numB = parseInt(b.label.replace('OUT', ''));
          return numA - numB;
        });
      const mems = updatedComponents
        .filter((c) => c.type === 'MEM')
        .sort((a, b) => {
          const numA = parseInt(a.label.replace('M', ''));
          const numB = parseInt(b.label.replace('M', ''));
          return numA - numB;
        });

      const allInputsSet = inputs.every((c) => c.value != null);
      if (inputs.length > 0 && outputs.length > 0 && allInputsSet) {
        const inputBits = inputs.map((c) => c.value!);
        const memBits = mems.map((c) => c.storedValue ?? 0);
        const outputBits = outputs.map((c) => c.value != null ? c.value : 0);
        const key = [...inputBits, ...memBits].join(',');

        // Upsert: replace existing row for this input+mem combo, or append
        const existing = state.tableRows;
        const idx = existing.findIndex((r) => [...r.inputBits, ...(r.memBits || [])].join(',') === key);
        if (idx >= 0) {
          const newRows = [...existing];
          newRows[idx] = { inputBits, memBits: mems.length > 0 ? memBits : undefined, outputBits };
          updates.tableRows = newRows;
        } else {
          updates.tableRows = [...existing, { inputBits, memBits: mems.length > 0 ? memBits : undefined, outputBits }];
        }
      }
    }

    set(updates as any);
  },

  // Undo/Redo
  undoStack: [],
  redoStack: [],
  pushHistory: (added = 0) => {
    const state = get();
    set({
      undoStack: [
        ...state.undoStack.slice(-49),
        {
          components: JSON.parse(JSON.stringify(state.components)),
          wires: JSON.parse(JSON.stringify(state.wires)),
          boxes: JSON.parse(JSON.stringify(state.boxes)),
          confirmedBoxes: JSON.parse(JSON.stringify(state.confirmedBoxLibrary)),
        },
      ],
      redoStack: [],
      ...recordEdit(state, { compIns: added }),
    });
  },
  undo: () => {
    const state = get();
    if (state.undoStack.length === 0 || isCurrentQuestionLocked(state)) return;
    const prev = state.undoStack[state.undoStack.length - 1];
    set({
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [
        ...state.redoStack,
        {
          components: JSON.parse(JSON.stringify(state.components)),
          wires: JSON.parse(JSON.stringify(state.wires)),
          boxes: JSON.parse(JSON.stringify(state.boxes)),
          confirmedBoxes: JSON.parse(JSON.stringify(state.confirmedBoxLibrary)),
        },
      ],
      components: prev.components,
      wires: prev.wires,
      boxes: prev.boxes,
      confirmedBoxLibrary: prev.confirmedBoxes,
      // An edit action, adding nothing new (what it restores was counted).
      ...recordEdit(state, {}),
    });
  },
  redo: () => {
    const state = get();
    if (state.redoStack.length === 0 || isCurrentQuestionLocked(state)) return;
    const next = state.redoStack[state.redoStack.length - 1];
    set({
      redoStack: state.redoStack.slice(0, -1),
      undoStack: [
        ...state.undoStack,
        {
          components: JSON.parse(JSON.stringify(state.components)),
          wires: JSON.parse(JSON.stringify(state.wires)),
          boxes: JSON.parse(JSON.stringify(state.boxes)),
          confirmedBoxes: JSON.parse(JSON.stringify(state.confirmedBoxLibrary)),
        },
      ],
      components: next.components,
      wires: next.wires,
      boxes: next.boxes,
      confirmedBoxLibrary: next.confirmedBoxes,
      ...recordEdit(state, {}),
    });
  },

  // Assignment mode
  assignment: null,
  assignmentView: 'overview',
  currentQuestionIndex: 0,
  questionCircuits: new Map(),
  openResponse: '',
  // The text setters stamp the answer as they change it (recordEdit): the
  // record is signed at EDIT time, never at save time.
  setOpenResponse: (text) => {
    const state = get();
    if (isCurrentQuestionLocked(state)) return;
    set({
      openResponse: text,
      ...recordEdit(
        state,
        { textIns: textInsertion(textFieldKey(state, 'r'), state.openResponse, text) },
        { responseText: text, fillAnswers: state.fillAnswers },
      ),
    });
  },
  fillAnswers: [],
  setFillAnswer: (index, value) => {
    const state = get();
    if (isCurrentQuestionLocked(state)) return;
    const next = state.fillAnswers.slice();
    while (next.length <= index) next.push('');
    const before = next[index];
    next[index] = value;
    set({
      fillAnswers: next,
      ...recordEdit(
        state,
        { textIns: textInsertion(textFieldKey(state, `f${index}`), before, value) },
        { responseText: state.openResponse, fillAnswers: next },
      ),
    });
  },
  questionTrace: null,
  loadAssignment: (assignment) => {
    const questionCircuits = new Map<number, QuestionCircuit>();
    for (const q of assignment.questions) {
      questionCircuits.set(q.id, emptyQuestionCircuit());
    }
    set({
      assignment,
      currentQuestionIndex: 0,
      questionCircuits,
      components: [],
      wires: [],
      boxes: [],
      confirmedBoxLibrary: [],
      openResponse: '',
      fillAnswers: [],
      questionTrace: null,
      buildMode: assignment.questions[0]?.buildMode || 'CC',
    });
    get().resetAllSimState();
  },
  openAssignment: async (id) => {
    // Flush any pending debounced save for the canvas we're leaving so its
    // last edit is persisted before another workbook takes over the live state.
    flushAutoSave();
    // Same assignment already in memory → resume without wiping in-progress work.
    if (get().assignment?.id === id) {
      set({ workbookOpen: true });
      return true;
    }
    const seq = ++openAssignmentSeq;
    const [def, { state: fetched, mintKey }, latestSubmission] = await Promise.all([
      getAssignment(id),
      // The saved work AND this person's mint key for this assignment (task
      // 034), in one fetch: ids minted and editing records signed from here
      // on bind to them.
      workbookStore.loadForOpen(id, currentPrincipal),
      // Fetched directly, not read off the separately-hydrated `submissions`
      // map: that hydration (App.tsx's mount effect) races this open on a
      // fresh deep link, and the freeze check below needs THIS assignment's
      // latest submission to be accurate the instant the question loads.
      submissionStore.getLatest(id),
    ]);
    // Superseded while in flight — drop this resolve (see the AppState note).
    // A stale resolve registers no key either: it may be a previous
    // principal's.
    if (seq !== openAssignmentSeq) return true;
    if (!def) return false;
    if (mintKey) setMintKey(id, mintKey);
    // An unpublished assignment is not openable by a student, by URL or
    // otherwise. Remotely the server already refuses (the fetch 404s, so
    // `def` is undefined above); local mode has no server to refuse, so the
    // same rule is applied here.
    if (
      backendMode === 'local' &&
      !instructorRole.isInstructor() &&
      !(await assignmentStore.getVisible(id))
    ) {
      return false;
    }

    // Remote mode: replay the crash buffer, if one survived a hard tab kill
    // (storage/journal.ts) — it supersedes the fetched server state and is
    // re-uploaded. Local mode: `fetched` passes through untouched.
    let saved = fetched;
    if (backendMode === 'remote') {
      const email = getSessionUser()?.email;
      if (email) {
        saved = await reconcileJournal(email, id, fetched, workbookStore);
        if (seq !== openAssignmentSeq) return true;
      }
    }
    get().loadAssignment(def);
    if (latestSubmission) {
      set({ submissions: { ...get().submissions, [id]: latestSubmission } });
    }

    // Restore any saved work for this assignment (merged by question id).
    const { questionCircuits, currentQuestionIndex, boxLibrary } = restoreQuestionCircuits(def, saved);
    const activeQ = def.questions[currentQuestionIndex];
    // Frozen (item 3): show what was actually SUBMITTED, read-only, not the
    // live in-progress work — even if the two have since diverged.
    const frozen = latestSubmission != null && selectAssignmentFrozen(get());
    const activeCircuit = activeQ
      ? frozen
        ? frozenQuestionCircuit(latestSubmission!, activeQ.id)
        : questionCircuits.get(activeQ.id) ?? emptyQuestionCircuit()
      : emptyQuestionCircuit();
    set({
      questionCircuits,
      currentQuestionIndex,
      ...loadQuestionFields(activeCircuit),
      // Assignment-wide: a box built for one question is available in every
      // question of the homework that can place its kind.
      confirmedBoxLibrary: boxLibrary,
      buildMode: activeQ?.buildMode || 'CC',
      workbookOpen: true,
    });
    get().resetAllSimState();
    return true;
  },
  goHome: () => {
    const state = get();
    // Sync the live canvas into its container so nothing in memory is lost.
    if (state.assignment) {
      const q = state.assignment.questions[state.currentQuestionIndex];
      if (q) {
        const qc = new Map(state.questionCircuits);
        qc.set(q.id, foldLiveQuestion(state, q.id));
        set({ questionCircuits: qc });
      }
      // Flush immediately so a quick Home click persists (don't wait for
      // debounce). Fire-and-forget: the local seam writes synchronously before
      // its first suspension. A remote failure buffers to the crash journal;
      // the debounced autosave (armed by the set() above) retries with the
      // error chip + backoff through the normal performAutoSave path.
      void saveAssignmentState().catch(() => writeOpenAssignmentJournal());
    } else {
      const tc = new Map(state.tabCircuits);
      tc.set(state.activeTabId, {
        components: state.components,
        wires: state.wires,
        boxes: state.boxes,
        confirmedBoxes: state.confirmedBoxLibrary,
      });
      set({ tabCircuits: tc });
    }
    // History is canvas-scoped: an undo after coming back must not restore
    // the canvas left here over whichever one is entered next.
    set({ workbookOpen: false, undoStack: [], redoStack: [] });
  },
  enterSandbox: () => {
    const state = get();
    if (state.tabs.length === 0) {
      get().newWorkbook();
      return;
    }
    // Fall back to an empty circuit (NOT the live components, which may belong
    // to an assignment we're leaving) when this tab has no saved canvas yet.
    const saved = state.tabCircuits.get(state.activeTabId) ?? {
      components: [],
      wires: [],
      boxes: [],
      confirmedBoxes: [],
    };
    const tab = state.tabs.find((t) => t.id === state.activeTabId);
    set({
      assignment: null,
      workbookOpen: true,
      components: saved.components,
      wires: saved.wires,
      boxes: saved.boxes,
      confirmedBoxLibrary: saved.confirmedBoxes || [],
      buildMode: tab?.buildMode || 'CC',
      activeTask: tab?.activeTask || 'arithmetic',
    });
    get().resetAllSimState();
  },
  switchQuestion: (index) => {
    const state = get();
    const a = state.assignment;
    if (!a) return;
    const currentQ = a.questions[state.currentQuestionIndex];
    const nextQ = a.questions[index];
    if (!currentQ || !nextQ) return;

    // Frozen (item 3): every question shows its own submitted answer,
    // read-only — there is no live canvas to save on the way out.
    if (selectAssignmentFrozen(state)) {
      const record = state.submissions[a.id]!;
      const saved = frozenQuestionCircuit(record, nextQ.id);
      set({
        currentQuestionIndex: index,
        ...loadQuestionFields(saved),
        buildMode: nextQ.buildMode,
      });
      get().resetAllSimState();
      return;
    }

    // Save the live question's canvas, load the target question's.
    const updatedMap = new Map(state.questionCircuits);
    updatedMap.set(currentQ.id, foldLiveQuestion(state, currentQ.id));

    const saved = updatedMap.get(nextQ.id) ?? emptyQuestionCircuit();
    set({
      currentQuestionIndex: index,
      questionCircuits: updatedMap,
      // confirmedBoxLibrary deliberately NOT swapped: it belongs to the
      // assignment, not the question (notes/pset_updates.md item 8).
      ...loadQuestionFields(saved),
      buildMode: nextQ.buildMode,
    });
    get().resetAllSimState();
  },
  toggleCurrentQuestionDone: () => {
    const state = get();
    const q = state.assignment?.questions[state.currentQuestionIndex];
    if (!q) return;
    // Fold in the live canvas (mirrors switchQuestion/goHome's sync) rather
    // than the possibly-stale map entry, so toggling done never discards an
    // edit made since the last navigation.
    const qc = new Map(state.questionCircuits);
    const wasDone = qc.get(q.id)?.done ?? false;
    qc.set(q.id, foldLiveQuestion(state, q.id, { done: !wasDone }));
    set({ questionCircuits: qc });
  },
  closeAssignment: () => {
    set({
      assignment: null,
      currentQuestionIndex: 0,
      questionCircuits: new Map(),
      components: [],
      wires: [],
      boxes: [],
      confirmedBoxLibrary: [],
      openResponse: '',
      fillAnswers: [],
      questionTrace: null,
      undoStack: [],
      redoStack: [],
    });
  },

  // Save/Load
  exportProject: () => {
    const state = get();
    return JSON.stringify(
      {
        notice: INTEGRITY_NOTICE,
        metadata: {
          title: 'Untitled',
          author: '',
          date: new Date().toISOString(),
          buildType: state.buildMode,
        },
        circuit: {
          components: state.components,
          wires: state.wires,
        },
        boxes: state.boxes,
        confirmedBoxes: state.confirmedBoxLibrary,
        repSystem: state.repSystem,
      },
      null,
      2
    );
  },
  exportSubmission: (student) => {
    const state = get();
    const assignment = state.assignment;
    if (!assignment) return null;
    const submission = buildSubmission(assignment, syncedQuestionCircuits(state), {
      student,
      submittedAt: new Date().toISOString(),
    });
    return JSON.stringify({ notice: INTEGRITY_NOTICE, ...submission }, null, 2);
  },
  submitAssignment: async (id, student) => {
    const epoch = principalEpoch;
    const def = await getAssignment(id);
    if (!def) return null;
    const state = get();
    // Build from live state if this assignment is open; otherwise from the
    // persisted state — so you can submit straight from a Home card.
    const circuits =
      state.assignment?.id === id
        ? syncedQuestionCircuits(state)
        : restoreQuestionCircuits(def, await workbookStore.loadAssignmentState(id))
            .questionCircuits;
    const submission = buildSubmission(def, circuits, {
      student,
      submittedAt: new Date().toISOString(),
    });
    const record = await submissionStore.submit(id, submission);
    // Recorded either way; only the SAME principal's badge map shows it.
    if (epoch === principalEpoch) set({ submissions: { ...get().submissions, [id]: record } });
    return record;
  },

  // Rotation
  rotateComponent: (id) => {
    const state = get();
    if (isCurrentQuestionLocked(state)) return;
    state.pushHistory();
    set({
      components: state.components.map((c) => {
        if (c.id !== id) return c;
        const current = c.rotation ?? 0;
        const next = (current + 90) % 360;
        return { ...c, rotation: next };
      }),
    });
    setTimeout(() => get().evaluateCircuit(), 0);
  },

  // Box definitions (draw-on-canvas boxing)
  boxes: [],
  confirmedBoxLibrary: [],
  addBox: (box) => {
    const state = get();
    if (isCurrentQuestionLocked(state)) return;
    state.pushHistory();
    set({ boxes: [...state.boxes, box] });
  },
  updateBox: (id, updates) => {
    if (isCurrentQuestionLocked(get())) return;
    set((state) => {
      const updatedBoxes = state.boxes.map((b) =>
        b.id === id ? { ...b, ...updates } : b
      );
      // Keep draftBox in sync if it's the one being updated
      const draftBox = state.boxDrawing.draftBox;
      const newDraft = draftBox && draftBox.id === id
        ? { ...draftBox, ...updates }
        : draftBox;
      // Sync name changes to global confirmedBoxLibrary and placed instances
      const updatedLibrary = updates.name
        ? state.confirmedBoxLibrary.map((b) =>
            b.id === id ? { ...b, name: updates.name! } : b
          )
        : state.confirmedBoxLibrary;
      const updatedComponents = updates.name
        ? state.components.map((c) =>
            c.boxedCircuitId === id ? { ...c, label: updates.name! } : c
          )
        : state.components;
      return {
        boxes: updatedBoxes,
        boxDrawing: { ...state.boxDrawing, draftBox: newDraft },
        confirmedBoxLibrary: updatedLibrary,
        components: updatedComponents,
      };
    });
  },
  removeBox: (id) => {
    const state = get();
    if (isCurrentQuestionLocked(state)) return;
    state.pushHistory();
    set({ boxes: state.boxes.filter((b) => b.id !== id) });
  },
  removeConfirmedBox: (id) => {
    const state = get();
    if (isCurrentQuestionLocked(state)) return;
    state.pushHistory();

    // Helper: strip all instances of this box from a circuit snapshot
    const stripBox = (comps: CircuitComponent[], wires: Wire[]) => {
      const removedIds = new Set(
        comps.filter((c) => c.boxedCircuitId === id).map((c) => c.id)
      );
      return {
        components: comps.filter((c) => !removedIds.has(c.id)),
        wires: wires.filter(
          (w) => !removedIds.has(w.sourceComponentId) && !removedIds.has(w.targetComponentId)
        ),
        removedIds,
      };
    };

    // Sweep the live canvas only — the library is per-canvas, so a box's
    // instances can't exist on any other question or tab.
    const { components: newComponents, wires: newWires, removedIds } =
      stripBox(state.components, state.wires);

    set({
      confirmedBoxLibrary: state.confirmedBoxLibrary.filter((b) => b.id !== id),
      components: newComponents,
      wires: newWires,
      boxes: state.boxes.filter((b) => b.id !== id),
      selectedIds: state.selectedIds.filter((sid) => !removedIds.has(sid)),
    });
  },
  renameBox: (id, name) => {
    const state = get();
    if (isCurrentQuestionLocked(state)) return 'This question is marked done — unlock it to rename a box.';
    const trimmed = name.trim();
    if (!trimmed) return 'A box needs a name.';
    if (takenBoxNames(state.confirmedBoxLibrary, state.boxes, id).has(trimmed))
      return `A box named "${trimmed}" already exists.`;

    state.pushHistory();

    // Placed instances carry the name as their label, so every canvas that can
    // hold one has to be swept: the live one, plus the other questions' saved
    // circuits (the library is assignment-wide).
    const relabel = (comps: CircuitComponent[]) =>
      comps.some((c) => c.boxedCircuitId === id)
        ? comps.map((c) => (c.boxedCircuitId === id ? { ...c, label: trimmed } : c))
        : comps;
    const renameDrawn = (boxes: BoxDefinition[]) =>
      boxes.some((b) => b.id === id)
        ? boxes.map((b) => (b.id === id ? { ...b, name: trimmed } : b))
        : boxes;

    const savedCircuits = new Map(state.questionCircuits);
    for (const [qid, qc] of savedCircuits) {
      savedCircuits.set(qid, {
        ...qc,
        components: relabel(qc.components),
        boxes: renameDrawn(qc.boxes),
      });
    }

    set({
      confirmedBoxLibrary: state.confirmedBoxLibrary.map((b) =>
        b.id === id ? { ...b, name: trimmed } : b
      ),
      boxes: renameDrawn(state.boxes),
      components: relabel(state.components),
      questionCircuits: savedCircuits,
    });

    return null;
  },
  confirmBox: (id) => {
    const state = get();
    if (isCurrentQuestionLocked(state)) return 'This question is marked done — unlock it to confirm a box.';
    const box = state.boxes.find((b) => b.id === id);
    if (!box) return 'Box not found.';

    // Find components inside the box (use actual component dimensions)
    const insideComps = state.components.filter((c) => {
      const w = (c.type === 'INPUT' || c.type === 'OUTPUT') ? 40 : 80;
      const h = (c.type === 'INPUT' || c.type === 'OUTPUT') ? 40 : (c.type === 'HA' ? 70 : 60);
      const cx = c.x + w / 2;
      const cy = c.y + h / 2;
      return cx >= box.x && cx <= box.x + box.width && cy >= box.y && cy <= box.y + box.height;
    });

    if (insideComps.length === 0) return 'No components inside the box.';

    // ── FSM boxing is refused by design (notes/todos.md item 2) ─────
    // See placeableBoxKinds (types.ts) for the full reasoning: a boxed
    // sub-FSM would need an invented call/return convention across multiple
    // external steps, the same reason TM boxing is refused. An earlier
    // attempt got as far as this confirm step and a placeholder placement
    // (git a05e3d6) but evaluateFSMSymbolStep never executed it.
    if (selectEffectiveMode(state) === 'FSM') {
      return 'Boxing is not available for FSM circuits.';
    }

    const insideIds = new Set(insideComps.map((c) => c.id));

    // Wires fully inside the box (both endpoints inside)
    const internalWires = state.wires.filter((w) =>
      insideIds.has(w.sourceComponentId) && insideIds.has(w.targetComponentId)
    );

    // ── MEM may not be boxed (SC boxing, notes item 23) ──
    // A boxed circuit is evaluated statelessly (engine/cc.ts
    // evaluateBoxedCircuit), and evaluateSCSequence only gives clocked state to
    // TOP-LEVEL MEM blocks — it does not look inside BOXED internals. A boxed
    // MEM would therefore never advance: the one-tick delay IN1→MEM→OUT1
    // yields 0,1,0,1 unboxed and 0,0,0,0 boxed. So an SC canvas can box its
    // combinational sub-circuits (that is what item 23 asks for), but the MEM
    // itself stays outside the box until the engine can carry nested state.
    {
      const mems = insideComps.filter((c) => c.type === 'MEM');
      if (mems.length > 0) {
        return `Memory cannot go inside a box: ${mems.map((m) => m.label).join(', ')}. ` +
          'A boxed circuit has no clock of its own, so a boxed MEM would never ' +
          'update. Box the gates around it and leave the MEM on the canvas.';
      }
    }

    // ── Textbook Rule 1: No loops ──
    // Check for cycles among inside components using internal wires.
    // MEM blocks break feedback loops (like in topological sort), so skip
    // wires feeding into a MEM's input port.
    {
      const compMap = new Map(insideComps.map((c) => [c.id, c]));
      const adj = new Map<string, string[]>();
      for (const c of insideComps) adj.set(c.id, []);
      for (const w of internalWires) {
        // Skip wires into MEM input ports — MEM breaks the cycle
        const targetComp = compMap.get(w.targetComponentId);
        if (targetComp?.type === 'MEM' && isMemSinkPort(targetComp, w.targetPortId)) continue;
        const list = adj.get(w.sourceComponentId);
        if (list) list.push(w.targetComponentId);
      }
      const visited = new Set<string>();
      const recStack = new Set<string>();
      function hasCycle(nodeId: string): boolean {
        visited.add(nodeId);
        recStack.add(nodeId);
        for (const next of adj.get(nodeId) || []) {
          if (!visited.has(next) && hasCycle(next)) return true;
          if (recStack.has(next)) return true;
        }
        recStack.delete(nodeId);
        return false;
      }
      for (const c of insideComps) {
        if (!visited.has(c.id) && hasCycle(c.id)) {
          return 'Loop detected: boxed circuits cannot contain loops.';
        }
      }
    }

    // ── Textbook Rule 2: No merged links ──
    // No input port on any inside component may have more than one incoming wire
    {
      const portInCount = new Map<string, number>();
      for (const w of internalWires) {
        const key = `${w.targetComponentId}:${w.targetPortId}`;
        portInCount.set(key, (portInCount.get(key) || 0) + 1);
      }
      // Also count wires entering from outside
      const crossingIn = state.wires.filter((w) =>
        !insideIds.has(w.sourceComponentId) && insideIds.has(w.targetComponentId)
      );
      for (const w of crossingIn) {
        const key = `${w.targetComponentId}:${w.targetPortId}`;
        portInCount.set(key, (portInCount.get(key) || 0) + 1);
      }
      for (const [key, count] of portInCount) {
        if (count > 1) {
          const [compId, portId] = key.split(':');
          const comp = insideComps.find((c) => c.id === compId);
          return `Merged link: port "${portId}" on "${comp?.label || compId}" has ${count} incoming connections.`;
        }
      }
    }

    // ── Textbook Rule 3: Every free end is either an input or output ──
    // A "free end" is an unconnected port on a component inside the box.
    // For it to be valid, every such free end must be a box input (left port
    // with a wire crossing in from outside) or a box output (right port with
    // a wire crossing out to outside). Truly unconnected ports are errors.
    const crossingWires = state.wires.filter((w) => {
      const srcInside = insideIds.has(w.sourceComponentId);
      const tgtInside = insideIds.has(w.targetComponentId);
      return srcInside !== tgtInside;
    });

    // Build sets of ports connected via crossing wires
    const crossingInputKeys = new Set<string>(); // ports inside receiving from outside
    const crossingOutputKeys = new Set<string>(); // ports inside sending to outside
    for (const w of crossingWires) {
      if (insideIds.has(w.targetComponentId)) {
        crossingInputKeys.add(`${w.targetComponentId}:${w.targetPortId}`);
      } else {
        crossingOutputKeys.add(`${w.sourceComponentId}:${w.sourcePortId}`);
      }
    }

    // Check every port on every inside component
    for (const comp of insideComps) {
      for (const port of comp.ports) {
        const key = `${comp.id}:${port.id}`;

        if (port.side === 'left') {
          // Input port: must have an internal wire OR a crossing wire coming in
          const hasInternal = internalWires.some(
            (w) => w.targetComponentId === comp.id && w.targetPortId === port.id
          );
          const hasCrossing = crossingInputKeys.has(key);
          if (!hasInternal && !hasCrossing) {
            return `Free end: input port "${port.id}" on "${comp.label}" is not connected. Every free end must be a box input or output.`;
          }
        } else {
          // Output port: must have an internal wire OR a crossing wire going out
          // (output ports are allowed to be unconnected if they just don't lead anywhere,
          // but per the textbook, free ends must be designated as box outputs)
          const hasInternal = internalWires.some(
            (w) => w.sourceComponentId === comp.id && w.sourcePortId === port.id
          );
          const hasCrossing = crossingOutputKeys.has(key);
          if (!hasInternal && !hasCrossing) {
            return `Free end: output port "${port.id}" on "${comp.label}" is not connected. Every free end must be a box input or output.`;
          }
        }
      }
    }

    // Identify box inputs and outputs
    // Crossing wires define ports at the boundary
    const inputPortIds = Array.from(crossingInputKeys);
    const outputPortIds = Array.from(crossingOutputKeys);

    // Additionally, INPUT components inside the box serve as box inputs
    // and OUTPUT components inside serve as box outputs
    for (const comp of insideComps) {
      if (comp.type === 'INPUT') {
        const key = `${comp.id}:out`;
        if (!outputPortIds.includes(key) && !inputPortIds.includes(key)) {
          inputPortIds.push(key);
        }
      }
      if (comp.type === 'OUTPUT') {
        const key = `${comp.id}:in`;
        if (!inputPortIds.includes(key) && !outputPortIds.includes(key)) {
          outputPortIds.push(key);
        }
      }
    }

    // Auto-suggest name
    const suggestedName = nextBoxName(
      'Box',
      takenBoxNames(state.confirmedBoxLibrary, state.boxes, id)
    );

    // Update the box as confirmed and add to global library
    const componentIds = insideComps.map((c) => c.id);
    set((s) => ({
      boxes: s.boxes.map((b) =>
        b.id === id
          ? { ...b, name: suggestedName, componentIds, inputPortIds, outputPortIds }
          : b
      ),
      boxDrawing: { phase: 'idle', draftBox: null },
      confirmedBoxLibrary: [
        ...s.confirmedBoxLibrary,
        {
          id,
          name: suggestedName,
          inputPortIds,
          outputPortIds,
          internalComponents: JSON.parse(JSON.stringify(insideComps)),
          internalWires: JSON.parse(JSON.stringify(internalWires)),
        },
      ],
    }));

    return null;
  },

  placeBoxInstance: (boxId, x, y) => {
    const state = get();
    if (isCurrentQuestionLocked(state)) return;

    // Look up from global library first, then fall back to current tab's boxes
    const libEntry = state.confirmedBoxLibrary.find((b) => b.id === boxId);
    const localBox = state.boxes.find((b) => b.id === boxId);
    const name = libEntry?.name || localBox?.name;
    const inPortIds = libEntry?.inputPortIds || localBox?.inputPortIds || [];
    const outPortIds = libEntry?.outputPortIds || localBox?.outputPortIds || [];

    if (!name) return;
    state.pushHistory(1);

    // Get internal circuit from library snapshot, or gather from current tab
    let internalComps: CircuitComponent[];
    let internalWires: Wire[];
    if (libEntry) {
      internalComps = libEntry.internalComponents;
      internalWires = libEntry.internalWires;
    } else if (localBox) {
      const insideIds = new Set(localBox.componentIds);
      internalComps = state.components.filter((c) => insideIds.has(c.id));
      internalWires = state.wires.filter(
        (w) => insideIds.has(w.sourceComponentId) && insideIds.has(w.targetComponentId)
      );
    } else {
      return;
    }

    // Build ports: inputs on left, outputs on right
    const inputPorts: import('./types').Port[] = inPortIds.map((_, i) => ({
      id: `in${i + 1}`,
      label: `in${i + 1}`,
      side: 'left' as const,
      index: i,
    }));
    const outputPorts: import('./types').Port[] = outPortIds.map((_, i) => ({
      id: `out${i + 1}`,
      label: `out${i + 1}`,
      side: 'right' as const,
      index: i,
    }));

    const comp: CircuitComponent = {
      id: mintId(selectPasteScope(state)),
      type: 'BOXED',
      x: snapToGrid(x),
      y: snapToGrid(y),
      label: name,
      ports: [...inputPorts, ...outputPorts],
      value: 0,
      boxedCircuitId: boxId,
      internalCircuit: {
        components: JSON.parse(JSON.stringify(internalComps)),
        wires: JSON.parse(JSON.stringify(internalWires)),
      },
    };

    set({
      components: [...state.components, comp],
    });
    setTimeout(() => get().evaluateCircuit(), 0);
  },

  // Delete
  clearWorkspace: () => {
    const state = get();
    if (isCurrentQuestionLocked(state)) return;
    state.pushHistory();
    set({
      components: [],
      wires: [],
      boxes: [],
      selectedIds: [],
      boxDrawing: { phase: 'idle', draftBox: null },
      nextInputNum: 1,
      nextOutputNum: 1,
      nextMemNum: 1,
      nextStateNum: 0,
    });
    setTimeout(() => get().evaluateCircuit(), 0);
  },

  deleteSelected: () => {
    const state = get();
    if (state.selectedIds.length === 0 || isCurrentQuestionLocked(state)) return;
    state.pushHistory();
    const idsToRemove = new Set(state.selectedIds);

    // Also remove wires that are selected
    const wireIdsToRemove = new Set(
      state.wires
        .filter(
          (w) =>
            idsToRemove.has(w.id) ||
            idsToRemove.has(w.sourceComponentId) ||
            idsToRemove.has(w.targetComponentId)
        )
        .map((w) => w.id)
    );

    const newWires = state.wires.filter((w) => !wireIdsToRemove.has(w.id) && !idsToRemove.has(w.id));
    const remainingComps = state.components.filter((c) => !idsToRemove.has(c.id));
    // Reset MEM directions and re-resolve with remaining wires
    const resetComps = remainingComps.map((c) =>
      c.type === 'MEM' ? { ...c, memDirection: undefined } : c
    );
    const resolvedComps = resolveMemDirections(resetComps, newWires);
    set({
      components: resolvedComps,
      wires: newWires,
      boxes: state.boxes.filter((b) => !idsToRemove.has(b.id)),
      selectedIds: [],
    });
    setTimeout(() => get().evaluateCircuit(), 0);
  },

  // Copy/Paste — through the provenance seam (provenance.ts, law 8). Copying
  // reads and is never locked; the stamp records where (this assignment, or
  // the sandbox), by whom and from which kind of canvas.
  copySelected: () => {
    const state = get();
    const selectedComps = state.components.filter((c) =>
      state.selectedIds.includes(c.id)
    );
    // Nothing selected: keep what was copied before rather than overwrite it.
    const kind = canvasKind(state.buildMode, selectEffectiveMode(state));
    if (selectedComps.length === 0 || !kind) return;
    const selectedCompIds = new Set(selectedComps.map((c) => c.id));
    const selectedWires = state.wires.filter(
      (w) =>
        selectedCompIds.has(w.sourceComponentId) &&
        selectedCompIds.has(w.targetComponentId)
    );
    stampCanvas({ components: selectedComps, wires: selectedWires }, pasteProvenance(state), kind);
  },
  paste: () => {
    const state = get();
    if (isCurrentQuestionLocked(state)) return null;
    // Refused before pushHistory, so a refused paste leaves no undo entry.
    const verdict = canvasPasteVerdict(peekClipboard().canvas, {
      prov: pasteProvenance(state),
      kind: canvasKind(state.buildMode, selectEffectiveMode(state)),
      allowed: selectAllowedComponents(state),
    });
    if (!verdict.ok) return verdict.message;
    // A fresh copy per paste, every id (BOXED internals too) minted anew in
    // the TARGET's scope: two pastes of one item never share objects or ids,
    // and a paste carried between assignments binds to the one it lands in.
    const clip = remint(JSON.parse(JSON.stringify(verdict.clip)) as CanvasClip, selectPasteScope(state));
    state.pushHistory(clip.components.length);

    // Compute next available label numbers from existing components on canvas
    const inNums = state.components.filter((c) => c.type === 'INPUT').map((c) => parseInt(c.label.replace('IN', '')) || 0);
    const outNums = state.components.filter((c) => c.type === 'OUTPUT').map((c) => parseInt(c.label.replace('OUT', '')) || 0);
    const memNums = state.components.filter((c) => c.type === 'MEM').map((c) => parseInt(c.label.replace('M', '')) || 0);
    let nextIn = inNums.length === 0 ? 1 : Math.max(...inNums) + 1;
    let nextOut = outNums.length === 0 ? 1 : Math.max(...outNums) + 1;
    let nextMem = memNums.length === 0 ? 1 : Math.max(...memNums) + 1;

    const newComps = clip.components.map((c) => {
      let label = c.label;
      if (c.type === 'INPUT') {
        label = `IN${nextIn}`;
        nextIn++;
      } else if (c.type === 'OUTPUT') {
        label = `OUT${nextOut}`;
        nextOut++;
      } else if (c.type === 'MEM') {
        label = `M${nextMem}`;
        nextMem++;
      }
      return { ...c, x: c.x + 40, y: c.y + 40, label };
    });

    set({
      components: [...state.components, ...newComps],
      wires: [...state.wires, ...clip.wires],
      selectedIds: newComps.map((c) => c.id),
    });
    setTimeout(() => get().evaluateCircuit(), 0);
    return null;
  },

  // Tabs (worksheets)
  tabs: [{ id: defaultTabId, title: 'Circuit 1', buildMode: 'CC' as BuildMode, activeTask: 'arithmetic' as ActiveTask }],
  activeTabId: defaultTabId,
  tabCircuits: new Map(),

  addTab: (title, buildMode, activeTask, innerMode) => {
    const state = get();
    const newId = mintId({ kind: 'sandbox' });
    const task = activeTask || 'arithmetic';
    // Save current tab
    const updatedTabCircuits = new Map(state.tabCircuits);
    updatedTabCircuits.set(state.activeTabId, {
      components: state.components,
      wires: state.wires,
      boxes: state.boxes,
      confirmedBoxes: state.confirmedBoxLibrary,
    });
    // A turbot tab carries its brain kind and its own arena — the sandbox
    // analog of a turbot question's innerMode + turbot_cases[0].arena, read
    // through the SAME selectors (selectTurbotInnerMode/selectTurbotArena).
    const turbotFields = buildMode === 'turbot'
      ? { innerMode: innerMode ?? 'CC' as BuildMode, arena: sandboxDefaultArena() }
      : {};
    set({
      tabs: [...state.tabs, { id: newId, title, buildMode, activeTask: task, ...turbotFields }],
      activeTabId: newId,
      tabCircuits: updatedTabCircuits,
      components: [],
      wires: [],
      boxes: [],
      confirmedBoxLibrary: [],
      buildMode,
      activeTask: task,
    });
    get().resetAllSimState();
  },

  switchTab: (id) => {
    const state = get();
    if (id === state.activeTabId) return;
    const updatedTabCircuits = new Map(state.tabCircuits);
    updatedTabCircuits.set(state.activeTabId, {
      components: state.components,
      wires: state.wires,
      boxes: state.boxes,
      confirmedBoxes: state.confirmedBoxLibrary,
    });
    const saved = updatedTabCircuits.get(id) || { components: [], wires: [], boxes: [], confirmedBoxes: [] };
    const tab = state.tabs.find((t) => t.id === id);
    set({
      activeTabId: id,
      tabCircuits: updatedTabCircuits,
      components: saved.components,
      wires: saved.wires,
      boxes: saved.boxes,
      confirmedBoxLibrary: saved.confirmedBoxes || [],
      buildMode: tab?.buildMode || 'CC',
      activeTask: tab?.activeTask || 'arithmetic',
    });
    get().resetAllSimState();
  },

  removeTab: (id) => {
    const state = get();
    if (state.tabs.length <= 1) return;
    const newTabs = state.tabs.filter((t) => t.id !== id);
    const updatedTabCircuits = new Map(state.tabCircuits);
    updatedTabCircuits.delete(id);
    if (id === state.activeTabId) {
      const newActiveId = newTabs[0].id;
      const saved = updatedTabCircuits.get(newActiveId) || {
        components: [],
        wires: [],
        boxes: [],
        confirmedBoxes: [],
      };
      set({
        tabs: newTabs,
        activeTabId: newActiveId,
        tabCircuits: updatedTabCircuits,
        components: saved.components,
        wires: saved.wires,
        boxes: saved.boxes,
        confirmedBoxLibrary: saved.confirmedBoxes || [],
        // The surviving tab's mode must come along with its canvas — leaving
        // the removed tab's buildMode live would render the new tab's circuit
        // under the wrong workspace (e.g. a CC sheet showing the turbot Map).
        buildMode: newTabs[0].buildMode || 'CC',
        activeTask: newTabs[0].activeTask || 'arithmetic',
      });
      get().resetAllSimState();
    } else {
      // Removing a background tab doesn't swap the canvas — leave the live
      // tab's in-progress run undisturbed.
      set({ tabs: newTabs, tabCircuits: updatedTabCircuits });
    }
  },

  renameTab: (id, title) => {
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, title } : t)),
    }));
  },

  setTabArena: (arena) => {
    const state = get();
    const tab = state.tabs.find((t) => t.id === state.activeTabId);
    // Arena editing exists only for sandbox turbot tabs — a question's arena
    // is instructor-authored and immutable here.
    if (state.assignment || tab?.buildMode !== 'turbot') return;
    set({
      tabs: state.tabs.map((t) => (t.id === tab.id ? { ...t, arena } : t)),
    });
    // The pose may now be out of bounds / inside a wall; restart from the
    // edited arena's start (same manual-reset semantics as circuit edits).
    get().turbotReset();
  },

  // Batch move — single state update for moving multiple components
  moveComponentsBatch: (moves) => {
    if (isCurrentQuestionLocked(get())) return;
    set((state) => {
      const movedIds = new Set(moves.keys());
      return {
        components: state.components.map((c) => {
          const pos = moves.get(c.id);
          return pos ? { ...c, x: pos.x, y: pos.y } : c;
        }),
        // Clear manual wire segments on wires connected to moved components
        wires: state.wires.map((w) => {
          if (
            (movedIds.has(w.sourceComponentId) || movedIds.has(w.targetComponentId)) &&
            w.manualSegments && w.manualSegments.length > 0
          ) {
            return { ...w, manualSegments: undefined };
          }
          return w;
        }),
      };
    });
  },

  snapComponentsToGrid: (ids) => {
    const idSet = new Set(ids);
    set((state) => ({
      components: state.components.map((c) =>
        idSet.has(c.id)
          ? { ...c, x: snapToGrid(c.x), y: snapToGrid(c.y) }
          : c
      ),
    }));
  },

  // Step-by-step table rows
  tableRows: [],

  addTableRow: () => {
    const state = get();
    const inputs = state.components
      .filter((c) => c.type === 'INPUT')
      .sort((a, b) => {
        const numA = parseInt(a.label.replace('IN', ''));
        const numB = parseInt(b.label.replace('IN', ''));
        return numA - numB;
      });
    const outputs = state.components
      .filter((c) => c.type === 'OUTPUT')
      .sort((a, b) => {
        const numA = parseInt(a.label.replace('OUT', ''));
        const numB = parseInt(b.label.replace('OUT', ''));
        return numA - numB;
      });

    const inputBits = inputs.map((c) => c.value ?? 0);
    const outputBits = outputs.map((c) => c.value ?? 0);

    set((s) => ({
      tableRows: [...s.tableRows, { inputBits, outputBits }],
    }));
  },

  clearTableRows: () => {
    set({ tableRows: [] });
  },

  // Local I/O stepping state
  localStepIndex: 0,
  localStepSorted: [],
  localStepPortValues: {},
  localStepActive: false,
  localStepSelectedKey: null,

  localStepSelect: (inBits, memBits) => {
    suppressAutoAddRow = false; // selecting a row to evaluate → re-enable auto-add
    const state = get();
    const { components, wires } = state;

    const inputs = components
      .filter((c) => c.type === 'INPUT')
      .sort((a, b) => parseInt(a.label.replace('IN', '')) - parseInt(b.label.replace('IN', '')));
    const mems = components
      .filter((c) => c.type === 'MEM')
      .sort((a, b) => parseInt(a.label.replace('M', '')) - parseInt(b.label.replace('M', '')));

    // Set INPUT values and MEM stored values; clear everything else
    const updatedComps = components.map((c) => {
      if (c.type === 'INPUT') {
        const idx = inputs.indexOf(c);
        const val = idx >= 0 && idx < inBits.length ? inBits[idx] : 0;
        return { ...c, value: val, inputValues: [val] };
      }
      if (c.type === 'MEM') {
        const idx = mems.indexOf(c);
        const val = memBits && idx >= 0 && idx < memBits.length ? memBits[idx] : (c.storedValue ?? 0);
        return { ...c, storedValue: val, value: undefined };
      }
      return { ...c, value: undefined };
    });

    // Initialize port values with INPUT and MEM outputs only
    const portValues: Record<string, number | undefined> = {};
    for (const comp of updatedComps) {
      if (comp.type === 'INPUT') {
        portValues[`${comp.id}:out`] = comp.value;
      } else if (comp.type === 'MEM') {
        portValues[`${comp.id}:${getMemOutputPortId(comp)}`] = comp.storedValue ?? 0;
      }
    }

    // Build wire evaluation order: follow topological sort of components.
    // For each component in topo order, collect its outgoing wires.
    // Inputs come first, then memories, then gates — all via topo sort.
    const sorted = topologicalSort(updatedComps, wires);
    // Separate: INPUTs first, then MEMs, then the rest (topo order handles the rest)
    const inputComps = sorted.filter((c) => c.type === 'INPUT');
    const memComps = sorted.filter((c) => c.type === 'MEM');
    const otherComps = sorted.filter((c) => c.type !== 'INPUT' && c.type !== 'MEM');
    const orderedSources = [...inputComps, ...memComps, ...otherComps];

    const wireOrder: string[] = [];
    const addedWires = new Set<string>();
    for (const comp of orderedSources) {
      // Collect all outgoing wires from this component
      const outgoing: Wire[] = [];
      for (const w of wires) {
        if (w.sourceComponentId === comp.id && !addedWires.has(w.id)) {
          // Skip feedback wires into MEM min ports
          if (comp.type !== 'INPUT' && comp.type !== 'MEM') {
            const targetComp = updatedComps.find((c) => c.id === w.targetComponentId);
            if (targetComp?.type === 'MEM' && w.targetPortId === getMemInputPortId(targetComp)) continue;
          }
          outgoing.push(w);
        }
      }
      // Sort fan-out wires: last in render order (highest z-index, on top) first,
      // so the visually closest wire gets annotated first, working backwards.
      if (outgoing.length > 1) {
        outgoing.reverse();
      }
      for (const w of outgoing) {
        wireOrder.push(w.id);
        addedWires.add(w.id);
      }
    }

    // MEM feedback wires (value going INTO memory) — fill memories before outputs
    for (const w of wires) {
      if (!addedWires.has(w.id)) {
        const targetComp = updatedComps.find((c) => c.id === w.targetComponentId);
        if (targetComp?.type === 'MEM' && w.targetPortId === getMemInputPortId(targetComp)) {
          wireOrder.push(w.id);
          addedWires.add(w.id);
        }
      }
    }
    // MEM update steps (show value being received)
    for (const mem of mems) {
      wireOrder.push(`comp:${mem.id}`);
    }

    // OUTPUT evaluations come last
    const outputComps = updatedComps
      .filter((c) => c.type === 'OUTPUT')
      .sort((a, b) => parseInt(a.label.replace('OUT', '')) - parseInt(b.label.replace('OUT', '')));
    for (const out of outputComps) {
      wireOrder.push(`comp:${out.id}`);
    }

    // Build selected key
    const keyBits = [...inBits, ...(memBits || mems.map((m) => m.storedValue ?? 0))];
    const selectedKey = keyBits.join(',');

    // Clear all wire values
    const clearedWires = wires.map((w) => ({ ...w, value: -1 }));

    set({
      components: updatedComps,
      wires: clearedWires,
      wireValues: new Map(),
      localStepIndex: 0,
      localStepSorted: wireOrder, // now stores wire IDs, not component IDs
      localStepPortValues: portValues,
      localStepActive: true,
      localStepSelectedKey: selectedKey,
    });
  },

  localStepOne: () => {
    const state = get();
    const { localStepIndex, localStepSorted, localStepPortValues, components, wires } = state;

    if (localStepIndex >= localStepSorted.length) {
      return false;
    }

    // Check if this step is a component evaluation (comp:ID) or a wire annotation
    const stepId = localStepSorted[localStepIndex];

    if (stepId.startsWith('comp:')) {
      // Evaluate the component directly (e.g. OUTPUT)
      const compId = stepId.slice(5);
      const comp = components.find((c) => c.id === compId);
      if (!comp) {
        set({ localStepIndex: localStepIndex + 1 });
        return localStepIndex + 1 < localStepSorted.length;
      }
      const newPortValues = { ...localStepPortValues };
      const inputPorts = comp.ports.filter((p) => p.side === 'left');
      const inputVals: (number | undefined)[] = [];
      let hasUndefined = false;
      for (const port of inputPorts) {
        const inWire = wires.find((w) => w.targetComponentId === comp.id && w.targetPortId === port.id);
        if (inWire) {
          const val = state.wireValues.has(inWire.id) ? state.wireValues.get(inWire.id) : undefined;
          inputVals.push(val != null ? val : undefined);
          if (val == null) hasUndefined = true;
        } else {
          inputVals.push(undefined);
          hasUndefined = true;
        }
      }
      if (comp.type === 'OUTPUT') {
        newPortValues[`${comp.id}:in`] = hasUndefined ? undefined : (inputVals[0] ?? 0);
      } else if (comp.type === 'MEM') {
        // MEM "evaluation" at end of cycle: read value from the feedback wire
        // into the MEM input port and record it as the next stored value.
        const memInputPortId = getMemInputPortId(comp);
        const feedbackWire = wires.find(
          (w) => w.targetComponentId === comp.id && w.targetPortId === memInputPortId
        );
        const feedbackVal = feedbackWire
          ? (state.wireValues.get(feedbackWire.id) ?? 0)
          : 0;
        newPortValues[`${comp.id}:${memInputPortId}`] = feedbackVal;
      } else if (!hasUndefined) {
        const outputs = evaluateGate(comp.type, inputVals as number[], comp);
        const outputPorts = comp.ports.filter((p) => p.side === 'right');
        for (let i = 0; i < outputPorts.length; i++) {
          newPortValues[`${comp.id}:${outputPorts[i].id}`] = outputs[i] ?? 0;
        }
      }
      const updatedComps = components.map((c) => {
        if (c.id !== compId) return c;
        if (c.type === 'OUTPUT') return { ...c, value: newPortValues[`${c.id}:in`] };
        if (c.type === 'MEM') {
          // Show the incoming value visually on the MEM block
          const memInputPortId = getMemInputPortId(c);
          const inVal = newPortValues[`${c.id}:${memInputPortId}`];
          return { ...c, storedValue: inVal != null ? inVal : (c.storedValue ?? 0) };
        }
        const outputPort = c.ports.find((p) => p.side === 'right');
        if (outputPort) return { ...c, value: newPortValues[`${c.id}:${outputPort.id}`] };
        return c;
      });

      // When an OUTPUT is evaluated, upsert the I/O table row with current output values
      const updates: Record<string, unknown> = { components: updatedComps, localStepIndex: localStepIndex + 1, localStepPortValues: newPortValues };
      if (comp.type === 'OUTPUT') {
        const hasMem = components.some((c) => c.type === 'MEM');
        const sortedInputs = components
          .filter((c) => c.type === 'INPUT')
          .sort((a, b) => parseInt(a.label.replace('IN', '')) - parseInt(b.label.replace('IN', '')));
        const sortedOutputs = components
          .filter((c) => c.type === 'OUTPUT')
          .sort((a, b) => parseInt(a.label.replace('OUT', '')) - parseInt(b.label.replace('OUT', '')));
        const sortedMems = components
          .filter((c) => c.type === 'MEM')
          .sort((a, b) => parseInt(a.label.replace('M', '')) - parseInt(b.label.replace('M', '')));

        const inputBits = sortedInputs.map((c) => c.value ?? 0);
        const outputBits = sortedOutputs.map((c) => {
          const val = newPortValues[`${c.id}:in`];
          return val !== undefined ? val : 0;
        });
        const memBitsVal = hasMem ? sortedMems.map((c) => c.storedValue ?? 0) : undefined;

        const localKey = [...inputBits, ...(memBitsVal || [])].join(',');
        const existingRows = state.tableRows;
        const localIdx = existingRows.findIndex((r) => [...r.inputBits, ...(r.memBits || [])].join(',') === localKey);
        let newTableRows = existingRows;
        if (localIdx >= 0) {
          newTableRows = [...existingRows];
          newTableRows[localIdx] = { inputBits, memBits: memBitsVal, outputBits };
        } else {
          newTableRows = [...existingRows, { inputBits, memBits: memBitsVal, outputBits }];
        }
        updates.tableRows = newTableRows;
      }
      set(updates);
      return localStepIndex + 1 < localStepSorted.length;
    }

    // Annotate one wire
    const wireId = stepId;
    const wire = wires.find((w) => w.id === wireId);
    if (!wire) {
      set({ localStepIndex: localStepIndex + 1 });
      return localStepIndex + 1 < localStepSorted.length;
    }

    const newPortValues = { ...localStepPortValues };
    const newWireValues = new Map(state.wireValues);

    // Get the source port value and annotate this wire
    const srcVal = newPortValues[`${wire.sourceComponentId}:${wire.sourcePortId}`];
    if (srcVal != null) {
      newWireValues.set(wire.id, srcVal);
    }

    // Update the wire object
    const updatedWires = wires.map((w) =>
      w.id === wireId ? { ...w, value: srcVal != null ? srcVal : -1 } : w
    );

    // Check if the target component now has ALL its input wires annotated.
    // If so, evaluate it so its output port values are available for downstream wires.
    const targetComp = components.find((c) => c.id === wire.targetComponentId);
    let updatedComps = components;

    if (targetComp && targetComp.type !== 'INPUT' && targetComp.type !== 'MEM' && targetComp.type !== 'OUTPUT') {
      const inputPorts = targetComp.ports.filter((p) => p.side === 'left');
      const allInputsReady = inputPorts.every((port) => {
        const inWire = wires.find((w) => w.targetComponentId === targetComp.id && w.targetPortId === port.id);
        if (!inWire) return true; // unconnected = ready (undefined)
        // Check if this wire has been annotated (either just now or previously)
        return inWire.id === wireId ? srcVal != null : newWireValues.has(inWire.id);
      });

      if (allInputsReady) {
        // Gather input values and evaluate
        const inputVals: (number | undefined)[] = [];
        let hasUndefined = false;
        for (const port of inputPorts) {
          const inWire = wires.find((w) => w.targetComponentId === targetComp.id && w.targetPortId === port.id);
          if (inWire) {
            const val = inWire.id === wireId ? srcVal : newWireValues.get(inWire.id);
            inputVals.push(val != null ? val : undefined);
            if (val == null) hasUndefined = true;
          } else {
            inputVals.push(undefined);
            hasUndefined = true;
          }
        }

        if (hasUndefined) {
          const outputPorts = targetComp.ports.filter((p) => p.side === 'right');
          for (const op of outputPorts) {
            newPortValues[`${targetComp.id}:${op.id}`] = undefined;
          }
        } else {
          const outputs = evaluateGate(targetComp.type, inputVals as number[], targetComp);
          const outputPorts = targetComp.ports.filter((p) => p.side === 'right');
          for (let i = 0; i < outputPorts.length; i++) {
            newPortValues[`${targetComp.id}:${outputPorts[i].id}`] = outputs[i] ?? 0;
          }
        }

        // Update the target component's displayed value
        updatedComps = components.map((c) => {
          if (c.id !== targetComp.id) return c;
          if (c.type === 'OUTPUT') {
            return { ...c, value: newPortValues[`${c.id}:in`] };
          }
          const outputPort = c.ports.find((p) => p.side === 'right');
          if (outputPort) {
            return { ...c, value: newPortValues[`${c.id}:${outputPort.id}`] };
          }
          return c;
        });
      }
    }

    set({
      components: updatedComps,
      wires: updatedWires,
      wireValues: newWireValues,
      localStepIndex: localStepIndex + 1,
      localStepPortValues: newPortValues,
    });
    return localStepIndex + 1 < localStepSorted.length;
  },

  localStepReset: () => {
    const state = get();
    if (!state.localStepActive) return;
    const inputs = state.components
      .filter((c) => c.type === 'INPUT')
      .sort((a, b) => parseInt(a.label.replace('IN', '')) - parseInt(b.label.replace('IN', '')));
    const mems = state.components
      .filter((c) => c.type === 'MEM')
      .sort((a, b) => parseInt(a.label.replace('M', '')) - parseInt(b.label.replace('M', '')));
    const inBits = inputs.map((c) => c.value ?? 0);
    const memBits = mems.length > 0 ? mems.map((c) => c.storedValue ?? 0) : undefined;

    // Remove the output for this row from tableRows
    const key = [...inBits, ...(memBits || [])].join(',');
    const newTableRows = state.tableRows.filter((r) =>
      [...r.inputBits, ...(r.memBits || [])].join(',') !== key
    );
    set({ tableRows: newTableRows });

    get().localStepSelect(inBits, memBits);
  },

  localStepClear: () => {
    set({
      localStepActive: false,
      localStepSelectedKey: null,
      localStepIndex: 0,
      localStepSorted: [],
      localStepPortValues: {},
    });
  },

  // Sequential circuit state
  scTimeStep: 1,
  scHistory: [],
  scInputSequence: [],
  scRunning: false,
  scRunIntervalId: null,
  scGlobalSequences: [],

  scStep: () => {
    const state = get();
    const { components, wires, scTimeStep, scHistory, scInputSequence } = state;

    // Question runs are bounded by the codec window — the exact step count
    // the grader runs (engine stepCountFor). Steps past it would show state
    // the grader never reads. Sandbox (window null): unbounded stepping.
    const codecWindow = selectCodecWindow(state);
    if (codecWindow !== null && scTimeStep > codecWindow) return;

    // Sorted component lists (consistent with the engine's ordering)
    const sortedInputs = components
      .filter((c) => c.type === 'INPUT')
      .sort((a, b) => (parseInt(a.label.replace('IN', '')) || 0) - (parseInt(b.label.replace('IN', '')) || 0));
    const sortedOutputs = components
      .filter((c) => c.type === 'OUTPUT')
      .sort((a, b) => (parseInt(a.label.replace('OUT', '')) || 0) - (parseInt(b.label.replace('OUT', '')) || 0));
    const sortedMems = components
      .filter((c) => c.type === 'MEM')
      .sort((a, b) => (parseInt(a.label.replace(/\D/g, '')) || 0) - (parseInt(b.label.replace(/\D/g, '')) || 0));

    const tIdx = scTimeStep - 1;
    const seqLoaded = scInputSequence.some((s) => s.length > 0);
    // Question runs feed EXACTLY the grader's input stream: the typed string
    // is parsed as a value per input group (as the A/V ARG column reads it)
    // and laid on the time axis by the codec's encodeInput — for tally the
    // ones arrive LAST (zeros leading), not in typed order. Falls back to raw
    // typed bits when the typed string is not a valid numeral (the ARG column
    // flags those '/') or the machine's input count doesn't match the spec.
    // scInputSequence is time-ordered (index 0 = t1 = rightmost typed char),
    // so each group's display-order numeral is its sequence reversed.
    const codecSteps = seqLoaded
      ? codecInputSteps(
          selectCodecLayout(state),
          sortedInputs.map((_, idx) => (scInputSequence[idx] ?? []).slice().reverse()),
        )
      : null;
    // Sandbox / fallback: past the end of a loaded input sequence, feed 0s
    // (flush steps) so bits still held in MEM can drain to the outputs
    // instead of re-reading the input component's last value.
    const inputBitVector = codecSteps
      ? sortedInputs.map((_, idx) => codecSteps[tIdx]?.[idx] ?? 0)
      : sortedInputs.map((inp, idx) =>
          scInputSequence[idx]?.[tIdx] !== undefined
            ? scInputSequence[idx][tIdx]
            : seqLoaded
              ? 0
              : (inp.value ?? 0)
        );
    const memStoredValues = sortedMems.map((m) => m.storedValue ?? 0);

    // Delegate propagation to the engine (same logic used by the grader)
    const { outputBits, newMemValues, portValues } = evaluateSCSingleStep(
      components, wires, inputBitVector,
      sortedInputs, sortedOutputs, sortedMems, memStoredValues
    );

    // Update components
    const newComponents = components.map((c) => {
      if (c.type === 'INPUT') {
        const idx = sortedInputs.findIndex((inp) => inp.id === c.id);
        const val = idx >= 0 ? inputBitVector[idx] : (c.value ?? 0);
        return { ...c, value: val, inputValues: [val] };
      }
      if (c.type === 'MEM') {
        const idx = sortedMems.findIndex((m) => m.id === c.id);
        return { ...c, storedValue: idx >= 0 ? newMemValues[idx] : (c.storedValue ?? 0) };
      }
      if (c.type === 'OUTPUT') {
        return { ...c, value: portValues.get(`${c.id}:in`) ?? 0 };
      }
      const outputPort = c.ports.find((p) => p.side === 'right');
      if (outputPort) {
        return { ...c, value: portValues.get(`${c.id}:${outputPort.id}`) ?? 0 };
      }
      return c;
    });

    // Update wire values
    const newWireValues = new Map<string, number>();
    for (const w of wires) {
      newWireValues.set(w.id, portValues.get(`${w.sourceComponentId}:${w.sourcePortId}`) ?? 0);
    }

    // Build history entry (memValues = stored values BEFORE this step)
    const inputBits = inputBitVector;
    const memValues = memStoredValues;
    const newHistory = [...scHistory, { t: scTimeStep, inputBits, outputBits, memValues }];

    // Update local I/O tableRows
    const memBits = memValues;
    const localKey = [...inputBits, ...memBits].join(',');
    const existingRows = state.tableRows;
    const localIdx = existingRows.findIndex((r) => [...r.inputBits, ...(r.memBits || [])].join(',') === localKey);
    let newTableRows = existingRows;
    if (localIdx >= 0) {
      newTableRows = [...existingRows];
      newTableRows[localIdx] = { inputBits, memBits: sortedMems.length > 0 ? memBits : undefined, outputBits };
    } else {
      newTableRows = [...existingRows, { inputBits, memBits: sortedMems.length > 0 ? memBits : undefined, outputBits }];
    }

    set({
      components: newComponents,
      wires: wires.map((w) => ({ ...w, value: newWireValues.get(w.id) ?? 0 })),
      wireValues: newWireValues,
      scTimeStep: scTimeStep + 1,
      scHistory: newHistory,
      tableRows: newTableRows,
    });

    // Update matching global sequence output
    const updState = get();
    const numInputs = sortedInputs.length;
    let currentInputStr = '';
    const maxSeqLen = Math.max(...updState.scInputSequence.map((s) => s.length), 0);
    for (let t = maxSeqLen - 1; t >= 0; t--) {
      for (let ii = 0; ii < numInputs; ii++) {
        currentInputStr += String(updState.scInputSequence[ii]?.[t] ?? 0);
      }
    }
    const outputStr = newHistory
      .slice()
      .sort((a, b) => b.t - a.t)
      .map((h) => h.outputBits.join(''))
      .join('');
    const seqIdx = updState.scGlobalSequences.findIndex((s) => s.inputStr === currentInputStr);
    if (seqIdx >= 0) {
      const seqs = [...updState.scGlobalSequences];
      seqs[seqIdx] = { ...seqs[seqIdx], outputStr };
      set({ scGlobalSequences: seqs });
    }
  },

  scRun: () => {
    const state = get();
    if (state.scRunning) return;
    const intervalId = window.setInterval(() => {
      const s = get();
      // Question runs execute exactly the codec window (the grader's run
      // length — see selectCodecWindow), 0-padding past the typed input.
      const codecWindow = selectCodecWindow(s);
      if (codecWindow !== null) {
        if (s.scTimeStep > codecWindow) {
          s.scPause();
          return;
        }
      } else {
        // Sandbox: stop once all input is consumed AND the memory pipeline
        // has been flushed (one extra 0-input step per MEM, so delayed bits —
        // e.g. a serial adder's final carry — still reach the outputs).
        const maxLen = Math.max(...s.scInputSequence.map((seq) => seq.length), 0);
        const drain = s.components.filter((c) => c.type === 'MEM').length;
        if (maxLen > 0 && s.scTimeStep > maxLen + drain) {
          s.scPause();
          return;
        }
      }
      s.scStep();
    }, 300);
    set({ scRunning: true, scRunIntervalId: intervalId });
  },

  scPause: () => {
    const state = get();
    if (state.scRunIntervalId !== null) {
      window.clearInterval(state.scRunIntervalId);
    }
    set({ scRunning: false, scRunIntervalId: null });
  },

  scReset: () => {
    const state = get();
    if (state.scRunIntervalId !== null) {
      window.clearInterval(state.scRunIntervalId);
    }
    // Reset MEM blocks to 0 and inputs to undefined, keep input sequence
    set({
      scTimeStep: 1,
      scHistory: [],
      scRunning: false,
      scRunIntervalId: null,
      tableRows: [],
      components: state.components.map((c) => {
        if (c.type === 'MEM') return { ...c, storedValue: 0 };
        if (c.type === 'INPUT') return { ...c, value: undefined, inputValues: [undefined as unknown as number] };
        return c;
      }),
    });
    setTimeout(() => get().evaluateCircuit(), 0);
  },

  scGlobalReset: () => {
    const state = get();
    if (state.scRunIntervalId !== null) {
      window.clearInterval(state.scRunIntervalId);
    }
    // Reset everything: MEM to 0, inputs to 0, clear input sequence
    set({
      scTimeStep: 1,
      scHistory: [],
      scInputSequence: [],
      scRunning: false,
      scRunIntervalId: null,
      tableRows: [],
      scGlobalSequences: [],
      components: state.components.map((c) => {
        if (c.type === 'MEM') return { ...c, storedValue: 0 };
        if (c.type === 'INPUT') return { ...c, value: undefined, inputValues: [undefined as unknown as number] };
        return c;
      }),
    });
    setTimeout(() => get().evaluateCircuit(), 0);
  },

  setScInputBit: (inputIndex, timeStep, value) => {
    set((state) => {
      const newSeq = [...state.scInputSequence];
      // Ensure the array for this input exists
      while (newSeq.length <= inputIndex) {
        newSeq.push([]);
      }
      // Ensure the array is long enough for this time step
      const arr = [...newSeq[inputIndex]];
      while (arr.length < timeStep) {
        arr.push(0);
      }
      arr[timeStep - 1] = value;
      newSeq[inputIndex] = arr;
      return { scInputSequence: newSeq };
    });
  },

  setScGlobalSequenceInput: (index, value) => {
    set((state) => {
      const seqs = [...state.scGlobalSequences];
      while (seqs.length <= index) seqs.push({ inputStr: '', outputStr: '' });
      seqs[index] = { ...seqs[index], inputStr: value };
      return { scGlobalSequences: seqs };
    });
  },

  loadScGlobalSequence: (index) => {
    const state = get();
    const seq = state.scGlobalSequences[index];
    if (!seq || seq.inputStr.length === 0) return;

    // Reset circuit state first
    if (state.scRunIntervalId !== null) {
      window.clearInterval(state.scRunIntervalId);
    }

    // Parse the input string into per-input sequences
    // For a single input: "0110" → scInputSequence[0] = [0,1,1,0]
    // For multiple inputs: each char is a time step, bits split across inputs
    const inputs = state.components
      .filter((c) => c.type === 'INPUT')
      .sort((a, b) => parseInt(a.label.replace('IN', '')) - parseInt(b.label.replace('IN', '')));
    const numInputs = inputs.length;
    const chars = seq.inputStr.replace(/[^01]/g, '');
    const stepsCount = numInputs > 0 ? Math.floor(chars.length / numInputs) : 0;

    const newSeq: number[][] = [];
    for (let i = 0; i < numInputs; i++) {
      newSeq.push([]);
    }
    // Read right-to-left: rightmost character is first time step
    for (let t = 0; t < stepsCount; t++) {
      const srcT = stepsCount - 1 - t; // reverse: last char group → first step
      for (let i = 0; i < numInputs; i++) {
        newSeq[i].push(parseInt(chars[srcT * numInputs + i]) || 0);
      }
    }

    set({
      scTimeStep: 1,
      scHistory: [],
      scRunning: false,
      scRunIntervalId: null,
      scInputSequence: newSeq,
      components: state.components.map((c) => {
        if (c.type === 'MEM') return { ...c, storedValue: 0 };
        if (c.type === 'INPUT') return { ...c, value: undefined, inputValues: [undefined as unknown as number] };
        return c;
      }),
    });
    setTimeout(() => get().evaluateCircuit(), 0);
  },

  recordScGlobalSequenceOutput: () => {
    const state = get();
    // Find the active global sequence (the one whose inputStr matches current scInputSequence)
    const inputs = state.components
      .filter((c) => c.type === 'INPUT')
      .sort((a, b) => parseInt(a.label.replace('IN', '')) - parseInt(b.label.replace('IN', '')));
    const numInputs = inputs.length;

    // Build output string from scHistory (reversed: earliest → rightmost)
    const outputStr = state.scHistory
      .sort((a, b) => b.t - a.t)
      .map((h) => h.outputBits.join(''))
      .join('');

    // Build current input string from scInputSequence (reversed: earliest → rightmost)
    let inputStr = '';
    const maxLen = Math.max(...state.scInputSequence.map((s) => s.length), 0);
    for (let t = maxLen - 1; t >= 0; t--) {
      for (let i = 0; i < numInputs; i++) {
        inputStr += String(state.scInputSequence[i]?.[t] ?? 0);
      }
    }

    // Find and update matching sequence
    const seqs = [...state.scGlobalSequences];
    const idx = seqs.findIndex((s) => s.inputStr === inputStr);
    if (idx >= 0) {
      seqs[idx] = { ...seqs[idx], outputStr };
      set({ scGlobalSequences: seqs });
    }
  },

  // Selected tool (click-to-place mode)
  selectedTool: null,
  setSelectedTool: (t) => set({ selectedTool: t }),

  // Box drawing mode state
  boxDrawing: {
    phase: 'idle',
    draftBox: null,
  },
  setBoxDrawingPhase: (phase) => {
    set((state) => ({
      boxDrawing: { ...state.boxDrawing, phase },
    }));
  },
  setDraftBox: (box) => {
    set((state) => ({
      boxDrawing: { ...state.boxDrawing, draftBox: box },
    }));
  },

  // ─── FSM state ──────────────────────────────────────────────────
  fsmCurrentStateId: null,
  fsmInputSequence: [],
  fsmTimeStep: 1,
  fsmHistory: [],
  fsmRunning: false,
  fsmRunIntervalId: null,
  fsmHalted: false,

  setTransitionLabel: (wireId, label) => {
    // The wire's SOURCE state picks the grammar (engine/notation.ts): FSM
    // sized to the question's group counts, base-TM two-output (read:write,
    // move), turbot-TM per state kind, turbot-FSM motor labels. A label the
    // notation cannot parse is rejected; a parseable one is stored in
    // CANONICAL form (notation.format), so legacy aliases — a turbot-FSM
    // '0:1', a dual-action TM '1:0R' — decay to their canonical spelling
    // ('0:11' / '1:0,R') on every edit-save.
    const state = get();
    if (isCurrentQuestionLocked(state)) return;
    const wire = state.wires.find((w) => w.id === wireId);
    const source = state.components.find((c) => c.id === wire?.sourceComponentId);
    const notation = selectTransitionNotationForSource(state, source);
    const parsed = notation.parse(label);
    if (!parsed) return;
    const canonical = notation.format(parsed);
    state.pushHistory();
    set({
      wires: state.wires.map((w) =>
        w.id === wireId ? { ...w, transitionLabel: canonical } : w
      ),
    });
  },

  setFsmControlPt: (wireId, pt) => {
    if (isCurrentQuestionLocked(get())) return;
    set({
      wires: get().wires.map((w) =>
        w.id === wireId ? { ...w, fsmControlPt: pt } : w
      ),
    });
  },

  setFsmInputBit: (index, value) => {
    set((state) => {
      const seq = [...state.fsmInputSequence];
      while (seq.length <= index) seq.push(0);
      seq[index] = value;
      return { fsmInputSequence: seq };
    });
  },

  setFsmInputSequence: (seq) => {
    set({ fsmInputSequence: seq });
  },

  fsmStep: () => {
    const state = get();
    const { components, wires, fsmTimeStep, fsmHistory, fsmInputSequence, fsmHalted } = state;
    if (fsmHalted) return;

    const states = sortStateComponents(components);
    if (states.length === 0) return;

    const currentStateId = state.fsmCurrentStateId || states[0].id;
    const currentState = components.find((c) => c.id === currentStateId);
    if (!currentState) return;

    const tIdx = fsmTimeStep - 1;
    // Question runs consume the full codec window (the grader's run length —
    // see selectCodecWindow); the sandbox stops at the typed length.
    const layout = selectCodecLayout(state);
    const codecWindow = layout ? stepCountFor(layout) : null;
    const numGroups = layout ? layout.inputWidths.length : 1;
    const groupSeqs = fsmGroupSequences(fsmInputSequence, numGroups);
    const typedSteps = groupSeqs[0]?.length ?? 0;
    if (codecWindow !== null ? tIdx >= codecWindow : tIdx >= typedSteps) return;
    // Question runs feed EXACTLY the grader's input stream: each group's
    // typed digits are read as one numeral under the question's
    // representation (typed "110" = binary 6 / tally 2), laid on the time
    // axis by the codec's encodeInput (LSB at t1; a tally value's ones
    // arrive last), and the FULL encoded row is joined into one k-char input
    // symbol per step — the same join the grader executes (symbol char i =
    // input group i). An invalid numeral (tally with a 1 after a 0) falls
    // back to the raw typed digits. Sandbox and fallback both feed the typed
    // digits with the RIGHTMOST character at t1 — the same right-to-left
    // time direction as SC (P1.10; the old leftmost-first sandbox feed
    // contradicted every other time surface).
    const codecSteps = layout
      ? codecInputSteps(layout, groupSeqs.map((g) => g.slice().reverse()))
      : null;
    const inputSymbol = codecSteps
      ? (codecSteps[tIdx] ?? []).map(String).join('')
      : groupSeqs.map((g) => String(g[tIdx] ?? 0)).join('');

    // Delegate transition logic to the engine (same logic used by the grader)
    const notation = selectFsmNotation(state);
    const result = evaluateFSMSymbolStep(wires, currentStateId, inputSymbol, notation);
    if (!result) {
      set({ fsmHalted: true });
      return;
    }

    const nextState = components.find((c) => c.id === result.nextStateId);
    const entry: FsmHistoryEntry = {
      t: fsmTimeStep,
      stateLabel: currentState.label,
      // Single-bit symbols stay numeric (the pinned k=1 history shape);
      // multi-bit symbols are carried as strings.
      input: inputSymbol.length === 1 ? Number(inputSymbol) : inputSymbol,
      output: result.output.length === 1 ? Number(result.output) : result.output,
      nextStateLabel: nextState?.label || '?',
    };

    set({
      fsmCurrentStateId: result.nextStateId,
      fsmTimeStep: fsmTimeStep + 1,
      fsmHistory: [...fsmHistory, entry],
    });
  },

  fsmRun: () => {
    const state = get();
    if (state.fsmRunning) return;
    const intervalId = window.setInterval(() => {
      const s = get();
      // Question runs execute exactly the codec window; sandbox runs stop at
      // the typed input length (see selectCodecWindow).
      const runEnd = selectCodecWindow(s) ?? s.fsmInputSequence.length;
      if (s.fsmHalted || s.fsmTimeStep > runEnd) {
        s.fsmPause();
        return;
      }
      s.fsmStep();
    }, 300);
    set({ fsmRunning: true, fsmRunIntervalId: intervalId });
  },

  fsmPause: () => {
    const state = get();
    if (state.fsmRunIntervalId !== null) {
      window.clearInterval(state.fsmRunIntervalId);
    }
    set({ fsmRunning: false, fsmRunIntervalId: null });
  },

  fsmReset: () => {
    const state = get();
    if (state.fsmRunIntervalId !== null) {
      window.clearInterval(state.fsmRunIntervalId);
    }
    set({
      fsmCurrentStateId: null,
      fsmTimeStep: 1,
      fsmHistory: [],
      fsmRunning: false,
      fsmRunIntervalId: null,
      fsmHalted: false,
    });
  },

  fsmGlobalReset: () => {
    const state = get();
    if (state.fsmRunIntervalId !== null) {
      window.clearInterval(state.fsmRunIntervalId);
    }
    set({
      fsmCurrentStateId: null,
      fsmInputSequence: [],
      fsmTimeStep: 1,
      fsmHistory: [],
      fsmRunning: false,
      fsmRunIntervalId: null,
      fsmHalted: false,
    });
  },

  // ─── TM state ──────────────────────────────────────────────────
  tmTape: { cells: {}, head: 0 },
  tmInitialTape: { cells: {}, head: 0 },
  tmCurrentStateId: null,
  tmTimeStep: 1,
  tmHistory: [],
  tmRunning: false,
  tmRunIntervalId: null,
  tmHalted: false,

  setTmCell: (index) => {
    const state = get();
    // The tape is only editable while idle (before any step has run).
    if (state.tmRunning || state.tmTimeStep > 1 || state.tmHalted) return;
    const notation = selectTmNotation(state);
    const current: TMSymbol = state.tmTape.cells[index] ?? '0';
    // Cycle through the notation's alphabet: unary 0→1→0; binary 0→1→*→0.
    const next: TMSymbol =
      current === '0' ? '1' : current === '1' && notation === 'binary' ? '*' : '0';
    const cells = { ...state.tmTape.cells };
    if (next === '0') delete cells[index];
    else cells[index] = next;
    const tape: TMTape = { cells, head: state.tmTape.head };
    set({ tmTape: tape, tmInitialTape: tape });
  },

  setTmHead: (index) => {
    const state = get();
    if (state.tmRunning || state.tmTimeStep > 1 || state.tmHalted) return;
    const tape: TMTape = { cells: state.tmTape.cells, head: index };
    set({ tmTape: tape, tmInitialTape: tape });
  },

  tmStep: () => {
    const state = get();
    const { components, wires, tmTape, tmTimeStep, tmHistory, tmHalted } = state;
    if (tmHalted) return;
    // A question run stops where the grader's does (its step budget); the
    // sandbox steps without bound.
    const budget = selectQuestionStepBudget(state);
    if (budget !== null && tmHistory.length >= budget) return;

    const states = sortStateComponents(components);
    if (states.length === 0) return;
    const currentStateId = state.tmCurrentStateId || states[0].id;
    const notation = selectTmNotation(state);

    // Delegate the step to the engine (same logic used by the grader). No
    // matching transition means the machine halts — for a TM that is the
    // normal end of the computation, not an error.
    const result = evaluateTMSingleStep(wires, currentStateId, tmTape, notation);
    if (!result) {
      set({ tmHalted: true });
      return;
    }

    const fromState = components.find((c) => c.id === currentStateId);
    const toState = components.find((c) => c.id === result.nextStateId);
    const entry: TmHistoryEntry = {
      t: tmTimeStep,
      stateLabel: fromState?.label ?? '?',
      read: result.read,
      action: result.action.raw,
      headBefore: tmTape.head,
      nextStateLabel: toState?.label ?? '?',
    };

    set({
      tmCurrentStateId: result.nextStateId,
      tmTape: result.tape,
      tmTimeStep: tmTimeStep + 1,
      tmHistory: [...tmHistory, entry],
    });
  },

  tmRun: () => {
    const state = get();
    if (state.tmRunning) return;
    const intervalId = window.setInterval(() => {
      const s = get();
      // Question runs stop at the grader's budget; the sandbox stops a
      // runaway machine at the UI cap.
      const cap = selectQuestionStepBudget(s) ?? UI_RUN_STEP_CAP;
      if (s.tmHalted || s.tmHistory.length >= cap) {
        s.tmPause();
        return;
      }
      s.tmStep();
    }, 300);
    set({ tmRunning: true, tmRunIntervalId: intervalId });
  },

  tmPause: () => {
    const state = get();
    if (state.tmRunIntervalId !== null) {
      window.clearInterval(state.tmRunIntervalId);
    }
    set({ tmRunning: false, tmRunIntervalId: null });
  },

  tmReset: () => {
    const state = get();
    if (state.tmRunIntervalId !== null) {
      window.clearInterval(state.tmRunIntervalId);
    }
    set({
      tmTape: state.tmInitialTape,
      tmCurrentStateId: null,
      tmTimeStep: 1,
      tmHistory: [],
      tmRunning: false,
      tmRunIntervalId: null,
      tmHalted: false,
    });
  },

  tmGlobalReset: () => {
    const state = get();
    if (state.tmRunIntervalId !== null) {
      window.clearInterval(state.tmRunIntervalId);
    }
    set({
      tmTape: { cells: {}, head: 0 },
      tmInitialTape: { cells: {}, head: 0 },
      tmCurrentStateId: null,
      tmTimeStep: 1,
      tmHistory: [],
      tmRunning: false,
      tmRunIntervalId: null,
      tmHalted: false,
    });
  },

  // ─── Turbot state ──────────────────────────────────────────────
  turbotState: { ...defaultArenaConfig().start },
  turbotBrainState: {},
  turbotHistory: [],
  turbotRunning: false,
  turbotRunIntervalId: null,
  turbotHalted: false,
  turbotStopReason: null,

  turbotStep: () => {
    const state = get();
    const { components, wires, turbotHistory, turbotHalted, turbotState } = state;
    if (turbotHalted) return;
    // A question run stops where the grader's does: the arena's maxSteps
    // (grader: hitStepLimit). The sandbox steps without bound.
    const budget = selectQuestionStepBudget(state);
    if (budget !== null && turbotHistory.length >= budget) {
      set({ turbotHalted: true, turbotStopReason: 'limit' });
      return;
    }

    const arena = selectTurbotArena(state);
    // On the first cycle, derive the brain state from the circuit as it is
    // NOW — the student normally builds the brain after the last reset, so a
    // reset-time snapshot would still point at a state that didn't exist yet.
    const turbotBrainState = turbotHistory.length === 0
      ? turbotBrainStart(state)
      : state.turbotBrainState;
    const innerMode = selectTurbotInnerMode(state);
    const sense = senseAheadSymbol(arena, turbotState);
    const result = runBrainStep(components, wires, innerMode, sense, turbotBrainState, selectTmNotation(state));
    if (!result) {
      // No matching transition. For a turbot TM this is the normal stop
      // (it has no stop output — textbook); the panel words it accordingly.
      set({ turbotHalted: true, turbotStopReason: 'brain' });
      return;
    }

    // Internal turbot-TM ops leave the pose unchanged (motor === null).
    const nextPose = result.motor !== null
      ? applyMotorCommand(arena, turbotState, result.motor)
      : turbotState;
    const entry: TurbotHistoryEntry = {
      t: turbotHistory.length + 1,
      kind: result.motor === null ? 'internal' : 'external',
      input: result.input,
      action: result.action,
      x: nextPose.x,
      y: nextPose.y,
      facing: nextPose.facing,
    };

    set({
      turbotState: nextPose,
      turbotBrainState: result.brainState,
      turbotHistory: [...turbotHistory, entry],
      ...(result.motor === 'stop' ? { turbotHalted: true, turbotStopReason: 'motor' as const } : {}),
    });
  },

  turbotRun: () => {
    const state = get();
    if (state.turbotRunning) return;
    const intervalId = window.setInterval(() => {
      const s = get();
      // Question runs stop at the arena's maxSteps (the grader's budget);
      // the sandbox stops a runaway turbot at the UI cap.
      const cap = selectQuestionStepBudget(s) ?? UI_RUN_STEP_CAP;
      if (s.turbotHalted || s.turbotHistory.length >= cap) {
        s.turbotPause();
        if (!s.turbotHalted) set({ turbotHalted: true, turbotStopReason: 'limit' });
        return;
      }
      s.turbotStep();
    }, 300);
    set({ turbotRunning: true, turbotRunIntervalId: intervalId });
  },

  turbotPause: () => {
    const state = get();
    if (state.turbotRunIntervalId !== null) {
      window.clearInterval(state.turbotRunIntervalId);
    }
    set({ turbotRunning: false, turbotRunIntervalId: null });
  },

  turbotReset: () => {
    const state = get();
    if (state.turbotRunIntervalId !== null) {
      window.clearInterval(state.turbotRunIntervalId);
    }
    const arena = selectTurbotArena(state);
    set({
      turbotState: { ...arena.start },
      turbotBrainState: turbotBrainStart(state),
      turbotHistory: [],
      turbotRunning: false,
      turbotRunIntervalId: null,
      turbotHalted: false,
      turbotStopReason: null,
    });
  },
  turbotCaseIndex: 0,

  // ─── Graded-case replay ────────────────────────────────────────
  loadedCase: null,

  loadCaseInput: (questionId, caseIndex) => {
    const state = get();
    const a = state.assignment;
    const q = a?.questions[state.currentQuestionIndex];
    // Only the open question's own cases, and only machine questions with a
    // case bank shape the replay understands (value cases, turbot arenas —
    // not perception frames, fill-in blanks or open prose).
    if (!a || !q || q.id !== questionId) return Promise.resolve();
    if (q.perception || q.fill_in || q.buildMode === 'open') return Promise.resolve();
    // The latest recorded submission's result — remotely the student's own
    // sanitized copy (present once grades are released): input, pass,
    // reason, separations; never the key.
    const record = state.submissions[a.id];
    const qr = record?.result?.questions.find((r) => r.questionId === q.id);
    if (!record || !qr) return Promise.resolve();
    // The machine this attempt was graded on, as the banner compares it.
    const graded = record.submission.answers.find((ans) => ans.questionId === q.id)?.circuit;
    const gradedKey = graded ? gradedMachineKey(graded) : null;

    let loaded: LoadedCase;
    if (q.buildMode === 'turbot') {
      // Dispatch on the literal buildMode FIRST: selectEffectiveMode would
      // answer a turbot's INNER mode (an FSM brain is not an FSM question).
      const recorded = qr.turbotCases?.[caseIndex];
      if (!recorded || !q.turbot_cases?.[caseIndex]) return Promise.resolve();
      loaded = { kind: 'turbot', questionId, caseIndex, attempt: record.attempt, gradedKey, recorded: { ...recorded } };
    } else {
      const c = qr.cases[caseIndex];
      if (!c || !questionLayout(q)) return Promise.resolve();
      // Results graded before a case carried its separations: the server
      // fills a student's own copy from its bank (sanitize.ts); locally the
      // bank is at hand — the same rule either way.
      const separations = recordedCaseSeparations(q, caseIndex, c);
      loaded = {
        kind: 'value',
        questionId,
        caseIndex,
        attempt: record.attempt,
        gradedKey,
        input: [...c.input],
        ...(separations ? { separations: [...separations] } : {}),
        recorded: { pass: c.pass, ...(c.reason !== undefined ? { reason: c.reason } : {}) },
      };
    }

    // A fresh run for the case: every run slice back to t=1 with its
    // interval stopped and the canvas's MEMs at 0 (the grader's start) —
    // whether this question was just opened or has been running all along
    // (a route to the open question skips the canvas swap, so nothing else
    // resets them). NOT the undo history: same canvas, and a stimulus is
    // not an edit (no pushHistory, no recordEdit).
    get().localStepClear();
    get().scGlobalReset();
    get().fsmGlobalReset();
    get().tmGlobalReset();
    set({ loadedCase: loaded, turbotCaseIndex: loaded.kind === 'turbot' ? caseIndex : 0 });
    get().turbotReset();

    // The grader's stimulus, then (deferred) the run to the grader's end.
    let runToEnd: () => void;
    if (loaded.kind === 'turbot') {
      runToEnd = () => {
        const budget = selectQuestionStepBudget(get()) ?? 0;
        // turbotStep stops itself at the budget ('limit'), one call past it.
        for (let i = 0; i <= budget && !get().turbotHalted; i++) get().turbotStep();
      };
    } else if (q.buildMode === 'CC') {
      const stim = caseStimulus(q, loaded.input);
      const bits = stim?.axis === 'space' ? stim.bits : [];
      // The engine's IN-label order (cc.ts sortByLabel) — the order
      // evaluateCCInputs binds the grader's wire vector in.
      const inputs = sortByLabel(get().components, 'IN');
      set({
        components: get().components.map((c) => {
          const i = inputs.indexOf(c);
          if (i < 0) return c;
          const v = bits[i] ?? 0;
          return { ...c, value: v, inputValues: [v] };
        }),
      });
      suppressAutoAddRow = false; // an explicit input: the I/O table records it
      runToEnd = () => get().evaluateCircuit();
    } else if (q.buildMode === 'SC' || q.buildMode === 'FSM') {
      const layout = questionLayout(q)!;
      const digits = codecTypedDigits(loaded.input, layout);
      if (q.buildMode === 'SC') {
        set({ scGlobalSequences: [{ inputStr: digits.join(''), outputStr: '' }] });
        get().loadScGlobalSequence(0);
      } else {
        get().setFsmInputSequence(digits);
      }
      const isSC = q.buildMode === 'SC';
      runToEnd = () => {
        // Exactly the codec window (scStep/fsmStep refuse past it anyway);
        // an FSM that halts mid-input stops there, as the grader's does.
        const win = selectCodecWindow(get()) ?? 0;
        for (let t = 0; t < win; t++) {
          if (isSC) get().scStep();
          else if (get().fsmHalted) break;
          else get().fsmStep();
        }
      };
    } else {
      // TM: the grader's initial tape (block separations included), then ONE
      // engine run to where the grader's stopped — a stepped fast-forward
      // would copy the history per step, and a TM run can take thousands.
      const tape = encodeTM(selectTmNotation(get()), loaded.input, loaded.separations);
      set({ tmTape: tape, tmInitialTape: tape });
      runToEnd = () => {
        const s = get();
        const run = evaluateTMSequence(
          s.components,
          s.wires,
          s.tmInitialTape,
          selectTmNotation(s),
          selectQuestionStepBudget(s) ?? DEFAULT_TM_MAX_STEPS,
        );
        set({
          tmTape: run.tape,
          tmHistory: run.history,
          tmTimeStep: run.steps + 1,
          tmHalted: run.halted,
          tmCurrentStateId: run.finalStateId,
        });
      };
    }

    // Deferred one task: the resets and the SC load above each queued a
    // canvas re-evaluation (evaluateCircuit), which would otherwise land on
    // top of the finished run and overwrite its display.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        // Superseded (a newer load, a canvas swap, a principal change): the
        // run slices are someone else's now.
        if (get().loadedCase === loaded) runToEnd();
        resolve();
      }, 0);
    });
  },

  // Dismissing the case also puts the Map back on the primary arena — the one
  // the question's own URL shows, and whose budget its runs stop at — with
  // the turbot re-seated at its start (the pose on the case's arena means
  // nothing on another).
  clearLoadedCase: () => {
    const onCaseArena = get().turbotCaseIndex !== 0;
    set({ loadedCase: null, turbotCaseIndex: 0 });
    if (onCaseArena) get().turbotReset();
  },

  // One aggregate reset for canvas-swapping navigation (question navigation
  // and sandbox tab/workbook entry). Delegates to the per-mode global resets
  // so each slice's field list lives in exactly one place; turbotReset runs
  // last because it re-derives brain state from the (possibly just-remapped)
  // live components.
  resetAllSimState: () => {
    get().scGlobalReset();
    get().fsmGlobalReset();
    get().tmGlobalReset();
    // A loaded graded case belongs to the canvas it was loaded on, and so
    // does the arena it picked — cleared BEFORE turbotReset, which re-seats
    // the turbot on the (now primary) arena's start.
    set({ loadedCase: null, turbotCaseIndex: 0 });
    get().turbotReset();
    // The armed palette tool is canvas-scoped too: an AND armed on a CC
    // question must not survive into the next question's canvas and drop a
    // gate on the first click there. So is the history: undo writes its
    // snapshot into the CURRENT canvas, so a stack carried across a swap
    // would restore the previous question (or sandbox tab) over this one.
    set({ selectedTool: null, undoStack: [], redoStack: [] });
  },

  resetForPrincipal: (email) => {
    if (principalReported && email === currentPrincipal) return;
    // The leaving principal's pending edits land under ITS keys (the sandbox
    // key and, remotely, the crash journal read currentPrincipal and the
    // session cache — both still the leaving person's here).
    saveForLeavingPrincipal();
    // A sandbox on screen stays on screen — the arriving person's own. (A
    // sign-out from the menu goes Home first, so this is a 401, a session
    // restore resolving, or a sign-in from a sandbox left open behind the
    // sign-in screen; routing may re-apply the URL after, which is harmless.)
    const s = get();
    const keepSandboxOpen = principalReported && s.workbookOpen && s.assignment === null;
    // Stops any run interval before the fields holding their ids are wiped.
    get().resetAllSimState();
    // In-flight opens and submission hydrations belong to the leaving
    // principal: their resolves must apply nothing.
    openAssignmentSeq++;
    principalEpoch++;
    currentPrincipal = email;
    principalReported = true;
    // The clipboard lives in the provenance seam, not in store state: empty
    // it here too, and hand the seam the arriving principal. So do the mint
    // keys (task 034): they are the leaving person's; the arriving person's
    // come with their own opens. (questionTrace resets with the store.)
    resetClipboard(email);
    clearMintKeys();
    lastEditAt = 0;
    recentTexts.clear();
    set({ ...useStore.getInitialState(), ...readSandbox(email) });
    if (keepSandboxOpen) get().enterSandbox();
    // The reset's own set() armed the autosave, and so did entering the
    // sandbox; nothing here is an edit.
    cancelPendingAutoSave();
    setTimeout(() => get().evaluateCircuit(), 0);
  },

  toggleStateKind: (id) => {
    const state = get();
    const comp = state.components.find((c) => c.id === id);
    if (!comp || comp.type !== 'STATE' || isCurrentQuestionLocked(state)) return;
    state.pushHistory();
    const newKind = stateKindOf(comp) === 'external' ? 'internal' : 'external';
    // The two kinds' label grammars are disjoint, so outgoing transitions
    // are re-labelled to the new kind's default rather than left invalid.
    const defaultLabel = (newKind === 'external'
      ? turbotExternalNotation
      : turbotInternalNotation(selectTmNotation(state))).defaultLabel;
    set({
      components: state.components.map((c) =>
        c.id === id ? { ...c, stateKind: newKind } : c
      ),
      wires: state.wires.map((w) =>
        w.sourceComponentId === id && w.transitionLabel != null
          ? { ...w, transitionLabel: defaultLabel }
          : w
      ),
    });
  },
}));

// Expose for debugging — DEV BUILDS ONLY. In production one console line on
// window.__store could set any circuit, past every lock and the provenance
// seam (task 033). `?.`: import.meta.env is undefined under tsx (the harness).
if (import.meta.env?.DEV === true && typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__store = useStore;
}

// ─── Auto-save to localStorage ─────────────────────────────────────
// The sandbox autosaves per PERSON on this browser (reset law 2 loads it):
// `making-minds-autosave:<email>` for a signed-in user, one shared
// `making-minds-autosave:visitor` for visitors. The bare prefix is the legacy
// one-per-browser key, adopted as the visitor sandbox (adoptLegacySandbox).
// sandboxKey is the ONE place the key is spelled.
const SANDBOX_KEY_PREFIX = 'making-minds-autosave';
const AUTO_SAVE_DELAY = 1500; // ms debounce
// …but never put off longer than this after the first unsaved change: a save
// lands at least once per burst of editing, so the server's per-save history
// (task 034, the "appeared between two saves" check) has the resolution to
// tell a burst from a steady build — and a long unbroken session is not all
// riding on one debounce.
export const AUTO_SAVE_MAX_WAIT = 10_000;
// When the oldest change not yet in a save was made (null: none pending).
let autoSavePendingSince: number | null = null;

/** The debounce for a change made at `now`, when the oldest unsaved change
 *  was made at `pendingSince`: the usual pause, cut short by the max wait. */
export function autoSaveDelay(pendingSince: number, now: number): number {
  return Math.max(0, Math.min(AUTO_SAVE_DELAY, pendingSince + AUTO_SAVE_MAX_WAIT - now));
}

function sandboxKey(principal: string | null): string {
  // Lowercased like the crash journal's keys (storage/journal.ts).
  return `${SANDBOX_KEY_PREFIX}:${principal ? principal.toLowerCase() : 'visitor'}`;
}

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

function getAutoSaveData() {
  const s = useStore.getState();
  // Use the workbook export format for auto-save
  // Save current tab circuit into tabCircuits
  const allTabCircuits = new Map(s.tabCircuits);
  allTabCircuits.set(s.activeTabId, {
    components: s.components,
    wires: s.wires,
    boxes: s.boxes,
    confirmedBoxes: s.confirmedBoxLibrary,
  });
  return {
    formatVersion: 2,
    workbookOpen: s.workbookOpen,
    workbookTitle: s.workbookTitle,
    tabs: s.tabs,
    activeTabId: s.activeTabId,
    tabCircuits: Object.fromEntries(allTabCircuits),
    viewPreferences: {
      zoom: s.zoom,
      panX: s.panX,
      panY: s.panY,
      showGrid: s.showGrid,
      showWireValues: s.showWireValues,
      snapToAlign: s.snapToAlign,
      repSystem: s.repSystem,
    },
  };
}

/** Is the currently-open question marked done? Outside an assignment (the
 *  sandbox has no "done" concept) this is always false. Read at the top of
 *  every action that would edit a question's persisted answer state, so a
 *  student can't accidentally change work they've locked. */
function isCurrentQuestionLocked(state: AppState): boolean {
  return selectQuestionLocked(state);
}

/** A turbot brain's state before its first cycle, from the canvas as it is
 *  now. Inside a question the brain starts from rest like the grader's
 *  (engine/caseRun.ts gradingCircuit: every MEM at 0), whatever a MEM
 *  override left on the canvas; the sandbox seeds from the canvas as-is. */
function turbotBrainStart(state: AppState): BrainState {
  const components = state.assignment
    ? gradingCircuit({ components: state.components, wires: state.wires }).components
    : state.components;
  return initialBrainState(components, selectTurbotInnerMode(state));
}

/** One question's canvas as it was actually SUBMITTED, for the frozen
 *  read-only view (item 3) — never the live in-progress work. `boxes` (the
 *  draw-a-rectangle-around-existing-gates overlay) isn't captured by
 *  buildSubmission, so a frozen view of a boxed selection renders/simulates
 *  correctly but loses the box's visual rectangle; cosmetic, not a
 *  correctness gap (the underlying components/wires are all there). */
function frozenQuestionCircuit(record: SubmissionRecord, questionId: number): QuestionCircuit {
  const answer = record.submission.answers.find((a) => a.questionId === questionId);
  if (!answer) return emptyQuestionCircuit();
  return {
    components: answer.circuit?.components ?? [],
    wires: answer.circuit?.wires ?? [],
    boxes: [],
    responseText: answer.responseText,
    fillAnswers: answer.fillAnswers,
    ...(answer.provenance ? { provenance: answer.provenance } : {}),
  };
}

// Persist the open assignment's work (syncing the live question first) via the
// storage seam, keyed by assignment id — separate from the sandbox blob.
/**
 * The assignment's per-question circuits with the live canvas folded into the
 * current question (the same save step as switchQuestion/goHome), so callers see
 * the latest in-progress work for the open question. Caller must ensure an
 * assignment is active.
 */
function syncedQuestionCircuits(s: AppState): Map<number, QuestionCircuit> {
  const circuits = new Map(s.questionCircuits);
  const q = s.assignment?.questions[s.currentQuestionIndex];
  if (q) circuits.set(q.id, foldLiveQuestion(s, q.id));
  return circuits;
}

/** The open assignment's persistable workbook state (live canvas folded in). */
function snapshotAssignmentState(s: AppState): AssignmentState {
  return {
    currentQuestionIndex: s.currentQuestionIndex,
    questionCircuits: Object.fromEntries(syncedQuestionCircuits(s)) as Record<
      number,
      QuestionCircuit
    >,
    // One library for the whole assignment (notes/pset_updates.md item 8), not
    // one per question.
    boxLibrary: s.confirmedBoxLibrary,
  };
}

// Persist the open assignment's workbook through the WorkbookStore seam.
// The state snapshot and the seam call happen synchronously (before the first
// suspension), so unload-time flushes still land with the local store; remote
// unload flushes additionally pass `keepalive` so the PUT can outlive the
// page. Returns the saved assignment's id (null when no assignment is open).
async function saveAssignmentState(
  keepalive = false,
): Promise<{ id: string; state: AssignmentState } | null> {
  const s = useStore.getState();
  const a = s.assignment;
  if (!a) return null;
  const state = snapshotAssignmentState(s);
  await workbookStore.saveAssignmentState(a.id, state, { keepalive });
  return { id: a.id, state };
}

// ── Remote-mode crash buffer (storage/journal.ts) ──────────────────
// Synchronously buffer the open assignment's unsaved state under the
// logged-in user's journal key. Called on unload-time flushes and on failed
// remote saves; a no-op in local mode, when nothing is unsaved, or with no
// assignment open. Cleared by the next confirmed seam save; replayed by the
// next openAssignment (reconcileJournal).
function writeOpenAssignmentJournal(): void {
  if (backendMode !== 'remote') return;
  const s = useStore.getState();
  if (!s.assignment || s.autoSaveStatus === 'saved') return;
  const email = getSessionUser()?.email;
  if (!email) return;
  writeJournal(email, s.assignment.id, snapshotAssignmentState(s));
}

// Single-flight guard: at most one save is in the seam at a time; a save
// requested while one is in flight reruns once after it settles (trailing
// edge), so the latest state always lands and writes can't interleave.
let autoSaveInFlight = false;
let autoSaveTrailing = false;

// Remote-mode retry backoff: a failed seam save schedules a retry (through
// the normal debounce slot, so a fresh edit simply supersedes it), doubling
// the delay up to a cap; any success resets it.
const AUTO_SAVE_BACKOFF_INITIAL = 2000;
const AUTO_SAVE_BACKOFF_MAX = 30000;
let autoSaveBackoff = AUTO_SAVE_BACKOFF_INITIAL;

async function performAutoSave(keepalive = false): Promise<void> {
  // This save (or the trailing rerun it queues) takes everything changed so
  // far; a change from here on starts a new max-wait window.
  autoSavePendingSince = null;
  if (autoSaveInFlight) {
    autoSaveTrailing = true;
    return;
  }
  autoSaveInFlight = true;
  // Whose save this is, read BEFORE the seam await: a principal change while
  // it is in flight must not touch the next person's journal or save chip.
  const epoch = principalEpoch;
  const email = getSessionUser()?.email;
  try {
    useStore.setState({ autoSaveStatus: 'saving' });
    let saved: { id: string; state: AssignmentState } | null = null;
    if (useStore.getState().assignment) {
      saved = await saveAssignmentState(keepalive);
    } else {
      localStorage.setItem(sandboxKey(currentPrincipal), JSON.stringify(getAutoSaveData()));
    }
    if (epoch !== principalEpoch) {
      // The principal changed mid-save, and the change journaled the leaving
      // person's work (saveForLeavingPrincipal). This confirmed save makes
      // that journal obsolete only if it holds exactly what was just
      // confirmed — no edit came after this save started. A NEWER journal is
      // kept for their next open to replay. Nothing else here is theirs any
      // more (the save chip and the retry belong to the next person).
      if (backendMode === 'remote' && saved && email) {
        clearJournalIfHolds(email, saved.id, saved.state);
      }
      return;
    }
    useStore.setState({ autoSaveStatus: 'saved' });
    autoSaveBackoff = AUTO_SAVE_BACKOFF_INITIAL;
    if (backendMode === 'remote' && saved) {
      // Confirmed on the server — the crash buffer for this assignment is
      // now obsolete (a newer edit's own flush would rewrite it anyway).
      if (email) clearJournal(email, saved.id);
    }
  } catch {
    // As above: the previous principal's failed save is already journaled.
    if (epoch !== principalEpoch) return;
    if (backendMode === 'remote') {
      // Server unreachable (or the write failed): buffer the state locally,
      // show the error chip, and retry with backoff. The student's work is
      // in the journal even if the tab dies before a retry lands.
      useStore.setState({ autoSaveStatus: 'error' });
      writeOpenAssignmentJournal();
      if (autoSaveTimer) clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(() => {
        autoSaveTimer = null;
        void performAutoSave();
      }, autoSaveBackoff);
      autoSaveBackoff = Math.min(autoSaveBackoff * 2, AUTO_SAVE_BACKOFF_MAX);
    } else {
      // Local mode: localStorage full or unavailable — silent fail (unchanged
      // prototype behavior; same residual-loss class as the docs note).
      useStore.setState({ autoSaveStatus: 'saved' });
    }
  } finally {
    autoSaveInFlight = false;
    if (autoSaveTrailing) {
      autoSaveTrailing = false;
      void performAutoSave();
    }
  }
}

// Subscribe to state changes that should trigger auto-save. Routes by context:
// assignment mode → per-assignment storage; sandbox mode → the sandbox blob.
useStore.subscribe((state, prev) => {
  // Frozen (notes/todos.md item 3): the canvas is showing the submission,
  // not live work-in-progress, so nothing here should ever overwrite the
  // real saved workbook. (Mutations are already refused at the source —
  // isCurrentQuestionLocked — so in practice nothing changes anyway; this is
  // the belt on top of that suspender.)
  if (selectAssignmentFrozen(state)) return;
  const canvasChanged =
    state.components !== prev.components ||
    state.wires !== prev.wires ||
    state.boxes !== prev.boxes ||
    state.confirmedBoxLibrary !== prev.confirmedBoxLibrary ||
    // the open-question text panel is that mode's "canvas"
    state.openResponse !== prev.openResponse ||
    state.fillAnswers !== prev.fillAnswers;

  let changed: boolean;
  if (state.assignment) {
    changed =
      canvasChanged ||
      state.currentQuestionIndex !== prev.currentQuestionIndex ||
      state.questionCircuits !== prev.questionCircuits ||
      state.assignment !== prev.assignment;
  } else {
    changed =
      canvasChanged ||
      state.tabs !== prev.tabs ||
      state.activeTabId !== prev.activeTabId ||
      state.buildMode !== prev.buildMode ||
      state.tabCircuits !== prev.tabCircuits ||
      state.workbookOpen !== prev.workbookOpen ||
      state.workbookTitle !== prev.workbookTitle;
  }
  if (!changed) return;

  useStore.setState({ autoSaveStatus: 'unsaved' });
  const now = Date.now();
  if (autoSavePendingSince === null) autoSavePendingSince = now;
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    void performAutoSave();
  }, autoSaveDelay(autoSavePendingSince, now));
});

// Flush a pending debounced save immediately — e.g. when the tab is closing or
// hidden — so the most recent edit (even just moving a component) is persisted
// rather than lost in the debounce window.
//
// Unload paths (`journal: true`) additionally write the remote crash buffer
// FIRST — synchronously, so it lands even if the tab dies mid-teardown and
// regardless of whether the debounce timer is armed (an already-in-flight
// remote save can die with the tab too). `keepalive: true` (beforeunload/
// pagehide only; a merely-hidden tab keeps a normal fetch) lets the remote
// PUT outlive the page — best-effort at ~64KB, the journal is the safety net.
function flushAutoSave(opts?: { journal?: boolean; keepalive?: boolean }) {
  if (opts?.journal) writeOpenAssignmentJournal();
  if (!autoSaveTimer) return;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = null;
  // Fire-and-forget: with the local seam the write itself is synchronous
  // (before the first suspension), so it lands even mid-unload.
  void performAutoSave(opts?.keepalive === true);
}

// Reset law 2's save step: land the LEAVING principal's unsaved work under
// their keys before the reset wipes it from memory. Never left to the
// debounced save or its trailing rerun — the reset cancels both
// (cancelPendingAutoSave), and a save already in flight would otherwise
// swallow the request. "Unsaved" = a debounced save armed, a trailing rerun
// queued, or the chip not 'saved'.
// - The sandbox (no assignment in memory): one synchronous localStorage write,
//   made here directly. What is in memory is this person's by construction
//   (the last reset loaded it for them).
// - An open assignment (never a frozen one — its canvas is the submission):
//   locally, the seam's synchronous write, directly. Remotely, the crash
//   journal first (synchronous, so it holds even if the PUT fails or the tab
//   dies), then one PUT through the single-flight path: with a save already in
//   flight a second PUT could land before it, so the journal alone carries the
//   newer work to their next open. A confirmed PUT clears the journal only
//   while it holds exactly what was confirmed (performAutoSave), so a sign-out
//   never leaves a stale buffer to replay over work done later on another
//   device.
function saveForLeavingPrincipal(): void {
  if (!principalReported) return; // boot: nothing in memory is anyone's yet
  const s = useStore.getState();
  const unsaved = autoSaveTimer != null || autoSaveTrailing || s.autoSaveStatus !== 'saved';
  if (!unsaved) return;
  const a = s.assignment;
  if (!a) {
    try {
      localStorage.setItem(sandboxKey(currentPrincipal), JSON.stringify(getAutoSaveData()));
    } catch {
      // storage full/unavailable — the same silent fail as the autosave
    }
    return;
  }
  if (selectAssignmentFrozen(s)) return;
  if (backendMode === 'local') {
    void saveAssignmentState().catch(() => {});
    return;
  }
  const email = getSessionUser()?.email;
  if (email) writeJournal(email, a.id, snapshotAssignmentState(s));
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = null;
  void performAutoSave();
}

// Drop the debounced save armed by resetForPrincipal's own set() (loading a
// person's sandbox is not an edit), and any queued trailing rerun or retry
// backoff left over from the previous principal.
function cancelPendingAutoSave() {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = null;
  autoSavePendingSince = null;
  autoSaveTrailing = false;
  autoSaveBackoff = AUTO_SAVE_BACKOFF_INITIAL;
  useStore.setState({ autoSaveStatus: 'saved' });
}
window.addEventListener('beforeunload', () => flushAutoSave({ journal: true, keepalive: true }));
window.addEventListener('pagehide', () => flushAutoSave({ journal: true, keepalive: true }));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushAutoSave({ journal: true });
});

/**
 * Signature of the circuit's *structure* — component ids/types (plus the fields
 * that affect evaluation) and wire connections — but NOT positions or runtime
 * values. Two layouts that differ only by where things sit hash the same.
 */
function connectivitySignature(components: CircuitComponent[], wires: Wire[]): string {
  const comps = components
    .map((c) =>
      [
        c.id,
        c.type,
        c.memDirection ?? '',
        c.boxedCircuitId ?? '',
        c.internalCircuit
          ? `${c.internalCircuit.components.length}/${c.internalCircuit.wires.length}`
          : '',
      ].join(':'),
    )
    .sort()
    .join('|');
  const ws = wires
    .map(
      (w) =>
        `${w.sourceComponentId}.${w.sourcePortId}->${w.targetComponentId}.${w.targetPortId}:${w.transitionLabel ?? ''}`,
    )
    .sort()
    .join('|');
  return comps + '#' + ws;
}

// Wipe the cached I/O evaluation when the circuit's connectivity/components
// change — but NOT when elements are merely moved, since position changes don't
// alter the signature. Input values are kept (surviving input nodes retain their
// values, so the student needn't re-enter them); instead we set suppressAutoAddRow
// so the re-evaluation an edit triggers does NOT re-populate the selected row.
// The table stays empty until the user next acts on an input.
let lastConnSig: string | null = null;
useStore.subscribe((state) => {
  const sig = connectivitySignature(state.components, state.wires);
  if (lastConnSig === null) {
    lastConnSig = sig;
    return;
  }
  if (sig === lastConnSig) return;
  lastConnSig = sig;

  suppressAutoAddRow = true;
  if (state.tableRows.length > 0) useStore.getState().clearTableRows();
  if (state.localStepActive) useStore.getState().localStepClear();
});

// ─── The sandbox's per-person load (reset law 2) ───────────────────
// Nothing loads at module import: which sandbox appears depends on who is
// here, so resetForPrincipal reads it (readSandbox) whenever that changes.
type TabCircuitData = { components: CircuitComponent[]; wires: Wire[]; boxes: BoxDefinition[]; confirmedBoxes: ConfirmedBoxDef[] };

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** The legacy one-per-browser sandbox becomes the visitor sandbox, once. If a
 *  visitor sandbox already exists the legacy blob is left untouched — never
 *  overwrite, never delete what can't be placed. */
function adoptLegacySandbox(): void {
  try {
    const legacy = localStorage.getItem(SANDBOX_KEY_PREFIX);
    if (legacy == null || localStorage.getItem(sandboxKey(null)) != null) return;
    localStorage.setItem(sandboxKey(null), legacy);
    localStorage.removeItem(SANDBOX_KEY_PREFIX);
  } catch {
    // storage unavailable — nothing to adopt
  }
}

/** Does a stored sandbox blob hold anything the person made — anything a
 *  fresh sandbox (the store's initial state) doesn't? A component, box or
 *  saved box on any sheet, a second tab, a renamed or re-moded tab, a turbot
 *  tab's arena, a retitled workbook. Only an absent, unreadable or PRISTINE
 *  blob counts as "no sandbox yet": a principal change and every Home visit
 *  autosave one even when nothing was made, so a bare key-exists test would
 *  never let a returning user receive a visitor's work — and anything short of
 *  pristine is someone's sandbox, never overwritten. */
function sandboxHasWork(raw: string | null): boolean {
  if (!raw) return false;
  let data: {
    workbookTitle?: string;
    tabs?: Array<Partial<SandboxTab> & { name?: string }>;
    tabCircuits?: Record<string, Partial<TabCircuitData>>;
    components?: unknown[];
    boxes?: unknown[];
  };
  try {
    data = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!data || typeof data !== 'object') return false;
  const sheetHasWork = (c: Partial<TabCircuitData> | undefined) =>
    (c?.components?.length ?? 0) > 0 ||
    (c?.boxes?.length ?? 0) > 0 ||
    (c?.confirmedBoxes?.length ?? 0) > 0;
  const fresh = useStore.getInitialState();
  const freshTab = fresh.tabs[0];
  const tabs = Array.isArray(data.tabs) ? data.tabs : [];
  return (
    Object.values(data.tabCircuits ?? {}).some(sheetHasWork) ||
    // the legacy flat format's single canvas
    (data.components?.length ?? 0) > 0 ||
    (data.boxes?.length ?? 0) > 0 ||
    (data.workbookTitle != null && data.workbookTitle !== fresh.workbookTitle) ||
    tabs.length > 1 ||
    tabs.some(
      (t) =>
        (t.title ?? t.name ?? freshTab.title) !== freshTab.title ||
        (t.buildMode ?? freshTab.buildMode) !== freshTab.buildMode ||
        (t.activeTask ?? freshTab.activeTask) !== freshTab.activeTask ||
        t.arena != null ||
        t.innerMode != null,
    )
  );
}

/** The arriving principal's sandbox as a store patch ({} when there is none).
 *  A signed-in person with no sandbox here yet (none, or a pristine one —
 *  sandboxHasWork) receives the visitor sandbox — MOVED, so a visitor who
 *  signs in keeps their work and the next visitor doesn't see it. Nothing
 *  is ever deleted otherwise: a signed-out person's sandbox just waits under
 *  their key. */
function readSandbox(principal: string | null): Partial<AppState> {
  adoptLegacySandbox();
  if (principal != null) {
    const visitors = readStored(sandboxKey(null));
    if (!sandboxHasWork(readStored(sandboxKey(principal))) && sandboxHasWork(visitors)) {
      try {
        localStorage.setItem(sandboxKey(principal), visitors!);
        localStorage.removeItem(sandboxKey(null));
      } catch {
        // storage unavailable — they start from their own (empty) sandbox
      }
    }
  }
  return sandboxPatchFrom(readStored(sandboxKey(principal)));
}

/** Parse one stored sandbox blob into a store patch; {} when absent or
 *  corrupt (stay on the welcome state, workbookOpen false). */
function sandboxPatchFrom(raw: string | null): Partial<AppState> {
  if (!raw) return {};
  try {
    const data = JSON.parse(raw);

    if (data.formatVersion === 2) {
      // New workbook auto-save format
      const tabCircuits = new Map<string, TabCircuitData>();
      if (data.tabCircuits) {
        for (const [k, v] of Object.entries(data.tabCircuits)) {
          const c = v as TabCircuitData;
          tabCircuits.set(k, { ...c, confirmedBoxes: c.confirmedBoxes || [] });
        }
      }
      // Ensure tabs have activeTask (migration for old auto-saves) and that
      // turbot tabs carry a brain kind + arena (belt-and-braces: addTab always
      // seeds them, so this only fires on hand-edited/truncated saves).
      const tabs: SandboxTab[] = (data.tabs || []).map((t: SandboxTab) => ({
        ...t,
        activeTask: t.activeTask || 'arithmetic',
        ...(t.buildMode === 'turbot'
          ? { innerMode: t.innerMode ?? 'CC', arena: t.arena ?? sandboxDefaultArena() }
          : {}),
      }));
      const activeId = data.activeTabId || tabs[0]?.id || defaultTabId;
      const activeCircuit = tabCircuits.get(activeId) || { components: [], wires: [], boxes: [], confirmedBoxes: [] };
      const activeTab = tabs.find((t: { id: string }) => t.id === activeId);
      const vp = data.viewPreferences || {};

      return {
        workbookOpen: false, // home-first: restore the sandbox into memory but land on Home
        workbookTitle: data.workbookTitle || 'Untitled Workbook',
        tabs,
        activeTabId: activeId,
        tabCircuits,
        components: activeCircuit.components || [],
        wires: activeCircuit.wires || [],
        boxes: activeCircuit.boxes || [],
        confirmedBoxLibrary: activeCircuit.confirmedBoxes || [],
        buildMode: activeTab?.buildMode || 'CC',
        activeTask: activeTab?.activeTask || 'arithmetic',
        repSystem: vp.repSystem || 'binary',
        zoom: vp.zoom ?? 1,
        panX: vp.panX ?? 0,
        panY: vp.panY ?? 0,
        showGrid: vp.showGrid ?? true,
        showWireValues: vp.showWireValues ?? true,
        snapToAlign: vp.snapToAlign ?? true,
      };
    } else if (data.tabs) {
      // Legacy auto-save format (has tabs but no formatVersion)
      const tabCircuits = new Map<string, TabCircuitData>();
      if (data.tabCircuits) {
        for (const [k, v] of Object.entries(data.tabCircuits)) {
          const c = v as TabCircuitData;
          tabCircuits.set(k, { ...c, confirmedBoxes: c.confirmedBoxes || [] });
        }
      }
      const tabs = (data.tabs || []).map((t: { id: string; title?: string; name?: string; buildMode?: BuildMode }) => ({
        id: t.id,
        title: t.title || t.name || 'Circuit',
        buildMode: t.buildMode || 'CC',
        activeTask: 'arithmetic' as ActiveTask,
      }));
      return {
        workbookOpen: false, // home-first: restore the sandbox but land on Home
        workbookTitle: 'Untitled Workbook',
        buildMode: data.buildMode || 'CC',
        repSystem: data.repSystem || 'binary',
        components: data.components || [],
        wires: data.wires || [],
        boxes: data.boxes || [],
        tabs,
        activeTabId: data.activeTabId || tabs[0]?.id || defaultTabId,
        ...(tabCircuits.size > 0 ? { tabCircuits } : {}),
      };
    }
  } catch {
    // Corrupted data — ignore, stay on welcome screen
  }
  return {};
}
