// The canvas's colours, as roles read from the page's theme tokens (task 055).
// The canvas draws in SVG presentation attributes, where a `var(--…)` is not
// reliably honoured across browsers, so each role names the theme.css token
// it wears and `canvasColors()` reads the tokens' values off the document —
// the SAME values every page surface shows. CircuitCanvas holds no colour
// literal of its own (themeCheck pins it, and that every role's token is
// defined); a new colour is a new role here and a token in theme.css :root.
// HTML inside the canvas (the transition editor, the name field) uses the
// tokens directly, in `var()`, through `canvasVar`.

export const CANVAS_TOKENS = {
  /** A part's outline, a 0 on a wire, the symbols. */
  ink: '--mm-ink',
  /** Secondary marks: a MEM's direction chevrons once resolved, a toggle's rim. */
  ink2: '--mm-ink-2',
  /** Labels ("IN1"), port names, a 0 written beside a wire. */
  dim: '--mm-ink-3',
  /** A part's body. */
  surface: '--mm-surface',
  /** A box's and a MEM's quiet body. */
  quiet: '--mm-surface-3',
  /** Hairlines: a transition label's frame and divider. */
  line: '--mm-line',
  line2: '--mm-line-2',
  /** A MEM's undecided chevrons, an unset input's toggle. */
  faint: '--mm-edge-2',
  /** Selection: outline and body. */
  select: '--mm-accent',
  selectFill: '--mm-lav-soft',
  /** The halo under a selected wire. */
  halo: '--mm-lav',
  /** A signal: 0 and 1 (black = 0, red = 1 — CLAUDE.md Critical design rules). */
  signal0: '--mm-signal-0',
  signal1: '--mm-signal-1',
  signal1Soft: '--mm-signal-1-soft',
  /** The state machine's current state. */
  live: '--mm-ok',
  liveSoft: '--mm-ok-soft',
  /** A routing violation's halo, a box boundary's crossing ports. */
  warn: '--mm-orange',
  /** A wire segment dragged where it may not go. */
  danger: '--mm-danger',
  /** Snap alignment guides. */
  guide: '--mm-accent-2',
} as const;

export type CanvasRole = keyof typeof CANVAS_TOKENS;
export type CanvasColors = Record<CanvasRole, string>;

let resolved: CanvasColors | null = null;

/** The canvas's colours, read once from the theme tokens. Until the theme
 *  stylesheet is in (a first paint racing it in development) it reads again
 *  on the next call rather than caching blanks. */
export function canvasColors(): CanvasColors {
  if (resolved) return resolved;
  const out = {} as CanvasColors;
  let complete = typeof document !== 'undefined';
  const style = complete ? getComputedStyle(document.documentElement) : null;
  for (const role of Object.keys(CANVAS_TOKENS) as CanvasRole[]) {
    const value = style?.getPropertyValue(CANVAS_TOKENS[role]).trim() ?? '';
    if (!value) complete = false;
    out[role] = value;
  }
  if (complete) resolved = out;
  return out;
}

/** A role as a CSS `var()` — for HTML inline styles inside the canvas. */
export function canvasVar(role: CanvasRole): string {
  return `var(${CANVAS_TOKENS[role]})`;
}

/** A signal's colour: 1 red, anything else (0, blank) the ink. */
export function signalColor(c: CanvasColors, value: number | null | undefined): string {
  return value === 1 ? c.signal1 : c.signal0;
}
