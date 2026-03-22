import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { useStore } from '../store';

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

  // SC state
  const scHistory = useStore((s) => s.scHistory);
  const scGlobalSequences = useStore((s) => s.scGlobalSequences);
  const setScGlobalSequenceInput = useStore((s) => s.setScGlobalSequenceInput);
  const loadScGlobalSequence = useStore((s) => s.loadScGlobalSequence);
  const scReset = useStore((s) => s.scReset);
  const scGlobalReset = useStore((s) => s.scGlobalReset);

  // For animated sequence playback
  const [isRunning, setIsRunning] = useState(false);
  const [autoFocusIndex, setAutoFocusIndex] = useState<number | null>(null);

  // Collapsible section state
  const [localOpen, setLocalOpen] = useState(true);
  const [globalOpen, setGlobalOpen] = useState(true);
  const [avOpen, setAvOpen] = useState(true);

  // Run speed: multiplier (1 = 300ms per step, 2 = 150ms, 0.5 = 600ms, etc.)
  const [runSpeed, setRunSpeed] = useState(1);
  const [showSpeedSlider, setShowSpeedSlider] = useState(false);

  // Which global I/O row is currently selected
  const [activeGlobalIndex, setActiveGlobalIndex] = useState<number | null>(null);

  // Flash animation: increment counter each step to trigger CSS animation re-run
  const [flashCounter, setFlashCounter] = useState(0);
  // Track scHistory length to detect steps
  const prevHistLenRef = useRef(0);

  // Detect when a new step happens and bump flash counter
  useEffect(() => {
    if (scHistory.length > prevHistLenRef.current) {
      setFlashCounter((c) => c + 1);
    }
    prevHistLenRef.current = scHistory.length;
  }, [scHistory.length]);

  // Run through the currently loaded global sequence with animation
  const runLoadedSequence = useCallback(() => {
    const state = useStore.getState();
    const numInputs = state.components.filter((c) => c.type === 'INPUT').length;
    const maxLen = Math.max(...state.scInputSequence.map((s) => s.length), 0);
    const remaining = maxLen - (state.scTimeStep - 1);
    if (remaining <= 0 || numInputs === 0) return;
    setIsRunning(true);
    let step = 0;
    const interval = setInterval(() => {
      const s = useStore.getState();
      const maxL = Math.max(...s.scInputSequence.map((sq) => sq.length), 0);
      if (step >= remaining || s.scTimeStep > maxL) {
        clearInterval(interval);
        setIsRunning(false);
        return;
      }
      s.scStep();
      step++;
    }, Math.round(300 / runSpeed));
  }, [runSpeed]);

  // Step once in the currently loaded sequence
  const stepLoadedSequence = useCallback(() => {
    const state = useStore.getState();
    const maxLen = Math.max(...state.scInputSequence.map((s) => s.length), 0);
    if (state.scTimeStep <= maxLen) {
      state.scStep();
    }
  }, []);

  // Reset the currently loaded sequence: clear output but keep input
  const resetLoadedSequence = useCallback(() => {
    const state = useStore.getState();
    // Find which global sequence is active and re-load it
    const seqs = state.scGlobalSequences;
    const numInputs = state.components.filter((c) => c.type === 'INPUT').length;
    const maxLen = Math.max(...state.scInputSequence.map((s) => s.length), 0);
    let currentInputStr = '';
    for (let t = maxLen - 1; t >= 0; t--) {
      for (let ii = 0; ii < numInputs; ii++) {
        currentInputStr += String(state.scInputSequence[ii]?.[t] ?? 0);
      }
    }
    const idx = seqs.findIndex((s) => s.inputStr === currentInputStr);
    if (idx >= 0) {
      // Clear the stored output
      const newSeqs = [...seqs];
      newSeqs[idx] = { ...newSeqs[idx], outputStr: '' };
      useStore.setState({ scGlobalSequences: newSeqs });
      // Re-load to reset circuit state
      loadScGlobalSequence(idx);
    }
  }, [loadScGlobalSequence]);

  const wires = useStore((s) => s.wires);
  const hasMem = components.some((c) => c.type === 'MEM');
  const isCC = buildMode === 'CC';
  const isSC = buildMode === 'SC' || hasMem;

  // ── Resizable panel ──
  // Auto-expand panel width based on longest global sequence
  const autoMinWidth = useMemo(() => {
    if (!isSC || scGlobalSequences.length === 0) return 260;
    const maxLen = Math.max(...scGlobalSequences.map((s) => Math.max(s.inputStr.length, s.outputStr.length)), 0);
    // Each char ~7px in monospace 11px, plus padding. Two equal columns + play btn + arrows
    const needed = Math.max(260, maxLen * 7 * 2 + 80);
    return needed;
  }, [isSC, scGlobalSequences]);
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

  const mems = components
    .filter((c) => c.type === 'MEM')
    .sort((a, b) => {
      const numA = parseInt(a.label.replace('M', ''));
      const numB = parseInt(b.label.replace('M', ''));
      return numA - numB;
    });

  // Check which outputs are actually connected (have an incoming wire)
  const outputConnected = useMemo(() =>
    outputs.map((out) => wires.some((w) => w.targetComponentId === out.id)),
    [outputs, wires]
  );

  // Current input bits on the canvas (for highlighting the active row)
  // For SC: use the latest history entry's input+mem combo (pre-step values)
  // so the highlight matches what was just evaluated
  const currentInputKey = useMemo(() => {
    if (isSC && scHistory.length > 0) {
      const latest = scHistory[scHistory.length - 1];
      return inputKey([...latest.inputBits, ...latest.memValues]);
    }
    if (isSC) {
      return inputKey([...inputs.map((c) => c.value ?? 0), ...mems.map((c) => c.storedValue ?? 0)]);
    }
    return inputKey(inputs.map((c) => c.value ?? 0));
  }, [isSC, scHistory, inputs, mems]);

  // Set all input toggles to match a row's input bits
  const activateRow = (inBits: number[]) => {
    const state = useStore.getState();
    inputs.forEach((inp, i) => {
      state.setInputValue(inp.id, inBits[i] ?? 0);
    });
  };

  // Set input values AND memory stored values for SC rows
  const activateScRow = (inBits: number[], memBits: number[]) => {
    const state = useStore.getState();
    inputs.forEach((inp, i) => {
      state.setInputValue(inp.id, inBits[i] ?? 0);
    });
    mems.forEach((mem, i) => {
      state.setMemStoredValue(mem.id, memBits[i] ?? 0);
    });
  };

  // Build lookup of which input combinations have been evaluated
  const evaluatedRows = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const row of tableRows) {
      const key = row.memBits
        ? inputKey([...row.inputBits, ...row.memBits])
        : inputKey(row.inputBits);
      map.set(key, row.outputBits);
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

  // SC mode: generate all 2^(inputs+mems) combinations
  const scInputRows = useMemo(() => {
    if (!isSC) return null;
    if (inputs.length === 0 || outputs.length === 0) return null;
    const totalBits = inputs.length + mems.length;
    if (totalBits > 8) return 'too-many';

    const totalRows = 1 << totalBits;
    const rows: { inputBits: number[]; memBits: number[] }[] = [];

    for (let i = 0; i < totalRows; i++) {
      const inputBits: number[] = [];
      const memBits: number[] = [];
      for (let bit = totalBits - 1; bit >= mems.length; bit--) {
        inputBits.push((i >> bit) & 1);
      }
      for (let bit = mems.length - 1; bit >= 0; bit--) {
        memBits.push((i >> bit) & 1);
      }
      rows.push({ inputBits, memBits });
    }
    return rows;
  }, [inputs.length, outputs.length, mems.length, isSC]);

  if (inputs.length === 0) {
    return (
      <div className="data-table-panel" style={{ width: Math.max(panelWidth, autoMinWidth) }}>
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

  // ── For A/V table ──
  // SC: each global sequence with output is one row (input sequence → output sequence as numerals)
  // CC: evaluated rows from the truth table
  const avRows = useMemo(() => {
    if (isSC) {
      // Build from global sequences that have outputs
      const rows: { inputBits: number[]; outputBits: number[] }[] = [];
      for (let si = 0; si < scGlobalSequences.length; si++) {
        const seq = scGlobalSequences[si];
        const isActiveSeq = activeGlobalIndex === si;
        const outStr = isActiveSeq && scHistory.length > 0
          ? scHistory.slice().sort((a, b) => b.t - a.t).map((h) => h.outputBits.join('')).join('')
          : seq.outputStr;
        if (seq.inputStr.length > 0 && outStr && outStr.length > 0) {
          const inBits = seq.inputStr.split('').map(Number);
          const outBits = outStr.split('').map(Number);
          rows.push({ inputBits: inBits, outputBits: outBits });
        }
      }
      return rows;
    }
    if (isCC) {
      return ccInputRows && ccInputRows !== 'too-many'
        ? (ccInputRows as number[][])
            .filter((inBits) => evaluatedRows.has(inputKey(inBits)))
            .map((inBits) => ({
              inputBits: inBits,
              outputBits: evaluatedRows.get(inputKey(inBits))!,
            }))
        : [];
    }
    return tableRows;
  }, [isSC, isCC, scGlobalSequences, scHistory, activeGlobalIndex, ccInputRows, evaluatedRows, tableRows]);

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
    <div className="data-table-panel" style={{ width: Math.max(panelWidth, autoMinWidth) }}>
      <div className="panel-resize-handle" onPointerDown={onResizePointerDown} />
      <div className="data-table-panel-inner">
      <div className="data-table-content">
        {/* ── I/O Table (CC and SC) ────────────────────────────── */}
        <div className="table-section">
          <div className="table-section-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }} onClick={() => setLocalOpen(!localOpen)}>
              <span className="pod-toggle">{localOpen ? '▼' : '▶'}</span>
              <span>{isSC ? 'Local I/O' : 'I/O Table'}</span>
            </div>
            <button
              className="toggle-btn"
              onClick={() => { if (tableRows.length > 0) { clearTableRows(); if (isSC) scReset(); } }}
              style={{
                fontSize: 11, padding: '2px 8px',
                color: tableRows.length > 0 ? '#555' : '#ccc',
                cursor: tableRows.length > 0 ? 'pointer' : 'default',
              }}
            >
              clear
            </button>
          </div>

          {!localOpen ? null : isSC && scInputRows === 'too-many' ? (
            <div style={{ padding: 12, color: '#999', fontSize: 12 }}>
              Too many inputs + memories (max 8) to show full table.
            </div>
          ) : isSC && scInputRows ? (
            /* SC: full truth table over inputs + memories */
            <table className="data-table">
              <colgroup>
                <col style={{ width: 18 }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ border: 'none', background: 'transparent' }} />
                  {inputs.map((inp) => <th key={inp.id}>{inp.label}</th>)}
                  {mems.map((mem) => <th key={mem.id}>{mem.label}</th>)}
                  {outputs.map((out) => <th key={out.id}>{out.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {(scInputRows as { inputBits: number[]; memBits: number[] }[]).map((row, i) => {
                  const key = inputKey([...row.inputBits, ...row.memBits]);
                  const outBits = evaluatedRows.get(key);
                  const isActive = key === currentInputKey;
                  return (
                    <tr key={isActive ? `${i}-flash-${flashCounter}` : i} className={isActive ? 'row-active row-flash' : ''}>
                      <td
                        className="row-play-btn"
                        style={{
                          width: 18, padding: '2px 0',
                          cursor: isActive ? 'default' : 'pointer',
                          color: isActive ? 'var(--accent)' : '#aaa',
                          border: 'none', background: 'transparent',
                          fontSize: 9, textAlign: 'center',
                        }}
                        onClick={() => { if (!isActive) activateScRow(row.inputBits, row.memBits); }}
                        title={isActive ? 'Current row' : 'Load this input/memory combination'}
                      >
                        ▶
                      </td>
                      {row.inputBits.map((b, j) => (
                        <td key={`i${j}`} className={b === 1 ? 'val-1' : ''}>
                          <span className="mono-value">{b}</span>
                        </td>
                      ))}
                      {row.memBits.map((b, j) => (
                        <td key={`m${j}`} className={b === 1 ? 'val-1' : ''}>
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
          ) : isCC && ccInputRows === 'too-many' ? (
            <div style={{ padding: 12, color: '#999', fontSize: 12 }}>
              Too many inputs (max 8) to show full truth table.
            </div>
          ) : isCC && ccInputRows ? (
            /* CC: full truth table */
            <table className="data-table">
              <colgroup>
                <col style={{ width: 18 }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ border: 'none', background: 'transparent' }} />
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
          ) : nonCCHasRows ? (
            <table className="data-table">
              <colgroup>
                <col style={{ width: 18 }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ border: 'none', background: 'transparent' }} />
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

        {/* ── Global I/O Table (SC only) ─────────────────────── */}
        {isSC && (
          <div className="table-section">
            <div className="table-section-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }} onClick={() => setGlobalOpen(!globalOpen)}>
                <span className="pod-toggle">{globalOpen ? '▼' : '▶'}</span>
                <span>Global I/O</span>
              </div>
              <button
                className="toggle-btn"
                onClick={() => { if (scGlobalSequences.length > 0) scGlobalReset(); }}
                style={{
                  fontSize: 11, padding: '2px 8px',
                  color: scGlobalSequences.length > 0 ? '#555' : '#ccc',
                  cursor: scGlobalSequences.length > 0 ? 'pointer' : 'default',
                }}
              >
                clear
              </button>
            </div>
            {globalOpen && <><table className="data-table">
              <colgroup>
                <col style={{ width: 18 }} />
                <col style={{ width: '50%' }} />
                <col style={{ width: '50%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ width: 18, border: 'none', background: 'transparent' }} />
                  <th>IN</th>
                  <th>OUT</th>
                </tr>
              </thead>
              <tbody>
                {/* Existing sequence rows */}
                {scGlobalSequences.map((seq, i) => {
                  const isActive = activeGlobalIndex === i;
                  // Build output string from scHistory: earliest output → rightmost
                  const outputStr = isActive && scHistory.length > 0
                    ? scHistory
                        .slice()
                        .sort((a, b) => b.t - a.t)
                        .map((h) => h.outputBits.join(''))
                        .join('')
                    : seq.outputStr;
                  // Traditional arrow: line + arrowhead pointing left
                  const seqArrow = (
                    <svg width="12" height="10" viewBox="0 0 12 10" style={{ flexShrink: 0, marginLeft: 2 }}>
                      <line x1="11" y1="5" x2="2" y2="5" stroke="#e53935" strokeWidth="1.2" />
                      <polyline points="5,2 2,5 5,8" fill="none" stroke="#e53935" strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />
                    </svg>
                  );
                  return (
                    <tr key={i} className={isActive ? 'row-active' : ''}>
                      <td
                        className="row-play-btn"
                        style={{
                          width: 18, padding: '2px 0',
                          cursor: isRunning ? 'wait' : 'pointer',
                          color: isActive ? 'var(--accent)' : '#aaa',
                          border: 'none', background: 'transparent',
                          fontSize: 9, textAlign: 'center',
                        }}
                        onClick={() => {
                          if (!isRunning && !isActive) {
                            setActiveGlobalIndex(i);
                            if (seq.inputStr.length > 0) loadScGlobalSequence(i);
                          }
                        }}
                        title={isActive ? 'Currently selected' : 'Select this input sequence'}
                      >
                        ▶
                      </td>
                      <td style={{ overflow: 'hidden' }}>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <input
                            type="text"
                            className="sc-input-field"
                            value={seq.inputStr}
                            placeholder=""
                            ref={(el) => {
                              if (el && autoFocusIndex === i) {
                                el.focus();
                                setAutoFocusIndex(null);
                              }
                            }}
                            onChange={(e) => {
                              const el = e.target;
                              const rawVal = e.target.value.replace(/[^01]/g, '');
                              const oldVal = seq.inputStr;
                              const cursor = el.selectionStart ?? rawVal.length;

                              if (rawVal.length > oldVal.length) {
                                // Character(s) inserted — figure out what was added and prepend it
                                // Find the new chars by comparing old and new
                                let added = '';
                                let oi = 0;
                                for (let ni = 0; ni < rawVal.length; ni++) {
                                  if (oi < oldVal.length && rawVal[ni] === oldVal[oi]) {
                                    oi++;
                                  } else {
                                    added += rawVal[ni];
                                  }
                                }
                                // Prepend added chars (first typed = rightmost, so prepend to put new chars on left)
                                const newVal = added + oldVal;
                                setScGlobalSequenceInput(i, newVal);
                                // Put cursor at position 0 (left side)
                                requestAnimationFrame(() => {
                                  el.setSelectionRange(0, 0);
                                });
                              } else if (rawVal.length < oldVal.length) {
                                // Deletion — figure out what was removed based on cursor position
                                // Cursor is at the deletion point
                                const deletedCount = oldVal.length - rawVal.length;
                                const newVal = oldVal.slice(0, cursor) + oldVal.slice(cursor + deletedCount);
                                setScGlobalSequenceInput(i, newVal);
                                requestAnimationFrame(() => {
                                  el.setSelectionRange(cursor, cursor);
                                });
                              } else {
                                // Same length — replacement
                                setScGlobalSequenceInput(i, rawVal);
                              }
                            }}
                            onKeyDown={(e) => {
                              const el = e.currentTarget;
                              // On focus, always put cursor at position 0 (left side)
                              if (el.selectionStart !== 0 && e.key.length === 1) {
                                el.setSelectionRange(0, 0);
                              }
                            }}
                            onFocus={(e) => {
                              // Select this row and put cursor at leftmost position
                              if (!isActive) {
                                setActiveGlobalIndex(i);
                                if (seq.inputStr.length > 0) loadScGlobalSequence(i);
                              }
                              const el = e.currentTarget;
                              requestAnimationFrame(() => {
                                el.setSelectionRange(0, 0);
                              });
                            }}
                            style={{
                              flex: 1, minWidth: 0, textAlign: 'right', border: 'none',
                              background: 'transparent', color: 'inherit',
                              fontSize: 11, fontFamily: 'monospace',
                            }}
                          />
                          {seqArrow}
                        </div>
                      </td>
                      <td style={{ overflow: 'hidden' }}>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <span className="mono-value" style={{ flex: 1, minWidth: 0, fontSize: 11, textAlign: 'right', display: 'block', overflow: 'hidden' }}>{outputStr}</span>
                          {seqArrow}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {/* Blank placeholder row — always present */}
                <tr
                  style={{ opacity: 0.5, cursor: 'pointer' }}
                  onClick={() => {
                    const newIdx = scGlobalSequences.length;
                    setScGlobalSequenceInput(newIdx, '');
                    setAutoFocusIndex(newIdx);
                    setActiveGlobalIndex(newIdx);
                  }}
                  title="Click to add a new input sequence"
                >
                  <td style={{ width: 18, padding: '2px 0', border: 'none', background: 'transparent', fontSize: 9, textAlign: 'center', color: '#ccc' }}>
                    ▶
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <span style={{ color: '#444', fontSize: 14, fontWeight: 500 }}>+</span>
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0 3px', paddingLeft: 18 }}>
              <button
                className="toggle-btn"
                onClick={() => { if (!isRunning) runLoadedSequence(); }}
                disabled={isRunning}
                style={{
                  fontSize: 11, padding: '2px 12px',
                  color: isRunning ? '#ccc' : '#555',
                  cursor: isRunning ? 'wait' : 'pointer',
                }}
              >
                Run
              </button>
              <button
                className="toggle-btn"
                onClick={() => { if (!isRunning) stepLoadedSequence(); }}
                disabled={isRunning}
                style={{
                  fontSize: 11, padding: '2px 12px',
                  color: isRunning ? '#ccc' : '#555',
                  cursor: isRunning ? 'wait' : 'pointer',
                }}
              >
                Step
              </button>
              <button
                className="toggle-btn"
                onClick={() => { if (!isRunning) resetLoadedSequence(); }}
                disabled={isRunning}
                style={{
                  fontSize: 11, padding: '2px 12px',
                  color: isRunning ? '#ccc' : '#555',
                  cursor: isRunning ? 'wait' : 'pointer',
                }}
              >
                Reset
              </button>
              <div style={{ position: 'relative', marginLeft: 'auto' }}>
                <span
                  onClick={() => setShowSpeedSlider(!showSpeedSlider)}
                  style={{
                    fontSize: 10, padding: '2px 4px',
                    color: '#888',
                    cursor: 'pointer',
                    fontFamily: 'monospace',
                  }}
                  title="Run speed"
                >
                  {runSpeed}x
                </span>
                {showSpeedSlider && (
                  <div
                    style={{
                      position: 'absolute', bottom: '100%', right: 0,
                      background: 'white', border: '1px solid #ccc',
                      borderRadius: 4, padding: '8px 12px',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                      zIndex: 100, whiteSpace: 'nowrap',
                    }}
                    onMouseLeave={() => setShowSpeedSlider(false)}
                  >
                    <div style={{ fontSize: 10, color: '#888', marginBottom: 4, textAlign: 'center' }}>Run Speed</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 10, color: '#aaa' }}>slow</span>
                      <input
                        type="range"
                        min={-2}
                        max={3}
                        step={0.5}
                        value={Math.log2(runSpeed)}
                        onChange={(e) => {
                          const exp = parseFloat(e.target.value);
                          setRunSpeed(Math.round(Math.pow(2, exp) * 10) / 10);
                        }}
                        style={{ width: 80 }}
                      />
                      <span style={{ fontSize: 10, color: '#aaa' }}>fast</span>
                    </div>
                    <div style={{ fontSize: 11, textAlign: 'center', marginTop: 2, fontFamily: 'monospace' }}>{runSpeed}x</div>
                  </div>
                )}
              </div>
            </div>
          </>}
          </div>
        )}

        {/* ── A/V Table (always visible) ── */}
        <div className="table-section">
          <div className="table-section-label" style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }} onClick={() => setAvOpen(!avOpen)}>
              <span className="pod-toggle">{avOpen ? '▼' : '▶'}</span>
              <span>Argument / Value</span>
            </div>
          </div>
          {avOpen && <>
            <table className="data-table">
              <colgroup>
                <col style={{ width: 18 }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ border: 'none', background: 'transparent' }} />
                  <th>ARG</th>
                  <th>VAL</th>
                </tr>
              </thead>
              <tbody>
                {avRows.length > 0 ? avRows.map((row, i) => (
                  <tr key={i}>
                    <td style={{ border: 'none', background: 'transparent' }} />
                    <td><span className="mono-value">{interpret(row.inputBits)}</span></td>
                    <td><span className="mono-value">{interpret(row.outputBits)}</span></td>
                  </tr>
                )) : (
                  <tr>
                    <td style={{ border: 'none', background: 'transparent' }} />
                    <td><span className="mono-value" style={{ color: '#ccc' }}>&nbsp;</span></td>
                    <td><span className="mono-value" style={{ color: '#ccc' }}>&nbsp;</span></td>
                  </tr>
                )}
              </tbody>
            </table>
            <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0 2px' }}>
              <div className="toggle-group">
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
          </>}
        </div>

        {/* Sequential Timeline moved to bottom panel */}
      </div>
      </div>
    </div>
  );
}

