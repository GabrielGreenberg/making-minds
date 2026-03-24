import { useState, useRef, useEffect } from 'react';
import { useStore } from '../store';
import { openFile } from '../fileHandle';
import type { BuildMode } from '../types';

const MACHINE_OPTIONS: { mode: BuildMode; label: string }[] = [
  { mode: 'CC', label: 'Logic Circuit' },
  { mode: 'FSM', label: 'Finite State Machine' },
  { mode: 'TM', label: 'Turing Machine' },
];

const TASK_OPTIONS: { id: 'arithmetic' | 'turbot' | 'navigation' | 'perception'; label: string }[] = [
  { id: 'arithmetic', label: 'Arithmetic' },
  { id: 'navigation', label: 'Navigation' },
  { id: 'perception', label: 'Perception' },
];

/** A toolbar dropdown that shows a checkmark next to the active item */
function ToolbarDropdown({ label, items, activeId, onSelect }: {
  label: string;
  items: { id: string; label: string }[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <span className="toolbar-menu-label" onClick={() => setOpen(!open)}>
        {label} <span style={{ fontSize: 14, marginLeft: 2, opacity: 0.6, position: 'relative', top: '-3px', fontWeight: 300 }}>{'\u2304'}</span>
      </span>
      {open && (
        <div className="toolbar-dropdown-menu">
          {items.map((item) => (
            <div
              key={item.id}
              className={`toolbar-dropdown-item${item.id === activeId ? ' active' : ''}`}
              onClick={() => { onSelect(item.id); setOpen(false); }}
            >
              <span className="toolbar-dropdown-check">{item.id === activeId ? '\u2713' : ''}</span>
              {item.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Options dropdown with toggle items */
function OptionsDropdown({ items }: {
  items: { id: string; label: string; checked: boolean; onToggle: () => void }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <span className="toolbar-menu-label" onClick={() => setOpen(!open)}>
        Options <span style={{ fontSize: 14, marginLeft: 2, opacity: 0.6, position: 'relative', top: '-3px', fontWeight: 300 }}>{'\u2304'}</span>
      </span>
      {open && (
        <div className="toolbar-dropdown-menu">
          {items.map((item) => (
            <div
              key={item.id}
              className="toolbar-dropdown-item"
              onClick={() => item.onToggle()}
            >
              <span className="toolbar-dropdown-check">{item.checked ? '\u2713' : ''}</span>
              {item.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SimulationToolbar() {
  const snapToAlign = useStore((s) => s.snapToAlign);
  const setSnapToAlign = useStore((s) => s.setSnapToAlign);
  const buildMode = useStore((s) => s.buildMode);
  const setBuildMode = useStore((s) => s.setBuildMode);
  const activeTask = useStore((s) => s.activeTask);
  const setActiveTask = useStore((s) => s.setActiveTask);
  const components = useStore((s) => s.components);
  const hasMem = components.some((c) => c.type === 'MEM');
  const isSC = buildMode === 'SC' || hasMem;
  const autoSaveStatus = useStore((s) => s.autoSaveStatus);
  const hasSelection = useStore((s) => s.selectedIds.length > 0);

  const isFSM = buildMode === 'FSM';

  const handleReset = () => {
    const state = useStore.getState();
    if (isFSM) {
      state.fsmReset();
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

  const handleOpen = async () => {
    const text = await openFile();
    if (text) {
      useStore.getState().importProject(text);
    }
  };

  return (
    <>
      <div className="simulation-toolbar">
        <button className="toolbar-btn" onClick={handleOpen} title="Open circuit file">
          Open
        </button>
        <div className="toolbar-separator" />

        <ToolbarDropdown
          label="Machine"
          items={MACHINE_OPTIONS.map((m) => ({ id: m.mode, label: m.label }))}
          activeId={buildMode === 'SC' ? 'CC' : buildMode}
          onSelect={(id) => setBuildMode(id as BuildMode)}
        />

        <ToolbarDropdown
          label="Task"
          items={TASK_OPTIONS.map((t) => ({ id: t.id, label: t.label }))}
          activeId={activeTask}
          onSelect={(id) => setActiveTask(id as typeof activeTask)}
        />

        <OptionsDropdown
          items={[
            { id: 'snap', label: 'Snap to Align', checked: snapToAlign, onToggle: () => setSnapToAlign(!snapToAlign) },
          ]}
        />

        <div className="toolbar-separator" />

        <button className="toolbar-btn" onClick={handleReset} title={isSC ? 'Reset to t=1, preserve input sequence' : 'Clear all inputs'}>
          Clear
        </button>

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
          <span className="toolbar-icon">{'\u21BB'}</span> Rotate
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
