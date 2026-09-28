// The grades export (task 2026-09-26-071; memo grading-interface.md §3
// decisions 12/12b, §7.5): the problem-set grades as a CSV a spreadsheet
// opens — one row per roster student, `UID, name, email, section`, a column
// per counted, published set (HW1…HW6), and their `average`.
//
// A RENDERING of the 064 summaries, never a third grade computation: every
// number is a summary row's `grade.final` (the score's, late deduction
// included; a missing set past its effective due date is its 0, one not yet
// due blank) or gradingSummary.ts `countedAverage` — the student page's own
// line. Nothing here scores (grep-gated in gradingViewCheck [export]).
//
// Pure — no DOM, no storage, no clock — so both adapters build the same
// bytes: the server's route (server/src/gradingSummary.ts gradesExport) and
// local mode's GradingStore. The file is a download only; nothing writes it
// to disk (PROFILE §8.9: student data never enters the repo).

import { sortAssignments } from '../assignmentOrder';
import { countedAverage, type AssignmentGradingSummary, type GradingRow } from './gradingSummary';

/** One assignment as the export reads it: its full summary, its place in
 *  the catalog, and whether students can see it (a hidden set never counts). */
export interface ExportAssignment {
  summary: AssignmentGradingSummary;
  order?: number;
  visible: boolean;
}

export interface GradesExport {
  filename: string;
  /** UTF-8 BOM + RFC 4180, CRLF line ends. */
  csv: string;
  /** The grade columns' headers, in order (the log's `after.columns`). */
  columns: string[];
  /** How many student rows. */
  rows: number;
}

/** The course's zone, for the filename's date (devData/courseCalendar.json). */
const COURSE_TIME_ZONE = 'America/Los_Angeles';

/** A set's column header: its title's leading `HW<n>` ("HW1. Basics…" →
 *  "HW1"), else its id. */
export function exportColumnLabel(title: string, id: string): string {
  return /^\s*(HW\s*\d+)\b/i.exec(title)?.[1].replace(/\s+/g, '').toUpperCase() ?? id;
}

/** One CSV field: a text cell a spreadsheet would read as a formula (it
 *  starts with = + - @, a tab or a CR) gets a leading apostrophe; then RFC
 *  4180 quoting when it holds a comma, quote or line break. Numbers are
 *  passed as strings by the caller and never start with those. */
export function csvCell(text: string, numeric = false): string {
  const guarded = !numeric && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** `making-minds-grades-YYYY-MM-DD.csv`, or with one assignment
 *  `making-minds-<id>-grades-YYYY-MM-DD.csv` — the course's date; no
 *  student data in the name. */
export function exportFilename(now: number, assignmentId?: string, timeZone = COURSE_TIME_ZONE): string {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  const id = assignmentId ? `${assignmentId.replace(/[^A-Za-z0-9_-]/g, '_')}-` : '';
  return `making-minds-${id}grades-${date}.csv`;
}

const num = (n: number | null): string => (n === null ? '' : String(n));

/**
 * The CSV. Course mode: the counted (`countsTowardGrade !== false`) AND
 * published sets, in the catalog's order, then `average` (countedAverage over
 * exactly those columns). `only` (an assignment id): that one column, no
 * average — any set, counted or not, since the instructor chose it; null when
 * no such assignment. Rows: the roster students (no off-roster submitter), in
 * the summaries' order; `emailOf` names a row's account address by its key.
 */
export function buildGradesExport(input: {
  assignments: readonly ExportAssignment[];
  emailOf: (key: string) => string;
  now: number;
  only?: string;
  timeZone?: string;
}): GradesExport | null {
  const ordered = sortAssignments(input.assignments.map((a) => ({ ...a, title: a.summary.title })));
  const picked = input.only !== undefined
    ? ordered.filter((a) => a.summary.assignmentId === input.only)
    : ordered.filter((a) => a.visible && a.summary.countsTowardGrade !== false);
  if (input.only !== undefined && picked.length === 0) return null;

  const seen = new Map<string, number>();
  const columns = picked.map(({ summary }) => {
    const label = exportColumnLabel(summary.title, summary.assignmentId);
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    return n === 1 ? label : `${label} (${n})`;
  });
  const withAverage = input.only === undefined;

  // The student list: the roster rows, in the summaries' order (every summary
  // lists the same roster, sorted by name; the first one's order stands).
  const rowsBy = picked.map(({ summary }) => new Map(summary.rows.filter((r) => !r.student.offRoster).map((r) => [r.student.key, r])));
  const students = (input.assignments[0]?.summary.rows ?? []).filter((r) => !r.student.offRoster).map((r) => r.student);

  const header = ['UID', 'name', 'email', 'section', ...columns, ...(withAverage ? ['average'] : [])];
  const lines = [header.map((h) => csvCell(h)).join(',')];
  for (const student of students) {
    const mine = picked.map(({ summary }, i) => ({ summary, row: rowsBy[i]!.get(student.key) }));
    const cells = [
      csvCell(student.uid),
      csvCell(student.name),
      csvCell(input.emailOf(student.key)),
      csvCell(student.section ?? ''),
      ...mine.map(({ row }) => csvCell(num(row?.grade.final ?? null), true)),
    ];
    if (withAverage) {
      const counted = mine
        .filter((m): m is { summary: AssignmentGradingSummary; row: GradingRow } => m.row !== undefined)
        .map(({ summary, row }) => ({ countsTowardGrade: summary.countsTowardGrade, dueDate: summary.dueDate, row }));
      cells.push(csvCell(num(countedAverage(counted, input.now).value), true));
    }
    lines.push(cells.join(','));
  }
  return {
    filename: exportFilename(input.now, input.only, input.timeZone),
    csv: '﻿' + lines.join('\r\n') + '\r\n',
    columns,
    rows: students.length,
  };
}
