// The CC I/O table's view (task 075; design memo editor-workbench.md §Output
// panel) — pure, kept out of the JSX so workbenchCheck pins the reveal rule
// itself, not the component's tokens. The table is EARNED: every input row is
// listed and computed (engine truthTableCC, the grader's own evaluation), but
// a row's outputs are SHOWN only once the student has run it — the store's
// ccRunRows, which LiveTruthTable passes in and never writes.
//
// Unset is not 0, here as on the canvas: an earned row whose output the
// circuit leaves undriven (a gate with an unwired input on its path — the
// canvas's evaluation draws that OUTPUT blank) shows a dash, not the 0 the
// grader would read for it.

import type { CircuitComponent, Wire } from './types';
import { evaluateCC, sortByLabel, truthTableCC } from './engine';

/** A row's key: its input bits, IN-label order, joined by ',' — the ONE
 *  spelling the store records (ccRunRows) and the table looks up. */
export function ccRowKey(inputBits: readonly number[]): string {
  return inputBits.join(',');
}

/** What an output cell holds:
 *  - `unwired` — no wire reaches the OUTPUT: blank on every row;
 *  - `unrun`   — the row is not run yet: an empty, muted cell (never a 0);
 *  - `unset`   — run, but the circuit leaves the OUTPUT undriven: a dash;
 *  - `value`   — run: the row's bit. */
export type CCOutputCellState = 'unwired' | 'unrun' | 'unset' | 'value';

export interface CCOutputCell {
  state: CCOutputCellState;
  /** The cell's text: the bit only for a run row the circuit drives. */
  text: string;
  /** The bit shown (state `value` only). */
  bit?: 0 | 1;
  /** A hover note for the cells that show no bit. */
  title?: string;
}

export const CC_UNRUN_TITLE = 'Not run yet';
export const CC_UNSET_TITLE = 'No value: the circuit leaves this output undriven on this row';

/** One output cell. `bit` is the row's output as the canvas computes it: 0/1,
 *  or undefined when the circuit leaves the OUTPUT undriven on that row. */
export function ccOutputCell(wired: boolean, earned: boolean, bit: number | undefined): CCOutputCell {
  if (!wired) return { state: 'unwired', text: '' };
  if (!earned) return { state: 'unrun', text: '', title: CC_UNRUN_TITLE };
  if (bit !== 0 && bit !== 1) return { state: 'unset', text: '–', title: CC_UNSET_TITLE };
  return { state: 'value', text: String(bit), bit };
}

export interface CCTableRow {
  key: string;
  inputBits: number[];
  earned: boolean;
  cells: CCOutputCell[];
}

export interface CCTableView {
  inputLabels: string[];
  outputLabels: string[];
  rows: CCTableRow[];
}

/** Each OUTPUT's value (OUT-label order) with the INPUTs at `inputBits`, as
 *  the canvas computes it: undefined where nothing drives the OUTPUT. */
function drivenOutputs(components: CircuitComponent[], wires: Wire[], inputBits: readonly number[]): (number | undefined)[] {
  const inputs = sortByLabel(components, 'IN');
  const withInputs = components.map((c) => {
    const idx = inputs.indexOf(c);
    return idx >= 0 ? { ...c, value: inputBits[idx] } : c;
  });
  const { portValues } = evaluateCC(withInputs, wires);
  return sortByLabel(withInputs, 'OUT').map((o) => portValues.get(`${o.id}:in`) ?? undefined);
}

/**
 * The CC table as the output panel draws it: truthTableCC's rows (null with
 * no INPUT or no OUTPUT; 'too-many' past its limit), each output cell decided
 * by ccOutputCell — a bit only on a row in `earnedRows`, and there the
 * grader's bit wherever the circuit drives the OUTPUT.
 */
export function ccTableView(
  components: CircuitComponent[],
  wires: Wire[],
  earnedRows: readonly string[],
): CCTableView | 'too-many' | null {
  const table = truthTableCC(components, wires);
  if (table === null || table === 'too-many') return table;
  const earned = new Set(earnedRows);
  return {
    inputLabels: table.inputLabels,
    outputLabels: table.outputLabels,
    rows: table.rows.map((row) => {
      const key = ccRowKey(row.inputBits);
      const isEarned = earned.has(key);
      const driven = isEarned ? drivenOutputs(components, wires, row.inputBits) : [];
      return {
        key,
        inputBits: row.inputBits,
        earned: isEarned,
        cells: row.outputBits.map((b, j) =>
          ccOutputCell(table.wired[j], isEarned, isEarned && driven[j] != null ? b : undefined)),
      };
    }),
  };
}
