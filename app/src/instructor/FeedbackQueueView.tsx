import { useState } from 'react';
import type { FeedbackStatus, PlatformFeedback } from '../types';
import { feedbackStore } from '../storage/backend';
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
 * The instructor's feedback queue (notes/todos.md item 9): every report a
 * student has filed on the platform or a homework, newest first, filterable
 * by open/resolved, with a status toggle. Works in both backends — the
 * `feedbackStore` seam is local-storage-backed in local mode, server-backed
 * remotely — unlike the roster, which is a remote-only concept.
 */
export function FeedbackQueueView() {
  const { value: feedback, loading, error, reload } = useAsyncValue(() => feedbackStore.list(), []);
  const [filter, setFilter] = useState<'open' | 'resolved' | 'all'>('open');
  const [busyId, setBusyId] = useState<string | null>(null);

  const rows = (feedback ?? []).filter((f) => filter === 'all' || f.status === filter);
  const openCount = (feedback ?? []).filter((f) => f.status === 'open').length;

  const toggleStatus = async (f: PlatformFeedback) => {
    const next: FeedbackStatus = f.status === 'open' ? 'resolved' : 'open';
    setBusyId(f.id);
    try {
      await feedbackStore.setStatus(f.id, next);
    } finally {
      setBusyId(null);
      reload();
    }
  };

  return (
    <div className="instructor-dashboard">
      <div className="instructor-page-head">
        <h2 className="instructor-page-title">Feedback</h2>
        <div className="instructor-head-actions">
          <select
            className="instructor-select"
            value={filter}
            onChange={(e) => setFilter(e.target.value as 'open' | 'resolved' | 'all')}
          >
            <option value="open">Open{openCount ? ` (${openCount})` : ''}</option>
            <option value="resolved">Resolved</option>
            <option value="all">All</option>
          </select>
        </div>
      </div>

      {loading && !feedback && <p className="instructor-empty">Loading…</p>}
      {error && <p className="instructor-empty">Couldn’t load feedback.</p>}
      {feedback && rows.length === 0 && (
        <p className="instructor-empty">
          {filter === 'open' ? 'No open feedback — nice.' : 'Nothing here.'}
        </p>
      )}

      <div className="feedback-queue">
        {rows.map((f) => (
          <article key={f.id} className="feedback-card">
            <div className="feedback-card-head">
              <span className={`feedback-category feedback-category--${f.category === 'platform design' ? 'design' : 'content'}`}>
                {f.category}
              </span>
              <span className="feedback-meta">{f.student} · {formatTime(f.createdAt)}</span>
              {f.context?.assignmentId && (
                <span className="feedback-meta">
                  assignment {f.context.assignmentId}
                  {f.context.questionId != null ? `, question ${f.context.questionId}` : ''}
                </span>
              )}
            </div>
            <p className="feedback-message">{f.message}</p>
            {f.screenshots.length > 0 && (
              <div className="feedback-screenshots">
                {f.screenshots.map((s, i) => (
                  <a key={i} href={s.dataUrl} target="_blank" rel="noreferrer" title={s.filename ?? 'screenshot'}>
                    <img className="feedback-screenshot-thumb" src={s.dataUrl} alt={s.filename ?? 'screenshot'} />
                  </a>
                ))}
              </div>
            )}
            <div className="feedback-card-foot">
              <button
                className="instructor-btn"
                disabled={busyId === f.id}
                onClick={() => void toggleStatus(f)}
              >
                {f.status === 'open' ? 'Mark resolved' : 'Reopen'}
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
