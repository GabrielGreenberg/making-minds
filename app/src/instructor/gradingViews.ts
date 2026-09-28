// The Grading tab's view logic (task 065; memo
// docs/buildout/designs/grading-interface.md §6.1–§6.2), pure — no React.
//
// Every number here is READ off the grading summaries (storage/gradingSummary.ts,
// task 064), never computed from answers: the builder scored each row once
// (engine/score.ts), so the matrix, the Overview's tiles, the per-problem
// table and the release warning are only counts and shares of what it said.
// No view computes a grade (gradingViewCheck's grep gate).

import type { AssignmentData, AssignmentQuestion, IntegrityFlagCode, Points } from '../types';
import { questionModeLabel, questionTask } from '../types';
import { problemNumber } from '../problemSet';
import { formatGrade, pointsLabel } from '../engine/score';
import type {
  AssignmentGradingSummary,
  CourseAssignmentRow,
  GradingProblem,
  GradingRow,
  OffRoster,
} from '../storage/gradingSummary';
import type { RegradeChange, RegradePlan } from '../storage/regrade';
import type { FlaggedStudent, StudentFlag, StudentFlagKind } from '../storage/gradingFlags';
import type { StudentHistoryEntry } from '../storage/gradingSummary';

/** A problem graded by hand: an open (prose) question. Everything else — a
 *  machine, perception, a turbot, fill-in blanks — the autograder scores, and
 *  a human grade on it is an override. */
export function isHandQuestion(q: Pick<AssignmentQuestion, 'buildMode' | 'perception' | 'fill_in'>): boolean {
  return questionTask(q) === 'open';
}

// ── The matrix cell ──────────────────────────────────────────────────────

/** 1 · ½ (h) · 0 · pending (p) · changed since graded (c) · not submitted (m). */
export type CellState = '1' | 'h' | '0' | 'p' | 'c' | 'm';

export interface MatrixCell {
  state: CellState;
  text: string;
  /** A human grade (a hand grade, or an override): the cell's underline. */
  human: boolean;
  title: string;
  /** The problem's integrity flags (⚑), in plain words; empty when none. */
  flags: string[];
}

/** An integrity flag code in plain words (the matrix's ⚑ tooltip; the
 *  attempt itself holds the full detail, whose names the summary never carries). */
export const FLAG_LABEL: Record<IntegrityFlagCode, string> = {
  'ids-other': "parts created in a classmate's editor",
  'ids-unbound': "parts not created in this student's editor for this assignment",
  'text-other': "the answer text carries a classmate's stamp",
  'text-mismatch': 'the answer text differs from its own stamp',
  'text-unsigned': "the answer text has no stamp from this student's editor",
  outside: 'the text was changed outside the editor, then edited on',
  'record-other': "the editing record was made in a classmate's editor",
  'record-missing': 'content with no valid editing record',
  'one-piece-text': 'most of the text arrived in one insertion',
  'too-fast': 'text entered faster than a person types',
  'one-piece-circuit': 'most of the circuit arrived in one paste',
  unaccounted: "more content than the editing record explains",
  'one-save': 'most of the work appeared between two saves',
};

/** One problem's cell in a row. `problem` is the row's entry at the problem's
 *  index (absent when the row has no attempt). */
export function cellOf(problem: GradingProblem | undefined, row: GradingRow): MatrixCell {
  if (!row.latest || !problem) return { state: 'm', text: '—', human: false, title: 'not submitted', flags: [] };
  const flags = (problem.flags ?? []).map((f) => FLAG_LABEL[f]);
  const human = problem.source === 'human';
  if (problem.source === 'changed') {
    return { state: 'c', text: '↻', human: false, title: 'changed since graded — the old grade is a suggestion', flags };
  }
  if (problem.points === null) return { state: 'p', text: '✎', human: false, title: 'awaiting a hand grade', flags };
  const by = human ? ' (a human grade)' : problem.source === 'auto-half' ? ' (the ½ rule)' : '';
  if (problem.points === 1) return { state: '1', text: '1', human, title: `1 point${by}`, flags };
  if (problem.points === 0.5) return { state: 'h', text: '½', human, title: `½ point${by}`, flags };
  return { state: '0', text: '0', human, title: `0 points${by}`, flags };
}

// ── Rows ─────────────────────────────────────────────────────────────────

/** The roster's rows (what every count is over), and the other submitters. */
export function splitRows(summary: AssignmentGradingSummary): { roster: GradingRow[]; offRoster: GradingRow[] } {
  return {
    roster: summary.rows.filter((r) => !r.student.offRoster),
    offRoster: summary.rows.filter((r) => !!r.student.offRoster),
  };
}

