// FSM (Finite State Machine) evaluation engine.
//
// Framework-agnostic: no React, no Zustand, no DOM. Importable from Node (CLI grader).

import type { CircuitComponent, Wire } from '../types';
import { fsmNotation, type TransitionNotation } from './notation';

const SUB_DIGITS = '₀₁₂₃₄₅₆₇₈₉';

function stateNumericSuffix(label: string): number {
  return parseInt(
    label.replace('S', '').split('').map((ch) => {
      const idx = SUB_DIGITS.indexOf(ch);
      return idx >= 0 ? String(idx) : ch;
    }).join('')
  ) || 0;
}

/** Sort STATE components by numeric suffix of their label (S₀ < S₁ < …). */
export function sortStateComponents(components: CircuitComponent[]): CircuitComponent[] {
  return components
    .filter((c) => c.type === 'STATE')
    .sort((a, b) => stateNumericSuffix(a.label) - stateNumericSuffix(b.label));
}

// ─── Symbol-based evaluation (the notation seam) ─────────────────────
// An FSM consumes one INPUT SYMBOL per step — for a k-input-wire machine a
// k-character bit string ('10'), symbol char i = input wire i (cc_spec
// declaration order = codec wire order) — and emits one output symbol. Label
// syntax comes entirely from the TransitionNotation (engine/notation.ts);
// this module never dissects a label itself.

export interface FSMSymbolStepResult {
  output: string; // the transition's output symbol, e.g. '1' or '01'
  nextStateId: string;
}

/**
 * Attempt a single FSM transition from `currentStateId` on `inputSymbol`,
 * matching transition labels under `notation`. Returns null if no matching
 * transition exists (machine would halt).
 */
export function evaluateFSMSymbolStep(
  wires: Wire[],
  currentStateId: string,
  inputSymbol: string,
  notation: TransitionNotation
): FSMSymbolStepResult | null {
  const transitions = wires.filter((w) => w.sourceComponentId === currentStateId);
  for (const t of transitions) {
    const parsed = notation.parse(t.transitionLabel);
    if (!parsed) continue;
    if (parsed.input === inputSymbol) {
      return { output: parsed.outputs.join(''), nextStateId: t.targetComponentId };
    }
  }
  return null;
}

export interface FSMSymbolEvalResult {
  outputs: string[]; // one output symbol per step taken
  halted: boolean;
  haltedAt?: number; // 0-based index of the step where it halted
}

/**
 * Run a Mealy FSM against a sequence of input symbols, starting at S₀.
 */
export function evaluateFSMSymbolSequence(
  components: CircuitComponent[],
  wires: Wire[],
  inputSymbols: string[],
  notation: TransitionNotation
): FSMSymbolEvalResult {
  const states = sortStateComponents(components);
  if (states.length === 0) {
    return { outputs: [], halted: true, haltedAt: 0 };
  }

  let currentStateId = states[0].id;
  const outputs: string[] = [];

  for (let i = 0; i < inputSymbols.length; i++) {
    const result = evaluateFSMSymbolStep(wires, currentStateId, inputSymbols[i], notation);
    if (!result) {
      return { outputs, halted: true, haltedAt: i };
    }
    outputs.push(result.output);
    currentStateId = result.nextStateId;
  }

  return { outputs, halted: false };
}

// ─── Legacy single-bit API (k = 1 wrappers; signatures unchanged) ────

export interface FSMStepResult {
  output: number;
  nextStateId: string;
}

/**
 * Attempt a single FSM transition from `currentStateId` on `inputBit`.
 * Returns null if no matching transition exists (machine would halt).
 * k = 1 wrapper over `evaluateFSMSymbolStep` with the 1-bit FSM notation
 * (byte-compatible with the old inline `^[01]:[01]$` matching).
 */
export function evaluateFSMSingleStep(
  wires: Wire[],
  currentStateId: string,
  inputBit: number
): FSMStepResult | null {
  const r = evaluateFSMSymbolStep(wires, currentStateId, String(inputBit), fsmNotation(1, 1));
  return r ? { output: Number(r.output), nextStateId: r.nextStateId } : null;
}

export interface FSMEvalResult {
  outputBits: number[];
  halted: boolean;
  haltedAt?: number; // 0-based index of the step where it halted
}

/**
 * Run a Mealy FSM against a sequence of single input bits, starting at S₀.
 * k = 1 wrapper over `evaluateFSMSymbolSequence`.
 *
 * @param components - All circuit components (STATE nodes, …).
 * @param wires      - All wires; FSM transition wires carry a `transitionLabel`
 *                     of the form `"X:Y"` (input:output).
 * @param inputBits  - One bit per time step.
 * @returns outputBits (one per step taken), plus halted status.
 */
export function evaluateFSMSequence(
  components: CircuitComponent[],
  wires: Wire[],
  inputBits: number[]
): FSMEvalResult {
  const r = evaluateFSMSymbolSequence(
    components,
    wires,
    inputBits.map((b) => String(b)),
    fsmNotation(1, 1)
  );
  return {
    outputBits: r.outputs.map((o) => Number(o)),
    halted: r.halted,
    ...(r.haltedAt !== undefined ? { haltedAt: r.haltedAt } : {}),
  };
}
