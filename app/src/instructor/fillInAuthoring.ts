// Fill-in authoring (task 005; tables, task 079; numerals, task 080) — the
// pure half of the question creator's "Fill-in" task: pure functions, no
// React calls (its one borrowing, dragReorder.ts's `moveItem`, is pure too,
// though that module also holds a hook), like ccPreview.ts and
// arenaEditing.ts (FillInBlanksEditor.tsx, FillInTableEditor.tsx and
// FillInNumeralEditor.tsx are the widgets over it). A fill-in question is
// one of three shapes (engine/fillIn.ts `fillInShape`): labelled blanks, an
// argument–value table graded as a function, or an invented numeral system
// graded by rule.
//
// Blanks: the creator edits a list of blank DRAFTS, one row object per blank
// — label, digits-only flag and answer together — so adding, removing or
// reordering can never split a label from its answer. A table: ONE draft of
// its columns (header + digits-only flag), argument-column count, the rows
// students see, and the key rows, each cell parallel to the columns.
// `fillInFields` / `fillInTableFields` turn the drafts into the two saved
// fields, and are the ONE writers of `numericOnly` (engine/fillIn.ts
// `fillInShape` is the one reader). They write each field in a single
// canonical form, so a no-op edit of a hand-written question (HW1 P11, P14,
// P9b) reproduces it exactly and the homework sync still sees it as
// untouched. A numeral: ONE draft of its base and the numbers to write
// (value + label), saved by `fillInNumeralFields` with no key at all.
//
// Answers go ONLY into `fill_in_answers` (row-major for a table), never
// inside `fill_in`: the server strips `fill_in_answers` from a student's copy
// and keeps `fill_in` whole — the labels and headers ARE the prompts
// (server/src/sanitize.ts; law 1).

import type { AssignmentQuestion, FillInSpec } from '../types';
import {
  FILL_IN_NUMERAL_MAX_BASE,
  FILL_IN_TABLE_MAX_ROWS,
  fillInBlanks,
  fillInCaseCount,
  fillInRowLabel,
  fillInShape,
  normalizeFillAnswer,
} from '../engine/fillIn';
import { moveItem } from './dragReorder';

export interface FillInBlankDraft {
  /** The row's React key — a plain counter, never saved (and never a random
   *  id: provenanceCheck's uuid grep gate). */
  key: number;
  label: string;
  digitsOnly: boolean;
  answer: string;
}

let lastKey = 0;
const freshKey = (): number => ++lastKey;

/** The drafts of a saved question: one per blank, in order, with its answer.
 *  No fill-in spec (a new question, or a free-response one), or a table
 *  (`tableDraftOf`) → no blanks. */
export function blankDraftsOf(
  q: Pick<AssignmentQuestion, 'fill_in' | 'fill_in_answers'> | undefined,
): FillInBlankDraft[] {
  if (!q?.fill_in) return [];
  const answers = q.fill_in_answers ?? [];
  return fillInBlanks(q.fill_in).map((b, i) => ({
    key: freshKey(),
    label: b.label,
    digitsOnly: b.digitsOnly,
    answer: answers[i] ?? '',
  }));
}

/** A new blank for the end of the list: labelled with the smallest positive
 *  integer no blank uses yet (after HW1 P11's 0–10 that is "11"), digits-only
 *  iff the blank before it is — a list of numerals usually stays one. */
export function newBlankDraft(drafts: readonly FillInBlankDraft[]): FillInBlankDraft {
  const taken = new Set(drafts.map((d) => d.label.trim()));
  let n = 1;
  while (taken.has(String(n))) n++;
  return {
    key: freshKey(),
    label: String(n),
    digitsOnly: drafts[drafts.length - 1]?.digitsOnly ?? false,
    answer: '',
  };
}

/** One thing that blocks saving. `blank` is the 0-based row it belongs to
 *  (null = the list as a whole); `message` is a verb phrase about that row
 *  ("needs a label"), for the row itself or, prefixed, for a summary. */
export interface FillInDefect {
  blank: number | null;
  message: string;
}

/**
 * Everything that makes the drafts unsaveable. Each rule guards something the
 * student or the grader would otherwise hit:
 *  - no blanks: nothing to answer, and the grader skips an empty key;
 *  - an empty or repeated label: the student panel and the grade sheet name a
 *    blank by its label, so two blanks must never read the same;
 *  - an empty answer: the grader never passes an empty box, so no student
 *    could ever get that blank right;
 *  - a digits-only blank whose answer has another character: the student's
 *    box refuses that character, so the answer could never be typed.
 */
