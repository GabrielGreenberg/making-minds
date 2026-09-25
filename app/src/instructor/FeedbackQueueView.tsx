import { useState } from 'react';
import type { FeedbackStatus, FeedbackTriage, PlatformFeedback } from '../types';
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

/** What the task pipeline made of a report (task 018), as a tag. `review`
 *  waits for the instructor's file / not now / discard in `/catch` (task 029). */
function TriageMark({ triage }: { triage: FeedbackTriage }) {
  const [className, label] =
    triage.outcome === 'filed'
      ? ['tag tag--ok', `Filed → ${triage.tasks?.length === 1 ? 'task' : 'tasks'} ${(triage.tasks ?? []).join(', ')}`]
      : triage.outcome === 'personal'
        ? ['tag tag--warn', 'Personal — for you']
        : triage.outcome === 'review'
          ? ['tag tag--warn', 'Needs your call']
          : ['tag', 'Dismissed'];
  return (
    <span className="feedback-triage" title={`Processed ${formatTime(triage.at)}`}>
      <span className={className}>{label}</span>
      {triage.note && <span className="feedback-meta">{triage.note}</span>}
    </span>
  );
}

/**
 * The instructor's feedback queue (notes/todos.md item 9): every report filed
 * on the platform or a homework, newest first, filterable by open/resolved,
 * with a status toggle; an instructor's own reports carry a tag, and a report
 * the task pipeline has processed shows what it became (task 018). Works in
 * both backends — the `feedbackStore` seam is local-storage-backed in local
 * mode, server-backed remotely — unlike the roster, which is a remote-only
 * concept.
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
      <div className="mm-head mm-head--row">
        <h1>Feedback</h1>
        <div className="mm-actions">
          <select
            className="mm-input"
            value={filter}
            onChange={(e) => setFilter(e.target.value as 'open' | 'resolved' | 'all')}
          >
            <option value="open">Open{openCount ? ` (${openCount})` : ''}</option>
            <option value="resolved">Resolved</option>
            <option value="all">All</option>
          </select>
        </div>
      </div>

      {loading && !feedback && <p className="mm-empty">Loading…</p>}
      {error && <p className="mm-empty">Couldn’t load feedback.</p>}
      {feedback && rows.length === 0 && (
        <p className="mm-empty">
          {filter === 'open' ? 'No open feedback — nice.' : 'Nothing here.'}
        </p>
      )}

      <div className="feedback-queue">
        {rows.map((f) => (
          <article key={f.id} className="feedback-card">
            <div className="feedback-card-head">
              <span className={`tag ${f.category === 'platform design' ? 'tag--date' : 'tag--ok'}`}>
                {f.category}
              </span>
              {f.authorRole === 'instructor' && <span className="tag tag--accent">instructor</span>}
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
              {f.triage && <TriageMark triage={f.triage} />}
              <button
                className="mm-btn"
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
