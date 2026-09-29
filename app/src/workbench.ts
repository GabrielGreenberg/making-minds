// The editor workbench's pure parts (task 052; the design memo is
// docs/buildout/designs/editor-workbench.md): the three-column layout's
// widths and collapse states, the question panel's split between the problem
// and the list (task 078), its grouped question list, and the top bar's save
// and submitted labels. No React, no store — the components in
// EditorShell.tsx / QuestionPanel.tsx / PanelDivider.tsx / EditorTopBar.tsx
// render what these decide, and app/tools/workbenchCheck.ts pins them.

import type { AssignmentData, AssignmentQuestion, QuestionCircuit } from './types';
import { questionModeLabel, questionTask } from './types';
import { DEFAULT_CALLOUT_TITLE, documentSections, type ResolvedSection } from './problemSet';
import { fillInShape } from './engine/fillIn';
import { formatDateTime } from './dueDates';

// ── Columns ────────────────────────────────────────────────────────────────

/** A side panel's width range, in px: dragging clamps to it, and so does a
 *  stored width (a pref from an older build or another screen). */
export interface WidthRange { min: number; max: number; initial: number }
export const LEFT_PANEL: WidthRange = { min: 260, max: 480, initial: 320 };
export const RIGHT_PANEL: WidthRange = { min: 240, max: 480, initial: 300 };
/** A collapsed panel's strip. */
export const COLLAPSED_STRIP = 40;

export function clampPanelWidth(v: unknown, range: WidthRange): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return range.initial;
  return Math.round(Math.min(range.max, Math.max(range.min, v)));
}

/** A fraction's range: dragging and a stored value clamp to [min, max]; a
 *  key press moves it by `step`. */
export interface FractionRange { min: number; max: number; initial: number; step: number }

/** The question panel's split (task 078): the problem's share of the panel
 *  below its nav strip, the question list taking the rest. ONE height for
 *  every problem — it never follows the statement's length, so the list sits
 *  still as the student moves through the homework; the divider between them
 *  sets it. The default is about the old look (the problem took what it
 *  needed, up to 64%). */
export const QUESTION_SPLIT: FractionRange = { min: 0.25, max: 0.8, initial: 0.58, step: 0.04 };
/** Neither side of the split collapses below these, in px: the problem keeps
 *  its title, a few lines and the done mark; the list its header (34px, the
 *  nav strip's height), the section label heading a sectioned homework's list
 *  (32px) and two rows (36px each) — workbench.css .qp-list-head /
 *  .qp-list-label / .qp .qp-row. */
export const QUESTION_SPLIT_FLOOR = { statement: 200, list: 34 + 32 + 2 * 36 } as const;

/** The split's range over a panel `height` px tall: QUESTION_SPLIT's, narrowed
 *  so both floors hold — unless the panel is too short for both (or not laid
 *  out), when the fraction range alone applies (the CSS floors then decide).
 *  What the divider reports as its min and max. */
export function questionSplitRange(height?: number): { min: number; max: number } {
  const { min, max } = QUESTION_SPLIT;
  if (height === undefined || !(height > 0)) return { min, max };
  const lo = Math.max(min, QUESTION_SPLIT_FLOOR.statement / height);
  const hi = Math.min(max, 1 - QUESTION_SPLIT_FLOOR.list / height);
  return lo <= hi ? { min: lo, max: hi } : { min, max };
}

/** A split clamped to its range (questionSplitRange: given the panel's
 *  height, both floors hold as well); junk (a pref from nowhere) is the
 *  initial one. Rounded to 0.001, so a stored value stays short. At a height,
 *  this is also the split ON SCREEN: the pane's CSS floors turn a stored split
 *  outside the height's range (stored on a taller window) into its end. */
export function clampQuestionSplit(v: unknown, height?: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return QUESTION_SPLIT.initial;
  const { min, max } = questionSplitRange(height);
  return Math.round(Math.min(max, Math.max(min, v)) * 1000) / 1000;
}

/** The split after dragging its divider `dy` px down, over a panel `height` px
 *  tall (a panel not laid out just clamps). The drag starts from the split on
 *  screen — `start` clamped to the height — not the stored one, so the
 *  divider follows the pointer from its first pixel. */
