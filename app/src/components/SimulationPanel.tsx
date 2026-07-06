import { useState } from 'react';
import { useStore, selectEffectiveMode } from '../store';

export function SimulationToolbar() {
  const buildMode = useStore((s) => s.buildMode);
  const effectiveMode = useStore(selectEffectiveMode);
  const components = useStore((s) => s.components);
  const hasMem = components.some((c) => c.type === 'MEM');
  const isSC = buildMode === 'SC' || hasMem;
  const autoSaveStatus = useStore((s) => s.autoSaveStatus);
  const selectedIds = useStore((s) => s.selectedIds);
  const hasSelection = selectedIds.length > 0;
  const hasStateSelected = selectedIds.some((id) => components.find((c) => c.id === id)?.type === 'STATE');

  const isTurbot = buildMode === 'turbot';
  // The state-machine chrome (current-state readout) follows the effective
  // (inner) mode so FSM/TM-brained turbots show their control state too.
  const isFSM = effectiveMode === 'FSM';
  const isTM = effectiveMode === 'TM';
  const fsmCurrentStateId = useStore((s) => s.fsmCurrentStateId);
  const tmCurrentStateId = useStore((s) => s.tmCurrentStateId);
  const turbotBrainStateId = useStore((s) => s.turbotBrainState.stateId ?? null);
  const currentStateId = isTurbot
    ? turbotBrainStateId
    : isFSM ? fsmCurrentStateId : isTM ? tmCurrentStateId : null;
  const currentStateLabel = currentStateId
    ? components.find((c) => c.id === currentStateId)?.label ?? null
    : null;

  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const handleReset = () => {
    const state = useStore.getState();
    if (isTurbot) {
      state.turbotReset();
    } else if (isFSM) {
      state.fsmReset();
    } else if (isTM) {
      state.tmReset();
    } else if (isSC) {
      state.scReset();
    } else {
      for (const comp of state.components) {
        if (comp.type === 'INPUT') {
          state.setInputValue(comp.id, undefined);
        }
      }
    }
  };

  return (
    <>
      <div className="simulation-toolbar">
        <button className="toolbar-btn" onClick={handleReset} title={isSC ? 'Reset to t=1, preserve input sequence' : 'Clear all inputs'}>
          Reset
        </button>

        <div style={{ position: 'relative' }}>
          <button className="toolbar-btn" onClick={() => setShowClearConfirm(true)}>
            Clear
          </button>
          {showClearConfirm && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 4,
              background: 'white', border: '1px solid #ddd', borderRadius: 6,
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)', padding: '10px 14px',
              zIndex: 1000, whiteSpace: 'nowrap',
            }}>
              <div style={{ fontSize: 12, marginBottom: 8, color: '#333' }}>
                Do you really want to clear the workspace?
              </div>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button className="toolbar-btn" onClick={() => {
                  useStore.getState().clearWorkspace();
                  setShowClearConfirm(false);
                }}>Yes</button>
                <button className="toolbar-btn" onClick={() => setShowClearConfirm(false)}>No</button>
              </div>
            </div>
          )}
        </div>

        <div className="toolbar-separator" />
        <button
          className="toolbar-btn"
          disabled={!hasSelection}
          onClick={() => {
            const state = useStore.getState();
            for (const id of state.selectedIds) {
              state.rotateComponent(id);
            }
          }}
          title="Rotate selected components 90°"
        >
          <span className="toolbar-icon">{'↻'}</span> Rotate
        </button>

        {/* Turbot TM: flip selected states between internal (circle, tape
            ops) and external (square, sense/move ops) — textbook convention. */}
        {isTurbot && isTM && (
          <button
            className="toolbar-btn"
            disabled={!hasStateSelected}
            onClick={() => {
              const state = useStore.getState();
              for (const id of state.selectedIds) {
                state.toggleStateKind(id);
              }
            }}
            title="Toggle selected states between internal (circle: read/write/move the tape) and external (square: sense ahead and move/turn)"
          >
            <span className="toolbar-icon">{'▢'}</span> In/External
          </button>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          {(isFSM || isTM) && (
            <span style={{ fontSize: 12, color: '#555', fontFamily: "'SF Mono', 'Fira Code', monospace" }}>
              Current state: {currentStateLabel ?? 'S₀'}
            </span>
          )}
          <span
            className="autosave-indicator"
            style={{ marginLeft: 0 }}
            title={autoSaveStatus === 'saved' ? 'All changes saved' : autoSaveStatus === 'saving' ? 'Saving...' : 'Unsaved changes'}
          >
            {autoSaveStatus === 'saved' ? '✓ Saved' : autoSaveStatus === 'saving' ? 'Saving...' : '• Unsaved'}
          </span>
        </div>
      </div>
    </>
  );
}
