// Turbot evaluation engine.
//
// Framework-agnostic: no React, no Zustand, no DOM. Importable from Node (CLI grader).
//
// A turbot is not a fifth simulation engine — its "brain" is an ordinary
// CC/SC/FSM/TM circuit wired to a fixed 1-bit sensor input and 2-bit motor
// output (spec §9). This module is a driver loop around the existing
// per-mode single-step evaluators (evaluateCCInputs, evaluateSCSingleStep,
// evaluateFSMSingleStep, evaluateTMSingleStep): each movement cycle senses
// the arena, runs one brain step, applies the resulting motor command to the
// turbot's pose, and records history — mirroring evaluateTMSequence's
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
  TurbotHistoryEntry,
  TurbotSuccessCriterion,
  TMTape,
} from '../types';
import { evaluateCCInputs } from './cc';
import { evaluateSCSingleStep } from './sc';
import { sortStateComponents, evaluateFSMSingleStep } from './fsm';
import { readCell, applyAction, parseTMTransition } from './tm';

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

/** Sensor reading: 0 = empty ahead, 1 = block or boundary ahead (spec §9.2). */
export function senseAhead(arena: ArenaConfig, state: TurbotState): 0 | 1 {
  const { dx, dy } = FACING_DELTA[state.facing];
  const ahead = cellAt(arena, state.x + dx, state.y + dy);
  return ahead === 'block' || ahead === 'boundary' ? 1 : 0;
}

/** Decode the inner circuit's 2-bit motor output (spec §9.2, Appendix B). */
export function decodeMotorCommand(bits: number[]): TurbotMotorCommand {
  const b0 = bits[0] ?? 0;
  const b1 = bits[1] ?? 0;
  if (b0 === 0 && b1 === 0) return 'stop';
  if (b0 === 0 && b1 === 1) return 'left';
  if (b0 === 1 && b1 === 0) return 'right';
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

// ─── Brain step ──────────────────────────────────────────────────────
// Each inner mode carries its own state across cycles (MEM values for SC,
// current state id for FSM/TM); CC is stateless per spec §9.3.

export interface BrainState {
  memValues?: number[];   // SC: current MEM stored values
  stateId?: string;       // FSM/TM: current control-state component id
  tape?: TMTape;          // TM: current tape (turbot TMs read/write their own scratch tape)
}

export interface BrainStepResult {
  motorBits: number[];
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
 * Run one cycle of the inner brain: given the sensor bit and prior brain
 * state, produce the 2-bit motor output and the next brain state. Returns
 * null only for FSM/TM brains that halt (no matching transition) — CC/SC
 * brains never halt (spec §9.3: they react every cycle).
 */
export function runBrainStep(
  components: CircuitComponent[],
  wires: Wire[],
  innerMode: BuildMode,
  sensorBit: 0 | 1,
  brainState: BrainState
): BrainStepResult | null {
  if (innerMode === 'CC') {
    const motorBits = evaluateCCInputs(components, wires, [sensorBit]);
    return { motorBits, brainState: {} };
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
    return { motorBits: step.outputBits, brainState: { memValues: step.newMemValues } };
  }

  if (innerMode === 'FSM') {
    if (!brainState.stateId) return null;
    const result = evaluateFSMSingleStep(wires, brainState.stateId, sensorBit);
    if (!result) return null;
    // An FSM's Mealy transition label only carries one output bit, so
    // FSM-brained turbots use only the "stop"/"forward" half of the 2-bit
    // motor command space (spec §9.3): duplicating the single output bit
    // gives 00 (stop) or 11 (forward) — never 01/10 (turn).
    return { motorBits: [result.output, result.output], brainState: { stateId: result.nextStateId } };
  }

  // TM
  if (!brainState.stateId || !brainState.tape) return null;
  const sensorSymbol = sensorBit === 1 ? '1' : '0';
  const tapeWithSensor: TMTape = { ...brainState.tape, cells: { ...brainState.tape.cells, [brainState.tape.head]: sensorSymbol } };
  const transitions = wires.filter((w) => w.sourceComponentId === brainState.stateId);
  for (const t of transitions) {
    const parsed = parseTMTransition(t.transitionLabel, 'unary');
    if (!parsed) continue;
    if (parsed.input !== readCell(tapeWithSensor, tapeWithSensor.head)) continue;
    const newTape = applyAction(tapeWithSensor, parsed.action);
    // Same stop/forward-only mapping as FSM (see above): the write bit
    // doubles as both motor bits.
    const motorBit = parsed.action.write === '1' ? 1 : 0;
    return {
      motorBits: [motorBit, motorBit],
      brainState: { stateId: t.targetComponentId, tape: newTape },
    };
  }
  return null;
}

// ─── Driver loop ─────────────────────────────────────────────────────

export interface TurbotRunResult {
  finalState: TurbotState;
  history: TurbotHistoryEntry[];
  haltedByMotor: boolean;    // brain output "stop" (00)
  haltedByBrain: boolean;    // FSM/TM brain halted (no matching transition)
  hitStepLimit: boolean;
}

/**
 * Run a turbot in an arena until it stops (motor "00"), its brain halts
 * (FSM/TM with no matching transition), or `maxSteps` movement cycles
 * elapse. Mirrors evaluateTMSequence's step/halt/history loop (engine/tm.ts).
 */
export function runTurbot(
  components: CircuitComponent[],
  wires: Wire[],
  innerMode: BuildMode,
  arena: ArenaConfig,
  maxSteps: number
): TurbotRunResult {
  let state: TurbotState = { ...arena.start };
  let brainState = initialBrainState(components, innerMode);
  const history: TurbotHistoryEntry[] = [];

  for (let step = 0; step < maxSteps; step++) {
    const sensor = senseAhead(arena, state);
    const stepResult = runBrainStep(components, wires, innerMode, sensor, brainState);
    if (!stepResult) {
      return { finalState: state, history, haltedByMotor: false, haltedByBrain: true, hitStepLimit: false };
    }
    const motor = decodeMotorCommand(stepResult.motorBits);
    state = applyMotorCommand(arena, state, motor);
    brainState = stepResult.brainState;
    history.push({ t: step + 1, sensor, motor, x: state.x, y: state.y, facing: state.facing });
    if (motor === 'stop') {
      return { finalState: state, history, haltedByMotor: true, haltedByBrain: false, hitStepLimit: false };
    }
  }

  return { finalState: state, history, haltedByMotor: false, haltedByBrain: false, hitStepLimit: true };
}

// ─── Success criteria (spec §12.5) ───────────────────────────────────

function isGoal(arena: ArenaConfig, x: number, y: number): boolean {
  return cellAt(arena, x, y) === 'goal';
}

/**
 * Judge a completed run against its success criterion. `reach-and-stop`
 * requires the turbot to have halted itself on the goal cell;
 * `pass-through` only requires the goal to appear somewhere in the position
 * trace; `return-to-start` only checks the final position (facing is not
 * checked — the spec doesn't require a particular final orientation).
 */
export function evaluateTurbotCriterion(
  arena: ArenaConfig,
  run: TurbotRunResult,
  criterion: TurbotSuccessCriterion
): boolean {
  switch (criterion) {
    case 'reach-and-stop':
      return run.haltedByMotor && isGoal(arena, run.finalState.x, run.finalState.y);
    case 'pass-through':
      if (isGoal(arena, arena.start.x, arena.start.y)) return true;
      return run.history.some((h) => isGoal(arena, h.x, h.y));
    case 'return-to-start':
      return run.finalState.x === arena.start.x && run.finalState.y === arena.start.y;
  }
}
