// Core types for the Making Minds platform

import type { Role } from './auth/accounts';

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
  /** BOXED ports only (task 038): the internal endpoint this port stands for,
   *  `${compId}:${portId}` — an internal INPUT's `:out`, OUTPUT's `:in`, or
   *  the inner end of a wire the box was drawn across. Only
   *  engine/netlist.ts `boxInterior` resolves it. Absent on every port of a
   *  box placed before 038: its k-th left port binds to the k-th internal IN
   *  by label, its j-th right port to the j-th OUT. */
  bind?: string;
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

// Every ComponentType, once — a Record so the compiler refuses a list that
// misses a member (or names one that isn't). Read where untyped data is
// checked against the union (workbookFile.ts, a file being opened).
const COMPONENT_TYPE_SET: Record<ComponentType, true> = {
  INPUT: true, OUTPUT: true, NOT: true, AND: true, OR: true, XOR: true,
  HA: true, MEM: true, BOXED: true, STATE: true,
};
export const COMPONENT_TYPES = Object.keys(COMPONENT_TYPE_SET) as ComponentType[];

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

/**
 * A fill-in-the-blank question: a short list of labelled text boxes the
 * student types an answer into. Graded by string comparison, not by running a
 * machine (engine/fillIn.ts) — the only normalisation is leading zeros.
 *
 * The spec ships to students (the labels ARE the prompts); the answers live
 * in the separate `fill_in_answers` bank, which is stripped server-side
 * exactly like `test_cases`.
 */
export interface FillInSpec {
  labels: string[];
  /** Restrict boxes to digits: `true` = every blank (the HW1 P11
   *  binary-numeral case), an array = per blank, parallel to `labels`.
   *  Read it ONLY through engine/fillIn.ts `fillInBlanks` — an array is
   *  truthy, so a bare `if (spec.numericOnly)` would lock every blank. */
  numericOnly?: boolean | boolean[];
}

/** One blank's outcome — instructor-only, like CaseResult. */
export interface FillInCaseResult {
  label: string;
  expected: string;
  got: string;
  pass: boolean;
}

// ── The problem-set document (task 2026-09-21-020) ─────────────────────────
// A homework is a DOCUMENT — the PDFs under problem sets/ have a preamble,
// sections whose intro sentence carries the instruction for a run of problems
// ("Design SCs that compute the following functions."), boxed callouts that
// belong to a section or a problem, and figures. These types give that level a
// home in the data so one renderer (components/ProblemSetDocument.tsx) can show
// any assignment the way its author laid it out. `questions[]` stays flat and
// stays the grading unit; everything here is display-only — the grader,
// submissions, workbooks and the server's sanitizer never read it. Semantics
// (section normalisation, numbering, layout) live in src/problemSet.ts.

export type CalloutKind = 'hint' | 'challenge' | 'advice' | 'caution' | 'note';
export const CALLOUT_KINDS: readonly CalloutKind[] = ['hint', 'challenge', 'advice', 'caution', 'note'];

/** Where an attachment sits relative to the thing it belongs to: before its
 *  problems (a section's instruction box), beside them on wide screens (the
 *  PDFs' sidebar boxes and margin notes), or after them (the default). */
export type Placement = 'before' | 'aside' | 'after';

export interface Figure {
  /** A data URL (instructor upload, size-capped by the editor) or a path
   *  under the app's public root such as `problem-sets/hw1-mn.svg`, resolved
   *  against the app's base URL at render time (src/problemSet.ts figureUrl). */
  src: string;
  alt: string;
  caption?: string;
  /** CSS pixel cap on the rendered width. Absent = the natural size, capped
   *  by the column. */
  width?: number;
  placement?: Placement;
}

/** A boxed aside — the PDFs' "Hint:", "Challenge problem:", "Advice!",
 *  "Caution!" and plain note boxes. `body` is statement markup. */
export interface Callout {
  kind: CalloutKind;
  /** Heading; absent = the kind's default ("Hint", "Challenge problem", …). */
  title?: string;
  body: string;
  placement?: Placement;
  figures?: Figure[];
}

/** How a section's run of compact problems flows. Absent = `auto`: consecutive
 *  truth-table problems form a grid, consecutive one-liners form columns,
 *  anything longer takes the full width (src/problemSet.ts problemShape). */
export type SectionLayout = 'auto' | 'list' | 'columns' | 'grid';