/** An off-roster submitter's tag (null = no tag in the matrix: a plain
 *  non-rostered account is flagged by its section of the table alone). */
export const OFF_ROSTER_LABEL: Record<OffRoster, string | null> = {
  removed: 'removed from the roster',
  instructor: 'instructor',
  'not-rostered': null,
};

/** The students before and after `key` in the matrix's order — the roster
 *  (as the builder sorted it), then the off-roster submitters — for the
 *  submission page's Previous / Next (task 067). Unfiltered: the matrix's
 *  filter and search are its own view state, not in the URL, so this is the
 *  one order both pages agree on. Both null for a key not in the summary. */
export function adjacentStudents(
  summary: AssignmentGradingSummary,
  key: string,
): { prev: GradingRow | null; next: GradingRow | null } {
  const { roster, offRoster } = splitRows(summary);
  const order = [...roster, ...offRoster];
  const i = order.findIndex((r) => r.student.key === key);
  if (i < 0) return { prev: null, next: null };
  return { prev: order[i - 1] ?? null, next: order[i + 1] ?? null };
}

export type MatrixFilter = 'all' | 'needs-grading' | 'changed' | 'late' | 'missing' | 'flagged' | 'below-70';

/** The matrix's filter chips, in order. */
export const MATRIX_FILTERS: readonly { id: MatrixFilter; label: string; test: (r: GradingRow) => boolean }[] = [
  { id: 'all', label: 'All', test: () => true },
  // A problem still waiting on a person: pending, or changed since graded.
  { id: 'needs-grading', label: 'Needs grading', test: (r) => !!r.latest && r.problems.some((p) => p.points === null) },
  { id: 'changed', label: 'Changed', test: (r) => r.problems.some((p) => p.source === 'changed') },
  { id: 'late', label: 'Late', test: (r) => !!r.latest?.late.late },
  { id: 'missing', label: 'Missing', test: (r) => r.grade.missing },
  // Any of this assignment's flags on the row (task 070).
  { id: 'flagged', label: 'Flagged', test: (r) => !!r.flags?.length },
  // A submitted grade under 70 (a missing student is under Missing instead).
  { id: 'below-70', label: 'Below 70', test: (r) => !!r.latest && r.grade.final !== null && r.grade.final < 70 },
];

export function filterTest(id: MatrixFilter): (r: GradingRow) => boolean {
  return MATRIX_FILTERS.find((f) => f.id === id)!.test;
}

/** Each chip's count, over the ROSTER's rows (an off-roster submitter never
 *  counts). */
export function filterCounts(summary: AssignmentGradingSummary): Record<MatrixFilter, number> {
  const { roster } = splitRows(summary);
  return Object.fromEntries(MATRIX_FILTERS.map((f) => [f.id, roster.filter(f.test).length])) as Record<MatrixFilter, number>;
}

/** The sections the roster's rows name, sorted (empty = no section select). */
export function sectionsOf(summary: AssignmentGradingSummary): string[] {
  return [...new Set(summary.rows.flatMap((r) => (r.student.section ? [r.student.section] : [])))].sort();
}

/** The search box: a name (either form) or UID, case-insensitive. */
export function matchesSearch(row: GradingRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const { name, sortName, uid } = row.student;
  return [name, sortName, uid].some((s) => s.toLowerCase().includes(q));
}

// ── Problems ─────────────────────────────────────────────────────────────

export interface ProblemStats {
  questionId: number;
  /** The printed number (problemNumber). */
  number: string;
  label: string;
  /** questionModeLabel — "CC", "open", "turbot - FSM", … */
  kind: string;
  hand: boolean;
  /** Mean points over the submitted roster rows' graded cells; null when none is graded. */
  mean: number | null;
  /** How the submitted roster rows' cells split: 1 · ½ · 0 · pending (incl.
   *  changed). Sums to the submitted count. */
  dist: { one: number; half: number; zero: number; pending: number };
  /** Hand problems only: graded by hand, of the submitted rows. */
  handGraded: { x: number; y: number } | null;
  /** Autograded problems only: human grades over the autograde. */
  overrides: number;
}

