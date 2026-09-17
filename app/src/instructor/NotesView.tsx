import { useEffect, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { notesStore } from '../storage/backend';
import { useAuth } from '../auth';
import { useAsyncValue } from '../useAsyncValue';

function formatTime(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ', ' +
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  );
}

/**
 * A shared markdown note instructors use to coordinate (notes/todos.md item
 * 12) — a "Google-Drive-like" page in the sense that everyone reads/writes
 * the SAME document, not that it has Drive's real-time collaboration. There
 * is exactly one note; it renders live as you type but only actually saves
 * (and becomes visible to a colleague) when you click Save.
 */
export function NotesView() {
  const { user } = useAuth();
  const { value: note, loading, reload } = useAsyncValue(() => notesStore.get(), []);
  const [draft, setDraft] = useState('');
  const [loadedAt, setLoadedAt] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Seed the draft from whatever was last fetched — once per fetched value,
  // not on every render, so typing doesn't get clobbered by a stale reload.
  useEffect(() => {
    setDraft(note?.content ?? '');
    setLoadedAt(note?.updatedAt);
  }, [note]);

  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      // Someone else may have saved since this page loaded. A real
      // optimistic-concurrency precondition is the noted follow-up (same gap
      // CLAUDE.md flags for remote workbooks) — for a low-traffic,
      // few-instructor feature, checking the freshly-fetched updatedAt right
      // before saving and asking before overwriting is proportionate.
      const fresh = await notesStore.get();
      if (fresh && loadedAt && fresh.updatedAt !== loadedAt) {
        const ok = window.confirm(
          `This note was updated by ${fresh.updatedBy} at ${formatTime(fresh.updatedAt)}, after you started editing.\n\n` +
            'Save anyway and overwrite their change?',
        );
        if (!ok) {
          setSaving(false);
          return;
        }
      }
      const saved = await notesStore.save(draft, user?.name ?? 'instructor');
      setLoadedAt(saved.updatedAt);
      setNotice(`Saved just now by ${saved.updatedBy}.`);
      reload();
    } catch {
      setNotice('Could not save — the server may be unreachable.');
    } finally {
      setSaving(false);
    }
  };

  const html = DOMPurify.sanitize(marked.parse(draft, { async: false }) as string);

  return (
    <div className="instructor-dashboard">
      <div className="instructor-page-head">
        <h2 className="instructor-page-title">Notes</h2>
        <div className="instructor-head-actions">
          <button className="instructor-btn instructor-btn--primary" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <p className="notes-status">
        {loading && !note
          ? 'Loading…'
          : note
            ? `Last saved ${formatTime(note.updatedAt)} by ${note.updatedBy}.`
            : 'Nobody has saved a note yet.'}
      </p>
      {notice && <p className="roster-notice">{notice}</p>}

      <div className="notes-split">
        <textarea
          className="notes-editor"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Markdown — headings, lists, links, bold/italic, code…"
          spellCheck
        />
        <div className="notes-preview" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}
