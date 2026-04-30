import { useState, useRef, useEffect } from 'react';
import { useStore } from '../store';

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
    const handler = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handler, true);
    return () => document.removeEventListener('pointerdown', handler, true);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <span className="toolbar-menu-label" onClick={() => setOpen(!open)}>
        {label} <span style={{ fontSize: 14, marginLeft: 2, opacity: 0.6, position: 'relative', top: '-3px', fontWeight: 300 }}>{'⌄'}</span>
      </span>
      {open && (
        <div className="toolbar-dropdown-menu">
          {items.map((item) => (
            <div
              key={item.id}
              className={`toolbar-dropdown-item${item.id === activeId ? ' active' : ''}`}
              onClick={() => { onSelect(item.id); setOpen(false); }}
            >
              <span className="toolbar-dropdown-check">{item.id === activeId ? '✓' : ''}</span>
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
    const handler = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handler, true);
    return () => document.removeEventListener('pointerdown', handler, true);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <span className="toolbar-menu-label" onClick={() => setOpen(!open)}>
        Options <span style={{ fontSize: 14, marginLeft: 2, opacity: 0.6, position: 'relative', top: '-3px', fontWeight: 300 }}>{'⌄'}</span>
      </span>
      {open && (
        <div className="toolbar-dropdown-menu">
          {items.map((item) => (
            <div
              key={item.id}
              className="toolbar-dropdown-item"
              onClick={() => item.onToggle()}
            >
              <span className="toolbar-dropdown-check">{item.checked ? '✓' : ''}</span>
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
  const activeTask = useStore((s) => s.activeTask);
  const setActiveTask = useStore((s) => s.setActiveTask);
  const components = useStore((s) => s.components);
  const hasMem = components.some((c) => c.type === 'MEM');
  const isSC = buildMode === 'SC' || hasMem;
  const autoSaveStatus = useStore((s) => s.autoSaveStatus);
  const hasSelection = useStore((s) => s.selectedIds.length > 0);

  const isFSM = buildMode === 'FSM';
  const fsmCurrentStateId = useStore((s) => s.fsmCurrentStateId);
  const fsmCurrentStateLabel = isFSM && fsmCurrentStateId
    ? components.find((c) => c.id === fsmCurrentStateId)?.label ?? null
    : null;

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

  return (
    <>
      <div className="simulation-toolbar">
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
          <span className="toolbar-icon">{'↻'}</span> Rotate
        </button>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          {isFSM && (
            <span style={{ fontSize: 12, color: '#555', fontFamily: "'SF Mono', 'Fira Code', monospace" }}>
              Current state: {fsmCurrentStateLabel ?? 'S₀'}
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