export function fillInDefects(drafts: readonly FillInBlankDraft[]): FillInDefect[] {
  if (drafts.length === 0) return [{ blank: null, message: 'Add at least one blank.' }];
  const out: FillInDefect[] = [];
  const firstWithLabel = new Map<string, number>();
  drafts.forEach((d, i) => {
    const label = d.label.trim();
    const answer = d.answer.trim();
    if (label === '') {
      out.push({ blank: i, message: 'needs a label' });
    } else if (firstWithLabel.has(label)) {
      out.push({ blank: i, message: `repeats the label "${label}" of blank #${firstWithLabel.get(label)! + 1}` });
    } else {
      firstWithLabel.set(label, i);
    }
    if (answer === '') {
      out.push({ blank: i, message: 'needs an answer' });
    } else if (d.digitsOnly && /\D/.test(answer)) {
      out.push({ blank: i, message: `is digits-only, but its answer "${answer}" has other characters` });
    }
  });
  return out;
}

/** The defects as sentences naming their blank ("Blank #3 needs a label.");
 *  empty = saveable. */
export function fillInProblems(drafts: readonly FillInBlankDraft[]): string[] {
  return fillInDefects(drafts).map((d) =>
    d.blank === null ? d.message : `Blank #${d.blank + 1} ${d.message}.`);
}

/**
 * The saved blanks whose students' answers an edit would misplace, by their
 * saved label, in saved order; empty = every answer already given still lines
 * up. A student's answers are stored by POSITION (store.ts setFillAnswer,
 * Worksheet, engine/fillIn.ts gradeFillIn) and nothing re-maps a saved
 * workbook or submission when the question changes, so slot k keeps its
 * answers only while the blank saved at k is still at k. `saved` are the
 * drafts the question opened with, `next` those about to be saved (none when
 * it stops being a fill-in question). A draft's `key` survives every edit and
 * move, so relabelling a blank, changing its answer or flag, or appending
 * blanks is safe; removing, reordering, or inserting before a saved blank
 * is not.
 */
export function misplacedBlanks(
  saved: readonly FillInBlankDraft[],
  next: readonly FillInBlankDraft[],
): string[] {
  return saved.filter((d, k) => next[k]?.key !== d.key).map((d) => d.label.trim());
}

/** What `misplacedBlanks` means for students, as one sentence for the
 *  creator's warning and its save confirmation. */
export function misplacedAnswersWarning(labels: readonly string[]): string {
  const shown = labels.slice(0, 5).map((l) => `"${l}"`).join(', ');
  const more = labels.length > 5 ? ` and ${labels.length - 5} more` : '';
  const which = `blank${labels.length === 1 ? '' : 's'} ${shown}${more}`;
  return (
    `Answers students have already given to ${which} will now sit beside a different ` +
    `blank, or be dropped, and be graded there. ` +
    `Relabel blanks in place and add new ones at the end to keep those answers lined up.`
  );
}

/**
 * The saved fields, parallel arrays in row order: the trimmed labels (the
 * spec students see) and the trimmed answers (the key the server strips).
 * `numericOnly` takes one canonical form — every blank digits-only → `true`
 * (HW1 P11's shape), none → the key is omitted, a mix → one flag per blank.
 */
export function fillInFields(
  drafts: readonly FillInBlankDraft[],
): Required<Pick<AssignmentQuestion, 'fill_in' | 'fill_in_answers'>> {
  const numericOnly = canonicalNumericOnly(drafts.map((d) => d.digitsOnly));
  const fill_in: FillInSpec = {
    labels: drafts.map((d) => d.label.trim()),
    ...(numericOnly !== undefined ? { numericOnly } : {}),
  };
  return { fill_in, fill_in_answers: drafts.map((d) => d.answer.trim()) };
}

/** `numericOnly`'s one canonical form, per box (a blank or a table column):
 *  every box digits-only → `true`, none → absent, a mix → one flag per box. */
function canonicalNumericOnly(flags: readonly boolean[]): FillInSpec['numericOnly'] {
  return flags.length > 0 && flags.every(Boolean) ? true : flags.some(Boolean) ? [...flags] : undefined;
}

// ── A fill-in TABLE (task 079) ─────────────────────────────────────────────

