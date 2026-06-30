// The codec — value ↔ machine-representation, the heart of the unified grading
// pipeline (CLAUDE_KB/pipeline/codec.md).
//
// Framework-agnostic (no React/Zustand/DOM). Knows nothing about MEM/state/tape
// mechanics — only how to lay a number's bits along an axis:
//
//   space (CC)      one step; each value's bits across wires, MSB-first; groups
//                   concatenated in declaration order.
//   time (SC/FSM)   a [step][wire] grid; each value LSB-first along time on its
//                   own wire, then 0-padded to the step count. FSM is the n=1
//                   case (a single wire).
//   tape (TM)       delegated to the TM-owned helper (engine/tmCodec.ts) — the
//                   block/separator/`*` layout is irreducibly TM-specific. This
//                   module covers ONLY space/time; the grader routes the tape
//                   axis straight to tmCodec.
//
// Why LSB-first in time but MSB-first in space: the SC/FSM table runs right-to-
// left (t1 on the right), so LSB-at-t1 renders as a normal MSB-left numeral and
// matches serial-carry arithmetic. Sanity check: a 1-step delay register on the
// time axis decodes to 2x — a legal DSL formula, so the model closes on itself.
// Space stays MSB-first to match the existing "IN1 is MSB" A/V convention.

import type { BuildMode, RepSystem } from '../types';
import { valueToBits, bitsToValue, isValidCodeword } from './representation';

export type Axis = 'space' | 'time' | 'tape';

export interface CodecLayout {
  axis: Axis;
  rep: RepSystem;
  /** Per input group: bit width (space = wires/group, time = steps/group). */
  inputWidths: number[];
  /** Per output group: bit width (space = wires/group, time = steps/group). */
  outputWidths: number[];
}

/**
 * Encoded engine input. Discriminated by axis so the grader knows which engine
 * to drive. (`tape` is handled by tmCodec, never produced here.)
 */
export type EncodedInput =
  | { axis: 'space'; bits: number[] } // flat wire vector, one step
  | { axis: 'time'; steps: number[][] }; // [step][wire]

/**
 * Raw engine output, in the same shape the codec decodes. The grader builds this
 * from the engine's result. (`tape` is handled by tmCodec, never decoded here.)
 */
export type RawOutput =
  | { axis: 'space'; bits: number[] } // flat output wire vector
  | { axis: 'time'; steps: number[][] }; // [step][outWire]

/** CC → space, SC/FSM → time, TM → tape. */
export function axisForMode(mode: BuildMode): Axis {
  switch (mode) {
    case 'CC':
      return 'space';
    case 'SC':
    case 'FSM':
      return 'time';
    case 'TM':
      return 'tape';
    default:
      return 'space';
  }
}

/** Number of time steps a time-axis run takes: enough to lay out the widest
 *  input or output value, with the extras acting as drain steps for carries. */
export function stepCountFor(layout: CodecLayout): number {
  return Math.max(1, ...layout.inputWidths, ...layout.outputWidths);
}

/**
 * Encode input values into the engine input for this layout's axis. Throws on a
 * `tape` layout — the grader delegates that axis to tmCodec.
 */
export function encodeInput(values: number[], layout: CodecLayout): EncodedInput {
  const { axis, rep, inputWidths } = layout;

  if (axis === 'space') {
    const bits: number[] = [];
    inputWidths.forEach((w, i) => bits.push(...valueToBits(values[i] ?? 0, w, rep)));
    return { axis: 'space', bits };
  }

  if (axis === 'time') {
    const stepCount = stepCountFor(layout);
    const wireCount = inputWidths.length;
    // Each input value laid LSB-first along its own wire, then 0-padded.
    const perWire = inputWidths.map((w, i) => valueToBits(values[i] ?? 0, w, rep).slice().reverse());
    const steps: number[][] = [];
    for (let t = 0; t < stepCount; t++) {
      const row: number[] = [];
      for (let i = 0; i < wireCount; i++) {
        row.push(t < inputWidths[i] ? (perWire[i][t] ?? 0) : 0);
      }
      steps.push(row);
    }
    return { axis: 'time', steps };
  }

  throw new Error('encodeInput: tape axis is delegated to tmCodec');
}

/** Collect output wire `j`'s step-series (LSB-first) over its width. */
function timeOutputBits(steps: number[][], width: number, wire: number): number[] {
  const series: number[] = [];
  for (let t = 0; t < width; t++) series.push(steps[t]?.[wire] ?? 0);
  return series.reverse(); // LSB-first along time → MSB-first for the rep core
}

/**
 * Rep-level acceptance: is every output group a valid codeword? Binary always
 * accepts; tally rejects e.g. a `101` slice. Run BEFORE `decodeOutput`. (Mode-
 * level acceptance — TM halt, etc. — is the grader's / tmCodec's job.)
 */
export function outputAccepted(raw: RawOutput, layout: CodecLayout): boolean {
  const { rep, outputWidths } = layout;
  if (rep !== 'tally') return true; // binary slices are always valid

  if (raw.axis === 'space') {
    let p = 0;
    for (const w of outputWidths) {
      if (!isValidCodeword(raw.bits.slice(p, p + w), rep)) return false;
      p += w;
    }
    return true;
  }
  return outputWidths.every((w, j) => isValidCodeword(timeOutputBits(raw.steps, w, j), rep));
}

/**
 * Decode raw engine output into one value per output group. TOTAL — precondition
 * is `outputAccepted`. Space slices the flat vector by `outputWidths`; time reads
 * each output wire's step-series.
 */
export function decodeOutput(raw: RawOutput, layout: CodecLayout): number[] {
  const { rep, outputWidths } = layout;

  if (raw.axis === 'space') {
    const out: number[] = [];
    let p = 0;
    for (const w of outputWidths) {
      out.push(bitsToValue(raw.bits.slice(p, p + w), rep));
      p += w;
    }
    return out;
  }
  return outputWidths.map((w, j) => bitsToValue(timeOutputBits(raw.steps, w, j), rep));
}
