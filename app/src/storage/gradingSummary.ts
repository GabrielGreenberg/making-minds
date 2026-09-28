// The grading summaries (task 064; design memo
// docs/buildout/designs/grading-interface.md §7.2): what every grading view —
// the Grading tab, an assignment's matrix, a student's page — and task 030's
// Activity tab read, instead of every attempt's full circuits. ONE builder,
// two adapters: the server's (server/src/gradingSummary.ts, over Db rows) and
// the local GradingStore's (storage/gradingStore.ts, over localStorage) — one
// roster join, one definition of "submitted", one score (engine/score.ts).
//
//   · A row per ROSTER student, submitted or not (so nobody is invisible),
//     then every other submitter, flagged `offRoster` (removed from the
//     roster, an instructor's own test, or — locally — nobody on the toy
//     roster). Progress counts roster rows only; off-roster ones are counted
//     apart, so a test submission never inflates "submitted".
//   · Only the LATEST attempt counts (the adapters load no other).
//   · No circuits, answers, cases, notes or emails: a row is identity (an
//     opaque key), attempt meta, points per problem and the grade. One
//     attempt in full is `buildAttemptDetail`, on demand.
//   · Flags (task 2026-09-26-070, storage/gradingFlags.ts): with thresholds
//     the builder asks `assignmentFlags` for every roster row's prompts (the
//     open answers' fingerprints it compares are computed here and never
//     shipped); `buildCourseGrading` adds the course-wide ones.
//   · The hand-grading queue's feed (task 066, `buildQuestionResponses`): one
//     problem across every submitter — the answer itself (text or blanks; a
//     machine only by reference), its points and grade, and who is grading
//     it. No cases, circuits or integrity, and answer keys only as a
//     fingerprint.
//
// Pure: no storage, no clock (the caller passes `now`) — the server imports it.

import type {
  AssignmentData,
  GradeChangeEvent,
  GradeEvent,
  HumanGrade,
  IntegrityFlagCode,
  LateExtension,
  LateWaiver,
  Points,
  StudentNote,
  SubmissionRecord,
} from '../types';
import { questionTask } from '../types';
import { assignmentFlags, courseFlags, type FlaggedStudent, type FlagThresholds, type StudentFlag } from './gradingFlags';
import {
  answerKey,
  scoreRecord,
  scoreSubmission,
  type CourseCalendar,
  type ProblemSource,
  type Score,
  type ScoreInput,
} from '../engine/score';
import { dueInput } from '../lateContext';
import { homeworkContentHash } from '../devData/homeworkSync';
import { sortAssignments } from '../assignmentOrder';
import { sha256, toHex, utf8 } from '../provenance/sha256';
import type { ClaimView } from './gradingClaims';

/** Why a row is not a roster student's: `removed` — their account left the
 *  roster after they submitted; `instructor` — an instructor's own attempt;
 *  `not-rostered` — anyone else (local mode: not a toy student). */
export type OffRoster = 'removed' | 'instructor' | 'not-rostered';

/** A student as the grading views name them — never by email or UID in a
 *  path: `key` is opaque (remote: `users.public_id`, or a derived key for a
 *  removed account; local: the email, as `SubmissionRecord.studentKey`). */
export interface GradingIdentity {
  key: string;
  name: string;
  /** What rows sort by: the class list's sort name, else the name. */
  sortName: string;
  /** Campus UID ('' when unknown — the toy roster has none). */
  uid: string;
  section: string | null;
  /** Has set up their account (remote: a password; local: always). */
  hasAccount: boolean;
  offRoster?: OffRoster;
}

/** The counting attempt, as the row shows it. */
export interface GradingAttemptMeta {
  attempt: number;
  submittedAt: string;
  /** `late` against the effective due date; `units`/`deduction` are the
   *  course calendar's price (task 068) — null whenever the attempt is on
   *  time, or no calendar is known. `deduction` is net of any waiver — what
   *  the grade actually lost. */
  late: { late: boolean; units: number | null; deduction: number | null };
  /** Graded against an older version of the assignment (its content hash
   *  differs; a result with no hash predates the stamp and counts as stale). */
  stale: boolean;
}

/** One problem's points and where they came from — aligned with the
 *  summary's `questionIds` (no id per cell: 80 × 23 of them add up). */
