// A palette tile in flight (task 054): which tool is being dragged and where
// the pointer is, shared by the palette (which runs the drag) and the canvas
// (which draws the ghost). Its own tiny store, apart from the editor store:
// it changes at pointer rate and is nobody's work — the editor store's
// subscribers (autosave, the machine key) never hear it.

import { create } from 'zustand';
import type { ArmedTool } from '../palette';

export interface PaletteDrag {
  tool: ArmedTool;
  /** The pointer, in screen coordinates. */
  clientX: number;
  clientY: number;
  /** Draw the ghost: the pointer is over open canvas, not the palette or pop-out. */
  overCanvas: boolean;
  /** A box row held over the palette: dropping pins it (the border turns accent). */
  pinTarget: boolean;
}

export const usePaletteDrag = create<{ drag: PaletteDrag | null }>(() => ({ drag: null }));