export interface AssignmentSection {
  /** "I. Combinatorial Circuits". Empty = a continuation: no heading or rule
   *  is drawn, only the intro — for a fresh instruction mid-section (HW3 §I
   *  switches from "design" to "is it possible?" after problem 6). */
  heading: string;
  /** Statement markup: the instruction carried by the whole run of problems. */
  intro?: string;
  /** The problems, in order, by AssignmentQuestion.id. Together the sections
   *  partition the assignment's question ids; a question listed nowhere is
   *  rendered in a trailing unnamed section so it is never lost. */
  questionIds: number[];
  callouts?: Callout[];
  figures?: Figure[];
  layout?: SectionLayout;
}

export interface AssignmentQuestion {
  id: number;                  // stable id; referenced by the grader and submissions
  label: string;               // e.g. "Problem 1", "Q2a"
  /** Optional short name for the problem ("Reconstructing OR"), shown bold on
   *  its own line above the statement. Display only — never graded. */
  title?: string;
  statement: string;           // problem text shown above the canvas
  /** Optional nudge ("DeMorgan's Law is useful here!"), rendered italic in its
   *  own colour on a line of its own below the statement, so it reads as help
   *  rather than as part of the problem. Display only — never graded. */
  hint?: string;
  buildMode: BuildMode;        // canvas mode for this question (CC, SC, FSM, turbot, …)
  representation: RepSystem;   // authoritative for grading (binary | tally; TM notation: tally→unary)
  allowed_components?: ComponentType[];
  /** Cap on how many of a component type the machine may contain, counted
   *  through BOXED internals (engine/machineValidation.ts owns the
   *  semantics). Absent, empty, or a type with no entry = unlimited. */
  component_limits?: Partial<Record<ComponentType, number>>;
  /** TM-mode acceptance strictness: when true, a run is accepted only if the
   *  head halts on the output block's rightmost cell (standard position —
   *  tmCodec `AcceptOptions`). Absent/false = position-agnostic (default). */
  requireStandardHaltPosition?: boolean;
  /** Cap on how many tape cells a run may occupy — the span of head positions
   *  (engine/tm.ts `tapeCellsUsed`). Applies to TM questions and to turbot
   *  questions whose brain is a TM (its private tape). Absent = unbudgeted. */
  maxTapeCells?: number;
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
  // Fill-in-the-blank fields (buildMode 'open'). A `fill_in` spec turns the
  // open question's writing panel into a list of labelled boxes and makes it
  // autogradable; `fill_in_answers` is the key, and is stripped from student
  // copies like `test_cases` (see engine/fillIn.ts + server/src/sanitize.ts).
  fill_in?: FillInSpec;
  fill_in_answers?: string[];
  /** Boxed asides and figures that belong to this problem alone (the
   *  document level, above; a `hint` is the lighter margin-note idiom). */
  callouts?: Callout[];
  figures?: Figure[];
  notes?: string;
}

/**
 * Display label for a question's mode chip. A turbot question names its inner
 * machine too ("turbot - TM"), since the brain's mode is what the student
 * actually edits; a perception or fill-in question flags its task.
 */
export function questionModeLabel(
  q: Pick<AssignmentQuestion, 'buildMode' | 'innerMode' | 'perception' | 'fill_in'>,
): string {
  const task = questionTask(q);
  if (task === 'turbot') return `turbot - ${q.innerMode ?? 'CC'}`;
  if (task === 'fill-in') return 'open - fill-in';
  return task === 'perception' ? `${q.buildMode} - perception` : q.buildMode;
}

/**
 * What a question asks for — the ONE place that decides which student panel
 * it gets, which grader branch scores it, what its answer carries and whether
 * a graded case replays (task 005). `buildMode` picks the canvas; the task
 * says what is done on it:
 *   function   — a machine computing f, graded on `test_cases` (value codec)
 *   perception — a CC/SC classifier graded bit-level on `perception_cases`
 *   turbot     — a brain driven through `turbot_cases` arenas
 *   open       — free prose, `pending` manual review
 *   fill-in    — labelled blanks, autograded against `fill_in_answers`
 * The order below is the grader's historical precedence, so classification
 * never moved a grade. Pure (no engine import), so every side can call it.
 */
export type QuestionTask = 'function' | 'perception' | 'turbot' | 'open' | 'fill-in';

/** The tasks each canvas mode can author, the default first (the creator's
 *  Task toggle, coerced when the mode flips). Perception is a spatial (CC) or
 *  temporal (SC) classification of raw bits, so only those canvases offer it. */
