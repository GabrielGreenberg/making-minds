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

// ── Authoring API (question creator) ────────────────────────────────
// The question creator no longer asks for per-group bit widths. Instructors
// give each CC input group a **max input value** (the width is derived), and
// SC/FSM/TM questions have no size field at all — their unbounded/streaming
// input spaces are tested on a fixed sample of values across a range of input
// lengths. Output widths are always derived from the largest generated output,
// so outputs are never truncated (write `x ^ y`, not "x + y mod width").

/** What the instructor authors per input group: a name and (CC only) the
 *  largest value this question tests. `maxVal` is ignored on sampled axes. */
export interface AuthoredInputGroup {
  name: string;
  maxVal: number;
}
export interface AuthoredOutputGroup {
  name: string;
  formula: string;
}

/** Binary time/tape axes: sample input values up to this many bits long. */
export const SAMPLE_MAX_LEN = 6;
/** Tally time/tape axes: test values 0..this exhaustively. */
export const TALLY_SAMPLE_MAX = 8;
/** Cap on generated cases for sampled (multi-group) input spaces. */
export const MAX_SAMPLED_CASES = 128;

/** Bits (binary) / strokes (tally) needed to hold `value`. Minimum 1. */
export function widthForValue(value: number, rep: RepSystem): number {
  const v = Math.max(0, Math.trunc(value));
  return rep === 'tally' ? Math.max(1, v) : Math.max(1, v.toString(2).length);
}

/** Largest value a sampled (time/tape) input group is tested with. */
export function sampleMax(rep: RepSystem): number {
  return rep === 'tally' ? TALLY_SAMPLE_MAX : Math.pow(2, SAMPLE_MAX_LEN) - 1;
}

/**
 * The sampled test values for one input group on the time/tape axes: 0, plus
 * the smallest / middle / largest value of each bit-length up to
 * SAMPLE_MAX_LEN. Tally spaces are tiny, so they are taken exhaustively.
 */
function sampledValues(rep: RepSystem): number[] {
  if (rep === 'tally') {
    return Array.from({ length: TALLY_SAMPLE_MAX + 1 }, (_, i) => i);
  }
  const vals = new Set<number>([0]);
  for (let len = 1; len <= SAMPLE_MAX_LEN; len++) {
    const lo = 1 << (len - 1);
    const hi = (1 << len) - 1;
    vals.add(lo);
    vals.add(hi);
    vals.add(lo + ((hi - lo) >> 1));
  }
  return [...vals].sort((a, b) => a - b);
}

/** Evenly-spaced subset of `combos` when it exceeds `cap`. */
function capCombos(combos: number[][], cap: number): number[][] {
  if (combos.length <= cap) return combos;
  const out: number[][] = [];
  for (let i = 0; i < cap; i++) {
    out.push(combos[Math.floor((i * combos.length) / cap)]);
  }
  return out;
}

/**
 * Build a question's grading spec + test bank from the authored groups.
 * Space axis (CC): exhaustive over 0..maxVal per group; input widths derived
 * from maxVal. Time/tape axes (SC/FSM/TM): a sampled subset of values across a
 * range of input lengths, capped at MAX_SAMPLED_CASES combinations. Output
 * widths are derived from the largest generated output (no truncation).
 * Throws FormulaError if any output formula is invalid on some input.
 */
export function buildQuestionBank(
  inputs: AuthoredInputGroup[],
  outputs: AuthoredOutputGroup[],
  rep: RepSystem,
  mode: BuildMode,
): { spec: CCSpec; test_cases: TestCase[] } {
  const exhaustive = axisForMode(mode) === 'space';

  const perGroup = inputs.map((g) =>
    exhaustive
      ? Array.from({ length: Math.max(0, Math.trunc(g.maxVal)) + 1 }, (_, i) => i)
      : sampledValues(rep),
  );
  const combos = exhaustive
    ? cartesian(perGroup)
    : capCombos(cartesian(perGroup), MAX_SAMPLED_CASES);

  const outMax = outputs.map(() => 0);
  const test_cases = combos.map((values) => {
    const vars: Record<string, number> = {};
    inputs.forEach((g, i) => {
      vars[g.name] = values[i];
    });
    const outs = outputs.map((o, j) => {
      const v = evalFormula(o.formula, vars);
      if (v > outMax[j]) outMax[j] = v;
      return v;
    });
    return { inputs: values, outputs: outs };
  });

  const spec: CCSpec = {
    inputs: inputs.map((g) =>
      exhaustive
        ? {
            name: g.name,
            width: widthForValue(g.maxVal, rep),
            max_value: Math.max(0, Math.trunc(g.maxVal)),
          }
        : { name: g.name, width: widthForValue(sampleMax(rep), rep) },
    ),
    outputs: outputs.map((o, j) => ({
      name: o.name,
      width: widthForValue(outMax[j], rep),
      formula: o.formula,
    })),
  };
  return { spec, test_cases };
}

/**
 * Generate all test cases for a question spec by exhaustive enumeration over the
 * input space under `rep`. Throws FormulaError (propagated from evalFormula) if
 * any output formula is invalid. (Legacy width-based path — the question creator
 * now goes through `buildQuestionBank`; this remains for the sample data.)
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
