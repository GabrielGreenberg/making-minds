import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { useStore } from '../store';
import { bitsToTally, bitsToBinary, parseTMTransition, notationForRepresentation } from '../engine';
import type { TMSymbol } from '../types';

const UI_PREFS_KEY = 'making-minds-ui-prefs';

function loadUiPrefs(): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(UI_PREFS_KEY) || '{}');
  } catch { return {}; }
}

function saveUiPref(key: string, value: unknown) {
  const prefs = loadUiPrefs();
  prefs[key] = value;
  localStorage.setItem(UI_PREFS_KEY, JSON.stringify(prefs));
}

/** Key for an input combination, e.g. "0,1,0" */
function inputKey(bits: number[]): string {
  return bits.join(',');
}

/** The open assignment question's statement, shown above the tables in every
 *  mode's panel. Renders nothing in the sandbox. */
function QuestionStatement() {
  const assignment = useStore((s) => s.assignment);
  const currentQuestionIndex = useStore((s) => s.currentQuestionIndex);
  const statement = assignment?.questions[currentQuestionIndex]?.statement;
  if (!statement) return null;
  return (
    <div className="table-section">
      <div className="table-section-label">
        <span>Question</span>
      </div>
      <p className="question-statement">{statement}</p>
    </div>
  );
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

  // Local I/O stepping
  const localStepActive = useStore((s) => s.localStepActive);
  const localStepSelectedKey = useStore((s) => s.localStepSelectedKey);
  const localStepIndex = useStore((s) => s.localStepIndex);
  const localStepSorted = useStore((s) => s.localStepSorted);
  const localStepSelect = useStore((s) => s.localStepSelect);
  const localStepOne = useStore((s) => s.localStepOne);
  const localStepReset = useStore((s) => s.localStepReset);

  // For animated sequence playback
  const [isRunning, setIsRunning] = useState(false);
  const [localIsRunning, setLocalIsRunning] = useState(false);
  const [autoFocusIndex, setAutoFocusIndex] = useState<number | null>(null);

  // Collapsible section state (persisted)
  const _prefs = useRef(loadUiPrefs());
  const [localOpen, _setLocalOpen] = useState(() => _prefs.current.localOpen !== false);
  const [globalOpen, _setGlobalOpen] = useState(() => _prefs.current.globalOpen !== false);
  const [avOpen, _setAvOpen] = useState(() => _prefs.current.avOpen !== false);
  const setLocalOpen = (v: boolean) => { _setLocalOpen(v); saveUiPref('localOpen', v); };
  const setGlobalOpen = (v: boolean) => { _setGlobalOpen(v); saveUiPref('globalOpen', v); };
  const setAvOpen = (v: boolean) => { _setAvOpen(v); saveUiPref('avOpen', v); };

  // Run speed: multiplier (1 = 300ms per step, 2 = 150ms, 0.5 = 600ms, etc.)
  const [runSpeed, setRunSpeed] = useState(() => (typeof _prefs.current.runSpeed === 'number' ? _prefs.current.runSpeed as number : 1));
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
  // Ensure a global sequence is loaded into scInputSequence before running/stepping.
  // If activeGlobalIndex is set, use that; otherwise find the first sequence with input.
  const ensureSequenceLoaded = useCallback(() => {
    const state = useStore.getState();
    const maxLen = Math.max(...state.scInputSequence.map((s) => s.length), 0);
    const drain = state.components.filter((c) => c.type === 'MEM').length;
    if (maxLen > 0 && state.scTimeStep <= maxLen + drain) return; // already loaded and in progress

    // Try active index first, then fall back to first sequence with input
    const candidates = activeGlobalIndex !== null ? [activeGlobalIndex] : [];
    for (let i = 0; i < state.scGlobalSequences.length; i++) {
      if (i !== activeGlobalIndex) candidates.push(i);
    }
    for (const idx of candidates) {
      const seq = state.scGlobalSequences[idx];
      if (seq && seq.inputStr.length > 0) {
        setActiveGlobalIndex(idx);
        loadScGlobalSequence(idx);
        return;
      }
    }
  }, [activeGlobalIndex, loadScGlobalSequence]);

  const runLoadedSequence = useCallback(() => {
    ensureSequenceLoaded();
    // Re-read state after potential load
    setTimeout(() => {
      const state = useStore.getState();
      const numInputs = state.components.filter((c) => c.type === 'INPUT').length;
      if (numInputs === 0) return;
      const maxLen = Math.max(...state.scInputSequence.map((s) => s.length), 0);
      // Extra flush steps: one 0-input step per MEM so delayed bits drain out.
      const drain = state.components.filter((c) => c.type === 'MEM').length;
      const remaining = maxLen + drain - (state.scTimeStep - 1);
      // If no sequence loaded, just do a single step
      if (remaining <= 0 && maxLen === 0) {
        state.scStep();
        return;
      }
      if (remaining <= 0) return;
      setIsRunning(true);
      let step = 0;
      const interval = setInterval(() => {
        const s = useStore.getState();
        const maxL = Math.max(...s.scInputSequence.map((sq) => sq.length), 0) +
          s.components.filter((c) => c.type === 'MEM').length;
        if (step >= remaining || s.scTimeStep > maxL) {
          clearInterval(interval);
          setIsRunning(false);
          return;
        }
        s.scStep();
        step++;
      }, Math.round(300 / runSpeed));
    }, 0);
  }, [runSpeed, ensureSequenceLoaded]);

  // Step once: if a sequence is loaded, advance within it; otherwise just step with current inputs
  const stepLoadedSequence = useCallback(() => {
    ensureSequenceLoaded();
    setTimeout(() => {
      const state = useStore.getState();
      const maxLen = Math.max(...state.scInputSequence.map((s) => s.length), 0);
      const drain = state.components.filter((c) => c.type === 'MEM').length;
      if (maxLen === 0 || state.scTimeStep <= maxLen + drain) {
        state.scStep();
      }
    }, 0);
  }, [ensureSequenceLoaded]);

  // Reset: if a global sequence is active, clear its output and re-load; otherwise just scReset
  const resetLoadedSequence = useCallback(() => {
    const state = useStore.getState();
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
    } else {
      // No active global sequence — just reset
      state.scReset();
    }
  }, [loadScGlobalSequence]);

  // FSM state
  const fsmCurrentStateId = useStore((s) => s.fsmCurrentStateId);
  const fsmInputSequence = useStore((s) => s.fsmInputSequence);
  const fsmTimeStep = useStore((s) => s.fsmTimeStep);
  const fsmHistory = useStore((s) => s.fsmHistory);
  const fsmHalted = useStore((s) => s.fsmHalted);
  const fsmRunning = useStore((s) => s.fsmRunning);
  const setFsmInputSequence = useStore((s) => s.setFsmInputSequence);
  const fsmStep = useStore((s) => s.fsmStep);
  const fsmRun = useStore((s) => s.fsmRun);
  const fsmReset = useStore((s) => s.fsmReset);
  const fsmGlobalReset = useStore((s) => s.fsmGlobalReset);

  // TM state
  const tmCurrentStateId = useStore((s) => s.tmCurrentStateId);
  const tmTimeStep = useStore((s) => s.tmTimeStep);
  const tmHistory = useStore((s) => s.tmHistory);
  const tmHalted = useStore((s) => s.tmHalted);
  const tmRunning = useStore((s) => s.tmRunning);
  const tmStep = useStore((s) => s.tmStep);
  const tmRun = useStore((s) => s.tmRun);
  const tmReset = useStore((s) => s.tmReset);
  const tmGlobalReset = useStore((s) => s.tmGlobalReset);

  const wires = useStore((s) => s.wires);
  const hasMem = components.some((c) => c.type === 'MEM');
  const isCC = buildMode === 'CC';
  const isSC = buildMode === 'SC' || hasMem;
  const isFSM = buildMode === 'FSM';
  const isTM = buildMode === 'TM';

  // ── Resizable panel ──
  const [panelWidth, _setPanelWidth] = useState(() => (typeof _prefs.current.panelWidth === 'number' ? _prefs.current.panelWidth as number : 260));
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  const setPanelWidth = (v: number) => _setPanelWidth(v);
  const onResizePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: panelWidth };
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    let lastWidth = panelWidth;
    const onMove = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      lastWidth = Math.max(0, Math.min(600, dragRef.current.startW + (dragRef.current.startX - ev.clientX)));
      setPanelWidth(lastWidth);
    };
    const onUp = () => {
      dragRef.current = null;
      target.releasePointerCapture(e.pointerId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      saveUiPref('panelWidth', lastWidth);
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
    if (localStepActive && localStepSelectedKey) return localStepSelectedKey;
    // No row highlighted if all inputs are unset (cleared state)
    if (inputs.every((c) => c.value === undefined || c.value === null)) return null;
    if (isSC && scHistory.length > 0) {
      const latest = scHistory[scHistory.length - 1];
      return inputKey([...latest.inputBits, ...latest.memValues]);
    }
    // Highlight the current input combo only if it's actually been evaluated
    // (present in the table). After a structural edit the inputs are kept but
    // not re-run, so nothing is highlighted and every row stays clickable to
    // start stepping — otherwise the "current" row looks active but is
    // unclickable, leaving Run/Step/Reset stuck disabled.
    const key = isSC
      ? inputKey([...inputs.map((c) => c.value ?? 0), ...mems.map((c) => c.storedValue ?? 0)])
      : inputKey(inputs.map((c) => c.value ?? 0));
    return tableRows.some((r) => inputKey([...r.inputBits, ...(r.memBits || [])]) === key)
      ? key
      : null;
  }, [isSC, scHistory, inputs, mems, localStepActive, localStepSelectedKey, tableRows]);

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
      // During local stepping, don't show the in-progress row in A/V until all outputs are filled
      const steppingKey = localStepActive ? localStepSelectedKey : null;
      const steppingComplete = localStepActive && localStepIndex >= localStepSorted.length;
      return ccInputRows && ccInputRows !== 'too-many'
        ? (ccInputRows as number[][])
            .filter((inBits) => {
              if (!evaluatedRows.has(inputKey(inBits))) return false;
              // Hide in-progress row unless stepping is complete
              if (steppingKey === inputKey(inBits) && !steppingComplete) return false;
              return true;
            })
            .map((inBits) => ({
              inputBits: inBits,
              outputBits: evaluatedRows.get(inputKey(inBits))!,
            }))
        : [];
    }
    return tableRows;
  }, [isSC, isCC, scGlobalSequences, scHistory, activeGlobalIndex, ccInputRows, evaluatedRows, tableRows, localStepActive, localStepSelectedKey, localStepIndex, localStepSorted.length]);

  // ── FSM Mode ──────────────────────────────────────────────────────
  if (isFSM) {
    const states = components
      .filter((c) => c.type === 'STATE')
      .sort((a, b) => {
        const subDigits = '₀₁₂₃₄₅₆₇₈₉';
        const numA = parseInt(a.label.replace('S', '').split('').map(ch => { const idx = subDigits.indexOf(ch); return idx >= 0 ? String(idx) : ch; }).join('')) || 0;
        const numB = parseInt(b.label.replace('S', '').split('').map(ch => { const idx = subDigits.indexOf(ch); return idx >= 0 ? String(idx) : ch; }).join('')) || 0;
        return numA - numB;
      });

    // Build state table from transitions (wires between STATE components)
    const stateTableRows: { state: string; input: number; output: number; nextState: string }[] = [];
    for (const state of states) {
      for (const inputBit of [0, 1]) {
        const transition = wires.find((w) => {
          if (w.sourceComponentId !== state.id) return false;
          if (!w.transitionLabel) return false;
          const parts = w.transitionLabel.split(':');
          return parts.length === 2 && parseInt(parts[0]) === inputBit;
        });
        if (transition) {
          const parts = transition.transitionLabel!.split(':');
          const targetComp = components.find((c) => c.id === transition.targetComponentId);
          stateTableRows.push({
            state: state.label,
            input: inputBit,
            output: parseInt(parts[1]) || 0,
            nextState: targetComp?.label || '?',
          });
        } else {
          stateTableRows.push({
            state: state.label,
            input: inputBit,
            output: -1, // no transition
            nextState: 'HALT',
          });
        }
      }
    }

    const fsmInputStr = fsmInputSequence.map(String).join('');
    const fsmOutputStr = fsmHistory.map((h) => String(h.output)).join('');

    return (
      <div className="data-table-panel" style={{ width: panelWidth }}>
        <div className="panel-resize-handle" onPointerDown={onResizePointerDown} />
        <div className="data-table-panel-inner">
        <div className="data-table-content">
          <QuestionStatement />
          {/* State Table */}
          <div className="table-section">
            <div className="table-section-label">
              <span>State Table</span>
            </div>
            {states.length === 0 ? (
              <div style={{ padding: 12, color: '#999', fontSize: 12 }}>
                Add states and transitions to see the state table.
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>CURRENT STATE</th>
                    <th>IN</th>
                    <th>OUT</th>
                    <th>NEXT STATE</th>
                  </tr>
                </thead>
                <tbody>
                  {stateTableRows.map((row, i) => {
                    const isCurrentRow = fsmCurrentStateId !== null &&
                      row.state === components.find((c) => c.id === fsmCurrentStateId)?.label;
                    return (
                      <tr key={i} className={isCurrentRow ? 'row-active' : ''}>
                        <td><span className="mono-value">{row.state}</span></td>
                        <td className={row.input === 1 ? 'val-1' : ''}><span className="mono-value">{row.input}</span></td>
                        <td className={row.output === 1 ? 'val-1' : ''}><span className="mono-value">{row.output === -1 ? '–' : row.output}</span></td>
                        <td><span className="mono-value" style={row.nextState === 'HALT' ? { color: '#999', fontStyle: 'italic' } : undefined}>{row.nextState}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Input / Output Sequence */}
          <div className="table-section">
            <div className="table-section-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Input / Output</span>
              <button
                className="toggle-btn"
                onClick={fsmGlobalReset}
                style={{ fontSize: 11, padding: '2px 8px', color: fsmInputSequence.length > 0 ? '#555' : '#ccc' }}
              >
                clear
              </button>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>IN</th>
                  <th>OUT</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <input
                        type="text"
                        className="sc-input-field"
                        value={fsmInputStr}
                        placeholder=""
                        onChange={(e) => {
                          const raw = e.target.value.replace(/[^01]/g, '');
                          setFsmInputSequence(raw.split('').map(Number));
                        }}
                        style={{
                          flex: 1, minWidth: 0, textAlign: 'left', border: 'none',
                          background: 'transparent', color: 'inherit',
                          fontSize: 11, fontFamily: 'monospace',
                        }}
                      />
                      <svg width="12" height="10" viewBox="0 0 12 10" style={{ flexShrink: 0, marginLeft: 2 }}>
                        <line x1="1" y1="5" x2="10" y2="5" stroke="#888" strokeWidth="1.2" />
                        <polyline points="7,2 10,5 7,8" fill="none" stroke="#888" strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />
                      </svg>
                    </div>
                  </td>
                  <td style={{ overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <span className="mono-value" style={{ flex: 1, fontSize: 11, textAlign: 'left' }}>{fsmOutputStr || ''}</span>
                      <svg width="12" height="10" viewBox="0 0 12 10" style={{ flexShrink: 0, marginLeft: 2 }}>
                        <line x1="1" y1="5" x2="10" y2="5" stroke="#888" strokeWidth="1.2" />
                        <polyline points="7,2 10,5 7,8" fill="none" stroke="#888" strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />
                      </svg>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            {/* Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0 3px', paddingLeft: 4 }}>
              <button className="action-btn" onClick={() => { if (!fsmRunning) fsmRun(); }} disabled={fsmRunning || fsmHalted || fsmTimeStep > fsmInputSequence.length}>
                Run
              </button>
              <button className="action-btn" onClick={() => { if (!fsmRunning) fsmStep(); }} disabled={fsmRunning || fsmHalted || fsmTimeStep > fsmInputSequence.length}>
                Step
              </button>
              <button className="action-btn" onClick={fsmReset} disabled={fsmRunning}>
                Reset
              </button>
              {fsmHalted && (
                <span style={{ fontSize: 10, color: '#e53935', fontWeight: 600, marginLeft: 'auto', paddingRight: 6 }}>
                  HALTED
                </span>
              )}
              {!fsmHalted && fsmTimeStep > 1 && (
                <span style={{ marginLeft: 'auto', fontSize: 10, color: '#888', fontFamily: 'monospace', paddingRight: 6 }}>
                  t={fsmTimeStep - 1}
                </span>
              )}
            </div>
          </div>

          {/* History */}
          {fsmHistory.length > 0 && (
            <div className="table-section">
              <div className="table-section-label">
                <span>History</span>
              </div>
              <table className="data-table" style={{ fontSize: 11 }}>
                <thead>
                  <tr>
                    <th>t</th>
                    <th>STATE</th>
                    <th>IN</th>
                    <th>OUT</th>
                    <th>NEXT</th>
                  </tr>
                </thead>
                <tbody>
                  {fsmHistory.map((h, i) => (
                    <tr key={i}>
                      <td><span className="mono-value">{h.t}</span></td>
                      <td><span className="mono-value">{h.stateLabel}</span></td>
                      <td className={h.input === 1 ? 'val-1' : ''}><span className="mono-value">{h.input}</span></td>
                      <td className={h.output === 1 ? 'val-1' : ''}><span className="mono-value">{h.output}</span></td>
                      <td><span className="mono-value">{h.nextStateLabel}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </div>
      </div>
    );
  }

  // ── TM Mode ──────────────────────────────────────────────────────
  if (isTM) {
    const notation = notationForRepresentation(repSystem);
    const symbols: TMSymbol[] = notation === 'binary' ? ['0', '1', '*'] : ['0', '1'];
    const states = components
      .filter((c) => c.type === 'STATE')
      .sort((a, b) => {
        const subDigits = '₀₁₂₃₄₅₆₇₈₉';
        const num = (l: string) =>
          parseInt(l.replace('S', '').split('').map((ch) => {
            const idx = subDigits.indexOf(ch);
            return idx >= 0 ? String(idx) : ch;
          }).join('')) || 0;
        return num(a.label) - num(b.label);
      });

    // Build the machine table from transitions (input:action per read symbol).
    const tmTableRows: { state: string; input: TMSymbol; action: string; nextState: string }[] = [];
    for (const state of states) {
      for (const symbol of symbols) {
        const transition = wires.find((w) => {
          if (w.sourceComponentId !== state.id) return false;
          const parsed = parseTMTransition(w.transitionLabel, notation);
          return parsed !== null && parsed.input === symbol;
        });
        if (transition) {
          const parsed = parseTMTransition(transition.transitionLabel, notation)!;
          const targetComp = components.find((c) => c.id === transition.targetComponentId);
          tmTableRows.push({
            state: state.label,
            input: symbol,
            action: parsed.action.raw,
            nextState: targetComp?.label || '?',
          });
        } else {
          tmTableRows.push({ state: state.label, input: symbol, action: '–', nextState: 'HALT' });
        }
      }
    }

    return (
      <div className="data-table-panel" style={{ width: panelWidth }}>
        <div className="panel-resize-handle" onPointerDown={onResizePointerDown} />
        <div className="data-table-panel-inner">
        <div className="data-table-content">
          <QuestionStatement />
          {/* Machine Table */}
          <div className="table-section">
            <div className="table-section-label">
              <span>Machine Table</span>
            </div>
            {states.length === 0 ? (
              <div style={{ padding: 12, color: '#999', fontSize: 12 }}>
                Add states and transitions to see the machine table.
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>STATE</th>
                    <th>READ</th>
                    <th>ACTION</th>
                    <th>NEXT STATE</th>
                  </tr>
                </thead>
                <tbody>
                  {tmTableRows.map((row, i) => {
                    const isCurrentRow = tmCurrentStateId !== null &&
                      row.state === components.find((c) => c.id === tmCurrentStateId)?.label;
                    return (
                      <tr key={i} className={isCurrentRow ? 'row-active' : ''}>
                        <td><span className="mono-value">{row.state}</span></td>
                        <td className={row.input === '1' ? 'val-1' : ''}><span className="mono-value">{row.input}</span></td>
                        <td><span className="mono-value">{row.action}</span></td>
                        <td><span className="mono-value" style={row.nextState === 'HALT' ? { color: '#999', fontStyle: 'italic' } : undefined}>{row.nextState}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Controls */}
          <div className="table-section">
            <div className="table-section-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Run</span>
              <button
                className="toggle-btn"
                onClick={tmGlobalReset}
                style={{ fontSize: 11, padding: '2px 8px', color: '#555' }}
                title="Reset and blank the whole tape"
              >
                clear tape
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0 3px', paddingLeft: 4 }}>
              <button className="action-btn" onClick={() => { if (!tmRunning) tmRun(); }} disabled={tmRunning || tmHalted}>
                Run
              </button>
              <button className="action-btn" onClick={() => { if (!tmRunning) tmStep(); }} disabled={tmRunning || tmHalted}>
                Step
              </button>
              <button className="action-btn" onClick={tmReset} disabled={tmRunning}>
                Reset
              </button>
              {tmHalted && (
                <span style={{ fontSize: 10, color: '#e53935', fontWeight: 600, marginLeft: 'auto', paddingRight: 6 }}>
                  HALTED
                </span>
              )}
              {!tmHalted && tmTimeStep > 1 && (
                <span style={{ marginLeft: 'auto', fontSize: 10, color: '#888', fontFamily: 'monospace', paddingRight: 6 }}>
                  t={tmTimeStep - 1}
                </span>
              )}
            </div>
            <div style={{ padding: '2px 4px 6px', fontSize: 10, color: '#999' }}>
              Set the input on the tape below the canvas, then Run or Step. Halting ends the computation.
            </div>
          </div>

          {/* History */}
          {tmHistory.length > 0 && (
            <div className="table-section">
              <div className="table-section-label">
                <span>History</span>
              </div>
              <table className="data-table" style={{ fontSize: 11 }}>
                <thead>
                  <tr>
                    <th>t</th>
                    <th>STATE</th>
                    <th>READ</th>
                    <th>ACT</th>
                    <th>NEXT</th>
                  </tr>
                </thead>
                <tbody>
                  {tmHistory.map((h, i) => (
                    <tr key={i}>
                      <td><span className="mono-value">{h.t}</span></td>
                      <td><span className="mono-value">{h.stateLabel}</span></td>
                      <td className={h.read === '1' ? 'val-1' : ''}><span className="mono-value">{h.read}</span></td>
                      <td><span className="mono-value">{h.action}</span></td>
                      <td><span className="mono-value">{h.nextStateLabel}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </div>
      </div>
    );
  }

  if (inputs.length === 0) {
    return (
      <div className="data-table-panel" style={{ width: panelWidth }}>
        <div className="panel-resize-handle" onPointerDown={onResizePointerDown} />
        <div className="data-table-panel-inner">
          <div className="table-header" />
          <div className="data-table-content">
            <QuestionStatement />
            <div style={{ padding: 12, color: '#999', fontSize: 12 }}>
              Add inputs and outputs to see the I/O table.
            </div>
          </div>
        </div>
      </div>
    );
  }

  /** Red activity dot for the active row, empty for inactive */
  const playBtn = (inBits: number[], isActive: boolean) => (
    <td
      className="row-play-btn"
      style={{
        width: 18, padding: '2px 0',
        cursor: isActive ? 'default' : 'pointer',
        border: 'none', background: 'transparent',
        textAlign: 'center', verticalAlign: 'middle',
      }}
      onClick={() => { if (!isActive) localStepSelect(inBits); }}
      title={isActive ? 'Selected row' : 'Select this row'}
    >
      {isActive && <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#e53935' }} />}
    </td>
  );

  // For non-CC modes, use tableRows directly
  const nonCCHasRows = !isCC && !isSC && tableRows.length > 0;

  return (
    <div className="data-table-panel" style={{ width: panelWidth }}>
      <div className="panel-resize-handle" onPointerDown={onResizePointerDown} />
      <div className="data-table-panel-inner">
      <div className="data-table-content">
        <QuestionStatement />
        {/* ── I/O Table (CC and SC) ────────────────────────────── */}
        <div className="table-section">
          <div className="table-section-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }} onClick={() => setLocalOpen(!localOpen)}>
              <span className="pod-toggle">{localOpen ? '▼' : '▶'}</span>
              <span>{isSC ? 'Local Input / Output' : 'Input / Output'}</span>
            </div>
            <button
              className="toggle-btn"
              onClick={() => {
                clearTableRows();
                if (isSC) scReset();
                if (localStepActive) useStore.getState().localStepClear();
                // Reset all inputs and wire values
                const state = useStore.getState();
                for (const comp of state.components) {
                  if (comp.type === 'INPUT') state.setInputValue(comp.id, undefined);
                }
                state.evaluateCircuit();
              }}
              style={{
                fontSize: 11, padding: '2px 8px',
                color: (tableRows.length > 0 || localStepActive) ? '#555' : '#ccc',
                cursor: (tableRows.length > 0 || localStepActive) ? 'pointer' : 'default',
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
                    <tr
                      key={isActive ? `${i}-flash-${flashCounter}` : i}
                      className={isActive ? 'row-active row-flash' : ''}
                      style={{ cursor: isActive ? 'default' : 'pointer' }}
                      onClick={() => { if (!isActive) localStepSelect(row.inputBits, row.memBits); }}
                    >
                      <td
                        className="row-play-btn"
                        style={{
                          width: 18, padding: '2px 0',
                          cursor: isActive ? 'default' : 'pointer',
                          border: 'none', background: 'transparent',
                          textAlign: 'center', verticalAlign: 'middle',
                        }}
                        onClick={() => { if (!isActive) localStepSelect(row.inputBits, row.memBits); }}
                        title={isActive ? 'Selected row' : 'Select this row'}
                      >
                        {isActive && <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#e53935' }} />}
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
                    <tr key={i} className={isActive ? 'row-active' : ''} style={{ cursor: isActive ? 'default' : 'pointer' }} onClick={() => { if (!isActive) localStepSelect(inBits); }}>
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
                    <tr key={i} className={isActive ? 'row-active' : ''} style={{ cursor: isActive ? 'default' : 'pointer' }} onClick={() => { if (!isActive) localStepSelect(row.inputBits); }}>
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

          {/* Local Run/Step/Reset controls */}
          {localOpen && (isCC || isSC) && inputs.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0 3px', paddingLeft: 18 }}>
              <button
                className="action-btn"
                onClick={() => {
                  if (localIsRunning) return;
                  if (!localStepActive) return;
                  setLocalIsRunning(true);
                  const interval = setInterval(() => {
                    const more = useStore.getState().localStepOne();
                    if (!more) {
                      clearInterval(interval);
                      setLocalIsRunning(false);
                    }
                  }, Math.round(300 / runSpeed));
                }}
                disabled={localIsRunning || !localStepActive}
              >
                Run
              </button>
              <button
                className="action-btn"
                onClick={() => {
                  if (!localIsRunning && localStepActive) localStepOne();
                }}
                disabled={localIsRunning || !localStepActive}
              >
                Step
              </button>
              <button
                className="action-btn"
                onClick={() => {
                  if (!localIsRunning && localStepActive) localStepReset();
                }}
                disabled={localIsRunning || !localStepActive}
              >
                Reset
              </button>
              {localStepActive && (
                <span style={{ marginLeft: 'auto', fontSize: 10, color: '#888', fontFamily: 'monospace', paddingRight: 6 }}>
                  {Math.min(localStepIndex, localStepSorted.length)}/{localStepSorted.length}
                </span>
              )}
            </div>
          )}
        </div>

        {/* ── Global I/O Table (SC only) ─────────────────────── */}
        {isSC && (
          <div className="table-section">
            <div className="table-section-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }} onClick={() => setGlobalOpen(!globalOpen)}>
                <span className="pod-toggle">{globalOpen ? '▼' : '▶'}</span>
                <span>Global Input / Output</span>
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
                          border: 'none', background: 'transparent',
                          textAlign: 'center', verticalAlign: 'middle',
                        }}
                        onClick={() => {
                          if (!isRunning && !isActive) {
                            setActiveGlobalIndex(i);
                            if (seq.inputStr.length > 0) loadScGlobalSequence(i);
                          }
                        }}
                        title={isActive ? 'Currently selected' : 'Select this input sequence'}
                      >
                        {isActive && <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#e53935' }} />}
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
                  <td style={{ width: 18, padding: '2px 0', border: 'none', background: 'transparent', textAlign: 'center' }}>
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
                className="action-btn"
                onClick={() => { if (!isRunning) runLoadedSequence(); }}
                disabled={isRunning}
              >
                Run
              </button>
              <button
                className="action-btn"
                onClick={() => { if (!isRunning) stepLoadedSequence(); }}
                disabled={isRunning}
              >
                Step
              </button>
              <button
                className="action-btn"
                onClick={() => { if (!isRunning) resetLoadedSequence(); }}
                disabled={isRunning}
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
                  {runSpeed >= 1 ? Math.round(runSpeed) : runSpeed.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}x
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
                          const speed = Math.pow(2, exp);
                          setRunSpeed(speed);
                          saveUiPref('runSpeed', speed);
                        }}
                        style={{ width: 80 }}
                      />
                      <span style={{ fontSize: 10, color: '#aaa' }}>fast</span>
                    </div>
                    <div style={{ fontSize: 11, textAlign: 'center', marginTop: 2, fontFamily: 'monospace' }}>{runSpeed >= 1 ? Math.round(runSpeed) : runSpeed.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}x</div>
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
              <div className="slide-selector">
                <div
                  className="slide-selector-thumb"
                  style={{ left: repSystem === 'tally' ? '0%' : repSystem === 'binary' ? '33.33%' : '66.66%', width: '33.33%' }}
                />
                <button className={`slide-selector-opt ${repSystem === 'tally' ? 'active' : ''}`} onClick={() => setRepSystem('tally')}>Tally</button>
                <button className={`slide-selector-opt ${repSystem === 'binary' ? 'active' : ''}`} onClick={() => setRepSystem('binary')}>Binary</button>
                <button className={`slide-selector-opt ${repSystem === 'plus' ? 'active' : ''}`} onClick={() => setRepSystem('plus')}>+</button>
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

