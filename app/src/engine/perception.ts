// Perception questions — bit-level grading for CC/SC "retina" tasks.
//
// Framework-agnostic (no React/Zustand/DOM): runs in the browser and in the
// Node grading CLI from the same source.
//
// A perception question treats a machine's inputs as an array of stimulations
// (like light hitting a retina) and its single output as a symbol classifying
// the stimulus — "there is an edge here", "this is the landmark". That framing
// is inherently about the raw bit pattern, so perception grading bypasses the
// value codec entirely: cases carry frames (bit-vectors, IN1 first) and the
// expected output bit per time step. A CC case is one frame; an SC case is a
// frame per clock tick, judged every tick.
//
// SC timing convention: the "previous input" at step t is frame t−1, and the
// previous input of the FIRST frame is the blank (all-zero) frame — exactly
// what a student circuit sees through MEM blocks, which all initialize to 0.
// So stimulation onset counts as a change, and no object is in view before t1.

import type {
  CircuitData,
  PerceptionRule,
  PerceptionSpec,
  PerceptionTestCase,
} from '../types';
import { evaluateCCInputs } from './cc';
import { evaluateSCSequence } from './sc';

/** Largest retina a perception question may declare (CC banks enumerate 2^width). */
export const MAX_PERCEPTION_WIDTH = 10;
export const MIN_PERCEPTION_WIDTH = 2;

/** Which canvas/engine a rule belongs to: run rules & patterns are spatial
 *  (CC, one frame); change & motion are temporal (SC, a frame stream). */
export function perceptionModeFor(rule: PerceptionRule): 'CC' | 'SC' {
  return rule.kind === 'change' || rule.kind === 'motion' ? 'SC' : 'CC';
}

/** Human-readable rule description (instructor UI + tooling). */
export function describePerceptionRule(rule: PerceptionRule): string {
  switch (rule.kind) {
    case 'min-run':
      return `output 1 iff the input contains a string of at least ${rule.runLength} consecutive 1s`;
    case 'exact-run':
      return `output 1 iff the input contains a string of exactly ${rule.runLength} consecutive 1s`;
    case 'pattern':
      return `output 1 iff the input = ${rule.pattern}`;
    case 'change':
      return 'output 1 iff the current input differs in any way from the previous input';
    case 'motion':
      return `output 1 iff an object image (a string of exactly ${rule.objectLength} consecutive 1s) is moving upwards 1 unit per unit of time`;
  }
}

// ── Rule evaluation ─────────────────────────────────────────────────

/** Maximal runs of 1s in a frame: [start index, length] pairs. */
function onesRuns(bits: number[]): { start: number; len: number }[] {
  const out: { start: number; len: number }[] = [];
  let start = -1;
  for (let i = 0; i <= bits.length; i++) {
    if (i < bits.length && bits[i] === 1) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      out.push({ start, len: i - start });
      start = -1;
    }
  }
  return out;
}

/** ≥ k consecutive 1s anywhere in the frame. */
export function hasRunAtLeast(bits: number[], k: number): boolean {
  return onesRuns(bits).some((r) => r.len >= k);
}

/** A maximal run of exactly k 1s anywhere in the frame (a run of k+1 doesn't count). */
export function hasRunExactly(bits: number[], k: number): boolean {
  return onesRuns(bits).some((r) => r.len === k);
}

function framesEqual(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((bit, i) => bit === b[i]);
}

/**
 * If the frame is exactly one object image — a single run of exactly k 1s and
 * nothing else — return its start index (0 = IN1 = the top of the retina);
 * otherwise null.
 */
export function singleObjectAt(bits: number[], k: number): number | null {
  const runs = onesRuns(bits);
  return runs.length === 1 && runs[0].len === k ? runs[0].start : null;
}

/** Parse a pattern string ("110010111") into a bit-vector. */
export function patternBits(pattern: string): number[] {
  return pattern.split('').map((c) => (c === '1' ? 1 : 0));
}

/**
 * The correct output bit for every time step of a frame sequence under a rule.
 * Temporal rules see the blank frame as the predecessor of frame 0 (matching
 * MEM initialization); "up" means toward IN1 (decreasing wire index).
 */
