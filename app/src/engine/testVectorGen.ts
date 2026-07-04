// Test-case generation from a question spec (instructor authoring tooling).
//
// Pure and framework-agnostic. Called at authoring time (when an instructor saves
// a question), never at grading time: it enumerates the finite input space,
// evaluates each output formula, and stores the results as **numeric** test cases
// (`TestCase { inputs, outputs }`) — values, not bits. The codec (engine/codec.ts)
// turns these values into the right bits/tape per axis at grade time, so one bank
// grades CC/SC/FSM/TM alike.
//
// For the space/time axes (CC/SC/FSM) the output group's bit width is the
// **implicit modulus**: the stored output is the formula result truncated to what
// the group can represent (binary: the least-significant `width` bits; tally:
// clamped to 0..width). This mirrors the codec's `valueToBits`/`bitsToValue`, so a
// generated case always round-trips. The **tape** axis (TM) is different — the tape
// is unbounded and `encodeTM`/`decodeTM` take no width, so a correct TM writes the
// full untruncated value. There we store the raw `evalFormula` result; width only
// bounds which input values get enumerated, never the output. (See
// CLAUDE_KB/plans/question-editor-unification.md §1 and CLAUDE_KB/known_bugs.md.)

import type { BuildMode, CCSpec, RepSystem, TestCase } from '../types';
import { evalFormula } from './formulaEval';
import { valueToBits, bitsToValue } from './representation';
import { axisForMode } from './codec';

/** Apply the width-as-modulus truncation a circuit would impose on a value. */
function truncate(value: number, width: number, rep: RepSystem): number {
  return bitsToValue(valueToBits(value, width, rep), rep);
}

/** The valid integer values an input group can take: 0..2ⁿ−1 (binary) or 0..n (tally). */
function inputValues(width: number, rep: RepSystem): number[] {
  const max = rep === 'tally' ? width : Math.pow(2, width) - 1;
  return Array.from({ length: max + 1 }, (_, i) => i);
}

/** Cartesian product of a list of value lists. */
function cartesian(lists: number[][]): number[][] {
  return lists.reduce<number[][]>(
    (acc, list) => acc.flatMap((combo) => list.map((v) => [...combo, v])),
    [[]],
  );
}

/**
 * Generate all test cases for a question spec by exhaustive enumeration over the
 * input space under `rep`. Throws FormulaError (propagated from evalFormula) if
 * any output formula is invalid.
 */
export function generateTestCases(spec: CCSpec, rep: RepSystem, mode: BuildMode): TestCase[] {
  // The tape axis (TM) is unbounded — never truncate the stored output by width.
  const isTape = axisForMode(mode) === 'tape';
  const combos = cartesian(spec.inputs.map((g) => inputValues(g.width, rep)));

  return combos.map((values) => {
    const vars: Record<string, number> = {};
    spec.inputs.forEach((g, i) => {
      vars[g.name] = values[i];
    });
    const outputs = spec.outputs.map((out) => {
      const value = evalFormula(out.formula, vars);
      return isTape ? value : truncate(value, out.width, rep);
    });
    return { inputs: values, outputs };
  });
}
