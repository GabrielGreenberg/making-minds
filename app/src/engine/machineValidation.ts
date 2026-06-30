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
//        per input bit {0,1} (total + deterministic; precludes a mid-run halt).
//   TM   delegated to validateTMTable (≤ one transition per read symbol; labels
//        parse) — see engine/tmValidate.ts.

import type { CircuitData, BuildMode, RepSystem } from '../types';
import type { CodecLayout } from './codec';
import { sortStateComponents } from './fsm';
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

/** Is this wire a well-formed FSM transition (label "b:b", both bits)? */
function fsmInputBit(label: string | undefined): 0 | 1 | null {
  if (!label) return null;
  const parts = label.split(':');
  if (parts.length !== 2 || !/^[01]$/.test(parts[0]) || !/^[01]$/.test(parts[1])) return null;
  return parts[0] === '1' ? 1 : 0;
}

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
    for (const s of states) {
      const outgoing = circuit.wires.filter((w) => w.sourceComponentId === s.id);
      for (const bit of [0, 1] as const) {
        const matching = outgoing.filter((w) => fsmInputBit(w.transitionLabel) === bit);
        if (matching.length !== 1) {
          return {
            ok: false,
            reason: `state ${s.label} must have exactly one transition for input ${bit} (found ${matching.length})`,
          };
        }
      }
    }
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
