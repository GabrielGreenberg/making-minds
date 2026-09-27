// Small pieces the Grading tab's views share (task 065): the progress bar,
// a grade as the summaries report it, and the release tag. Display only —
// every number arrives from the grading summaries (gradingViews.ts).

import type { ReactNode } from 'react';
import { formatGrade } from '../engine/score';
import { percent } from './gradingViews';

/** A bar at x / of (`ok` = the done colour, for a finished count). */
export function Bar({ x, of, ok }: { x: number; of: number; ok?: boolean }) {
  return (
    <div className={`gr-bar${ok ? ' gr-bar--ok' : ''}`} role="presentation">
      <i style={{ width: `${percent(x, of)}%` }} />
    </div>
  );
}

/** "x / y  n%" over a bar, with a sub-line — the Grading tab's progress cell. */
export function Prog({ x, of, sub }: { x: number; of: number; sub?: ReactNode }) {
  return (
    <div className="gr-prog">
      <div className="gr-prog-line">
        <b>
          {x} / {of}
        </b>
        <span className="dim">{percent(x, of)}%</span>
      </div>
      <Bar x={x} of={of} ok={of > 0 && x === of} />
      {sub ? <div className="gr-prog-sub">{sub}</div> : null}
    </div>
  );
}

/** A grade out of 100, starred while provisional; — when there is none. */
export function GradeValue({ value, provisional }: { value: number | null; provisional?: boolean }) {
  if (value === null) return <>—</>;
  return (
    <>
      {formatGrade(value)}
      {provisional ? (
        <span className="gr-prov" title="Provisional — some problems still await a hand grade">
          *
        </span>
      ) : null}
    </>
  );
}

export function ReleaseTag({ released }: { released: boolean }) {
  return released ? <span className="tag tag--ok">Grades released</span> : <span className="tag">Grades hidden</span>;
}
