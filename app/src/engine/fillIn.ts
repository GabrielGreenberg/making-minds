// Fill-in grading — typed text answers checked as strings (engine-pure: no
// React/DOM, same code in the browser and on the server; `Intl.Segmenter` is
// ECMAScript, not the DOM). Outside the value codec: there is no machine to
// run, so nothing to encode or simulate.
//
// A spec has one of three SHAPES, and this file is the ONE reader of them
// (`fillInShape`; pipelineCheck grep pins keep every other file off
// `labels`, `numericOnly` and `numeral`):
//  - blanks: labelled boxes, box i compared with key i;
//  - a table (task 079): a blank argument–value table. The student writes the
//    arguments too, so it is graded as a FUNCTION, order-free: each key row is
//    one case, passed iff exactly one student row has that row's arguments and
//    its values match. Two rows with the same arguments are not a function
//    (that case fails); empty rows are ignored; row order never matters.
//  - an invented numeral system (task 080): a symbol box per digit of a base,
//    then a box per number to write in it. There is no key — the right
//    numeral is spelled in the student's OWN symbols — so it is graded BY
//    RULE, one case per box (`gradeInventedNumeral`).
// A table authored with no key is a REVIEW table (task 048): nothing to
// compare, so the grader leaves it pending for a person (isReviewTable).
// The first two keep their key in `fill_in_answers` (row-major for a table);
// all three keep their answers in `fillAnswers` (row-major for a table, in
// box order for a numeral), so persistence, the editing record and
// provenance see one shape: a list of strings.
//
// Blanks and tables normalise one thing, leading zeros: "0011" and "11" name
// the same binary numeral, and a student who pads is not wrong. Surrounding
// whitespace goes too. Everything else is compared literally — the answers
// are strings, not numbers, so "1010" stays a numeral and never becomes one
// thousand and ten. A numeral normalises only what its rule says (see
// `gradeInventedNumeral`).

import type { FillInCaseResult, FillInSpec } from '../types';

/** How big a box is drawn, from what goes in it — never from a key (a
 *  student's copy has none): a plain `blank` (today's box), a one-character
 *  `symbol` (compact, large type — punctuation and emoji must be legible) or
 *  a `short` numeral. */
export type FillInFieldSize = 'blank' | 'symbol' | 'short';

/** One blank of a fill-in spec, as the student panel and the creator see it. */
export interface FillInBlank {
  label: string;
  /** Only digits may be typed into this blank. */
  digitsOnly: boolean;
  size: FillInFieldSize;
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

/** An invented numeral system (task 080), as the student panel, the grader
 *  and the creator see it: the base and the numbers as authored, and every
 *  box in answer order — `fillAnswers[i]` is `blanks[i]`. A symbol box per
 *  digit comes first (labelled by its value in words, sized `symbol`), then a
 *  box per number (its authored label, sized `short`). A base that is not a
 *  whole number from 2 to `FILL_IN_NUMERAL_MAX_BASE` draws no symbol box
 *  (`fillInKeyProblem` names it). */
export interface FillInNumeralShape {
  kind: 'numeral';
  base: number;
  numbers: { value: number; label: string }[];
  blanks: FillInBlank[];
}

export type FillInShape = { kind: 'blanks'; blanks: FillInBlank[] } | FillInTableShape | FillInNumeralShape;

/** The most rows a table gives students. Rendering and grading both work
 *  row by row, so an authored count past this (a typo in the creator's
 *  rows field) would stall the server's grader and the student's panel:
 *  `fillInKeyProblem` and the creator's `fillInTableDefects` refuse it, and
 *  `fillInShape` never renders more. */
export const FILL_IN_TABLE_MAX_ROWS = 100;

/** The largest base an invented numeral may have — as far as its symbol
 *  boxes have names ("zero" … "fifteen"). */
export const FILL_IN_NUMERAL_MAX_BASE = 16;

const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
  'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
];

/** A digit's value in words ("zero" … "fifteen"); past them, its numeral. */
export function numberWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