/** The Overview's per-problem table, in the assignment's order. */
export function problemStats(summary: AssignmentGradingSummary, assignment: AssignmentData): ProblemStats[] {
  const submitted = splitRows(summary).roster.filter((r) => r.latest);
  return summary.questionIds.map((questionId, i) => {
    const index = assignment.questions.findIndex((q) => q.id === questionId);
    const q = assignment.questions[index];
    const hand = q ? isHandQuestion(q) : false;
    const dist = { one: 0, half: 0, zero: 0, pending: 0 };
    let humans = 0;
    for (const r of submitted) {
      const p = r.problems[i];
      if (!p || p.points === null) dist.pending++;
      else if (p.points === 1) dist.one++;
      else if (p.points === 0.5) dist.half++;
      else dist.zero++;
      if (p?.source === 'human') humans++;
    }
    const graded = dist.one + dist.half + dist.zero;
    return {
      questionId,
      number: q ? problemNumber(q.label, index) : String(i + 1),
      label: q?.label ?? `Q${questionId}`,
      kind: q ? questionModeLabel(q) : '—',
      hand,
      mean: graded ? (dist.one + dist.half / 2) / graded : null,
      dist,
      handGraded: hand ? { x: humans, y: submitted.length } : null,
      overrides: hand ? 0 : humans,
    };
  });
}

// ── The Overview's tiles ─────────────────────────────────────────────────

export interface OverviewTiles {
  submitted: { x: number; of: number; onTime: number; late: number; missing: number };
  autograded: { x: number; of: number; stale: number };
  handGraded: { x: number; y: number; changed: number; overrides: number };
  grade: { mean: number | null; median: number | null; provisional: boolean; pendingProblems: number; released: boolean };
}

export function overviewTiles(summary: AssignmentGradingSummary, assignment: AssignmentData): OverviewTiles {
  const { progress: p } = summary;
  const submitted = splitRows(summary).roster.filter((r) => r.latest);
  const cells = submitted.flatMap((r) => r.problems);
  return {
    submitted: { x: p.submitted, of: p.roster, onTime: p.submitted - p.late, late: p.late, missing: p.missing },
    autograded: { x: p.autograded.current + p.autograded.stale, of: p.submitted, stale: p.autograded.stale },
    handGraded: {
      x: p.handGraded.x,
      y: p.handGraded.y,
      changed: cells.filter((c) => c.source === 'changed').length,
      overrides: problemStats(summary, assignment).reduce((n, s) => n + s.overrides, 0),
    },
    grade: {
      mean: p.grades.mean,
      median: p.grades.median,
      provisional: p.grades.provisional > 0,
      pendingProblems: cells.filter((c) => c.points === null).length,
      released: p.released,
    },
  };
}

/** What releasing now would show unfinished — pending hand grades, changed
 *  answers, stale autogrades — as one sentence; null when nothing is. */
export function releaseWarning(summary: AssignmentGradingSummary): string | null {
  const cells = splitRows(summary).roster.filter((r) => r.latest).flatMap((r) => r.problems);
  const pending = cells.filter((c) => c.source === 'pending').length;
  const changed = cells.filter((c) => c.source === 'changed').length;
  const stale = summary.progress.autograded.stale;
  const parts = [
    pending ? `${plural(pending, 'problem')} still awaiting a hand grade` : '',
    changed ? `${plural(changed, 'answer')} changed since graded` : '',
    stale ? `${plural(stale, 'submission')} graded against an older version` : '',
  ].filter(Boolean);
  return parts.length ? `Still open: ${parts.join('; ')}. Those grades will show as provisional.` : null;
}

// ── The Grading tab ──────────────────────────────────────────────────────

/** The course list: counting assignments first (in the catalog's order),
 *  then the ones that don't count (HW7). Stable. */
export function sortGradingRows(rows: readonly CourseAssignmentRow[]): CourseAssignmentRow[] {
  return [...rows.filter(isCounted), ...rows.filter((r) => !isCounted(r))];
}

/** Counts toward the course grade (absent = counts); a row that doesn't is dimmed. */
export function isCounted(row: Pick<CourseAssignmentRow, 'countsTowardGrade'>): boolean {
  return row.countsTowardGrade !== false;
}

/** A share as a whole percent (0 of 0 is 0%). */
export function percent(x: number, of: number): number {
  return of > 0 ? Math.round((x / of) * 100) : 0;
}

export function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

// ── The re-grade dialog (task 069; mockup 7) ─────────────────────────────

const pts = (p: Points | null) => (p === null ? 'pending' : pointsLabel(p));
const gradeText = (g: number | null) => (g === null ? '—' : formatGrade(g));

/** One row of the dry run's table, as text: the autograde's move, and the
 *  grade's — or, under an override, the override that stays. */
export interface RegradeRowView {
  student: string;
  problem: string;
  autograde: string;
  /** The autograde went up (true), down (false), or to/from pending (null). */
  up: boolean | null;
  grade: string;
  /** Set when a human override stands over the change: its points. */
  override: string | null;
}

