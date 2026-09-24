// The browser side of the sandbox workbook file (task 028): write a workbook's
// JSON to a file, read one back. File System Access pickers where the browser
// has them (Chrome, Edge), a download and an <input type=file> everywhere
// else. Stateless: the file handle lives in the store (workbookFileHandle,
// reset with every principal change — the handle belongs to the person who
// picked it); the parsing is workbookFile.ts's.
//
// Every call returns a TAGGED result, so the menu can tell a cancel (do
// nothing) from a failure (say what failed) from a save (mark it saved):
//   saved       written through a picked handle (Save again reuses it)
//   downloaded  no picker here, or it refused: handed to the browser as a
//               download — which may yet ask where to put it, or be
//               refused, so it is NOT known to be saved (the menu says so)
//   cancelled   the person dismissed the picker (an AbortError only)
//   failed      anything else, with the reason
//
// Pickers need transient user activation: call these straight from a click
// (or a keypress). Without it a picker throws SecurityError (→ the download
// fallback when saving) and an <input type=file> click silently does nothing,
// so openWorkbookFile never falls back to one without activation.
//
// Local only: nothing here touches /api (law 5).

import { oversizeReason } from './workbookFile';

export type SaveResult =
  | { kind: 'saved'; handle: FileSystemFileHandle; name: string }
  | { kind: 'downloaded'; name: string }
  | { kind: 'cancelled' }
  | { kind: 'failed'; reason: string };

export type OpenResult =
  | { kind: 'opened'; text: string; handle: FileSystemFileHandle | null; name: string }
  | { kind: 'cancelled' }
  | { kind: 'failed'; name?: string; reason: string };

const PICKER_TYPES = [{ description: 'Making Minds workbook', accept: { 'application/json': ['.json'] } }];

// The File System Access API is not in TypeScript's DOM lib yet.
type PickerWindow = Window & {
  showSaveFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle[]>;
};
type WritableHandle = FileSystemFileHandle & {
  createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>;
};

const pickers = (): PickerWindow => window as PickerWindow;
/** Does this browser have the save picker? (`typeof`, not `in`: a stub or a
 *  polyfill property that isn't callable doesn't count.) */
export const hasSavePicker = () => typeof pickers().showSaveFilePicker === 'function';
const hasOpenPicker = () => typeof pickers().showOpenFilePicker === 'function';

/** Is a picker (or a file input) allowed to open right now? Browsers without
 *  the UserActivation API are assumed to allow it. */
export function hasUserActivation(): boolean {
  const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  return ua ? ua.isActive : true;
}

const errName = (e: unknown) => (e instanceof DOMException || e instanceof Error ? e.name : '');
const errMessage = (e: unknown) => (e instanceof Error && e.message ? e.message : 'an unknown error');

async function writeTo(handle: FileSystemFileHandle, json: string): Promise<void> {
  const writable = await (handle as WritableHandle).createWritable();
  await writable.write(json);
  await writable.close();
}

/** Save as a browser download named `name` (the fallback everywhere). */
export function downloadFile(json: string, name: string): SaveResult {
  try {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoked later, not now: the download reads the URL after this returns.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return { kind: 'downloaded', name };
  } catch (e) {
    return { kind: 'failed', reason: errMessage(e) };
  }
}

/** Save As: pick a file (named `suggestedName` to start with) and write it.
 *  No picker, or the picker refused (SecurityError: no user activation, a
 *  cross-origin frame) → a download. */
export async function saveFileAs(json: string, suggestedName: string): Promise<SaveResult> {
  if (!hasSavePicker()) return downloadFile(json, suggestedName);
  let handle: FileSystemFileHandle;
  try {
    handle = await pickers().showSaveFilePicker!({ suggestedName, types: PICKER_TYPES });
  } catch (e) {
    if (errName(e) === 'AbortError') return { kind: 'cancelled' };
    return downloadFile(json, suggestedName);
  }
  try {
    await writeTo(handle, json);
    return { kind: 'saved', handle, name: handle.name };
  } catch (e) {
    return { kind: 'failed', reason: `couldn't write ${handle.name} (${errMessage(e)})` };
  }
}

/** Save: back to `handle` when there is one; otherwise — or when it can't be
 *  written any more (moved, deleted, permission withdrawn) — Save As, which
 *  itself falls back to a download. */
export async function saveFile(json: string, handle: FileSystemFileHandle | null, suggestedName: string): Promise<SaveResult> {
  if (handle) {
    try {
      await writeTo(handle, json);
      return { kind: 'saved', handle, name: handle.name };
    } catch {
      // Fall through: pick a new place for it.
    }
  }
  return saveFileAs(json, suggestedName);
}

/** Open: pick a file and read its text. Dismissing the picker is a cancel
 *  (never a second dialog). */
export async function openWorkbookFile(): Promise<OpenResult> {
  if (hasOpenPicker()) {
    let handle: FileSystemFileHandle;
    try {
      [handle] = await pickers().showOpenFilePicker!({ types: PICKER_TYPES, multiple: false });
    } catch (e) {
      if (errName(e) === 'AbortError') return { kind: 'cancelled' };
      // The picker refused (no activation, a sandboxed frame): the plain file
      // input, if it may still open.
      return openWithInput();
    }
    try {
      return await readFile(await handle.getFile(), handle);
    } catch (e) {
      return { kind: 'failed', name: handle.name, reason: errMessage(e) };
    }
  }
  return openWithInput();
}

async function readFile(file: File, handle: FileSystemFileHandle | null): Promise<OpenResult> {
  // Checked before reading, so a huge file is never loaded into memory.
  const tooBig = oversizeReason(file.size);
  if (tooBig) return { kind: 'failed', name: file.name, reason: tooBig };
  return { kind: 'opened', text: await file.text(), handle, name: file.name };
}

/** The <input type=file> fallback. Resolves on a pick, and on the input's
 *  `cancel` event when the dialog is dismissed. */
function openWithInput(): Promise<OpenResult> {
  if (!hasUserActivation()) {
    return Promise.resolve<OpenResult>({ kind: 'failed', reason: 'the browser blocked the file dialog — choose Open… again' });
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    let settled = false;
    const done = (r: OpenResult | Promise<OpenResult>) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(r);
    };
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return done({ kind: 'cancelled' });
      done(readFile(file, null).catch((e): OpenResult => ({ kind: 'failed', name: file.name, reason: errMessage(e) })));
    });
    input.addEventListener('cancel', () => done({ kind: 'cancelled' }));
    document.body.appendChild(input);
    input.click();
  });
}
