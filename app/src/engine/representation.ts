// Bit-string ↔ number interpretation under the course's representational systems.
//
// Framework-agnostic (no React/Zustand/DOM). Shared by the UI data table and the
// grader/CLI report so both interpret bits identically.
//
// The codec (engine/codec.ts) builds on the value↔bits core below: `valueToBits`
// lays a number out over a group's wires, `isValidCodeword` checks a bit slice is
// a legal representation, and `bitsToValue` is the TOTAL inverse (assumes a valid
// codeword — validity is checked separately so decoding never sees junk). These
// supersede the old `encodeBits`/`decodeBits`. Anything other than 'tally'
// (binary, and the display-only 'plus') is treated as binary.

import type { RepSystem } from '../types';

/** Valid tally: 0's, then consecutive 1's to the right end — `0…01…1`, the
 *  textbook's "Tally Syntax" (pp. 26–27: `0011` is two; `1000` is no numeral)
 *  and spec §Tally. Returns the count of 1's, or null when a 0 follows a 1. */
export function bitsToTally(bits: number[]): number | null {
  let seenOne = false;
  let count = 0;
  for (const b of bits) {
    if (b === 1) {
      seenOne = true;
      count++;
    } else if (seenOne) {
      return null; // 0 after a 1 → invalid
    }
  }
  return count;
}

/** Standard base-2, left-to-right MSB. */
export function bitsToBinary(bits: number[]): number {
  let val = 0;
  for (let i = 0; i < bits.length; i++) {
    val = (val << 1) | bits[i];
  }
  return val;
}

/**
 * Human-readable interpretation of a bit string under a representational system.
 * Mirrors the data table: tally renders its count or '/' when invalid; everything
 * else falls back to binary.
 */
export function interpretBits(bits: number[], rep: RepSystem): string {
  if (rep === 'tally') {
    const t = bitsToTally(bits);
    return t != null ? String(t) : '/';
  }
  return String(bitsToBinary(bits));
}

// ─── value ↔ bits core (codec building blocks) ──────────────────────────────

/**
 * Encode a non-negative integer as exactly `width` bits under `rep`.
 * - binary: MSB first, masked to the least-significant `width` bits — this
 *   truncation is the **implicit modulus** the reference-function DSL relies on.
 * - tally: zeros, then `n` ones at the right end (`0…01…1`), clamped into
 *   0..width. On the space axis the ones sit on the last wires; on the time
 *   axis (LSB at t1) they arrive first, at t1..tn.
 */
export function valueToBits(n: number, width: number, rep: RepSystem): number[] {
  if (rep === 'tally') {
    const ones = Math.max(0, Math.min(width, n));
    return Array.from({ length: width }, (_, i) => (i >= width - ones ? 1 : 0));
  }
  // binary, MSB first; mask to the least-significant `width` bits.
  return Array.from({ length: width }, (_, i) => (n >> (width - 1 - i)) & 1);
}

/**
 * Is `bits` a legal codeword under `rep`? Binary accepts everything; tally
 * requires 0's then consecutive 1's (so `101` and `110` are rejected, not decoded). This is
 * the codec's rep-level acceptance check — run BEFORE `bitsToValue`.
 */
export function isValidCodeword(bits: number[], rep: RepSystem): boolean {
  if (rep === 'tally') return bitsToTally(bits) !== null;
  return true;
}

/**
 * Decode a bit string to a number. TOTAL — never throws, never returns null;
 * precondition is `isValidCodeword(bits, rep)`. Binary = base-2 MSB first; tally
 * = the count of 1-bits (well-defined even on an invalid codeword, which the
 * acceptor is responsible for rejecting first).
 */
export function bitsToValue(bits: number[], rep: RepSystem): number {
  if (rep === 'tally') return bits.reduce((n, b) => n + (b ? 1 : 0), 0);
  return bitsToBinary(bits);
}