export interface GradingProblem {
  points: Points | null;
  source: ProblemSource;
  /** The integrity flag codes on this problem of the counting attempt (task
   *  034 — things to look at, never a verdict); absent when none. Codes only:
   *  a flag's detail can name a classmate's email, which the summary never
   *  carries — the attempt itself holds the details. */
  flags?: IntegrityFlagCode[];
}

export interface GradingRow {
  student: GradingIdentity;
  /** This student's extension on the assignment (their effective due date),
   *  when they have one (task 068). */
  extendedTo?: string;
  /** Late points waived for them on it (the points only; the note and who
   *  gave it are the attempt detail's). */
  waived?: number;
  /** The classmates their counting attempt lists as its group (task 062),
   *  by `GradingIdentity.key`; absent when none. */
  group?: string[];
  /** This assignment's flags on them (task 070; roster rows only, and only
   *  from a builder given thresholds); absent when none. */
  flags?: StudentFlag[];
  /** null = never submitted. */
  latest: GradingAttemptMeta | null;
  /** Empty when never submitted. */
  problems: GradingProblem[];
  grade: { raw: number | null; final: number | null; provisional: boolean; missing: boolean };
}

export interface GradingProgress {
  /** Roster students. */
  roster: number;
  /** …who have submitted. */
  submitted: number;
  /** Submitters not on the roster (flagged rows). */
  offRosterSubmitted: number;
  /** Roster students whose counting attempt is late. */
  late: number;
  /** Roster students past the due date with no submission. */
  missing: number;
  /** Roster submissions whose autograde is current vs graded against an older version. */
  autograded: { current: number; stale: number };
  /** Of the roster's problems needing a person (open, or ungradable): how many
   *  carry a hand grade (`x`) out of how many (`y`). A changed answer is in y, not x. */
  handGraded: { x: number; y: number };
  /** The grade over the roster's SUBMITTED rows (a missing student is in
   *  `missing`, not a zero here): mean and median of the final grade (null
   *  with no submission), and how many of those grades are provisional. */
  grades: { mean: number | null; median: number | null; provisional: number };
  released: boolean;
}

/** GET /api/assignments/:id/summary — THE shared summary. */
export interface AssignmentGradingSummary {
  assignmentId: string;
  title: string;
  dueDate?: string;
  /** false = not counted toward the course grade (HW7); absent = counts. */
  countsTowardGrade?: boolean;
  questionIds: number[];
  released: boolean;
  rows: GradingRow[];
  progress: GradingProgress;
}

/** One assignment on the Grading tab. */
export interface CourseAssignmentRow {
  id: string;
  title: string;
  order?: number;
  dueDate?: string;
  /** As the summary's: false = not counted (dimmed, listed last). */
  countsTowardGrade?: boolean;
  visible: boolean;
  released: boolean;
  progress: GradingProgress;
}

/** GET /api/grading — every assignment's progress + course-wide counts. */
export interface CourseGrading {
  assignments: CourseAssignmentRow[];
  counts: {
    roster: number;
    /** Roster students who have set up their account. */
    accounts: number;
    /** Roster students with a submission on any assignment. */
    submittedAny: number;
    /** Problems waiting on a person, across assignments (Σ y − x). */
    pendingHandGrading: number;
    /** Stale autogrades across assignments. */
    staleResults: number;
  };
  /** The roster students with flags (task 070), over published assignments. */
  flagged: FlaggedStudent[];
  /** The thresholds they were raised under (the Settings panel's values). */
  thresholds: FlagThresholds;
}

/** A grade-log entry on the student page: which assignment, and the event
 *  without its `student` (the page is theirs; no address rides along). */
export interface StudentHistoryEntry {
  assignmentId: string;
  title: string;
  event: Omit<GradeChangeEvent, 'student'> | Omit<Extract<GradeEvent, { kind: 'regrade' }>, 'student'>;
}

/** The mean of the counted sets so far (task 070; the 071 export reuses it). */
export interface CountedAverage {
  /** null = no counted set is due yet. */
  value: number | null;
  sets: number;
  /** Some grade in it is still provisional. */
  provisional: boolean;
}

/** GET /api/students/:sid — one student across assignments (task 070: the
 *  memo's §6.5 student page). Instructor-only; nothing student-facing reads
 *  the notes. */