export interface FillInTableColumnDraft {
  /** React key — a counter, never saved (see FillInBlankDraft.key). It also
   *  names the column across edits, so `misplacedTableWarning` can tell a
   *  renamed column from a moved one. */
  key: number;
  header: string;
  digitsOnly: boolean;
}

export interface FillInTableKeyRowDraft {
  key: number;
  /** One cell per column, parallel to `FillInTableDraft.columns`. */
  cells: string[];
}

export interface FillInTableDraft {
  columns: FillInTableColumnDraft[];
  /** How many leading columns are arguments. */
  argColumns: number;
  /** The rows students see, as typed; '' = as many as the key has. */
  rows: string;
  keyRows: FillInTableKeyRowDraft[];
}

/** The table draft of a saved question — null unless its shape is a table.
 *  The key's row-major cells are cut into rows of the column count. */
export function tableDraftOf(
  q: Pick<AssignmentQuestion, 'fill_in' | 'fill_in_answers'> | undefined,
): FillInTableDraft | null {
  if (!q?.fill_in) return null;
  const shape = fillInShape(q.fill_in);
  if (shape.kind !== 'table') return null;
  const key = q.fill_in_answers ?? [];
  const c = shape.columns.length;
  return {
    columns: shape.columns.map((col) => ({ key: freshKey(), header: col.header, digitsOnly: col.digitsOnly })),
    argColumns: shape.argColumns,
    rows: String(shape.rows),
    keyRows: Array.from({ length: c > 0 ? Math.ceil(key.length / c) : 0 }, (_, r) => ({
      key: freshKey(),
      cells: shape.columns.map((_, j) => key[r * c + j] ?? ''),
    })),
  };
}

/** A new table: Argument | Value, one argument column, one empty key row,
 *  and as many rows for students as the key has until the author says. */
export function newTableDraft(): FillInTableDraft {
  return {
    columns: [
      { key: freshKey(), header: 'Argument', digitsOnly: false },
      { key: freshKey(), header: 'Value', digitsOnly: false },
    ],
    argColumns: 1,
    rows: '',
    keyRows: [{ key: freshKey(), cells: ['', ''] }],
  };
}

/** The rows students will see: the typed count, or the key's rows when the
 *  field is blank (NaN when it is not a number — a defect). */
export function tableRowCount(draft: FillInTableDraft): number {
  const raw = draft.rows.trim();
  return raw === '' ? draft.keyRows.length : Number(raw);
}

/** A new empty key row, one cell per column. */
export function newTableKeyRow(draft: FillInTableDraft): FillInTableKeyRowDraft {
  return { key: freshKey(), cells: draft.columns.map(() => '') };
}

/** A column appended on the right (a value column), digits-only iff the last
 *  one is, with an empty cell in every key row. */
export function addTableColumn(draft: FillInTableDraft): FillInTableDraft {
  const last = draft.columns[draft.columns.length - 1];
  return {
    ...draft,
    columns: [...draft.columns, { key: freshKey(), header: '', digitsOnly: last?.digitsOnly ?? false }],
    keyRows: draft.keyRows.map((r) => ({ ...r, cells: [...r.cells, ''] })),
  };
}

/** Column j removed with its key cells; the argument count shrinks with an
 *  argument column and stays within 1…C−1. */
export function removeTableColumn(draft: FillInTableDraft, j: number): FillInTableDraft {
  const columns = draft.columns.filter((_, i) => i !== j);
  const args = j < draft.argColumns ? draft.argColumns - 1 : draft.argColumns;
  return {
    ...draft,
    columns,
    argColumns: Math.max(1, Math.min(args, columns.length - 1)),
    keyRows: draft.keyRows.map((r) => ({ ...r, cells: r.cells.filter((_, i) => i !== j) })),
  };
}

/** Column `from` moved to `to`, its key cells with it (the argument count
 *  stays: a column moved across the boundary changes role). */
export function moveTableColumn(draft: FillInTableDraft, from: number, to: number): FillInTableDraft {
  return {
    ...draft,
    columns: moveItem(draft.columns, from, to),
    keyRows: draft.keyRows.map((r) => ({ ...r, cells: moveItem(r.cells, from, to) })),
  };
}

/** One thing that blocks saving a table: `column` / `keyRow` is the 0-based
 *  one it belongs to (both null = the table as a whole); `message` is a verb
 *  phrase about it, or a sentence for the whole table. */
export interface FillInTableDefect {
  column: number | null;
  keyRow: number | null;
  message: string;
}

