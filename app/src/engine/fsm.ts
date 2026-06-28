// FSM (Finite State Machine) evaluation engine.
//
// Framework-agnostic: no React, no Zustand, no DOM. Importable from Node (CLI grader).

import type { CircuitComponent, Wire } from '../types';

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

export interface FSMStepResult {
  output: number;
  nextStateId: string;
}

/**
 * Attempt a single FSM transition from `currentStateId` on `inputBit`.
 * Returns null if no matching transition exists (machine would halt).
 */
export function evaluateFSMSingleStep(
  wires: Wire[],
  currentStateId: string,
  inputBit: number
): FSMStepResult | null {
  const transitions = wires.filter((w) => w.sourceComponentId === currentStateId);
  for (const t of transitions) {
    if (!t.transitionLabel) continue;
    const parts = t.transitionLabel.split(':');
    if (parts.length !== 2 || !/^[01]$/.test(parts[0]) || !/^[01]$/.test(parts[1])) continue;
    if (parseInt(parts[0]) === inputBit) {
      return { output: parseInt(parts[1]), nextStateId: t.targetComponentId };
    }
  }
  return null;
}

export interface FSMEvalResult {
  outputBits: number[];
  halted: boolean;
  haltedAt?: number; // 0-based index of the step where it halted
}

/**
 * Run a Mealy FSM against a sequence of single input bits, starting at S₀.
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
  const states = sortStateComponents(components);
  if (states.length === 0) {
    return { outputBits: [], halted: true, haltedAt: 0 };
  }

  let currentStateId = states[0].id;
  const outputBits: number[] = [];

  for (let i = 0; i < inputBits.length; i++) {
    const result = evaluateFSMSingleStep(wires, currentStateId, inputBits[i]);
    if (!result) {
      return { outputBits, halted: true, haltedAt: i };
    }
    outputBits.push(result.output);
    currentStateId = result.nextStateId;
  }

  return { outputBits, halted: false };
}
