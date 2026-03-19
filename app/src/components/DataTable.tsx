import { useMemo } from 'react';
import { useStore } from '../store';

/** Valid tally: n 1's followed by m 0's (n≥0, m≥0). Returns count or null. */
function bitsToTally(bits: number[]): number | null {
  let seenZero = false;
  let count = 0;
  for (const b of bits) {
    if (b === 1) {
      if (seenZero) return null; // 1 after a 0 → invalid
      count++;
    } else {
      seenZero = true;
    }
  }
  return count;
}

function bitsToBinary(bits: number[]): number {
  let val = 0;
  for (let i = 0; i < bits.length; i++) {
    val = (val << 1) | bits[i];
  }
  return val;
}

/** Key for an input combination, e.g. "0,1,0" */
function inputKey(bits: number[]): string {
  return bits.join(',');
}

export function DataTable() {
  const components = useStore((s) => s.components);
  const tableRows = useStore((s) => s.tableRows);
  const repSystem = useStore((s) => s.repSystem);
  const setRepSystem = useStore((s) => s.setRepSystem);
  const clearTableRows = useStore((s) => s.clearTableRows);
  const buildMode = useStore((s) => s.buildMode);

  const hasMem = components.some((c) => c.type === 'MEM');

  const interpret = (bits: number[]): string => {
    if (repSystem === 'tally') {
      const t = bitsToTally(bits);
      return t != null ? String(t) : '/';
    }
    return String(bitsToBinary(bits));
  };

  const inputs = components
    .filter((c) => c.type === 'INPUT')
    .sort((a, b) => {
      const numA = parseInt(a.label.replace('IN', ''));
      const numB = parseInt(b.label.replace('IN', ''));
      return numA - numB;
    });

  const outputs = components
    .filter((c) => c.type === 'OUTPUT')
    .sort((a, b) => {
      const numA = parseInt(a.label.replace('OUT', ''));
      const numB = parseInt(b.label.replace('OUT', ''));
      return numA - numB;
    });

  // Current input bits on the canvas (for highlighting the active row)
  const currentInputKey = inputKey(inputs.map((c) => c.value ?? 0));

  // Set all input toggles to match a row's input bits
  const activateRow = (inBits: number[]) => {
    const state = useStore.getState();
    inputs.forEach((inp, i) => {
      state.setInputValue(inp.id, inBits[i] ?? 0);
    });
  };

  // Build lookup of which input combinations have been evaluated
  const evaluatedRows = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const row of tableRows) {
      map.set(inputKey(row.inputBits), row.outputBits);
    }
    return map;
  }, [tableRows]);

  // CC mode: generate all 2^n input combinations (inputs only — outputs filled by Run)
  const ccInputRows = useMemo(() => {
    if (buildMode !== 'CC') return null;
    if (inputs.length === 0 || outputs.length === 0) return null;
    if (inputs.length > 8) return 'too-many';

    const n = inputs.length;
    const totalRows = 1 << n;
    const rows: number[][] = [];

    for (let i = 0; i < totalRows; i++) {
      const inputBits: number[] = [];
      for (let bit = n - 1; bit >= 0; bit--) {
        inputBits.push((i >> bit) & 1);
      }
      rows.push(inputBits);
    }
    return rows;
  }, [inputs.length, outputs.length, buildMode]);

  const isCC = buildMode === 'CC';

  if (inputs.length === 0) {
    return (
      <div className="data-table-panel">
        <div className="table-header">
        </div>
        <div className="data-table-content">
          <div style={{ padding: 12, color: '#999', fontSize: 12 }}>
            Add inputs and outputs to see the I/O table.
          </div>
        </div>
      </div>
    );
  }

  const showScopeLabels = hasMem || buildMode === 'SC';

  // For non-CC modes, use tableRows directly
  const nonCCHasRows = !isCC && tableRows.length > 0;

  // For A/V table, only show rows that have been evaluated
  const avRows = isCC
    ? (ccInputRows && ccInputRows !== 'too-many'
        ? ccInputRows
            .filter((inBits) => evaluatedRows.has(inputKey(inBits)))
            .map((inBits) => ({
              inputBits: inBits,
              outputBits: evaluatedRows.get(inputKey(inBits))!,
            }))
        : [])
    : tableRows;

  /** Small play-triangle button for a row */
  const playBtn = (inBits: number[], isActive: boolean) => (
    <td
      className="row-play-btn"
      style={{
        width: 18,
        padding: '2px 0',
        cursor: isActive ? 'default' : 'pointer',
        color: isActive ? 'var(--accent)' : '#aaa',
        border: 'none',
        background: 'transparent',
        fontSize: 9,
        textAlign: 'center',
      }}
      onClick={() => {
        if (!isActive) activateRow(inBits);
      }}
      title={isActive ? 'Current row' : 'Load this input combination'}
    >
      ▶
    </td>
  );

  return (
    <div className="data-table-panel">
      <div className="table-header">
        <div className="table-toggles">
          {!isCC && tableRows.length > 0 && (
            <button
              className="toggle-btn"
              onClick={clearTableRows}
              style={{ fontSize: 11 }}
            >
              Clear Table
            </button>
          )}
          {isCC && tableRows.length > 0 && (
            <button
              className="toggle-btn"
              onClick={clearTableRows}
              style={{ fontSize: 11 }}
            >
              Clear Outputs
            </button>
          )}
        </div>
      </div>

      <div className="data-table-content">
        {/* I/O Table */}
        <div className="table-section">
          <div className="table-section-label">
            {showScopeLabels ? 'Local I/O' : 'I/O Table'}
          </div>

          {isCC && ccInputRows === 'too-many' ? (
            <div style={{ padding: 12, color: '#999', fontSize: 12 }}>
              Too many inputs (max 8) to show full truth table.
            </div>
          ) : isCC && ccInputRows ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 18, border: 'none', background: 'transparent' }} />
                  {inputs.map((inp) => (
                    <th key={inp.id}>{inp.label}</th>
                  ))}
                  {outputs.map((out) => (
                    <th key={out.id}>{out.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(ccInputRows as number[][]).map((inBits: number[], i: number) => {
                  const key = inputKey(inBits);
                  const outBits = evaluatedRows.get(key);
                  const isActive = key === currentInputKey;
                  return (
                    <tr key={i} className={isActive ? 'row-active' : ''}>
                      {playBtn(inBits, isActive)}
                      {inBits.map((b: number, j: number) => (
                        <td key={`i${j}`} className={b === 1 ? 'val-1' : ''}>
                          <span className="mono-value">{b}</span>
                        </td>
                      ))}
                      {outputs.map((_, j) => (
                        <td key={`o${j}`} className={outBits && outBits[j] === 1 ? 'val-1' : ''}>
                          <span className="mono-value">
                            {outBits != null ? outBits[j] : ''}
                          </span>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : nonCCHasRows ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 18, border: 'none', background: 'transparent' }} />
                  {inputs.map((inp) => (
                    <th key={inp.id}>{inp.label}</th>
                  ))}
                  {outputs.map((out) => (
                    <th key={out.id}>{out.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row, i) => {
                  const key = inputKey(row.inputBits);
                  const isActive = key === currentInputKey;
                  return (
                    <tr key={i} className={isActive ? 'row-active' : ''}>
                      {playBtn(row.inputBits, isActive)}
                      {row.inputBits.map((b, j) => (
                        <td key={`i${j}`} className={b === 1 ? 'val-1' : ''}>
                          <span className="mono-value">{b}</span>
                        </td>
                      ))}
                      {row.outputBits.map((b, j) => (
                        <td key={`o${j}`} className={b === 1 ? 'val-1' : ''}>
                          <span className="mono-value">{b}</span>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : !isCC ? (
            <div style={{ padding: 12, color: '#999', fontSize: 12 }}>
              Set input values on the canvas, then click Run to add a row.
            </div>
          ) : null}
        </div>

        {/* A/V Table */}
        {avRows.length > 0 && (
          <div className="table-section">
            <div className="table-section-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>{showScopeLabels ? 'Global A/V' : 'A/V Table'}</span>
              <div className="toggle-group" style={{ marginLeft: 8 }}>
                <button
                  className={`toggle-btn ${repSystem === 'tally' ? 'active' : ''}`}
                  onClick={() => setRepSystem('tally')}
                  style={{ fontSize: 10, padding: '2px 6px' }}
                >
                  Tally
                </button>
                <button
                  className={`toggle-btn ${repSystem === 'binary' ? 'active' : ''}`}
                  onClick={() => setRepSystem('binary')}
                  style={{ fontSize: 10, padding: '2px 6px' }}
                >
                  Binary
                </button>
              </div>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>ARG</th>
                  <th>VAL</th>
                </tr>
              </thead>
              <tbody>
                {avRows.map((row, i) => {
                  const arg = interpret(row.inputBits);
                  const val = interpret(row.outputBits);
                  return (
                    <tr key={i}>
                      <td><span className="mono-value">{arg}</span></td>
                      <td><span className="mono-value">{val}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {buildMode === 'SC' && (
          <div style={{ padding: 12, color: '#999', fontSize: 12 }}>
            Sequential circuit table &mdash; use Step/Run to advance time steps.
          </div>
        )}
      </div>
    </div>
  );
}