/**
 * Everything that makes a table draft unsaveable — each rule guards
 * something the student or the grader would otherwise hit
 * (engine/fillIn.ts `fillInKeyProblem` refuses the same key):
 *  - fewer than two columns, or an argument count outside 1…C−1: there is
 *    no argument, or no value, to grade;
 *  - an empty or repeated header: the student's table names its columns;
 *  (No key row at all is sound: a REVIEW table, graded by hand — task 048,
 *  engine/fillIn.ts isReviewTable. Its row count must then be typed.)
 *  - a rows count that is not a whole number ≥ 1, or fewer rows than the key
 *    has: the student could never write the whole function;
 *  - more than `FILL_IN_TABLE_MAX_ROWS` rows (typed, or a key that long):
 *    the panel and the grader work row by row, so a typo would stall both;
 *  - an empty key cell: no student row could ever match it;
 *  - letters in a digits-only column's key cell: the student's cell refuses
 *    them, so the row could never be typed;
 *  - two key rows with the same arguments: a function's table lists each
 *    argument once, and no student row could pass both.
 */
export function fillInTableDefects(draft: FillInTableDraft): FillInTableDefect[] {
  const out: FillInTableDefect[] = [];
  const whole = (message: string) => out.push({ column: null, keyRow: null, message });
  const c = draft.columns.length;
  const a = draft.argColumns;
  if (c < 2) whole('Give the table at least two columns (an argument and a value).');
  else if (!Number.isInteger(a) || a < 1 || a >= c) whole(`Make 1 to ${c - 1} of the columns arguments.`);
  const firstWithHeader = new Map<string, number>();
  draft.columns.forEach((col, j) => {
    const header = col.header.trim();
    if (header === '') {
      out.push({ column: j, keyRow: null, message: 'needs a header' });
    } else if (firstWithHeader.has(header)) {
      out.push({ column: j, keyRow: null, message: `repeats the header "${header}" of column #${firstWithHeader.get(header)! + 1}` });
    } else {
      firstWithHeader.set(header, j);
    }
  });
  const rows = tableRowCount(draft);
  if (!Number.isInteger(rows) || rows < 1) {
    whole('The rows students see must be a whole number, at least 1.');
  } else if (rows > FILL_IN_TABLE_MAX_ROWS) {
    whole(draft.keyRows.length > FILL_IN_TABLE_MAX_ROWS
      ? `A table's key can have at most ${FILL_IN_TABLE_MAX_ROWS} rows.`
      : `The rows students see can be at most ${FILL_IN_TABLE_MAX_ROWS}.`);
  } else if (rows < draft.keyRows.length) {
    whole(`Students need at least ${draft.keyRows.length} rows (one for each key row).`);
  }
  const firstWithArgs = new Map<string, number>();
  draft.keyRows.forEach((row, r) => {
    let complete = true;
    draft.columns.forEach((col, j) => {
      const cell = (row.cells[j] ?? '').trim();
      const name = col.header.trim() || `column #${j + 1}`;
      if (cell === '') {
        complete = false;
        out.push({ column: null, keyRow: r, message: `needs a "${name}" cell` });
      } else if (col.digitsOnly && /\D/.test(cell)) {
        out.push({ column: null, keyRow: r, message: `has "${cell}" in the digits-only "${name}" column` });
      }
    });
    if (!complete || a < 1) return;
    const args = row.cells.slice(0, a).map((x) => x.trim());
    const id = JSON.stringify(args.map(normalizeFillAnswer));
    const first = firstWithArgs.get(id);
    if (first !== undefined) {
      out.push({ column: null, keyRow: r, message: `repeats the arguments ${fillInRowLabel(args)} of key row #${first + 1}` });
    } else {
      firstWithArgs.set(id, r);
    }
  });
  return out;
}

/** The defects as sentences naming their column or key row ("Column #2
 *  needs a header."); empty = saveable. */
export function fillInTableProblems(draft: FillInTableDraft): string[] {
  return fillInTableDefects(draft).map((d) =>
    d.column !== null ? `Column #${d.column + 1} ${d.message}.`
      : d.keyRow !== null ? `Key row #${d.keyRow + 1} ${d.message}.`
        : d.message);
}

