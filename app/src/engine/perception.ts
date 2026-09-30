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
  MotionDirection,
  MotionScene,
  PerceptionExample,
  PerceptionRule,
  PerceptionSpec,
  PerceptionTestCase,
} from '../types';
import { evaluateCCInputs } from './cc';
import { evaluateSCSequence } from './sc';

/** Largest retina a perception question may declare (CC banks enumerate 2^width). */
export const MAX_PERCEPTION_WIDTH = 10;
export const MIN_PERCEPTION_WIDTH = 2;
/** Longest film a perception case may hold — the student's frame player and
 *  the instructor's authored films alike (a generated case is 2–19 frames). */
export const MAX_FILM_FRAMES = 24;

export const MOTION_DIRECTIONS: readonly MotionDirection[] = ['up', 'down', 'either'];
export const MOTION_SCENES: readonly MotionScene[] = ['single', 'multi'];

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
    case 'motion': {
      const dir = rule.direction ?? 'up';
      const way = dir === 'up' ? 'upwards' : dir === 'down' ? 'downwards' : 'up or down';
      const scene = (rule.scene ?? 'single') === 'multi' ? ', whatever else is in view' : '';
      return `output 1 iff an object image (a string of exactly ${rule.objectLength} consecutive 1s) is moving ${way} 1 unit per unit of time${scene}`;
    }
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

/** The start index of every object image in the frame — every maximal run of
 *  exactly k 1s (a run of k+1 is not one), top (IN1) first. */
export function objectStarts(bits: number[], k: number): number[] {
  return onesRuns(bits).filter((r) => r.len === k).map((r) => r.start);
}

/** Did an object at `q` in the previous frame move one unit, in `dir`, to `p`?
 *  "Up" is toward IN1: the start index drops by one. */
