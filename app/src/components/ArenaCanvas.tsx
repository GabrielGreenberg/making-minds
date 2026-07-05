// Arena grid renderer, shared by the student turbot workspace (read-only,
// showing the live simulated pose) and the instructor's arena editor in the
// question creator (clickable, showing the start pose). Purely presentational:
// all mutation goes through the onCellClick callback — the owner decides what
// a click means (paint a block, move the start, nothing).
//
// Visual language per spec §9.1: turbot = triangle pointing in its facing
// direction, block = gray square, goal = green circle.

import type { ArenaConfig, TurbotState, TurbotOrientation } from '../types';

const ROTATION: Record<TurbotOrientation, number> = { N: 0, E: 90, S: 180, W: 270 };

interface Props {
  arena: ArenaConfig;
  /** Pose to draw the turbot at; defaults to the arena's start pose. */
  turbot?: TurbotState | null;
  cellSize?: number;
  onCellClick?: (x: number, y: number) => void;
}

export function ArenaCanvas({ arena, turbot, cellSize = 40, onCellClick }: Props) {
  const pose = turbot ?? arena.start;
  return (
    <div
      className="arena-grid"
      style={{ gridTemplateColumns: `repeat(${arena.width}, ${cellSize}px)` }}
    >
      {arena.cells.map((row, y) =>
        row.map((cell, x) => {
          const hasTurbot = pose.x === x && pose.y === y;
          return (
            <div
              key={`${x},${y}`}
              className={
                'arena-cell' +
                (cell === 'block' ? ' arena-cell--block' : '') +
                (onCellClick ? ' arena-cell--clickable' : '')
              }
              style={{ width: cellSize, height: cellSize }}
              onClick={onCellClick ? () => onCellClick(x, y) : undefined}
            >
              {cell === 'goal' && <span className="arena-goal" />}
              {hasTurbot && (
                <svg
                  className="arena-turbot"
                  viewBox="0 0 24 24"
                  style={{ transform: `rotate(${ROTATION[pose.facing]}deg)` }}
                >
                  <polygon points="12,3 21,21 12,16.5 3,21" />
                </svg>
              )}
            </div>
          );
        }),
      )}
    </div>
  );
}
