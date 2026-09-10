// Fill-in-the-blank grading — a short list of numbered text answers, compared
// as strings (engine-pure: no React/DOM, same code in the browser and on the
// server). Outside the value codec: there is no machine to run, so nothing to
// encode or simulate.
//
// The one normalisation is leading zeros: "0011" and "11" name the same
// binary numeral, and a student who pads is not wrong. Surrounding whitespace
// goes too. Everything else is compared literally — the answers are strings,
// not numbers, so "1010" stays a numeral and never becomes one thousand and
// ten.

import type { FillInCaseResult, FillInSpec } from '../types';

/** Trim, then drop leading zeros while keeping at least one digit ("000" →
 *  "0", "0011" → "11", "" → ""). */
export function normalizeFillAnswer(raw: string): string {
  const trimmed = raw.trim();
  const stripped = trimmed.replace(/^0+/, '');
  return stripped === '' && trimmed !== '' ? '0' : stripped;
}

/** One result per blank, in the spec's order. Missing answers (a shorter
 *  array, or a blank the student left empty) fail rather than being skipped. */
export function gradeFillIn(
  spec: FillInSpec,
  answers: readonly string[],
  given: readonly string[] | undefined,
): FillInCaseResult[] {
  return spec.labels.map((label, i) => {
    const expected = normalizeFillAnswer(answers[i] ?? '');
    const got = normalizeFillAnswer(given?.[i] ?? '');
    return { label, expected, got, pass: got !== '' && got === expected };
  });
}
