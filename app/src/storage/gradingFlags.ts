// Flags on students (task 2026-09-26-070; design memo
// docs/buildout/designs/grading-interface.md §8, decision 13): prompts to
// LOOK, never verdicts. Pure functions over the grading summaries (task 064)
// and the course's thresholds — no flag stores state, so a flag is gone the
// moment what raised it is (a late submission lands, a classmate lists back).
//
//   · Per assignment (`assignmentFlags`, run by the summary builder, so every
//     summary row carries its own): not submitted by the effective due date ·
//     very late (> veryLateDays past it, or nothing by then) · group mismatch
//     (a listed classmate doesn't list back once both submitted or their due
//     date passed; or more than maxGroupSize people listed together) ·
//     integrity (problems carrying integrity flags, counted per row) ·
//     identical open-response text across students ("same group" when a
//     reciprocal listing explains it).
//   · Course-wide (`courseFlags`, the Grading tab and the student page): the
//     union of every PUBLISHED assignment's row flags, plus struggling (a
//     settled grade under struggleBelow on struggleRun consecutive counted
//     sets) and no account (on the roster, none set up noAccountDays after
//     the first class meeting).
//
// Roster students only: an off-roster submitter (removed, an instructor's
// test) is never flagged. Keys only — a flag names classmates by their opaque
// `GradingIdentity.key` and carries no email, name or answer text, so it can
// ride in every summary. Pure: no storage, no clock (the caller passes `now`);
// no grader or scorer (the remote store imports this — remoteStoreCheck's
// gate), and the server imports it.

import type { AssignmentGradingSummary, GradingIdentity, GradingRow } from './gradingSummary';
import type { CourseCalendar } from '../engine/score';
import { sortAssignments } from '../assignmentOrder';

/** The thresholds every rule reads (`course_settings.flagThresholds`; local:
 *  localStorage `mm:flag-thresholds`). Whole numbers. */
export interface FlagThresholds {
  /** A submission this many days past the effective due date, or none by then. */
  veryLateDays: number;
  /** A settled final grade below this… */
  struggleBelow: number;
  /** …on this many consecutive counted sets. */
  struggleRun: number;
  /** No account this many days after the first class meeting. */
  noAccountDays: number;
  /** More people than this listed together is a mismatch (the policy's 3). */
  maxGroupSize: number;
  /** Open answers shorter than this (trimmed) are never compared. */
  identicalTextMinChars: number;
}

export const DEFAULT_FLAG_THRESHOLDS: FlagThresholds = {
  veryLateDays: 14,
  struggleBelow: 70,
  struggleRun: 2,
  noAccountDays: 7,
  maxGroupSize: 3,
  identicalTextMinChars: 20,
};

/** Each threshold's allowed range (whole numbers; a value outside is clamped). */
export const FLAG_THRESHOLD_RANGE: Record<keyof FlagThresholds, { min: number; max: number }> = {
  veryLateDays: { min: 1, max: 365 },
  struggleBelow: { min: 1, max: 100 },
  struggleRun: { min: 1, max: 20 },
  noAccountDays: { min: 0, max: 365 },
  maxGroupSize: { min: 1, max: 20 },
  identicalTextMinChars: { min: 1, max: 10_000 },
};

/** Whatever was stored or sent → a full set of thresholds: each whole-number
 *  field clamped into its range, anything missing or not a finite number the
 *  default. Never throws. */
export function normalizeThresholds(raw: unknown): FlagThresholds {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_FLAG_THRESHOLDS };
  for (const key of Object.keys(DEFAULT_FLAG_THRESHOLDS) as (keyof FlagThresholds)[]) {
    const v = src[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const { min, max } = FLAG_THRESHOLD_RANGE[key];
    out[key] = Math.min(max, Math.max(min, Math.round(v)));
  }
  return out;
}

export type StudentFlagKind =
  | 'not-submitted'
  | 'very-late'
  | 'struggling'
  | 'no-account'
  | 'group-mismatch'
  | 'integrity'
  | 'identical-text';

/** One prompt to look. `detail` is plain words for a tooltip — never a name,
 *  email or answer: classmates are `others` (opaque keys). */
