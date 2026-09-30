// The editor's workspace (task 087): the canvas column the frame's centre
// holds for every machine — the canvas, and under it the mode's strip (SC's
// timeline, TM's tape, a TM-brained turbot's internal tape). Moved verbatim
// out of App.tsx so the app and the embeddable sandbox (src/embed/) render
// the same one; the sandbox's worksheet tabs stay the app's (App.tsx).

import { useStore, selectEffectiveMode } from '../store';
import { CircuitCanvas } from './CircuitCanvas';
import { SequentialTimeline } from './SequentialTimeline';
import { TMTapePanel } from './TMTapePanel';
import { TurbotTapePanel } from './TurbotTapePanel';

export function EditorWorkspace() {
  const buildMode = useStore((s) => s.buildMode);
  const effectiveMode = useStore(selectEffectiveMode);
  return (
    <div className="main-area">
      {/* The parts are a floating palette inside the canvas (task 054). */}
      <div className="canvas-and-timeline">
        {/* Turbot questions: the arena ("Map") lives in the output panel
            (DataTable's turbot branch), not here — the canvas column is the
            inner machine's normal editor. A TM-brained turbot shows its
            internal tape (read-only: turbots start on a blank tape). */}
        <CircuitCanvas />
        {buildMode !== 'FSM' && buildMode !== 'TM' && buildMode !== 'turbot' && <SequentialTimeline />}
        {buildMode === 'TM' && <TMTapePanel />}
        {buildMode === 'turbot' && effectiveMode === 'TM' && <TurbotTapePanel />}
      </div>
    </div>
  );
}