export function expectedPerceptionOutputs(rule: PerceptionRule, frames: number[][]): number[] {
  const width = frames[0]?.length ?? 0;
  const blank = Array<number>(width).fill(0);
  return frames.map((cur, t) => {
    const prev = t > 0 ? frames[t - 1] : blank;
    switch (rule.kind) {
      case 'min-run':
        return hasRunAtLeast(cur, rule.runLength) ? 1 : 0;
      case 'exact-run':
        return hasRunExactly(cur, rule.runLength) ? 1 : 0;
      case 'pattern':
        return framesEqual(cur, patternBits(rule.pattern)) ? 1 : 0;
      case 'change':
        return framesEqual(cur, prev) ? 0 : 1;
      case 'motion': {
        const p = singleObjectAt(cur, rule.objectLength);
        const q = singleObjectAt(prev, rule.objectLength);
        return p != null && q != null && q === p + 1 ? 1 : 0;
      }
    }
  });
}

// ── Case generation (authoring time, deterministic) ─────────────────

/** Deterministic PRNG so a saved bank is reproducible run to run. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function randomFrame(width: number, rand: () => number): number[] {
  return Array.from({ length: width }, () => (rand() < 0.5 ? 1 : 0));
}

/** A frame with an object image (run of `k` 1s) starting at wire index `start`. */
export function objectFrame(width: number, k: number, start: number): number[] {
  const f = Array<number>(width).fill(0);
  for (let i = start; i < Math.min(start + k, width); i++) f[i] = 1;
  return f;
}

function caseOf(rule: PerceptionRule, frames: number[][]): PerceptionTestCase {
  return { frames, expected: expectedPerceptionOutputs(rule, frames) };
}

/** Every width-bit frame, as bit-vectors (MSB… no: IN1-first, plain counting order). */
function allFrames(width: number): number[][] {
  const out: number[][] = [];
  for (let v = 0; v < 1 << width; v++) {
    out.push(Array.from({ length: width }, (_, i) => (v >> (width - 1 - i)) & 1));
  }
  return out;
}

/** SC change-detector sequences: constancy, onsets, single-bit flips, noise. */
function changeSequences(width: number, rand: () => number): number[][][] {
  const blank = Array<number>(width).fill(0);
  const some = randomFrame(width, rand);
  const flipped = some.map((b, i) => (i === Math.floor(rand() * width) ? 1 - b : b));
  const seqs: number[][][] = [
    // never changes (and never differs from the blank predecessor)
    Array.from({ length: 6 }, () => [...blank]),
    // onset, then held constant — change at t1 and t2 only
    [blank, some, some, some, some, some].map((f) => [...f]),
    // a single-bit flip mid-stream
    [some, some, flipped, flipped, some, some].map((f) => [...f]),
    // alternating every step
    [some, flipped, some, flipped, some, flipped].map((f) => [...f]),
  ];
  for (let i = 0; i < 4; i++) {
    // random streams: frames repeat with probability ½, else redraw
    const seq: number[][] = [randomFrame(width, rand)];
    while (seq.length < 8) {
      seq.push(rand() < 0.5 ? [...seq[seq.length - 1]] : randomFrame(width, rand));
    }
    seqs.push(seq);
  }
  return seqs;
}

