import { useMemo, useState, useRef, useEffect } from 'react';
import { useStore, selectTmNotation, selectEffectiveMode, selectPerceptionRetina, selectFsmNotation } from '../store';
import { tmNotation, memorySlots, hasMemory } from '../engine';
import { outputDisplayString } from './outputDisplay';
import { TurbotArenaPanel } from './TurbotArenaPanel';
import { GradedCaseBanner } from './GradedCaseBanner';
import { LiveTruthTable } from './LiveTruthTable';
import { PerceptionFramePlayer } from './PerceptionFramePlayer';
import { RunSpeedControl } from './RunSpeedControl';
import type { TMSymbol } from '../types';
import { loadUiPrefs, saveUiPref } from '../uiPrefs';

/** Key for an input combination, e.g. "0,1,0" */
function inputKey(bits: number[]): string {
  return bits.join(',');
}


export function DataTable() {
  const components = useStore((s) => s.components);
  const tableRows = useStore((s) => s.tableRows);
  const clearTableRows = useStore((s) => s.clearTableRows);
  const buildMode = useStore((s) => s.buildMode);
  // TM alphabet is tied to the question's representation (sandbox: repSystem).
  const tmRep = useStore(selectTmNotation);
  // An SC perception question's retina width (null otherwise): its frame
  // player takes the Global I/O rows' place.
  const retina = useStore(selectPerceptionRetina);

  // SC state
  const scHistory = useStore((s) => s.scHistory);
  const scGlobalSequences = useStore((s) => s.scGlobalSequences);
  const setScGlobalSequenceInput = useStore((s) => s.setScGlobalSequenceInput);
  const loadScGlobalSequence = useStore((s) => s.loadScGlobalSequence);
  const scReset = useStore((s) => s.scReset);
  const scGlobalReset = useStore((s) => s.scGlobalReset);
  // Which Global I/O row a run plays — store-held, so the output panel's one
  // control row (OutputPanel) drives it (task 053).
  const activeGlobalIndex = useStore((s) => s.scActiveGlobalIndex);
  const setActiveGlobalIndex = useStore((s) => s.setScActiveGlobalIndex);

  // Local I/O stepping
  const localStepActive = useStore((s) => s.localStepActive);
  const localStepSelectedKey = useStore((s) => s.localStepSelectedKey);
  const localStepIndex = useStore((s) => s.localStepIndex);
  const localStepSorted = useStore((s) => s.localStepSorted);
  const localStepSelect = useStore((s) => s.localStepSelect);
  const localStepOne = useStore((s) => s.localStepOne);
  const localStepReset = useStore((s) => s.localStepReset);
  const localStepRun = useStore((s) => s.localStepRun);
  // Every run loop lives in the store (scRun, localStepRun), so every reset
  // stops it — a canvas swap, Reset, and an edit mid-run (the store's edit law).
  const isRunning = useStore((s) => s.scRunning);
  const localIsRunning = useStore((s) => s.localStepRunning);
  const [autoFocusIndex, setAutoFocusIndex] = useState<number | null>(null);

  // Collapsible section state (persisted)
  const _prefs = useRef(loadUiPrefs());
  const [localOpen, _setLocalOpen] = useState(() => _prefs.current.localOpen !== false);
  const [globalOpen, _setGlobalOpen] = useState(() => _prefs.current.globalOpen !== false);
  const setLocalOpen = (v: boolean) => { _setLocalOpen(v); saveUiPref('localOpen', v); };
  const setGlobalOpen = (v: boolean) => { _setGlobalOpen(v); saveUiPref('globalOpen', v); };

  // Run speed: multiplier (1 = 300ms per step, 2 = 150ms, 0.5 = 600ms, etc.)
  const [runSpeed, setRunSpeed] = useState(() => (typeof _prefs.current.runSpeed === 'number' ? _prefs.current.runSpeed as number : 1));

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

  // FSM state
  const fsmCurrentStateId = useStore((s) => s.fsmCurrentStateId);
  const fsmInputSequence = useStore((s) => s.fsmInputSequence);
  const fsmHistory = useStore((s) => s.fsmHistory);
  const setFsmInputSequence = useStore((s) => s.setFsmInputSequence);
  const fsmGlobalReset = useStore((s) => s.fsmGlobalReset);
  // The FSM label notation for this editing surface (engine/notation.ts):
  // sized to the open question's input/output group counts; 1-bit in the
  // sandbox. Drives the state table's input-symbol enumeration.
  const fsmDataNotation = useStore(selectFsmNotation);

  // TM state
  const tmCurrentStateId = useStore((s) => s.tmCurrentStateId);
  const tmHistory = useStore((s) => s.tmHistory);
  const tmGlobalReset = useStore((s) => s.tmGlobalReset);

  // Turbot state — the arena + run controls live in TurbotArenaPanel; this
  // right panel shows the brain's machine table and the movement history.
  const turbotHistory = useStore((s) => s.turbotHistory);
  const turbotBrainStateId = useStore((s) => s.turbotBrainState.stateId ?? null);
  const effectiveMode = useStore(selectEffectiveMode);

  const wires = useStore((s) => s.wires);
  // Memory anywhere — a canvas holding only a sequential box is SC too.
  const hasMem = hasMemory(components);
  const isTurbot = buildMode === 'turbot';
  const isCC = buildMode === 'CC';
  const isSC = buildMode === 'SC' || hasMem;
  const isFSM = buildMode === 'FSM';
  const isTM = buildMode === 'TM';


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

  // The state columns: every MEM the machine clocks, in the engine's order —
  // top-level ones, then each sequential box's ('Box 1·M1'). The table is
  // keyed by the machine's whole state, so a boxed MEM is a column too.
  const mems = useMemo(() => memorySlots(components), [components]);

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
      ? inputKey([...inputs.map((c) => c.value ?? 0), ...mems.map((m) => m.value)])
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

  // ── FSM Mode ──────────────────────────────────────────────────────
  // ── Turbot Mode ───────────────────────────────────────────────────
  // Must precede the SC check: a MEM-carrying (SC-brained) turbot would
  // otherwise fall into the SC panel via the hasMem shortcut.
  if (isTurbot) {
    const stateComps = components
      .filter((c) => c.type === 'STATE')
      .sort((a, b) => {
        const subDigits = '₀₁₂₃₄₅₆₇₈₉';
        const num = (label: string) =>
          parseInt(label.replace('S', '').split('').map((ch) => {
            const idx = subDigits.indexOf(ch);
            return idx >= 0 ? String(idx) : ch;
          }).join('')) || 0;
        return num(a.label) - num(b.label);
      });
    const isStateBrain = effectiveMode === 'FSM' || effectiveMode === 'TM';

    return (
      <div className="data-table-panel">
        <div className="data-table-panel-inner">
        <div className="data-table-content">
          <GradedCaseBanner />

          {/* The arena ("Map") + run controls: below the question statement,
              above the machine/history tables (spec §9.1's Map panel). */}
          <TurbotArenaPanel />

          {/* Machine table for FSM/TM brains: one row per transition. The
              label column carries either grammar (in:out / in:action). */}
          {isStateBrain && (
            <div className="table-section">
              <div className="table-section-label">
                <span>Machine Table</span>
              </div>
              {stateComps.length === 0 ? (
                <div style={{ padding: 12, color: '#999', fontSize: 12 }}>
                  Add states and transitions to see the machine table.
                </div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>STATE</th>
                      <th>TRANSITION</th>
                      <th>NEXT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stateComps.flatMap((state) => {
                      const outgoing = wires.filter(
                        (w) => w.sourceComponentId === state.id && w.transitionLabel,
                      );
                      const isCurrent = turbotBrainStateId === state.id;
                      if (outgoing.length === 0) {
                        return [(
                          <tr key={state.id} className={isCurrent ? 'row-active' : ''}>
                            <td><span className="mono-value">{state.label}</span></td>
                            <td><span className="mono-value" style={{ color: '#999', fontStyle: 'italic' }}>–</span></td>
                            <td><span className="mono-value" style={{ color: '#999', fontStyle: 'italic' }}>HALT</span></td>
                          </tr>
                        )];
                      }
                      return outgoing.map((w) => {
                        const target = components.find((c) => c.id === w.targetComponentId);
                        return (
                          <tr key={w.id} className={isCurrent ? 'row-active' : ''}>
                            <td><span className="mono-value">{state.label}</span></td>
                            <td><span className="mono-value">{w.transitionLabel}</span></td>
                            <td><span className="mono-value">{target?.label ?? '?'}</span></td>
                          </tr>
                        );
                      });
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* History: one row per transition. Circuit brains only take
              external steps (sensor in, motor out); a turbot TM interleaves
              internal tape ops (read in, write/move out — pose unchanged,
              shown dimmed). */}
          <div className="table-section">
            <div className="table-section-label">
              <span>History</span>
            </div>
            {turbotHistory.length === 0 ? (
              <div style={{ padding: 12, color: '#999', fontSize: 12 }}>
                Step or Run the turbot (in the Map section above) to record steps.
              </div>
            ) : (
              <table className="data-table" style={{ fontSize: 11 }}>
                <thead>
                  <tr>
                    <th>t</th>
                    <th>IN</th>
                    <th>OP</th>
                    <th>POS</th>
                    <th>DIR</th>
                  </tr>
                </thead>
                <tbody>
                  {turbotHistory.map((h, i) => (
                    <tr key={i} style={h.kind === 'internal' ? { opacity: 0.65 } : undefined}>
                      <td><span className="mono-value">{h.t}</span></td>
                      <td className={h.input === '1' || h.input === 'B' ? 'val-1' : ''}><span className="mono-value">{h.input}</span></td>
                      <td><span className="mono-value">{h.action}</span></td>
                      <td><span className="mono-value">({h.x}, {h.y})</span></td>
                      <td><span className="mono-value">{h.facing}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
        </div>
      </div>
    );
  }

  if (isFSM) {
    const states = components
      .filter((c) => c.type === 'STATE')
      .sort((a, b) => {
        const subDigits = '₀₁₂₃₄₅₆₇₈₉';
        const numA = parseInt(a.label.replace('S', '').split('').map(ch => { const idx = subDigits.indexOf(ch); return idx >= 0 ? String(idx) : ch; }).join('')) || 0;
        const numB = parseInt(b.label.replace('S', '').split('').map(ch => { const idx = subDigits.indexOf(ch); return idx >= 0 ? String(idx) : ch; }).join('')) || 0;
        return numA - numB;
      });

    // Build the state table from transitions (wires between STATE components),
    // one row per (state, input symbol) of the question's notation — the same
    // alphabet the grader validates totality over (a k=2 question enumerates
    // 00/01/10/11). Labels are read through the notation, never dissected.
    const stateTableRows: { state: string; input: string; output: string; nextState: string }[] = [];
    for (const state of states) {
      for (const inputSymbol of fsmDataNotation.inputAlphabet) {
        const transition = wires.find((w) =>
          w.sourceComponentId === state.id &&
          fsmDataNotation.parse(w.transitionLabel)?.input === inputSymbol);
        if (transition) {
          const parsed = fsmDataNotation.parse(transition.transitionLabel)!;
          const targetComp = components.find((c) => c.id === transition.targetComponentId);
          stateTableRows.push({
            state: state.label,
            input: inputSymbol,
            output: parsed.outputs.join(''),
            nextState: targetComp?.label || '?',
          });
        } else {
          stateTableRows.push({
            state: state.label,
            input: inputSymbol,
            output: '–', // no transition
            nextState: 'HALT',
          });
        }
      }
    }

    const fsmInputStr = fsmInputSequence.map(String).join('');
    // Time flows right-to-left (t1 rightmost, later steps extend left) — the
    // same direction as the SC Global I/O rows, so a question run's OUT reads
    // as a numeral just like the typed IN (binary identity on "110" shows an
    // OUT that reads 110 = 6). fsmHistory is t-ascending, hence the shared
    // t-descending builder. Multi-bit output symbols contribute one bit per
    // output wire per step, exactly like the SC Global rows.
    const fsmOutputStr = outputDisplayString(
      fsmHistory.map((h) => ({ t: h.t, bits: String(h.output).split('').map(Number) })));

    return (
      <div className="data-table-panel">
        <div className="data-table-panel-inner">
        <div className="data-table-content">
          <GradedCaseBanner />
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
                        <td className={row.input === '1' ? 'val-1' : ''}><span className="mono-value">{row.input}</span></td>
                        <td className={row.output === '1' ? 'val-1' : ''}><span className="mono-value">{row.output}</span></td>
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
                  {/* Same convention as the SC Global I/O rows: t1 rightmost
                      (time flows right-to-left), right-aligned strings, arrow
                      pointing left. Typed IN is a numeral (MSB left). */}
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
                          flex: 1, minWidth: 0, textAlign: 'right', border: 'none',
                          background: 'transparent', color: 'inherit',
                          fontSize: 11, fontFamily: 'monospace',
                        }}
                      />
                      <svg width="12" height="10" viewBox="0 0 12 10" style={{ flexShrink: 0, marginLeft: 2 }}>
                        <line x1="11" y1="5" x2="2" y2="5" stroke="#e53935" strokeWidth="1.2" />
                        <polyline points="5,2 2,5 5,8" fill="none" stroke="#e53935" strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />
                      </svg>
                    </div>
                  </td>
                  <td style={{ overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <span className="mono-value" style={{ flex: 1, minWidth: 0, fontSize: 11, textAlign: 'right', display: 'block', overflow: 'hidden' }}>{fsmOutputStr || ''}</span>
                      <svg width="12" height="10" viewBox="0 0 12 10" style={{ flexShrink: 0, marginLeft: 2 }}>
                        <line x1="11" y1="5" x2="2" y2="5" stroke="#e53935" strokeWidth="1.2" />
                        <polyline points="5,2 2,5 5,8" fill="none" stroke="#e53935" strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />
                      </svg>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            {/* Run / Step / Reset (and HALTED / t=) are the output panel's
                one control row (OutputPanel, task 053). */}
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
    const notation = tmRep;
    const grammar = tmNotation(notation);
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

    // Build the machine table from transitions. Two-output form (spec §10.3):
    // per read symbol, the WRITE symbol and MOVE direction are separate columns.
    const tmTableRows: { state: string; input: TMSymbol; write: string; move: string; nextState: string }[] = [];
    for (const state of states) {
      for (const symbol of symbols) {
        const transition = wires.find((w) => {
          if (w.sourceComponentId !== state.id) return false;
          const parsed = grammar.parse(w.transitionLabel);
          return parsed !== null && parsed.input === symbol;
        });
        if (transition) {
          const parsed = grammar.parse(transition.transitionLabel)!;
          const targetComp = components.find((c) => c.id === transition.targetComponentId);
          tmTableRows.push({
            state: state.label,
            input: symbol,
            write: parsed.outputs[0],
            move: parsed.outputs[1],
            nextState: targetComp?.label || '?',
          });
        } else {
          tmTableRows.push({ state: state.label, input: symbol, write: '–', move: '–', nextState: 'HALT' });
        }
      }
    }

    return (
      <div className="data-table-panel">
        <div className="data-table-panel-inner">
        <div className="data-table-content">
          <GradedCaseBanner />
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
                    <th>WRITE</th>
                    <th>MOVE</th>
                    <th>NEXT STATE</th>
                  </tr>
                </thead>
                <tbody>
                  {tmTableRows.map((row, i) => {
                    const isCurrentRow = tmCurrentStateId !== null &&
                      row.state === components.find((c) => c.id === tmCurrentStateId)?.label;
                    const haltStyle = row.nextState === 'HALT' ? { color: '#999', fontStyle: 'italic' as const } : undefined;
                    return (
                      <tr key={i} className={isCurrentRow ? 'row-active' : ''}>
                        <td><span className="mono-value">{row.state}</span></td>
                        <td className={row.input === '1' ? 'val-1' : ''}><span className="mono-value">{row.input}</span></td>
                        <td><span className="mono-value" style={haltStyle}>{row.write}</span></td>
                        <td><span className="mono-value" style={haltStyle}>{row.move}</span></td>
                        <td><span className="mono-value" style={haltStyle}>{row.nextState}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* The tape's input. Run / Step / Reset (and HALTED / t=) are the
              output panel's one control row (OutputPanel, task 053). */}
          <div className="table-section">
            <div className="table-section-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Tape</span>
              <button
                className="toggle-btn"
                onClick={tmGlobalReset}
                style={{ fontSize: 11, padding: '2px 8px', color: '#555' }}
                title="Reset and blank the whole tape"
              >
                clear tape
              </button>
            </div>
            <div style={{ padding: '2px 4px 6px', fontSize: 10, color: '#999' }}>
              Set the input on the tape below the canvas, then Run or Step above. Halting ends the computation.
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

  // ── A combinational circuit: its live truth table (task 053) ──────
  if (isCC && !isSC) {
    return (
      <div className="data-table-panel">
        <div className="data-table-panel-inner">
          <div className="data-table-content">
            <LiveTruthTable />
          </div>
        </div>
      </div>
    );
  }

  if (inputs.length === 0) {
    return (
      <div className="data-table-panel">
        <div className="data-table-panel-inner">
          <div className="table-header" />
          <div className="data-table-content">
            <GradedCaseBanner />
            <div style={{ padding: 12, color: '#999', fontSize: 12 }}>
              Add inputs and outputs to see the I/O table.
            </div>
            {/* The film depends only on the retina, not the circuit: a student
                can draw the frames before wiring the retina's inputs. */}
            {isSC && retina !== null && (
              <PerceptionFramePlayer width={retina} runSpeed={runSpeed} onRunSpeedChange={setRunSpeed} />
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="data-table-panel">
      <div className="data-table-panel-inner">
      <div className="data-table-content">
        <GradedCaseBanner />
        {/* ── Local I/O Table (SC) ─────────────────────────────── */}
        <div className="table-section">
          <div className="table-section-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }} onClick={() => setLocalOpen(!localOpen)}>
              <span className="pod-toggle">{localOpen ? '▼' : '▶'}</span>
              <span>Local Input / Output</span>
            </div>
            <button
              className="toggle-btn"
              onClick={() => {
                clearTableRows();
                scReset();
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

          {!localOpen ? null : scInputRows === 'too-many' ? (
            <div style={{ padding: 12, color: '#999', fontSize: 12 }}>
              Too many inputs + memories (max 8) to show full table.
            </div>
          ) : scInputRows ? (
            /* SC: full truth table over inputs + memories */
            <table className="data-table">
              <colgroup>
                <col style={{ width: 18 }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ border: 'none', background: 'transparent' }} />
                  {inputs.map((inp) => <th key={inp.id}>{inp.label}</th>)}
                  {mems.map((mem) => <th key={mem.key}>{mem.label}</th>)}
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
          ) : null}

          {/* SC's local stepper — a second, legitimate run set beside the
              header's Global I/O run until the machine-types design (task
              053 F8). A combinational circuit's Run/Step/Reset are the output
              panel's one control row. Its Run is the store's loop. */}
          {localOpen && isSC && inputs.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0 3px', paddingLeft: 18 }}>
              <button
                className="action-btn"
                onClick={() => {
                  if (!localIsRunning && localStepActive) localStepRun(Math.round(300 / runSpeed));
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

        {/* ── SC perception: the frame player (the grader's frames) ── */}
        {isSC && retina !== null && (
          <PerceptionFramePlayer width={retina} runSpeed={runSpeed} onRunSpeedChange={setRunSpeed} />
        )}

        {/* ── Global I/O Table (SC only) ─────────────────────── */}
        {isSC && retina === null && (
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
                    ? outputDisplayString(scHistory.map((h) => ({ t: h.t, bits: h.outputBits })))
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
            {/* Run / Step / Reset for the selected row are the output panel's
                one control row (OutputPanel, task 053); its pace is set here. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0 3px', paddingLeft: 18 }}>
              <RunSpeedControl speed={runSpeed} onChange={setRunSpeed} />
            </div>
          </>}
          </div>
        )}

        {/* Sequential Timeline moved to bottom panel */}
      </div>
      </div>
    </div>
  );
}

