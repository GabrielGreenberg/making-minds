// The canvas's one-line hint (bottom-left) and its empty-canvas message
// (centred) — task 055; the design memo's §Canvas. What they say is
// canvasView.ts's pure decision; the lock is only READ here, to say what
// still works (law 3: the store's actions carry it).

import { useStore, selectEffectiveMode, selectQuestionLocked } from '../store';
import { canvasHint, EMPTY_BOX_MESSAGE, EMPTY_CANVAS_MESSAGE } from '../canvasView';
import { toolLabel } from '../palette';

export function CanvasGuide() {
  const components = useStore((s) => s.components);
  const wires = useStore((s) => s.wires);
  const selectedIds = useStore((s) => s.selectedIds);
  const tool = useStore((s) => s.selectedTool);
  const library = useStore((s) => s.confirmedBoxLibrary);
  const effectiveMode = useStore(selectEffectiveMode);
  const locked = useStore(selectQuestionLocked);
  const editingBox = useStore((s) => s.boxEditor !== null);

  if (components.length === 0) {
    return locked ? null : <p className="cv-guide-empty">{editingBox ? EMPTY_BOX_MESSAGE : EMPTY_CANVAS_MESSAGE}</p>;
  }
  const selected = new Set(selectedIds);
  const hint = canvasHint({
    tool: tool === null ? null : toolLabel(tool, library),
    selectedParts: components.filter((c) => selected.has(c.id)).length,
    selectedWires: wires.filter((w) => selected.has(w.id)).length,
    parts: components.length,
    wires: wires.length,
    stateMachine: effectiveMode === 'FSM' || effectiveMode === 'TM',
    locked,
  });
  return hint ? <p className="cv-guide-hint">{hint}</p> : null;
}
