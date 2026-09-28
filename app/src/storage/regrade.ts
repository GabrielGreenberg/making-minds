// The re-grade (task 069; design memo docs/buildout/designs/grading-interface.md
// §5, mockup 7): results are graded once, at receipt, against the assignment
// as it was — an edit or a homework sync afterwards leaves them stale (their
// `assignmentHash` differs). A re-grade re-runs `gradeSubmission` on each
// student's LATEST attempt against the current assignment. ONE pure planner,
// two adapters, like the summaries: the server's route (server/src/app.ts,
// over Db rows) and the local GradingStore (storage/gradingStore.ts).
//
//   · The plan (the dry run) is the diff: per (student, problem) whose
//     autograde or points would change, before → after, the grade before and
//     after, and whether a human override stands over it (the override stays;
//     the change is flagged). Names, opaque keys and points only — never an
//     email, a case, an answer or a circuit.
//   · `writes` — the new result of every stale latest attempt — is the
//     adapter's, never the wire's: the commit recomputes the plan itself.
//   · Human grades are never an input to change, only to score: judgment is
//     not in `result` (task 063), and carry-forward is answer-keyed.
//   · Older attempts keep their receipt-time results (they don't count).
//
// Pure: no storage, no clock (the caller passes `now`) — the server imports it.

import type { AssignmentData, Points, RegradeEvent, SubmissionRecord, SubmissionResult } from '../types';
import { gradeSubmission } from '../engine/grader';
import { scoreRecord } from '../engine/score';
import { homeworkContentHash } from '../devData/homeworkSync';
import { problemNumber } from '../problemSet';
import { dueFor, type GradingIdentity } from './gradingSummary';

/** A student as the re-grade names them: opaque key and name, nothing else. */
export interface RegradeStudent {
  key: string;
  name: string;
  sortName: string;
}

/** One problem whose points or autograde a re-grade changes. */
export interface RegradeChange {
  student: RegradeStudent;
  questionId: number;
  /** The printed number (problemNumber). */
  number: string;
  attempt: number;
  before: { auto: Points | null; points: Points | null };
  after: { auto: Points | null; points: Points | null };
  /** The student's grade (final, /100) before and after — null without one. */
  gradeBefore: number | null;
  gradeAfter: number | null;
  /** A human override stands over this autograde: the points stay the
   *  person's, the change is flagged for a look. */
  underOverride: boolean;
}

/** The dry run — what a commit would do. The wire shape. */
export interface RegradePlan {
  assignmentId: string;
  /** The current version (homeworkContentHash); a commit may name it
   *  (`expectHash`) so it never lands on a version its dry run didn't see. */
  assignmentHash: string;
  /** Students' latest attempts considered. */
  latest: number;
  /** …of which graded against another version (what a commit rewrites). */
  stale: number;
  /** Per (student, problem), by student name then problem order. */
  changed: RegradeChange[];
  /** Latest attempts with no problem changing. */
  unchanged: number;
  /** Human grades on the latest attempts, untouched by any re-grade: hand
   *  grades (problems the autograde leaves to a person) and overrides. */
  humanGrades: { hand: number; overrides: number };
}

/** A commit's (or dry run's) outcome as the seam returns it. `snapshot`: the
 *  name of the copy taken before the commit (server: a database file;
 *  local: a localStorage key). */
export interface RegradeOutcome {
  plan: RegradePlan;
  committed: boolean;
  snapshot?: string;
  /** The commit named a version (`expectHash`) that is no longer current:
   *  nothing was written, and `plan` is the fresh one. */
  conflict?: boolean;
}

/** What a commit writes: one stale latest attempt's new result. */
export interface RegradeWrite {
  studentKey: string;
  attempt: number;
  fromHash: string | null;
  result: SubmissionResult;
}