export const QUESTION_TASKS: Record<BuildMode, readonly QuestionTask[]> = {
  CC: ['function', 'perception'],
  SC: ['function', 'perception'],
  FSM: ['function'],
  TM: ['function'],
  turbot: ['turbot'],
  open: ['open', 'fill-in'],
};

export function questionTask(
  q: Pick<AssignmentQuestion, 'buildMode' | 'perception' | 'fill_in'>,
): QuestionTask {
  if (q.buildMode === 'open') return q.fill_in ? 'fill-in' : 'open';
  if (q.buildMode === 'turbot') return 'turbot';
  return q.perception ? 'perception' : 'function';
}

export const CC_BOXES: ReadonlyArray<'CC' | 'SC'> = ['CC'];
export const CC_AND_SC_BOXES: ReadonlyArray<'CC' | 'SC'> = ['CC', 'SC'];
const NO_BOXES: ReadonlyArray<'CC' | 'SC'> = [];

/** Which kinds of confirmed box a canvas may place (the palette's "Boxes"
 *  section and placeBoxInstance read it through the store's
 *  selectPlaceableBoxKinds; boxScopeCheck pins it).
 *    CC     → CC boxes (combinational). A box holding memory would make the
 *             machine sequential, which a CC question does not ask for.
 *    SC     → CC and SC boxes. An SC box holds a MEM (at any depth); its
 *             memory is clocked with the machine — engine/netlist.ts inlines
 *             it for every run, so a boxed sub-circuit behaves exactly as it
 *             would unboxed. (The sandbox's Logic Circuit tab is buildMode CC
 *             but is also its SC canvas: the store selector adds SC there.)
 *    FSM    → none (notes/todos.md item 2). An earlier attempt (git a05e3d6)
 *             got as far as confirm + place — `confirmBox`'s FSM rules
 *             required exactly one entry state (S_A, lowest-numbered) and one
 *             terminal state (S_B, no outgoing transitions), which describes
 *             a sub-automaton meant to consume MULTIPLE subsequent input
 *             symbols — tracking its own internal position across steps —
 *             before handing control back to whatever the placed instance's
 *             own outgoing transitions say next. That is not a stateless
 *             function call like a boxed CC circuit (evaluateBoxedCircuit,
 *             engine/cc.ts, runs once and returns instantly), nor a boxed SC
 *             circuit's memory (more clocked state, inlined beside the rest
 *             by engine/netlist.ts, with control still one tick); it needs the
 *             SAME kind of invented call/return convention TM boxing is
 *             refused for, below — the running machine's "current state"
 *             would have to become a stack (plain state, or box instance +
 *             internal position), threaded through evaluateFSMSymbolStep,
 *             the store's live sim, turbot FSM brains, and the grader. It
 *             was also never wired for headless grading: a placed instance
 *             carried only `boxedCircuitId`, never a frozen internal circuit
 *             the way a CC/SC `BOXED` component carries `internalCircuit` —
 *             so even a working evaluator would have nothing to run from a
 *             submitted JSON payload. `fsmPlaceBoxInstance` and confirmBox's
 *             FSM branch are gone; `evaluateFSMSymbolStep` never read
 *             `boxedCircuitId` and this is why it never will.
 *    TM     → none, BY DESIGN, not as a gap to fill in later. CC boxing works
 *             because a boxed circuit is a pure function call: evaluateBoxedCircuit
 *             (engine/cc.ts) is invoked once and returns instantly, so a
 *             sub-circuit can hide behind crossing-wire ports. A TM has ONE
 *             tape and ONE control thread (evaluateTMSingleStep, engine/tm.ts,
 *             does a single wire lookup keyed by the current state id across
 *             the WHOLE table) — there is nothing that "crosses a boundary"
 *             the way a wire does, and a sub-machine doesn't return a value
 *             after one call, it runs an unbounded, data-dependent number of
 *             steps before halting. Boxing a TM would mean splicing two
 *             transition tables together (shared state-id namespace, shared
 *             tape, an invented call/return convention) — a different, much
 *             larger feature, not an extension of CC/SC boxing. TM boxing is
 *             refused for the same "don't build something semantically
 *             wrong" reason FSM boxing is, above. (A boxed MEM is different:
 *             it still sits on a wire boundary, and its clocked state inlines
 *             into the one netlist the SC step already runs.)
 *  Absent `kind` on an older entry counts as CC. The arrays are shared
 *  constants, so a store selector can return them without re-rendering. */
