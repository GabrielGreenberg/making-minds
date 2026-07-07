// Core types for the Making Minds platform

// 'open' is the one non-machine mode: a free-text ("open question") answer with
// no canvas, no engine, and no autograding — reviewed manually by the
// instructor (or, later, by an LLM). Its student answer travels as
// `responseText`, not a circuit, and the grader marks it `pending`.
export type BuildMode = 'CC' | 'SC' | 'FSM' | 'turbot' | 'TM' | 'open';
export type RepSystem = 'tally' | 'binary' | 'plus';
export type DisplayMode = 'IO' | 'AV';
export type Scope = 'local' | 'global';
export type ActiveTask = 'arithmetic' | 'turbot' | 'navigation' | 'perception';

export interface Port {
  id: string;
  label: string;
  side: 'left' | 'right';
  index: number; // vertical order on that side
}

export type ComponentType =
  | 'INPUT'
  | 'OUTPUT'
  | 'NOT'
  | 'AND'
  | 'OR'
  | 'XOR'
  | 'HA'
  | 'MEM'
  | 'BOXED'
  | 'STATE';

export interface CircuitComponent {
  id: string;
  type: ComponentType;
  x: number;
  y: number;
  label: string;
  ports: Port[];
  value?: number; // current output value for inputs
  inputValues?: (number | undefined)[]; // for inputs: the value (0 or 1), undefined = blank
  storedValue?: number; // for MEM blocks
  memDirection?: 'left-to-right' | 'right-to-left'; // for MEM: undefined = undecided
  rotation?: number; // 0, 90, 180, 270 degrees clockwise
  boxedCircuitId?: string; // for BOXED type
  internalCircuit?: CircuitData; // for BOXED type - the encapsulated circuit
  // Turbot-TM STATE nodes only (textbook "Turbots: Operation"): an internal
  // state (circle) operates on the tape, an external state (square) senses
  // and moves in the arena. Absent = internal. Meaningless outside turbot TM.
  stateKind?: 'internal' | 'external';
}

export interface Wire {
  id: string;
  sourceComponentId: string;
  sourcePortId: string;
  targetComponentId: string;
  targetPortId: string;
  value: number; // 0 or 1
  waypoints?: { x: number; y: number }[];
  manualSegments?: WireManualSegment[]; // manual overrides for wire segments
  // FSM transition fields
  transitionLabel?: string; // e.g., "0:1" meaning "input 0, output 1"
  fsmControlPt?: { x: number; y: number }; // manual curve control point
}

// Manual wire segment override: which segment index was moved to what position
export interface WireManualSegment {
  segmentIndex: number; // index into the computed path segments
  offset: number; // displacement from computed position
  axis: 'x' | 'y'; // which axis was shifted
}

export interface CircuitData {
  components: CircuitComponent[];
  wires: Wire[];
}

export interface ProjectData {
  metadata: {
    title: string;
    author: string;
    date: string;
    buildType: BuildMode;
  };
  circuit: CircuitData;
  repSystem: RepSystem;
}

// ─── Assignments ─────────────────────────────────────────────────
// One unified model for graded, multi-question assignments. (Replaces the
// earlier split between "Homework" — which carried grading test vectors — and
// "Problem Set" — which carried per-question build modes and statements.)

// ─── Question specification (instructor authoring) ───────────────
// Captures everything needed to generate `test_cases` and to display a question
// in the instructor UI. When present on an AssignmentQuestion, the system
// regenerates `test_cases` from it at save time (engine/testVectorGen.ts).
//
// The codec reads `cc_spec` for grading too — it is the source of the per-group
// **widths** the codec needs to lay values out on each axis (space/time). The
// single representation system is on the question (`representation`), not per
// group. `width` is wires/group on the space axis (CC), steps/group on the time
// axis (SC/FSM). Named `cc_spec` for historical reasons; it serves all modes.

export interface CCInputGroup {
  name: string;            // variable name used in the formula, e.g. "x"
  width: number;           // bit width of this group (wires for CC; time steps for SC/FSM)
  max_value?: number;      // CC authoring: largest input value tested (width is derived from it)
}

