// Pure string-builders for the SC/FSM Input/Output rows and the A/V ARG
// cell, kept out of the JSX so headless checks (tools/scWindowCheck.ts and
// scratch harnesses) can pin them. outputDisplayString pins the display
// DIRECTION: time flows right-to-left in SC and FSM tables — t1 on the right,
// later steps extend left (docs/buildout/VISUAL_VOCAB.md; CLAUDE.md design
// rules). Concatenated this way, a question run's OUT string reads as a
// NUMERAL (MSB left, the t1/LSB step rightmost) — the same way the typed IN
// string is parsed for question runs (binary "110" = 6; tally "110" = 2).

import type { AssignmentQuestion } from '../types';

/**
 * Concatenate a run history's per-step output bits t-DESCENDING (latest step
 * leftmost, t1 rightmost). Entries may arrive in any order; SC passes each
 * step's per-wire `outputBits`, FSM its single output bit.
 */
export function outputDisplayString(
  history: ReadonlyArray<{ t: number; bits: number[] }>,
): string {
  return history
    .slice()
    .sort((a, b) => b.t - a.t)
    .map((h) => h.bits.join(''))
    .join('');
}

/**
 * How many input groups the A/V ARG cell should split the typed string into,
 * or null for the classic whole-string read (sandbox, non-SC questions, or a
 * machine whose INPUT count doesn't match the question spec — exactly the
 * cases where the store's codec feed falls back to raw typed bits, see
 * codecInputSteps in store.ts).
 */
export function argGroupCountFor(
  question: Pick<AssignmentQuestion, 'buildMode' | 'cc_spec'> | undefined,
  machineInputCount: number,
): number | null {
  if (question?.buildMode !== 'SC' || !question.cc_spec) return null;
  const groups = question.cc_spec.inputs.length;
  return machineInputCount === groups ? groups : null;
}

/**
 * The A/V ARG cell text for a question run's typed input string.
 *
 * Multi-group questions (hw3-p9's x + y) INTERLEAVE the typed string — one
 * char per input group per time step, rightmost chunk = t1, char i of a chunk
 * = group i (exactly the chunking loadScGlobalSequence applies before the
 * run) — so reading the whole string as one numeral is wrong: typed "111101"
 * (x=2, y=3, tally) is not a tally codeword and showed '/'. Group i's
 * display-order numeral is char i of each chunk, left-to-right; each group is
 * read by the caller's numeral reader (the same bitsToTally/bitsToBinary
 * parse the store's codec feed uses) and the values join as "2, 3". If ANY
 * group is not a valid numeral the typed string denotes no value — the run
 * falls back to raw typed bits — so the whole cell flags '/' exactly as
 * before. Trailing chars beyond a whole chunk are dropped, as the run's own
 * parse drops them.
 *
 * Single-group questions (and a typed string shorter than one chunk) reduce
 * to the whole-string read, so their rendering is unchanged.
 */
export function argDisplayString(
  typedDigits: number[],
  numGroups: number,
  readNumeral: (digits: number[]) => string,
): string {
  const groups = Math.max(1, numGroups);
  const stepsCount = Math.floor(typedDigits.length / groups);
  if (groups === 1 || stepsCount === 0) return readNumeral(typedDigits);
  const parts: string[] = [];
  for (let i = 0; i < groups; i++) {
    const digits: number[] = [];
    for (let t = 0; t < stepsCount; t++) digits.push(typedDigits[t * groups + i]);
    const text = readNumeral(digits);
    if (text === '/') return '/';
    parts.push(text);
  }
  return parts.join(', ');
}
