// The embeddable sandbox (task 087): one example machine in the editor's
// frame, for a visitor on the course website to run and poke at, with a slim
// bar — the example's name, Reset, and a link to the full sandbox. No File
// menu, no tabs, no sign-in, no saving (persistence.ts: embed.html declares
// the page ephemeral).
//
// The frame is the app's (EditorShell + EditorWorkspace + OutputPanel), under
// the embed's host (editorHost.ts: the canvas takes the wheel only once
// clicked into, so the host page scrolls past it). Phones get a still picture
// of the example instead of a cramped editor.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useStore } from '../store';
import { setUiPrefDefaults } from '../uiPrefs';
import { EditorHostContext, EMBED_HOST } from '../editorHost';
import { EditorShell } from '../components/EditorShell';
import { EditorWorkspace } from '../components/EditorWorkspace';
import { OutputPanel } from '../components/OutputPanel';
import { exampleNameFrom, exampleUrl, loadExample, openExample, type LoadedExample } from './example';
import { EMBED_NARROW_QUERY, embedLayoutDefaults } from './layout';

/** The full sandbox, in the app this page is served beside. */
const SANDBOX_URL = `${import.meta.env?.BASE_URL ?? '/'}#/sandbox`;

type EmbedState =
  | { kind: 'loading' }
  | { kind: 'ready'; example: LoadedExample }
  | { kind: 'error'; message: string };

/** Is the frame phone-narrow? Follows the frame as it resizes. */
function useNarrow(): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const query = window.matchMedia(EMBED_NARROW_QUERY);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return useSyncExternalStore(subscribe, () => window.matchMedia(EMBED_NARROW_QUERY).matches);
}

function OpenSandboxLink() {
  return (
    <a className="wb-embed-open" href={SANDBOX_URL} target="_blank" rel="noopener">
      Open the full sandbox ↗
    </a>
  );
}

function EmbedBar({ onReset }: { onReset: () => void }) {
  const title = useStore((s) => s.workbookTitle);
  return (
    <header className="wb-topbar wb-embed-bar">
      <span className="wb-brand wb-embed-brand">Making Minds</span>
      <span className="wb-embed-title" title={title}>{title}</span>
      <div className="wb-topbar-right">
        <button type="button" className="mm-btn wb-embed-reset" onClick={onReset} title="Put the example back the way it started">
          Reset
        </button>
        <OpenSandboxLink />
      </div>
    </header>
  );
}

/** Phones: the example as a picture, and where to try it. */
function Poster({ example }: { example: LoadedExample }) {
  return (
    <div className="wb-embed-poster">
      <img className="wb-embed-poster-img" src={exampleUrl(example.name, 'png')} alt={`${example.title}: the example machine`} />
      <p className="wb-embed-poster-note">Try it on a larger screen.</p>
      <OpenSandboxLink />
    </div>
  );
}

export function EmbedApp() {
  const narrow = useNarrow();
  const [state, setState] = useState<EmbedState>({ kind: 'loading' });
  // The example's file, as fetched: Reset re-opens exactly this.
  const exampleText = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    loadExample(exampleNameFrom(window.location.search)).then(
      (example) => {
        if (!live) return;
        exampleText.current = example.text;
        // Before the frame mounts: its panels read their prefs once.
        setUiPrefDefaults(embedLayoutDefaults({ width: window.innerWidth, height: window.innerHeight }, example));
        try {
          openExample(example.text);
          setState({ kind: 'ready', example });
        } catch (e) {
          setState({ kind: 'error', message: e instanceof Error ? e.message : 'The example could not be opened.' });
        }
      },
      (e: unknown) => {
        if (live) setState({ kind: 'error', message: e instanceof Error ? e.message : 'The example could not be loaded.' });
      },
    );
    return () => {
      live = false;
    };
  }, []);

  // Back to the example: the same Open path as the load (a canvas swap —
  // sim state and undo reset with it).
  const reset = useCallback(() => {
    if (exampleText.current != null) openExample(exampleText.current);
  }, []);

  if (state.kind === 'loading') {
    return <div className="wb-embed-note" role="status">Loading the example…</div>;
  }
  if (state.kind === 'error') {
    return (
      <div className="wb-embed-note" role="alert">
        <p>{state.message}</p>
        <OpenSandboxLink />
      </div>
    );
  }
  if (narrow) return <Poster example={state.example} />;
  return (
    <EditorHostContext.Provider value={EMBED_HOST}>
      <EditorShell bar={<EmbedBar onReset={reset} />} output={<OutputPanel />}>
        <EditorWorkspace />
      </EditorShell>
    </EditorHostContext.Provider>
  );
}
