// Turbot evaluation engine.
//
// Framework-agnostic: no React, no Zustand, no DOM. Importable from Node (CLI grader).
//
// A turbot's "brain" is an ordinary CC/SC/FSM circuit wired to a fixed 1-bit
// sensor input and 2-bit motor output (spec §9), or a **turbot TM** (textbook
// "Turbots: Operation"): a Turing machine whose states are each either
// *internal* (circle — reads the private {0,1,*} tape and performs ONE
// single action: write a symbol or move the head) or *external* (square —
// senses the cell ahead as B/E/F and moves forward / turns). Every
// transition is one time step; an internal step leaves the pose unchanged,
// an external step leaves the tape unchanged. Turbot TMs start on a blank
// tape, can pass through food (the goal) but not blocks, and halt when no
// transition matches — for a turbot TM, halting IS stopping.
//
// This module is a driver loop around the per-mode single-step evaluators
// (evaluateCCInputs, evaluateSCSingleStep, evaluateFSMSingleStep) plus the
// turbot-TM step defined here, mirroring evaluateTMSequence's
// step/halt/history loop.

import type {
  CircuitComponent,
  Wire,
  BuildMode,
  ArenaConfig,
  ArenaCell,
  TurbotState,
  TurbotOrientation,
  TurbotMotorCommand,
  TurbotSense,
  TurbotHistoryEntry,
  TurbotSuccessCriterion,
  TMTape,
  TMSymbol,
  TMNotation,
} from '../types';
import { evaluateCCInputs } from './cc';
import { evaluateSCSingleStep } from './sc';
import { sortStateComponents, evaluateFSMSingleStep } from './fsm';
import { readCell } from './tm';

// ─── Arena geometry ──────────────────────────────────────────────────

const FACING_DELTA: Record<TurbotOrientation, { dx: number; dy: number }> = {
  N: { dx: 0, dy: -1 },
  E: { dx: 1, dy: 0 },
  S: { dx: 0, dy: 1 },
  W: { dx: -1, dy: 0 },
};

const LEFT_OF: Record<TurbotOrientation, TurbotOrientation> = { N: 'W', W: 'S', S: 'E', E: 'N' };
const RIGHT_OF: Record<TurbotOrientation, TurbotOrientation> = { N: 'E', E: 'S', S: 'W', W: 'N' };

function cellAt(arena: ArenaConfig, x: number, y: number): ArenaCell | 'boundary' {
  if (x < 0 || y < 0 || x >= arena.width || y >= arena.height) return 'boundary';
  return arena.cells[y]?.[x] ?? 'empty';
}

/**
 * What the cell ahead contains, as a turbot TM's external state senses it:
 * B = block or the arena boundary, F = food (the goal), E = empty.
 */
export function senseAheadSymbol(arena: ArenaConfig, state: TurbotState): TurbotSense {
  const { dx, dy } = FACING_DELTA[state.facing];
  const ahead = cellAt(arena, state.x + dx, state.y + dy);
  if (ahead === 'block' || ahead === 'boundary') return 'B';
  if (ahead === 'goal') return 'F';
  return 'E';
}

/**
 * Circuit-brain sensor reading: 0 = passable ahead (empty or food),
 * 1 = block or boundary ahead (spec §9.2).
 */
export function senseAhead(arena: ArenaConfig, state: TurbotState): 0 | 1 {
  return senseAheadSymbol(arena, state) === 'B' ? 1 : 0;
}

/**
 * Decode the inner circuit's 2-bit motor output (spec §9.2, Appendix B).
 * The bits are the wheel motors — OUT1 = left wheel, OUT2 = right wheel:
 * 00 both off (stay), 01 right motor only (pivot left), 10 left motor only
 * (pivot right), 11 both on (move forward).
 */
export function decodeMotorCommand(bits: number[]): TurbotMotorCommand {
  const left = bits[0] ?? 0;
  const right = bits[1] ?? 0;
  if (left === 0 && right === 0) return 'stop';
  if (left === 0 && right === 1) return 'left';   // right wheel drives → turn left
  if (left === 1 && right === 0) return 'right';  // left wheel drives → turn right
  return 'forward';
}

