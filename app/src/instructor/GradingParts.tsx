// Small pieces the Grading tab's views share (task 065): the progress bar,
// a grade as the summaries report it, the release tag, and a flag's chip
// (task 070), and the Export CSV button (task 071). Display only — every
// number arrives from the grading summaries (gradingViews.ts); the CSV from
// the GradingStore seam, which builds and logs it.

import { useState, type ReactNode } from 'react';
import { gradingStore } from '../storage/backend';
import { downloadText } from '../download';
import { formatGrade } from '../engine/score';
import type { StudentFlag, StudentFlagKind } from '../storage/gradingFlags';
import { flagChipText, percent } from './gradingViews';

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

/** A flag kind's tag colour: a missing or failing record in the danger
 *  tone, a listing or account to chase in the warning one, integrity prompts
 *  in the accent. */
const FLAG_TONE: Record<StudentFlagKind, string> = {
  'not-submitted': 'tag--danger',
  'very-late': 'tag--danger',
  struggling: 'tag--danger',
  'no-account': 'tag--warn',
  'group-mismatch': 'tag--warn',
  integrity: 'tag--accent',
  'identical-text': 'tag--accent',
};

/** One flag as a chip — a prompt to look, never a verdict; the detail (and
 *  who else, by name when `nameOf` knows them) in its tooltip. */
export function FlagChip({
  flag,
  titleOf,
  nameOf,
}: {
  flag: StudentFlag;
  titleOf?: (assignmentId: string) => string | undefined;
  nameOf?: (key: string) => string | undefined;
}) {
  const others = (flag.others ?? []).map((k) => nameOf?.(k)).filter(Boolean);
  const tip = `${flag.detail}${others.length ? ` — ${others.join(', ')}` : ''}`;
  return (
    <span className={`tag gr-flagchip ${FLAG_TONE[flag.kind]}`} title={tip}>
      ⚑ {flagChipText(flag, titleOf)}
    </span>
  );
}

/** Export CSV (task 071): the course's grades, or with `assignmentId` that
 *  one set's column — built (and logged) by the GradingStore, downloaded
 *  here. Nothing is written anywhere but the viewer's download. */
export function ExportCsvButton({ assignmentId }: { assignmentId?: string }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const out = await gradingStore.exportGrades(assignmentId);
      if (!out) setProblem('No such assignment.');
      else downloadText(out.filename, out.csv, 'text/csv;charset=utf-8');
    } catch {
      setProblem('Couldn’t export — the server may be unreachable.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {problem && <span className="mm-danger">{problem}</span>}
      <button
        type="button"
        className="mm-btn"
        disabled={busy}
        title={assignmentId ? 'This assignment’s grades as a CSV (one column)' : 'Every counted, published problem set’s grades and the average, as a CSV'}
        onClick={() => void run()}
      >
        {busy ? 'Exporting…' : 'Export CSV'}
      </button>
    </>
  );
}