/** SC motion-detector sequences: true upward motion plus every near-miss. */
function motionSequences(width: number, k: number, rand: () => number): number[][][] {
  const blank = Array<number>(width).fill(0);
  const bottom = width - k; // lowest start index an object can have
  const upward = (from: number, to: number): number[][] => {
    const seq: number[][] = [];
    for (let s = from; s >= to; s--) seq.push(objectFrame(width, k, s));
    return seq;
  };
  const seqs: number[][][] = [
    // full climb bottom → top: expected 1 from the second frame on
    upward(bottom, 0),
    // downward drift: never 1
    upward(bottom, 0).reverse(),
    // static object: never 1
    Array.from({ length: 5 }, () => objectFrame(width, k, Math.floor(bottom / 2))),
    // jumps two units per step: never 1
    [bottom, bottom - 2, bottom - 4].filter((s) => s >= 0).map((s) => objectFrame(width, k, s)),
    // a too-long "object" (k+1 run) climbing: never 1
    Array.from({ length: Math.max(2, bottom) }, (_, t) => objectFrame(width, k + 1, Math.max(0, bottom - 1 - t))),
    // appears, climbs two steps, vanishes, reappears higher
    [blank, objectFrame(width, k, bottom), objectFrame(width, k, bottom - 1), blank, objectFrame(width, k, 0)],
    // climbs with a noise bit alongside (not a single object): never 1
    upward(bottom, 1).map((f) => {
      const g = [...f];
      g[0] = 1; // stray stimulation at the top wire
      return g;
    }),
  ];
  for (let i = 0; i < 2; i++) {
    seqs.push(Array.from({ length: 6 }, () => randomFrame(width, rand)));
  }
  return seqs;
}

/**
 * Build a perception question's grading bank from its authored spec, at save
 * time. CC rules enumerate every 2^width frame exhaustively (width is capped
 * at MAX_PERCEPTION_WIDTH); SC rules get a fixed, deterministic battery of
 * frame sequences whose expected outputs come from the rule evaluator.
 */
export function buildPerceptionCases(spec: PerceptionSpec): PerceptionTestCase[] {
  const { rule, width } = spec;
  if (
    !Number.isInteger(width) ||
    width < MIN_PERCEPTION_WIDTH ||
    width > MAX_PERCEPTION_WIDTH
  ) {
    throw new Error(
      `perception width must be an integer in ${MIN_PERCEPTION_WIDTH}..${MAX_PERCEPTION_WIDTH}`,
    );
  }
  if (rule.kind === 'pattern') {
    if (!/^[01]+$/.test(rule.pattern)) throw new Error('pattern must be a string of 0s and 1s');
    if (rule.pattern.length !== width) throw new Error('pattern length must equal the input width');
  }
  if ((rule.kind === 'min-run' || rule.kind === 'exact-run') && (rule.runLength < 1 || rule.runLength > width)) {
    throw new Error('run length must be between 1 and the input width');
  }
  if (rule.kind === 'motion' && (rule.objectLength < 1 || rule.objectLength > width)) {
    throw new Error('object length must be between 1 and the input width');
  }

  if (perceptionModeFor(rule) === 'CC') {
    return allFrames(width).map((f) => caseOf(rule, [f]));
  }
  const rand = lcg(0x133 + width * 31 + (rule.kind === 'motion' ? rule.objectLength : 0));
  const seqs = rule.kind === 'change'
    ? changeSequences(width, rand)
    : motionSequences(width, (rule as { objectLength: number }).objectLength, rand);
  return seqs.map((frames) => caseOf(rule, frames));
}

// ── Grading primitives (used by engine/grader.ts) ───────────────────

/** Structural check: the retina interface is `width` input wires and 1 output wire. */
export function validatePerceptionMachine(
  circuit: CircuitData,
  width: number,
): { ok: boolean; reason?: string } {
  const inputs = circuit.components.filter((c) => c.type === 'INPUT').length;
  const outputs = circuit.components.filter((c) => c.type === 'OUTPUT').length;
  if (inputs !== width) return { ok: false, reason: `expected ${width} input wires, found ${inputs}` };
  if (outputs !== 1) return { ok: false, reason: `expected 1 output wire, found ${outputs}` };
  return { ok: true };
}

/**
 * Run one perception case and return the machine's output bit per time step
 * (parallel to `tc.expected`). CC evaluates each frame combinationally (a CC
 * case has one frame); SC clocks the whole frame sequence through, MEMs
 * starting at 0.
 */
export function runPerceptionCase(
  circuit: CircuitData,
  mode: 'CC' | 'SC',
  tc: PerceptionTestCase,
): number[] {
  if (mode === 'CC') {
    return tc.frames.map((f) => evaluateCCInputs(circuit.components, circuit.wires, f)[0] ?? 0);
  }
  return evaluateSCSequence(circuit.components, circuit.wires, tc.frames).map((row) => row[0] ?? 0);
}
