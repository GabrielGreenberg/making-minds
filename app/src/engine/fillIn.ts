// Fill-in grading — typed text answers compared as strings (engine-pure: no
// React/DOM, same code in the browser and on the server). Outside the value
// codec: there is no machine to run, so nothing to encode or simulate.
//
// A spec has one of two SHAPES, and this file is the ONE reader of them
// (`fillInShape`; a pipelineCheck grep pin keeps every other file off
// `labels`, and another off `numericOnly`):
//  - blanks: labelled boxes, box i compared with key i;
//  - a table (task 079): a blank argument–value table. The student writes the
//    arguments too, so it is graded as a FUNCTION, order-free: each key row is
//    one case, passed iff exactly one student row has that row's arguments and
//    its values match. Two rows with the same arguments are not a function
//    (that case fails); empty rows are ignored; row order never matters.
// Both keep their key in `fill_in_answers` (row-major for a table) and their
// answers in `fillAnswers` (row-major for a table), so persistence, the
// editing record and provenance see one shape: a list of strings.
//
// The one normalisation is leading zeros: "0011" and "11" name the same
// binary numeral, and a student who pads is not wrong. Surrounding whitespace
// goes too. Everything else is compared literally — the answers are strings,
// not numbers, so "1010" stays a numeral and never becomes one thousand and
// ten.

import type { FillInCaseResult, FillInSpec } from '../types';

/** One blank of a fill-in spec, as the student panel and the creator see it. */
export interface FillInBlank {
  label: string;
  /** Only digits may be typed into this blank. */
  digitsOnly: boolean;
}

/** One column of a fill-in table. */
export interface FillInColumn {
  header: string;
  /** Only digits may be typed into this column's cells. */
  digitsOnly: boolean;
  /** One of the leading `argColumns` (else a value column). */
  argument: boolean;
}

/** A table-shaped spec, as the student panel, the grader and the creator see
 *  it: the columns, how many lead as arguments, and the rows students get. */
export interface FillInTableShape {
  kind: 'table';
  columns: FillInColumn[];
  argColumns: number;
  rows: number;
}

export type FillInShape = { kind: 'blanks'; blanks: FillInBlank[] } | FillInTableShape;

/** The most rows a table gives students. Rendering and grading both work
 *  row by row, so an authored count past this (a typo in the creator's
 *  rows field) would stall the server's grader and the student's panel:
 *  `fillInKeyProblem` and the creator's `fillInTableDefects` refuse it, and
 *  `fillInShape` never renders more. */
export const FILL_IN_TABLE_MAX_ROWS = 100;

/** Box i's digits-only flag: `true` locks every box, an array locks box i
 *  iff its entry i is `true` — an array is truthy, so nothing may test it
 *  bare. The ONE reader of `numericOnly` (a pipelineCheck grep pin). */
function digitsOnlyAt(spec: FillInSpec, i: number): boolean {
  const n = spec.numericOnly;
  return Array.isArray(n) ? n[i] === true : n === true;
}

/** The spec's shape — the ONE reader of `labels`, `table` and `numericOnly`.
 *  A present `table` wins; `numericOnly` is per table column there, per blank
 *  otherwise. A row count below 1 (or not a number) renders no rows, one
 *  past `FILL_IN_TABLE_MAX_ROWS` renders that many (`fillInKeyProblem` names
 *  both). */
export function fillInShape(spec: FillInSpec): FillInShape {
  const t = spec.table;
  if (t) {
    const rows = Math.floor(Number(t.rows));
    return {
      kind: 'table',
      columns: (t.columns ?? []).map((header, i) => ({
        header,
        digitsOnly: digitsOnlyAt(spec, i),
        argument: i < t.argColumns,
      })),
      argColumns: t.argColumns,
      rows: rows > 0 ? Math.min(rows, FILL_IN_TABLE_MAX_ROWS) : 0,
    };
  }
  return {
    kind: 'blanks',
    blanks: (spec.labels ?? []).map((label, i) => ({ label, digitsOnly: digitsOnlyAt(spec, i) })),
  };
}

/** The spec's blanks, in order ([] for a table). */
export function fillInBlanks(spec: FillInSpec): FillInBlank[] {
  const shape = fillInShape(spec);
  return shape.kind === 'blanks' ? shape.blanks : [];
}

/** How many cases the question is graded on — the N of its ½ rule: one per
 *  blank, or one per KEY row of a table (never its cells, columns, or the
 *  rows students see). A student's copy has no key, so its table counts 0. */
export function fillInCaseCount(spec: FillInSpec | undefined, key: readonly string[] | undefined): number {
  if (!spec) return 0;
  const shape = fillInShape(spec);
  if (shape.kind === 'blanks') return shape.blanks.length;
  const c = shape.columns.length;
  return c > 0 ? Math.floor((key?.length ?? 0) / c) : 0;
}

/** The first `rows` rows of a table's row-major cells, C cells each (missing
 *  cells read ''). Cells past rows × C — a longer, stale answer — are not
 *  part of the table. */
export function fillInTableRows(
  shape: Pick<FillInTableShape, 'columns' | 'rows'>,
  cells: readonly string[],
): string[][] {
  const c = shape.columns.length;
  return Array.from({ length: shape.rows }, (_, r) =>
    Array.from({ length: c }, (_, j) => cells[r * c + j] ?? ''));
}

/** A table row's name — its arguments only, never a value: the one argument
 *  ("@"), or the tuple ("(0, 1)"). */
export function fillInRowLabel(args: readonly string[]): string {
  return args.length === 1 ? args[0] : `(${args.join(', ')})`;
}

/** What one graded case of this spec is called: a "row" of a table, a
 *  "blank" otherwise (and when the spec is unknown). */
