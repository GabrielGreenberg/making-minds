// What happens when someone writes a human grade (task 063; design memo
// docs/buildout/designs/grading-interface.md §4.2, §7.1). ONE planner, called
// by both GradingStores — the local one (storage/gradingStore.ts) and the
// server's grade routes (server/src/app.ts) — so the two backends can't
// disagree about a version, a required note or what a grade is anchored to.
// Each store only persists the plan: the new row (or its removal) and one
// append-only log entry.
//
// Pure: no storage, no clock (the caller passes `now`) — the server imports it.

import type {
  AssignmentQuestion,
  GradeChangeEvent,
  HumanGrade,
  LateExtension,
  LateWaiver,
  Points,
  SubmissionRecord,
} from '../types';
import { answerKey, autoPoints, gradeWriteProblem, gradesFromLegacyReviews } from '../engine/score';

/** A grade to write, naming the version it was read at (null = there was
 *  none) — the optimistic-concurrency check. */
export type GradeWrite =
  | { points: Points; note?: string; version: number | null }
  | { clear: true; version: number };

export type GradeWritePlan =
  | { ok: true; grade: HumanGrade | null; event: GradeChangeEvent }
  | { ok: false; conflict: true; current: HumanGrade | null }
  | { ok: false; conflict: false; error: string };

/**
 * Plan one write against the student's LATEST attempt (the counting one):
 * a stale `version` is a conflict (someone else wrote or cleared first); a
 * grade is anchored to the latest answer's `answerKey` and stamped with the
 * grader, the attempt and the next version.
 */
export function planGradeWrite(input: {
  question: AssignmentQuestion;
  latest: SubmissionRecord | null;
  student: string;
  existing: HumanGrade | null;
  write: GradeWrite;
  actor: string;
  now: string;
}): GradeWritePlan {
  const { question, latest, existing, write } = input;
  if (existing ? write.version !== (existing.version ?? 0) : write.version !== null) {
    return { ok: false, conflict: true, current: existing };
  }
  if ('clear' in write) {
    // A clear names the version it read, so "nothing to clear" was a conflict
    // above (someone else cleared it first) — here there is always a grade.
    return {
      ok: true,
      grade: null,
      event: { at: input.now, actor: input.actor, student: input.student, questionId: question.id, kind: 'clear', before: existing!, after: null },
    };
  }
  if (!latest) return { ok: false, conflict: false, error: 'this student has not submitted this assignment' };
  const auto = autoPoints(question, latest.result?.questions.find((r) => r.questionId === question.id));
  const problem = gradeWriteProblem(write, auto);
  if (problem) return { ok: false, conflict: false, error: problem };
  const note = write.note?.trim();
  const grade: HumanGrade = {
    questionId: question.id,
    points: write.points,
    ...(note ? { note } : {}),
    answerKey: answerKey(question, latest.submission.answers.find((a) => a.questionId === question.id)),
    gradedAt: input.now,
    grader: input.actor,
    attempt: latest.attempt,
    version: (existing?.version ?? 0) + 1,
  };
  return {
    ok: true,
    grade,
    event: {
      at: input.now,
      actor: input.actor,
      student: input.student,
      questionId: question.id,
      kind: auto === null ? 'grade' : 'override',
      before: existing,
      after: grade,
    },
  };
}

/**
 * The one-time migration of legacy ✓/✗ reviews (`QuestionResult.manual`,
 * before task 063) into stored grades: for each student, the reviews on their
 * LATEST attempt only (an older attempt's verdict judged an answer that no
 * longer counts). Grader null, version 1, the review's own time.
 */
export function legacyGradesByStudent(
  questions: readonly AssignmentQuestion[],
  records: readonly SubmissionRecord[],
  studentOf: (r: SubmissionRecord) => string,
): Map<string, HumanGrade[]> {
  const latest = new Map<string, SubmissionRecord>();
  for (const r of records) {
    const who = studentOf(r);
    const prev = latest.get(who);
    if (!prev || r.attempt > prev.attempt) latest.set(who, r);
  }
  const out = new Map<string, HumanGrade[]>();
  for (const [who, r] of latest) {
    const grades = gradesFromLegacyReviews(questions, r.submission, r.result).map((g) => ({
      ...g,
      attempt: r.attempt,
      version: 1,
    }));
    if (grades.length) out.set(who, grades);
  }
  return out;
}

