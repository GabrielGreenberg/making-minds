// The turbot arena ("Map", spec §9.1) with the live simulated turbot pose,
// plus the movement-cycle controls. Mounted in the right data panel
// (DataTable's turbot branch), below the question statement and above the
// machine/history tables. The simulation itself lives in the store's turbot
// slice; the canvas column stays the inner machine's normal editor.

import { useStore, selectTurbotArena } from '../store';
import { senseAhead } from '../engine/turbot';
import { ArenaCanvas } from './ArenaCanvas';

export function TurbotArenaPanel() {
  const arena = useStore(selectTurbotArena);
  const turbotState = useStore((s) => s.turbotState);
  const turbotHistory = useStore((s) => s.turbotHistory);
  const turbotRunning = useStore((s) => s.turbotRunning);
  const turbotHalted = useStore((s) => s.turbotHalted);
  const turbotStopReason = useStore((s) => s.turbotStopReason);
  const turbotStep = useStore((s) => s.turbotStep);
  const turbotRun = useStore((s) => s.turbotRun);
  const turbotPause = useStore((s) => s.turbotPause);
  const turbotReset = useStore((s) => s.turbotReset);

  const cycle = turbotHistory.length;
  const sensor = senseAhead(arena, turbotState);

  const stopLabel =
    turbotStopReason === 'motor' ? 'STOPPED (motor 00)' :
    turbotStopReason === 'brain' ? 'HALTED (no transition)' :
    turbotStopReason === 'limit' ? 'STOPPED (step limit)' : null;

  return (
    <div className="table-section">
      <div className="table-section-label">
        <span>Map</span>
      </div>
      <div className="turbot-arena-scroll">
        <ArenaCanvas arena={arena} turbot={turbotState} cellSize={28} />
      </div>
      <div className="turbot-arena-controls">
        <button className="action-btn" onClick={turbotStep} disabled={turbotRunning || turbotHalted}>
          Step
        </button>
        {turbotRunning ? (
          <button className="action-btn" onClick={turbotPause}>Pause</button>
        ) : (
          <button className="action-btn" onClick={turbotRun} disabled={turbotHalted}>Run</button>
        )}
        <button className="action-btn" onClick={turbotReset} disabled={turbotRunning}>
          Reset
        </button>
      </div>
      <div className="turbot-arena-status">
        <span>cycle {cycle}</span>
        <span>sensor: {sensor}</span>
        {stopLabel && <span className="turbot-arena-stop">{stopLabel}</span>}
      </div>
    </div>
  );
}
