import { useStore } from '../store';
import { saveToFile, openFile } from '../fileHandle';

export function SimulationToolbar() {
  const snapToAlign = useStore((s) => s.snapToAlign);
  const setSnapToAlign = useStore((s) => s.setSnapToAlign);
  const selectedTool = useStore((s) => s.selectedTool);
  const setSelectedTool = useStore((s) => s.setSelectedTool);
  const buildMode = useStore((s) => s.buildMode);
  const components = useStore((s) => s.components);
  const hasMem = components.some((c) => c.type === 'MEM');
  const isSC = buildMode === 'SC' || hasMem;
  const autoSaveStatus = useStore((s) => s.autoSaveStatus);

  const handleReset = () => {
    const state = useStore.getState();
    if (isSC) {
      state.scReset();
    } else {
      for (const comp of state.components) {
        if (comp.type === 'INPUT') {
          state.setInputValue(comp.id, undefined);
        }
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

        <button className="toolbar-btn" onClick={handleReset} title={isSC ? 'Reset to t=1, preserve input sequence' : 'Clear all inputs'}>
          Clear
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
        <span
          className="autosave-indicator"
          title={autoSaveStatus === 'saved' ? 'All changes saved' : autoSaveStatus === 'saving' ? 'Saving...' : 'Unsaved changes'}
        >
          {autoSaveStatus === 'saved' ? '\u2713 Saved' : autoSaveStatus === 'saving' ? 'Saving...' : '\u2022 Unsaved'}
        </span>
      </div>

    </>
  );
}
