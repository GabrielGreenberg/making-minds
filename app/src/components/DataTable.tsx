import { useMemo, useState, useCallback, useRef } from 'react';
import { useStore } from '../store';
import type { CircuitComponent, Scope } from '../types';

/** Valid tally: consecutive 1's from the left, then 0's. Returns count or null. */
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
  const scope = useStore((s) => s.scope);
  const setScope = useStore((s) => s.setScope);

  // SC state
  const scHistory = useStore((s) => s.scHistory);
  const scInputSequence = useStore((s) => s.scInputSequence);
  const scTimeStep = useStore((s) => s.scTimeStep);
  const setScInputBit = useStore((s) => s.setScInputBit);

  const wires = useStore((s) => s.wires);
  const hasMem = components.some((c) => c.type === 'MEM');
  const isCC = buildMode === 'CC';
  const isSC = buildMode === 'SC' || hasMem;

  // ── Resizable panel ──
  const [panelWidth, setPanelWidth] = useState(260);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  const onResizePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: panelWidth };
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      const dx = dragRef.current.startX - ev.clientX;
      setPanelWidth(Math.max(160, Math.min(600, dragRef.current.startW + dx)));
    };
    const onUp = () => {
      dragRef.current = null;
      target.releasePointerCapture(e.pointerId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [panelWidth]);

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

  // Check which outputs are actually connected (have an incoming wire)
  const outputConnected = useMemo(() =>
    outputs.map((out) => wires.some((w) => w.targetComponentId === out.id)),
    [outputs, wires]
  );

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

  // CC mode: generate all 2^n input combinations
  const ccInputRows = useMemo(() => {
    if (!isCC) return null;
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
  }, [inputs.length, outputs.length, isCC]);

  if (inputs.length === 0) {
    return (
      <div className="data-table-panel" style={{ width: panelWidth }}>
        <div className="panel-resize-handle" onPointerDown={onResizePointerDown} />
        <div className="data-table-panel-inner">
          <div className="table-header" />
          <div className="data-table-content">
            <div style={{ padding: 12, color: '#999', fontSize: 12 }}>
              Add inputs and outputs to see the I/O table.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── For A/V table, only show rows that have been evaluated ──
  const avRows = isCC
    ? (ccInputRows && ccInputRows !== 'too-many'
        ? (ccInputRows as number[][])
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
        width: 18, padding: '2px 0',
        cursor: isActive ? 'default' : 'pointer',
        color: isActive ? 'var(--accent)' : '#aaa',
        border: 'none', background: 'transparent',
        fontSize: 9, textAlign: 'center',
      }}
      onClick={() => { if (!isActive) activateRow(inBits); }}
      title={isActive ? 'Current row' : 'Load this input combination'}
    >
      ▶
    </td>
  );

  // For non-CC modes, use tableRows directly
  const nonCCHasRows = !isCC && !isSC && tableRows.length > 0;

  return (
    <div className="data-table-panel" style={{ width: panelWidth }}>
      <div className="panel-resize-handle" onPointerDown={onResizePointerDown} />
      <div className="data-table-panel-inner">
      <div className="table-header">
        <div className="table-toggles">
          {isCC && tableRows.length > 0 && (
            <button className="toggle-btn" onClick={clearTableRows} style={{ fontSize: 11 }}>
              Clear Outputs
            </button>
          )}
          {!isCC && !isSC && tableRows.length > 0 && (
            <button className="toggle-btn" onClick={clearTableRows} style={{ fontSize: 11 }}>
              Clear Table
            </button>
          )}
        </div>
      </div>

      <div className="data-table-content">
        {/* ── I/O Table (CC and SC) ────────────────────────────── */}
        <div className="table-section">
          <div className="table-section-label">
            {isSC ? 'Local I/O' : 'I/O Table'}
          </div>

          {isCC && ccInputRows === 'too-many' ? (
            <div style={{ padding: 12, color: '#999', fontSize: 12 }}>
              Too many inputs (max 8) to show full truth table.
            </div>
          ) : isCC && ccInputRows ? (
            /* CC: full truth table */
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 18, border: 'none', background: 'transparent' }} />
                  {inputs.map((inp) => <th key={inp.id}>{inp.label}</th>)}
                  {outputs.map((out) => <th key={out.id}>{out.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {(ccInputRows as number[][]).map((inBits, i) => {
                  const key = inputKey(inBits);
                  const outBits = evaluatedRows.get(key);
                  const isActive = key === currentInputKey;
                  return (
                    <tr key={i} className={isActive ? 'row-active' : ''}>
                      {playBtn(inBits, isActive)}
                      {inBits.map((b, j) => (
                        <td key={`i${j}`} className={b === 1 ? 'val-1' : ''}>
                          <span className="mono-value">{b}</span>
                        </td>
                      ))}
                      {outputs.map((_, j) => (
                        <td key={`o${j}`} className={outBits && outBits[j] === 1 && outputConnected[j] ? 'val-1' : ''}>
                          <span className="mono-value">{outBits != null && outputConnected[j] ? outBits[j] : ''}</span>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : isSC ? (
            /* SC: single-row showing current input/output values on canvas */
            <table className="data-table">
              <thead>
                <tr>
                  {inputs.map((inp) => <th key={inp.id}>{inp.label}</th>)}
                  {outputs.map((out) => <th key={out.id}>{out.label}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr className="row-active">
                  {inputs.map((inp) => {
                    const v = inp.value;
                    return (
                      <td key={inp.id} className={v === 1 ? 'val-1' : ''}>
                        <span className="mono-value">{v != null ? v : ''}</span>
                      </td>
                    );
                  })}
                  {outputs.map((out, j) => {
                    const connected = outputConnected[j];
                    const v = connected ? (out.value ?? 0) : undefined;
                    return (
                      <td key={out.id} className={v === 1 ? 'val-1' : ''}>
                        <span className="mono-value">{v != null ? v : ''}</span>
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          ) : nonCCHasRows ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 18, border: 'none', background: 'transparent' }} />
                  {inputs.map((inp) => <th key={inp.id}>{inp.label}</th>)}
                  {outputs.map((out) => <th key={out.id}>{out.label}</th>)}
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
          ) : !isCC && !isSC ? (
            <div style={{ padding: 12, color: '#999', fontSize: 12 }}>
              Set input values on the canvas, then click Run to add a row.
            </div>
          ) : null}
        </div>

        {/* ── A/V Table (CC and SC) ────────────────────────────── */}
        {(avRows.length > 0 || isSC) && (
          <div className="table-section">
            <div className="table-section-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Global A/V</span>
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
            {isSC ? (
              /* SC A/V: show current step's interpreted values */
              <table className="data-table">
                <thead>
                  <tr>
                    <th>ARG</th>
                    <th>VAL</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><span className="mono-value">{inputs.every((c) => c.value != null) ? interpret(inputs.map((c) => c.value!)) : ''}</span></td>
                    <td><span className="mono-value">{outputConnected.every(Boolean) && outputs.every((c) => c.value != null) ? interpret(outputs.map((c) => c.value!)) : ''}</span></td>
                  </tr>
                </tbody>
              </table>
            ) : avRows.length > 0 ? (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>ARG</th>
                    <th>VAL</th>
                  </tr>
                </thead>
                <tbody>
                  {avRows.map((row, i) => (
                    <tr key={i}>
                      <td><span className="mono-value">{interpret(row.inputBits)}</span></td>
                      <td><span className="mono-value">{interpret(row.outputBits)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
        )}

        {/* ── SC Timeline Table ────────────────────────────────── */}
        {isSC && (
          <SCTimeline
            inputs={inputs}
            outputs={outputs}
            scHistory={scHistory}
            scInputSequence={scInputSequence}
            scTimeStep={scTimeStep}
            setScInputBit={setScInputBit}
            scope={scope}
            setScope={setScope}
            interpret={interpret}
          />
        )}
      </div>
      </div>
    </div>
  );
}

// ─── Sequential Circuit Timeline Component ───────────────────────────

function SCTimeline({
  inputs,
  outputs,
  scHistory,
  scInputSequence,
  scTimeStep,
  setScInputBit,
  scope,
  setScope,
  interpret,
}: {
  inputs: CircuitComponent[];
  outputs: CircuitComponent[];
  scHistory: { t: number; inputBits: number[]; outputBits: number[]; memValues: number[] }[];
  scInputSequence: number[][];
  scTimeStep: number;
  setScInputBit: (inputIndex: number, timeStep: number, value: number) => void;
  scope: Scope;
  setScope: (s: Scope) => void;
  interpret: (bits: number[]) => string;
}) {
  // How many time columns to show
  const maxInputLen = Math.max(...scInputSequence.map((s) => s.length), 0);
  const numCols = Math.max(scTimeStep, maxInputLen + 1, scHistory.length + 1, 1);

  const timeSteps: number[] = [];
  for (let t = 1; t <= numCols; t++) timeSteps.push(t);

  const getInputBit = (inputIdx: number, t: number): number | undefined => {
    if (scInputSequence[inputIdx] && scInputSequence[inputIdx][t - 1] !== undefined) {
      return scInputSequence[inputIdx][t - 1];
    }
    return undefined;
  };

  const getOutputBit = (outputIdx: number, t: number): number | undefined => {
    const entry = scHistory.find((h) => h.t === t);
    if (entry && entry.outputBits[outputIdx] !== undefined) {
      return entry.outputBits[outputIdx];
    }
    return undefined;
  };

  const isLocal = scope === 'local';

  return (
    <div className="table-section">
      <div className="table-section-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>Sequential Timeline</span>
        <div className="toggle-group" style={{ marginLeft: 8 }}>
          <button
            className={`toggle-btn ${scope === 'local' ? 'active' : ''}`}
            onClick={() => setScope('local')}
            style={{ fontSize: 10, padding: '2px 6px' }}
          >
            Local
          </button>
          <button
            className={`toggle-btn ${scope === 'global' ? 'active' : ''}`}
            onClick={() => setScope('global')}
            style={{ fontSize: 10, padding: '2px 6px' }}
          >
            Global
          </button>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="data-table sc-table">
          <thead>
            <tr>
              {/* Time headers: right-to-left */}
              {[...timeSteps].reverse().map((t) => (
                <th key={t} className={t === scTimeStep ? 'sc-current-step' : ''}>
                  t{t}
                </th>
              ))}
              <th className="sc-label-col"></th>
            </tr>
          </thead>
          <tbody>
            {isLocal ? (
              <>
                {/* One row per input wire */}
                {inputs.map((inp, inputIdx) => (
                  <tr key={inp.id} className="sc-input-row">
                    {[...timeSteps].reverse().map((t) => {
                      const val = getInputBit(inputIdx, t);
                      const evaluated = scHistory.some((h) => h.t === t);
                      return (
                        <td
                          key={t}
                          className={`sc-cell sc-input-cell ${val === 1 ? 'val-1' : ''} ${t === scTimeStep ? 'sc-current-step' : ''}`}
                        >
                          {evaluated ? (
                            <span className="mono-value">{val ?? 0}</span>
                          ) : (
                            <input
                              type="text"
                              className="sc-input-field"
                              value={val !== undefined ? String(val) : ''}
                              placeholder="0"
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === '0' || v === '1' || v === '') {
                                  setScInputBit(inputIdx, t, v === '1' ? 1 : 0);
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === '0' || e.key === '1') {
                                  e.preventDefault();
                                  setScInputBit(inputIdx, t, e.key === '1' ? 1 : 0);
                                  const next = e.currentTarget.parentElement?.previousElementSibling?.querySelector('input');
                                  if (next instanceof HTMLInputElement) next.focus();
                                }
                              }}
                              style={{ width: 20, textAlign: 'center', border: 'none', background: 'transparent', color: 'inherit', fontSize: 11 }}
                            />
                          )}
                        </td>
                      );
                    })}
                    <td className="sc-label-col">{inp.label}</td>
                  </tr>
                ))}
                {/* One row per output wire */}
                {outputs.map((out, outputIdx) => (
                  <tr key={out.id} className="sc-output-row">
                    {[...timeSteps].reverse().map((t) => {
                      const val = getOutputBit(outputIdx, t);
                      return (
                        <td
                          key={t}
                          className={`sc-cell ${val === 1 ? 'val-1' : ''} ${t === scTimeStep ? 'sc-current-step' : ''}`}
                        >
                          <span className="mono-value">{val !== undefined ? val : ''}</span>
                        </td>
                      );
                    })}
                    <td className="sc-label-col">{out.label}</td>
                  </tr>
                ))}
              </>
            ) : (
              <>
                {/* Global view: one IN row and one OUT row with interpreted values */}
                <tr className="sc-input-row">
                  {[...timeSteps].reverse().map((t) => {
                    const entry = scHistory.find((h) => h.t === t);
                    if (entry) {
                      return (
                        <td key={t} className={`sc-cell ${t === scTimeStep ? 'sc-current-step' : ''}`}>
                          <span className="mono-value">{interpret(entry.inputBits)}</span>
                        </td>
                      );
                    }
                    const bits = inputs.map((_, idx) => getInputBit(idx, t) ?? 0);
                    const allEmpty = bits.every((b) => b === 0) && scInputSequence.length === 0;
                    return (
                      <td key={t} className={`sc-cell sc-input-cell ${t === scTimeStep ? 'sc-current-step' : ''}`}>
                        <span className="mono-value" style={{ opacity: allEmpty ? 0.3 : 1 }}>{interpret(bits)}</span>
                      </td>
                    );
                  })}
                  <td className="sc-label-col">IN</td>
                </tr>
                <tr className="sc-output-row">
                  {[...timeSteps].reverse().map((t) => {
                    const entry = scHistory.find((h) => h.t === t);
                    return (
                      <td key={t} className={`sc-cell ${t === scTimeStep ? 'sc-current-step' : ''}`}>
                        <span className="mono-value">{entry ? interpret(entry.outputBits) : ''}</span>
                      </td>
                    );
                  })}
                  <td className="sc-label-col">OUT</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
