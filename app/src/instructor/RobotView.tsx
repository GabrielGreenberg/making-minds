import { hashLink } from '../components/PageShell';
import {
  agoLabel,
  type GateVerdict,
  type QueueEventKind,
  type RobotStatus,
} from '../storage/robotStatus';
import { useRobotStatus } from './useRobotStatus';

function formatTime(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ', ' +
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  );
}

const VERDICT_TAG: Record<GateVerdict, string> = {
  hold: 'tag--danger',
  wait: 'tag--warn',
  release: 'tag--ok',
  current: 'tag--ok',
};

const EVENT_TAG: Record<QueueEventKind, string> = {
  land: 'tag--ok',
  merge: 'tag--ok',
  park: 'tag--warn',
  claim: 'tag--date',
  file: '',
};

/** A section the server could not read: the reason, in one line. */
function Unknown({ why }: { why: string }) {
  return <p className="mm-notice robot-unknown">Unknown: {why}</p>;
}

/**
 * The robot's state (task 083) — what the pilot runs, what waits for a
 * release, what waits for the instructor's answer, and what the robot did
 * lately — read from GET /api/robot/status through the RobotStatusStore seam
 * (the layout fetches it once; Refresh asks the server to look again). No
 * "release now": releasing stays a hand act on the robot. No report text or
 * author ever reaches this page — a review mark is its id and category.
 */
export function RobotView() {
  const { value, loading, error, refresh } = useRobotStatus();
  return (
    <div className="instructor-dashboard">
      <div className="mm-head mm-head--row">
        <h1>Robot</h1>
        <div className="mm-actions">
          {value?.available && <span className="mm-row-meta">as of {formatTime(value.asOf)}</span>}
          <button className="mm-btn" disabled={loading} onClick={refresh}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>
      {error && (
        <p className="mm-error robot-error">
          {value ? `Couldn’t refresh (${error.message}) — showing the last answer.` : `Couldn’t read the robot’s state: ${error.message}`}
        </p>
      )}
      {!value && loading && <p className="mm-empty">Loading…</p>}
      {value && !value.available && <p className="mm-empty">{value.reason}</p>}
      {value?.available && <RobotSections status={value} now={new Date()} />}
    </div>
  );
}

function RobotSections({ status, now }: { status: Extract<RobotStatus, { available: true }>; now: Date }) {
  const { live, release, answers, review, activity } = status;
  return (
    <>
      {status.stale && (
        <p className="mm-notice robot-stale">GitHub main may be behind: {status.stale}. Showing the last copy.</p>
      )}

      <section className="mm-section robot-section">
        <h2>Live</h2>
        {live.ok ? (
          <div className="mm-list">
            <div className="mm-row">
              <span className="robot-label">Version</span>
              <span className="mm-row-fill">
                <span className="tag mono">{live.shortSha}</span> <span className="mm-row-title">{live.subject}</span>
              </span>
            </div>
            <div className="mm-row">
              <span className="robot-label">{live.releasedAtSource === 'reflog' ? 'Released' : 'Running since'}</span>
              <span className="mm-row-fill">
                {formatTime(live.releasedAt)} <span className="mm-row-meta">({agoLabel(live.releasedAt, now)})</span>
                {live.releasedAtSource === 'process-start' && <span className="mm-row-sub">the server’s start — its clone keeps no release time</span>}
              </span>
            </div>
            <div className="mm-row">
              <span className="robot-label">Newest landed task</span>
              <span className="mm-row-fill">
                {live.lastLanded ? (
                  <>
                    <span className="mono">{live.lastLanded.id}</span> {live.lastLanded.title}
                  </>
                ) : (
                  <span className="dim">none in its history</span>
                )}
              </span>
            </div>
          </div>
        ) : (
          <Unknown why={live.unknown} />
        )}
      </section>

      <section className="mm-section robot-section">
        <h2>Waiting for release</h2>
        {release.ok ? (
          <>
            <p className="robot-verdict">
              <span className={`tag ${VERDICT_TAG[release.verdict]}`}>{release.verdict}</span> {release.line}
            </p>
            {release.verdict !== 'current' && release.reasons.length > 0 && (
              <ul className="robot-reasons">
                {release.reasons.map((r, i) => (
                  <li key={i}>
                    <span className="chip">{r.verdict}</span> {r.detail}
                  </li>
                ))}
              </ul>
            )}
            {release.rows.length > 0 && (
              <div className="mm-list">
                {release.rows.map((t) => (
                  <div key={t.id} className="mm-row">
                    <span className="mono robot-id">{t.id}</span>
                    <span className="mm-row-fill mm-row-title">{t.title}</span>
                    <span className="mm-row-meta">landed {formatTime(t.landedAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <Unknown why={release.unknown} />
        )}
      </section>

      <section className="mm-section robot-section">
        <h2>Waiting for your answer</h2>
        {answers.ok ? (
          answers.tasks.length > 0 ? (
            <div className="mm-list">
              {answers.tasks.map((t) => (
                <div key={t.id} className="mm-row">
                  <span className="mono robot-id">{t.id}</span>
                  <span className="mm-row-fill">
                    <span className="mm-row-title">{t.title}</span>
                    {t.question && <span className="mm-row-sub">{t.question}</span>}
                  </span>
                  {t.studentFix && <span className="tag tag--warn">student fix</span>}
                </div>
              ))}
            </div>
          ) : (
            <p className="mm-empty">No parked task waits for an answer.</p>
          )
        ) : (
          <Unknown why={answers.unknown} />
        )}
        <h3 className="robot-subhead">Reports marked review</h3>
        {review.ok ? (
          review.items.length > 0 ? (
            <>
              <p className="mm-note">
                {review.items.length} {review.items.length === 1 ? 'report waits' : 'reports wait'} for your call —{' '}
                <a {...hashLink({ kind: 'instructor-feedback' })}>Feedback tab</a>
              </p>
              <div className="mm-list">
                {review.items.map((f) => (
                  <a key={f.id} className="mm-row mm-row--link robot-link" {...hashLink({ kind: 'instructor-feedback' })}>
                    <span className="mono robot-id mm-row-title">{f.id}</span>
                    <span className={`tag ${f.category === 'platform design' ? 'tag--date' : 'tag--ok'}`}>{f.category}</span>
                  </a>
                ))}
              </div>
            </>
          ) : (
            <p className="mm-empty">No report is marked review.</p>
          )
        ) : (
          <Unknown why={review.unknown} />
        )}
      </section>

      <section className="mm-section robot-section">
        <h2>Recent queue activity</h2>
        {activity.ok ? (
          activity.events.length > 0 ? (
            <div className="mm-list">
              {activity.events.map((e, i) => (
                <div key={i} className="mm-row">
                  <span className={`tag ${EVENT_TAG[e.kind]} robot-kind`}>{e.kind}</span>
                  <span className="mm-row-fill robot-event">{e.text}</span>
                  {e.robot && <span className="tag tag--accent">robot</span>}
                  <span className="mm-row-meta" title={formatTime(e.at)}>
                    {agoLabel(e.at, now)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mm-empty">No queue activity on GitHub main lately.</p>
          )
        ) : (
          <Unknown why={activity.unknown} />
        )}
      </section>
    </>
  );
}
