// Perception authoring (task 013) — the pure half of the question creator's
// "Perception" task, React-free like fillInAuthoring.ts and arenaEditing.ts
// (PerceptionEditor.tsx is the widget over it).
//
// The creator edits ONE draft: the rule's fields (kind, retina width, run /
// object length, pattern, a motion rule's direction and scene) and the
// instructor's own SC frame films. `perceptionFields` turns it into the
// saved fields — the rule (`perception`), the bank (`perception_cases`:
// engine/perception.ts buildPerceptionCases, the generated battery with the
// films appended as `authored: true` cases) and, when any film is flagged
// "Example for students" (task 059), `perception_examples`: those films'
// frames + expected rows, derived from the bank. The bank is stripped from a
// student's copy wholesale (sanitize.ts, law 1), so an unflagged film reaches
// no student; the draft reads the films and their flags back from the bank.
//
// A motion rule with today's defaults (up, single object) is written without
// `direction`/`scene`, HW3 P12's stored form — a no-op edit of it keeps its
// content hash, so the homework sync still sees it as untouched.

import type {
  AssignmentQuestion,
  MotionDirection,
  MotionScene,
  PerceptionExample,
  PerceptionRule,
  PerceptionSpec,
  PerceptionTestCase,
} from '../types';
import {
  buildPerceptionCases,
  filmProblem,
  perceptionExamples,
  shiftFrame,
  MAX_FILM_FRAMES,
  MAX_PERCEPTION_WIDTH,
  MIN_PERCEPTION_WIDTH,
} from '../engine/perception';

export type PerceptionKind = PerceptionRule['kind'];
type PerceptionMode = 'CC' | 'SC';

/** Perception rules, by the mode they belong to: run rules & patterns are
 *  spatial (one CC frame), change & motion are temporal (an SC frame stream). */
export const PERCEPTION_KINDS: Record<PerceptionMode, { kind: PerceptionKind; label: string }[]> = {
  CC: [
    { kind: 'min-run', label: 'At least k consecutive 1s (edge detector)' },
    { kind: 'exact-run', label: 'Exactly k consecutive 1s (object detector)' },
    { kind: 'pattern', label: 'Match an exact pattern (landmark recognition)' },
  ],
  SC: [
    { kind: 'change', label: 'Change detector (input differs from previous)' },
    { kind: 'motion', label: 'Motion detector (an object moving one unit per step)' },
  ],
};

export const MOTION_DIRECTION_LABELS: Record<MotionDirection, string> = {
  up: 'upwards (toward IN1)',
  down: 'downwards',
  either: 'up or down',
};

export const MOTION_SCENE_LABELS: Record<MotionScene, string> = {
  single: 'a single object, nothing else in view',
  multi: 'any number of objects',
};

export interface PerceptionDraft {
  kind: PerceptionKind;
  width: number;
  /** A run rule's k, or a motion rule's object length. */
  runLength: number;
  pattern: string;
  direction: MotionDirection;
  scene: MotionScene;
  /** The instructor's own films (SC rules). */
  films: DraftFilm[];
}

/** One authored film: its frames (IN1 first) and whether students get it as
 *  a worked example. The flag travels with the film through every edit. */
export interface DraftFilm {
  frames: number[][];
  example: boolean;
}

/** The draft of a saved question — a new question (or one of another task)
 *  gets the defaults: an 8-wire retina, k = 3, no films. */
export function draftFromQuestion(
  q: Pick<AssignmentQuestion, 'perception' | 'perception_cases'> | undefined,
): PerceptionDraft {
  const r = q?.perception?.rule;
  return {
    kind: r?.kind ?? 'min-run',
    width: q?.perception?.width ?? 8,
    runLength: r?.kind === 'min-run' || r?.kind === 'exact-run' ? r.runLength : r?.kind === 'motion' ? r.objectLength : 3,
    pattern: r?.kind === 'pattern' ? r.pattern : '',
    direction: r?.kind === 'motion' ? r.direction ?? 'up' : 'up',
    scene: r?.kind === 'motion' ? r.scene ?? 'single' : 'single',
    films: (q?.perception_cases ?? [])
      .filter((c) => c.authored)
      .map((c) => ({ frames: c.frames.map((f) => [...f]), example: c.example === true })),
  };
}