/**
 * Apply a motor command to the turbot's pose. "Forward" into a block or the
 * arena boundary is a no-op (the boundary/block acts as an implicit wall);
 * the spec does not define a different penalty for this case.
 */
export function applyMotorCommand(arena: ArenaConfig, state: TurbotState, cmd: TurbotMotorCommand): TurbotState {
  switch (cmd) {
    case 'stop':
      return state;
    case 'left':
      return { ...state, facing: LEFT_OF[state.facing] };
    case 'right':
      return { ...state, facing: RIGHT_OF[state.facing] };
    case 'forward': {
      const { dx, dy } = FACING_DELTA[state.facing];
      const ahead = cellAt(arena, state.x + dx, state.y + dy);
      if (ahead === 'block' || ahead === 'boundary') return state;
      return { ...state, x: state.x + dx, y: state.y + dy };
    }
  }
}

// ─── Turbot TM: state kinds, label grammar, single actions ───────────
// (Textbook "Turbots: Operation".) Internal transitions read the tape and
// perform ONE action — write 0/1/* or move L/R (unlike the base TM engine's
// dual write+move action). External transitions sense B/E/F and move
// forward (↑) or turn (↱ right / ↰ left).

export const TURBOT_FORWARD = '↑';
export const TURBOT_TURN_RIGHT = '↱';
export const TURBOT_TURN_LEFT = '↰';

export const TURBOT_TM_SENSES: TurbotSense[] = ['B', 'E', 'F'];
export const TURBOT_TM_EXTERNAL_ACTIONS = [TURBOT_FORWARD, TURBOT_TURN_RIGHT, TURBOT_TURN_LEFT];

/**
 * The internal tape alphabet under the question's encoding (its
 * `representation`, mapped through notationForRepresentation): binary
 * machines read/write {0,1,*}; unary (tally) machines only {0,1} — the same
 * rule as the base TM's tape (engine/tm.ts isSymbolForNotation).
 */
export function turbotTMReadSymbols(notation: TMNotation): TMSymbol[] {
  return notation === 'binary' ? ['0', '1', '*'] : ['0', '1'];
}

/** Internal single-action tokens under the notation: the writes plus head moves. */
export function turbotTMInternalActions(notation: TMNotation): string[] {
  return [...turbotTMReadSymbols(notation), 'R', 'L'];
}

/** A STATE node's kind in a turbot TM; absent means internal (circle). */
export function stateKindOf(comp: CircuitComponent): 'internal' | 'external' {
  return comp.stateKind === 'external' ? 'external' : 'internal';
}

export type TurbotTMInternalAction =
  | { kind: 'write'; symbol: TMSymbol }
  | { kind: 'move'; dir: 'L' | 'R' };

export interface TurbotTMInternalTransition {
  read: TMSymbol;
  action: TurbotTMInternalAction;
}

export interface TurbotTMExternalTransition {
  sense: TurbotSense;
  motor: 'forward' | 'left' | 'right';
}

/**
 * Parse an internal transition label "read:action" (e.g. "0:1", "1:L",
 * "*:R"), notation-aware: under the unary encoding `*` is not a legal read
 * or write, so any label mentioning it fails to parse.
 */
export function parseTurbotInternalLabel(
  label: string | undefined,
  notation: TMNotation = 'binary'
): TurbotTMInternalTransition | null {
  if (!label) return null;
  const m = (notation === 'binary' ? /^([01*]):([01*RL])$/ : /^([01]):([01RL])$/).exec(label);
  if (!m) return null;
  const read = m[1] as TMSymbol;
  const a = m[2];
  if (a === 'L' || a === 'R') return { read, action: { kind: 'move', dir: a } };
  return { read, action: { kind: 'write', symbol: a as TMSymbol } };
}

