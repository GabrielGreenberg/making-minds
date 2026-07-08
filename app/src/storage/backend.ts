// Backend mode seam — the ONE place the app decides local vs. remote storage.
//
// S1 of the remote-stores plan (docs/buildout/designs/remote-stores.md) ships
// only the mode flag; the Local* store instances are still exported by their
// own modules. S3 makes this module the sole exporter of store instances,
// picking Local* or Remote* (direct api/client.ts calls) by `backendMode`.
//
// The `import.meta.env?.` guard (same pattern as api/client.ts) keeps Node/tsx
// harness runs resolving to 'local' — import.meta.env only exists under Vite.
// tools/navResetCheck.ts pins this so drift fails loudly.

export const backendMode: 'local' | 'remote' = import.meta.env?.VITE_API_BASE
  ? 'remote'
  : 'local';
