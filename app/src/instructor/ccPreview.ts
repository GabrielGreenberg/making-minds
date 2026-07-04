// Live validation + preview for the CC question creator. Pure (no React), so the
// authoring logic is testable headlessly and the component stays presentational.
//
// Cost model — the input space grows exponentially with total input width, so
// enumerating it on every keystroke makes editing sluggish. This module keeps two
// tiers apart:
//   • Live (cheap, runs as the instructor types): `validateGroups` (structure),
//     `countCombos` (a product, no enumeration), and `probeFormulas` (evaluate
//     each formula on ONE input) — all O(#groups), independent of the space size.
//   • On demand (bounded): `buildExamples` enumerates only the FIRST `limit`
//     inputs (default 16) when the instructor asks to preview examples.
// The exhaustive enumeration still happens exactly once, at save, in
// `generateTestCases` — never during editing.

import type { BuildMode, CCInputGroup, CCOutputGroup, RepSystem } from '../types';
import { evalFormula, FormulaError } from '../engine/formulaEval';
import { valueToBits } from '../engine/representation';
import { axisForMode } from '../engine/codec';
import { formatTMValue, notationForRepresentation } from '../engine/tmCodec';

// Guard against an explosively large input space. PHIL 133 CC exercises are tiny;
// anything past this is almost certainly a mistake, and generating the full test
// bank at save would hang the tab. Blocks save; not a per-keystroke concern.
export const MAX_COMBOS = 1 << 16; // 65536

/** Default number of example rows the on-demand preview enumerates. */
export const DEFAULT_EXAMPLE_LIMIT = 16;

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

/** Bounded example enumeration (the on-demand preview). */
export interface ExamplesResult {
  rows: PreviewRow[]; // at most `limit` rows
  shown: number; // rows.length, for convenience
  totalCombos: number; // size of the full input space
  truncated: boolean; // totalCombos > shown
  tooLarge: boolean; // space exceeds MAX_COMBOS
  outputErrors: (string | null)[];
}

/** The largest integer an input/output group can hold under `rep`. */
export function maxValue(width: number, rep: RepSystem): number {
  return rep === 'tally' ? width : Math.pow(2, width) - 1;
}

/** Integer values an input group can take under the question's representation. */
function intValues(width: number, rep: RepSystem): number[] {
  const max = maxValue(width, rep);
  return Array.from({ length: max + 1 }, (_, i) => i);
}

/**
 * Size of the full input space — a product of per-group counts, computed WITHOUT
 * enumerating anything. Cheap enough to run on every keystroke.
 */
export function countCombos(inputs: CCInputGroup[], rep: RepSystem): number {
  return inputs.reduce((n, g) => n * (maxValue(g.width, rep) + 1), 1);
}

/**
 * The first `limit` input combinations, decoded via mixed-radix from indices so we
 * never materialize the whole cartesian product (which could be up to MAX_COMBOS).
 * The last group varies fastest, matching a naive nested enumeration.
 */
function firstCombos(
  inputs: CCInputGroup[],
  rep: RepSystem,
  limit: number,
): number[][] {
  const lists = inputs.map((g) => intValues(g.width, rep));
  const total = lists.reduce((n, l) => n * l.length, 1);
  const count = Math.min(limit, total);
  const combos: number[][] = [];
  for (let i = 0; i < count; i++) {
    const combo = new Array<number>(lists.length);
    let r = i;
    for (let g = lists.length - 1; g >= 0; g--) {
      const size = lists[g].length;
      combo[g] = lists[g][r % size];
      r = Math.floor(r / size);
    }
    combos.push(combo);
  }
  return combos;
}