/** Whether `base` is one an invented numeral may have: whole, 2 to 16. */
function isNumeralBase(base: number): boolean {
  return Number.isInteger(base) && base >= 2 && base <= FILL_IN_NUMERAL_MAX_BASE;
}

/** `value`'s digits in `base`, most significant first (0 → [0]). */
export function numeralDigits(value: number, base: number): number[] {
  const digits: number[] = [];
  let v = value;
  do {
    digits.unshift(v % base);
    v = Math.floor(v / base);
  } while (v > 0);
  return digits;
}

/** Box i's digits-only flag: `true` locks every box, an array locks box i
 *  iff its entry i is `true` — an array is truthy, so nothing may test it
 *  bare. The ONE reader of `numericOnly` (a pipelineCheck grep pin). */
function digitsOnlyAt(spec: FillInSpec, i: number): boolean {
  const n = spec.numericOnly;
  return Array.isArray(n) ? n[i] === true : n === true;
}

/** The spec's shape — the ONE reader of `labels`, `table`, `numeral` and
 *  `numericOnly`. A present `table` wins, then a `numeral`; `numericOnly` is
 *  per table column in a table, per blank in blanks, and means nothing to a
 *  numeral (its symbols are anything but digits). A row count below 1 (or
 *  not a number) renders no rows, one past `FILL_IN_TABLE_MAX_ROWS` renders
 *  that many (`fillInKeyProblem` names both). */
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
  const n = spec.numeral;
  if (n) {
    const base = n.base;
    const numbers = (n.numbers ?? []).map(({ value, label }) => ({ value, label }));
    return {
      kind: 'numeral',
      base,
      numbers,
      blanks: [
        ...Array.from({ length: isNumeralBase(base) ? base : 0 }, (_, i): FillInBlank =>
          ({ label: numberWord(i), digitsOnly: false, size: 'symbol' })),
        ...numbers.map(({ label }): FillInBlank => ({ label, digitsOnly: false, size: 'short' })),
      ],
    };
  }
  return {
    kind: 'blanks',
    blanks: (spec.labels ?? []).map((label, i) => ({ label, digitsOnly: digitsOnlyAt(spec, i), size: 'blank' })),
  };
}

/** The spec's plain blanks, in order ([] for a table or a numeral — whose
 *  boxes are not key-matched blanks: the creator must never draft them as
 *  such). */
export function fillInBlanks(spec: FillInSpec): FillInBlank[] {
  const shape = fillInShape(spec);
  return shape.kind === 'blanks' ? shape.blanks : [];
}

/** How many cases the question is graded on — the N of its ½ rule: one per
 *  blank, one per box of a numeral (its symbols and its numbers; no key, so
 *  a student's copy counts alike), or one per KEY row of a table (never its
 *  cells, columns, or the rows students see). A student's copy has no key,
 *  so its table counts 0. */
