// The editor's host (task 087): what the page around the editor asks of it,
// as data the components read — never a flag a component invents. The app is
// the default host; the embeddable sandbox (src/embed/) provides its own.
//
// gesturesNeedActivation — inside an iframe on someone else's page, a plain
// wheel or trackpad scroll over the canvas, and a touch swipe over it, must
// scroll that page, not pan the canvas, until the visitor has clicked or
// tapped into it (CircuitCanvas's gesture effect). The app keeps its
// full-window behaviour: the wheel pans and zooms, and a touch drags, from
// the start.

import { createContext, useContext } from 'react';

export interface EditorHost {
  /** The canvas claims the page's scroll gestures — the wheel, a touch —
   *  only after a mouse or pen press inside it, or a tap (a touch the browser
   *  did not take for a scroll); it lets go when the pointer leaves the page
   *  or the page loses focus. */
  gesturesNeedActivation: boolean;
}

export const APP_HOST: EditorHost = { gesturesNeedActivation: false };
export const EMBED_HOST: EditorHost = { gesturesNeedActivation: true };

export const EditorHostContext = createContext<EditorHost>(APP_HOST);

export function useEditorHost(): EditorHost {
  return useContext(EditorHostContext);
}

/** A pointer event, as far as the claim reads it. */
export interface ClaimPointer {
  pointerType: string;
  pointerId: number;
}

/** The canvas's claim on the page's scroll gestures (CircuitCanvas wires the
 *  DOM to it): claimed from the start unless the host needs activation; then
 *  a mouse or pen press claims at once, a touch only as a tap — it ends
 *  (`up`) without the browser taking it for a scroll (`cancel`) — and
 *  `release` (the pointer left the page, the page lost focus) hands the
 *  gestures back. Pure: the harness drives it (embedCheck [host]). */
export interface GestureClaim {
  readonly claimed: boolean;
  /** A press inside the canvas, at capture. True: the press is the page's —
   *  keep it from the canvas's handlers (a swipe the browser takes would
   *  leave the canvas mid-drag). */
  down(e: ClaimPointer): boolean;
  up(e: ClaimPointer): void;
  cancel(e: ClaimPointer): void;
  release(): void;
}

export function gestureClaim(host: EditorHost, onChange: (claimed: boolean) => void = () => {}): GestureClaim {
  let claimed = !host.gesturesNeedActivation;
  let tap: number | null = null; // a touch that may yet prove a tap
  const set = (on: boolean) => {
    if (on === claimed) return;
    claimed = on;
    onChange(on);
  };
  return {
    get claimed() {
      return claimed;
    },
    down(e) {
      if (claimed) return false;
      if (e.pointerType !== 'touch') {
        set(true);
        return false;
      }
      tap = e.pointerId;
      return true;
    },
    up(e) {
      if (e.pointerId !== tap) return;
      tap = null;
      set(true);
    },
    cancel(e) {
      if (e.pointerId === tap) tap = null;
    },
    release() {
      tap = null;
      if (host.gesturesNeedActivation) set(false);
    },
  };
}
