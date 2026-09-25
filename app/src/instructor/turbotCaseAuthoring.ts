// Turbot arena-family authoring (task 010) — the pure half of the question
// creator's "Arenas" section, React-free like fillInAuthoring.ts and
// arenaEditing.ts (TurbotArenasEditor.tsx is the widget over it).
//
// A turbot question is graded on a FAMILY of arenas — `turbot_cases`, each
// with its own success criterion and step budget, and the question passes
// only if every arena does (engine/grader.ts gradeTurbot). The creator edits
// a list of case DRAFTS, one row object per arena — arena, criterion and
// budget together — so adding, duplicating, removing or reordering can never
// split an arena from its criterion. `turbotCasesField` is the ONE writer of
// `turbot_cases`: it drops the row keys and writes each case as exactly
// {arena, maxSteps, criterion}, and nothing here normalises an arena on the
// way in or out, so a no-op edit of an HW family (all ten have 2–3 arenas)
// reproduces it exactly and the homework sync still sees it as untouched.
//
// Arenas are part of the problem statement, not an answer key: students see
// arena #1 on the problem page and in the Map, and the server keeps
// `turbot_cases` whole in a student's copy (server/src/sanitize.ts) — so
// nothing key-like may ever ride inside a case (law 1).
//
// Graded results are positional (`turbotCases[k]` belongs to
// `turbot_cases[k]`, and a replay is `/case/:k`), like every mode's bank —
// so `misplacedArenas` names the saved arenas an edit would shift, for the
// creator's warning and its save confirmation.

import type { AssignmentQuestion, ArenaConfig, TurbotSuccessCriterion, TurbotTestCase } from '../types';
import { arenaHasGoal, criterionNeedsGoal } from '../engine/turbot';
import { blankArena } from './arenaEditing';

export interface TurbotCaseDraft {
  /** The row's identity — its React key and the creator's active-arena
   *  pointer, which survives reorders and removals. A plain counter, never
   *  saved (and never a random id: provenanceCheck's uuid grep gate). */
  key: number;
  arena: ArenaConfig;
  maxSteps: number;
  criterion: TurbotSuccessCriterion;
}

/** A new question's arena budget and criterion. */
export const DEFAULT_MAX_STEPS = 100;
export const DEFAULT_CRITERION: TurbotSuccessCriterion = 'reach-and-stop';

/** The criteria an arena can be graded by, in menu order, with the sentence
 *  the creator shows for each (semantics: engine/turbot.ts
 *  evaluateTurbotCriterion). */
export const TURBOT_CRITERIA: { value: TurbotSuccessCriterion; label: string; hint: string }[] = [
  { value: 'reach-and-stop', label: 'Reach goal and stop', hint: 'The turbot must halt itself (motor 00) on a goal cell.' },
  { value: 'pass-through', label: 'Pass through goal', hint: 'The turbot must visit a goal cell at some step.' },
  { value: 'return-to-start', label: 'Return to start', hint: 'The turbot must end on its starting cell — first visiting a goal cell, if the arena has one.' },
];

export function criterionLabel(criterion: TurbotSuccessCriterion): string {
  return TURBOT_CRITERIA.find((c) => c.value === criterion)?.label ?? criterion;
}

let lastKey = 0;
const freshKey = (): number => ++lastKey;

function defaultDraft(): TurbotCaseDraft {
  return { key: freshKey(), arena: blankArena(), maxSteps: DEFAULT_MAX_STEPS, criterion: DEFAULT_CRITERION };
}

/** The drafts of a saved question: one per arena, in order — never fewer
 *  than one. No cases (a new question, or one of another mode) → one blank
 *  5×5 arena graded by the defaults. Each arena is kept as saved. */
export function turbotCaseDraftsOf(
  q: Pick<AssignmentQuestion, 'turbot_cases'> | undefined,
): TurbotCaseDraft[] {
  const cases = q?.turbot_cases ?? [];
  if (cases.length === 0) return [defaultDraft()];
  return cases.map((c) => ({ key: freshKey(), arena: c.arena, maxSteps: c.maxSteps, criterion: c.criterion }));
}

/** A new arena for the end of the list: blank 5×5, graded like the arena
 *  before it (a family usually shares one criterion and budget). */
export function newTurbotCaseDraft(drafts: readonly TurbotCaseDraft[]): TurbotCaseDraft {
  const last = drafts[drafts.length - 1];
  return {
    key: freshKey(),
    arena: blankArena(),
    maxSteps: last?.maxSteps ?? DEFAULT_MAX_STEPS,
    criterion: last?.criterion ?? DEFAULT_CRITERION,
  };
}

/** Insert a copy of arena `i` right after it — the usual way to grow a
 *  family ("the same corridor, one cell longer"). The copy owns its own
 *  cells, so painting it never touches the original. Returns the new list
 *  and the copy's key (the creator selects it). */
export function duplicateTurbotCase(
  drafts: readonly TurbotCaseDraft[],
  i: number,
): { drafts: TurbotCaseDraft[]; key: number | null } {
  const d = drafts[i];
  if (!d) return { drafts: drafts.slice(), key: null };
  const copy: TurbotCaseDraft = {
    ...d,
    key: freshKey(),
    arena: {
      ...d.arena,
      cells: d.arena.cells.map((row) => row.slice()),
      start: { ...d.arena.start },
    },
  };
  return { drafts: [...drafts.slice(0, i + 1), copy, ...drafts.slice(i + 1)], key: copy.key };
}