export interface StudentGrading {
  student: GradingIdentity;
  assignments: {
    assignmentId: string;
    title: string;
    dueDate?: string;
    /** As the summary's: false = not counted. */
    countsTowardGrade?: boolean;
    released: boolean;
    questionIds: number[];
    row: GradingRow;
  }[];
  /** Their active flags, as the Grading tab's list holds them. */
  flags: StudentFlag[];
  average: CountedAverage;
  /** The private notes log, newest first. */
  notes: StudentNote[];
  /** Grade changes, extensions, waivers and re-grades, newest first. */
  history: StudentHistoryEntry[];
}

/** GET /api/assignments/:id/submissions/:sid/:attempt — one attempt in full:
 *  the record (circuits, result with expected/got, integrity, the human grades
 *  in full), that student's grade log, and its score. Instructor-only. */
export interface AttemptDetail {
  student: GradingIdentity;
  record: SubmissionRecord;
  events: GradeEvent[];
  score: Score;
  /** The student's effective due date (their extension, else the
   *  assignment's); absent = no due date. */
  due?: string;
  /** The extension and the waiver in full — who set them, when, the note
   *  (task 068). Instructor-only, like the rest of the detail. */
  extension?: LateExtension;
  waiver?: LateWaiver;
}

/** What prices lateness for one assignment (task 068): the course calendar
 *  (absent = no deduction is computed, never a silent −5) and each student's
 *  extension and waiver, by `GradingIdentity.key`. Both adapters build it —
 *  the server from its tables, the local store from localStorage. */
export interface LateContext {
  calendar?: CourseCalendar;
  byStudent: ReadonlyMap<string, { extension?: LateExtension; waiver?: LateWaiver }>;
}

/**
 * A student's effective due date and late policy — the ONE hook both
 * grading adapters' builders call (lateContext.ts dueInput): their
 * extension ?? the assignment's date, and, with a calendar, the policy and
 * their waiver.
 */
export function dueFor(assignment: AssignmentData, student: GradingIdentity, late?: LateContext): ScoreInput['due'] {
  const mine = late?.byStudent.get(student.key);
  return dueInput(assignment, { extension: mine?.extension, waived: mine?.waiver?.points }, late?.calendar);
}

const round1 = (x: number) => Math.round(x * 10) / 10;

const byName = (a: GradingIdentity, b: GradingIdentity) =>
  a.sortName.localeCompare(b.sortName, undefined, { sensitivity: 'base' }) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** The row's late marker: on time → no units or deduction (the score's
 *  `late` exists whenever a policy does, on-time attempts included); late →
 *  the priced units and the deduction net of any waiver. */
function lateMeta(
  record: SubmissionRecord,
  due: { at: string } | undefined,
  scored: { late: boolean; units: number; deduction: number; waived: number } | null,
): GradingAttemptMeta['late'] {
  const late = due !== undefined && Date.parse(record.submittedAt) > Date.parse(due.at);
  if (!late || !scored?.late) return { late, units: null, deduction: null };
  return { late, units: scored.units, deduction: Math.max(0, scored.deduction - scored.waived) };
}

/** The integrity flag codes on one problem of a record (task 034). */
function integrityFlags(record: SubmissionRecord, questionId: number): IntegrityFlagCode[] {
  const qi = record.integrity?.questions.find((x) => x.questionId === questionId);
  return qi ? [...new Set(qi.flags.map((f) => f.code))] : [];
}

/** A row, and what it adds to the hand-grading count: problems the
 *  autograde left to a person (open, or nothing to grade against) — `y` — of
 *  which `x` carry a hand grade on the current answer. An override of an
 *  autograded problem is neither (it was never a person's queue). */
