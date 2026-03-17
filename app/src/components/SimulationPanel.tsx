import { useState } from 'react';
import { useStore } from '../store';

export function SimulationToolbar() {
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const showWireValues = useStore((s) => s.showWireValues);
  const setShowWireValues = useStore((s) => s.setShowWireValues);
  const snapToAlign = useStore((s) => s.snapToAlign);
  const setSnapToAlign = useStore((s) => s.setSnapToAlign);
  const selectedTool = useStore((s) => s.selectedTool);
  const setSelectedTool = useStore((s) => s.setSelectedTool);

  const handleRun = () => {
    const state = useStore.getState();
    state.evaluateCircuit();
    state.addTableRow();
  };

  const handleStep = () => {
    useStore.getState().evaluateCircuit();
  };

  const handleReset = () => {
    const state = useStore.getState();
    for (const comp of state.components) {
      if (comp.type === 'INPUT') {
        state.setInputValue(comp.id, 0);
      }
    }
  };

  const handleGlobalReset = () => {
    setShowResetConfirm(true);
  };

  const confirmGlobalReset = () => {
    const state = useStore.getState();
    for (const comp of state.components) {
      if (comp.type === 'INPUT') {
        state.setInputValue(comp.id, 0);
      }
    }
    useStore.setState({
      components: useStore.getState().components.map((c) =>
        c.type === 'MEM' ? { ...c, storedValue: 0 } : c
      ),
      tableRows: [],
    });
    useStore.getState().evaluateCircuit();
    setShowResetConfirm(false);
  };

  return (
    <>
      <div className="simulation-toolbar">
        <button className="toolbar-btn" onClick={handleRun} title="Evaluate current inputs and add to table">
          <span className="toolbar-icon">{'\u25B6'}</span> Run
        </button>
        <button className="toolbar-btn" onClick={handleStep} title="Evaluate circuit without adding to table">
          <span className="toolbar-icon">{'\u23ED'}</span> Step
        </button>
        <div className="toolbar-separator" />
        <button className="toolbar-btn" onClick={handleReset} title="Reset all inputs to 0">
          Reset
        </button>
        <button
          className="toolbar-btn toolbar-btn-danger"
          onClick={handleGlobalReset}
          title="Reset all inputs, memory, and table"
        >
          Global Reset
        </button>
        <div className="toolbar-separator" />
        <button
          className="toolbar-btn"
          onClick={() => {
            const state = useStore.getState();
            for (const id of state.selectedIds) {
              state.rotateComponent(id);
            }
          }}
          title="Rotate selected components 90°"
        >
          <span className="toolbar-icon">{'\u21BB'}</span> Rotate
        </button>
        <div className="toolbar-separator" />
        <button
          className={`toolbar-btn ${showWireValues ? 'toolbar-btn-active' : ''}`}
          onClick={() => setShowWireValues(!showWireValues)}
          title="Toggle wire value annotations"
        >
          0/1
        </button>
        <button
          className={`toolbar-btn ${snapToAlign ? 'toolbar-btn-active' : ''}`}
          onClick={() => setSnapToAlign(!snapToAlign)}
          title="Snap to alignment with other components"
        >
          Snap
        </button>
        <div className="toolbar-separator" />
        <button
          className={`toolbar-btn ${selectedTool === 'TEXT' ? 'toolbar-btn-active' : ''}`}
          onClick={() => setSelectedTool(selectedTool === 'TEXT' ? null : 'TEXT')}
          title="Place a text annotation"
        >
          Text
        </button>
        <button
          className={`toolbar-btn ${selectedTool === 'COMMENT' ? 'toolbar-btn-active' : ''}`}
          onClick={() => setSelectedTool(selectedTool === 'COMMENT' ? null : 'COMMENT')}
          title="Attach a comment to a component"
        >
          Comment
        </button>
      </div>

      {showResetConfirm && (
        <div className="modal-overlay" onClick={() => setShowResetConfirm(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Global Reset</div>
            <div className="modal-body">
              This will reset all inputs, memory blocks, and clear the results table. Continue?
            </div>
            <div className="modal-actions">
              <button className="modal-btn" onClick={() => setShowResetConfirm(false)}>
                Cancel
              </button>
              <button className="modal-btn modal-btn-danger" onClick={confirmGlobalReset}>
                Reset Everything
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
