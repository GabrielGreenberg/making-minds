import { useEffect, useState } from 'react';
import { gradingStore } from '../storage/backend';
import type { RegradeOutcome, RegradePlan } from '../storage/gradingStore';
import { plural, regradeRow, regradeSummary } from './gradingViews';
import { Modal } from '../components/Modal';

type Phase =
  | { kind: 'loading' }
  | { kind: 'plan'; plan: RegradePlan; notice?: string; error?: string }
  | { kind: 'committing'; plan: RegradePlan }
  | { kind: 'done'; outcome: RegradeOutcome }
  | { kind: 'error'; message: string };

/**
 * The re-grade (task 069; memo grading-interface.md §5, mockup 7): opening
 * runs the dry run — every stale latest attempt re-graded against the current
 * version, nothing saved — and lists what would change; Commit is the second
 * click. The commit names the version its dry run saw, so an edit meanwhile
 * comes back as the fresh plan instead of landing unseen. The plan is the
 * seam's (storage/regrade.ts); this only shows it.
 */
export function RegradeDialog({ assignmentId, title, onClose, onCommitted }: {
  assignmentId: string;
  title: string;
  onClose: () => void;
  /** After a commit: the caller reloads its summary. */
  onCommitted: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const busy = phase.kind === 'loading' || phase.kind === 'committing';

  useEffect(() => {
    let live = true;
    gradingStore.regrade(assignmentId, { dryRun: true }).then(
      (out) => live && setPhase(out ? { kind: 'plan', plan: out.plan } : { kind: 'error', message: 'No such assignment.' }),
      () => live && setPhase({ kind: 'error', message: 'The dry run failed — the server may be unreachable. Nothing was changed.' }),
    );
    return () => {
      live = false;
    };
  }, [assignmentId]);

  const close = () => {
    if (!busy) onClose();
  };

  const commit = async (plan: RegradePlan) => {
    setPhase({ kind: 'committing', plan });
    try {
      const out = await gradingStore.regrade(assignmentId, { dryRun: false, expectHash: plan.assignmentHash });
      if (!out) {
        setPhase({ kind: 'error', message: 'No such assignment.' });
      } else if (out.conflict) {
        setPhase({ kind: 'plan', plan: out.plan, notice: 'The assignment changed since the dry run — here is the dry run against the current version. Nothing was saved.' });
      } else {
        setPhase({ kind: 'done', outcome: out });
        if (out.committed) onCommitted();
      }
    } catch {
      setPhase({ kind: 'plan', plan, error: 'The re-grade failed — nothing was changed. Try again in a moment.' });
    }
  };

  return (
    <Modal className="gr-regrade" onClose={onClose} busy={busy} labelledBy="regrade-title">
      <div className="mm-modal-head">
        <h2 id="regrade-title">
          Re-grade {title}
          {phase.kind !== 'done' && ' — dry run'}
        </h2>
        <button type="button" className="mm-btn mm-btn--quiet" aria-label="Close" onClick={close} disabled={busy}>
          ×
        </button>
      </div>
      {phase.kind === 'loading' && <p className="mm-note">Re-running the latest submissions…</p>}
      {phase.kind === 'error' && (
        <>
          <p className="mm-error">{phase.message}</p>
          <div className="mm-actions gr-regrade-actions">
            <button type="button" className="mm-btn" onClick={onClose}>Close</button>
          </div>
        </>
      )}
      {phase.kind === 'done' && <Done outcome={phase.outcome} onClose={onClose} />}
      {(phase.kind === 'plan' || phase.kind === 'committing') && (
        <PlanView
          plan={phase.plan}
          title={title}
          notice={phase.kind === 'plan' ? phase.notice : undefined}
          error={phase.kind === 'plan' ? phase.error : undefined}
          committing={phase.kind === 'committing'}
          onCancel={close}
          onCommit={() => void commit(phase.plan)}
        />
      )}
    </Modal>
  );
}

function PlanView({ plan, title, notice, error, committing, onCancel, onCommit }: {
  plan: RegradePlan;
  title: string;
  notice?: string;
  error?: string;
  committing: boolean;
  onCancel: () => void;
  onCommit: () => void;
}) {
  const rows = plan.changed.map(regradeRow);
  const summary = regradeSummary(plan);
  return (
    <>
      <p className="mm-modal-sub">
        {plan.stale === 0
          ? `All ${plural(plan.latest, 'latest submission')} were graded against the current ${title}; there is nothing to re-grade.`
          : `Re-ran the ${plural(plan.stale, 'latest submission')} graded against an older version of ${title}` +
            ` (of ${plan.latest}). Nothing is saved until you commit.`}
      </p>
      {notice && <p className="mm-notice gr-regrade-notice">{notice}</p>}
      {plan.stale > 0 &&
        (rows.length ? (
          <div className="mm-tablewrap">
            <table className="mm-table gr-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Problem</th>
                  <th>Autograde</th>
                  <th>Grade</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.student}</td>
                    <td className="mono">{r.problem}</td>
                    <td className={`mono ${r.up === true ? 'gr-up' : r.up === false ? 'gr-down' : ''}`}>{r.autograde}</td>
                    <td>
                      {r.override !== null ? (
                        <>
                          <span className="tag tag--warn">under your override ({r.override})</span> — override stays; flagged for a
                          look
                        </>
                      ) : (
                        r.grade
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mm-note">No problem's points change — a commit only records that these results are current.</p>
        ))}
      {plan.stale > 0 && (
        <p className="mm-note gr-regrade-summary">
          <b>{summary.changes}</b> · {summary.rest} A database snapshot is taken before the commit; every change is logged.
        </p>
      )}
      {error && <p className="mm-error gr-regrade-error">{error}</p>}
      <div className="mm-actions gr-regrade-actions">
        <button type="button" className="mm-btn" onClick={onCancel} disabled={committing}>
          Cancel
        </button>
        <button type="button" className="mm-btn mm-btn--primary" onClick={onCommit} disabled={committing || plan.stale === 0}>
          {committing ? 'Re-grading…' : 'Commit re-grade'}
        </button>
      </div>
    </>
  );
}

function Done({ outcome, onClose }: { outcome: RegradeOutcome; onClose: () => void }) {
  const { plan } = outcome;
  return (
    <>
      <p className="mm-note">
        {outcome.committed
          ? `Re-graded ${plural(plan.stale, 'submission')}: ${plural(plan.changed.length, 'result')} changed, each logged. ` +
            `Hand grades and overrides were not touched.`
          : 'Nothing was stale by the time of the commit — nothing changed.'}
      </p>
      {outcome.snapshot && <p className="mm-modal-foot">Snapshot taken first: <span className="mono">{outcome.snapshot}</span></p>}
      <div className="mm-actions gr-regrade-actions">
        <button type="button" className="mm-btn mm-btn--primary" autoFocus onClick={onClose}>
          Done
        </button>
      </div>
    </>
  );
}