export function placeableBoxKinds(mode: BuildMode): ReadonlyArray<'CC' | 'SC'> {
  switch (mode) {
    case 'CC':
      return CC_BOXES;
    case 'SC':
      return CC_AND_SC_BOXES;
    default:
      return NO_BOXES;
  }
}

export interface AssignmentData {
  id: string;                  // stable slug (e.g. "hw1"); keys the registry/persistence
  title: string;
  /** Optional due date (ISO timestamp). Display/annotation policy only — a late
   *  submission is still accepted and graded; lateness is computed against the
   *  server-stamped `submittedAt` (see dueDates.ts). Absent = no due date. */
  dueDate?: string;
  /** Instructor-chosen position in the assignment list (ascending). Absent
   *  sorts last, then by title, so an assignment that has never been moved
   *  keeps a stable place. Set by the dashboard's ↑/↓ buttons. */
  order?: number;
  questions: AssignmentQuestion[];
  /** Statement markup shown under the title, before the first section
   *  (HW1's "Note: I have put key words in bold …"). */
  preamble?: string;
  /** The document structure over `questions` — see AssignmentSection. Absent
   *  = one unnamed section holding every question, so every existing
   *  assignment renders unchanged. */
  sections?: AssignmentSection[];
  /** The original handout, as a path under the app's public root
   *  (`problem-sets/hw1.pdf`) or an absolute URL; rendered as an "Original
   *  PDF" link. */
  sourcePdf?: string;
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
  answers: {
    questionId: number;
    circuit: CircuitData;
    responseText?: string;
    /** Fill-in questions: one typed answer per blank, in the spec's order. */
    fillAnswers?: string[];
    /** The question's signed editing record (task 034), copied from the
     *  workbook; checked at submit, never graded. */
    provenance?: QuestionProvenance;
  }[];
}

// ─── Provenance and integrity (task 034) ─────────────────────────
// app/src/provenance/ (ids.ts, trace.ts, integrity.ts). Integrity is a set of
// flags TO LOOK AT, never a verdict: it sits beside `result` and never
// changes a score, and students never see it (server/src/sanitize.ts).

/**
 * One question's signed editing record: aggregates only, never a keystroke
 * log. Kept BESIDE the answer (QuestionCircuit.provenance), never inside the
 * text, and re-signed by the store at every edit (store.ts recordEdit) —
 * never at save time, which would launder an injected save.
 */
export interface QuestionProvenance {
  v: 1;
  /** Edit actions (canvas history steps, undo/redo, text changes). */
  edits: number;
  /** Active editing time: gaps between edits summed, each capped at 60 s. */
  activeMs: number;
  /** Characters inserted, in total and in the largest single insertion. */
  textIns: number;
  maxTextIns: number;
  /** Components added (add, box placement, paste), in total and in the
   *  largest single action. */
  compAdded: number;
  maxCompIns: number;
  /** Times the text was found changed outside the editor (sticky). */
  outside: number;
  /** What the question already held when its record began (legacy work). */
  base?: { c: number; t: number };
  /** 64-bit digest of the answer text (responseText + fillAnswers), hex. */
  td: string;
  /** HMAC under the mint key over the question id and every field; '' when
   *  no key was loaded. */
  sig: string;
}

export type IntegrityFlagCode =
  | 'ids-other'        // ids minted under a classmate's key
  | 'ids-unbound'      // ids not minted in this student's editor for this assignment
  | 'text-other'       // the text's stamp is a classmate's
  | 'text-mismatch'    // the text differs from its own stamp
  | 'text-unsigned'    // text with no valid stamp
  | 'outside'          // the text was changed outside the editor, then edited
  | 'record-other'     // the editing record is a classmate's
  | 'record-missing'   // content with no valid editing record
  | 'one-piece-text'   // most of the text arrived in one insertion
  | 'too-fast'         // text entered faster than a person types
  | 'one-piece-circuit'// most of the circuit arrived in one in-app paste
  | 'unaccounted'      // more content than the record's insertions explain
  | 'one-save';        // most of the work appeared between two saves

export interface IntegrityFlag {
  code: IntegrityFlagCode;
  /** Plain words for the instructor, phrased as something to look at. */
  detail: string;
}