/** The draft's rule kind, coerced into the mode's family (a mode flip keeps
 *  the draft; the kind it holds may belong to the other family). */
export function effectiveKind(draft: PerceptionDraft, mode: PerceptionMode): PerceptionKind {
  return PERCEPTION_KINDS[mode].some((k) => k.kind === draft.kind) ? draft.kind : PERCEPTION_KINDS[mode][0].kind;
}

/** The retina width: a pattern rule's width IS its pattern length. */
export function effectiveWidth(draft: PerceptionDraft, mode: PerceptionMode): number {
  return effectiveKind(draft, mode) === 'pattern' ? draft.pattern.length : draft.width;
}

/** The saved rule. A motion rule omits `direction`/`scene` at their defaults
 *  (up, single) — HW3 P12's stored form. */
export function ruleFromDraft(draft: PerceptionDraft, mode: PerceptionMode): PerceptionRule {
  const kind = effectiveKind(draft, mode);
  switch (kind) {
    case 'min-run':
    case 'exact-run':
      return { kind, runLength: draft.runLength };
    case 'pattern':
      return { kind, pattern: draft.pattern };
    case 'change':
      return { kind };
    case 'motion':
      return {
        kind,
        objectLength: draft.runLength,
        ...(draft.direction !== 'up' ? { direction: draft.direction } : {}),
        ...(draft.scene !== 'single' ? { scene: draft.scene } : {}),
      };
  }
}

export function specFromDraft(draft: PerceptionDraft, mode: PerceptionMode): PerceptionSpec {
  return { rule: ruleFromDraft(draft, mode), width: effectiveWidth(draft, mode) };
}

/** Does the draft's rule take films? Only SC rules: a CC bank is exhaustive. */
export function takesFilms(draft: PerceptionDraft, mode: PerceptionMode): boolean {
  const kind = effectiveKind(draft, mode);
  return kind === 'change' || kind === 'motion';
}

/** Everything that blocks saving, in the order the editor shows it (empty =
 *  saveable). The first one is the creator's one-line error. */
export function draftProblems(draft: PerceptionDraft, mode: PerceptionMode): string[] {
  const problems: string[] = [];
  const kind = effectiveKind(draft, mode);
  const width = effectiveWidth(draft, mode);
  if (kind === 'pattern' && !/^[01]+$/.test(draft.pattern)) {
    problems.push('The pattern must be a non-empty string of 0s and 1s.');
  } else if (!Number.isInteger(width) || width < MIN_PERCEPTION_WIDTH || width > MAX_PERCEPTION_WIDTH) {
    problems.push(`The number of inputs must be between ${MIN_PERCEPTION_WIDTH} and ${MAX_PERCEPTION_WIDTH}.`);
  } else if (
    (kind === 'min-run' || kind === 'exact-run' || kind === 'motion') &&
    (draft.runLength < 1 || draft.runLength > width)
  ) {
    problems.push(`The ${kind === 'motion' ? 'object' : 'run'} length must be between 1 and the number of inputs.`);
  }
  if (!takesFilms(draft, mode)) {
    if (draft.films.length > 0) {
      problems.push(
        `A ${mode} perception bank already covers every input — remove the ${draft.films.length} film${draft.films.length === 1 ? '' : 's'} (films are for SC rules).`,
      );
    }
    return problems;
  }
  draft.films.forEach((film, i) => {
    const problem = filmProblem(film.frames, width);
    if (problem) problems.push(`Film ${i + 1}: ${problem}.`);
  });
  return problems;
}

/** The saved fields. `perception_examples` is present only when a film is
 *  flagged, so a question without examples keeps its stored form (and HW3
 *  P12 its content hash). Throws (buildPerceptionCases) on a draft with
 *  problems — the creator gates saving on draftProblems first. */