function movedOneUnit(dir: MotionDirection, p: number, q: number): boolean {
  if (dir === 'up') return q === p + 1;
  if (dir === 'down') return q === p - 1;
  return Math.abs(q - p) === 1;
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
        const k = rule.objectLength;
        const dir = rule.direction ?? 'up';
        if ((rule.scene ?? 'single') === 'single') {
          // Each frame is one object image and nothing else.
          const p = singleObjectAt(cur, k);
          const q = singleObjectAt(prev, k);
          return p != null && q != null && movedOneUnit(dir, p, q) ? 1 : 0;
        }
        // Any number of objects: SOME object image now sits one unit from
        // some object image in the previous frame, whatever else is in view.
        const before = objectStarts(prev, k);
        return objectStarts(cur, k).some((p) => before.some((q) => movedOneUnit(dir, p, q))) ? 1 : 0;
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

/**
 * SC motion-detector sequences: true upward motion plus every near-miss —
 * HW3 P12's committed battery, which must never drift: the same films, the
 * same random draws in the same order. Any other direction or scene appends
 * a deterministic set after it (motionExtras) that consumes no random draw;
 * every film's expected output comes from the rule, so one film is a
 * positive under one variant and a near-miss under another.
 */
function motionSequences(
  width: number,
  k: number,
  rand: () => number,
  direction: MotionDirection = 'up',
  scene: MotionScene = 'single',
): number[][][] {
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
  if (direction !== 'up' || scene === 'multi') seqs.push(...motionExtras(width, k));
  return seqs;
}

/**
 * The films a downward, either-way or multi-object motion rule adds: the
 * upward battery's near-misses mirrored, a bounce, and scenes with more than
 * one thing in view (two objects, a stray bit, a static object beside a
 * moving one). Films that do not fit the retina are dropped; each is 2 to
 * MAX_FILM_FRAMES frames.
 */
function motionExtras(width: number, k: number): number[][][] {
  const blank = Array<number>(width).fill(0);
  const bottom = width - k;
  const at = (...starts: number[]): number[] => {
    const f = [...blank];
    for (const s of starts) objectFrame(width, k, s).forEach((b, i) => { if (b) f[i] = 1; });
    return f;
  };
  const span = (from: number, to: number): number[] => {
    const out: number[] = [];
    for (let s = from; from <= to ? s <= to : s >= to; s += from <= to ? 1 : -1) out.push(s);
    return out;
  };
  const films: number[][][] = [
    // jumps two units DOWN per step
    [0, 2, 4].filter((s) => s <= bottom).map((s) => at(s)),
    // a too-long (k+1 run) object falling
    bottom >= 1 ? span(0, bottom - 1).map((s) => objectFrame(width, k + 1, s)) : [],
    // appears at the top, falls two steps, vanishes, reappears at the bottom
    bottom >= 1 ? [blank, at(0), at(1), blank, at(bottom)] : [],
    // falls with a stray bit at the bottom wire
    bottom >= 2 ? span(0, bottom - 2).map((s) => { const g = at(s); g[width - 1] = 1; return g; }) : [],
    // bounce: climbs to the top, then falls back
    [...span(bottom, 0), ...span(1, bottom)].map((s) => at(s)),
    // climbs with a stray bit at the bottom wire, one wire clear of it
    bottom >= 2 ? span(bottom - 2, 0).map((s) => { const g = at(s); g[width - 1] = 1; return g; }) : [],
  ];
  // A stray bit appears, one wire clear, just as the object steps up (then
  // down): the only films that separate the scenes on a small retina (w4 k2),
  // where every other clutter film here needs more room — single says 0 at
  // the step, multi 1.
  if (bottom >= 2) {
    const withStray = (s: number, wire: number): number[] => { const g = at(s); g[wire] = 1; return g; };
    films.push([at(bottom - 1), withStray(bottom - 2, width - 1)]);
    films.push([at(1), withStray(2, 0)]);
  }
  // Two objects converging from the ends (a gap always between), then diverging.
  const converge: number[][] = [];
  for (let a = 0, b = bottom; a + k < b; a++, b--) converge.push(at(a, b));
  films.push(converge, [...converge].reverse());
  // Two objects falling together, one wire apart.
  const together: number[][] = [];
  for (let a = 0; a + 2 * k + 1 <= width; a++) together.push(at(a, a + k + 1));
  films.push(together);
  // An object climbing toward a static object at the bottom.
  films.push(span(bottom - k - 1, 0).filter((s) => s >= 0 && bottom - k - 1 >= 0).map((s) => at(s, bottom)));
  return films
    .filter((f) => f.length >= 2)
    .map((f) => f.slice(0, MAX_FILM_FRAMES));
}

/** Why a film cannot be a case of an SC perception question `width` wires
 *  wide, or null when it can: 1..MAX_FILM_FRAMES frames of exactly `width`
 *  bits, each 0 or 1. */
export function filmProblem(film: number[][], width: number): string | null {
  if (!Array.isArray(film) || film.length === 0) return 'a film needs at least one frame';
  if (film.length > MAX_FILM_FRAMES) return `a film holds at most ${MAX_FILM_FRAMES} frames (this one has ${film.length})`;
  for (let t = 0; t < film.length; t++) {
    const f = film[t];
    if (!Array.isArray(f) || f.length !== width) {
      return `frame t${t + 1} has ${Array.isArray(f) ? f.length : 0} bits, but the retina is ${width} wires`;
    }
    if (!f.every((b) => b === 0 || b === 1)) return `frame t${t + 1} holds a value that is not 0 or 1`;
  }
  return null;
}

/**
 * Build a perception question's grading bank from its authored spec, at save
 * time. CC rules enumerate every 2^width frame exhaustively (width is capped
 * at MAX_PERCEPTION_WIDTH); SC rules get a fixed, deterministic battery of
 * frame sequences whose expected outputs come from the rule evaluator.
 *
 * `films` are the instructor's own SC frame sequences, appended after the
 * generated battery as `authored: true` cases — their expected outputs, too,
 * come from the rule, never from the caller. A CC bank is already exhaustive,
 * so a CC rule takes none (throws). `exampleIdx` lists the films the
 * instructor flagged "Example for students": those cases also carry
 * `example: true` (perceptionExamples derives the student-visible copy).
 */
export function buildPerceptionCases(
  spec: PerceptionSpec,
  films: number[][][] = [],
  exampleIdx: readonly number[] = [],
): PerceptionTestCase[] {
  const { rule, width } = spec;
  if (
    !Number.isInteger(width) ||
    width < MIN_PERCEPTION_WIDTH ||
    width > MAX_PERCEPTION_WIDTH
  ) {
    throw new Error(
      `perception width must be a whole number from ${MIN_PERCEPTION_WIDTH} to ${MAX_PERCEPTION_WIDTH}`,
    );
  }
  if (rule.kind === 'pattern') {
    if (!/^[01]+$/.test(rule.pattern)) throw new Error('pattern must be a string of 0s and 1s');
    if (rule.pattern.length !== width) throw new Error('pattern length must equal the input width');
  }
  if ((rule.kind === 'min-run' || rule.kind === 'exact-run') && (rule.runLength < 1 || rule.runLength > width)) {
    throw new Error('run length must be between 1 and the input width');
  }
  if (rule.kind === 'motion') {
    if (rule.objectLength < 1 || rule.objectLength > width) {
      throw new Error('object length must be between 1 and the input width');
    }
    if (rule.direction !== undefined && !MOTION_DIRECTIONS.includes(rule.direction)) {
      throw new Error(`motion direction must be one of ${MOTION_DIRECTIONS.join(', ')}`);
    }
    if (rule.scene !== undefined && !MOTION_SCENES.includes(rule.scene)) {
      throw new Error(`motion scene must be one of ${MOTION_SCENES.join(', ')}`);
    }
  }

  if (perceptionModeFor(rule) === 'CC') {
    if (films.length > 0) throw new Error('a CC perception rule takes no films (films are for SC rules only)');
    return allFrames(width).map((f) => caseOf(rule, [f]));
  }
  films.forEach((film, i) => {
    const problem = filmProblem(film, width);
    if (problem) throw new Error(`film ${i + 1}: ${problem}`);
  });
  for (const i of exampleIdx) {
    if (!Number.isInteger(i) || i < 0 || i >= films.length) throw new Error(`example film ${i + 1} does not exist`);
  }
  const examples = new Set(exampleIdx);
  const rand = lcg(0x133 + width * 31 + (rule.kind === 'motion' ? rule.objectLength : 0));
  const seqs = rule.kind === 'motion'
    ? motionSequences(width, rule.objectLength, rand, rule.direction, rule.scene)
    : changeSequences(width, rand);
  const authored = films.map((film, i): PerceptionTestCase => ({
    ...caseOf(rule, film.map((f) => [...f])),
    authored: true,
    ...(examples.has(i) ? { example: true as const } : {}),
  }));
  return [...seqs.map((frames) => caseOf(rule, frames)), ...authored];
}

/**
 * The student-visible examples of a bank: every authored case flagged
 * `example`, in order, as fresh `{frames, expected}` copies — no flag keys, so
 * nothing about the bank's shape leaks. Derived at save into the question's
 * `perception_examples`; the grader never reads that field.
 */
export function perceptionExamples(cases: readonly PerceptionTestCase[]): PerceptionExample[] {
  return cases
    .filter((c) => c.authored && c.example)
    .map((c) => ({ frames: c.frames.map((f) => [...f]), expected: [...c.expected] }));
}

/** The index of the example whose film deep-equals `frames`, else null — the
 *  frame player shows an expected row only while the loaded film is unedited. */
export function matchingPerceptionExample(
  examples: readonly PerceptionExample[],
  frames: readonly (readonly number[])[],
): number | null {
  const i = examples.findIndex((ex) =>
    ex.frames.length === frames.length &&
    ex.frames.every((f, t) => f.length === frames[t].length && f.every((b, j) => b === frames[t][j])));
  return i < 0 ? null : i;
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

// ── Frames ↔ the SC run's input lanes (the student's frame player) ──

/**
 * A film of frames as the SC run's input LANES — the store's
 * `scInputSequence`: lane i is wire IN(i+1)'s bit at every step, t1 first.
 * The store's scStep feeds lane i to the i-th INPUT in label order, exactly
 * how evaluateSCSequence feeds frame bit i (runPerceptionCase below), so a
 * film loaded as lanes and clocked in the store IS the grader's run of it.
 * A frame shorter than `width` reads 0 in its missing bits.
 */
export function framesToLanes(frames: number[][], width: number): number[][] {
  return Array.from({ length: width }, (_, i) => frames.map((f) => f[i] ?? 0));
}

/** The film the lanes hold — the inverse of framesToLanes: one frame per step
 *  of the LONGEST lane, `width` bits each; a bit a short or missing lane
 *  lacks reads 0, as scStep feeds it. */
export function lanesToFrames(lanes: number[][], width: number): number[][] {
  const steps = Math.max(0, ...lanes.map((l) => l.length));
  return Array.from({ length: steps }, (_, t) =>
    Array.from({ length: width }, (_, i) => lanes[i]?.[t] ?? 0));
}

/** A frame shifted one wire up — toward IN1, the motion rule's "up" — or
 *  down; the vacated end reads 0 and the bit pushed off the edge is lost. */
export function shiftFrame(frame: number[], dir: 'up' | 'down'): number[] {
  if (frame.length === 0) return [];
  return dir === 'up' ? [...frame.slice(1), 0] : [0, ...frame.slice(0, -1)];
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