function scoredRow(
  assignment: AssignmentData,
  hash: string,
  student: GradingIdentity,
  record: SubmissionRecord | undefined,
  now: number,
  late: LateContext | undefined,
  groupKey: (raw: string) => string | null,
): { row: GradingRow; hand: { x: number; y: number } } {
  const due = dueFor(assignment, student, late);
  const mine = late?.byStudent.get(student.key);
  const group = (record?.submission.group ?? []).map(groupKey).filter((k): k is string => !!k);
  const adjusted = {
    ...(mine?.extension ? { extendedTo: mine.extension.dueDate } : {}),
    ...(mine?.waiver ? { waived: mine.waiver.points } : {}),
    ...(group.length ? { group } : {}),
  };
  if (!record) {
    const s = scoreSubmission({ questions: assignment.questions, latest: null, due, now });
    const grade = { raw: s.raw, final: s.final, provisional: s.provisional, missing: s.missing };
    return { row: { student, ...adjusted, latest: null, problems: [], grade }, hand: { x: 0, y: 0 } };
  }
  const s = scoreRecord(assignment.questions, record, now, due);
  const toPerson = s.problems.filter((p) => p.autoPoints === null);
  return {
    row: {
      student,
      ...adjusted,
      latest: {
        attempt: record.attempt,
        submittedAt: record.submittedAt,
        late: lateMeta(record, due, s.late),
        stale: record.result !== undefined && record.assignmentHash !== hash,
      },
      problems: s.problems.map((p) => {
        const flags = integrityFlags(record, p.questionId);
        return { points: p.points, source: p.source, ...(flags.length ? { flags } : {}) };
      }),
      grade: { raw: s.raw, final: s.final, provisional: s.provisional, missing: s.missing },
    },
    hand: { x: toPerson.filter((p) => p.source === 'human').length, y: toPerson.length },
  };
}

/** An open answer as identical-text compares it: trimmed, whitespace
 *  collapsed, lower-cased, fingerprinted — null below `minChars`. */
