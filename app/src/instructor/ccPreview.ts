// Live validation + single-input probe for the question creator. Pure (no
// React), so the authoring logic is testable headlessly and the component stays
// presentational.
//
// Cost model — everything here is O(#groups) per keystroke: `validateGroups`
// (structure), `countCombos` (a product, no enumeration), and `probeFormulas`
// (evaluate each formula on ONE input). The full test bank is generated exactly
// once, at save, by `buildQuestionBank` (engine/testVectorGen.ts) — never
// during editing.

import type { BuildMode, RepSystem } from '../types';
import { evalFormula, FormulaError } from '../engine/formulaEval';
import { valueToBits } from '../engine/representation';
import { axisForMode } from '../engine/codec';
import { formatTMValue, notationForRepresentation } from '../engine/tmCodec';
import {
  sampleMax,
  widthForValue,
  type AuthoredInputGroup,
  type AuthoredOutputGroup,
} from '../engine/testVectorGen';

// Guard against an explosively large CC input space. PHIL 133 CC exercises are
// tiny; anything past this is almost certainly a mistake, and generating the
// full test bank at save would hang the tab. Blocks save; not a per-keystroke
// concern. (Sampled SC/FSM/TM spaces are capped at generation, not here.)
export const MAX_COMBOS = 1 << 16; // 65536

/** Largest max-input-value an authored CC group may declare. */
export function maxInputLimit(rep: RepSystem): number {
  return rep === 'tally' ? 8 : 255; // ≤ 8 wires either way
}

const IDENTIFIER_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

export interface PreviewCellInput {
  name: string;
  bits: number[];
  value: number;
  // TM only: the natural (unpadded) tape encoding, shown instead of `bits`.
  display?: string;
}
export interface PreviewCellOutput {
  name: string;
  result: number | null; // null when the formula errored for this row
  bits: number[] | null;
  // TM only: the natural (unpadded) tape encoding, shown instead of `bits`.
  display?: string;
}
export interface PreviewRow {
  inputs: PreviewCellInput[];
  outputs: PreviewCellOutput[];
}

/** One-input evaluation used for the live "behavior on a single input" display. */
export interface ProbeResult {
  row: PreviewRow;
  // index in outputs[] → first error message encountered, or null if valid.
  outputErrors: (string | null)[];
}

/** The largest value the probe can feed an input group: the group's declared
 *  max on the exhaustive CC axis, the sampling bound on SC/FSM/TM. */
export function probeMax(group: AuthoredInputGroup, rep: RepSystem, mode: BuildMode): number {
  return axisForMode(mode) === 'space' ? Math.max(0, Math.trunc(group.maxVal)) : sampleMax(rep);
}

/**
 * Size of the full CC input space — a product of per-group counts, computed
 * WITHOUT enumerating anything. Cheap enough to run on every keystroke. Only
 * meaningful on the space axis (sampled axes never enumerate the space).
 */
export function countCombos(inputs: AuthoredInputGroup[]): number {
  return inputs.reduce((n, g) => n * (Math.max(0, Math.trunc(g.maxVal)) + 1), 1);
}

/** Validate group shapes (names, max values, uniqueness). Returns error messages. */
export function validateGroups(
  inputs: AuthoredInputGroup[],
  outputs: AuthoredOutputGroup[],
  rep: RepSystem,
  mode: BuildMode,
): string[] {
  const errors: string[] = [];
  if (inputs.length === 0) errors.push('Add at least one input group.');
  if (outputs.length === 0) errors.push('Add at least one output group.');
  const checkMax = axisForMode(mode) === 'space';
  const limit = maxInputLimit(rep);

  const seen = new Set<string>();
  for (const g of inputs) {
    if (!g.name.trim()) {
      errors.push('Every input group needs a name.');
    } else if (!IDENTIFIER_RE.test(g.name)) {
      errors.push(`Input name "${g.name}" must start with a letter and contain only letters, digits, or underscores.`);
    } else if (seen.has(g.name)) {
      errors.push(`Duplicate input name "${g.name}".`);
    } else {
      seen.add(g.name);
    }
    if (checkMax && (!Number.isInteger(g.maxVal) || g.maxVal < 1 || g.maxVal > limit)) {
      errors.push(`Input "${g.name || '?'}" max value must be between 1 and ${limit}.`);
    }
  }
  for (const g of outputs) {
    if (!g.name.trim()) {
      errors.push('Every output group needs a name.');
    } else if (!IDENTIFIER_RE.test(g.name)) {
      errors.push(`Output name "${g.name}" must start with a letter and contain only letters, digits, or underscores.`);
    }
  }
  return errors;
}

/**
 * Evaluate every output formula on a SINGLE input combination. This is the live,
 * per-keystroke feedback: it surfaces formula syntax/reference errors and shows
 * one worked example without touching the rest of the input space.
 *
 * Caller must pass structurally valid groups (see `validateGroups`) and `values`
 * aligned to `inputs` order.
 */
export function probeFormulas(
  inputs: AuthoredInputGroup[],
  outputs: AuthoredOutputGroup[],
  rep: RepSystem,
  values: number[],
  mode: BuildMode,
): ProbeResult {
  const outputErrors: (string | null)[] = outputs.map(() => null);
  // TM's tape axis is unbounded: render the natural (unpadded) tape encoding
  // rather than a fixed-width bit vector.
  const isTape = axisForMode(mode) === 'tape';
  const notation = notationForRepresentation(rep);

  const vars: Record<string, number> = {};
  const inputCells: PreviewCellInput[] = inputs.map((g, i) => {
    const v = values[i] ?? 0;
    vars[g.name] = v;
    return {
      name: g.name,
      value: v,
      bits: valueToBits(v, widthForValue(v, rep), rep),
      ...(isTape ? { display: formatTMValue(v, notation) } : {}),
    };
  });

  const outputCells: PreviewCellOutput[] = outputs.map((g, gi) => {
    try {
      const result = evalFormula(g.formula, vars);
      if (isTape) {
        return { name: g.name, result, bits: null, display: formatTMValue(result, notation) };
      }
      return { name: g.name, result, bits: valueToBits(result, widthForValue(result, rep), rep) };
    } catch (e) {
      const msg = e instanceof FormulaError ? e.message : 'Invalid formula';
      if (outputErrors[gi] == null) outputErrors[gi] = msg;
      return { name: g.name, result: null, bits: null };
    }
  });

  return { row: { inputs: inputCells, outputs: outputCells }, outputErrors };
}