export interface StudentFlag {
  kind: StudentFlagKind;
  /** The assignment it is about (absent: course-wide — no account, struggling). */
  assignmentId?: string;
  /** The problem it is about (identical text). */
  questionId?: number;
  /** The classmates involved (group mismatch, identical text), by key. */
  others?: string[];
  /** Identical text only: every other student with the same text listed this
   *  one reciprocally — a group explains it. Still shown. */
  sameGroup?: boolean;
  detail: string;
}

/** A roster student with at least one flag (the Grading tab's list). */
export interface FlaggedStudent {
  student: GradingIdentity;
  flags: StudentFlag[];
}

const DAY_MS = 86_400_000;

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** A row's effective due date: their extension, else the assignment's. */
function effectiveDue(row: GradingRow, dueDate: string | undefined): number | null {
  const at = row.extendedTo ?? dueDate;
  const t = at ? Date.parse(at) : NaN;
  return Number.isFinite(t) ? t : null;
}

/**
 * One assignment's flags, per roster row (by key). `rows` are the summary's
 * (roster rows carry no `offRoster`; the others are ignored), each with its
 * `group` listing; `openText` maps a row's key to its open answers'
 * fingerprints by question (the builder computes them and never ships them).
 */
export function assignmentFlags(input: {
  assignmentId: string;
  dueDate?: string;
  rows: readonly GradingRow[];
  openText: ReadonlyMap<string, ReadonlyMap<number, string>>;
  thresholds: FlagThresholds;
  now: number;
}): Map<string, StudentFlag[]> {
  const { assignmentId, thresholds: t, now } = input;
  const roster = input.rows.filter((r) => !r.student.offRoster);
  const byKey = new Map(roster.map((r) => [r.student.key, r]));
  const out = new Map<string, StudentFlag[]>();
  const add = (key: string, flag: Omit<StudentFlag, 'assignmentId'>) =>
    out.set(key, [...(out.get(key) ?? []), { ...flag, assignmentId }]);
  const lists = (a: string, b: string) => !!byKey.get(a)?.group?.includes(b);

  for (const r of roster) {
    const key = r.student.key;
    const due = effectiveDue(r, input.dueDate);
    // Not submitted: the score's own "missing" — past the effective due date.
    if (r.grade.missing) add(key, { kind: 'not-submitted', detail: 'no submission past the due date' });
    // Very late.
    if (due !== null) {
      const limit = t.veryLateDays * DAY_MS;
      if (r.latest) {
        const by = Date.parse(r.latest.submittedAt) - due;
        if (by > limit) add(key, { kind: 'very-late', detail: `submitted ${Math.floor(by / DAY_MS)} days after the due date` });
      } else if (now - due > limit) {
        add(key, { kind: 'very-late', detail: `nothing ${t.veryLateDays} days after the due date` });
      }
    }
    // Integrity, counted per row.
    const flagged = r.problems.filter((p) => p.flags?.length).length;
    if (flagged > 0) add(key, { kind: 'integrity', detail: `${plural(flagged, 'problem')} with integrity flags` });
  }

  // Group mismatch: a listing not returned — once the classmate has
  // submitted, or their due date has passed — flags both.
  const mismatch = new Map<string, { others: Set<string>; details: Set<string> }>();
  const mark = (key: string, other: string | null, detail: string) => {
    const m = mismatch.get(key) ?? { others: new Set<string>(), details: new Set<string>() };
    if (other) m.others.add(other);
    m.details.add(detail);
    mismatch.set(key, m);
  };
  for (const a of roster) {
    for (const b of a.group ?? []) {
      const other = byKey.get(b);
      if (!other) {
        mark(a.student.key, null, 'lists a classmate who is not on the roster');
        continue;
      }
      if (lists(b, a.student.key)) continue;
      const bDue = effectiveDue(other, input.dueDate);
      if (other.latest || (bDue !== null && now > bDue)) {
        const detail = other.latest ? 'a listed group member did not list them back' : 'a listed group member never submitted';
        mark(a.student.key, b, detail);
        mark(b, a.student.key, other.latest ? 'listed by a classmate they did not list' : 'listed by a classmate; no submission');
      }
    }
  }
  // …and more people listed together (either way) than a group may hold.
  const seen = new Set<string>();
  for (const start of roster) {
    if (seen.has(start.student.key) || !start.group?.length) continue;
    const component: string[] = [];
    const stack = [start.student.key];
    seen.add(start.student.key);
    while (stack.length) {
      const k = stack.pop()!;
      component.push(k);
      const next = [...(byKey.get(k)?.group ?? []), ...roster.filter((r) => r.group?.includes(k)).map((r) => r.student.key)];
      for (const n of next) {
        if (byKey.has(n) && !seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    if (component.length > t.maxGroupSize) {
      for (const k of component) {
        for (const o of component) if (o !== k) mark(k, o, `${component.length} people listed together (at most ${t.maxGroupSize})`);
      }
    }
  }
  for (const [key, m] of mismatch) {
    add(key, { kind: 'group-mismatch', others: [...m.others].sort(), detail: [...m.details].join('; ') });
  }

  // Identical open-response text on the same problem across roster students.
  const byText = new Map<string, string[]>();
  for (const r of roster) {
    for (const [qid, fp] of input.openText.get(r.student.key) ?? []) {
      const k = `${qid}\0${fp}`;
      byText.set(k, [...(byText.get(k) ?? []), r.student.key]);
    }
  }
  for (const [k, keys] of byText) {
    if (keys.length < 2) continue;
    const questionId = Number(k.slice(0, k.indexOf('\0')));
    for (const key of keys) {
      const others = keys.filter((o) => o !== key).sort();
      const sameGroup = others.every((o) => lists(key, o) && lists(o, key));
      add(key, {
        kind: 'identical-text',
        questionId,
        others,
        sameGroup,
        detail: `the same open answer as ${plural(others.length, 'classmate')}${sameGroup ? ' (same group)' : ''}`,
      });
    }
  }
  return out;
}

/**
 * A grade the struggling rule may read: past its effective due date (as the
 * student page's counted average reads it), then final and not provisional,
 * or missing. A set not yet due is unsettled even if submitted.
 */
function settled(row: GradingRow, dueDate: string | undefined, now: number): number | null {
  const due = effectiveDue(row, dueDate);
  if (due === null || !(due < now)) return null;
  if (row.grade.missing) return row.grade.final ?? 0;
  return row.grade.final !== null && !row.grade.provisional ? row.grade.final : null;
}

/**
 * The course's flagged roster students: every published assignment's row
 * flags, plus struggling and no account. `summaries` in any order (sorted
 * here as the catalog is); a hidden assignment raises nothing.
 */
export function courseFlags(input: {
  roster: readonly GradingIdentity[];
  summaries: readonly { summary: AssignmentGradingSummary; visible: boolean; order?: number }[];
  thresholds: FlagThresholds;
  calendar?: CourseCalendar;
  now: number;
}): FlaggedStudent[] {
  const t = input.thresholds;
  const shown = sortAssignments(
    input.summaries.filter((s) => s.visible).map((s) => ({ ...s, title: s.summary.title })),
  ).map((s) => s.summary);
  const counted = shown.filter((s) => s.countsTowardGrade !== false);
  const first = input.calendar?.meetings.map((m) => Date.parse(m.start)).filter(Number.isFinite).sort((a, b) => a - b)[0];
  const out: FlaggedStudent[] = [];
  for (const student of input.roster) {
    if (student.offRoster) continue;
    const flags: StudentFlag[] = [];
    if (!student.hasAccount && first !== undefined && input.now > first + t.noAccountDays * DAY_MS) {
      flags.push({ kind: 'no-account', detail: `no account ${t.noAccountDays} days after the first class meeting` });
    }
    // Struggling: consecutive settled counted grades below the line; a set
    // not yet settled (provisional, not due) breaks the run.
    let run = 0;
    let longest = 0;
    for (const s of counted) {
      const row = s.rows.find((r) => r.student.key === student.key);
      const grade = row ? settled(row, s.dueDate, input.now) : null;
      run = grade !== null && grade < t.struggleBelow ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    if (longest >= t.struggleRun) {
      flags.push({ kind: 'struggling', detail: `below ${t.struggleBelow} on ${longest} consecutive counted sets` });
    }
    for (const s of shown) flags.push(...(s.rows.find((r) => r.student.key === student.key)?.flags ?? []));
    if (flags.length) out.push({ student, flags });
  }
  return out;
}
