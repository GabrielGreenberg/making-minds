// Stateless file I/O utilities using the File System Access API.
// File handles are stored in the Zustand store (workbookFileHandle),
// not in module-level state.

/** Save JSON content to the given file handle, or fall back to silent download. */
export async function saveToFile(json: string, handle?: FileSystemFileHandle | null, filename?: string) {
  if (handle) {
    try {
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      return;
    } catch {
      // Permission denied or handle stale — fall through to download
    }
  }
  // No handle — silent download
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'workbook.json';
  a.click();
  URL.revokeObjectURL(url);
}

/** Show a "Save As" dialog and write the JSON. Returns the new handle, or null if cancelled. */
export async function saveToFileAs(json: string): Promise<FileSystemFileHandle | null> {
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: 'workbook.json',
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      return handle;
    } catch {
      // User cancelled
      return null;
    }
  }
  // Fallback: just download
  saveToFile(json, null);
  return null;
}

/** Open a file via <input type="file"> fallback (works everywhere). */
function openFileFallback(): Promise<{ text: string; handle: FileSystemFileHandle | null } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        file.text().then((text) => resolve({ text, handle: null }));
      } else {
        resolve(null);
      }
    };
    input.click();
  });
}

/** Open a file using showOpenFilePicker or fallback input. Returns text + handle. */
export async function openFile(): Promise<{ text: string; handle: FileSystemFileHandle | null } | null> {
  if ('showOpenFilePicker' in window) {
    try {
      const [handle] = await (window as any).showOpenFilePicker({
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
      });
      const file = await handle.getFile();
      const text = await file.text();
      return { text, handle };
    } catch {
      // showOpenFilePicker failed (security, cancelled, etc.) — try fallback
      return openFileFallback();
    }
  }
  return openFileFallback();
}
