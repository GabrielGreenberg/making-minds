import { useState, useRef, useEffect } from 'react';
import { useStore } from '../store';

export function SequentialTimeline() {
  const components = useStore((s) => s.components);
  const scHistory = useStore((s) => s.scHistory);
  const scInputSequence = useStore((s) => s.scInputSequence);
  const scTimeStep = useStore((s) => s.scTimeStep);
  const setScInputBit = useStore((s) => s.setScInputBit);
  const buildMode = useStore((s) => s.buildMode);
  const hasMem = components.some((c) => c.type === 'MEM');
  const isSC = buildMode === 'SC' || hasMem;

  const [open, setOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevColCount = useRef(0);

  const inputs = components
    .filter((c) => c.type === 'INPUT')
    .sort((a, b) => parseInt(a.label.replace('IN', '')) - parseInt(b.label.replace('IN', '')));

  const outputs = components
    .filter((c) => c.type === 'OUTPUT')
    .sort((a, b) => parseInt(a.label.replace('OUT', '')) - parseInt(b.label.replace('OUT', '')));

  // Only show columns that have data (evaluated), but always show t1
  const maxHistoryT = scHistory.length > 0 ? Math.max(...scHistory.map((h) => h.t)) : 0;
  const numCols = Math.max(maxHistoryT, 1);

  // Measure available width to fill empty space with tick marks
  const containerRef = useRef<HTMLDivElement>(null);
  const [fillerCount, setFillerCount] = useState(0);
  const colWidth = 28; // matches min-width on sc-table td

  // Auto-scroll left when new columns appear (they grow from the right edge leftward)
  useEffect(() => {
    if (numCols > prevColCount.current && scrollRef.current) {
      scrollRef.current.scrollLeft = 0; // scroll to the left (newest columns)
    }
    prevColCount.current = numCols;
  }, [numCols]);

  useEffect(() => {
    if (!open || !isSC || !containerRef.current) return;
    const measure = () => {
      const container = containerRef.current;
      if (!container) return;
      const availableWidth = container.clientWidth;
      const labelColWidth = 42; // sticky label column
      const dataWidth = numCols * colWidth;
      const remaining = availableWidth - dataWidth - labelColWidth;
      setFillerCount(Math.max(0, Math.floor(remaining / colWidth)));
    };
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [open, numCols, isSC]);

  if (!isSC || inputs.length === 0) return null;

  const timeSteps: number[] = [];
  for (let t = 1; t <= numCols; t++) timeSteps.push(t);

  const getInputBit = (inputIdx: number, t: number): number | undefined => {
    if (scInputSequence[inputIdx] && scInputSequence[inputIdx][t - 1] !== undefined) {
      return scInputSequence[inputIdx][t - 1];
    }
    return undefined;
  };

  const getOutputBit = (outputIdx: number, t: number): number | undefined => {
    const entry = scHistory.find((h) => h.t === t);
    if (entry && entry.outputBits[outputIdx] !== undefined) {
      return entry.outputBits[outputIdx];
    }
    return undefined;
  };

  return (
    <div className="bottom-timeline-panel">
      {/* Header bar — at the top, acts as the fold toggle */}
      <div
        className="timeline-header-bar"
        onClick={() => setOpen(!open)}
        title={open ? 'Collapse timeline' : 'Expand timeline'}
      >
        <span className="pod-toggle" style={{ marginRight: 4 }}>{open ? '▼' : '▶'}</span>
        <span>Sequential Timeline</span>
      </div>
      {/* Content area — collapses (hidden when closed) */}
      {open && (
        <div
          className="timeline-scroll-area"
          ref={(el) => {
            (scrollRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
            (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
          }}
          style={{ overflowX: 'auto', overflowY: 'hidden', direction: 'rtl' }}
        >
          <div style={{ direction: 'ltr', display: 'inline-block', minWidth: '100%' }}>
            <table className="data-table sc-table" style={{ marginLeft: 'auto', width: '100%' }}>
              <thead>
                <tr>
                  {/* Filler tick columns */}
                  {Array.from({ length: fillerCount }, (_, i) => (
                    <th key={`filler-${i}`} className="sc-filler-col" />
                  ))}
                  {/* Time headers in reverse: highest t on the left */}
                  {[...timeSteps].reverse().map((t) => (
                    <th key={t} className={t === scTimeStep ? 'sc-current-step' : ''}>
                      t{t}
                    </th>
                  ))}
                  <th className="sc-label-col"></th>
                </tr>
              </thead>
              <tbody>
                {inputs.map((inp, inputIdx) => (
                  <tr key={inp.id} className="sc-input-row">
                    {Array.from({ length: fillerCount }, (_, i) => (
                      <td key={`filler-${i}`} className="sc-filler-col" />
                    ))}
                    {[...timeSteps].reverse().map((t) => {
                      const val = getInputBit(inputIdx, t);
                      const evaluated = scHistory.some((h) => h.t === t);
                      return (
                        <td
                          key={t}
                          className={`sc-cell sc-input-cell ${val === 1 ? 'val-1' : ''} ${t === scTimeStep ? 'sc-current-step' : ''}`}
                        >
                          {evaluated ? (
                            <span className="mono-value">{val !== undefined ? val : ''}</span>
                          ) : (
                            <input
                              type="text"
                              className="sc-input-field"
                              value={val !== undefined ? String(val) : ''}
                              placeholder=""
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === '0' || v === '1' || v === '') {
                                  setScInputBit(inputIdx, t, v === '1' ? 1 : 0);
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === '0' || e.key === '1') {
                                  e.preventDefault();
                                  setScInputBit(inputIdx, t, e.key === '1' ? 1 : 0);
                                  const next = e.currentTarget.parentElement?.previousElementSibling?.querySelector('input');
                                  if (next instanceof HTMLInputElement) next.focus();
                                }
                              }}
                              style={{ width: 20, textAlign: 'center', border: 'none', background: 'transparent', color: 'inherit', fontSize: 11 }}
                            />
                          )}
                        </td>
                      );
                    })}
                    <td className="sc-label-col">{inp.label}</td>
                  </tr>
                ))}
                {outputs.map((out, outputIdx) => (
                  <tr key={out.id} className="sc-output-row">
                    {Array.from({ length: fillerCount }, (_, i) => (
                      <td key={`filler-${i}`} className="sc-filler-col" />
                    ))}
                    {[...timeSteps].reverse().map((t) => {
                      const val = getOutputBit(outputIdx, t);
                      return (
                        <td
                          key={t}
                          className={`sc-cell ${val === 1 ? 'val-1' : ''} ${t === scTimeStep ? 'sc-current-step' : ''}`}
                        >
                          <span className="mono-value">{val !== undefined ? val : ''}</span>
                        </td>
                      );
                    })}
                    <td className="sc-label-col">{out.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
