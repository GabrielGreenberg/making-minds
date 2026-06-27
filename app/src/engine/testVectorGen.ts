// Test-vector generation from a CC question spec (instructor authoring tooling).
//
// Pure and framework-agnostic. Called at authoring time (when an instructor
// saves a question), never at grading time: it enumerates the finite CC input
// space, evaluates each output formula, and serialises the results to the
// `test_vectors` the grader consumes. The grader (engine/grader.ts) is unchanged
// and never sees the formula again.
//
// Bit layout — must match engine/cc.ts `evaluateCCInputs`, which feeds input
// bits to INPUT components ordered IN1, IN2, … and reads OUTPUT bits ordered
// OUT1, OUT2, …. So: input groups are concatenated in declaration order, and
// within each group the MSB comes first (wire I₁ = most significant bit for
// binary). Output groups follow the same convention.

import type { CCSpec, CCEncoding } from '../types';
import { evalFormula } from './formulaEval';

/**
 * Decode a bit array to an integer under the given encoding.
 * - binary: MSB first (bits[0] is the most significant bit)
 * - unary: the count of 1-bits (so 111…1 with k ones decodes to k)
 */
export function decodeBits(bits: number[], encoding: CCEncoding): number {
  if (encoding === 'unary') {
    return bits.reduce((n, b) => n + (b ? 1 : 0), 0);
  }
  // binary, MSB first
  return bits.reduce((n, b) => n * 2 + (b ? 1 : 0), 0);
}

/**
 * Encode an integer to a bit array of exactly `width` bits under the given
 * encoding.
 * - binary: the least-significant `width` bits, MSB first (truncation gives the
 *   implicit modulus described in the spec).
 * - unary: `n` ones followed by zeros, clamped into 0..width.
 */
export function encodeBits(n: number, width: number, encoding: CCEncoding): number[] {
  if (encoding === 'unary') {
    const ones = Math.max(0, Math.min(width, n));
    return Array.from({ length: width }, (_, i) => (i < ones ? 1 : 0));
  }
  // binary, MSB first; mask to the least-significant `width` bits.
  return Array.from({ length: width }, (_, i) => (n >> (width - 1 - i)) & 1);
}

/** The valid integer values an input group can take: 0..2ⁿ−1 (binary) or 0..n (unary). */
function inputValues(width: number, encoding: CCEncoding): number[] {
  const max = encoding === 'unary' ? width : Math.pow(2, width) - 1;
  return Array.from({ length: max + 1 }, (_, i) => i);
}

/** Cartesian product of a list of value lists. */
function cartesian(lists: number[][]): number[][] {
  return lists.reduce<number[][]>(
    (acc, list) => acc.flatMap((combo) => list.map((v) => [...combo, v])),
    [[]],
  );
}

export interface CCTestVector {
  input_sequence: number[];
  expected_output: number[];
}

/**
 * Generate all test vectors for a CC question spec by exhaustive enumeration
 * over the input space. Throws FormulaError (propagated from evalFormula) if any
 * output formula is invalid or produces a value a circuit cannot represent.
 */
export function generateCCTestVectors(spec: CCSpec): CCTestVector[] {
  const combos = cartesian(spec.inputs.map((g) => inputValues(g.width, g.encoding)));

  return combos.map((values) => {
    // Bind each input group name to its integer value for formula evaluation,
    // and serialise the inputs to bits (declaration order, MSB first per group).
    const vars: Record<string, number> = {};
    const input_sequence: number[] = [];
    spec.inputs.forEach((g, i) => {
      vars[g.name] = values[i];
      input_sequence.push(...encodeBits(values[i], g.width, g.encoding));
    });

    const expected_output: number[] = [];
    for (const out of spec.outputs) {
      const result = evalFormula(out.formula, vars);
      expected_output.push(...encodeBits(result, out.width, out.encoding));
    }

    return { input_sequence, expected_output };
  });
}
