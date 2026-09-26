// The editor workbench's pure parts (task 052; the design memo is
// docs/buildout/designs/editor-workbench.md): the three-column layout's
// widths and collapse states, the question panel's grouped question list,
// and the top bar's save and submitted labels. No React, no store — the
// components in EditorShell.tsx / QuestionPanel.tsx / EditorTopBar.tsx render
// what these decide, and app/tools/workbenchCheck.ts pins them.

import type { AssignmentData, AssignmentQuestion, QuestionCircuit } from './types';
import { questionModeLabel, questionTask } from './types';
import { DEFAULT_CALLOUT_TITLE, documentSections, type ResolvedSection } from './problemSet';
import { fillInBlanks } from './engine/fillIn';
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

export interface EditorLayout { leftW: number; rightW: number; leftOpen: boolean; rightOpen: boolean }

/** The uiPrefs keys (one bag per browser — uiPrefs.ts; cosmetic only). */
export const EDITOR_PREF_KEYS = {
  leftW: 'editor.leftW',
  rightW: 'editor.rightW',
  leftOpen: 'editor.leftOpen',
  rightOpen: 'editor.rightOpen',
} as const;

/** The layout a browser's stored prefs describe: widths clamped, both panels
 *  open unless a pref says exactly false. The right column inherits the old
 *  data panel's own width pref (`panelWidth`, before task 052) until it has
 *  one of its own. */
export function editorLayoutFromPrefs(prefs: Record<string, unknown>): EditorLayout {
  return {
    leftW: clampPanelWidth(prefs[EDITOR_PREF_KEYS.leftW], LEFT_PANEL),
    rightW: clampPanelWidth(prefs[EDITOR_PREF_KEYS.rightW] ?? prefs.panelWidth, RIGHT_PANEL),
    leftOpen: prefs[EDITOR_PREF_KEYS.leftOpen] !== false,
    rightOpen: prefs[EDITOR_PREF_KEYS.rightOpen] !== false,
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
 *  asks for — "Written" (open), "Number" (every blank digits-only) or
 *  "Fill-in". */
export function questionListTag(
  q: Pick<AssignmentQuestion, 'buildMode' | 'innerMode' | 'perception' | 'fill_in'>,
): { text: string; machine: boolean } {
  const task = questionTask(q);
  if (task === 'open') return { text: 'Written', machine: false };
  if (task === 'fill-in') {
    const blanks = q.fill_in ? fillInBlanks(q.fill_in) : [];
    return { text: blanks.length > 0 && blanks.every((b) => b.digitsOnly) ? 'Number' : 'Fill-in', machine: false };
  }
  return { text: questionModeLabel(q), machine: true };
}

export interface QuestionListRow {
  /** Position in `assignment.questions` — what navigation takes. */
  index: number;
  /** The document's number ("6a"). */
  number: string;
  /** The problem's title, or null when untitled (the row then shows the label). */
  title: string | null;
  label: string;
  tag: { text: string; machine: boolean };
  mark: QuestionMark;
  current: boolean;
}

export interface QuestionListSection { heading: string; rows: QuestionListRow[] }

/**
 * The question panel's list: the document's sections (problemSet.ts
 * documentSections — the same grouping and numbering as the overview), each
 * problem a row with its tag and the student's mark; a section with no
 * problems (a rules preamble) has nothing to navigate to and is left out.
 * `circuitOf` answers a question's work — the caller folds the live canvas in
 * for the open one.
 */
export function questionList(
  assignment: AssignmentData,
  circuitOf: (questionId: number) => QuestionCircuit | undefined,
  currentIndex: number,
): QuestionListSection[] {
  return documentSections(assignment).filter((section) => section.problems.length > 0).map((section) => ({
    heading: section.heading,
    rows: section.problems.map((p) => ({
      index: p.index,
      number: p.number,
      title: p.question.title?.trim() || null,
      label: p.question.label,
      tag: questionListTag(p.question),
      mark: questionMark(circuitOf(p.question.id)),
      current: p.index === currentIndex,
    })),
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
 *  one callout's own title ("Challenge problem (optional, not collected)"),
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
