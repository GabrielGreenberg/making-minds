// Core types for the Making Minds platform

export type BuildMode = 'CC' | 'SC' | 'FSM' | 'turbot' | 'TM';
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

// ─── CC question specification (instructor authoring) ────────────
// Captures everything needed to generate `test_vectors` and to display a CC
// question in the instructor UI. When present on an AssignmentQuestion, the
// system regenerates `test_vectors` from it at save time. The grader never
// reads cc_spec — it is an authoring artifact (see engine/testVectorGen.ts).

export type CCEncoding = 'binary' | 'unary';

export interface CCInputGroup {
  name: string;            // variable name used in the formula, e.g. "x"
  width: number;           // number of input wires in this group
  encoding: CCEncoding;
}

export interface CCOutputGroup {
  name: string;            // label shown to students, e.g. "y"
  width: number;           // number of output wires in this group
  encoding: CCEncoding;
  formula: string;         // affine expression over input group names, e.g. "2 * x"
}

export interface CCSpec {
  inputs: CCInputGroup[];
  outputs: CCOutputGroup[];
}

export interface AssignmentQuestion {
  id: number;                  // stable id; referenced by the grader and submissions
  label: string;               // e.g. "Problem 1", "Q2a"
  statement: string;           // problem text shown above the canvas
  buildMode: BuildMode;        // canvas mode for this question (CC, SC, FSM, …)
  representation?: RepSystem;
  allowed_components?: ComponentType[];
  cc_spec?: CCSpec;            // authoring spec; generates test_vectors at save time
  test_vectors?: {
    input_sequence: number[];
    expected_output: number[];
  }[];
  grading_mode?: 'exhaustive' | 'test_vectors';
  notes?: string;
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
  answers: { questionId: number; circuit: CircuitData }[];
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
}

/** Saved canvas state for one assignment question (circuit + annotations). */
export interface QuestionCircuit {
  components: CircuitComponent[];
  wires: Wire[];
  textElements: TextElement[];
  comments: CommentElement[];
  boxes: BoxDefinition[];
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

/** FSM history entry for one time step */
export interface FsmHistoryEntry {
  t: number;
  stateLabel: string;
  input: number;
  output: number;
  nextStateLabel: string;
}

/** Parsed transition: extracted from a transition label like "0:1" */
export interface ParsedTransition {
  input: number;
  output: number;
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