function openTextFingerprint(text: string | undefined, minChars: number): string | null {
  const norm = (text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  return norm.length >= minChars ? answerFingerprint(norm) : null;
}

/**
 * One assignment's summary. `latest` holds each submitter's counting attempt,
 * carrying `studentKey` and its human grades (`grades`); a key not on the
 * roster is named by `identify` (which sets `offRoster`). With `thresholds`,
 * every roster row carries its flags (gradingFlags.ts); `groupKey` turns a
 * submission's group listing (`Classmate.key`s) into identity keys — omitted
 * where they already agree (the server's public_id), null = nobody known.
 */
export function buildAssignmentSummary(input: {
  assignment: AssignmentData;
  roster: readonly GradingIdentity[];
  latest: readonly SubmissionRecord[];
  identify: (key: string) => GradingIdentity;
  released: boolean;
  now: number;
  late?: LateContext;
  thresholds?: FlagThresholds;
  groupKey?: (raw: string) => string | null;
}): AssignmentGradingSummary {
  const { assignment, now } = input;
  const hash = homeworkContentHash(assignment);
  const byKey = new Map<string, SubmissionRecord>();
  for (const r of input.latest) {
    const key = r.studentKey ?? '';
    const prev = byKey.get(key);
    if (!prev || r.attempt > prev.attempt) byKey.set(key, r);
  }
  const rostered = new Set(input.roster.map((s) => s.key));
  const groupKey = input.groupKey ?? ((raw: string) => raw);
  const rosterRows = [...input.roster].sort(byName).map((s) => scoredRow(assignment, hash, s, byKey.get(s.key), now, input.late, groupKey));
  const offRows = [...byKey.keys()]
    .filter((k) => !rostered.has(k))
    .map((k) => input.identify(k))
    .sort(byName)
    .map((s) => scoredRow(assignment, hash, s, byKey.get(s.key), now, input.late, groupKey).row);
  if (input.thresholds) {
    const openIds = assignment.questions.filter((q) => questionTask(q) === 'open').map((q) => q.id);
    const openText = new Map<string, Map<number, string>>();
    for (const s of input.roster) {
      const record = byKey.get(s.key);
      const mine = new Map<number, string>();
      for (const qid of openIds) {
        const fp = openTextFingerprint(record?.submission.answers.find((a) => a.questionId === qid)?.responseText, input.thresholds.identicalTextMinChars);
        if (fp) mine.set(qid, fp);
      }
      if (mine.size) openText.set(s.key, mine);
    }
    const flags = assignmentFlags({
      assignmentId: assignment.id,
      dueDate: assignment.dueDate,
      rows: rosterRows.map((r) => r.row),
      openText,
      thresholds: input.thresholds,
      now,
    });
    for (const { row } of rosterRows) {
      const mine = flags.get(row.student.key);
      if (mine?.length) row.flags = mine;
    }
  }

  const progress: GradingProgress = {
    roster: rosterRows.length,
    submitted: 0,
    offRosterSubmitted: offRows.length,
    late: 0,
    missing: 0,
    autograded: { current: 0, stale: 0 },
    handGraded: { x: 0, y: 0 },
    grades: { mean: null, median: null, provisional: 0 },
    released: input.released,
  };
  const finals: number[] = [];
  for (const { row: r, hand } of rosterRows) {
    if (r.grade.missing) progress.missing++;
    if (!r.latest) continue;
    progress.submitted++;
    if (r.grade.final !== null) finals.push(r.grade.final);
    if (r.grade.provisional) progress.grades.provisional++;
    if (r.latest.late.late) progress.late++;
    if (byKey.get(r.student.key)?.result) progress.autograded[r.latest.stale ? 'stale' : 'current']++;
    progress.handGraded.x += hand.x;
    progress.handGraded.y += hand.y;
  }
  if (finals.length) {
    const sorted = [...finals].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    progress.grades.mean = round1(finals.reduce((n, f) => n + f, 0) / finals.length);
    progress.grades.median = round1(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
  }
  return {
    assignmentId: assignment.id,
    title: assignment.title,
    ...(assignment.dueDate ? { dueDate: assignment.dueDate } : {}),
    ...(assignment.countsTowardGrade !== undefined ? { countsTowardGrade: assignment.countsTowardGrade } : {}),
    questionIds: assignment.questions.map((q) => q.id),
    released: input.released,
    rows: [...rosterRows.map((r) => r.row), ...offRows],
    progress,
  };
}

/** The Grading tab: every assignment (in the catalog's order) with its
 *  progress, the course-wide counts, and the flagged roster students (the
 *  summaries built with the same `thresholds`; `calendar` dates "no account"). */
export function buildCourseGrading(input: {
  roster: readonly GradingIdentity[];
  assignments: readonly { summary: AssignmentGradingSummary; order?: number; visible: boolean }[];
  thresholds: FlagThresholds;
  calendar?: CourseCalendar;
  now: number;
}): CourseGrading {
  const rows = sortAssignments(
    input.assignments.map(({ summary, order, visible }): CourseAssignmentRow => ({
      id: summary.assignmentId,
      title: summary.title,
      ...(order !== undefined ? { order } : {}),
      ...(summary.dueDate ? { dueDate: summary.dueDate } : {}),
      ...(summary.countsTowardGrade !== undefined ? { countsTowardGrade: summary.countsTowardGrade } : {}),
      visible,
      released: summary.released,
      progress: summary.progress,
    })),
  );
  const rostered = new Set(input.roster.map((s) => s.key));
  const submitted = new Set<string>();
  for (const { summary } of input.assignments) {
    for (const r of summary.rows) if (r.latest && rostered.has(r.student.key)) submitted.add(r.student.key);
  }
  return {
    assignments: rows,
    counts: {
      roster: input.roster.length,
      accounts: input.roster.filter((s) => s.hasAccount).length,
      submittedAny: submitted.size,
      pendingHandGrading: rows.reduce((n, a) => n + a.progress.handGraded.y - a.progress.handGraded.x, 0),
      staleResults: rows.reduce((n, a) => n + a.progress.autograded.stale, 0),
    },
    flagged: courseFlags({
      roster: input.roster,
      summaries: input.assignments,
      thresholds: input.thresholds,
      ...(input.calendar ? { calendar: input.calendar } : {}),
      now: input.now,
    }),
    thresholds: input.thresholds,
  };
}

/**
 * The mean final grade over the counted sets whose effective due date has
 * passed (a missing one counts as its 0; one not yet due is left out, even
 * if submitted). The caller passes only published sets. The student page's line and the export's column (071).
 */
export function countedAverage(
  rows: readonly { countsTowardGrade?: boolean; dueDate?: string; row: GradingRow }[],
  now: number,
): CountedAverage {
  const finals: number[] = [];
  let provisional = false;
  for (const { countsTowardGrade, dueDate, row } of rows) {
    const at = row.extendedTo ?? dueDate;
    if (countsTowardGrade === false || !at || !(Date.parse(at) < now) || row.grade.final === null) continue;
    finals.push(row.grade.final);
    if (row.grade.provisional) provisional = true;
  }
  return {
    value: finals.length ? round1(finals.reduce((n, f) => n + f, 0) / finals.length) : null,
    sets: finals.length,
    provisional,
  };
}

/**
 * One student across assignments (in the catalog's order). Each row is the
 * one the assignment's FULL summary holds for them (`summary`, when the
 * adapter built it — so the row's flags see the whole class), else a
 * one-student build (never given thresholds: with no classmates a group or
 * identical-text rule would misfire). `flags` are courseFlags' for them (the
 * adapter's, over the full summaries); `events` each assignment's log already
 * filtered to them; `notes` their private notes log.
 */
export function buildStudentGrading(input: {
  student: GradingIdentity;
  assignments: readonly {
    assignment: AssignmentData;
    released: boolean;
    /** false = hidden from students: listed, but left out of the average
     *  (as every flag leaves it out). Absent = shown. */
    visible?: boolean;
    latest: SubmissionRecord | null;
    late?: LateContext;
    summary?: AssignmentGradingSummary;
    events?: readonly GradeEvent[];
  }[];
  flags?: readonly StudentFlag[];
  notes?: readonly StudentNote[];
  now: number;
}): StudentGrading {
  const { student } = input;
  const ordered = sortAssignments(input.assignments.map((a) => ({ ...a, title: a.assignment.title, order: a.assignment.order })));
  const assignments = ordered.map(({ assignment, released, latest, late, summary: full }) => {
    const row =
      full?.rows.find((r) => r.student.key === student.key) ??
      buildAssignmentSummary({
        assignment,
        roster: [student],
        latest: latest ? [{ ...latest, studentKey: student.key }] : [],
        identify: () => student,
        released,
        now: input.now,
        late,
      }).rows[0];
    return {
      assignmentId: assignment.id,
      title: assignment.title,
      ...(assignment.dueDate ? { dueDate: assignment.dueDate } : {}),
      ...(assignment.countsTowardGrade !== undefined ? { countsTowardGrade: assignment.countsTowardGrade } : {}),
      released,
      questionIds: assignment.questions.map((q) => q.id),
      row,
    };
  });
  const history: StudentHistoryEntry[] = ordered.flatMap(({ assignment, events }) =>
    (events ?? []).map((e) => {
      const { student: _who, ...event } = e;
      return { assignmentId: assignment.id, title: assignment.title, event };
    }),
  );
  history.sort((a, b) => (a.event.at < b.event.at ? 1 : a.event.at > b.event.at ? -1 : 0));
  return {
    student,
    assignments,
    flags: [...(input.flags ?? [])],
    // A hidden set is work students were never shown: it never counts.
    average: countedAverage(
      assignments.filter((_, i) => ordered[i]!.visible !== false),
      input.now,
    ),
    notes: [...(input.notes ?? [])].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.id - a.id)),
    history,
  };
}