export interface CCOutputGroup {
  name: string;            // label shown to students, e.g. "y"
  width: number;           // bit width of this group (wires for CC; time steps for SC/FSM)
  formula: string;         // affine expression over input group names, e.g. "2 * x"
}

export interface CCSpec {
  inputs: CCInputGroup[];
  outputs: CCOutputGroup[];
}

/**
 * A machine-agnostic, value-based grading case (the codec model — see
 * CLAUDE_KB/pipeline/codec.md). `inputs` is the list of input *values* (one per
 * input group, ≥ 1 for multi-input functions); `outputs` is `[f(x)]`. Bits/tape
 * encodings exist only transiently at grade time, never in the bank.
 *
 * Every mode is graded against `test_cases` through the codec pipeline
 * (engine/grader.ts): the codec turns these values into the right bits/tape per
 * axis at grade time. This supersedes the old bit-based `test_vectors`.
 */
export interface TestCase {
  inputs: number[];
  outputs: number[];
  /** Optional tape-layout hint (TM/tape axis only; other axes ignore it):
   *  background gap AFTER each input block except the last — for two inputs,
   *  one entry. Absent = the codec's default single-cell separator. Lets a
   *  bank test robustness to arbitrary block separation (e.g. HW5 P4: "do not
   *  assume the blocks are separated by exactly one empty cell"). */
  separations?: number[];
}

export interface AssignmentQuestion {
  id: number;                  // stable id; referenced by the grader and submissions
  label: string;               // e.g. "Problem 1", "Q2a"
  statement: string;           // problem text shown above the canvas
  buildMode: BuildMode;        // canvas mode for this question (CC, SC, FSM, turbot, …)
  representation: RepSystem;   // authoritative for grading (binary | tally; TM notation: tally→unary)
  allowed_components?: ComponentType[];
  /** TM-mode acceptance strictness: when true, a run is accepted only if the
   *  head halts on the output block's rightmost cell (standard position —
   *  tmCodec `AcceptOptions`). Absent/false = position-agnostic (default). */
  requireStandardHaltPosition?: boolean;
  cc_spec?: CCSpec;            // authoring spec; source of group widths + generates test_cases at save
  test_cases?: TestCase[];     // value-based grading cases (one bank, all modes — see TestCase)
  // Turbot-only fields (buildMode === 'turbot'). A turbot question's "circuit"
  // is a CC/SC/FSM/TM brain wired to a fixed 1-bit sensor / 2-bit motor
  // interface; innerMode picks which editor authors that brain, and
  // turbot_cases carries the arena(s) + success criteria it's graded against
  // (hand-authored, not enumerated — see engine/turbot.ts + grader.ts).
  innerMode?: BuildMode;
  turbot_cases?: TurbotTestCase[];
  // Perception-only fields (buildMode CC or SC). A perception question grades
  // at the BIT level, not through the value codec: the input is a raw array of
  // stimulations across `width` input wires (an SC gets one frame per time
  // step) and the single output bit classifies it. `perception` carries the
  // authored rule; `perception_cases` the generated bit-level bank (see
  // engine/perception.ts + gradePerception in grader.ts).
  perception?: PerceptionSpec;
  perception_cases?: PerceptionTestCase[];
  notes?: string;
}

/**
 * Display label for a question's mode chip. A turbot question names its inner
 * machine too ("turbot - TM"), since the brain's mode is what the student
 * actually edits; a perception question flags its bit-level task.
 */
export function questionModeLabel(
  q: Pick<AssignmentQuestion, 'buildMode' | 'innerMode' | 'perception'>,
): string {
  if (q.buildMode === 'turbot') return `turbot - ${q.innerMode ?? 'CC'}`;
  return q.perception ? `${q.buildMode} - perception` : q.buildMode;
}

export interface AssignmentData {
  id: string;                  // stable slug (e.g. "cc-basics"); keys the registry/persistence
  title: string;
  questions: AssignmentQuestion[];
}

