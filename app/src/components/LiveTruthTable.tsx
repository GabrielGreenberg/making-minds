// A combinational circuit's output panel (task 053; design memo
// editor-workbench.md §Output panel): the circuit's I/O table — every input
// row listed and computed, but an output SHOWN only for a row the student has
// run (task 075: the table is earned). What each cell shows is ccTable.ts's
// ccTableView, pure and pinned (workbenchCheck [output panel]); the rows run
// are the store's ccRunRows (a row click, the canvas inputs set to it), which
// this component only reads. The row matching the current inputs is
// highlighted; clicking a row sets the canvas inputs to it and readies its
// signal-flow animation, which the output panel's one control row then plays
// (Gabriel, 2026-09-25: CC keeps its animation).

import { useMemo, type KeyboardEvent } from 'react';
import { useStore } from '../store';
import { sortByLabel, TRUTH_TABLE_MAX_INPUTS } from '../engine';
import { ccRowKey, ccTableView, type CCOutputCellState } from '../ccTable';
import { GradedCaseBanner } from './GradedCaseBanner';

/** An output cell's class by state: unrun muted, unset faint (ccTable.ts). */
const CELL_CLASS: Record<CCOutputCellState, string> = { unwired: '', unrun: 'op-unrun', unset: 'op-unset', value: '' };

export function LiveTruthTable() {
  const components = useStore((s) => s.components);
  const wires = useStore((s) => s.wires);
  const localStepActive = useStore((s) => s.localStepActive);
  const localStepSelectedKey = useStore((s) => s.localStepSelectedKey);
  const localStepSelect = useStore((s) => s.localStepSelect);
  const ccRunRows = useStore((s) => s.ccRunRows);

  const table = useMemo(() => ccTableView(components, wires, ccRunRows), [components, wires, ccRunRows]);

  // The current row: the one being played, else the inputs as they stand —
  // none while any input is still blank.
  const inputs = sortByLabel(components, 'IN');
  const currentKey = localStepActive && localStepSelectedKey
    ? localStepSelectedKey
    : inputs.every((c) => c.value === 0 || c.value === 1)
      ? ccRowKey(inputs.map((c) => c.value as number))
      : null;

  const pick = (bits: number[], current: boolean) => {
    if (!(current && localStepActive)) localStepSelect(bits);
  };

  return (
    <div className="op-body mm-surface">
      <GradedCaseBanner />
      {table === null ? (
        <p className="op-empty">Add at least one Input and one Output to see your circuit's table.</p>
      ) : table === 'too-many' ? (
        <p className="op-empty">This circuit has more than {TRUTH_TABLE_MAX_INPUTS} inputs — too many rows to list.</p>
      ) : (
        <>
          {/* Equal columns up to the memo's 60px each, narrowing to fit a
              narrow panel rather than overflowing it. */}
          <table
            className="op-table"
            style={{ width: `min(100%, ${60 * (table.inputLabels.length + table.outputLabels.length)}px)` }}
          >
            <thead>
              <tr>
                {table.inputLabels.map((l) => <th key={`i${l}`} scope="col">{l}</th>)}
                {table.outputLabels.map((l, j) => (
                  <th key={`o${l}`} scope="col" className={j === 0 ? 'op-out' : undefined}>{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => {
                const current = row.key === currentKey;
                return (
                  <tr
                    key={row.key}
                    className={current ? 'op-row op-row--current' : 'op-row'}
                    aria-current={current ? 'true' : undefined}
                    tabIndex={0}
                    onClick={() => pick(row.inputBits, current)}
                    onKeyDown={(e: KeyboardEvent<HTMLTableRowElement>) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        pick(row.inputBits, current);
                      }
                    }}
                  >
                    {row.inputBits.map((b, j) => (
                      <td key={`i${j}`} className={b === 1 ? 'op-1' : undefined}>{b}</td>
                    ))}
                    {row.cells.map((cell, j) => {
                      const cls = [j === 0 ? 'op-out' : '', CELL_CLASS[cell.state], cell.bit === 1 ? 'op-1' : '']
                        .filter(Boolean).join(' ');
                      return <td key={`o${j}`} className={cls || undefined} title={cell.title}>{cell.text}</td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="op-note">Click a row, or set the inputs, to run it.</p>
        </>
      )}
    </div>
  );
}
