// The problem-set document — the semantics half (pure: no React, no DOM, so
// tools/statementFormatCheck.ts can pin it headlessly). The render half is
// components/ProblemSetDocument.tsx. Types: src/types.ts ("The problem-set
// document"); design memo: docs/buildout/designs/problem-set-document.md.
//
// An assignment's `sections` are a layer OVER its flat `questions[]`: they
// group, order and annotate the problems without owning them. Everything here
// normalises that layer so a renderer never has to think about a missing
// `sections`, a question no section lists, or an id that no longer exists.

import type {
  AssignmentData,
  AssignmentQuestion,
  AssignmentSection,
  Callout,
  CalloutKind,
  Figure,
  SectionLayout,
} from './types';
import { CALLOUT_KINDS } from './types';
import { parseStatement, statementProse } from './statementFormat';

/** A problem as the document shows it: the question, its index in the flat
 *  list (the canvas route), its printed number and its layout shape. */
export interface ResolvedProblem {
  question: AssignmentQuestion;
  index: number;
  number: string;
  shape: ProblemShape;
}

export interface ResolvedSection {
  heading: string;
  intro?: string;
  callouts: Callout[];
  figures: Figure[];
  layout: SectionLayout;
  problems: ResolvedProblem[];
}

/** How much room a problem takes: a `table` problem is a title over a truth
 *  table (or a turbot's arena) and sits in a grid several per row; a `compact`
 *  one is a one-liner ("+1 T") and flows in columns; `full` takes the width. */
export type ProblemShape = 'table' | 'compact' | 'full';

/** Compact = this much plain prose or less, no parts, no list. */
export const COMPACT_PROSE_CHARS = 90;
/** A turbot arena wider than this is a full-width problem (HW4's Way Finder). */
export const GRID_ARENA_MAX_WIDTH = 12;

export const DEFAULT_CALLOUT_TITLE: Record<CalloutKind, string> = {
  hint: 'Hint:',
  challenge: 'Challenge problem:',
  advice: 'Advice!',
  caution: 'Caution!',
  note: '',
};

/** An author's own title, and the Advice! / Caution! defaults, stand on a
 *  line of their own; the "Hint:" and "Challenge problem:" defaults run into
 *  the first paragraph, as the PDFs do. */
export function calloutTitleIsBlock(callout: Pick<Callout, 'kind' | 'title'>): boolean {
  return callout.title !== undefined || callout.kind === 'advice' || callout.kind === 'caution';
}

/** The printed problem number: the number in a "Problem 3" / "Q2a" label,
 *  else the 1-based position in the flat list (numbering is continuous across
 *  sections, as in the PDFs). */
export function problemNumber(label: string, index: number): string {
  const m = /^(?:problem|question|q)\s*#?\s*(\d+[a-z]?)$/i.exec(label.trim());
  return m ? m[1] : String(index + 1);
}

export function problemShape(q: AssignmentQuestion): ProblemShape {
  // A figure needs the width; a boxed callout wants it too.
  if ((q.figures?.length ?? 0) > 0) return 'full';
  if ((q.callouts ?? []).some((c) => placementOf(c) !== 'aside')) return 'full';
  if (q.buildMode === 'turbot') {
    const arena = q.turbot_cases?.[0]?.arena;
    return arena && arena.width <= GRID_ARENA_MAX_WIDTH ? 'table' : 'full';
  }
  const blocks = parseStatement(q.statement);
  if (blocks.length > 0 && blocks.every((b) => b.kind === 'io-table')) return 'table';
  if (blocks.some((b) => b.kind !== 'para' || b.part)) return 'full';
  return statementProse(q.statement).length <= COMPACT_PROSE_CHARS ? 'compact' : 'full';
}

/** The sections a renderer draws. No `sections` → one unnamed section with
 *  every question; ids that match no question are dropped; questions no
 *  section lists trail in an unnamed section (an instructor who adds a
 *  question before filing it still sees it); a listed id is used once. */
export function documentSections(assignment: AssignmentData): ResolvedSection[] {
  const byId = new Map(assignment.questions.map((q, index) => [q.id, { q, index }]));
  const resolve = (id: number): ResolvedProblem | null => {
    const hit = byId.get(id);
    if (!hit) return null;
    byId.delete(id);
    return { question: hit.q, index: hit.index, number: problemNumber(hit.q.label, hit.index), shape: problemShape(hit.q) };
  };
  const out: ResolvedSection[] = (assignment.sections ?? []).map((s) => ({
    heading: s.heading,
    intro: s.intro,
    callouts: s.callouts ?? [],
    figures: s.figures ?? [],
    layout: s.layout ?? 'auto',
    problems: s.questionIds.map(resolve).filter((p): p is ResolvedProblem => p !== null),
  }));
  if (byId.size > 0) {
    const rest = [...byId.values()]
      .sort((a, b) => a.index - b.index)
      .map(({ q }) => resolve(q.id))
      .filter((p): p is ResolvedProblem => p !== null);
    out.push({ heading: '', callouts: [], figures: [], layout: 'auto', problems: rest });
  }
  return out;
}

/** The section a question belongs to — its instruction context on the canvas. */
export function sectionOf(assignment: AssignmentData, questionId: number): ResolvedSection | undefined {
  return documentSections(assignment).find((s) => s.problems.some((p) => p.question.id === questionId));
}