/** Parse an external transition label "sense:motor" (e.g. "E:↑", "B:↱", "F:↰"). */
export function parseTurbotExternalLabel(label: string | undefined): TurbotTMExternalTransition | null {
  if (!label) return null;
  const parts = label.split(':');
  if (parts.length !== 2) return null;
  const sense = parts[0];
  if (sense !== 'B' && sense !== 'E' && sense !== 'F') return null;
  const motor =
    parts[1] === TURBOT_FORWARD ? 'forward' :
    parts[1] === TURBOT_TURN_RIGHT ? 'right' :
    parts[1] === TURBOT_TURN_LEFT ? 'left' : null;
  if (!motor) return null;
  return { sense, motor };
}

/** Apply an internal single action: a write leaves the head, a move leaves the cells. */
export function applyTurbotTapeAction(tape: TMTape, action: TurbotTMInternalAction): TMTape {
  if (action.kind === 'move') {
    return { cells: tape.cells, head: tape.head + (action.dir === 'R' ? 1 : -1) };
  }
  const cells = { ...tape.cells };
  if (action.symbol === '0') delete cells[tape.head]; // normalise to non-background
  else cells[tape.head] = action.symbol;
  return { cells, head: tape.head };
}

export interface TurbotTMValidationError {
  stateLabel: string;
  message: string;
}

/**
 * Validate a turbot TM table: every transition's label must parse under its
 * SOURCE state's kind grammar, and each state may have at most one
 * transition per input token (deterministic). Mirrors validateTMTable's
 * role for the base TM (engine/tmValidate.ts), which cannot be reused here —
 * its dual-action grammar and single alphabet don't apply. `notation` is the
 * question's encoding: unary machines may not mention `*` in internal labels.
 */
export function validateTurbotTM(
  components: CircuitComponent[],
  wires: Wire[],
  notation: TMNotation = 'binary'
): TurbotTMValidationError[] {
  const errors: TurbotTMValidationError[] = [];
  const states = components.filter((c) => c.type === 'STATE');
  if (states.length === 0) {
    return [{ stateLabel: '—', message: 'machine has no states' }];
  }
  for (const s of states) {
    const kind = stateKindOf(s);
    const seen = new Map<string, number>();
    for (const w of wires) {
      if (w.sourceComponentId !== s.id) continue;
      const label = w.transitionLabel;
      const parsedInput = kind === 'internal'
        ? parseTurbotInternalLabel(label, notation)?.read
        : parseTurbotExternalLabel(label)?.sense;
      if (parsedInput == null) {
        errors.push({
          stateLabel: s.label,
          message: `state ${s.label} (${kind}) has an invalid transition label "${label ?? ''}"`,
        });
        continue;
      }
      seen.set(parsedInput, (seen.get(parsedInput) ?? 0) + 1);
    }
    for (const [input, count] of seen) {
      if (count > 1) {
        errors.push({
          stateLabel: s.label,
          message: `state ${s.label} has ${count} transitions for input ${input} (must be at most one)`,
        });
      }
    }
  }
  return errors;
}

// ─── Brain step ──────────────────────────────────────────────────────
// Each inner mode carries its own state across cycles (MEM values for SC,
// current state id for FSM/TM); CC is stateless per spec §9.3.

export interface BrainState {
  memValues?: number[];   // SC: current MEM stored values
  stateId?: string;       // FSM/TM: current control-state component id
  tape?: TMTape;          // TM: the private tape (blank at start, per the textbook)
}

export interface BrainStepResult {
  /** External effect of this step; null = internal turbot-TM op (pose unchanged). */
  motor: TurbotMotorCommand | null;
  input: string;   // what the brain consumed (sensor bit / B/E/F / tape symbol)
  action: string;  // history token (motor command name / write/move token)
  brainState: BrainState;
}

/** Initial brain state for a given inner mode. */
export function initialBrainState(components: CircuitComponent[], innerMode: BuildMode): BrainState {
  if (innerMode === 'SC') {
    const sortedMems = components
      .filter((c) => c.type === 'MEM')
      .sort((a, b) => (parseInt(a.label.replace(/\D/g, '')) || 0) - (parseInt(b.label.replace(/\D/g, '')) || 0));
    return { memValues: sortedMems.map((m) => m.storedValue ?? 0) };
  }
  if (innerMode === 'FSM' || innerMode === 'TM') {
    const states = sortStateComponents(components);
    return { stateId: states[0]?.id, tape: innerMode === 'TM' ? { cells: {}, head: 0 } : undefined };
  }
  return {};
}

