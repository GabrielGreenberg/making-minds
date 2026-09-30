import { useState } from 'react';
import type { AssignmentData } from '../types';
import type { AssignmentGradingSummary } from '../storage/gradingStore';
import { hashLink } from '../components/PageShell';
import { formatGrade } from '../engine/score';
import { overviewTiles, percent, plural, problemStats } from './gradingViews';
import { Bar, GradeValue } from './GradingParts';
import { RegradeDialog } from './RegradeDialog';

/**
 * An assignment's Overview (task 065; memo §6.2, mockup 2): four progress
 * tiles, the stale banner, and the per-problem table — counts and shares of
 * the 064 summary (gradingViews.ts), never a grade of its own; a hand
 * problem's "Grade →" opens its queue (task 066). The stale banner's
 * Re-grade… opens the dry run (task 069, RegradeDialog); a commit reloads
 * the summary (`onChanged`). (The Export CSV file arrives with 071.)
 */
export function GradingOverview({ summary, assignment, onChanged }: {
  summary: AssignmentGradingSummary;
  assignment: AssignmentData;
  onChanged: () => void;
}) {
  const [regrading, setRegrading] = useState(false);
  const t = overviewTiles(summary, assignment);
  const problems = problemStats(summary, assignment);
  const matrix = hashLink({ kind: 'instructor-grading-assignment', id: summary.assignmentId, view: 'matrix' });

  return (
    <>
      <div className="gr-tiles">
        <div className="gr-tile">
          <span className="mm-label">Submitted</span>
          <div className="gr-tile-value">
            {t.submitted.x} <small>/ {t.submitted.of}</small>
          </div>
          <Bar x={t.submitted.x} of={t.submitted.of} ok={t.submitted.of > 0 && t.submitted.x === t.submitted.of} />
          <div className="gr-tile-sub">
            {t.submitted.onTime} on time · {t.submitted.late} late · {t.submitted.missing} missing
          </div>
        </div>
        <div className="gr-tile">
          <span className="mm-label">Autograded</span>
          <div className="gr-tile-value">
            {t.autograded.x} <small>/ {t.autograded.of}</small>
          </div>
          <Bar x={t.autograded.x} of={t.autograded.of} ok={t.autograded.of > 0 && t.autograded.x === t.autograded.of} />
          <div className="gr-tile-sub">
            {t.autograded.stale > 0 ? (
              <span className="mm-warn">{t.autograded.stale} against an older version</span>
            ) : (
              'all against the current version'
            )}
          </div>
        </div>
        <div className="gr-tile">
          <span className="mm-label">Hand-graded</span>
          <div className="gr-tile-value">
            {t.handGraded.x} <small>/ {t.handGraded.y}</small>
          </div>
          <Bar x={t.handGraded.x} of={t.handGraded.y} ok={t.handGraded.y > 0 && t.handGraded.x === t.handGraded.y} />
          <div className="gr-tile-sub">
            {t.handGraded.changed} changed since graded · {plural(t.handGraded.overrides, 'override')}
          </div>
        </div>
        <div className="gr-tile">
          <span className="mm-label">Grade</span>
          <div className="gr-tile-value">
            <GradeValue value={t.grade.mean} provisional={t.grade.provisional} /> <small>mean</small>
          </div>
          <div className="gr-tile-sub">
            {t.grade.median !== null && `median ${formatGrade(t.grade.median)} · `}
            {plural(t.grade.pendingProblems, 'problem')} pending · {t.grade.released ? 'released' : 'not released'}
          </div>
        </div>
      </div>

      {t.autograded.stale > 0 && (
        <div className="gr-banner" role="status">
          <span className="gr-ico" aria-hidden="true">
            ↻
          </span>
          <span>
            <b>{plural(t.autograded.stale, 'submission')} graded against an older version of this assignment.</b> Their
            autogrades stand until a re-grade. A re-grade does not change hand grades.
          </span>
          <button type="button" className="mm-btn mm-btn--small" onClick={() => setRegrading(true)}>
            Re-grade…
          </button>
        </div>
      )}
      {regrading && (
        <RegradeDialog
          assignmentId={summary.assignmentId}
          title={summary.title}
          onClose={() => setRegrading(false)}
          onCommitted={onChanged}
        />
      )}

      <div className="mm-tablewrap">
        <table className="mm-table gr-table">
          <thead>
            <tr>
              <th>Problem</th>
              <th>Kind</th>
              <th className="num">Mean</th>
              <th>1 · ½ · 0 · pending</th>
              <th>Hand</th>
            </tr>
          </thead>
          <tbody>
            {problems.map((p) => {
              const n = p.dist.one + p.dist.half + p.dist.zero + p.dist.pending;
              return (
                <tr key={p.questionId}>
                  <td className="mono" title={p.label}>
                    P{p.number}
                  </td>
                  <td>{p.kind}</td>
                  <td className="num">{p.mean === null ? '—' : p.mean.toFixed(2)}</td>
                  <td>
                    <div
                      className="gr-dist"
                      title={`${p.dist.one} · ${p.dist.half} · ${p.dist.zero} · ${p.dist.pending} pending`}
                    >
                      <i className="d1" style={{ width: `${percent(p.dist.one, n)}%` }} />
                      <i className="dh" style={{ width: `${percent(p.dist.half, n)}%` }} />
                      <i className="d0" style={{ width: `${percent(p.dist.zero, n)}%` }} />
                      <i className="dp" style={{ width: `${percent(p.dist.pending, n)}%` }} />
                    </div>
                  </td>
                  <td className="dim">
                    {p.handGraded
                      ? `${p.handGraded.x} / ${p.handGraded.y}`
                      : p.overrides > 0
                        ? plural(p.overrides, 'override')
                        : ''}
                    {p.hand && (
                      <>
                        {' '}
                        <a className="mm-link gr-grade-link"
                          {...hashLink({ kind: 'instructor-grading-assignment', id: summary.assignmentId, view: 'queue', questionId: p.questionId })}>
                          Grade →
                        </a>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mm-note gr-footnote">
        Shares are over the {plural(summary.progress.submitted, 'roster submission')}. Each student's latest attempt counts.
        Open the <a className="mm-link" {...matrix}>Matrix</a> to see every student.
      </p>
    </>
  );
}