/**
 * What an edit would do to the answers students have already given in the
 * table this question was saved with, as one sentence for the creator's
 * warning and its save confirmation — or null when every such answer still
 * reads as it did. Answers are stored cell by cell, ROW-MAJOR (store.ts
 * setFillAnswer, Worksheet, engine/fillIn.ts), and nothing re-maps a saved
 * workbook or submission, so they survive only while the saved columns keep
 * their sequence (a draft's `key` survives renames and flag changes) and no
 * saved row is taken away. Grading is order-free, so editing, adding or
 * removing KEY rows, or giving students more rows, misplaces nothing.
 * `saved` is the table the question opened with (null: none); `next` the one
 * about to be saved (null: it stops being a table).
 */
export function misplacedTableWarning(
  saved: FillInTableDraft | null,
  next: FillInTableDraft | null,
): string | null {
  if (!saved) return null;
  const lead = 'Answers students have already given in the table';
  if (!next) {
    return `${lead} will be read as something else, or dropped. Keep the question a table to keep them.`;
  }
  const sameColumns =
    saved.columns.length === next.columns.length && saved.columns.every((col, j) => next.columns[j].key === col.key);
  if (!sameColumns) {
    return `${lead} will shift into other columns. To keep them lined up, rename columns in place ` +
      `instead of adding, removing or reordering them.`;
  }
  const savedRows = tableRowCount(saved);
  const nextRows = tableRowCount(next);
  if (nextRows < savedRows) {
    return `${lead} past row ${nextRows} will be dropped. Students saw ${savedRows} rows. ` +
      `Keep at least ${savedRows} to keep them.`;
  }
  return null;
}

/**
 * The saved fields: the table's layout (trimmed headers, the argument count,
 * the rows students see — the spec students get, no key cell in it) and the
 * key, row-major and trimmed (the bank the server strips). `numericOnly`
 * takes the blanks' canonical form, per column.
 */
export function fillInTableFields(
  draft: FillInTableDraft,
): Required<Pick<AssignmentQuestion, 'fill_in' | 'fill_in_answers'>> {
  const numericOnly = canonicalNumericOnly(draft.columns.map((col) => col.digitsOnly));
  const fill_in: FillInSpec = {
    table: {
      columns: draft.columns.map((col) => col.header.trim()),
      argColumns: draft.argColumns,
      rows: tableRowCount(draft),
    },
    ...(numericOnly !== undefined ? { numericOnly } : {}),
  };
  return {
    fill_in,
    fill_in_answers: draft.keyRows.flatMap((row) => draft.columns.map((_, j) => (row.cells[j] ?? '').trim())),
  };
}

// ── An invented NUMERAL system (task 080) ───────────────────────────────────

export interface FillInNumeralNumberDraft {
  /** React key — a counter, never saved (see FillInBlankDraft.key). It also
   *  names the number across edits, so `misplacedNumeralWarning` can tell a
   *  relabelled number from a moved one. */
  key: number;
  /** The number, as typed. */
  value: string;
  /** Its box's label ("thirty-two"). */
  label: string;
}

export interface FillInNumeralDraft {
  /** The base, as typed. */
  base: string;
  numbers: FillInNumeralNumberDraft[];
}

/** The numeral draft of a saved question — null unless its shape is a
 *  numeral. */
export function numeralDraftOf(
  q: Pick<AssignmentQuestion, 'fill_in'> | undefined,
): FillInNumeralDraft | null {
  if (!q?.fill_in) return null;
  const shape = fillInShape(q.fill_in);
  if (shape.kind !== 'numeral') return null;
  return {
    base: String(shape.base),
    numbers: shape.numbers.map((n) => ({ key: freshKey(), value: String(n.value), label: n.label })),
  };
}

/** A new number to write, empty. */
export function newNumeralNumber(): FillInNumeralNumberDraft {
  return { key: freshKey(), value: '', label: '' };
}

/** A new numeral: base 6 (HW1 P12's), one empty number to fill in. */
export function newNumeralDraft(): FillInNumeralDraft {
  return { base: '6', numbers: [newNumeralNumber()] };
}

/** One thing that blocks saving a numeral: `number` is the 0-based number it
 *  belongs to (null = the system as a whole); `message` is a verb phrase
 *  about that number, or a sentence for the whole. */
export interface FillInNumeralDefect {
  number: number | null;
  message: string;
}

/**
 * Everything that makes a numeral draft unsaveable — each rule guards
 * something the student or the grader would otherwise hit
 * (engine/fillIn.ts `fillInKeyProblem` refuses the same spec):
 *  - a base that is not a whole number from 2 to `FILL_IN_NUMERAL_MAX_BASE`:
 *    base 1 has no positional numerals, and past 16 the symbol boxes have
 *    no names;
 *  - no numbers: the system would never be used;
 *  - a value that is not a whole number ≥ 0: it has no numeral;
 *  - an empty or repeated label: the student's box and the grade sheet name
 *    a number by its label, so two must never read the same.
 */
