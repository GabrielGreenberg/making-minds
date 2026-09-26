// The canvas's edit actions (task 053; design memo editor-workbench.md
// §Canvas): a joined button group at the canvas's top-right — Undo · Redo ·
// Delete · Rotate · Clear, and a turbot TM's Swap state type — taking over
// what the retired simulation toolbar held (run controls went to the output
// panel). Every button calls the store's own action, which carries the lock
// (law 3); the disabled look only mirrors it.

import { useState } from 'react';
import { useStore, selectEffectiveMode, selectQuestionLocked, selectPlaceableBoxKinds } from '../store';

export function CanvasActions() {
  const canUndo = useStore((s) => s.undoStack.length > 0);
  const canRedo = useStore((s) => s.redoStack.length > 0);
  const selectedIds = useStore((s) => s.selectedIds);
  const components = useStore((s) => s.components);
  const locked = useStore(selectQuestionLocked);
  const buildMode = useStore((s) => s.buildMode);
  const effectiveMode = useStore(selectEffectiveMode);
  const [confirmClear, setConfirmClear] = useState(false);
  const canBox = useStore((s) => selectPlaceableBoxKinds(s).length > 0);
  const editingBox = useStore((s) => s.boxEditor !== null);
  const hasBoxable = selectedIds.some((id) => {
    const t = components.find((c) => c.id === id)?.type;
    return t !== undefined && t !== 'INPUT' && t !== 'OUTPUT' && t !== 'STATE';
  });

  const hasSelection = selectedIds.length > 0;
  const hasStateSelected = selectedIds.some((id) => components.find((c) => c.id === id)?.type === 'STATE');
  // Turbot TM: flip selected states between internal (circle, tape ops) and
  // external (square, sense/move ops) — the textbook's convention.
  const isTurbotTM = buildMode === 'turbot' && effectiveMode === 'TM';
  const act = (fn: () => void) => () => fn();
  const s = () => useStore.getState();

  return (
    <div className="cv-actions">
      <div className="cv-group" role="toolbar" aria-label="Edit the canvas">
        <button type="button" disabled={locked || !canUndo} onClick={act(() => s().undo())} title="Undo (⌘Z / Ctrl+Z)">
          ↶ Undo
        </button>
        <button type="button" disabled={locked || !canRedo} onClick={act(() => s().redo())} title="Redo (⇧⌘Z / Ctrl+Shift+Z)" aria-label="Redo">
          ↷
        </button>
        <button type="button" disabled={locked || !hasSelection} onClick={act(() => s().deleteSelected())} title="Delete the selection (Delete key)">
          Delete
        </button>
        <button
          type="button"
          disabled={locked || !hasSelection}
          onClick={act(() => {
            for (const id of s().selectedIds) s().rotateComponent(id);
          })}
          title="Rotate the selection 90° (or shift+click a part)"
        >
          ↻ Rotate
        </button>
        {canBox && !editingBox && (
          <button
            type="button"
            disabled={locked || !hasBoxable}
            onClick={act(() => {
              const err = s().boxSelection();
              if (err) alert(err);
            })}
            title="Turn the selected parts into a box (inputs and outputs stay on the canvas)"
          >
            ▣ Box
          </button>
        )}
        {isTurbotTM && (
          <button
            type="button"
            disabled={locked || !hasStateSelected}
            onClick={act(() => {
              for (const id of s().selectedIds) s().toggleStateKind(id);
            })}
            title="Toggle selected states between internal (circle: read/write/move the tape) and external (square: sense ahead and move/turn)"
          >
            ▢ Swap state type
          </button>
        )}
        <button type="button" disabled={locked || components.length === 0} onClick={() => setConfirmClear(true)} title="Remove everything from this canvas">
          Clear
        </button>
      </div>
      {/* The gesture, beside its button (task 024) — a sibling, so a disabled
          Rotate (nothing selected, most of the time) never fades it. */}
      <span className="cv-hint">(shift+click to ↻)</span>
      {confirmClear && (
        <div className="cv-confirm mm-surface" role="alertdialog" aria-label="Clear the canvas?">
          <p>Clear everything on this canvas?</p>
          <div className="cv-confirm-actions">
            <button type="button" className="mm-btn mm-btn--small" onClick={() => setConfirmClear(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="mm-btn mm-btn--small mm-btn--danger"
              onClick={() => {
                s().clearWorkspace();
                setConfirmClear(false);
              }}
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