/** One attempt in full, scored as the counting attempt would be. */
export function buildAttemptDetail(input: {
  assignment: AssignmentData;
  student: GradingIdentity;
  record: SubmissionRecord;
  events: readonly GradeEvent[];
  now: number;
  late?: LateContext;
}): AttemptDetail {
  const { assignment, student, record } = input;
  const due = dueFor(assignment, student, input.late);
  const mine = input.late?.byStudent.get(student.key);
  return {
    student,
    record,
    events: [...input.events],
    score: scoreRecord(assignment.questions, record, input.now, due),
    ...(due ? { due: due.at } : {}),
    ...(mine?.extension ? { extension: mine.extension } : {}),
    ...(mine?.waiver ? { waiver: mine.waiver } : {}),
  };
}

// ── The hand-grading queue's feed (task 066) ─────────────────────────────

/** A response's answer as the queue shows it: an open answer's text, a
 *  fill-in's blanks (in the spec's order; a table's cells row-major), or a
 *  machine by reference — the attempt to open in full, never its circuit. */
export type QueueAnswer =
  | { kind: 'text'; text: string }
  | { kind: 'fill'; blanks: string[] }
  | { kind: 'machine'; attempt: number };

/** One submitter's latest answer to one problem, with where its points
 *  stand. `grade` is the STORED grade row whatever it judged (so a write can
 *  name its `version`) — for a `changed` response it is not the current
 *  points; `suggestion` then offers it. Every `answerKey` here is a
 *  fingerprint (`answerFingerprint`), not the key itself: a machine's key
 *  spells out its parts and wiring. */
