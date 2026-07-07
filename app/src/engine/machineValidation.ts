// Stage 1 of the grading pipeline — machine validation (CLAUDE_KB/pipeline/
// codec.md). Static, once per question: a circuit that fails here FAILS THE
// QUESTION outright (every case 0/total), with no testing. Separated from
// decoding so `bitsToValue`/`decodeOutput` stay total and never see an invalid
// machine.
//
// Framework-agnostic (no React/Zustand/DOM). Per mode:
//   CC   interface: #INPUT == Σ inputWidths, #OUTPUT == Σ outputWidths.
//   SC   interface: #INPUT == #input groups, #OUTPUT == #output groups (one wire
//        per value; the per-value width is the step count, not structural).
//   FSM  well-definedness: ≥1 state and every STATE has exactly one transition
//        per input SYMBOL (total + deterministic; precludes a mid-run halt).
//        The symbol alphabet is all 2^kIn k-bit strings where kIn = the
//        question's input-GROUP count (cc_spec declaration order) — so a
//        multi-group FSM question either validates against the full alphabet
//        or fails Stage 1 loudly; it can never silently grade against wire 0.
//   TM   delegated to validateTMTable (≤ one transition per read symbol; labels
//        parse) — see engine/tmValidate.ts.

import type { CircuitData, BuildMode, RepSystem } from '../types';
import type { CodecLayout } from './codec';
import { sortStateComponents } from './fsm';
import { fsmNotation, validateTransitionTable } from './notation';
import { validateTMTable } from './tmValidate';
import { notationForRepresentation } from './tmCodec';

export interface MachineValidation {
  ok: boolean;
  reason?: string; // human-readable, shown to the instructor when invalid
}

const OK: MachineValidation = { ok: true };

function sum(ns: number[]): number {
  return ns.reduce((a, b) => a + b, 0);
}

/** Hard cap on FSM input groups: totality is checked over 2^kIn symbols and
 *  the editor enters symbols one bit per group — beyond 3 groups the alphabet
 *  (16+) stops being teachable or checkable. Nothing silently degrades: a
 *  wider question fails Stage 1 with an explicit reason. */
const FSM_MAX_INPUT_GROUPS = 3;

/**
 * Validate a submitted machine against the question's mode + codec layout.
 * `rep` is needed only for TM (it selects the tape notation).
 */
export function validateMachine(
  circuit: CircuitData,
  mode: BuildMode,
  layout: CodecLayout,
  rep: RepSystem,
): MachineValidation {
  const inputs = circuit.components.filter((c) => c.type === 'INPUT').length;
  const outputs = circuit.components.filter((c) => c.type === 'OUTPUT').length;

  if (mode === 'CC') {
    const wantIn = sum(layout.inputWidths);
    const wantOut = sum(layout.outputWidths);
    if (inputs !== wantIn) return { ok: false, reason: `expected ${wantIn} input wires, found ${inputs}` };
    if (outputs !== wantOut) return { ok: false, reason: `expected ${wantOut} output wires, found ${outputs}` };
    return OK;
  }

  if (mode === 'SC') {
    const wantIn = layout.inputWidths.length;
    const wantOut = layout.outputWidths.length;
    if (inputs !== wantIn) return { ok: false, reason: `expected ${wantIn} input wire(s), found ${inputs}` };
    if (outputs !== wantOut) return { ok: false, reason: `expected ${wantOut} output wire(s), found ${outputs}` };
    return OK;
  }

  if (mode === 'FSM') {
    const states = sortStateComponents(circuit.components);
    if (states.length === 0) return { ok: false, reason: 'machine has no states' };
    // THE FOOTGUN GUARD: kIn comes from the question's cc_spec input-group
    // count (via the codec layout the grader built from it), so the totality
    // check below covers every k-bit symbol the grader will feed. A machine
    // labeled for the wrong arity fails here with the arity named — it can
    // never author fine and grade wrong against wire 0 alone.
    const kIn = layout.inputWidths.length;
    const kOut = layout.outputWidths.length;
    if (kIn > FSM_MAX_INPUT_GROUPS) {
      return {
        ok: false,
        reason: `FSM questions support at most ${FSM_MAX_INPUT_GROUPS} input groups (this question declares ${kIn}; totality would need ${2 ** kIn} transitions per state)`,
      };
    }
    const notation = fsmNotation(kIn, kOut);
    const errors = validateTransitionTable(states, circuit.wires, () => notation, 'total');
    if (errors.length > 0) return { ok: false, reason: errors.map((e) => e.message).join(' ') };
    return OK;
  }

  if (mode === 'TM') {
    const notation = notationForRepresentation(rep);
    const errors = validateTMTable(circuit.components, circuit.wires, notation);
    if (errors.length > 0) return { ok: false, reason: errors.map((e) => e.message).join(' ') };
    return OK;
  }

  return OK;
}