export function questionSplitFromDrag(start: number, dy: number, height: number): number {
  return height > 0 ? clampQuestionSplit(clampQuestionSplit(start, height) + dy / height, height) : clampQuestionSplit(start);
}

/** The split after one arrow key on its divider (+1 = ↓, −1 = ↑): a step
 *  from the split on screen, so every press shows. */
export function questionSplitFromStep(split: number, dir: 1 | -1, height: number): number {
  return clampQuestionSplit(clampQuestionSplit(split, height) + dir * QUESTION_SPLIT.step, height);
}

export interface EditorLayout { leftW: number; rightW: number; leftOpen: boolean; rightOpen: boolean; qpSplit: number }

/** The uiPrefs keys (one bag per browser — uiPrefs.ts; cosmetic only). Every
 *  layout field has one: EditorShell stores a change under its key. */
export const EDITOR_PREF_KEYS = {
  leftW: 'editor.leftW',
  rightW: 'editor.rightW',
  leftOpen: 'editor.leftOpen',
  rightOpen: 'editor.rightOpen',
  qpSplit: 'editor.qpSplit',
} as const;

/** The layout a browser's stored prefs describe: widths and the split
 *  clamped, both panels open unless a pref says exactly false. The right
 *  column inherits the old data panel's own width pref (`panelWidth`, before
 *  task 052) until it has one of its own. */
export function editorLayoutFromPrefs(prefs: Record<string, unknown>): EditorLayout {
  return {
    leftW: clampPanelWidth(prefs[EDITOR_PREF_KEYS.leftW], LEFT_PANEL),
    rightW: clampPanelWidth(prefs[EDITOR_PREF_KEYS.rightW] ?? prefs.panelWidth, RIGHT_PANEL),
    leftOpen: prefs[EDITOR_PREF_KEYS.leftOpen] !== false,
    rightOpen: prefs[EDITOR_PREF_KEYS.rightOpen] !== false,
    qpSplit: clampQuestionSplit(prefs[EDITOR_PREF_KEYS.qpSplit]),
  };
}

// ── The question list ──────────────────────────────────────────────────────

/** The student's own mark on a question — never a grade or a match against
 *  the answer: 'done' is their Mark done, 'started' means they put anything
 *  on it (a part on the canvas, answer text, a filled blank). */
export type QuestionMark = 'done' | 'started' | null;

export function questionMark(qc: QuestionCircuit | undefined): QuestionMark {
  if (!qc) return null;
  if (qc.done) return 'done';
  const started =
    qc.components.length > 0 ||
    (qc.responseText ?? '').trim() !== '' ||
    (qc.fillAnswers ?? []).some((a) => a.trim() !== '');
  return started ? 'started' : null;
}

/** The list's type tag: a machine question shows its mode (CC, SC -
 *  perception, turbot - FSM …) as the accent tag; a prose one says what it
 *  asks for — "Written" (open), "Table" (an argument–value table), "Number"
 *  (every blank digits-only) or "Fill-in". */
export function questionListTag(
  q: Pick<AssignmentQuestion, 'buildMode' | 'innerMode' | 'perception' | 'fill_in'>,
): { text: string; machine: boolean } {
  const task = questionTask(q);
  if (task === 'open') return { text: 'Written', machine: false };
  if (task === 'fill-in') {
    const shape = q.fill_in ? fillInShape(q.fill_in) : null;
    if (shape?.kind === 'table') return { text: 'Table', machine: false };
    const blanks = shape?.blanks ?? [];
    return { text: blanks.length > 0 && blanks.every((b) => b.digitsOnly) ? 'Number' : 'Fill-in', machine: false };
  }
  return { text: questionModeLabel(q), machine: true };
}

export interface QuestionListRow {
  /** Position in `assignment.questions` of the problem's page (its first
   *  part) — what navigation takes. */
  index: number;
  /** The document's number ("6", "12"). */
  number: string;
  /** The problem's title, or null when untitled (the row then shows the label). */
  title: string | null;
  label: string;
  tag: { text: string; machine: boolean };
  mark: QuestionMark;
  current: boolean;
}

export interface QuestionListSection { heading: string; rows: QuestionListRow[] }

/** A multi-part problem's mark over its parts' (task 048): done only when
 *  every part is (its one Mark done), started when any part holds work. */