export interface QuestionIntegrity {
  questionId: number;
  ids: {
    total: number;
    self: number;
    unbound: number;
    legacy: number;
    /** Ids minted under another person's key, by email. */
    others: { email: string; count: number }[];
  };
  text: 'none' | 'self' | 'other' | 'mismatch' | 'unsigned' | 'legacy';
  /** The editing record's signer. */
  record: 'none' | 'self' | 'other' | 'invalid';
  /** When `text` or `record` is 'other': whose. */
  from?: string;
  /** The record's aggregates when it is this student's own. */
  trace?: Omit<QuestionProvenance, 'v' | 'td' | 'sig'>;
  flags: IntegrityFlag[];
}

/** The integrity summary stored on a submission (instructor-only). */
export interface SubmissionIntegrity {
  v: 1;
  questions: QuestionIntegrity[];
  /** How many questions carry at least one flag. */
  flagged: number;
}

// ─── Autograding results ─────────────────────────────────────────
// Produced by the grader (engine/grader.ts) and persisted on a SubmissionRecord
// when the "server" autogrades on receipt. Defined here (not in the engine) so
// SubmissionRecord can carry the grade without types.ts depending on the engine;
// grader.ts re-exports these.

/**
 * One case's outcome for a question (the answer key — `expected`/`got` — is
 * instructor-only; a student's copy keeps `input`/`pass`/`reason`/
 * `separations`, server/src/sanitize.ts). All modes are value-based: `input`
 * is the input value list `x`, `expected` is `f(x)`, and `got` is the decoded
 * output value list — empty `[]` when the output was rejected before decoding.
 * `reason` carries a rejection / syntax-error explanation (malformed output,
 * no halt, invalid machine table).
 */
export interface CaseResult {
  input: number[];
  expected: number[];
  got: number[];
  pass: boolean;
  reason?: string;
  /** The case's TM block separations (TestCase.separations), present only
   *  when the case has them — part of the INPUT, not the key, so a student
   *  replaying the case gets the grader's exact tape. */
  separations?: number[];
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
  // Parallel to the question's bank: cases[k] is test_cases[k] (and
  // turbotCases[k] is turbot_cases[k]) — a replay of case k relies on it.
  cases: CaseResult[];
  // Populated instead of `cases` for turbot questions — arena grading
  // doesn't produce an f(x) value comparison, so it gets its own result shape.
  turbotCases?: TurbotCaseResult[];
  // Populated instead of `cases` for perception questions — bit-level frame
  // grading, no value comparison (see engine/perception.ts).
  perceptionCases?: PerceptionCaseResult[];
  // Populated instead of `cases` for fill-in questions — one entry per blank
  // (engine/fillIn.ts). Carries the expected answers, so it is instructor-only.
  fillCases?: FillInCaseResult[];
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
  /** Provenance check computed at receipt (task 034) — instructor-only,
   *  stripped from every student copy, never part of the score. */
  integrity?: SubmissionIntegrity;
}

// ── Platform feedback (notes/todos.md item 9) ──────────────────────────────
// A report on the platform or a homework, queued for an instructor.
// Not grading, not a submission — its own small seam (FeedbackStore).

export type FeedbackCategory = 'platform design' | 'homework content';
export type FeedbackStatus = 'open' | 'resolved';

/** What the task pipeline made of a report (task 018; set by
 *  `tasks/tools/feedback.mjs mark`, never by the app): `filed` — it became,
 *  or joined, the listed tasks; `personal` — it is about the student, not
 *  the platform or a homework, so it is left for the instructor and never
 *  filed; `dismissed` — noise, a duplicate or already done (`note` says
 *  which). Independent of `status`: resolving stays the instructor's act. */
export type FeedbackTriageOutcome = 'filed' | 'personal' | 'dismissed';

export interface FeedbackTriage {
  outcome: FeedbackTriageOutcome;
  /** `filed` only: task ids in the `tasks/` queue (`2026-09-24-040`). */
  tasks?: string[];
  /** A line on why; required for `dismissed`. */
  note?: string;
  at: string; // ISO; the server's word
}

/** One attached screenshot, downscaled and base64-encoded client-side before
 *  it ever reaches the store (see components/FeedbackPanel.tsx). */
export interface FeedbackScreenshot {
  dataUrl: string; // "data:image/jpeg;base64,..."
  filename?: string;
}

export interface PlatformFeedback {
  id: string;
  student: string; // email — feedback is tied to identity so an instructor can follow up
  /** The capacity they filed in, stamped at filing from the session (task
   *  018). Absent = unknown: a report older than the stamp whose author has
   *  since left the roster. */
  authorRole?: Role;
  category: FeedbackCategory;
  message: string;
  screenshots: FeedbackScreenshot[];
  createdAt: string; // ISO; the server's word remotely, the client's word locally
  status: FeedbackStatus;
  /** Where the student was when they filed it, if anywhere — helps triage
   *  "homework content" reports. Auto-filled from the current route. */
  context?: { assignmentId?: string; questionId?: number };
  /** Absent = the task pipeline has not processed it yet. */
  triage?: FeedbackTriage;
}

