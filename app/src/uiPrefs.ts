// Small, best-effort UI preferences bag (one storage key for the lot).
// Purely cosmetic view state — which panel sections are open, the run speed,
// the Map's zoom level — so every access is wrapped: a browser with storage
// disabled just gets the defaults back. Kept where the page keeps things
// (persistence.ts pageStorage: the browser's storage, or on the ephemeral
// embed a memory map), under a page's own defaults (setUiPrefDefaults).

import { pageStorage } from './persistence';

const UI_PREFS_KEY = 'making-minds-ui-prefs';

// The page's defaults (task 087: the embed's compact layout), under whatever
// is stored — a layer in memory, never written.
let defaults: Record<string, unknown> = {};

function storedPrefs(): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(pageStorage().getItem(UI_PREFS_KEY) || '{}');
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch { return {}; }
}

export function loadUiPrefs(): Record<string, unknown> {
  return { ...defaults, ...storedPrefs() };
}

export function saveUiPref(key: string, value: unknown) {
  try {
    const prefs = storedPrefs();
    prefs[key] = value;
    pageStorage().setItem(UI_PREFS_KEY, JSON.stringify(prefs));
  } catch { /* storage unavailable — the preference just doesn't persist */ }
}

/** A page's own defaults, read under the stored prefs — set before the
 *  editor mounts (its panels read their prefs once); never stored. */
export function setUiPrefDefaults(next: Record<string, unknown>) {
  defaults = { ...next };
}

export function numericPref(prefs: Record<string, unknown>, key: string, fallback: number): number {
  const v = prefs[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
