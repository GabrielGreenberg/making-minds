// Bit-string ↔ number interpretation under the course's representational systems.
//
// Framework-agnostic (no React/Zustand/DOM). Shared by the UI data table and the
// grader/CLI report so both interpret bits identically.

import type { RepSystem } from '../types';

/** Valid tally: consecutive 1's from the left, then 0's. Returns count or null. */
export function bitsToTally(bits: number[]): number | null {
  let seenZero = false;
  let count = 0;
  for (const b of bits) {
    if (b === 1) {
      if (seenZero) return null; // 1 after a 0 → invalid
      count++;
    } else {
      seenZero = true;
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
