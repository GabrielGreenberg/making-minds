import { useState } from 'react';
import { useStore } from '../store';
import { usePasteGuard } from '../usePasteGuard';

export function BoxEditorBar() {
  const editor = useStore((s) => s.boxEditor);
  const nIn = useStore((s) => s.components.filter((c) => c.type === 'INPUT').length);
  const nOut = useStore((s) => s.components.filter((c) => c.type === 'OUTPUT').length);
  const [draft, setDraft] = useState<{ boxId: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { ref: pasteGuardRef, notice } = usePasteGuard();

  if (!editor) return null;
  const name = draft?.boxId === editor.boxId ? draft.name : editor.name;

  const save = () => {
    const err = useStore.getState().saveBoxEditor(name);
    setError(err);
    if (!err) setDraft(null);
  };
  const cancel = () => {
    setError(null);
    setDraft(null);
    useStore.getState().cancelBoxEditor();
  };

  return (
    <div className="box-editor-bar" role="region" aria-label="Box editor">
      <div className="box-editor-row">
        <span className="box-editor-title">{editor.isNew ? 'New box' : 'Editing box'}</span>
        <input
          ref={pasteGuardRef}
          className="box-editor-name"
          aria-label="Box name"
          value={name}
          onChange={(e) => setDraft({ boxId: editor.boxId, name: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
          }}
        />
        <span className="box-editor-ports">
          {nIn} in · {nOut} out
        </span>
        <button type="button" className="mm-btn mm-btn--small" onClick={cancel}>
          Cancel
        </button>
        <button type="button" className="mm-btn mm-btn--small mm-btn--primary" onClick={save}>
          {editor.isNew ? 'Save box' : 'Save: update every copy'}
        </button>
      </div>
      <p className="box-editor-note">
        The IN and OUT nodes here are the box's ports, in number order.
      </p>
      {(error || notice) && (
        <p className="box-editor-error" role="alert">
          {error ?? notice}
        </p>
      )}
    </div>
  );
}
