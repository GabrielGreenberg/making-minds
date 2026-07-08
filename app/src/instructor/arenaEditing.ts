// Pure arena-authoring helpers for the instructor's question creator. All
// functions return a new ArenaConfig (no mutation), mirroring the engine's
// immutability discipline. Kept out of engine/ because these are UI-side
// editing conveniences, not evaluation logic.

import type { ArenaCell, ArenaConfig, TurbotOrientation } from '../types';

export const MIN_ARENA_SIZE = 1;
// Authoring-side cap only — ArenaCanvas renders any size. 30 is a hard floor
// on this constant: the Desert Ant capstone (HW7) needs a 30×30 arena. The
// editor scrolls when the grid overflows the panel, so larger caps are cheap.
export const MAX_ARENA_SIZE = 30;

export function blankArena(width = 5, height = 5): ArenaConfig {
  return {
    width,
    height,
    cells: Array.from({ length: height }, () =>
      Array.from({ length: width }, () => 'empty' as const),
    ),
    start: { x: 0, y: 0, facing: 'E' },
  };
}

/** Resize, preserving overlapping contents and clamping the start into bounds. */
export function resizeArena(arena: ArenaConfig, width: number, height: number): ArenaConfig {
  const w = Math.max(MIN_ARENA_SIZE, Math.min(MAX_ARENA_SIZE, Math.trunc(width) || MIN_ARENA_SIZE));
  const h = Math.max(MIN_ARENA_SIZE, Math.min(MAX_ARENA_SIZE, Math.trunc(height) || MIN_ARENA_SIZE));
  const cells: ArenaCell[][] = Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => arena.cells[y]?.[x] ?? 'empty'),
  );
  const start = {
    ...arena.start,
    x: Math.min(arena.start.x, w - 1),
    y: Math.min(arena.start.y, h - 1),
  };
  // The clamped start must not land on a block.
  if (cells[start.y][start.x] === 'block') cells[start.y][start.x] = 'empty';
  return { width: w, height: h, cells, start };
}

/**
 * Paint a cell. A block may not be painted onto the start cell (the turbot
 * cannot begin inside a wall); a goal on the start cell is fine
 * (`return-to-start` questions often want exactly that).
 */
export function setArenaCell(arena: ArenaConfig, x: number, y: number, cell: ArenaCell): ArenaConfig {
  if (x < 0 || y < 0 || x >= arena.width || y >= arena.height) return arena;
  if (cell === 'block' && x === arena.start.x && y === arena.start.y) return arena;
  const cells = arena.cells.map((row, ry) =>
    ry === y ? row.map((c, rx) => (rx === x ? cell : c)) : row,
  );
  return { ...arena, cells };
}

/**
 * Move the turbot's start to a cell (clearing any block there); clicking the
 * start's own cell rotates its facing 90° clockwise instead.
 */
export function placeStart(arena: ArenaConfig, x: number, y: number): ArenaConfig {
  if (x < 0 || y < 0 || x >= arena.width || y >= arena.height) return arena;
  if (x === arena.start.x && y === arena.start.y) {
    return { ...arena, start: { ...arena.start, facing: rotateCW(arena.start.facing) } };
  }
  const cleared = arena.cells[y][x] === 'block' ? setArenaCell(arena, x, y, 'empty') : arena;
  return { ...cleared, start: { ...arena.start, x, y } };
}

export function rotateCW(facing: TurbotOrientation): TurbotOrientation {
  return facing === 'N' ? 'E' : facing === 'E' ? 'S' : facing === 'S' ? 'W' : 'N';
}
