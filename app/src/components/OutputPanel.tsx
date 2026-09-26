// The editor's output panel (task 053; design memo editor-workbench.md
// §Output panel): ONE control row — Run (■ Stop while running) · Step ·
// Reset — for whatever the open canvas runs, then that mode's own content
// (DataTable: a circuit's live truth table, an SC circuit's tables, an FSM's
// or TM's machine table, a turbot's Map). The row renders the store's one
// descriptor (selectRunControls) and dispatches through runControl, so no
// panel builds a button row of its own and every run loop stays the store's
// (the reset and edit laws stop it).

import { useShallow } from 'zustand/react/shallow';
import { useStore, selectRunControls } from '../store';
import { loadUiPrefs, numericPref } from '../uiPrefs';
import { DataTable } from './DataTable';

export function OutputPanel() {
  return (
    <div className="op">
      <RunControlsRow />
      <DataTable />
    </div>
  );
}

function RunControlsRow() {
  const controls = useStore(useShallow(selectRunControls));
  const runControl = useStore((s) => s.runControl);
  if (!controls) return null;
  // The pace a Run plays at: the run-speed pref the SC and perception panels
  // set (1× = one step per 300 ms).
  const intervalMs = () => Math.round(300 / numericPref(loadUiPrefs(), 'runSpeed', 1));
  return (
    <div className="op-controls mm-surface" role="group" aria-label="Run controls">
      {controls.running ? (
        <button type="button" className="op-btn" onClick={() => runControl('stop')}>
          <span className="op-btn-icon" aria-hidden>■</span> Stop
        </button>
      ) : (
        <button type="button" className="op-btn" disabled={!controls.canRun} onClick={() => runControl('run', { intervalMs: intervalMs() })}>
          <span className="op-btn-icon" aria-hidden>▶</span> Run
        </button>
      )}
      <button type="button" className="op-btn" disabled={!controls.canStep} onClick={() => runControl('step')}>
        Step
      </button>
      <button type="button" className="op-btn" disabled={!controls.canReset} onClick={() => runControl('reset')}>
        Reset
      </button>
      {controls.status && <span className="op-status" role="status">{controls.status}</span>}
    </div>
  );
}