/** Remove arena `i` — never the last one: a turbot question is graded on at
 *  least one arena, so the list refuses to empty. */
export function removeTurbotCase(drafts: readonly TurbotCaseDraft[], i: number): TurbotCaseDraft[] {
  if (drafts.length <= 1 || i < 0 || i >= drafts.length) return drafts.slice();
  return drafts.filter((_, j) => j !== i);
}

/** The index of the draft with `key`, or 0 when it is gone (a stale
 *  pointer falls back to the first arena, never off the list). */
export function turbotCaseIndexOf(drafts: readonly TurbotCaseDraft[], key: number | null): number {
  const i = drafts.findIndex((d) => d.key === key);
  return i < 0 ? 0 : i;
}

/** One thing that blocks saving. `arena` is the 0-based row it belongs to
 *  (null = the list as a whole). */
export interface TurbotCaseDefect {
  arena: number | null;
  message: string;
}

/**
 * Everything that makes the drafts unsaveable, each guarding something the
 * grader would otherwise do to every submission:
 *  - no arenas: gradeTurbot skips the question (nothing to pass);
 *  - a goal-less arena under a criterion that needs a goal: no brain can
 *    ever pass it (criterionNeedsGoal), so the whole question would fail;
 *  - a step budget that is not a whole number ≥ 1: the run could never move.
 */
export function turbotCaseDefects(drafts: readonly TurbotCaseDraft[]): TurbotCaseDefect[] {
  if (drafts.length === 0) return [{ arena: null, message: 'A turbot question needs at least one arena.' }];
  const out: TurbotCaseDefect[] = [];
  drafts.forEach((d, i) => {
    if (criterionNeedsGoal(d.criterion) && !arenaHasGoal(d.arena)) {
      out.push({ arena: i, message: 'this success criterion needs at least one goal cell.' });
    }
    if (!Number.isInteger(d.maxSteps) || d.maxSteps < 1) {
      out.push({ arena: i, message: 'max steps must be a whole number of at least 1.' });
    }
  });
  return out;
}

/** The defects as sentences naming their arena ("Arena #2: this success
 *  criterion needs at least one goal cell."); empty = saveable. */
export function turbotCaseProblems(drafts: readonly TurbotCaseDraft[]): string[] {
  return turbotCaseDefects(drafts).map((d) =>
    d.arena === null ? d.message : `Arena #${d.arena + 1}: ${d.message}`);
}

/**
 * The saved arenas whose graded runs an edit would misplace, as their saved
 * 0-based positions, in order; empty = every recorded run still sits beside
 * the arena it was graded in. A graded result is POSITIONAL and carries no
 * arena of its own (`TurbotCaseResult`): the gradebook names run k "#k+1",
 * and a student's "Run this input" (`/case/:k`, store.ts loadCaseInput)
 * replays run k in the question's CURRENT `turbot_cases[k]` — nothing
 * re-maps a recorded result when the question changes. So run k stays with
 * its arena only while the draft saved at k is still at k. `saved` are the
 * drafts the question opened with (none for a new question, or one of
 * another mode), `next` those about to be saved (none when it stops being a
 * turbot question). A draft's `key` survives every edit and move, so
 * appending arenas (Add, or duplicating the last one) is safe; removing,
 * reordering, or inserting before a saved arena (duplicating an earlier one)
 * is not. The same guard as fillInAuthoring.ts misplacedBlanks.
 */
export function misplacedArenas(
  saved: readonly TurbotCaseDraft[],
  next: readonly TurbotCaseDraft[],
): number[] {
  return saved.flatMap((d, k) => (next[k]?.key === d.key ? [] : [k]));
}

/** What `misplacedArenas` means for the gradebook and students, as one
 *  sentence for the creator's warning and its save confirmation. Arenas are
 *  named by their SAVED number — the one their graded runs carry. */
export function misplacedArenasWarning(positions: readonly number[]): string {
  const shown = positions.slice(0, 5).map((k) => `#${k + 1}`).join(', ');
  const more = positions.length > 5 ? ` and ${positions.length - 5} more` : '';
  const which = `arena${positions.length === 1 ? '' : 's'} ${shown}${more}`;
  return (
    `Runs already graded in ${which} will now be listed in the gradebook, and replayed ` +
    `by students' "Run this input", against a different arena, or none — graded runs ` +
    `match arenas by position. To keep each run beside the arena it was graded in, add ` +
    `new arenas at the end instead of moving, removing or inserting one.`
  );
}

/** A row's one-line summary: "7×6 · Pass through goal · 40 steps". */
export function describeTurbotCase(d: TurbotCaseDraft): string {
  const steps = `${d.maxSteps} step${d.maxSteps === 1 ? '' : 's'}`;
  return `${d.arena.width}×${d.arena.height} · ${criterionLabel(d.criterion)} · ${steps}`;
}

/** The saved field, in row order: each case exactly {arena, maxSteps,
 *  criterion}, the row keys dropped and the arena as authored. */
export function turbotCasesField(drafts: readonly TurbotCaseDraft[]): TurbotTestCase[] {
  return drafts.map(({ arena, maxSteps, criterion }) => ({ arena, maxSteps, criterion }));
}