/**
 * A student's gradeable submission. Pure/serializable — produced by the app's
 * submission export and consumed by the grader (in-app or the CLI). Each answer
 * pairs a question (by AssignmentQuestion.id) with the circuit the student built.
 */
export interface SubmissionData {
  assignmentTitle: string;
  student?: string;        // free-form identity; auth-agnostic, falls back to filename
  submittedAt: string;     // ISO timestamp
  // Open questions carry their free-text answer in `responseText` (their
  // circuit is empty); machine questions carry only the circuit.
  answers: { questionId: number; circuit: CircuitData; responseText?: string }[];
}

// ─── Autograding results ─────────────────────────────────────────
// Produced by the grader (engine/grader.ts) and persisted on a SubmissionRecord
// when the "server" autogrades on receipt. Defined here (not in the engine) so
// SubmissionRecord can carry the grade without types.ts depending on the engine;
// grader.ts re-exports these.

/**
 * One case's outcome for a question (instructor-only — students never see failed
 * cases). All modes are value-based: `input` is the input value list `x`,
 * `expected` is `f(x)`, and `got` is the decoded output value list — empty `[]`
 * when the output was rejected before decoding. `reason` carries a rejection /
 * syntax-error explanation (malformed output, no halt, invalid machine table).
 */
export interface CaseResult {
  input: number[];
  expected: number[];
  got: number[];
  pass: boolean;
  reason?: string;
}

/**
 * An instructor's manual verdict on a `pending` (open) question. Recorded
 * after submission via `SubmissionStore.recordManualReview` and stored on the
 * QuestionResult (the result stays `pending` — the review annotates it rather
 * than replacing it, so it can be re-reviewed and is distinguishable from an
 * autograde). A future LLM-grading pass could write the same shape.
 */
export interface ManualReview {
  pass: boolean;
  note?: string;           // optional feedback / justification
  reviewedAt: string;      // ISO timestamp
}

/**
 * Grading outcome for one question of a submission. `pending` is an open
 * question awaiting manual (or, later, LLM) review: the autograder cannot
 * score it, so it contributes nothing to the passed/total tallies and carries
 * the student's `response` for the reviewer instead. Once reviewed, `manual`
 * holds the instructor's verdict and the question counts toward the score.
 */
export interface QuestionResult {
  questionId: number;
  status: 'graded' | 'skipped' | 'pending';
  reason?: string;         // why it was skipped / is pending
  response?: string;       // open questions: the student's free-text answer
  manual?: ManualReview;   // open questions: the instructor's recorded verdict
  passed: number;          // test cases passed
  total: number;           // test cases total
  cases: CaseResult[];
  // Populated instead of `cases` for turbot questions — arena grading
  // doesn't produce an f(x) value comparison, so it gets its own result shape.
  turbotCases?: TurbotCaseResult[];
  // Populated instead of `cases` for perception questions — bit-level frame
  // grading, no value comparison (see engine/perception.ts).
  perceptionCases?: PerceptionCaseResult[];
}

/** Grading outcome for a full submission. */
export interface SubmissionResult {
  student: string;
  questions: QuestionResult[];
  passed: number;          // rolled up across graded test cases
  total: number;
}

/**
 * One recorded submission attempt — an immutable, timestamped snapshot. Produced
 * by the Submit action and stored behind the `SubmissionStore` seam (localStorage
 * today, a server endpoint later). Resubmitting appends a new record; past records
 * are never mutated.
 */
export interface SubmissionRecord {
  assignmentId: string;
  attempt: number;         // 1-based; increments per submit
  submittedAt: string;     // ISO timestamp (canonical)
  submission: SubmissionData;
  result?: SubmissionResult; // autograde computed at receipt (see SubmissionStore)
}

/** Saved canvas state for one assignment question (circuit + annotations).
 *  Open questions reuse the same container with `responseText` holding the
 *  student's free-text answer (their canvas fields stay empty). */
