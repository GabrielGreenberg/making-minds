// Turing-machine evaluation engine.
//
// Framework-agnostic: no React, no Zustand, no DOM. Importable from Node (CLI grader).
//
// A TM here is "the FSM editor + a tape": STATE components are the control
// states and wires carry a `transitionLabel`. Where an FSM label is
// `input:output`, a TM label is `read:write,move` (spec §10.3, two-output
// form) — one read symbol (`0`/`1`, plus `*` for binary machines) driving a
// write symbol and a move direction (`R` right, `L` left), e.g. `1:0,R`
// reads 1, writes 0, then moves right. The two outputs execute as ONE atomic
// step: every transition both writes and moves; there is no write-only or
// move-only step. Label SYNTAX (incl. the legacy dual-action alias `1:0R`)
// lives in engine/notation.ts — this engine parses through that seam.
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
import { tmNotation } from './notation';

export type { TMTape } from '../types';

export type TMMoveDir = 'L' | 'R';

export interface TMAction {
  raw: string;        // canonical action text, e.g. "0,R" (write '0', move right)
  write: TMSymbol;
  move: TMMoveDir;
}

/** Read the symbol under a given index ('0' for unwritten/background cells). */
export function readCell(tape: TMTape, index: number): TMSymbol {
  return tape.cells[index] ?? '0';
}

/**
 * Apply an action (write, then move — one atomic step), returning a new tape (no mutation of
 * the input). Writing background `'0'` deletes the key (normalise to
 * non-background) so a blank tape is `{}` and block scans walk only real marks.
 */
export function applyAction(tape: TMTape, action: TMAction): TMTape {
  let cells: TMTape['cells'];
  if (action.write === '0') {
    cells = { ...tape.cells };
    delete cells[tape.head];
  } else {
    cells = { ...tape.cells, [tape.head]: action.write };
  }
  const head = tape.head + (action.move === 'R' ? 1 : -1);
  return { cells, head };
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
  const grammar = tmNotation(notation);
  const transitions = wires.filter((w) => w.sourceComponentId === currentStateId);
  for (const t of transitions) {
    const parsed = grammar.parse(t.transitionLabel);
    if (!parsed) continue;
    if (parsed.input === read) {
      // parse() guarantees outputs[0] is a legal write symbol for the
      // notation and outputs[1] is 'R' | 'L'.
      const action: TMAction = {
        raw: parsed.outputs.join(grammar.outputSeparator ?? ''),
        write: parsed.outputs[0] as TMSymbol,
        move: parsed.outputs[1] as TMMoveDir,
      };
      return {
        read,
        action,
        nextStateId: t.targetComponentId,
        tape: applyAction(tape, action),
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
  /** The control state the run ended in (null: a machine with no states) —
   *  what a replay needs to resume a UI run exactly where this one stopped. */
  finalStateId: string | null;
}

export const DEFAULT_TM_MAX_STEPS = 10000;

/**
 * How many tape cells a run occupied — the span from the leftmost to the
 * rightmost cell it touched. This is what a question's `maxTapeCells` budget
 * caps ("use at most 20 cells of the tape", HW6 P2).
 *
 * "Touched" is the union of three things, because none alone is the whole
 * story: the cells the head sat on, the non-blank cells the run STARTED with
 * (a pre-written input block the machine reads by standing to its right is
 * tape it uses), and the non-blank cells it ENDED with. The span, not the
 * count of distinct cells: a gap the machine steps over is still tape it
 * occupies.
 */
export function tapeCellsUsed(run: TMEvalResult, initialTape: TMTape): number {
  let min = Infinity;
  let max = -Infinity;
  const touch = (i: number) => {
    if (i < min) min = i;
    if (i > max) max = i;
  };
  touch(initialTape.head);
  touch(run.tape.head);
  for (const h of run.history) touch(h.headBefore);
  for (const k of Object.keys(initialTape.cells)) touch(Number(k));
  for (const k of Object.keys(run.tape.cells)) touch(Number(k));
  return max >= min ? max - min + 1 : 0;
}

export function evaluateTMSequence(
  components: CircuitComponent[],
  wires: Wire[],
  initialTape: TMTape,
  notation: TMNotation,
  maxSteps: number = DEFAULT_TM_MAX_STEPS
): TMEvalResult {
  const states = sortStateComponents(components);
  if (states.length === 0) {
    return { tape: initialTape, halted: true, steps: 0, hitStepLimit: false, history: [], finalStateId: null };
  }

  let currentStateId = states[0].id;
  let tape = initialTape;
  const history: TmHistoryEntry[] = [];

  for (let step = 0; step < maxSteps; step++) {
    const result = evaluateTMSingleStep(wires, currentStateId, tape, notation);
    if (!result) {
      return { tape, halted: true, steps: step, hitStepLimit: false, history, finalStateId: currentStateId };
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

  return { tape, halted: false, steps: maxSteps, hitStepLimit: true, history, finalStateId: currentStateId };
}
