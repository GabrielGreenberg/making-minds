// The page's persistence mode (task 087) — the ONE place that says whether
// this page may keep anything in the browser.
//
// The app persists: the sandbox autosave, the UI prefs, the file baseline.
// The embeddable sandbox (src/embed/) must not: every load starts from its
// example, and — since a browser keys an iframe's storage by (frame origin,
// top-level site) — a demo on the course website could otherwise land in
// the same partition as a visitor's real sandbox and overwrite it.
//
// A page declares itself ephemeral in its HTML: `<html data-persistence=
// "ephemeral">` (embed.html). This module reads that as it evaluates, so the
// mode never depends on which module a bundle runs first: the HTML is parsed
// before any module script runs, and every module that keeps anything
// imports this one, so this one has evaluated before any of them can touch
// storage — whatever chunk the bundler puts them in (the embed shares its
// store, uiPrefs and this module with the app's chunks). From then on the
// store's autosave, unload flush and sandbox load stand down (store.ts), and
// `pageStorage()` hands every remaining reader and writer a memory map
// instead of the browser's storage. The memory map never touches
// `window.localStorage` — not even to look: a third-party iframe with
// storage blocked throws on the mere access.
//
// Leaf module: imports nothing.

/** The part of the Storage API the editor uses. */
export type PageStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The attribute on `<html>` a page declares its persistence with. */
export const PERSISTENCE_ATTRIBUTE = 'data-persistence';

/** The page's own word (no document — a harness tool — persists). */
function declaredEphemeral(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement?.getAttribute?.(PERSISTENCE_ATTRIBUTE) === 'ephemeral';
}

const ephemeral = declaredEphemeral();

const memory = new Map<string, string>();
const memoryStorage: PageStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => void memory.set(key, String(value)),
  removeItem: (key) => void memory.delete(key),
};

/** Does this page keep nothing? Fixed for the page's life, by its HTML. */
export function isEphemeral(): boolean {
  return ephemeral;
}

/** Where this page keeps small things: the browser's localStorage (read at
 *  call time, so a caller's try/catch covers an access that throws), or, on
 *  an ephemeral page, a memory map that lasts as long as the page. */
export function pageStorage(): PageStorage {
  return ephemeral ? memoryStorage : localStorage;
}
