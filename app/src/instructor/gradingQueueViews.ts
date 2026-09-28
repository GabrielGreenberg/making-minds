// The hand-grading queue's logic (task 066; memo
// docs/buildout/designs/grading-interface.md §6.4), pure — no React.
//
// The queue is a view over the queue feed (storage/gradingSummary.ts
// buildQuestionResponses) and the 064 summary: which response is next, what
// the side list says about each, the counts line, and how a response is
// named with names hidden. Every points value is READ off the feed — the
// builder scored it once — so nothing here grades (gradingViewCheck's grep
// gate). Claims are advisory: "claimed" means "skip it", never "locked".

import type { AssignmentData } from '../types';
import type { AssignmentGradingSummary, GradingIdentity, GradingRow, QueueResponse } from '../storage/gradingSummary';
import { isHandQuestion } from './gradingViews';

/** Where a response stands for the grader looking at it:
 *  `to-grade` — no points yet (pending); `changed` — graded on an older
 *  answer, the old grade a suggestion; `graded` — has points (by hand or the
 *  autograde); `claimed` — another grader has it open right now; `mine` —
 *  the viewer's own live claim on work still to do. */
export type QueueState = 'to-grade' | 'changed' | 'graded' | 'claimed' | 'mine';

/** A claim still live at `now` (it lapses AT `until`). */
function liveClaim(r: Pick<QueueResponse, 'claim'>, now: number) {
  return r.claim && Date.parse(r.claim.until) > now ? r.claim : null;
}

/** What still needs a person, whoever holds it: pending, or changed. */
function workState(r: Pick<QueueResponse, 'source' | 'points'>): 'to-grade' | 'changed' | 'graded' {
  if (r.source === 'changed') return 'changed';
  return r.points === null ? 'to-grade' : 'graded';
}

export function queueState(r: Pick<QueueResponse, 'source' | 'points' | 'claim'>, now: number): QueueState {
  const claim = liveClaim(r, now);
  if (claim && !claim.mine) return 'claimed';
  const work = workState(r);
  return claim?.mine && work !== 'graded' ? 'mine' : work;
}

/** Skipped by Save & next: graded, or someone else is grading it. */
const skipped = (s: QueueState) => s === 'graded' || s === 'claimed';

/**
 * The next response to grade after `from` (−1 = from the top): scans
 * forward, wrapping once (the current response last), skipping graded ones
 * and ones claimed by another grader — the viewer's own claim is not a skip.
 * null = "All caught up".
 */
export function nextToGrade(items: readonly Pick<QueueResponse, 'source' | 'points' | 'claim'>[], from: number, now: number): number | null {
  const n = items.length;
  for (let k = 1; k <= n; k++) {
    const i = (((from + k) % n) + n) % n;
    if (!skipped(queueState(items[i], now))) return i;
  }
  return null;
}

/** J / K: the adjacent response (`dir` +1 next, −1 previous), skipping only
 *  ones another grader holds; no wrap — null at either end. */
export function step(items: readonly Pick<QueueResponse, 'source' | 'points' | 'claim'>[], from: number, dir: 1 | -1, now: number): number | null {
  for (let i = from + dir; i >= 0 && i < items.length; i += dir) {
    if (queueState(items[i], now) !== 'claimed') return i;
  }
  return null;
}

export interface QueueCounts {
  graded: number;
  total: number;
  changed: number;
  toGo: number;
  text: string;
}

/** "x of y graded · c changed · n to go" — by the work, not the claims. */
export function queueCounts(items: readonly Pick<QueueResponse, 'source' | 'points'>[]): QueueCounts {
  const states = items.map(workState);
  const graded = states.filter((s) => s === 'graded').length;
  const changed = states.filter((s) => s === 'changed').length;
  const toGo = states.filter((s) => s === 'to-grade').length;
  return { graded, total: items.length, changed, toGo, text: `${graded} of ${items.length} graded · ${changed} changed · ${toGo} to go` };
}

/** How a response is named: its student, or — names hidden — "Response N",
 *  N its place in the feed's stable order (by opaque key, so the number
 *  never follows the names and toggling never renumbers). */
export function responseLabel(index: number, student: Pick<GradingIdentity, 'name'>, hideNames: boolean): string {
  return hideNames ? `Response ${index + 1}` : student.name;
}

/** The per-person ui pref (uiPrefs.ts) behind the Hide names switch: one
 *  browser may be shared by several graders. */
export function hideNamesPrefKey(principal: string): string {
  return `gradingHideNames:${principal.toLowerCase()}`;
}

