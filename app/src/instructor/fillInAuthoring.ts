// Fill-in-the-blank authoring (task 005) — the pure half of the question
// creator's "Fill-in blanks" task, React-free like ccPreview.ts and
// arenaEditing.ts (FillInBlanksEditor.tsx is the widget over it).
//
// The creator edits a list of blank DRAFTS, one row object per blank —
// label, digits-only flag and answer together — so adding, removing or
// reordering can never split a label from its answer. `fillInFields` turns
// the drafts into the two saved fields, and is the ONE writer of
// `numericOnly` (engine/fillIn.ts `fillInBlanks` is the one reader). It
// writes each field in a single canonical form, so a no-op edit of a
// hand-written question (HW1 P11) reproduces it exactly and the homework
// sync still sees it as untouched.
//
// Answers go ONLY into `fill_in_answers`, never inside `fill_in`: the server
// strips `fill_in_answers` from a student's copy and keeps `fill_in` whole —
// the labels ARE the prompts (server/src/sanitize.ts; law 1).

import type { AssignmentQuestion, FillInSpec } from '../types';
import { fillInBlanks } from '../engine/fillIn';

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
 *  No fill-in spec (a new question, or a free-response one) → no blanks. */
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
 * FillInPanel, engine/fillIn.ts gradeFillIn) and nothing re-maps a saved
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
    `blank, or be dropped, and be graded there — answers match blanks by position. ` +
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
  const flags = drafts.map((d) => d.digitsOnly);
  const numericOnly =
    flags.length > 0 && flags.every(Boolean) ? true : flags.some(Boolean) ? flags : undefined;
  const fill_in: FillInSpec = {
    labels: drafts.map((d) => d.label.trim()),
    ...(numericOnly !== undefined ? { numericOnly } : {}),
  };
  return { fill_in, fill_in_answers: drafts.map((d) => d.answer.trim()) };
}
