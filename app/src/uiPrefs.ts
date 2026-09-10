// Small, best-effort UI preferences bag (one localStorage key for the lot).
// Purely cosmetic view state — which panel sections are open, the run speed,
// the Map's zoom level — so every access is wrapped: a browser with storage
// disabled just gets the defaults back.

const UI_PREFS_KEY = 'making-minds-ui-prefs';

export function loadUiPrefs(): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(UI_PREFS_KEY) || '{}');
  } catch { return {}; }
}

export function saveUiPref(key: string, value: unknown) {
  try {
    const prefs = loadUiPrefs();
    prefs[key] = value;
    localStorage.setItem(UI_PREFS_KEY, JSON.stringify(prefs));
  } catch { /* storage unavailable — the preference just doesn't persist */ }
}

export function numericPref(prefs: Record<string, unknown>, key: string, fallback: number): number {
  const v = prefs[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