export function perceptionFields(
  draft: PerceptionDraft,
  mode: PerceptionMode,
): { perception: PerceptionSpec; perception_cases: PerceptionTestCase[]; perception_examples?: PerceptionExample[] } {
  const perception = specFromDraft(draft, mode);
  const films = takesFilms(draft, mode) ? draft.films : [];
  const exampleIdx = films.flatMap((f, i) => (f.example ? [i] : []));
  const perception_cases = buildPerceptionCases(perception, films.map((f) => f.frames), exampleIdx);
  const examples = perceptionExamples(perception_cases);
  return { perception, perception_cases, ...(examples.length > 0 ? { perception_examples: examples } : {}) };
}

/** How the bank the draft saves is made up, or null while it cannot be built. */
export function bankSummary(
  draft: PerceptionDraft,
  mode: PerceptionMode,
): { generated: number; authored: number; examples: number; positives: number } | null {
  if (draftProblems(draft, mode).length > 0) return null;
  try {
    const cases = perceptionFields(draft, mode).perception_cases;
    const authored = cases.filter((c) => c.authored).length;
    const examples = cases.filter((c) => c.authored && c.example).length;
    return { generated: cases.length - authored, authored, examples, positives: cases.filter((c) => c.expected.includes(1)).length };
  } catch {
    return null;
  }
}

// ── Film edits (pure: each returns a new film / list) ─────────────

const blankFrame = (width: number): number[] => Array<number>(width).fill(0);

/** A new film: two blank frames — the least a temporal rule can judge. */
export function newFilm(width: number): number[][] {
  return [blankFrame(width), blankFrame(width)];
}

/** A new draft film: `newFilm`'s frames, not an example. */
export function newDraftFilm(width: number): DraftFilm {
  return { frames: newFilm(width), example: false };
}

export function replaceFilm<F>(films: readonly F[], i: number, film: F): F[] {
  return films.map((f, k) => (k === i ? film : f));
}

export function removeFilm<F>(films: readonly F[], i: number): F[] {
  return films.filter((_, k) => k !== i);
}

/** Insert a deep copy of film i after it (its example flag kept). */
export function duplicateFilm(films: readonly DraftFilm[], i: number): DraftFilm[] {
  const next = [...films];
  next.splice(i + 1, 0, { ...films[i], frames: films[i].frames.map((f) => [...f]) });
  return next;
}

export function toggleFilmBit(film: number[][], t: number, wire: number): number[][] {
  return film.map((f, k) => (k === t ? f.map((b, i) => (i === wire ? 1 - b : b)) : f));
}

/** Append a copy of the newest frame (a blank one on an empty film), up to
 *  MAX_FILM_FRAMES. */
export function addFilmFrame(film: number[][], width: number): number[][] {
  if (film.length >= MAX_FILM_FRAMES) return film;
  const newest = film[film.length - 1];
  return [...film, newest ? [...newest] : blankFrame(width)];
}

export function removeFilmFrame(film: number[][], t: number): number[][] {
  return film.filter((_, k) => k !== t);
}

export function duplicateFilmFrame(film: number[][], t: number): number[][] {
  if (film.length >= MAX_FILM_FRAMES || !film[t]) return film;
  const next = [...film];
  next.splice(t + 1, 0, [...film[t]]);
  return next;
}

/** Shift frame t one wire up (toward IN1) or down (engine shiftFrame). */
export function shiftFilmFrame(film: number[][], t: number, dir: 'up' | 'down'): number[][] {
  return film.map((f, k) => (k === t ? shiftFrame(f, dir) : f));
}

/** The film at another retina width: each frame cut or padded with 0s at
 *  the bottom (IN1 stays on top). */
export function fitFilmToWidth(film: number[][], width: number): number[][] {
  return film.map((f) => Array.from({ length: width }, (_, i) => (f[i] === 1 ? 1 : 0)));
}
