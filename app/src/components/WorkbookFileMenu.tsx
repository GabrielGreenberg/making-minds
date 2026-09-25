import { useEffect, useRef, useState } from 'react';
import { useStore, workbookSaveState, captureSandboxSession } from '../store';
import { saveFile, saveFileAs, openWorkbookFile, hasUserActivation, type OpenResult, type SaveResult } from '../fileHandle';
import { suggestedFileName, unopenableReason } from '../workbookFile';
import { MachineMenu } from './MachineMenu';
import type { BuildMode } from '../types';

// The sandbox's File menu (task 028; spec §1.6–1.7, Mock_Ups-6_2): New ▸ a
// machine, Open…, Save, Save as… — the sandbox's tabs as one workbook file
// on the person's own disk, for visitors and signed-in people alike. Nothing
// is uploaded: the store's exportWorkbook / importWorkbook and fileHandle.ts
// are all local (law 5). Rendered by MenuBar only while the sandbox is open.
//
// New and Open replace the workbook, so both ask first when it holds work
// its last save doesn't (workbookSaveState, read at click time — before any
// picker opens): Don't save · Save · Cancel.
//
// A DOWNLOAD (browsers without a save picker) is not a save: the browser may
// still ask where to put it, or refuse it, and the page can't see which. So
// it never becomes the baseline (New and Open still ask, saying it was
// downloaded), and the question's Save never goes straight on to replace
// the workbook after one — a second click does, once the file is there.

/** What New / Open will do once the unsaved-changes question is answered. */
type Pending = { kind: 'new'; mode: BuildMode; innerMode?: BuildMode; title?: string } | { kind: 'open' };

/** The unsaved-changes question, and its second steps: after a download
 *  (continue once the file is there), and on the Open path after a save that
 *  used up the click's activation (a fresh click opens the picker). */
type Prompt =
  | { step: 'ask'; pending: Pending; downloaded: boolean }
  | { step: 'downloaded'; pending: Pending; name: string }
  | { step: 'pick-file'; pending: Pending };

/** What a finished Save did: wrote a picked file, or handed a download over. */
type Saved = { kind: 'saved' | 'downloaded'; name: string };

const MOD_KEY = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

