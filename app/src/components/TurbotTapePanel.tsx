import { useState } from 'react';
import { useStore } from '../store';

/**
 * A turbot TM's internal tape: the same strip as TMTapePanel but read-only —
 * turbots start on a blank tape (textbook "Turbots: Operation") and only the
 * machine's internal write/move ops change it. Mounted below the canvas when
 * a turbot question's inner mode is TM.
 */
export function TurbotTapePanel() {
  const tape = useStore((s) => s.turbotBrainState.tape) ?? { cells: {}, head: 0 };
  const turbotHalted = useStore((s) => s.turbotHalted);
  const cycle = useStore((s) => s.turbotHistory.length);

  const [open, setOpen] = useState(true);

  const written = Object.keys(tape.cells).map(Number);
  const lo = Math.min(0, tape.head, ...written) - 4;
  const hi = Math.max(0, tape.head, ...written) + 4;
  const indices: number[] = [];
  for (let i = lo; i <= hi; i++) indices.push(i);
  while (indices.length < 21) indices.push(indices[indices.length - 1] + 1);

  return (
    <div className="bottom-timeline-panel">
      <div
        className="timeline-header-bar"
        onClick={() => setOpen(!open)}
        title={open ? 'Collapse tape' : 'Expand tape'}
      >
        <span className="pod-toggle" style={{ marginRight: 4 }}>{open ? '▼' : '▶'}</span>
        <span>Internal Tape</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#999', fontWeight: 400 }}>
          {turbotHalted ? 'halted' : cycle === 0 ? 'blank at start' : `t=${cycle}`}
        </span>
      </div>
      {open && (
        <div style={{ overflowX: 'auto', padding: '18px 10px 10px' }}>
          <div style={{ display: 'flex', width: 'max-content', margin: '0 auto' }}>
            {indices.map((i) => {
              const symbol = tape.cells[i] ?? '0';
              const isHead = i === tape.head;
              return (
                <div
                  key={i}
                  title={`cell ${i}`}
                  style={{
                    width: 40,
                    height: 46,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid #bbb',
                    borderLeftWidth: 0,
                    boxSizing: 'border-box',
                    position: 'relative',
                    cursor: 'default',
                    fontFamily: "'SF Mono','Fira Code',monospace",
                    fontSize: 19,
                    fontWeight: symbol === '0' ? 400 : 700,
                    color: symbol === '0' ? '#ccc' : symbol === '*' ? '#2a7fff' : '#c62828',
                    background: isHead ? '#fff8e1' : 'white',
                    ...(i === indices[0] ? { borderLeftWidth: 1 } : {}),
                  }}
                >
                  {symbol}
                  {isHead && (
                    <span
                      style={{
                        position: 'absolute',
                        top: -14,
                        left: 0,
                        right: 0,
                        textAlign: 'center',
                        fontSize: 12,
                        color: '#e53935',
                        lineHeight: 1,
                      }}
                    >
                      ▼
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