export function fillInCaseCount(spec: FillInSpec | undefined, key: readonly string[] | undefined): number {
  if (!spec) return 0;
  const shape = fillInShape(spec);
  if (shape.kind !== 'table') return shape.blanks.length;
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
 *  "blank" otherwise — a numeral's boxes too (and when the spec is unknown). */
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

/** A REVIEW table (task 048): a table authored with no key at all — the
 *  student fills it and a person grades it (the grader returns it pending).
 *  Authoring-side only: a student's copy has no key, so to it every table
 *  would look like one — never ask this of a student's copy. */
export function isReviewTable(spec: FillInSpec | undefined, key: readonly string[] | undefined): boolean {
  return spec !== undefined && fillInShape(spec).kind === 'table' && (key?.length ?? 0) === 0;
}

/** Why this spec and key cannot be graded, or null when they can. The grader
 *  skips with this reason; `problemSet.ts validateDocument` reports it
 *  (authoring-side — a student's copy has no key). Blanks need a key cell
 *  per blank. A numeral needs a whole base from 2 to
 *  `FILL_IN_NUMERAL_MAX_BASE`, at least one number, each a whole number ≥ 0
 *  with its own non-empty label — and NO key (its rule is the key). A table
 *  needs ≥ 2 columns, 1 ≤ argColumns < columns, a whole row count from 1 to
 *  `FILL_IN_TABLE_MAX_ROWS`, and a key of whole rows — none at all (a review
 *  table, graded by hand), or no more than students get, no empty cell, and
 *  no two with the same arguments (a function's table lists each argument
 *  once). */
export function fillInKeyProblem(spec: FillInSpec, key: readonly string[]): string | null {
  const shape = fillInShape(spec);
  if (shape.kind === 'blanks') {
    return shape.blanks.length === 0 || key.length !== shape.blanks.length
      ? 'fill-in question has no answer key'
      : null;
  }
  if (shape.kind === 'numeral') return numeralProblem(shape, key);
  const c = shape.columns.length;
  const a = shape.argColumns;
  const rows = spec.table!.rows;
  if (c < 2) return 'fill-in table needs at least two columns (an argument and a value)';
  if (!Number.isInteger(a) || a < 1 || a >= c) {
    return `fill-in table needs 1 to ${c - 1} argument columns, not ${a}`;
  }
  if (!Number.isInteger(rows) || rows < 1) return `fill-in table needs a whole, positive row count, not ${rows}`;
  if (rows > FILL_IN_TABLE_MAX_ROWS) {
    return `fill-in table gives students ${rows} rows, but the most it may give is ${FILL_IN_TABLE_MAX_ROWS}`;
  }
  if (key.length === 0) return null; // a review table (isReviewTable)
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

/** `fillInKeyProblem` for a numeral (see there). */
function numeralProblem(shape: FillInNumeralShape, key: readonly string[]): string | null {
  const { base, numbers } = shape;
  if (!isNumeralBase(base)) {
    return `invented-numeral question needs a whole base from 2 to ${FILL_IN_NUMERAL_MAX_BASE}, not ${base}`;
  }
  if (numbers.length === 0) return 'invented-numeral question needs at least one number to write';
  const firstWithLabel = new Map<string, number>();
  for (const [j, { value, label }] of numbers.entries()) {
    if (!Number.isSafeInteger(value) || value < 0) {
      return `invented-numeral question's number #${j + 1} must be a whole number, 0 or more, not ${value}`;
    }
    const name = typeof label === 'string' ? label.trim() : '';
    if (name === '') return `invented-numeral question's number #${j + 1} needs a label`;
    const first = firstWithLabel.get(name);
    if (first !== undefined) {
      return `invented-numeral question's numbers #${first + 1} and #${j + 1} have the same label "${name}"`;
    }
    firstWithLabel.set(name, j);
  }
  if (key.length > 0) return "an invented-numeral question takes no answer key (the student's own symbols are the key)";
  return null;
}

/** One result per case, in the key's order (a numeral's: its boxes' order).
 *  Blanks: missing answers (a shorter array, or a blank the student left
 *  empty) fail rather than being skipped. A table: see `gradeFillInTable`; a
 *  numeral: `gradeInventedNumeral`. Call only when `fillInKeyProblem` is
 *  null. */
export function gradeFillIn(
  spec: FillInSpec,
  answers: readonly string[],
  given: readonly string[] | undefined,
): FillInCaseResult[] {
  const shape = fillInShape(spec);
  if (shape.kind === 'table') return gradeFillInTable(shape, answers, given ?? []);
  // Before the blanks map: a numeral has `blanks` too, but no key to match.
  if (shape.kind === 'numeral') return gradeInventedNumeral(shape, given ?? []);
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

/** Grapheme segmentation, made once on first use (every modern browser and
 *  Node has it; where one does not, code points stand in — an emoji built
 *  of several would then count as several). */
let graphemes: Intl.Segmenter | null | undefined;

/** How many user-perceived characters `text` is: "👍🏽" and "👨‍👩‍👧" are one. */
function graphemeCount(text: string): number {
  if (graphemes === undefined) {
    graphemes = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;
  }
  if (!graphemes) return Array.from(text).length;
  let n = 0;
  for (const _ of graphemes.segment(text)) n++;
  return n;
}

/**
 * Whether a symbol is an existing digit dressed up: its compatibility form
 * (NFKD — fullwidth ５, circled ⑤, superscript ⁵, mathematical 𝟓 all fold to
 * a plain digit) with every mark and invisible stripped (the keycap in 5️⃣,
 * the variation selector in 5️, the accent in 5́) holds a decimal digit of
 * any script. Any script, not just 0–9: an Arabic-Indic ٥ is the digit five
 * too, not a new symbol for it.
 */
function isDigitSymbol(symbol: string): boolean {
  const base = symbol.normalize('NFKD').replace(/[\p{M}\p{Default_Ignorable_Code_Point}]/gu, '');
  return /\p{Nd}/u.test(base);
}

/**
 * An invented numeral system graded by rule (task 080) — against the
 * student's OWN symbols, since no fixed key can exist. One case per box, in
 * box order; the shape's base is sound (`fillInKeyProblem` is null).
 *
 * Symbol i ("symbol for two"): surrounding whitespace trimmed, then NFC. It
 * passes iff it is exactly ONE character — one grapheme, so an emoji with a
 * skin tone or a ZWJ family counts as one — is not a digit (`isDigitSymbol`:
 * no 0–9 in disguise — keycap 5️⃣, fullwidth ５, 5 with an accent or a
 * variation selector — nor another script's digit), and no other symbol is
 * the same (case matters: "a" and "A" are two characters; a repeat fails
 * every copy — the system could not be read). Only the digit test folds; the
 * sameness test and the numeral compare the NFC text as typed, a variation
 * selector part of the character.
 *
 * Number j (its label, "thirty-two"): every whitespace removed, then NFC. It
 * passes iff it is not empty, every symbol its base-b digits use is sound,
 * and it equals those symbols in order (32 in base 6: the symbol for five,
 * then the symbol for two) — joined first and normalised as a whole, so a
 * combining mark composes as the student typed it. A number whose symbols
 * are unsound fails whatever it says: there is no numeral to write.
 *
 * `expected` is the rule's own words for a symbol, the student's spelling for
 * a number ('' when a symbol it needs is unsound); `got` what was checked;
 * `reason` why a case failed. All three are instructor-only (sanitize.ts).
 */
function gradeInventedNumeral(shape: FillInNumeralShape, given: readonly string[]): FillInCaseResult[] {
  const b = shape.base;
  const raw = Array.from({ length: b }, (_, i) => (given[i] ?? '').trim());
  const symbols = raw.map((x) => x.normalize('NFC'));
  const symbolName = (d: number) => `symbol for ${numberWord(d)}`;
  const symbolFault = (i: number): string | null => {
    const s = symbols[i];
    if (s === '') return 'is empty';
    const chars = graphemeCount(s);
    if (chars !== 1) return `is ${chars} characters`;
    if (isDigitSymbol(s)) return 'is a digit';
    const twin = symbols.findIndex((x, k) => k !== i && x === s);
    return twin >= 0 ? `repeats the ${symbolName(twin)}` : null;
  };
  const faults = symbols.map((_, i) => symbolFault(i));

  const symbolCases = symbols.map((s, i): FillInCaseResult => {
    const fault = faults[i];
    return {
      label: symbolName(i),
      expected: 'a new symbol',
      got: s,
      pass: fault === null,
      ...(fault ? { reason: fault } : {}),
    };
  });
  const numberCases = shape.numbers.map(({ value, label }, j): FillInCaseResult => {
    const digits = numeralDigits(value, b);
    const got = (given[b + j] ?? '').replace(/\s+/g, '').normalize('NFC');
    const unsound = digits.find((d) => faults[d] !== null);
    const expected = unsound === undefined ? digits.map((d) => raw[d]).join('').normalize('NFC') : '';
    const reason =
      unsound !== undefined ? `uses the invalid ${symbolName(unsound)}`
        : got === '' ? 'is empty'
          : got !== expected
            ? digits.length === 1
              ? `is not your ${symbolName(digits[0])}`
              : `is not your ${digits.map(numberWord).join(' then ')}`
            : null;
    return { label: label.trim(), expected, got, pass: reason === null, ...(reason ? { reason } : {}) };
  });
  return [...symbolCases, ...numberCases];
}