// ── Instructor notes (notes/todos.md item 12) ──────────────────────────────
// One shared markdown document, instructor-only, updated on Save — a single
// piece of state, not a per-id list, so its NotesStore seam is get/save
// rather than the list/CRUD shape of the other seams.

export interface InstructorNote {
  content: string; // raw markdown
  updatedAt: string; // ISO timestamp
  updatedBy: string; // the instructor's name (or email) who last saved
}

/** Saved canvas state for one assignment question.
 *  Open questions reuse the same container with `responseText` holding the
 *  student's free-text answer (their canvas fields stay empty). */
export interface QuestionCircuit {
  components: CircuitComponent[];
  wires: Wire[];
  boxes: BoxDefinition[];
  /** LEGACY: the per-question confirmed-box library, before it became
   *  assignment-wide (`AssignmentState.boxLibrary`). Still read, so old saves
   *  keep their boxes; no longer written. */
  confirmedBoxes?: ConfirmedBoxDef[];
  responseText?: string;
  /** Fill-in questions: one typed answer per blank, in the spec's order. */
  fillAnswers?: string[];
  /** The student has marked this question done — a self-imposed lock against
   *  accidental edits, toggled from the question workspace. Absent/false =
   *  unlocked (back-compat with saves that predate this). */
  done?: boolean;
  /** The signed editing record (task 034); absent before the first edit. */
  provenance?: QuestionProvenance;
}

/** A student's in-progress work for one assignment — the persisted payload. */
export interface AssignmentState {
  currentQuestionIndex: number;
  questionCircuits: Record<number, QuestionCircuit>; // keyed by AssignmentQuestion.id
  /**
   * Confirmed boxes available across the WHOLE assignment: a box built for one
   * question can be reused in any other question of the same homework that is
   * allowed to place its kind (`placeableBoxKinds`). One list, not one per
   * question — the palette does the per-mode filtering, so a CC box follows
   * the student to every CC and SC question.
   *
   * Absent in saves that predate this (the library was per-question then, in
   * `QuestionCircuit.confirmedBoxes`); those are merged into this list on load.
   */
  boxLibrary?: ConfirmedBoxDef[];
}

// ─── Workbook / Worksheet ────────────────────────────────────────

export interface WorksheetData {
  id: string;
  title: string;
  buildMode: BuildMode;
  activeTask: ActiveTask;
  circuit: CircuitData;
  boxes: BoxDefinition[];
  /** Confirmed boxes available in this worksheet's palette (absent in pre-existing saves = none). */
  confirmedBoxes?: ConfirmedBoxDef[];
  /** Turbot worksheets only: which machine kind the brain circuit is. */
  innerMode?: BuildMode;
  /** Turbot worksheets only: the sandbox arena the Map runs the brain in. */
  arena?: ArenaConfig;
}

export interface WorkbookData {
  formatVersion: 2;
  /** The integrity notice (task 034, provenance/notice.ts) — written on
   *  export, ignored on import. */
  notice?: string;
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

// ─── Boxing (redesigned) ────────────────────────────────────────

/** A confirmed box in the palette: the frozen internal circuit an instance is
 *  stamped from. Shared across a whole ASSIGNMENT (AssignmentState.boxLibrary)
 *  but scoped to one sandbox TAB; which canvases may place it is decided by
 *  `kind` + `placeableBoxKinds`. */
export interface ConfirmedBoxDef {
  id: string; // same id as the BoxDefinition it was confirmed from
  name: string;
  /** What the box computes, which decides where it may be placed (see
   *  placeableBoxKinds): 'SC' when its internals hold a MEM at any depth (a
   *  sequential box, placeable only where a machine may be sequential), else
   *  'CC'. confirmBox always writes it; absent = CC (older entries, from when
   *  boxing refused MEM). A saved `'FSM'` value can still appear on data from
   *  before FSM boxing was retired (notes/todos.md item 2); placeableBoxKinds
   *  never offers it for placement. */
  kind?: 'CC' | 'SC' | 'FSM';
  inputPortIds: string[];
  outputPortIds: string[];
  internalComponents: CircuitComponent[];
  internalWires: Wire[];
}

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
