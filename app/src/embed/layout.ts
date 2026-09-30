// The embed's compact layout (task 087): the editor's panels read their prefs
// once as they mount (uiPrefs.ts), so the embed sets these as the page's
// defaults — never stored — before the frame mounts. Measured in headless
// Chrome at 640×420, 800×500 and 1000×560 (tools/shootEmbedPosters.mjs
// --measure; the task's progress log).

import type { BuildMode } from '../types';
import { EDITOR_PREF_KEYS, RIGHT_PANEL } from '../workbench';
import { PALETTE_DEFAULT, PALETTE_PREF_KEY } from '../palette';

/** Below this width the embed shows a still picture instead of the editor. */
export const EMBED_NARROW_QUERY = '(max-width: 599px)';

/** Below this width a combinational circuit starts with its output panel
 *  collapsed: it evaluates live as its inputs are toggled, and the canvas
 *  needs the room. Every other machine keeps the panel at any width — its Run
 *  and Step are there (and a turbot's Map), and a demo that cannot be run
 *  until the visitor finds a folded strip is no demo. */
export const EMBED_OUTPUT_COLLAPSE_BELOW = 760;

/** The output panel's width from this frame width up (below: its minimum). */
const ROOMY = 900;
const ROOMY_OUTPUT_W = 300;
/** The Map's cells: never bigger than this, never smaller than the Map's own floor. */
const MAP_CELL = { min: 12, max: 32 } as const;
/** What the Map's cells leave of the output panel: across, the panel's
 *  paddings; down, the bar, the panel's head, the run row, the Map's label
 *  and its readout (measured). */
const MAP_ROOM = { across: 44, down: 250 } as const;

export function embedLayoutDefaults(
  frame: { width: number; height: number },
  example: { buildMode: BuildMode; arena?: { width: number; height: number } },
): Record<string, unknown> {
  const rightW = frame.width >= ROOMY ? ROOMY_OUTPUT_W : RIGHT_PANEL.min;
  const prefs: Record<string, unknown> = {
    [EDITOR_PREF_KEYS.rightOpen]: example.buildMode !== 'CC' || frame.width >= EMBED_OUTPUT_COLLAPSE_BELOW,
    [EDITOR_PREF_KEYS.rightW]: rightW,
    // The parts palette keeps the app's own placement (palette.ts
    // PALETTE_DEFAULT): standing at the top left, lying flat where it can't
    // stand, dropping under the canvas's actions where they meet. Measured,
    // that beats docking it flat along the top: a state machine's one-tile
    // palette then stands beside the example instead of pushing it down. The
    // load's Fit keeps clear of it wherever it settles (CircuitCanvas: the
    // swap's fit follows the palette until the visitor does anything).
    [PALETTE_PREF_KEY]: PALETTE_DEFAULT,
    localOpen: true,
    globalOpen: true,
  };
  if (example.arena) {
    // The whole arena in view without scrolling (a turbot's Map).
    const across = Math.floor((rightW - MAP_ROOM.across) / example.arena.width);
    const down = Math.floor((frame.height - MAP_ROOM.down) / example.arena.height);
    prefs.arenaCellSize = Math.max(MAP_CELL.min, Math.min(MAP_CELL.max, across, down));
  }
  return prefs;
}
