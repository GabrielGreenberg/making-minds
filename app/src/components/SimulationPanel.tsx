import { useState } from 'react';
import { useStore } from '../store';

export function SimulationToolbar() {
  const buildMode = useStore((s) => s.buildMode);
  const components = useStore((s) => s.components);
  const hasMem = components.some((c) => c.type === 'MEM');
  const isSC = buildMode === 'SC' || hasMem;
  const autoSaveStatus = useStore((s) => s.autoSaveStatus);
  const hasSelection = useStore((s) => s.selectedIds.length > 0);

  const isFSM = buildMode === 'FSM';
  const isTM = buildMode === 'TM';
  const fsmCurrentStateId = useStore((s) => s.fsmCurrentStateId);
  const tmCurrentStateId = useStore((s) => s.tmCurrentStateId);
  const currentStateId = isFSM ? fsmCurrentStateId : isTM ? tmCurrentStateId : null;
  const currentStateLabel = currentStateId
    ? components.find((c) => c.id === currentStateId)?.label ?? null
    : null;

  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const handleReset = () => {
    const state = useStore.getState();
    if (isFSM) {
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
