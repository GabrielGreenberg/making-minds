import { useState } from 'react';
import { useStore } from '../store';
import { notationForRepresentation } from '../engine';

/**
 * The Turing machine tape: a horizontal strip of cells at the bottom of the
 * canvas (the TM counterpart of the SC SequentialTimeline). While the machine
 * is idle (t=1), clicking a cell cycles its symbol (unary 0→1; binary 0→1→*)
 * and shift-clicking moves the head; edits become the initial tape that Reset
 * restores. During/after a run the strip is read-only and just shows the
 * head + written cells.
 */
export function TMTapePanel() {
  const tmTape = useStore((s) => s.tmTape);
  const tmTimeStep = useStore((s) => s.tmTimeStep);
  const tmRunning = useStore((s) => s.tmRunning);
  const tmHalted = useStore((s) => s.tmHalted);
  const repSystem = useStore((s) => s.repSystem);
  const setTmCell = useStore((s) => s.setTmCell);
  const setTmHead = useStore((s) => s.setTmHead);

  const [open, setOpen] = useState(true);

  const notation = notationForRepresentation(repSystem);
  const editable = tmTimeStep === 1 && !tmRunning && !tmHalted;

  // Show every written cell and the head, with a margin of blank cells on both
  // sides (so there is always background tape to write into), at least 21 wide.
  const written = Object.keys(tmTape.cells).map(Number);
  const lo = Math.min(0, tmTape.head, ...written) - 4;
  const hi = Math.max(0, tmTape.head, ...written) + 4;
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
        <span>Tape</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#999', fontWeight: 400 }}>
          {editable
            ? `click a cell to set its symbol${notation === 'binary' ? ' (0 → 1 → *)' : ''} · shift-click to move the head`
            : tmHalted
              ? 'halted'
              : `t=${tmTimeStep}`}
        </span>
      </div>
      {open && (
        <div style={{ overflowX: 'auto', padding: '12px 10px 8px' }}>
          <div style={{ display: 'flex', width: 'max-content', margin: '0 auto' }}>
            {indices.map((i) => {
              const symbol = tmTape.cells[i] ?? '0';
              const isHead = i === tmTape.head;
              return (
                <div
                  key={i}
                  onClick={(e) => {
                    if (!editable) return;
                    if (e.shiftKey) setTmHead(i);
                    else setTmCell(i);
                  }}
                  title={editable ? `cell ${i} — click to change` : `cell ${i}`}
                  style={{
                    width: 26,
                    height: 30,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid #bbb',
                    borderLeftWidth: 0,
                    boxSizing: 'border-box',
                    position: 'relative',
                    cursor: editable ? 'pointer' : 'default',
                    fontFamily: "'SF Mono','Fira Code',monospace",
                    fontSize: 13,
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
                        top: -11,
                        left: 0,
                        right: 0,
                        textAlign: 'center',
                        fontSize: 9,
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