/**
 * Run one brain transition: given what the arena shows ahead (`sense`) and
 * the prior brain state, produce this step's external effect (motor command,
 * or null for an internal turbot-TM op) and the next brain state. Returns
 * null when an FSM/TM brain halts (no matching transition) — CC/SC brains
 * never halt (spec §9.3: they react every cycle). `notation` is the
 * question's encoding; only a turbot TM's internal alphabet depends on it.
 */
export function runBrainStep(
  components: CircuitComponent[],
  wires: Wire[],
  innerMode: BuildMode,
  sense: TurbotSense,
  brainState: BrainState,
  notation: TMNotation = 'binary'
): BrainStepResult | null {
  // Circuit brains see the 1-bit sensor: block/boundary = 1, else 0.
  const sensorBit: 0 | 1 = sense === 'B' ? 1 : 0;

  if (innerMode === 'CC') {
    const motorBits = evaluateCCInputs(components, wires, [sensorBit]);
    const motor = decodeMotorCommand(motorBits);
    return { motor, input: String(sensorBit), action: motor, brainState: {} };
  }

  if (innerMode === 'SC') {
    const sortedInputs = components
      .filter((c) => c.type === 'INPUT')
      .sort((a, b) => (parseInt(a.label.replace('IN', '')) || 0) - (parseInt(b.label.replace('IN', '')) || 0));
    const sortedOutputs = components
      .filter((c) => c.type === 'OUTPUT')
      .sort((a, b) => (parseInt(a.label.replace('OUT', '')) || 0) - (parseInt(b.label.replace('OUT', '')) || 0));
    const sortedMems = components
      .filter((c) => c.type === 'MEM')
      .sort((a, b) => (parseInt(a.label.replace(/\D/g, '')) || 0) - (parseInt(b.label.replace(/\D/g, '')) || 0));
    const step = evaluateSCSingleStep(
      components, wires, [sensorBit],
      sortedInputs, sortedOutputs, sortedMems, brainState.memValues ?? []
    );
    const motor = decodeMotorCommand(step.outputBits);
    return { motor, input: String(sensorBit), action: motor, brainState: { memValues: step.newMemValues } };
  }

  if (innerMode === 'FSM') {
    if (!brainState.stateId) return null;
    const result = evaluateFSMSingleStep(wires, brainState.stateId, sensorBit);
    if (!result) return null;
    // An FSM's Mealy transition label only carries one output bit, so
    // FSM-brained turbots use only the "stop"/"forward" half of the 2-bit
    // motor command space (spec §9.3): 0 -> stop, 1 -> forward.
    const motor: TurbotMotorCommand = result.output === 1 ? 'forward' : 'stop';
    return { motor, input: String(sensorBit), action: motor, brainState: { stateId: result.nextStateId } };
  }

  // Turbot TM (textbook model): the current state's kind picks the op.
  if (!brainState.stateId || !brainState.tape) return null;
  const current = components.find((c) => c.id === brainState.stateId);
  if (!current) return null;
  const transitions = wires.filter((w) => w.sourceComponentId === brainState.stateId);

  if (stateKindOf(current) === 'external') {
    // External op: sense B/E/F, move/turn; tape untouched.
    for (const t of transitions) {
      const parsed = parseTurbotExternalLabel(t.transitionLabel);
      if (!parsed || parsed.sense !== sense) continue;
      return {
        motor: parsed.motor,
        input: sense,
        action: parsed.motor,
        brainState: { stateId: t.targetComponentId, tape: brainState.tape },
      };
    }
    return null;
  }

  // Internal op: read the tape, write a symbol OR move the head; pose untouched.
  const read = readCell(brainState.tape, brainState.tape.head);
  for (const t of transitions) {
    const parsed = parseTurbotInternalLabel(t.transitionLabel, notation);
    if (!parsed || parsed.read !== read) continue;
    return {
      motor: null,
      input: read,
      action: parsed.action.kind === 'move' ? `move ${parsed.action.dir}` : `write ${parsed.action.symbol}`,
      brainState: {
        stateId: t.targetComponentId,
        tape: applyTurbotTapeAction(brainState.tape, parsed.action),
      },
    };
  }
  return null;
}