/** A grade as a student may see it (released): no grader, attempt or version. */
export function studentGrade(g: HumanGrade): HumanGrade {
  return {
    questionId: g.questionId,
    points: g.points,
    ...(g.note ? { note: g.note } : {}),
    answerKey: g.answerKey,
    gradedAt: g.gradedAt,
  };
}

// ── Extensions and waivers (task 068; memo §4.6–§4.7) ──────────────────
// Assignment-level, per student: set or clear, each logged as one event
// with no questionId. Both backends persist the plan and nothing else.

export type LateWritePlan<T> =
  | { ok: true; value: T | null; event: GradeChangeEvent }
  | { ok: false; error: string };

/** A due date as an extension takes it: a parseable instant, stored as ISO. */
function isoInstant(x: unknown): string | null {
  if (typeof x !== 'string' || !x.trim()) return null;
  const ms = Date.parse(x);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Set (`dueDate`) or clear (null) one student's extension. No reason field,
 *  by design (memo §9: accommodation details stay out of the platform). */
export function planExtensionWrite(input: {
  existing: LateExtension | null;
  dueDate: unknown;
  student: string;
  actor: string;
  now: string;
}): LateWritePlan<LateExtension> {
  const { existing } = input;
  let value: LateExtension | null = null;
  if (input.dueDate !== null) {
    const at = isoInstant(input.dueDate);
    if (!at) return { ok: false, error: 'the extension must be a date and time (or null to clear it)' };
    value = { dueDate: at, setBy: input.actor, setAt: input.now };
  } else if (!existing) {
    return { ok: false, error: 'this student has no extension to clear' };
  }
  return {
    ok: true,
    value,
    event: { at: input.now, actor: input.actor, student: input.student, kind: 'extension', before: existing, after: value },
  };
}

/** Largest waiver: the whole of any deduction the grade could carry. */
export const MAX_WAIVER = 100;

/** Set ({points, note?}) or clear (null) one student's late waiver: a whole
 *  number of points, 1…100 (the score caps it at the actual deduction). */
export function planWaiverWrite(input: {
  existing: LateWaiver | null;
  write: { points: unknown; note?: unknown } | null;
  student: string;
  actor: string;
  now: string;
}): LateWritePlan<LateWaiver> {
  const { existing, write } = input;
  let value: LateWaiver | null = null;
  if (write) {
    const { points, note } = write;
    if (typeof points !== 'number' || !Number.isInteger(points) || points < 1 || points > MAX_WAIVER) {
      return { ok: false, error: `a waiver is a whole number of points, 1 to ${MAX_WAIVER}` };
    }
    if (note !== undefined && typeof note !== 'string') return { ok: false, error: 'the note must be text' };
    const text = (note as string | undefined)?.trim();
    value = { points, ...(text ? { note: text } : {}), by: input.actor, at: input.now };
  } else if (!existing) {
    return { ok: false, error: 'this student has no waiver to clear' };
  }
  return {
    ok: true,
    value,
    event: { at: input.now, actor: input.actor, student: input.student, kind: 'waiver', before: existing, after: value },
  };
}

// ── Private notes on a student (task 2026-09-26-070; memo §6.5) ─────────
// Append-only: a note is only ever added — the notes' own table (or local
// list) is their log, so no grade_events entry duplicates one.

/** Longest note: a few paragraphs, never a document. */
export const MAX_STUDENT_NOTE = 4000;

/** Check one note's text: non-empty once trimmed, at most MAX_STUDENT_NOTE. */
export function checkStudentNote(body: unknown): { ok: true; body: string } | { ok: false; error: string } {
  if (typeof body !== 'string' || !body.trim()) return { ok: false, error: 'a note needs some text' };
  const text = body.trim();
  if (text.length > MAX_STUDENT_NOTE) return { ok: false, error: `a note is at most ${MAX_STUDENT_NOTE} characters` };
  return { ok: true, body: text };
}
