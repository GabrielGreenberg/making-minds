import { useStore } from '../store';
import { saveToFile, openFile } from '../fileHandle';

export function SimulationToolbar() {
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


  const handleOpen = async () => {
    const text = await openFile();
    if (text) {
      useStore.getState().importProject(text);
    }
  };

  const handleSave = () => {
    const json = useStore.getState().exportProject();
    saveToFile(json);
  };

  return (
    <>
      <div className="simulation-toolbar">
        <button className="toolbar-btn" onClick={handleOpen} title="Open circuit file">
          Open
        </button>
        <button className="toolbar-btn" onClick={handleSave} title="Save circuit to file">
          Save
        </button>
        <div className="toolbar-separator" />
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

    </>
  );
}