export interface QuestionCircuit {
  components: CircuitComponent[];
  wires: Wire[];
  textElements: TextElement[];
  comments: CommentElement[];
  boxes: BoxDefinition[];
  responseText?: string;
}

/** A student's in-progress work for one assignment — the persisted payload. */
export interface AssignmentState {
  currentQuestionIndex: number;
  questionCircuits: Record<number, QuestionCircuit>; // keyed by AssignmentQuestion.id
}

// ─── Workbook / Worksheet ────────────────────────────────────────

export interface WorksheetData {
  id: string;
  title: string;
  buildMode: BuildMode;
  activeTask: ActiveTask;
  circuit: CircuitData;
  textElements: TextElement[];
  comments: CommentElement[];
  boxes: BoxDefinition[];
}

export interface WorkbookData {
  formatVersion: 2;
  metadata: {
    title: string;
    author: string;
    createdAt: string;
    updatedAt: string;
  };
  worksheets: WorksheetData[];
  activeWorksheetId: string;
  viewPreferences: {
    zoom: number;
    panX: number;
    panY: number;
    showGrid: boolean;
    showWireValues: boolean;
    snapToAlign: boolean;
    repSystem: RepSystem;
  };
}

// ─── Text annotations ───────────────────────────────────────────

export interface TextElement {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  fontSize: number;
  fontColor: string;
  bold: boolean;
  italic: boolean;
}

// ─── Comments ───────────────────────────────────────────────────

export interface CommentElement {
  id: string;
  targetId: string; // component or wire ID this comment is attached to
  text: string;
  x: number; // offset from target
  y: number;
}

// ─── Boxing (redesigned) ────────────────────────────────────────

export interface BoxDefinition {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  componentIds: string[]; // IDs of components inside the box
  inputPortIds: string[]; // wire endpoints crossing boundary inward
  outputPortIds: string[]; // wire endpoints crossing boundary outward
}

// ─── Problem Set Mode ───────────────────────────────────────────

// Port definitions for each component type
export function getPortsForType(type: ComponentType): Port[] {
  switch (type) {
    case 'INPUT':
      return [{ id: 'out', label: '', side: 'right', index: 0 }];
    case 'OUTPUT':
      return [{ id: 'in', label: '', side: 'left', index: 0 }];
    case 'NOT':
      return [
        { id: 'in', label: '', side: 'left', index: 0 },
        { id: 'out', label: '', side: 'right', index: 0 },
      ];
    case 'AND':
    case 'OR':
    case 'XOR':
      return [
        { id: 'in1', label: '', side: 'left', index: 0 },
        { id: 'in2', label: '', side: 'left', index: 1 },
        { id: 'out', label: '', side: 'right', index: 0 },
      ];
    case 'HA':
      return [
        { id: 'in1', label: 'A', side: 'left', index: 0 },
        { id: 'in2', label: 'B', side: 'left', index: 1 },
        { id: 'sum', label: 'S', side: 'right', index: 0 },
        { id: 'carry', label: 'C', side: 'right', index: 1 },
      ];
    case 'MEM':
      return [
        { id: 'mout', label: 'M_OUT', side: 'left', index: 0 },
        { id: 'min', label: 'M_IN', side: 'right', index: 0 },
      ];
    case 'STATE':
      return [
        { id: 'left',  label: '', side: 'left',  index: 0 },
        { id: 'right', label: '', side: 'right', index: 0 },
      ];
    default:
      return [];
  }
}

// Component dimensions
export const GRID_SIZE = 20;
export const COMP_WIDTH = 75;
export const COMP_HEIGHT = 70;
export const PORT_RADIUS = 3.5;
export const INPUT_OUTPUT_SIZE = 40;
export const STATE_RADIUS = 30;
export const STATE_SIZE = STATE_RADIUS * 2; // bounding box for a state circle

// ─── FSM helpers ────────────────────────────────────────────────────

/** Convert a number to Unicode subscript characters */
export function toSubscript(n: number): string {
  const subscripts = '₀₁₂₃₄₅₆₇₈₉';
  return String(n).split('').map(d => subscripts[parseInt(d)] || d).join('');
}