export function problemMark(parts: readonly QuestionMark[]): QuestionMark {
  if (parts.length > 0 && parts.every((m) => m === 'done')) return 'done';
  return parts.some((m) => m !== null) ? 'started' : null;
}

/**
 * The question panel's list: the document's sections (problemSet.ts
 * documentSections — the same grouping and numbering as the overview), each
 * PROBLEM a row with its tag and the student's mark — a multi-part problem
 * one row, marked over its parts, tagged by the kind its parts share (else
 * "Written"); a section with no problems (a rules preamble) has nothing to
 * navigate to and is left out. `circuitOf` answers a question's work — the
 * caller folds the live problem in for the open one.
 */
export function questionList(
  assignment: AssignmentData,
  circuitOf: (questionId: number) => QuestionCircuit | undefined,
  currentIndex: number,
): QuestionListSection[] {
  return documentSections(assignment).filter((section) => section.problems.length > 0).map((section) => ({
    heading: section.heading,
    rows: section.problems.map((p) => {
      const tags = p.parts.map((part) => questionListTag(part.question));
      const shared = tags.every((t) => t.text === tags[0].text);
      return {
        index: p.index,
        number: p.number,
        title: p.question.title?.trim() || null,
        label: p.label,
        tag: shared ? tags[0] : { text: 'Written', machine: false },
        mark: problemMark(p.parts.map((part) => questionMark(circuitOf(part.question.id)))),
        current: p.parts.some((part) => part.index === currentIndex),
      };
    }),
  }));
}

/** The current question's heading: "Problem 1 · NAND", or just the label. */
export function questionHeading(q: Pick<AssignmentQuestion, 'label' | 'title'>): string {
  const title = q.title?.trim();
  return title ? `${q.label} · ${title}` : q.label;
}

/** The list header's short name for a homework: "HW1" from "HW1. Basics: …";
 *  null when the title has no such leading code. */
export function assignmentShortName(title: string): string | null {
  const m = /^([A-Za-z]{1,6}\s?\d+[a-z]?)\b/.exec(title.trim());
  return m ? m[1] : null;
}

/** The link that opens a section's notes, named by what is behind it: the
 *  one callout's own title ("Challenge problem (optional)"),
 *  else its kind ("Hint for this section"); a lone figure is a figure;
 *  several things are counted. Null when the section has none. */
export function sectionNotesLabel(section: Pick<ResolvedSection, 'callouts' | 'figures'>): string | null {
  const count = section.callouts.length + section.figures.length;
  if (count === 0) return null;
  if (count > 1) return `Notes for this section (${count})`;
  const [callout] = section.callouts;
  if (!callout) return 'Figure for this section';
  if (callout.title?.trim()) return callout.title.trim();
  const kind = DEFAULT_CALLOUT_TITLE[callout.kind].replace(/[:!.]+$/, '').trim();
  return `${kind || 'Note'} for this section`;
}

// ── The top bar's labels ───────────────────────────────────────────────────

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error';

/** What the top bar says about saving. A pending (debounced) save reads as
 *  "Saving…" — it is on its way; the time since the last confirmed save is
 *  in whole minutes, refreshed by the caller every 30 seconds. */
export function saveLabel(
  status: SaveStatus,
  lastSavedAt: number | null,
  now: number,
): { text: string; error: boolean } {
  if (status === 'error') return { text: 'Not saved — retrying', error: true };
  if (status === 'saving' || status === 'unsaved') return { text: 'Saving…', error: false };
  if (lastSavedAt == null) return { text: 'Saved', error: false };
  const minutes = Math.floor(Math.max(0, now - lastSavedAt) / 60_000);
  if (minutes < 1) return { text: 'Saved just now', error: false };
  if (minutes < 60) return { text: `Saved ${minutes} min ago`, error: false };
  return { text: `Saved at ${clock(lastSavedAt)}`, error: false };
}

/** "Submitted 3:42 PM" today; "Submitted Sep 20, 4:12 PM" on another day. */
export function submittedLabel(submittedAtIso: string, now: number): string {
  const at = new Date(submittedAtIso);
  const sameDay = at.toDateString() === new Date(now).toDateString();
  return `Submitted ${sameDay ? clock(at.getTime()) : formatDateTime(submittedAtIso)}`;
}

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
