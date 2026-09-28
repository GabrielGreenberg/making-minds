/**
 * A film of retina frames as a clickable grid — the student's frame player
 * (PerceptionFramePlayer) and the instructor's authored films
 * (instructor/PerceptionEditor) draw the same one.
 *
 * Layout follows the SC tables: time flows right to left (t1 rightmost, a
 * new frame appears on the left); rows are the retina's wires, IN1 on top —
 * "up" is toward IN1, as the motion rule reads it. Cells are buttons (no
 * text field: frames are clicked, never typed or pasted). One optional row
 * under the wires shows a bit per step (the player: the machine's output;
 * the editor: the rule's expected output), and a second optional row under
 * it (the player: a loaded example's expected output). The grid holds no
 * state: every change is the caller's.
 */
export function FrameFilmGrid({
  frames,
  width,
  rowLabels,
  outputRow,
  expectedRow,
  selected,
  current = null,
  maxFrames,
  onToggle,
  onSelect,
  onAdd,
  readOnly = false,
}: {
  frames: number[][];
  width: number;
  /** Row i's label (the INPUT it drives); IN(i+1) when absent. */
  rowLabels?: string[];
  /** A bit per frame (index = frame), undefined where there is none yet. */
  outputRow?: { label: string; bits: (number | undefined)[] };
  /** A second bit row under `outputRow` (same shape). */
  expectedRow?: { label: string; bits: (number | undefined)[] };
  /** The frame picked for the caller's per-frame tools (0-based), or null. */
  selected: number | null;
  /** The frame on show now (0-based) — the player's clocked-in frame. */
  current?: number | null;
  maxFrames: number;
  onToggle: (frame: number, wire: number) => void;
  onSelect: (frame: number | null) => void;
  onAdd: () => void;
  readOnly?: boolean;
}) {
  const count = frames.length;
  const steps = Array.from({ length: count }, (_, k) => count - k); // t descending: t1 rightmost
  const colClass = (t: number) =>
    [t - 1 === current ? 'pf-col-current' : '', t - 1 === selected ? 'pf-col-selected' : ''].join(' ').trim();

  return (
    <div className="pf-scroll">
      <table className="pf-grid">
        <tbody>
          <tr>
            {!readOnly && (
              <td className="pf-add" rowSpan={width + 1 + (outputRow ? 1 : 0) + (expectedRow ? 1 : 0)}>
                <button
                  className="pf-add-btn"
                  onClick={onAdd}
                  disabled={count >= maxFrames}
                  title={count >= maxFrames ? `At most ${maxFrames} frames` : 'Add a frame (a copy of the newest)'}
                >
                  +
                </button>
              </td>
            )}
            {steps.map((t) => (
              <th
                key={t}
                className={`pf-t ${colClass(t)}`}
                onClick={() => onSelect(selected === t - 1 ? null : t - 1)}
                title={`Frame t${t}: click to shift, duplicate or delete it`}
              >
                t{t}
              </th>
            ))}
            <th className="pf-label" />
          </tr>
          {Array.from({ length: width }, (_, wire) => {
            const label = rowLabels?.[wire] ?? `IN${wire + 1}`;
            return (
              <tr key={wire}>
                {steps.map((t) => {
                  const bit = frames[t - 1][wire] ?? 0;
                  return (
                    <td key={t} className={colClass(t)}>
                      <button
                        className={`pf-bit${bit ? ' on' : ''}`}
                        onClick={() => onToggle(t - 1, wire)}
                        disabled={readOnly}
                        aria-pressed={bit === 1}
                        aria-label={`${label} at t${t}: ${bit}`}
                      >
                        {bit}
                      </button>
                    </td>
                  );
                })}
                <th className="pf-label">{label}</th>
              </tr>
            );
          })}
          {[outputRow, expectedRow].map((row, r) => row && (
            <tr key={r} className="pf-out">
              {steps.map((t) => {
                const out = row.bits[t - 1];
                return (
                  <td key={t} className={`pf-out-bit${out === 1 ? ' val-1' : ''} ${colClass(t)}`}>
                    {out ?? ''}
                  </td>
                );
              })}
              <th className="pf-label">{row.label}</th>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
