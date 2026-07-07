// TM codec — the `tape` axis of the codec pipeline (module 3 of
// CLAUDE_KB/engines/tm.md; the `tape`-axis delegation of CLAUDE_KB/pipeline/
// codec.md).
//
// Framework-agnostic: no React, no Zustand, no DOM. Three pieces:
//   encodeTM  — value list → standard-position TMTape (codec encodeInput, tape axis)
//   acceptTM  — halted + exactly one well-formed output block + optional standard
//               halt position (the mode-level acceptor)
//   decodeTM  — TOTAL value decode of an ACCEPTED tape (codec decodeOutput)
//
// The accept/decode split mirrors the codec: validity is checked before
// decoding, and `decodeTM` is total — it assumes `acceptTM` already passed.
// `*` is born here (encode) and consumed here (decode); it never escapes the
// tape, so the numeric TestCase bank stays mode-agnostic.

import type { TMNotation, TMSymbol, TMTape } from '../types';
import type { TMEvalResult } from './tm';

/** A rejected output (well-formedness / halt / standard-position failure). */
export interface TMReject {
  reason: string;
}

export interface AcceptOptions {
  /** Condition (4): require the head to rest on the rightmost cell of the
   *  output block at halt. Default off; exact semantics TBD with the first TM
   *  assignments (CLAUDE_KB/engines/tm.md). */
  requireStandardHaltPosition?: boolean;
}

// ── encode ─────────────────────────────────────────────────────────

/**
 * Encode input *values* as a standard-layout tape with the head in standard
 * position (the rightmost cell of the rightmost input's block).
 *
 * Layout: input blocks left-to-right, consecutive inputs separated by
 * background `'0'`s (unstored — the tape is sparse), background `'0'`s outside.
 *   - Unary: value `n>0` → a run of `n` `'1'`s; value `0` → a single (unstored)
 *     `'0'` slot.
 *   - Binary: value → `'*'` + binary digits (MSB-first) + `'*'`; value `0` → `*0*`.
 *
 * `separations` (optional, from `TestCase.separations`) is the gap AFTER each
 * block except the last — for two inputs, one entry. Absent entries default to
 * the standard single-cell separator; entries are clamped to >= 1 (a gap of 0
 * would merge adjacent blocks into an unreadable layout).
 */
export function encodeTM(notation: TMNotation, values: number[], separations?: number[]): TMTape {
  const cells: Record<number, TMSymbol> = {};
  let pos = 0;
  let head = 0;

  values.forEach((value, i) => {
    if (i > 0) pos += Math.max(1, Math.trunc(separations?.[i - 1] ?? 1)); // '0' separator run (unstored)

    if (notation === 'unary') {
      const n = Math.max(0, Math.trunc(value));
      if (n > 0) {
        for (let k = 0; k < n; k++) cells[pos++] = '1';
        head = pos - 1; // rightmost '1' of this block
      } else {
        head = pos; // the single unstored '0' slot
        pos += 1;
      }
    } else {
      // binary: *d_k…d_0*
      cells[pos++] = '*';
      const digits = Math.max(0, Math.trunc(value)).toString(2); // MSB-first, '0' → "0"
      for (const d of digits) {
        if (d === '1') cells[pos] = '1';
        pos += 1;
      }
      cells[pos] = '*';
      head = pos; // closing '*'
      pos += 1;
    }
  });

  return { cells, head };
}

// ── shared scanning ────────────────────────────────────────────────

/** Sorted indices of cells holding a given symbol. */
function indicesOf(tape: TMTape, symbol: TMSymbol): number[] {
  return Object.keys(tape.cells)
    .map(Number)
    .filter((i) => tape.cells[i] === symbol)
    .sort((a, b) => a - b);
}

/** Contiguous runs of `'1'` cells, as [start, end] index pairs (end inclusive). */
function unaryRuns(tape: TMTape): Array<[number, number]> {
  const ones = indicesOf(tape, '1');
  const runs: Array<[number, number]> = [];
  for (const i of ones) {
    const last = runs[runs.length - 1];
    if (last && i === last[1] + 1) last[1] = i;
    else runs.push([i, i]);
  }
  return runs;
}

// ── accept ─────────────────────────────────────────────────────────

/**
 * Acceptor: did the machine halt within the step bound leaving exactly one
 * well-formed output block (and, optionally, the head in standard position)?
 * Returns `null` on accept, or a `TMReject` with a reason.
 *
 * Unary: 0 runs of `'1'` (blank tape) = the value 0 (accepted); 1 run = ok;
 * ≥2 runs = reject. Binary: exactly one `*…*` block (i.e. exactly two `'*'`
 * cells); 0 or ≥2 blocks = reject.
 */
export function acceptTM(
  notation: TMNotation,
  run: TMEvalResult,
  opts: AcceptOptions = {}
): TMReject | null {
  if (run.hitStepLimit || !run.halted) {
    return { reason: 'machine did not halt within the step limit' };
  }

  const tape = run.tape;
  let blockEnd: number | null = null; // rightmost cell of the output block

  if (notation === 'unary') {
    const runs = unaryRuns(tape);
    if (runs.length > 1) {
      return { reason: `output has ${runs.length} separate stroke blocks (expected at most one)` };
    }
    if (runs.length === 1) blockEnd = runs[0][1];
    // 0 runs = blank tape = the value 0; blockEnd stays null.
  } else {
    const stars = indicesOf(tape, '*');
    if (stars.length === 0) {
      return { reason: 'output has no `*…*` block' };
    }
    if (stars.length !== 2) {
      return { reason: `output has ${stars.length} \`*\` symbols (expected exactly two delimiting one block)` };
    }
    blockEnd = stars[1];
  }

  if (opts.requireStandardHaltPosition && blockEnd !== null && tape.head !== blockEnd) {
    return {
      reason: `head halted at ${tape.head}, not on the rightmost cell of the output block (${blockEnd})`,
    };
  }

  return null;
}

// ── decode ─────────────────────────────────────────────────────────

/**
 * TOTAL value decode of an ACCEPTED tape (precondition: `acceptTM` returned
 * null). Unary = number of strokes (0 if blank). Binary = the numeral between
 * the `'*'`s.
 */
export function decodeTM(notation: TMNotation, tape: TMTape): number {
  if (notation === 'unary') {
    return indicesOf(tape, '1').length;
  }
  const stars = indicesOf(tape, '*');
  if (stars.length !== 2) return 0; // unreachable when accepted
  const [lo, hi] = stars;
  let value = 0;
  for (let i = lo + 1; i < hi; i++) {
    value = value * 2 + (tape.cells[i] === '1' ? 1 : 0);
  }
  return value;
}

/** Map a question's representation system to a TM notation. */
export function notationForRepresentation(rep: string | undefined): TMNotation {
  return rep === 'binary' ? 'binary' : 'unary';
}

/**
 * Human-readable single-block rendering of a value on the tape, mirroring what
 * `encodeTM` writes for one block. Used by the authoring preview so TM cells show
 * the natural (unpadded) tape encoding instead of a fixed-width bit vector.
 *   unary:  n → a run of n `1`s (0 → the single blank `0` slot)
 *   binary: n → `*` + binary digits (MSB-first) + `*` (0 → `*0*`)
 */
export function formatTMValue(value: number, notation: TMNotation): string {
  const n = Math.max(0, Math.trunc(value));
  if (notation === 'unary') return n === 0 ? '0' : '1'.repeat(n);
  return `*${n.toString(2)}*`;
}