const byName = (a: RegradeStudent, b: RegradeStudent) =>
  a.sortName.localeCompare(b.sortName, undefined, { sensitivity: 'base' }) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/**
 * Plan a re-grade. `latest` holds each submitter's counting attempt, carrying
 * `studentKey` and its human grades (`grades`) — as the summaries take them;
 * `identify` names a key. A latest attempt is stale when its stored result
 * was graded against another version (a result with no stamp counts as
 * stale) — the summary's own test, so the banner's count is the plan's.
 */
export function planRegrade(input: {
  assignment: AssignmentData;
  latest: readonly SubmissionRecord[];
  identify: (key: string) => GradingIdentity;
  now: number;
}): { plan: RegradePlan; writes: RegradeWrite[] } {
  const { assignment, now } = input;
  const hash = homeworkContentHash(assignment);
  const byKey = new Map<string, SubmissionRecord>();
  for (const r of input.latest) {
    const key = r.studentKey ?? '';
    const prev = byKey.get(key);
    if (!prev || r.attempt > prev.attempt) byKey.set(key, r);
  }

  const changed: RegradeChange[] = [];
  const writes: RegradeWrite[] = [];
  const humanGrades = { hand: 0, overrides: 0 };
  const touched = new Set<string>();
  let stale = 0;
  for (const [key, record] of byKey) {
    const identity = input.identify(key);
    const due = dueFor(assignment, identity);
    const before = scoreRecord(assignment.questions, record, now, due);
    for (const p of before.problems) {
      if (!record.grades?.some((g) => g.questionId === p.questionId)) continue;
      if (p.autoPoints === null) humanGrades.hand++;
      else humanGrades.overrides++;
    }
    if (record.result === undefined || record.assignmentHash === hash) continue;
    stale++;
    const result = gradeSubmission(assignment, record.submission);
    writes.push({ studentKey: key, attempt: record.attempt, fromHash: record.assignmentHash ?? null, result });
    const after = scoreRecord(assignment.questions, { ...record, result }, now, due);
    const student: RegradeStudent = { key: identity.key, name: identity.name, sortName: identity.sortName };
    after.problems.forEach((a, i) => {
      const b = before.problems[i];
      if (a.autoPoints === b.autoPoints && a.points === b.points) return;
      touched.add(key);
      changed.push({
        student,
        questionId: a.questionId,
        number: problemNumber(assignment.questions[i].label, i),
        attempt: record.attempt,
        before: { auto: b.autoPoints, points: b.points },
        after: { auto: a.autoPoints, points: a.points },
        gradeBefore: before.final,
        gradeAfter: after.final,
        underOverride: a.source === 'human' && a.autoPoints !== null,
      });
    });
  }
  const order = new Map(assignment.questions.map((q, i) => [q.id, i]));
  changed.sort((x, y) => byName(x.student, y.student) || order.get(x.questionId)! - order.get(y.questionId)!);
  return {
    plan: {
      assignmentId: assignment.id,
      assignmentHash: hash,
      latest: byKey.size,
      stale,
      changed,
      unchanged: byKey.size - touched.size,
      humanGrades,
    },
    writes,
  };
}

/** The log's entries for a committed plan: one `regrade` event per changed
 *  (student, problem). `emailOf` names a key as the log does (the server
 *  logs by email, as every grade event; local mode's keys are emails). */
export function regradeEvents(
  plan: RegradePlan,
  writes: readonly RegradeWrite[],
  opts: { actor: string; at: string; emailOf: (key: string) => string },
): RegradeEvent[] {
  const from = new Map(writes.map((w) => [w.studentKey, w.fromHash]));
  return plan.changed.map((c) => ({
    at: opts.at,
    actor: opts.actor,
    student: opts.emailOf(c.student.key),
    questionId: c.questionId,
    kind: 'regrade',
    attempt: c.attempt,
    fromHash: from.get(c.student.key) ?? null,
    toHash: plan.assignmentHash,
    before: c.before,
    after: c.after,
    underOverride: c.underOverride,
  }));
}