/** Consecutive problems of one shape, the unit the renderer lays out: a
 *  `table` run is a grid, a `compact` run columns, a `full` run stacked. The
 *  section's `layout` overrides the shape: `list` stacks everything,
 *  `columns` / `grid` flow every run that way. */
export interface ProblemRun {
  flow: 'grid' | 'columns' | 'stack';
  problems: ResolvedProblem[];
}

export function problemRuns(section: ResolvedSection): ProblemRun[] {
  const flowOf = (shape: ProblemShape): ProblemRun['flow'] => {
    switch (section.layout) {
      case 'list': return 'stack';
      case 'columns': return shape === 'full' ? 'stack' : 'columns';
      case 'grid': return shape === 'full' ? 'stack' : 'grid';
      default: return shape === 'table' ? 'grid' : shape === 'compact' ? 'columns' : 'stack';
    }
  };
  const runs: ProblemRun[] = [];
  for (const p of section.problems) {
    const flow = flowOf(p.shape);
    const last = runs[runs.length - 1];
    if (last && last.flow === flow) last.problems.push(p);
    else runs.push({ flow, problems: [p] });
  }
  return runs;
}

export function placementOf(x: { placement?: Figure['placement'] }): NonNullable<Figure['placement']> {
  return x.placement ?? 'after';
}

/** A figure's `src` as the browser should load it: data URLs and absolute
 *  URLs verbatim, a public-root path under the app's base URL. */
export function figureUrl(src: string, baseUrl: string): string {
  if (/^(?:data:|blob:|https?:\/\/|\/)/i.test(src)) return src;
  return baseUrl.replace(/\/?$/, '/') + src.replace(/^\.?\//, '');
}

/** Every figure in the document, with where it hangs — for the check tool's
 *  "figure sources resolve" pin and the editor's size accounting. */
export function collectFigures(assignment: AssignmentData): { where: string; figure: Figure }[] {
  const out: { where: string; figure: Figure }[] = [];
  const fromCallouts = (where: string, callouts: Callout[] | undefined) =>
    (callouts ?? []).forEach((c, i) => (c.figures ?? []).forEach((f) => out.push({ where: `${where} callout ${i + 1}`, figure: f })));
  (assignment.sections ?? []).forEach((s, i) => {
    const where = `section ${i + 1}`;
    (s.figures ?? []).forEach((f) => out.push({ where, figure: f }));
    fromCallouts(where, s.callouts);
  });
  for (const q of assignment.questions) {
    (q.figures ?? []).forEach((f) => out.push({ where: q.label, figure: f }));
    fromCallouts(q.label, q.callouts);
  }
  return out;
}

const LAYOUTS: readonly SectionLayout[] = ['auto', 'list', 'columns', 'grid'];
const PLACEMENTS = ['before', 'aside', 'after'];

/** The document invariants, as human-readable problems (empty = valid):
 *  sections list existing ids once each and between them cover every
 *  question; callouts have a known kind and a body; figures have a source and
 *  alt text; layouts and placements are known values. */
export function validateDocument(assignment: AssignmentData): string[] {
  const problems: string[] = [];
  const ids = new Set(assignment.questions.map((q) => q.id));
  const seen = new Set<number>();
  const checkCallouts = (where: string, callouts: Callout[] | undefined) =>
    (callouts ?? []).forEach((c, i) => {
      const at = `${where} callout ${i + 1}`;
      if (!CALLOUT_KINDS.includes(c.kind)) problems.push(`${at}: unknown kind "${c.kind}"`);
      if (!c.body?.trim()) problems.push(`${at}: empty body`);
      if (c.placement && !PLACEMENTS.includes(c.placement)) problems.push(`${at}: unknown placement "${c.placement}"`);
      checkFigures(at, c.figures);
    });
  const checkFigures = (where: string, figures: Figure[] | undefined) =>
    (figures ?? []).forEach((f, i) => {
      const at = `${where} figure ${i + 1}`;
      if (!f.src?.trim()) problems.push(`${at}: empty src`);
      if (!f.alt?.trim()) problems.push(`${at}: empty alt`);
      if (f.placement && !PLACEMENTS.includes(f.placement)) problems.push(`${at}: unknown placement "${f.placement}"`);
    });
  (assignment.sections ?? []).forEach((s: AssignmentSection, i) => {
    const where = `section ${i + 1}${s.heading ? ` (${s.heading})` : ''}`;
    if (typeof s.heading !== 'string') problems.push(`${where}: heading is not a string`);
    if (!Array.isArray(s.questionIds)) {
      problems.push(`${where}: questionIds missing`);
    } else {
      for (const id of s.questionIds) {
        if (!ids.has(id)) problems.push(`${where}: question id ${id} does not exist`);
        else if (seen.has(id)) problems.push(`${where}: question id ${id} listed twice`);
        seen.add(id);
      }
    }
    if (s.layout && !LAYOUTS.includes(s.layout)) problems.push(`${where}: unknown layout "${s.layout}"`);
    checkCallouts(where, s.callouts);
    checkFigures(where, s.figures);
  });
  if (assignment.sections) {
    for (const q of assignment.questions) {
      if (!seen.has(q.id)) problems.push(`${q.label} (id ${q.id}) is in no section`);
    }
  }
  for (const q of assignment.questions) {
    checkCallouts(q.label, q.callouts);
    checkFigures(q.label, q.figures);
  }
  return problems;
}
