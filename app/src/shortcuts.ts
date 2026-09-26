// The canvas's keyboard shortcuts, as one pure key → command mapping (task
// 058). No React, no store: CircuitCanvas's keydown handler asks
// `editorShortcut` which command a key press is and dispatches it — undo and
// redo through the store's own `undo`/`redo`, which carry the lock (law 3) —
// and app/tools/workbenchCheck.ts pins the table.
//
// Why a table and not `e.key === 'z'`: with Shift held a browser may report
// the letter as "Z" (always on Windows and Linux, depending on the browser on
// macOS), and Caps Lock capitalises the others, so a case-sensitive compare
// silently skipped redo. On a non-Latin layout (Cyrillic, Greek…) `key` is not
// a Latin letter at all; the physical key (`code`) stands in for it then, as
// editors do. Latin layouts keep `key`, so AZERTY's Z is still Z.

export type EditorCommand = 'undo' | 'redo' | 'copy' | 'paste' | 'selectAll' | 'delete' | 'escape';

export interface KeyPress {
  key: string;
  code?: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey?: boolean;
}

/** The letter a press means: `key` lower-cased when it is a Latin letter,
 *  else the physical key's letter (`KeyZ` → 'z'), else the key as reported. */
function letterOf(e: KeyPress): string {
  if (/^[a-z]$/i.test(e.key)) return e.key.toLowerCase();
  const m = /^Key([A-Z])$/.exec(e.code ?? '');
  return m ? m[1].toLowerCase() : e.key;
}

export function editorShortcut(e: KeyPress): EditorCommand | null {
  if (e.key === 'Escape') return 'escape';
  if (e.key === 'Delete' || e.key === 'Backspace') return 'delete';
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  switch (letterOf(e)) {
    case 'z':
      return e.shiftKey ? 'redo' : 'undo';
    // Ctrl+Y is Windows' redo. Not ⌘Y: on a Mac that is the browser's History.
    case 'y':
      return e.ctrlKey && !e.metaKey && !e.shiftKey ? 'redo' : null;
    case 'c':
      return e.shiftKey ? null : 'copy';
    case 'v':
      return e.shiftKey ? null : 'paste';
    case 'a':
      return e.shiftKey ? null : 'selectAll';
    default:
      return null;
  }
}

/** Is focus somewhere the keys are text? Then no canvas shortcut fires: a
 *  text field, a select, anything contentEditable (an answer box, a rename). */
export function isTextEntryTarget(el: { tagName?: string; isContentEditable?: boolean } | null | undefined): boolean {
  if (!el) return false;
  const tag = (el.tagName ?? '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}
