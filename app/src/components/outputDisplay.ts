// Pure string-builder for the SC/FSM Input/Output rows, kept out of the JSX
// so the headless contract check (tools/scWindowCheck.ts) can pin the display
// DIRECTION: time flows right-to-left in SC and FSM tables — t1 on the right,
// later steps extend left (docs/buildout/VISUAL_VOCAB.md; CLAUDE.md design
// rules). Concatenated this way, a question run's OUT string reads as a
// NUMERAL (MSB left, the t1/LSB step rightmost) — the same way the typed IN
// string is parsed for question runs (binary "110" = 6; tally "110" = 2).

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
