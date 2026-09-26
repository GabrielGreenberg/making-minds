// A combinational circuit's output panel (task 053; design memo
// editor-workbench.md §Output panel): the circuit's live truth table — every
// row computed at once, since CC propagation is instantaneous (engine/cc.ts
// truthTableCC, the grader's own evaluation). The row matching the current
// inputs is highlighted; clicking a row sets the canvas inputs to it and
// readies its signal-flow animation, which the output panel's one control row
// then plays (Gabriel, 2026-09-25: CC keeps its animation).

import { useMemo, type KeyboardEvent } from 'react';
import { useStore } from '../store';
import { sortByLabel, truthTableCC, TRUTH_TABLE_MAX_INPUTS } from '../engine';
import { GradedCaseBanner } from './GradedCaseBanner';

export function LiveTruthTable() {
  const components = useStore((s) => s.components);
  const wires = useStore((s) => s.wires);
  const localStepActive = useStore((s) => s.localStepActive);
  const localStepSelectedKey = useStore((s) => s.localStepSelectedKey);
  const localStepSelect = useStore((s) => s.localStepSelect);

  const table = useMemo(() => truthTableCC(components, wires), [components, wires]);

  // The current row: the one being played, else the inputs as they stand —
  // none while any input is still blank.
  const inputs = sortByLabel(components, 'IN');
  const currentKey = localStepActive && localStepSelectedKey
    ? localStepSelectedKey
    : inputs.every((c) => c.value === 0 || c.value === 1)
      ? inputs.map((c) => c.value).join(',')
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
                const key = row.inputBits.join(',');
                const current = key === currentKey;
                return (
                  <tr
                    key={key}
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
                    {row.outputBits.map((b, j) => {
                      const cls = [j === 0 ? 'op-out' : '', table.wired[j] && b === 1 ? 'op-1' : ''].filter(Boolean).join(' ');
                      return <td key={`o${j}`} className={cls || undefined}>{table.wired[j] ? b : ''}</td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="op-note">Click a row to set the inputs.</p>
        </>
      )}
    </div>
  );
}