export function WorkbookFileMenu() {
  const title = useStore((s) => s.workbookTitle);
  const [open, setOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close on a pointerdown anywhere outside the menu (the '+' menu's rule).
  useEffect(() => {
    if (!open) {
      setNewOpen(false);
      return;
    }
    const handler = (e: Event) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', handler, true);
    return () => document.removeEventListener('pointerdown', handler, true);
  }, [open]);

  useEffect(() => () => {
    if (noteTimer.current) clearTimeout(noteTimer.current);
  }, []);

  const flash = (text: string) => {
    setNote(text);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(null), 4000);
  };

  /** Save (or Save as: always pick a file). Resolves to what it did — a
   *  picked file written, or a download handed over — or null when nothing
   *  was. Must be called straight from a click or keypress: the picker needs
   *  the gesture. */
  const save = async (as: boolean): Promise<Saved | null> => {
    // Whose sandbox this is, before the dialog: a sign-in or a 401 behind it
    // must not mark the next person's sandbox saved or hand them the file.
    const stillHere = captureSandboxSession();
    const s = useStore.getState();
    const json = s.exportWorkbook();
    // A file Open would refuse (too large, or content the file check turns
    // away) is not a save: say so, and write nothing.
    const unopenable = unopenableReason(json);
    if (unopenable) {
      alert(`Couldn't save the workbook — Open couldn't read the file back: ${unopenable}.`);
      return null;
    }
    const name = suggestedFileName(s.workbookTitle);
    setBusy(true);
    let result: SaveResult;
    try {
      result = as ? await saveFileAs(json, name) : await saveFile(json, s.workbookFileHandle, name);
    } finally {
      setBusy(false);
    }
    if (result.kind === 'cancelled') return null;
    if (result.kind === 'failed') {
      alert(`Couldn't save the workbook: ${result.reason}`);
      return null;
    }
    if (!stillHere()) return null;
    if (result.kind === 'downloaded') {
      // Handed to the browser, not known to be saved: recorded as downloaded,
      // the baseline untouched. The title stays (the browser may rename it).
      useStore.getState().markWorkbookDownloaded(json);
      flash(`Downloaded ${result.name}`);
      return { kind: 'downloaded', name: result.name };
    }
    // The baseline is the JSON written, not the live state: an edit made
    // while the picker was open stays unsaved. A picked file names the
    // workbook.
    useStore.getState().markWorkbookSaved(json, result.handle, result.name);
    flash(`Saved to ${result.name}`);
    return { kind: 'saved', name: result.name };
  };

  /** Pick a file and open it as the sandbox's tabs. From a click only. */
  const openFile = async () => {
    const stillHere = captureSandboxSession();
    setBusy(true);
    let result: OpenResult;
    try {
      result = await openWorkbookFile();
    } finally {
      setBusy(false);
    }
    if (result.kind === 'cancelled') return;
    if (result.kind === 'failed') {
      alert(`Couldn't open ${result.name ?? 'the file'}: ${result.reason}`);
      return;
    }
    // Left the sandbox, or someone else signed in, while the dialog was
    // open: the file is not theirs to receive.
    if (!stillHere()) return;
    const imported = useStore.getState().importWorkbook(result.text, result.handle, result.name);
    if (!imported.ok) alert(`Couldn't open ${result.name}: ${imported.reason}.`);
    else flash(`Opened ${result.name}`);
  };

  const run = (pending: Pending) => {
    if (pending.kind === 'new') useStore.getState().newWorkbook(pending.mode, pending.innerMode, pending.title);
    else void openFile();
  };

  /** New / Open: ask first when the workbook holds unsaved work. */
  const guarded = (pending: Pending) => {
    setOpen(false);
    const state = workbookSaveState(useStore.getState());
    if (state !== 'saved') setPrompt({ step: 'ask', pending, downloaded: state === 'downloaded' });
    else run(pending);
  };

  const saveThenContinue = async () => {
    if (!prompt) return;
    const { pending } = prompt;
    const stillHere = captureSandboxSession();
    const saved = await save(false);
    if (!saved) return; // cancelled or failed: the question stays
    if (!stillHere()) {
      setPrompt(null);
      return;
    }
    if (saved.kind === 'downloaded') {
      // Never straight on to replace the work: the download may not land.
      setPrompt({ step: 'downloaded', pending, name: saved.name });
      return;
    }
    if (pending.kind === 'new') {
      setPrompt(null);
      run(pending);
    } else if (hasUserActivation()) {
      setPrompt(null);
      run(pending);
    } else {
      // The save's picker used up the click: the file dialog needs a new one.
      setPrompt({ step: 'pick-file', pending });
    }
  };

  // ⌘S / Ctrl+S saves the workbook (⇧ for Save as) instead of the browser's
  // Save Page — a keypress is a gesture, so the picker may open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== 's') return;
      e.preventDefault();
      if (busy || prompt) return;
      void save(e.shiftKey);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const newMachine = (mode: BuildMode, label: string) =>
    guarded({ kind: 'new', mode, title: mode === 'CC' ? undefined : `${label} 1` });
  const newTurbot = (innerMode: BuildMode) => guarded({ kind: 'new', mode: 'turbot', innerMode, title: 'Turbot 1' });

  return (
    <>
      <div className="menu-item workbook-file-menu" ref={rootRef} onClick={() => setOpen((o) => !o)}>
        File ▾
        {open && (
          <div className="menu-dropdown" onClick={(e) => e.stopPropagation()}>
            <div
              className="submenu-container"
              onMouseEnter={() => setNewOpen(true)}
              onMouseLeave={() => setNewOpen(false)}
            >
              <div className="menu-dropdown-item" onClick={() => setNewOpen(true)}>
                New worksheet <span className="menu-shortcut">▸</span>
              </div>
              {newOpen && (
                <div className="submenu-dropdown">
                  <MachineMenu onPickMachine={newMachine} onPickTurbot={newTurbot} activateOn="click" />
                </div>
              )}
            </div>
            <div className="menu-dropdown-item" onClick={() => guarded({ kind: 'open' })}>
              Open…
            </div>
            <div className="menu-separator" />
            <div className="menu-dropdown-item" onClick={() => { setOpen(false); void save(false); }}>
              Save <span className="menu-shortcut">{MOD_KEY}S</span>
            </div>
            <div className="menu-dropdown-item" onClick={() => { setOpen(false); void save(true); }}>
              Save as… <span className="menu-shortcut">⇧{MOD_KEY}S</span>
            </div>
          </div>
        )}
      </div>
      <span className="workbook-name" title="This workbook's name — Save as… names it after its file">
        {title}
        {note && <span className="workbook-save-note">{note}</span>}
      </span>

      {prompt && (
        <div className="mm-modal-backdrop" onClick={() => setPrompt(null)}>
          <div className="mm-modal mm-modal--narrow mm-surface" onClick={(e) => e.stopPropagation()}>
            <div className="mm-modal-head">
              <h2>{prompt.step === 'ask' ? 'Unsaved changes' : prompt.step === 'downloaded' ? 'Downloaded' : 'Saved'}</h2>
            </div>
            {prompt.step === 'ask' ? (
              <>
                <p className="mm-lede">
                  {prompt.downloaded
                    ? `“${title}” was downloaded, but this page can't tell whether the download finished. `
                    : `“${title}” has changes that aren't saved to a file. `}
                  {prompt.pending.kind === 'new' ? 'A new workbook' : 'Opening a file'} will replace it.
                  Save it first?
                </p>
                <div className="mm-actions workbook-prompt-actions">
                  <button className="mm-btn mm-btn--quiet" onClick={() => { const { pending } = prompt; setPrompt(null); run(pending); }}>
                    Don't save
                  </button>
                  <button className="mm-btn" onClick={() => setPrompt(null)}>
                    Cancel
                  </button>
                  <button className="mm-btn mm-btn--primary" disabled={busy} onClick={() => void saveThenContinue()}>
                    Save
                  </button>
                </div>
              </>
            ) : prompt.step === 'downloaded' ? (
              <>
                <p className="mm-lede">
                  Your browser is downloading “{prompt.name}”. Once it's in your downloads,{' '}
                  {prompt.pending.kind === 'new' ? 'start the new workbook' : 'choose the file to open'} — it
                  will replace this one.
                </p>
                <div className="mm-actions workbook-prompt-actions">
                  <button className="mm-btn" onClick={() => setPrompt(null)}>
                    Cancel
                  </button>
                  <button className="mm-btn mm-btn--primary" onClick={() => { const { pending } = prompt; setPrompt(null); run(pending); }}>
                    {prompt.pending.kind === 'new' ? 'New workbook' : 'Open…'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mm-lede">Your workbook is saved. Now choose the file to open.</p>
                <div className="mm-actions workbook-prompt-actions">
                  <button className="mm-btn" onClick={() => setPrompt(null)}>
                    Cancel
                  </button>
                  <button className="mm-btn mm-btn--primary" onClick={() => { setPrompt(null); run({ kind: 'open' }); }}>
                    Open…
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
