import type { AssignmentData } from '../types';
import { getAssignment } from '../assignments';
import { assignmentStore, gradingStore } from '../storage/backend';
import type { AssignmentGradingSummary } from '../storage/gradingStore';
import { navigate, type GradingView, type Route } from '../routing';
import { hashLink } from '../components/PageShell';
import { formatDueDate } from '../dueDates';
import { useAsyncValue } from '../useAsyncValue';
import { isHandQuestion, plural, releaseWarning, sectionsOf } from './gradingViews';
import { ReleaseTag } from './GradingParts';
import { GradingOverview } from './GradingOverview';
import { GradingMatrix } from './GradingMatrix';
import { GradingQueue } from './GradingQueue';

const VIEWS: { view: GradingView; label: string }[] = [
  { view: 'overview', label: 'Overview' },
  { view: 'matrix', label: 'Matrix' },
  { view: 'queue', label: 'Queue' },
];

/**
 * One assignment's grading (task 065; memo grading-interface.md §6.2,
 * mockups 2–3): a header with the Release action, and a segmented control
 * over Overview · Matrix · Queue (the URL keeps the view). Reads the 064
 * summary — one row per roster student, then the other submitters — and the
 * assignment for its labels; no view computes a grade. The Queue (task 066)
 * reads its own feed too, and reloads the summary after each grade.
 */
export function GradingAssignment({ route }: { route: Extract<Route, { kind: 'instructor-grading-assignment' }> }) {
  const { id, view } = route;
  const { value, loading, reload } = useAsyncValue(
    async () => {
      const [summary, assignment] = await Promise.all([gradingStore.summary(id), getAssignment(id)]);
      return { summary, assignment };
    },
    [id],
  );

  if (!value) return <p className="mm-empty">{loading ? 'Loading…' : 'Couldn’t load grading — the server may be unreachable.'}</p>;
  const { summary, assignment } = value;
  if (!summary || !assignment) {
    return (
      <p className="mm-empty">
        No such assignment.{' '}
        <a className="mm-link" {...hashLink({ kind: 'instructor-grading' })}>
          Back to Grading
        </a>
      </p>
    );
  }

  const toggleRelease = async () => {
    if (!summary.released) {
      const warning = releaseWarning(summary);
      const ask = `Release grades for "${summary.title}"? Students will see their grades and notes.` + (warning ? `\n\n${warning}` : '');
      if (!window.confirm(ask)) return;
    } else if (!window.confirm(`Hide grades for "${summary.title}" from students again?`)) {
      return;
    }
    await assignmentStore.setGradesReleased(id, !summary.released);
    reload();
  };

  const sections = sectionsOf(summary);
  return (
    <div className="grading-assignment">
      <div className="mm-head mm-head--row">
        <div>
          <a className="eyebrow" {...hashLink({ kind: 'instructor-grading' })}>
            ← Grading
          </a>
          <h1>{summary.title}</h1>
          <p className="mm-lede">
            <Lede summary={summary} assignment={assignment} /> <ReleaseTag released={summary.released} />
          </p>
        </div>
        <div className="mm-actions">
          {/* The CSV itself is task 071's (its format spans HW1–HW6); the
              control stands here so the Overview's actions are complete. */}
          <button className="mm-btn" disabled title="Export CSV — arrives with task 071">
            Export CSV
          </button>
          {summary.released ? (
            <button className="mm-btn" onClick={() => void toggleRelease()}>
              Hide grades
            </button>
          ) : (
            <button className="mm-btn mm-btn--primary" onClick={() => void toggleRelease()}>
              Release grades…
            </button>
          )}
        </div>
      </div>

      <div className="gr-views">
        <div className="mm-segmented" role="tablist" aria-label="Grading views">
          {VIEWS.map((v) => (
            <button
              key={v.view}
              type="button"
              role="tab"
              aria-selected={v.view === view}
              className={`mm-segmented-btn${v.view === view ? ' mm-segmented-btn--active' : ''}`}
              onClick={() => navigate({ kind: 'instructor-grading-assignment', id, view: v.view }, { replace: true })}
            >
              {v.label}
            </button>
          ))}
        </div>
        <span className="dim gr-views-meta">
          {summary.progress.roster} on the roster
          {sections.length > 0 && ` · section${sections.length === 1 ? '' : 's'} ${sections.join(', ')}`}
        </span>
      </div>

      {view === 'overview' && <GradingOverview summary={summary} assignment={assignment} />}
      {view === 'matrix' && <GradingMatrix summary={summary} assignment={assignment} />}
      {view === 'queue' && <GradingQueue summary={summary} assignment={assignment} route={route} onChanged={reload} />}
    </div>
  );
}

/** "Due … · n problems (k autograded, m by hand) · latest submission counts". */
function Lede({ summary, assignment }: { summary: AssignmentGradingSummary; assignment: AssignmentData }) {
  const hand = assignment.questions.filter(isHandQuestion).length;
  const n = assignment.questions.length;
  return (
    <>
      {summary.dueDate ? `Due ${formatDueDate(summary.dueDate)} · ` : ''}
      {plural(n, 'problem')} ({n - hand} autograded, {hand} by hand) · latest submission counts ·
    </>
  );
}
