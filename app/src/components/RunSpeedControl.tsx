import { useState } from 'react';
import { saveUiPref } from '../uiPrefs';

/** A run-speed multiplier as the control shows it: "2x", "0.5x", "0.25x". */
function speedLabel(speed: number): string {
  return `${speed >= 1 ? Math.round(speed) : speed.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}x`;
}

/**
 * The SC run-speed control (1 = 300 ms per step, 2 = 150 ms, 0.5 = 600 ms …):
 * a small "Nx" chip that opens a log-scale slider. The value is the caller's
 * state; a change is also saved as the `runSpeed` UI pref. Shared by the
 * Global I/O block and the perception frame player (task 012), which is shown
 * in its place — so every SC run keeps a reachable speed control.
 */
export function RunSpeedControl({ speed, onChange }: { speed: number; onChange: (speed: number) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative', marginLeft: 'auto' }}>
      <span
        onClick={() => setOpen(!open)}
        style={{
          fontSize: 10, padding: '2px 4px',
          color: '#888',
          cursor: 'pointer',
          fontFamily: 'monospace',
        }}
        title="Run speed"
      >
        {speedLabel(speed)}
      </span>
      {open && (
        <div
          style={{
            position: 'absolute', bottom: '100%', right: 0,
            background: 'white', border: '1px solid #ccc',
            borderRadius: 4, padding: '8px 12px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            zIndex: 100, whiteSpace: 'nowrap',
          }}
          onMouseLeave={() => setOpen(false)}
        >
          <div style={{ fontSize: 10, color: '#888', marginBottom: 4, textAlign: 'center' }}>Run Speed</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, color: '#aaa' }}>slow</span>
            <input
              type="range"
              min={-2}
              max={3}
              step={0.5}
              value={Math.log2(speed)}
              onChange={(e) => {
                const next = Math.pow(2, parseFloat(e.target.value));
                onChange(next);
                saveUiPref('runSpeed', next);
              }}
              style={{ width: 80 }}
            />
            <span style={{ fontSize: 10, color: '#aaa' }}>fast</span>
          </div>
          <div style={{ fontSize: 11, textAlign: 'center', marginTop: 2, fontFamily: 'monospace' }}>{speedLabel(speed)}</div>
        </div>
      )}
    </div>
  );
}
