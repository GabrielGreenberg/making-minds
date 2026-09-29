// The problem-set document — the semantics half (pure: no React, no DOM, so
// tools/statementFormatCheck.ts can pin it headlessly). The render half is
// components/ProblemSetDocument.tsx. Types: src/types.ts ("The problem-set
// document"); design memo: docs/buildout/designs/problem-set-document.md.
//
// An assignment's `sections` are a layer OVER its flat `questions[]`: they
// group, order and annotate the problems without owning them. Everything here
// normalises that layer so a renderer never has to think about a missing
// `sections`, a question no section lists, or an id that no longer exists.
//
// A PROBLEM is one or more questions (task 048; memo multi-part-problems.md):
// a printed problem with parts (a), (b), (c) is a run of written questions —
// each still its own grading unit — folded into one problem by `partOf`
// (problemGroups). The student's editor opens a problem as one PAGE, at its
// first part's index; every other part's index lands on that page
// (pageIndexOf).

import type {
  AssignmentData,
  AssignmentQuestion,
  AssignmentSection,
  Callout,
  CalloutKind,
  Figure,
  SectionLayout,
} from './types';
import { CALLOUT_KINDS, questionTask } from './types';
import { parseStatement, statementProse } from './statementFormat';
import { halfCreditProblem } from './engine/score';
import { fillInKeyProblem, fillInShape } from './engine/fillIn';

/** A problem as the document shows it: its first part's question and index
 *  in the flat list (the canvas route — the problem's page), its printed
 *  number, its layout shape, and its parts in order (one, unlettered, for a
 *  problem without parts). */
export interface ResolvedProblem {
  question: AssignmentQuestion;
  index: number;
  number: string;
  /** Its name: the question's label, or a multi-part problem's first label
   *  without its letter ("Problem 6a" → "Problem 6"). */
  label: string;
  shape: ProblemShape;
  parts: ResolvedPart[];
}

/** One part of a problem: its question, its index, and its letter ("a";
 *  '' when the problem has one part). */