export function fillInCaseNoun(spec: FillInSpec | undefined): 'row' | 'blank' {
  return spec && fillInShape(spec).kind === 'table' ? 'row' : 'blank';
}

/** Trim, then drop leading zeros while keeping at least one digit ("000" →
 *  "0", "0011" → "11", "" → ""). */
export function normalizeFillAnswer(raw: string): string {
  const trimmed = raw.trim();
  const stripped = trimmed.replace(/^0+/, '');
  return stripped === '' && trimmed !== '' ? '0' : stripped;
}

/** Why this spec and key cannot be graded, or null when they can. The grader
 *  skips with this reason; `problemSet.ts validateDocument` reports it
 *  (authoring-side — a student's copy has no key). Blanks need a key cell
 *  per blank. A table needs ≥ 2 columns, 1 ≤ argColumns < columns, a whole
 *  row count from 1 to `FILL_IN_TABLE_MAX_ROWS`, and a key of whole rows —
 *  at least one, no more than
 *  students get, no empty cell, and no two with the same arguments (a
 *  function's table lists each argument once). */
export function fillInKeyProblem(spec: FillInSpec, key: readonly string[]): string | null {
  const shape = fillInShape(spec);
  if (shape.kind === 'blanks') {
    return shape.blanks.length === 0 || key.length !== shape.blanks.length
      ? 'fill-in question has no answer key'
      : null;
  }
  const c = shape.columns.length;
  const a = shape.argColumns;
  const rows = spec.table!.rows;
  if (c < 2) return 'fill-in table needs at least two columns (an argument and a value)';
  if (!Number.isInteger(a) || a < 1 || a >= c) {
    return `fill-in table needs 1 to ${c - 1} argument columns, not ${a}`;
  }
  if (!Number.isInteger(rows) || rows < 1) return `fill-in table needs a whole, positive row count, not ${rows}`;
  if (rows > FILL_IN_TABLE_MAX_ROWS) {
    return `fill-in table gives students ${rows} rows; the most it may give is ${FILL_IN_TABLE_MAX_ROWS}`;
  }
  if (key.length === 0) return 'fill-in question has no answer key';
  if (key.length % c !== 0) return `fill-in table's key is not whole rows of ${c} cells (it has ${key.length})`;
  const keyRows = key.length / c;
  if (keyRows > rows) return `fill-in table's key has ${keyRows} rows but students get only ${rows}`;
  const firstRowOf = new Map<string, number>();
  for (let r = 0; r < keyRows; r++) {
    const row = key.slice(r * c, r * c + c);
    if (row.some((cell) => normalizeFillAnswer(cell) === '')) return `fill-in table's key row ${r + 1} has an empty cell`;
    const args = JSON.stringify(row.slice(0, a).map(normalizeFillAnswer));
    const first = firstRowOf.get(args);
    if (first !== undefined) {
      return `fill-in table's key rows ${first + 1} and ${r + 1} have the same arguments ` +
        `${fillInRowLabel(row.slice(0, a).map((x) => x.trim()))}`;
    }
    firstRowOf.set(args, r);
  }
  return null;
}

/** One result per case, in the key's order. Blanks: missing answers (a
 *  shorter array, or a blank the student left empty) fail rather than being
 *  skipped. A table: see `gradeFillInTable`. Call only when
 *  `fillInKeyProblem` is null. */
export function gradeFillIn(
  spec: FillInSpec,
  answers: readonly string[],
  given: readonly string[] | undefined,
): FillInCaseResult[] {
  const shape = fillInShape(spec);
  if (shape.kind === 'table') return gradeFillInTable(shape, answers, given ?? []);
  return shape.blanks.map(({ label }, i) => {
    const expected = normalizeFillAnswer(answers[i] ?? '');
    const got = normalizeFillAnswer(given?.[i] ?? '');
    return { label, expected, got, pass: got !== '' && got === expected };
  });
}

/**
 * A table graded as a function, order-free. Each key row is one case: its
 * label names the row's arguments (never a value), `expected` its values
 * joined ' | '. The student's rows are the table's first `rows` rows, every
 * cell normalised; an all-empty row is no row at all, so only the rows the
 * answer has cells for are built, whatever the authored count. The case
 * passes iff EXACTLY one student row has its arguments and every value cell
 * of that row matches (none empty). `got` is '' when no row has the
 * arguments, that row's values, or — two or more rows claiming them — every
 * such row's values joined ' / '.
 */
function gradeFillInTable(
  shape: FillInTableShape,
  answers: readonly string[],
  given: readonly string[],
): FillInCaseResult[] {
  const c = shape.columns.length;
  const a = shape.argColumns;
  const same = (x: readonly string[], y: readonly string[]) => x.every((v, j) => v === y[j]);
  const reached = { ...shape, rows: Math.min(shape.rows, Math.ceil(given.length / c)) };
  const studentRows = fillInTableRows(reached, given)
    .map((row) => row.map(normalizeFillAnswer))
    .filter((row) => row.some((cell) => cell !== ''));
  return Array.from({ length: Math.floor(answers.length / c) }, (_, r) => {
    const raw = answers.slice(r * c, r * c + c);
    const keyRow = raw.map(normalizeFillAnswer);
    const args = keyRow.slice(0, a);
    const values = keyRow.slice(a);
    const matches = studentRows.filter((row) => same(row.slice(0, a), args));
    const pass =
      matches.length === 1 && matches[0].slice(a).every((cell, j) => cell !== '' && cell === values[j]);
    return {
      label: fillInRowLabel(raw.slice(0, a).map((x) => x.trim())),
      expected: values.join(' | '),
      got: matches.map((row) => row.slice(a).join(' | ')).join(' / '),
      pass,
    };
  });
}