// ─── Driver loop ─────────────────────────────────────────────────────

export interface TurbotRunResult {
  finalState: TurbotState;
  history: TurbotHistoryEntry[];
  haltedByMotor: boolean;    // circuit brain output "stop" (00)
  haltedByBrain: boolean;    // FSM/TM brain halted (no matching transition)
  /**
   * The turbot deliberately came to rest: a circuit brain output "stop", or
   * a turbot TM halted (it has no stop output — halting IS its stop, per the
   * textbook). An FSM brain that merely halts is a dead machine, not a stop.
   */
  stopped: boolean;
  hitStepLimit: boolean;
}

/**
 * Run a turbot in an arena until it stops (motor "00"), its brain halts
 * (FSM/TM with no matching transition), or `maxSteps` transitions elapse
 * (for a turbot TM every transition — internal or external — is one step).
 * Mirrors evaluateTMSequence's step/halt/history loop (engine/tm.ts).
 */
export function runTurbot(
  components: CircuitComponent[],
  wires: Wire[],
  innerMode: BuildMode,
  arena: ArenaConfig,
  maxSteps: number,
  notation: TMNotation = 'binary'
): TurbotRunResult {
  let state: TurbotState = { ...arena.start };
  let brainState = initialBrainState(components, innerMode);
  const history: TurbotHistoryEntry[] = [];

  for (let step = 0; step < maxSteps; step++) {
    const sense = senseAheadSymbol(arena, state);
    const stepResult = runBrainStep(components, wires, innerMode, sense, brainState, notation);
    if (!stepResult) {
      const isTM = innerMode === 'TM';
      return { finalState: state, history, haltedByMotor: false, haltedByBrain: true, stopped: isTM, hitStepLimit: false };
    }
    if (stepResult.motor !== null) {
      state = applyMotorCommand(arena, state, stepResult.motor);
    }
    brainState = stepResult.brainState;
    history.push({
      t: step + 1,
      kind: stepResult.motor === null ? 'internal' : 'external',
      input: stepResult.input,
      action: stepResult.action,
      x: state.x,
      y: state.y,
      facing: state.facing,
    });
    if (stepResult.motor === 'stop') {
      return { finalState: state, history, haltedByMotor: true, haltedByBrain: false, stopped: true, hitStepLimit: false };
    }
  }

  return { finalState: state, history, haltedByMotor: false, haltedByBrain: false, stopped: false, hitStepLimit: true };
}

// ─── Success criteria (spec §12.5) ───────────────────────────────────

function isGoal(arena: ArenaConfig, x: number, y: number): boolean {
  return cellAt(arena, x, y) === 'goal';
}

/**
 * Judge a completed run against its success criterion. `reach-and-stop`
 * requires the turbot to have deliberately stopped on the goal cell (motor
 * "00" for circuit brains; halting, for a turbot TM); `pass-through` only
 * requires the goal to appear somewhere in the position trace;
 * `return-to-start` only checks the final position (facing is not checked —
 * the spec doesn't require a particular final orientation).
 */
export function evaluateTurbotCriterion(
  arena: ArenaConfig,
  run: TurbotRunResult,
  criterion: TurbotSuccessCriterion
): boolean {
  switch (criterion) {
    case 'reach-and-stop':
      return run.stopped && isGoal(arena, run.finalState.x, run.finalState.y);
    case 'pass-through':
      if (isGoal(arena, arena.start.x, arena.start.y)) return true;
      return run.history.some((h) => isGoal(arena, h.x, h.y));
    case 'return-to-start':
      return run.finalState.x === arena.start.x && run.finalState.y === arena.start.y;
  }
}
