// Shared file handle for save-in-place using the File System Access API.
// When a file is opened via showOpenFilePicker, we store the handle here
// so that subsequent saves write back to the same file.

let currentHandle: FileSystemFileHandle | null = null;

export function getFileHandle(): FileSystemFileHandle | null {
  return currentHandle;
}

export function setFileHandle(handle: FileSystemFileHandle | null) {
  currentHandle = handle;
}

/** Save JSON content to the current file handle, or fall back to silent download. */
export async function saveToFile(json: string) {
  const handle = currentHandle;
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
  // No handle (new circuit) — silent download, no dialog
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'circuit.json';
  a.click();
  URL.revokeObjectURL(url);
}

/** Open a file using showOpenFilePicker (stores handle) or fallback input. */
export async function openFile(): Promise<string | null> {
  if ('showOpenFilePicker' in window) {
    try {
      const [handle] = await (window as any).showOpenFilePicker({
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
      });
      currentHandle = handle;
      const file = await handle.getFile();
      return await file.text();
    } catch {
      // User cancelled
      return null;
    }
  }
  // Fallback: traditional file input (no handle, so save will download)
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        file.text().then(resolve);
      } else {
        resolve(null);
      }
    };
    input.click();
  });
}
