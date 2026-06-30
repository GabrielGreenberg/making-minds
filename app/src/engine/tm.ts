// Turing-machine evaluation engine.
//
// Framework-agnostic: no React, no Zustand, no DOM. Importable from Node (CLI grader).
//
// A TM here is "the FSM editor + a tape": STATE components are the control
// states and wires carry a `transitionLabel`. Where an FSM label is
// `input:output`, a TM label is `input:action` (spec §10.3) where action is a
// single tape primitive: R (move right), L (move left), 1 (write 1), 0 (write
// 0). Exactly one action happens per step — a write and a move are two
// separate transitions/steps.

import type { CircuitComponent, Wire, TmHistoryEntry } from '../types';
import { sortStateComponents } from './fsm';

export type TMActionToken = 'R' | 'L' | '0' | '1';

export interface TMAction {
  raw: TMActionToken;
  kind: 'move' | 'write';
  dir?: 'L' | 'R';   // when kind === 'move'
  bit?: 0 | 1;       // when kind === 'write'
}

/**
 * A two-way-infinite tape. Only non-default cells are stored; every unstored
 * cell reads 0. `head` is the integer index of the cell under the read/write
 * head. Cells are kept sparse (a plain object keyed by integer index) so the
 * tape can grow in either direction without offset bookkeeping and serializes
 * cleanly.
 */
export interface TMTape {
  cells: Record<number, 0 | 1>;
  head: number;
}

/** Read the bit under a given index (default 0 for unwritten cells). */
export function readCell(tape: TMTape, index: number): 0 | 1 {
  return tape.cells[index] ?? 0;
}

/** Build a fresh tape from an input bit vector written to cells 0..n-1, head at 0. */
export function makeTape(inputBits: number[] = []): TMTape {
  const cells: Record<number, 0 | 1> = {};
  for (let i = 0; i < inputBits.length; i++) {
    cells[i] = inputBits[i] ? 1 : 0;
  }
  return { cells, head: 0 };
}

/**
 * Read a fixed window of the tape, cells 0..length-1, as a flat bit vector.
 * This is how grading recovers an "output vector" from the final tape, mirroring
 * the input vector that seeded it.
 */
export function readTape(tape: TMTape, length: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < length; i++) out.push(readCell(tape, i));
  return out;
}

/** Parse an action token ('R' | 'L' | '0' | '1') into a structured action, or null if invalid. */
export function parseTMAction(token: string): TMAction | null {
  switch (token) {
    case 'R': return { raw: 'R', kind: 'move', dir: 'R' };
    case 'L': return { raw: 'L', kind: 'move', dir: 'L' };
    case '0': return { raw: '0', kind: 'write', bit: 0 };
    case '1': return { raw: '1', kind: 'write', bit: 1 };
    default:  return null;
  }
}

export interface ParsedTMTransition {
  input: 0 | 1;
  action: TMAction;
}

/** Parse a transition label of the form "input:action" (e.g. "1:R", "0:1"). */
export function parseTMTransition(label: string | undefined): ParsedTMTransition | null {
  if (!label) return null;
  const parts = label.split(':');
  if (parts.length !== 2) return null;
  if (!/^[01]$/.test(parts[0])) return null;
  const action = parseTMAction(parts[1]);
  if (!action) return null;
  return { input: parts[0] === '1' ? 1 : 0, action };
}

/** Apply a tape action, returning a new tape (no mutation of the input). */
export function applyAction(tape: TMTape, action: TMAction): TMTape {
  if (action.kind === 'move') {
    return { cells: tape.cells, head: tape.head + (action.dir === 'R' ? 1 : -1) };
  }
  // write
  return { cells: { ...tape.cells, [tape.head]: action.bit! }, head: tape.head };
}

export interface TMStepResult {
  read: 0 | 1;
  action: TMAction;
  nextStateId: string;
  tape: TMTape;     // new tape after applying the action
}

/**
 * Attempt a single TM step from `currentStateId` given the current `tape`.
 * Reads the cell under the head, finds the outgoing transition matching that
 * bit, applies its action, and returns the next state + new tape.
 * Returns null if no matching transition exists (the machine halts).
 */
export function evaluateTMSingleStep(
  wires: Wire[],
  currentStateId: string,
  tape: TMTape
): TMStepResult | null {
  const read = readCell(tape, tape.head);
  const transitions = wires.filter((w) => w.sourceComponentId === currentStateId);
  for (const t of transitions) {
    const parsed = parseTMTransition(t.transitionLabel);
    if (!parsed) continue;
    if (parsed.input === read) {
      return {
        read,
        action: parsed.action,
        nextStateId: t.targetComponentId,
        tape: applyAction(tape, parsed.action),
      };
    }
  }
  return null;
}

export interface TMEvalResult {
  tape: TMTape;          // final tape (after halting or hitting the step limit)
  halted: boolean;       // true if the machine reached a configuration with no transition
  steps: number;         // number of steps actually taken
  hitStepLimit: boolean; // true if we bailed at maxSteps (likely a non-terminating machine)
  history: TmHistoryEntry[];
}

export const DEFAULT_TM_MAX_STEPS = 10000;

/**
 * Run a Turing machine from S₀ on an initial tape until it halts (no matching
 * transition) or `maxSteps` is reached. Unlike an FSM, halting is the *success*
 * condition — it means the computation finished. Hitting the step limit signals
 * a probable infinite loop.
 *
 * @param components - All circuit components (STATE nodes).
 * @param wires      - All wires; TM transition wires carry an `input:action` label.
 * @param initialTape - Starting tape (see makeTape). Defaults to a blank tape.
 * @param maxSteps   - Safety bound against non-terminating machines.
 */
export function evaluateTMSequence(
  components: CircuitComponent[],
  wires: Wire[],
  initialTape: TMTape = makeTape(),
  maxSteps: number = DEFAULT_TM_MAX_STEPS
): TMEvalResult {
  const states = sortStateComponents(components);
  if (states.length === 0) {
    return { tape: initialTape, halted: true, steps: 0, hitStepLimit: false, history: [] };
  }

  let currentStateId = states[0].id;
  let tape = initialTape;
  const history: TmHistoryEntry[] = [];

  for (let step = 0; step < maxSteps; step++) {
    const result = evaluateTMSingleStep(wires, currentStateId, tape);
    if (!result) {
      return { tape, halted: true, steps: step, hitStepLimit: false, history };
    }
    const fromState = components.find((c) => c.id === currentStateId);
    const toState = components.find((c) => c.id === result.nextStateId);
    history.push({
      t: step + 1,
      stateLabel: fromState?.label ?? '?',
      read: result.read,
      action: result.action.raw,
      headBefore: tape.head,
      nextStateLabel: toState?.label ?? '?',
    });
    currentStateId = result.nextStateId;
    tape = result.tape;
  }

  return { tape, halted: false, steps: maxSteps, hitStepLimit: true, history };
}
