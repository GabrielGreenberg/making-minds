// Turing-machine evaluation engine.
//
// Framework-agnostic: no React, no Zustand, no DOM. Importable from Node (CLI grader).
//
// A TM here is "the FSM editor + a tape": STATE components are the control
// states and wires carry a `transitionLabel`. Where an FSM label is
// `input:output`, a TM label is `input:action` (spec §10.3) where action is a
// single tape primitive: R (move right), L (move left), or write a symbol
// (`0`/`1`, plus `*` for binary machines). Exactly one action happens per step
// — a write and a move are two separate transitions/steps.
//
// This module is the PURE SIMULATION layer only (module 2 of CLAUDE_KB/engines/
// tm.md). It assumes the transition table has already passed machine-table
// validation (tmValidate.ts) — the matching transition is unique, every label
// parses — and it does NOT judge whether the output is well-formed (that is the
// post-engine acceptor in tmCodec.ts). Input encoding / output decoding also
// live in tmCodec.ts; this file no longer builds or reads tapes by content.

import type {
  CircuitComponent,
  Wire,
  TmHistoryEntry,
  TMSymbol,
  TMNotation,
  TMTape,
} from '../types';
import { sortStateComponents } from './fsm';

export type { TMTape } from '../types';

export type TMActionToken = 'R' | 'L' | '0' | '1' | '*';

export interface TMAction {
  raw: TMActionToken;
  kind: 'move' | 'write';
  dir?: 'L' | 'R';      // when kind === 'move'
  symbol?: TMSymbol;    // when kind === 'write'
}

/** True if `symbol` is a legal tape symbol for the given notation. */
export function isSymbolForNotation(symbol: string, notation: TMNotation): symbol is TMSymbol {
  if (symbol === '0' || symbol === '1') return true;
  if (symbol === '*') return notation === 'binary';
  return false;
}

/** Read the symbol under a given index ('0' for unwritten/background cells). */
export function readCell(tape: TMTape, index: number): TMSymbol {
  return tape.cells[index] ?? '0';
}

/**
 * Parse an action token into a structured action, or null if invalid for the
 * notation. `*` is a legal write only for binary machines.
 */
export function parseTMAction(token: string, notation: TMNotation): TMAction | null {
  switch (token) {
    case 'R': return { raw: 'R', kind: 'move', dir: 'R' };
    case 'L': return { raw: 'L', kind: 'move', dir: 'L' };
    case '0': return { raw: '0', kind: 'write', symbol: '0' };
    case '1': return { raw: '1', kind: 'write', symbol: '1' };
    case '*': return notation === 'binary'
      ? { raw: '*', kind: 'write', symbol: '*' }
      : null;
    default:  return null;
  }
}

export interface ParsedTMTransition {
  input: TMSymbol;
  action: TMAction;
}

/**
 * Parse a transition label of the form "input:action" (e.g. "1:R", "0:1",
 * "*:L"), notation-aware. The read symbol and the action must both be legal for
 * the machine's notation. Returns null on any malformed/illegal label.
 */
export function parseTMTransition(
  label: string | undefined,
  notation: TMNotation
): ParsedTMTransition | null {
  if (!label) return null;
  const parts = label.split(':');
  if (parts.length !== 2) return null;
  if (!isSymbolForNotation(parts[0], notation)) return null;
  const action = parseTMAction(parts[1], notation);
  if (!action) return null;
  return { input: parts[0], action };
}

/**
 * Apply a tape action, returning a new tape (no mutation of the input). A *move*
 * shares the `cells` reference (only `head` changes); a *write* returns a fresh
 * `cells` object. Writing background `'0'` deletes the key (normalise to
 * non-background) so a blank tape is `{}` and block scans walk only real marks.
 */
export function applyAction(tape: TMTape, action: TMAction): TMTape {
  if (action.kind === 'move') {
    return { cells: tape.cells, head: tape.head + (action.dir === 'R' ? 1 : -1) };
  }
  // write
  if (action.symbol === '0') {
    const cells = { ...tape.cells };
    delete cells[tape.head];
    return { cells, head: tape.head };
  }
  return { cells: { ...tape.cells, [tape.head]: action.symbol! }, head: tape.head };
}

export interface TMStepResult {
  read: TMSymbol;
  action: TMAction;
  nextStateId: string;
  tape: TMTape;     // new tape after applying the action
}

/**
 * Attempt a single TM step from `currentStateId` given the current `tape`.
 * Reads the symbol under the head, finds the outgoing transition matching that
 * symbol, applies its action, and returns the next state + new tape.
 * Returns null if no matching transition exists (the machine halts).
 *
 * Assumes a validated table (see tmValidate.ts): the matching transition is
 * unique, so the first match is the only match.
 */
export function evaluateTMSingleStep(
  wires: Wire[],
  currentStateId: string,
  tape: TMTape,
  notation: TMNotation
): TMStepResult | null {
  const read = readCell(tape, tape.head);
  const transitions = wires.filter((w) => w.sourceComponentId === currentStateId);
  for (const t of transitions) {
    const parsed = parseTMTransition(t.transitionLabel, notation);
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
 * transition) or `maxSteps` is reached. Unlike an FSM, halting is the *success
 * precondition* — it means the computation finished. Hitting the step limit
 * signals a probable infinite loop. The acceptor (tmCodec.ts) then decides
 * whether the halted tape is well-formed.
 *
 * @param components - All circuit components (STATE nodes).
 * @param wires      - All wires; TM transition wires carry an `input:action` label.
 * @param initialTape - Starting tape (built by the codec's `encodeTM`).
 * @param notation   - Tape alphabet / action set ('unary' | 'binary').
 * @param maxSteps   - Safety bound against non-terminating machines.
 */
export function evaluateTMSequence(
  components: CircuitComponent[],
  wires: Wire[],
  initialTape: TMTape,
  notation: TMNotation,
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
    const result = evaluateTMSingleStep(wires, currentStateId, tape, notation);
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