/** The side list's state text for one response. */
export function stateText(r: Pick<QueueResponse, 'source' | 'points' | 'claim' | 'suggestion'>, now: number): string {
  const s = queueState(r, now);
  if (s === 'claimed') return `claimed by ${r.claim!.by}`;
  if (s === 'changed' || (s === 'mine' && r.source === 'changed')) {
    return r.suggestion ? `↻ was ${pointsText(r.suggestion.points)}` : '↻';
  }
  if (s === 'graded') return pointsText(r.points!);
  return '✎';
}

export function pointsText(p: 0 | 0.5 | 1): string {
  return p === 0.5 ? '½' : String(p);
}

// ── The keys ─────────────────────────────────────────────────────────────

/** What a keystroke asks of the queue card. */
export type QueueKeyAction = 'save-next' | 'choose-0' | 'choose-half' | 'choose-1' | 'next' | 'prev';

/** Where a keystroke landed: `note` — this card's own note field; `field` —
 *  any other field (an input, a select, contenteditable, a textarea that is
 *  not the note); `control` — a button or link; `page` — anywhere else. */
export type QueueKeyTarget = 'note' | 'field' | 'control' | 'page';

/**
 * The queue's keys (0 / h / 1 choose; Enter saves & moves on, Shift+Enter a
 * newline in the note; J / K next / previous), or null when the keystroke is
 * not the queue's. Typing in a field is left alone — the one exception is
 * Enter in the card's OWN note, never in any other textarea. Enter on a
 * button or link clicks it. A modal open over the queue (the topbar's
 * Feedback form, on every Dashboard page since task 076, or any other) owns
 * the keyboard outright: nothing is the queue's while one is up.
 */
export function queueKeyAction(
  key: { key: string; shift: boolean; modifier: boolean },
  target: QueueKeyTarget,
  modalOpen: boolean,
): QueueKeyAction | null {
  if (key.modifier || modalOpen) return null;
  if (key.key === 'Enter') {
    if (key.shift) return null;
    return target === 'note' || target === 'page' ? 'save-next' : null;
  }
  if (target === 'note' || target === 'field') return null;
  switch (key.key.toLowerCase()) {
    case '0': return 'choose-0';
    case 'h': return 'choose-half';
    case '1': return 'choose-1';
    case 'j': return 'next';
    case 'k': return 'prev';
    default: return null;
  }
}

/** Words in an answer (the card's meta line). */
export function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

// ── Which problems, which students ───────────────────────────────────────

/** A submitted row's problems still waiting on a person (pending or changed),
 *  as question ids in the assignment's order. */
export function pendingProblems(summary: AssignmentGradingSummary, row: GradingRow): number[] {
  if (!row.latest) return [];
  return summary.questionIds.filter((_, i) => {
    const p = row.problems[i];
    return !!p && p.points === null;
  });
}

/** The queue's problem picker: every hand (open) problem, and any other
 *  with a response still waiting on a person — in the assignment's order. */
export function queueProblemIds(summary: AssignmentGradingSummary, assignment: AssignmentData): number[] {
  const waiting = new Set(summary.rows.flatMap((r) => pendingProblems(summary, r)));
  return summary.questionIds.filter((id) => {
    const q = assignment.questions.find((x) => x.id === id);
    return (q && isHandQuestion(q)) || waiting.has(id);
  });
}

/** Where the bare /queue lands: the first queue problem with work left,
 *  else the first queue problem; null when there is none at all. */
export function firstQueueProblem(summary: AssignmentGradingSummary, assignment: AssignmentData): number | null {
  const ids = queueProblemIds(summary, assignment);
  const waiting = new Set(summary.rows.flatMap((r) => pendingProblems(summary, r)));
  return ids.find((id) => waiting.has(id)) ?? ids[0] ?? null;
}

/** Every submitter's key in the feed's stable order — roster first, then
 *  the others, each by opaque key — so a by-student "Response N" is the same
 *  N the by-problem queue shows. */
export function submitterKeys(summary: AssignmentGradingSummary): string[] {
  const keys = (rows: GradingRow[]) => rows.map((r) => r.student.key).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const submitted = summary.rows.filter((r) => r.latest);
  return [...keys(submitted.filter((r) => !r.student.offRoster)), ...keys(submitted.filter((r) => !!r.student.offRoster))];
}

/** By student: the submitted rows with a problem still waiting on a person,
 *  in that same order. */
export function studentsWithWork(summary: AssignmentGradingSummary): GradingRow[] {
  const byKey = new Map(summary.rows.map((r) => [r.student.key, r]));
  return submitterKeys(summary).map((k) => byKey.get(k)!).filter((r) => pendingProblems(summary, r).length > 0);
}
