// Live preview + validation for the CC question creator. Pure (no React), so the
// authoring logic is testable headlessly and the component stays presentational.
//
// The preview enumerates the input space, decodes each group to its integer
// value, evaluates each output formula, and encodes the result — exactly what
// generateCCTestVectors does at save, but it keeps the intermediate values for
// display and reports per-output formula errors instead of throwing.

import type { CCInputGroup, CCOutputGroup, CCEncoding } from '../types';
import { evalFormula, FormulaError } from '../engine/formulaEval';
import { encodeBits } from '../engine/testVectorGen';

// Guard against an explosively large input space hanging the browser. PHIL 133
// CC exercises are tiny; anything past this is almost certainly a mistake.
export const MAX_COMBOS = 1 << 16; // 65536

const IDENTIFIER_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

export interface PreviewCellInput {
  name: string;
  bits: number[];
  value: number;
}
export interface PreviewCellOutput {
  name: string;
  result: number | null; // null when the formula errored for this row
  bits: number[] | null;
}
export interface PreviewRow {
  inputs: PreviewCellInput[];
  outputs: PreviewCellOutput[];
}

export interface PreviewResult {
  rows: PreviewRow[]; // all rows (caller decides how many to render)
  totalCombos: number;
  tooLarge: boolean;
  // index in outputs[] → first error message encountered, or null if valid.
  outputErrors: (string | null)[];
  // Validation errors not tied to a specific output formula (names, widths…).
  structuralErrors: string[];
}

/** Integer values an input group can take. */
function intValues(width: number, encoding: CCEncoding): number[] {
  const max = encoding === 'unary' ? width : Math.pow(2, width) - 1;
  return Array.from({ length: max + 1 }, (_, i) => i);
}

function cartesian(lists: number[][]): number[][] {
  return lists.reduce<number[][]>(
    (acc, list) => acc.flatMap((combo) => list.map((v) => [...combo, v])),
    [[]],
  );
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

/** Build the full preview + validation result for the current spec draft. */
export function buildPreview(
  inputs: CCInputGroup[],
  outputs: CCOutputGroup[],
): PreviewResult {
  const structuralErrors = validateGroups(inputs, outputs);
  const outputErrors: (string | null)[] = outputs.map(() => null);

  // If group shapes are invalid we can't meaningfully enumerate.
  if (structuralErrors.length > 0) {
    return { rows: [], totalCombos: 0, tooLarge: false, outputErrors, structuralErrors };
  }

  const totalCombos = inputs.reduce(
    (n, g) => n * intValues(g.width, g.encoding).length,
    1,
  );
  if (totalCombos > MAX_COMBOS) {
    return {
      rows: [],
      totalCombos,
      tooLarge: true,
      outputErrors,
      structuralErrors,
    };
  }

  const combos = cartesian(inputs.map((g) => intValues(g.width, g.encoding)));
  const rows: PreviewRow[] = combos.map((values) => {
    const vars: Record<string, number> = {};
    const inputCells: PreviewCellInput[] = inputs.map((g, i) => {
      vars[g.name] = values[i];
      return { name: g.name, value: values[i], bits: encodeBits(values[i], g.width, g.encoding) };
    });

    const outputCells: PreviewCellOutput[] = outputs.map((g, gi) => {
      try {
        const result = evalFormula(g.formula, vars);
        return { name: g.name, result, bits: encodeBits(result, g.width, g.encoding) };
      } catch (e) {
        const msg = e instanceof FormulaError ? e.message : 'Invalid formula';
        if (outputErrors[gi] == null) outputErrors[gi] = msg;
        return { name: g.name, result: null, bits: null };
      }
    });

    return { inputs: inputCells, outputs: outputCells };
  });

  return { rows, totalCombos, tooLarge: false, outputErrors, structuralErrors };
}

/** True when the draft is complete and valid enough to save. */
export function canSave(preview: PreviewResult, statement: string): boolean {
  return (
    !preview.tooLarge &&
    preview.structuralErrors.length === 0 &&
    preview.outputErrors.every((e) => e == null) &&
    statement.trim().length > 0
  );
}
