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
//
// Pure: no storage, no clock (the caller passes `now`) — the server imports it.

import type { AssignmentData, GradeEvent, Points, SubmissionRecord } from '../types';
import { scoreRecord, scoreSubmission, type ProblemSource, type Score, type ScoreInput } from '../engine/score';
import { homeworkContentHash } from '../devData/homeworkSync';
import { sortAssignments } from '../assignmentOrder';

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
  /** `late` against the effective due date; `units`/`deduction` stay null
   *  until the course calendar prices lateness (task 068). */
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
}

export interface GradingRow {
  student: GradingIdentity;
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
  released: boolean;
}

/** GET /api/assignments/:id/summary — THE shared summary. */
export interface AssignmentGradingSummary {
  assignmentId: string;
  title: string;
  dueDate?: string;
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
}

/** GET /api/students/:sid — one student across assignments. */
export interface StudentGrading {
  student: GradingIdentity;
  assignments: {
    assignmentId: string;
    title: string;
    dueDate?: string;
    released: boolean;
    questionIds: number[];
    row: GradingRow;
  }[];
}

/** GET /api/assignments/:id/submissions/:sid/:attempt — one attempt in full:
 *  the record (circuits, result with expected/got, integrity, the human grades
 *  in full), that student's grade log, and its score. Instructor-only. */
export interface AttemptDetail {
  student: GradingIdentity;
  record: SubmissionRecord;
  events: GradeEvent[];
  score: Score;
}

/**
 * A student's effective due date — the ONE place an extension and the course
 * calendar's late policy will enter (task 068). Today: the assignment's own
 * due date, and no late deduction (`late` absent — never a silent −5).
 */
export function dueFor(assignment: AssignmentData, _student: GradingIdentity): ScoreInput['due'] {
  return assignment.dueDate ? { at: assignment.dueDate } : undefined;
}

const byName = (a: GradingIdentity, b: GradingIdentity) =>
  a.sortName.localeCompare(b.sortName, undefined, { sensitivity: 'base' }) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

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
): { row: GradingRow; hand: { x: number; y: number } } {
  const due = dueFor(assignment, student);
  if (!record) {
    const s = scoreSubmission({ questions: assignment.questions, latest: null, due, now });
    const grade = { raw: s.raw, final: s.final, provisional: s.provisional, missing: s.missing };
    return { row: { student, latest: null, problems: [], grade }, hand: { x: 0, y: 0 } };
  }
  const s = scoreRecord(assignment.questions, record, now, due);
  const toPerson = s.problems.filter((p) => p.autoPoints === null);
  return {
    row: {
      student,
      latest: {
        attempt: record.attempt,
        submittedAt: record.submittedAt,
        late: {
          late: due !== undefined && Date.parse(record.submittedAt) > Date.parse(due.at),
          units: s.late?.units ?? null,
          deduction: s.late?.deduction ?? null,
        },
        stale: record.result !== undefined && record.assignmentHash !== hash,
      },
      problems: s.problems.map((p) => ({ points: p.points, source: p.source })),
      grade: { raw: s.raw, final: s.final, provisional: s.provisional, missing: s.missing },
    },
    hand: { x: toPerson.filter((p) => p.source === 'human').length, y: toPerson.length },
  };
}

/**
 * One assignment's summary. `latest` holds each submitter's counting attempt,
 * carrying `studentKey` and its human grades (`grades`); a key not on the
 * roster is named by `identify` (which sets `offRoster`).
 */
export function buildAssignmentSummary(input: {
  assignment: AssignmentData;
  roster: readonly GradingIdentity[];
  latest: readonly SubmissionRecord[];
  identify: (key: string) => GradingIdentity;
  released: boolean;
  now: number;
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
  const rosterRows = [...input.roster].sort(byName).map((s) => scoredRow(assignment, hash, s, byKey.get(s.key), now));
  const offRows = [...byKey.keys()]
    .filter((k) => !rostered.has(k))
    .map((k) => input.identify(k))
    .sort(byName)
    .map((s) => scoredRow(assignment, hash, s, byKey.get(s.key), now).row);

  const progress: GradingProgress = {
    roster: rosterRows.length,
    submitted: 0,
    offRosterSubmitted: offRows.length,
    late: 0,
    missing: 0,
    autograded: { current: 0, stale: 0 },
    handGraded: { x: 0, y: 0 },
    released: input.released,
  };
  for (const { row: r, hand } of rosterRows) {
    if (r.grade.missing) progress.missing++;
    if (!r.latest) continue;
    progress.submitted++;
    if (r.latest.late.late) progress.late++;
    if (byKey.get(r.student.key)?.result) progress.autograded[r.latest.stale ? 'stale' : 'current']++;
    progress.handGraded.x += hand.x;
    progress.handGraded.y += hand.y;
  }
  return {
    assignmentId: assignment.id,
    title: assignment.title,
    ...(assignment.dueDate ? { dueDate: assignment.dueDate } : {}),
    questionIds: assignment.questions.map((q) => q.id),
    released: input.released,
    rows: [...rosterRows.map((r) => r.row), ...offRows],
    progress,
  };
}

/** The Grading tab: every assignment (in the catalog's order) with its
 *  progress, and the course-wide counts. */
export function buildCourseGrading(input: {
  roster: readonly GradingIdentity[];
  assignments: readonly { summary: AssignmentGradingSummary; order?: number; visible: boolean }[];
}): CourseGrading {
  const rows = sortAssignments(
    input.assignments.map(({ summary, order, visible }): CourseAssignmentRow => ({
      id: summary.assignmentId,
      title: summary.title,
      ...(order !== undefined ? { order } : {}),
      ...(summary.dueDate ? { dueDate: summary.dueDate } : {}),
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
  };
}

/** One student across assignments (in the catalog's order): the same row
 *  the assignment's summary holds for them. */
export function buildStudentGrading(input: {
  student: GradingIdentity;
  assignments: readonly { assignment: AssignmentData; released: boolean; latest: SubmissionRecord | null }[];
  now: number;
}): StudentGrading {
  const { student } = input;
  return {
    student,
    assignments: sortAssignments(input.assignments.map((a) => ({ ...a, title: a.assignment.title, order: a.assignment.order }))).map(
      ({ assignment, released, latest }) => {
        const summary = buildAssignmentSummary({
          assignment,
          roster: [student],
          latest: latest ? [{ ...latest, studentKey: student.key }] : [],
          identify: () => student,
          released,
          now: input.now,
        });
        return {
          assignmentId: assignment.id,
          title: assignment.title,
          ...(assignment.dueDate ? { dueDate: assignment.dueDate } : {}),
          released,
          questionIds: summary.questionIds,
          row: summary.rows[0],
        };
      },
    ),
  };
}

/** One attempt in full, scored as the counting attempt would be. */
export function buildAttemptDetail(input: {
  assignment: AssignmentData;
  student: GradingIdentity;
  record: SubmissionRecord;
  events: readonly GradeEvent[];
  now: number;
}): AttemptDetail {
  const { assignment, student, record } = input;
  return {
    student,
    record,
    events: [...input.events],
    score: scoreRecord(assignment.questions, record, input.now, dueFor(assignment, student)),
  };
}