export function fillInNumeralDefects(draft: FillInNumeralDraft): FillInNumeralDefect[] {
  const out: FillInNumeralDefect[] = [];
  const base = Number(draft.base.trim());
  if (draft.base.trim() === '' || !Number.isInteger(base) || base < 2 || base > FILL_IN_NUMERAL_MAX_BASE) {
    out.push({ number: null, message: `The base must be a whole number from 2 to ${FILL_IN_NUMERAL_MAX_BASE}.` });
  }
  if (draft.numbers.length === 0) out.push({ number: null, message: 'Add at least one number to write.' });
  const firstWithLabel = new Map<string, number>();
  draft.numbers.forEach((n, j) => {
    const raw = n.value.trim();
    const value = Number(raw);
    if (raw === '' || !Number.isSafeInteger(value) || value < 0) {
      out.push({ number: j, message: 'needs a value (a whole number, 0 or more)' });
    }
    const label = n.label.trim();
    if (label === '') {
      out.push({ number: j, message: 'needs a label' });
    } else if (firstWithLabel.has(label)) {
      out.push({ number: j, message: `repeats the label "${label}" of number #${firstWithLabel.get(label)! + 1}` });
    } else {
      firstWithLabel.set(label, j);
    }
  });
  return out;
}

/** The defects as sentences naming their number ("Number #2 needs a
 *  label."); empty = saveable. */
export function fillInNumeralProblems(draft: FillInNumeralDraft): string[] {
  return fillInNumeralDefects(draft).map((d) =>
    d.number === null ? d.message : `Number #${d.number + 1} ${d.message}.`);
}

/**
 * The saved field: `fill_in` holding the numeral alone — the base and each
 * number's value and trimmed label, in one canonical form (so a no-op edit
 * of HW1 P12 reproduces it exactly). No `fill_in_answers`: a numeral has no
 * key, and saving one would be refused (engine/fillIn.ts fillInKeyProblem).
 */
export function fillInNumeralFields(draft: FillInNumeralDraft): Required<Pick<AssignmentQuestion, 'fill_in'>> {
  return {
    fill_in: {
      numeral: {
        base: Number(draft.base.trim()),
        numbers: draft.numbers.map((n) => ({ value: Number(n.value.trim()), label: n.label.trim() })),
      },
    },
  };
}

/** How many cases the draft will be graded on — the N of its ½ rule: its
 *  symbols and its numbers (engine/fillIn.ts fillInCaseCount, the one
 *  count). */
export function numeralCaseCount(draft: FillInNumeralDraft): number {
  return fillInCaseCount(fillInNumeralFields(draft).fill_in, []);
}

/**
 * What an edit would do to the answers students have already given to the
 * numeral this question was saved with, as one sentence for the creator's
 * warning and its save confirmation — or null when every such answer still
 * reads as it did. Answers are stored BY POSITION — the symbols, then one
 * box per number (store.ts setFillAnswer, Worksheet, engine/fillIn.ts) — and
 * nothing re-maps a saved workbook or submission, so they survive only
 * while the base stays (it fixes how many symbols come first, and what they
 * mean) and every saved number keeps its slot (a draft's `key` survives a
 * relabel). Changing a number's value or label, or appending numbers, is
 * safe. `saved` is the numeral the question opened with (null: none);
 * `next` the one about to be saved (null: it stops being a numeral).
 */
export function misplacedNumeralWarning(
  saved: FillInNumeralDraft | null,
  next: FillInNumeralDraft | null,
): string | null {
  if (!saved) return null;
  const lead = 'Answers students have already given to the invented numeral';
  if (!next) {
    return `${lead} will be read as something else, or dropped. Keep the question a numeral to keep them.`;
  }
  if (Number(saved.base.trim()) !== Number(next.base.trim())) {
    return `${lead} will shift. Changing the base moves every symbol and number answer. ` +
      `Keep the base to keep them lined up.`;
  }
  const moved = saved.numbers.filter((n, k) => next.numbers[k]?.key !== n.key).map((n) => `"${n.label.trim()}"`);
  if (moved.length > 0) {
    return `${lead} for ${moved.join(', ')} will now sit beside a different number, or be dropped. ` +
      `Relabel numbers in place and add new ones at the end.`;
  }
  return null;
}