export interface ResolvedPart {
  question: AssignmentQuestion;
  index: number;
  letter: string;
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

/** The question indices each section shows, in order — the document's
 *  order, cheap (no statement is parsed). No `sections` → one section with
 *  every question; ids that match no question are dropped; a listed id is
 *  used once; questions no section lists trail in one more section. */
function sectionOrder(assignment: AssignmentData): number[][] {
  const indexOf = new Map(assignment.questions.map((q, index) => [q.id, index]));
  const take = (id: number): number[] => {
    const index = indexOf.get(id);
    if (index === undefined) return [];
    indexOf.delete(id);
    return [index];
  };
  const out = (assignment.sections ?? []).map((s) => s.questionIds.flatMap(take));
  if (indexOf.size > 0) out.push([...indexOf.values()].sort((a, b) => a - b));
  return out;
}

/** One problem of the document, by question index: `parts[0]` is its first
 *  part (its page); `section` is its place in sectionOrder. */
export interface ProblemGroup {
  section: number;
  parts: number[];
}

const groupCache = new WeakMap<AssignmentData, { groups: ProblemGroup[]; pageOf: Map<number, number> }>();

/**
 * The document's problems, in order, each the question indices of its parts.
 * A question joins the problem just before it iff its `partOf` is that
 * problem's first-part id, in the same section, directly after its last part
 * — and both are written (open) questions whose first part is no part itself.
 * Anything else stands as its own problem, so a broken group degrades to
 * separate problems (validateDocument names it). Cheap and memoized per
 * assignment object: selectors and every lock check read it.
 */
export function problemGroups(assignment: AssignmentData): ProblemGroup[] {
  return groupsOf(assignment).groups;
}

function groupsOf(assignment: AssignmentData): { groups: ProblemGroup[]; pageOf: Map<number, number> } {
  const hit = groupCache.get(assignment);
  if (hit) return hit;
  const qs = assignment.questions;
  const groups: ProblemGroup[] = [];
  sectionOrder(assignment).forEach((indices, section) => {
    for (const index of indices) {
      const q = qs[index];
      const last = groups[groups.length - 1];
      const first = last && last.section === section ? qs[last.parts[0]] : undefined;
      const joins =
        q.partOf !== undefined && first !== undefined && first.id === q.partOf && first.partOf === undefined &&
        q.buildMode === 'open' && first.buildMode === 'open';
      if (joins && last) last.parts.push(index);
      else groups.push({ section, parts: [index] });
    }
  });
  const pageOf = new Map<number, number>();
  for (const g of groups) for (const i of g.parts) pageOf.set(i, g.parts[0]);
  const out = { groups, pageOf };
  groupCache.set(assignment, out);
  return out;
}

/** The page a question index opens: its problem's first part (itself when
 *  it is one, or out of range). */
export function pageIndexOf(assignment: AssignmentData, index: number): number {
  return groupsOf(assignment).pageOf.get(index) ?? index;
}

/** The question ids of the problem at `index` — every part, first first
 *  (one id for a problem without parts; none out of range). */
export function problemPartIds(assignment: AssignmentData, index: number): number[] {
  const page = pageIndexOf(assignment, index);
  const group = groupsOf(assignment).groups.find((g) => g.parts[0] === page);
  return (group?.parts ?? []).map((i) => assignment.questions[i].id);
}

/** Every problem's page, in document order — what Prev / Next and "k of M"
 *  walk. */
export function problemPages(assignment: AssignmentData): number[] {
  return groupsOf(assignment).groups.map((g) => g.parts[0]);
}

/** The problem at `index` resolved as the document shows it (its page, its
 *  number, its lettered parts); undefined out of range. */
export function resolveProblem(assignment: AssignmentData, index: number): ResolvedProblem | undefined {
  const page = pageIndexOf(assignment, index);
  const group = groupsOf(assignment).groups.find((g) => g.parts[0] === page);
  return group ? resolveGroup(assignment, group.parts) : undefined;
}

/** The name of the problem holding question `index` (ResolvedProblem.label;
 *  '' out of range). */
export function problemLabel(assignment: AssignmentData, index: number): string {
  return resolveProblem(assignment, index)?.label ?? '';
}

/** What a written question's answer field is: a `line`, a `paragraph`
 *  (an open question — `answerField`, absent = paragraph), labelled
 *  `blanks` or a `table` (a fill-in question — its shape). Null for a
 *  machine question. Reads no key, so a student's copy classifies alike. */
export function writtenKind(q: AssignmentQuestion): 'line' | 'paragraph' | 'blanks' | 'table' | null {
  const task = questionTask(q);
  if (task === 'open') return q.answerField === 'line' ? 'line' : 'paragraph';
  if (task === 'fill-in' && q.fill_in) return fillInShape(q.fill_in).kind === 'table' ? 'table' : 'blanks';
  return null;
}

function resolveGroup(assignment: AssignmentData, indices: number[]): ResolvedProblem {
  const qs = assignment.questions;
  const first = qs[indices[0]];
  const multi = indices.length > 1;
  // Letters from the labels ("Problem 6a" → a) when every part has one and
  // they differ; else by position.
  const fromLabels = indices.map((i) => /\d([a-z])$/i.exec(qs[i].label.trim())?.[1]?.toLowerCase() ?? '');
  const labelled = fromLabels.every((l) => l !== '') && new Set(fromLabels).size === fromLabels.length;
  const parts = indices.map((index, k) => ({
    question: qs[index],
    index,
    letter: !multi ? '' : labelled ? fromLabels[k] : String.fromCharCode(97 + k),
  }));
  const number = problemNumber(first.label, indices[0]);
  const bare = multi ? number.replace(/(\d)[a-z]$/i, '$1') : number;
  return {
    question: first,
    index: indices[0],
    number: bare,
    label: !multi ? first.label : /^(.*\d)[a-z]$/i.exec(first.label.trim())?.[1] ?? `Problem ${bare}`,
    shape: multi || first.stem?.trim() || first.closing?.trim() ? 'full' : problemShape(first),
    parts,
  };
}

/** The sections a renderer draws. No `sections` → one unnamed section with
 *  every question; ids that match no question are dropped; questions no
 *  section lists trail in an unnamed section (an instructor who adds a
 *  question before filing it still sees it); a listed id is used once. Each
 *  section's problems are its problemGroups, parts folded in. */
export function documentSections(assignment: AssignmentData): ResolvedSection[] {
  const listed = assignment.sections ?? [];
  const order = sectionOrder(assignment);
  const out: ResolvedSection[] = order.map((_, i) => {
    const s = listed[i];
    return s
      ? { heading: s.heading, intro: s.intro, callouts: s.callouts ?? [], figures: s.figures ?? [], layout: s.layout ?? 'auto', problems: [] }
      : { heading: '', callouts: [], figures: [], layout: 'auto', problems: [] };
  });
  for (const g of problemGroups(assignment)) out[g.section].problems.push(resolveGroup(assignment, g.parts));
  return out;
}

/** The section a question belongs to — its instruction context on the canvas. */
export function sectionOf(assignment: AssignmentData, questionId: number): ResolvedSection | undefined {
  return documentSections(assignment).find((s) => s.problems.some((p) => p.parts.some((part) => part.question.id === questionId)));
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
  // A lone one-liner between longer problems is not a column: stack it.
  for (const run of runs) if (run.flow === 'columns' && run.problems.length === 1) run.flow = 'stack';
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
 *  alt text; layouts and placements are known values; a question's ½ rule is
 *  sound (engine/score.ts halfCreditProblem); a fill-in question's key fits
 *  its shape (engine/fillIn.ts fillInKeyProblem — so authoring-side: a
 *  student's copy has no key); every `partOf` folds (problemGroups: a
 *  written question directly after its problem's parts, in its section, the
 *  first part no part itself), a part carries no stem or closing, and
 *  `answerField` sits only on a written (open) question. */
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
    const half = halfCreditProblem(q);
    if (half) problems.push(`${q.label}: ${half}`);
    if (questionTask(q) === 'fill-in' && q.fill_in) {
      const key = fillInKeyProblem(q.fill_in, q.fill_in_answers ?? []);
      if (key) problems.push(`${q.label}: ${key}`);
    }
    if (q.answerField !== undefined) {
      if (q.answerField !== 'line' && q.answerField !== 'paragraph') problems.push(`${q.label}: unknown answerField "${q.answerField}"`);
      else if (questionTask(q) !== 'open') problems.push(`${q.label}: answerField is for a written (open) question`);
    }
  }
  // Multi-part problems (task 048): every part must actually fold.
  const byId = new Map(assignment.questions.map((q) => [q.id, q]));
  const folded = new Set(problemGroups(assignment).flatMap((g) => g.parts.slice(1)));
  assignment.questions.forEach((q, index) => {
    if (q.partOf === undefined) return;
    const first = byId.get(q.partOf);
    if (q.stem !== undefined || q.closing !== undefined) problems.push(`${q.label}: a part carries no stem or closing (its problem's first part does)`);
    if (folded.has(index)) return;
    const why = !first
      ? `no question has id ${q.partOf}`
      : first.id === q.id
        ? 'it names itself'
        : first.partOf !== undefined
          ? `${first.label} is itself a part (parts do not nest)`
          : q.buildMode !== 'open' || first.buildMode !== 'open'
            ? 'only written (open) questions have parts'
            : `it must follow ${first.label}'s parts directly, in the same section`;
    problems.push(`${q.label}: part of ${q.partOf}, but ${why}`);
  });
  return problems;
}