export function regradeRow(c: RegradeChange): RegradeRowView {
  const a = c.before.auto;
  const b = c.after.auto;
  return {
    student: c.student.name,
    problem: `P${c.number}`,
    autograde: `${pts(a)} → ${pts(b)}`,
    up: a === null || b === null ? null : b > a,
    grade: c.underOverride ? '' : `${gradeText(c.gradeBefore)} → ${gradeText(c.gradeAfter)}`,
    override: c.underOverride && c.after.points !== null ? pointsLabel(c.after.points) : null,
  };
}

/** The dry run's summary line, its lead (bold) apart: "3 results would
 *  change" · "71 unchanged · 108 hand grades and 2 overrides untouched." */
export function regradeSummary(plan: RegradePlan): { changes: string; rest: string } {
  return {
    changes: `${plural(plan.changed.length, 'result')} would change`,
    rest:
      `${plan.unchanged} unchanged · ` +
      `${plural(plan.humanGrades.hand, 'hand grade')} and ${plural(plan.humanGrades.overrides, 'override')} untouched.`,
  };
}

// ── Flags (task 2026-09-26-070; memo §8) ─────────────────────────────────

/** Each flag kind in a few words — a chip's text (prompts, never verdicts). */
export const FLAG_KIND_LABEL: Record<StudentFlagKind, string> = {
  'not-submitted': 'Not submitted',
  'very-late': 'Very late',
  struggling: 'Struggling',
  'no-account': 'No account',
  'group-mismatch': 'Group mismatch',
  integrity: 'Integrity',
  'identical-text': 'Identical text',
};

export function flagLabel(kind: StudentFlagKind): string {
  return FLAG_KIND_LABEL[kind];
}

/** A flag as a chip: the kind, where (the assignment's title, when
 *  `titleOf` knows it), and "same group" when a group explains identical text. */
export function flagChipText(flag: StudentFlag, titleOf?: (assignmentId: string) => string | undefined): string {
  const where = flag.assignmentId ? titleOf?.(flag.assignmentId) : undefined;
  return `${flagLabel(flag.kind)}${where ? ` · ${where}` : ''}${flag.sameGroup ? ' (same group)' : ''}`;
}

/** The Needs-attention box: how many roster students are flagged, and how
 *  many carry each kind (a student counts once per kind), in label order. */
export function flagKindCounts(flagged: readonly FlaggedStudent[]): { total: number; kinds: { kind: StudentFlagKind; count: number }[] } {
  const kinds = (Object.keys(FLAG_KIND_LABEL) as StudentFlagKind[])
    .map((kind) => ({ kind, count: flagged.filter((f) => f.flags.some((x) => x.kind === kind)).length }))
    .filter((k) => k.count > 0);
  return { total: flagged.length, kinds };
}

/** One line of the student page's grade history: "HW2 P3: ✎ → ½ (hand
 *  grade)", "HW2: extension to Oct 8, 11:59 PM", …. `formatDate` renders a
 *  date (the view passes dueDates' formatter; the check a plain one). */
export function historyLine(entry: StudentHistoryEntry, formatDate: (iso: string) => string): string {
  const e = entry.event;
  const where = e.questionId !== undefined ? `${entry.title} P${e.questionId}` : entry.title;
  const pts = (x: unknown) => {
    const p = (x as { points?: Points } | null)?.points;
    return p === undefined || p === null ? '—' : pointsLabel(p);
  };
  const note = (x: unknown) => {
    const n = (x as { note?: string } | null)?.note;
    return n ? ` — “${n}”` : '';
  };
  switch (e.kind) {
    case 'grade':
      return `${where}: ${pts(e.before)} → ${pts(e.after)} (hand grade)${note(e.after)}`;
    case 'override':
      return `${where}: ${pts(e.before)} → ${pts(e.after)} (override)${note(e.after)}`;
    case 'clear':
      return `${where}: grade cleared (was ${pts(e.before)})`;
    case 'migrate':
      return `${where}: ${pts(e.after)} (carried over from a review)`;
    case 'extension': {
      const to = (e.after as { dueDate?: string } | null)?.dueDate;
      return to ? `${where}: extension to ${formatDate(to)}` : `${where}: extension cleared`;
    }
    case 'waiver': {
      const w = e.after as { points?: number } | null;
      return w?.points ? `${where}: ${w.points} late points waived` : `${where}: waiver cleared`;
    }
    case 'regrade':
      return `${where}: re-graded, ${pts(e.before)} → ${pts(e.after)}${e.underOverride ? ' (an override stands)' : ''}`;
  }
}