/** FSM history entry for one time step. Single-bit symbols are carried as
 *  numbers (the classic k=1 machine); k-bit input/output symbols ('10') are
 *  carried as strings. */
export interface FsmHistoryEntry {
  t: number;
  stateLabel: string;
  input: number | string;
  output: number | string;
  nextStateLabel: string;
}

/** Parsed transition: extracted from a transition label like "0:1" */
export interface ParsedTransition {
  input: number;
  output: number;
}

// ─── TM helpers ─────────────────────────────────────────────────────
// A Turing machine reuses the FSM editor (STATE components + transition
// wires). Transition labels use the two-output grammar "read:write,move"
// (spec §10.3): one read symbol (0/1, and `*` for binary machines) drives a
// write symbol and a move direction (R right, L left), e.g. "1:0,R". The two
// outputs execute as ONE atomic step — every step both writes and moves. The
// legacy dual-action spelling "1:0R" is accepted as an alias and decays on
// edit-save (engine/notation.ts). See CLAUDE_KB/engines/tm.md.

/**
 * Tape alphabet. Unary machines use only `'0'` / `'1'`; binary machines may
 * also write `'*'` (the numeral delimiter). `'*'` never escapes the tape — it
 * is born in the codec encoder and consumed in the decoder.
 */
export type TMSymbol = '0' | '1' | '*';

/** A TM is either a unary (stroke) or a binary machine; separate alphabets. */
export type TMNotation = 'unary' | 'binary';

/**
 * A two-way-infinite tape. Sparse and normalised to non-background: only
 * `'1'`/`'*'` cells are stored; an absent key reads as background `'0'`
 * (writing `'0'` deletes the key). `head` is an absolute index, never
 * renormalised. Lives in types.ts so the store and saved workspace can
 * reference a tape without a types→engine dependency.
 */
export interface TMTape {
  cells: Record<number, TMSymbol>;
  head: number;
}

/** TM history entry for one time step */
export interface TmHistoryEntry {
  t: number;
  stateLabel: string;
  read: TMSymbol;        // symbol read from the cell under the head
  action: string;        // canonical action text, e.g. "0,R" (write '0', move right)
  headBefore: number;    // head position before the action
  nextStateLabel: string;
}

// ─── Turbot helpers ──────────────────────────────────────────────────
// A turbot is an agent in a grid arena whose behavior is controlled by an
// "inner" CC/SC/FSM/TM circuit with a fixed 1-bit sensor input and 2-bit
// motor output (spec §9). The inner circuit is evaluated one cycle per
// movement cycle; the turbot engine (engine/turbot.ts) is a driver loop
// around the existing per-mode single-step evaluators — it is not a fifth
// simulation engine.

export type TurbotOrientation = 'N' | 'E' | 'S' | 'W';

/** One cell of the arena grid. */
export type ArenaCell = 'empty' | 'block' | 'goal';

/** A turbot arena: grid contents plus the turbot's starting pose. */
export interface ArenaConfig {
  width: number;
  height: number;
  cells: ArenaCell[][]; // cells[y][x]; goal/block are mutually exclusive with the start cell
  start: { x: number; y: number; facing: TurbotOrientation };
}

/** Live turbot pose during simulation (mirrors TMTape as the engine's carried state). */
export interface TurbotState {
  x: number;
  y: number;
  facing: TurbotOrientation;
}

/**
 * Motor command decoded from the inner circuit's 2-bit output (spec §9.2,
 * Appendix B). The bits are the wheel motors (OUT1 = left, OUT2 = right):
 * 00 stay, 01 right motor on → turn left, 10 left motor on → turn right,
 * 11 both on → forward.
 */
export type TurbotMotorCommand = 'stop' | 'left' | 'right' | 'forward';

/**
 * What a turbot TM's external state senses in the cell ahead (textbook
 * "Turbots: Operation"): B = block (or the arena boundary), E = empty,
 * F = food (the goal — passable, unlike blocks). Circuit brains collapse
 * this to the 1-bit sensor: B → 1, E/F → 0.
 */