/** Validate group shapes (names, widths, uniqueness). Returns error messages. */
export function validateGroups(
  inputs: CCInputGroup[],
  outputs: CCOutputGroup[],
): string[] {
  const errors: string[] = [];
  if (inputs.length === 0) errors.push('Add at least one input group.');
  if (outputs.length === 0) errors.push('Add at least one output group.');

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
    if (!Number.isInteger(g.width) || g.width < 1 || g.width > 8) {
      errors.push(`Input "${g.name || '?'}" width must be between 1 and 8.`);
    }
  }
  for (const g of outputs) {
    if (!g.name.trim()) {
      errors.push('Every output group needs a name.');
    } else if (!IDENTIFIER_RE.test(g.name)) {
      errors.push(`Output name "${g.name}" must start with a letter and contain only letters, digits, or underscores.`);
    }
    if (!Number.isInteger(g.width) || g.width < 1 || g.width > 8) {
      errors.push(`Output "${g.name || '?'}" width must be between 1 and 8.`);
    }
  }
  return errors;
}

/** Evaluate one input combo → its output cells. Shared by probe and examples. */
function evalRow(
  inputs: CCInputGroup[],
  outputs: CCOutputGroup[],
  rep: RepSystem,
  values: number[],
  outputErrors: (string | null)[],
  mode: BuildMode,
): PreviewRow {
  // TM's tape axis is unbounded: don't width-truncate outputs, and render the
  // natural (unpadded) tape encoding rather than a fixed-width bit vector.
  const isTape = axisForMode(mode) === 'tape';
  const notation = notationForRepresentation(rep);

  const vars: Record<string, number> = {};
  const inputCells: PreviewCellInput[] = inputs.map((g, i) => {
    const v = values[i] ?? 0;
    vars[g.name] = v;
    return {
      name: g.name,
      value: v,
      bits: valueToBits(v, g.width, rep),
      ...(isTape ? { display: formatTMValue(v, notation) } : {}),
    };
  });

  const outputCells: PreviewCellOutput[] = outputs.map((g, gi) => {
    try {
      const result = evalFormula(g.formula, vars);
      // TM: store the raw (untruncated) value and its natural tape rendering.
      if (isTape) {
        return { name: g.name, result, bits: null, display: formatTMValue(result, notation) };
      }
      return { name: g.name, result, bits: valueToBits(result, g.width, rep) };
    } catch (e) {
      const msg = e instanceof FormulaError ? e.message : 'Invalid formula';
      if (outputErrors[gi] == null) outputErrors[gi] = msg;
      return { name: g.name, result: null, bits: null };
    }
  });

  return { inputs: inputCells, outputs: outputCells };
}

/**
 * Evaluate every output formula on a SINGLE input combination. This is the live,
 * per-keystroke feedback: it surfaces formula syntax/reference errors and shows
 * one worked example without touching the rest of the input space.
 *
 * Caller must pass structurally valid groups (see `validateGroups`) and `values`
 * aligned to `inputs` order; otherwise `valueToBits` can throw on a bad width.
 */
export function probeFormulas(
  inputs: CCInputGroup[],
  outputs: CCOutputGroup[],
  rep: RepSystem,
  values: number[],
  mode: BuildMode,
): ProbeResult {
  const outputErrors: (string | null)[] = outputs.map(() => null);
  const row = evalRow(inputs, outputs, rep, values, outputErrors, mode);
  return { row, outputErrors };
}

/**
 * Enumerate the first `limit` input combinations and evaluate the formulas over
 * them — the on-demand preview shown when the instructor confirms the formula.
 * Bounded work: never more than `limit` rows regardless of the true space size.
 *
 * Caller must pass structurally valid groups (see `validateGroups`).
 */
export function buildExamples(
  inputs: CCInputGroup[],
  outputs: CCOutputGroup[],
  rep: RepSystem,
  mode: BuildMode,
  limit: number = DEFAULT_EXAMPLE_LIMIT,
): ExamplesResult {
  const totalCombos = countCombos(inputs, rep);
  const outputErrors: (string | null)[] = outputs.map(() => null);

  if (totalCombos > MAX_COMBOS) {
    return {
      rows: [],
      shown: 0,
      totalCombos,
      truncated: true,
      tooLarge: true,
      outputErrors,
    };
  }

  const combos = firstCombos(inputs, rep, limit);
  const rows = combos.map((values) =>
    evalRow(inputs, outputs, rep, values, outputErrors, mode),
  );

  return {
    rows,
    shown: rows.length,
    totalCombos,
    truncated: totalCombos > rows.length,
    tooLarge: false,
    outputErrors,
  };
}
