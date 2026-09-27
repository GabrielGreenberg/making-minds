import { useState } from 'react';
import type { AssignmentData } from '../types';
import type { AssignmentGradingSummary, GradingRow } from '../storage/gradingStore';
import type { OffRoster } from '../storage/gradingSummary';
import { navigate } from '../routing';
import { hashLink } from '../components/PageShell';
import { formatDateTime } from '../dueDates';
import {
  cellOf,
  filterCounts,
  filterTest,
  matchesSearch,
  MATRIX_FILTERS,
  problemStats,
  sectionsOf,
  splitRows,
  type MatrixFilter,
} from './gradingViews';
import { GradeValue } from './GradingParts';

/** Why an off-roster row is there (below the "not on the roster" divider,
 *  so that case needs no tag of its own). */
const OFF_ROSTER_LABEL: Record<OffRoster, string | null> = {
  removed: 'removed from the roster',
  instructor: 'instructor',
  'not-rostered': null,
};

/**
 * An assignment's Matrix (task 065; memo §6.2, mockup 3): roster students ×
 * problems, each cell the summary's points for that problem (gradingViews
 * cellOf), with filter chips, a section select and a search. Filter state is
 * the view's own, never the URL's. Off-roster submitters sit below a divider,
 * dimmed, and never count. A row opens that student's submission. ⚑ marks a problem
 * with integrity flags (the summary's `flags`); the Flagged chip and the
 * row-level flags arrive with task 070.
 */
export function GradingMatrix({ summary, assignment }: { summary: AssignmentGradingSummary; assignment: AssignmentData }) {
  const [filter, setFilter] = useState<MatrixFilter>('all');
  const [section, setSection] = useState('');
  const [search, setSearch] = useState('');

  const counts = filterCounts(summary);
  const sections = sectionsOf(summary);
  const problems = problemStats(summary, assignment);
  const { roster, offRoster } = splitRows(summary);
  const test = filterTest(filter);
  const shown = (r: GradingRow) => test(r) && (!section || r.student.section === section) && matchesSearch(r, search);
  const rosterShown = roster.filter(shown);
  const offShown = offRoster.filter(shown);
  const cols = problems.length + 4;

  const row = (r: GradingRow, off: boolean) => {
    const open = { kind: 'instructor-grading-student', id: summary.assignmentId, student: r.student.key } as const;
    const late = r.latest?.late;
    return (
      <tr key={r.student.key} className={`gr-row${off ? ' gr-dimrow' : ''}`} onClick={() => navigate(open)}>
        <td className="name">
          <a {...hashLink(open)} onClick={(e) => { e.stopPropagation(); hashLink(open).onClick(e); }}>
            {r.student.sortName}
          </a>
          {r.student.section && <span className="dim">{r.student.section}</span>}
          {r.student.offRoster && OFF_ROSTER_LABEL[r.student.offRoster] && (
            <span className="tag gr-tag-gap">{OFF_ROSTER_LABEL[r.student.offRoster]}</span>
          )}
        </td>
        <td className="date">
          {r.latest ? (
            formatDateTime(r.latest.submittedAt)
          ) : r.grade.missing ? (
            <span className="tag tag--danger">Missing</span>
          ) : (
            <span className="dim">not yet</span>
          )}
        </td>
        {problems.map((p, i) => {
          const c = cellOf(r.problems[i], r);
          return (
            <td key={p.questionId} className="q">
              <span className={`gr-cell gr-cell--${c.state}${c.human ? ' gr-cell--human' : ''}`} title={`P${p.number}: ${c.title}`}>
                {c.text}
              </span>
              {c.flags.length > 0 && (
                <span className="gr-flag" title={`Integrity — to look at, not a verdict:\n${c.flags.join('\n')}`}>
                  ⚑
                </span>
              )}
            </td>
          );
        })}
        <td className="num">
          {late?.late && late.deduction ? (
            <span className="mm-danger" title={late.units != null ? `${late.units} late` : undefined}>
              −{late.deduction}
            </span>
          ) : late?.late ? (
            <span className="tag tag--danger">late</span>
          ) : null}
        </td>
        <td className="num grade">
          <GradeValue value={r.grade.final} provisional={r.grade.provisional} />
        </td>
      </tr>
    );
  };

  return (
    <>
      <div className="gr-filters">
        {MATRIX_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`gr-filter${filter === f.id ? ' gr-filter--on' : ''}`}
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
            <b>{counts[f.id]}</b>
          </button>
        ))}
        <span className="gr-spacer" />
        {sections.length > 0 && (
          <select className="mm-input" value={section} onChange={(e) => setSection(e.target.value)} aria-label="Section">
            <option value="">All sections</option>
            {sections.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        <input
          className="mm-input"
          type="search"
          placeholder="Search name or UID"
          aria-label="Search name or UID"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="mm-tablewrap">
        <table className="mm-table gr-matrix">
          <thead>
            <tr>
              <th>Student</th>
              <th>Submitted</th>
              {problems.map((p) => (
                <th key={p.questionId} className={`q${p.hand ? ' hand' : ''}`} title={`${p.label} — ${p.kind}${p.hand ? ', graded by hand' : ''}`}>
                  {p.number}
                </th>
              ))}
              <th className="num">Late</th>
              <th className="num">Grade</th>
            </tr>
          </thead>
          <tbody>
            {rosterShown.map((r) => row(r, false))}
            {rosterShown.length === 0 && (
              <tr className="gr-more">
                <td colSpan={cols}>No roster student matches.</td>
              </tr>
            )}
            {offShown.length > 0 && (
              <tr className="gr-divider">
                <td colSpan={cols}>Not counted — submitted, but not on the roster</td>
              </tr>
            )}
            {offShown.map((r) => row(r, true))}
          </tbody>
        </table>
      </div>

      <div className="gr-legend">
        <span><span className="gr-cell gr-cell--1">1</span>autograde pass</span>
        <span><span className="gr-cell gr-cell--h">½</span>half credit</span>
        <span><span className="gr-cell gr-cell--0">0</span>no credit</span>
        <span><span className="gr-cell gr-cell--1 gr-cell--human">1</span>underline = a human grade or override</span>
        <span><span className="gr-cell gr-cell--p">✎</span>awaiting a hand grade</span>
        <span><span className="gr-cell gr-cell--c">↻</span>changed since graded</span>
        <span><span className="gr-cell gr-cell--m">—</span>not submitted</span>
        <span><span className="gr-prov">*</span> provisional</span>
        <span><span className="gr-flag">⚑</span>integrity flags — to look at, not a verdict</span>
        <span>Accent problem numbers are graded by hand.</span>
      </div>
    </>
  );
}