export type TurbotSense = 'B' | 'E' | 'F';

/**
 * Turbot history entry for one transition. Circuit brains (CC/SC/FSM) only
 * take external steps; a turbot TM alternates freely — an internal step
 * reads/writes/moves on the tape and leaves the pose unchanged.
 */
export interface TurbotHistoryEntry {
  t: number;
  kind: 'external' | 'internal';
  input: string;   // external: sensor bit or B/E/F; internal: tape symbol read
  action: string;  // external: motor command name; internal: write/move token
  x: number;
  y: number;
  facing: TurbotOrientation;
}

/** How a turbot question's success is judged (spec §12.5). */
export type TurbotSuccessCriterion = 'reach-and-stop' | 'pass-through' | 'return-to-start';

/** One turbot grading case: an arena, a step budget, and a success criterion. */
export interface TurbotTestCase {
  arena: ArenaConfig;
  maxSteps: number;
  criterion: TurbotSuccessCriterion;
}

/** Grading outcome for one turbot test case (parallel to CaseResult, richer shape). */
export interface TurbotCaseResult {
  pass: boolean;
  stepsTaken: number;
  finalPosition: { x: number; y: number; facing: TurbotOrientation };
  hitStepLimit: boolean;
  reason?: string;
}

// ─── Perception helpers ─────────────────────────────────────────────
// A perception question (buildMode CC or SC) treats the machine's inputs as an
// array of stimulations hitting a retina and its single output as a symbol
// classifying the stimulus. Grading is bit-level (raw frames in, one bit out
// per step) — it bypasses the value codec entirely (engine/perception.ts).

/** The classification rule a perception question tests. */
export type PerceptionRule =
  | { kind: 'min-run'; runLength: number }    // CC: ≥ k consecutive 1s anywhere
  | { kind: 'exact-run'; runLength: number }  // CC: a maximal run of exactly k 1s
  | { kind: 'pattern'; pattern: string }      // CC: input equals this exact bit string
  | { kind: 'change' }                        // SC: current frame differs from the previous
  | { kind: 'motion'; objectLength: number }; // SC: a k-long object moving up 1/step

/** Authored perception spec: the rule plus the retina size (# input wires). */
export interface PerceptionSpec {
  rule: PerceptionRule;
  width: number;
}

/**
 * One bit-level perception grading case. `frames[t]` is the full input
 * bit-vector for time step t (IN1 first); a CC case has exactly one frame.
 * `expected[t]` is the required output bit at step t (parallel to `frames`).
 */
export interface PerceptionTestCase {
  frames: number[][];
  expected: number[];
}

/** Grading outcome for one perception case (parallel to CaseResult, bit-level shape). */
export interface PerceptionCaseResult {
  pass: boolean;
  frames: number[][];
  expected: number[];
  got: number[];
  failStep?: number;   // 1-based first mismatching time step
  reason?: string;     // machine-validation rejection, when grading never ran
}

// ─── MEM direction helpers ──────────────────────────────────────────
// Port IDs are fixed (mout=left, min=right) for backward compatibility.
// These helpers map them to semantic roles based on memDirection.

/** Port ID that acts as signal source (outputs stored value) */
export function getMemOutputPortId(comp: CircuitComponent): string {
  return comp.memDirection === 'left-to-right' ? 'min' : 'mout';
}

/** Port ID that acts as signal sink (receives value to store) */
export function getMemInputPortId(comp: CircuitComponent): string {
  return comp.memDirection === 'left-to-right' ? 'mout' : 'min';
}

/** True if this port can initiate a wire (act as source). Undecided: both can. */
export function isMemSourcePort(comp: CircuitComponent, portId: string): boolean {
  if (!comp.memDirection) return true;
  return portId === getMemOutputPortId(comp);
}

/** True if this port can receive a wire (act as target). Undecided: both can. */
export function isMemSinkPort(comp: CircuitComponent, portId: string): boolean {
  if (!comp.memDirection) return true;
  return portId === getMemInputPortId(comp);
}