export interface QueueResponse {
  student: GradingIdentity;
  attempt: number;
  submittedAt: string;
  answer: QueueAnswer;
  answerKey: string;
  source: ProblemSource;
  points: Points | null;
  autoPoints: Points | null;
  grade: HumanGrade | null;
  suggestion?: HumanGrade;
  /** Who is grading it right now (a soft claim, gradingClaims.ts); null = nobody. */
  claim: ClaimView | null;
}

/** GET /api/assignments/:id/questions/:qid/responses — the queue feed. */
export interface QuestionResponses {
  assignmentId: string;
  questionId: number;
  released: boolean;
  /** Roster submitters, then every other submitter (flagged `offRoster`),
   *  each group in the order of its opaque key — a stable order that never
   *  follows the names, so "Response N" leaks nothing and never renumbers. */
  responses: QueueResponse[];
}

/** An answer key's short, one-way fingerprint: equal answers, equal
 *  fingerprints — without carrying a machine's structure to the client. */
export function answerFingerprint(key: string): string {
  return toHex(sha256(utf8(key))).slice(0, 16);
}

const fingerprinted = (g: HumanGrade): HumanGrade => ({ ...g, answerKey: answerFingerprint(g.answerKey) });

const byKey = (a: GradingIdentity, b: GradingIdentity) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/**
 * One problem across every submitter's latest attempt (the queue, memo
 * §6.4). `latest` and `identify` are as `buildAssignmentSummary`'s; `claims`
 * maps a student key to the live claim on this problem, as the viewer sees
 * it. null = no such question.
 */
export function buildQuestionResponses(input: {
  assignment: AssignmentData;
  questionId: number;
  roster: readonly GradingIdentity[];
  latest: readonly SubmissionRecord[];
  identify: (key: string) => GradingIdentity;
  claims: ReadonlyMap<string, ClaimView>;
  released: boolean;
  now: number;
  late?: LateContext;
}): QuestionResponses | null {
  const { assignment, questionId, now } = input;
  const index = assignment.questions.findIndex((q) => q.id === questionId);
  if (index < 0) return null;
  const question = assignment.questions[index];
  const task = questionTask(question);
  const latestByKey = new Map<string, SubmissionRecord>();
  for (const r of input.latest) {
    const key = r.studentKey ?? '';
    const prev = latestByKey.get(key);
    if (!prev || r.attempt > prev.attempt) latestByKey.set(key, r);
  }
  const rostered = new Map(input.roster.map((s) => [s.key, s]));
  const submitters = [...latestByKey.keys()].map((k) => rostered.get(k) ?? input.identify(k));
  const ordered = [...submitters.filter((s) => rostered.has(s.key)).sort(byKey), ...submitters.filter((s) => !rostered.has(s.key)).sort(byKey)];

  const responses = ordered.map((student): QueueResponse => {
    const record = latestByKey.get(student.key)!;
    const given = record.submission.answers.find((a) => a.questionId === questionId);
    const problem = scoreRecord(assignment.questions, record, now, dueFor(assignment, student, input.late)).problems[index];
    const stored = record.grades?.find((g) => g.questionId === questionId) ?? null;
    const answer: QueueAnswer =
      task === 'open'
        ? { kind: 'text', text: given?.responseText ?? '' }
        : task === 'fill-in'
          ? { kind: 'fill', blanks: [...(given?.fillAnswers ?? [])] }
          : { kind: 'machine', attempt: record.attempt };
    return {
      student,
      attempt: record.attempt,
      submittedAt: record.submittedAt,
      answer,
      answerKey: answerFingerprint(answerKey(question, given)),
      source: problem.source,
      points: problem.points,
      autoPoints: problem.autoPoints,
      grade: stored ? fingerprinted(stored) : null,
      ...(problem.source === 'changed' && problem.suggestion ? { suggestion: fingerprinted(problem.suggestion) } : {}),
      claim: input.claims.get(student.key) ?? null,
    };
  });
  return { assignmentId: assignment.id, questionId, released: input.released, responses };
}
