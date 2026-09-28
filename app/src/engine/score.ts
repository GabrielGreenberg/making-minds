// What a grade IS (task 061; design memo docs/buildout/designs/grading-interface.md
// §4). The ONE definition every surface renders — the instructor's gradebook,
// the student's Grades tab and sheet, later the matrix, the flags and the
// export — so no two of them can disagree about a number again.
//
//   · Every problem is worth 1 point and earns 0, ½ or 1.
//   · Where a problem's points come from, in precedence order: a human grade
//     (a hand grade, or an override of the autograde) — but only while it
//     judges the answer the counting attempt actually holds; then the
//     autograde (1 when every case passes, ½ when the problem's
//     `half_credit_at` rule is met, else 0); else pending (0 earned, and the
//     grade is marked provisional — never over-reported).
//   · P = earned ÷ available; the assignment grade is 40 + 60·P, rounded to
//     0.1; the late deduction comes off that, floored at 0 (policy: it may go
//     below 40, never below 0).
//
// Pure: no React, store or DOM — the server imports it, and a headless check
// pins it (app/tools/scoreCheck.ts). The autograder's own pass/fail per case
// stays in grader.ts; partial credit lives here.

import type {
  AssignmentQuestion,
  HumanGrade,
  LatePolicy,
  Points,
  QuestionResult,
  SubmissionData,
  SubmissionRecord,
  SubmissionResult,
} from '../types';
import { questionTask } from '../types';
import { gradedMachineKey } from './caseRun';
import { fillInCaseCount } from './fillIn';

// The grade record itself is a domain type (types.ts, task 063).
export type { HumanGrade, Points } from '../types';

/** Where a problem's points came from. `pending`: awaiting a human (an open
 *  problem, or one the autograder couldn't grade). `changed`: a human graded
 *  an earlier answer; the student has since changed it — the old grade is
 *  offered as a `suggestion`, and the problem counts as pending. */
export type ProblemSource = 'auto' | 'auto-half' | 'human' | 'pending' | 'changed';

export interface ProblemScore {
  questionId: number;
  /** null while pending or changed (0 earned toward P, grade provisional). */
  points: Points | null;
  source: ProblemSource;
  /** The autograde's own value, shown beside a human grade so an override
   *  never hides what the machine did; null for an open problem. */
  autoPoints: Points | null;
  /** The human grade's note (the student sees it once grades are released). */
  note?: string;
  suggestion?: HumanGrade;
}

/** A class meeting, as ISO instants (the course calendar, task 068). */
export interface ClassMeeting {
  start: string;
  end: string;
}

export interface CourseCalendar {
  meetings: readonly ClassMeeting[];
}

// The policy's name is a domain type (types.ts): assignments carry it.
export type { LatePolicy } from '../types';
export const LATE_FIRST = 5;
export const LATE_STEP = 5;
const DAY_MS = 86_400_000;

export interface LateDeduction {
  late: boolean;
  /** Class meetings (per-meeting) or full days (per-day) past the due date. */
  units: number;
  deduction: number;
}

/**
 * The late deduction for a submission, before any waiver. On time (at or
 * before the due instant) is none. A meeting counts once it has ended — a
 * submission made during a lecture has not yet let that lecture pass.
 */
export function lateDeduction(
  submittedAt: string,
  dueAt: string,
  policy: LatePolicy,
  calendar: CourseCalendar | undefined,
): LateDeduction {
  const s = Date.parse(submittedAt);
  const d = Date.parse(dueAt);
  if (!(s > d)) return { late: false, units: 0, deduction: 0 };
  const units =
    policy === 'per-day'
      ? Math.floor((s - d) / DAY_MS)
      : (calendar?.meetings ?? []).filter((m) => {
          const end = Date.parse(m.end);
          return end > d && end <= s;
        }).length;
  return { late: true, units, deduction: LATE_FIRST + LATE_STEP * units };
}

/**
 * What a human grade is anchored to: the answer as the grade depends on it.
 * A machine by `gradedMachineKey` (its parts and wiring, never positions); an
 * open answer by its text, whitespace-normalised; a fill-in by its blanks,
 * trimmed. Equal keys = the same answer, so a grade on it still applies.
 */
export function answerKey(
  question: AssignmentQuestion,
  answer: SubmissionData['answers'][number] | undefined,
): string {
  const task = questionTask(question);
  if (task === 'open') return 'text:' + (answer?.responseText ?? '').replace(/\s+/g, ' ').trim();
  if (task === 'fill-in') return 'fill:' + JSON.stringify((answer?.fillAnswers ?? []).map((b) => b.trim()));
  return 'machine:' + gradedMachineKey(answer?.circuit ?? { components: [], wires: [] });
}

/** The autograde's points for one question's result: 1 when every case
 *  passes; ½ when `half_credit_at` is met; else 0. null when there is nothing
 *  to autograde, so a person must decide: an open problem, or one the grader
 *  skipped — a submission always carries an answer for every question (an
 *  empty canvas is graded, and refused), so a skip means the question itself
 *  had no bank or spec to grade against. A refusal at Stage 1 runs no case, so
 *  it passes none and can never reach the ½ rule. */
export function autoPoints(question: AssignmentQuestion, r: QuestionResult | undefined): Points | null {
  if (!r || r.status === 'pending' || r.status === 'skipped') return null;
  if (r.total === 0) return null;
  if (r.passed === r.total) return 1;
  const k = question.half_credit_at;
  if (k !== undefined && Number.isInteger(k) && k >= 1 && k < r.total && r.passed >= k) return 0.5;
  return 0;
}

/** A human grade as displayed: "1", "½", "0". */
export function pointsLabel(p: Points): string {
  return p === 0.5 ? '½' : String(p);
}

export interface ScoreInput {
  questions: readonly AssignmentQuestion[];
  /** The counting attempt — the LATEST submission — or null if none. Its
   *  `result` may be absent (a student's copy before grades are released). */
  latest: { submission: SubmissionData; submittedAt: string; result?: SubmissionResult } | null;
  grades?: readonly HumanGrade[];
  /** The student's effective due date. `late` absent = no deduction is
   *  computed (until the course calendar lands, task 068). */
  due?: {
    at: string;
    late?: { policy: LatePolicy; calendar?: CourseCalendar; waived?: number };
  };
  /** For Missing: past the due date with no submission. */
  now: number;
}

export interface Score {
  problems: ProblemScore[];
  earned: number;
  available: number;
  /** earned ÷ available (0 when there are no problems). */
  P: number;
  /** 40 + 60·P, rounded to 0.1; null without a graded submission. */
  raw: number | null;
  late: (LateDeduction & { waived: number }) | null;
  /** max(0, raw − (deduction − waived)); 0 when Missing; null otherwise without a grade. */
  final: number | null;
  /** Some problem is pending or changed — the grade may still rise. */
  provisional: boolean;
  /** Past the due date with no submission. */
  missing: boolean;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** The one score (memo §4.8). */
export function scoreSubmission(input: ScoreInput): Score {
  const { questions, latest } = input;
  const available = questions.length;
  const dueAt = input.due?.at;
  if (!latest || !latest.result) {
    const missing = !latest && dueAt !== undefined && input.now > Date.parse(dueAt);
    return {
      problems: questions.map((q) => ({ questionId: q.id, points: null, source: 'pending', autoPoints: null })),
      earned: 0,
      available,
      P: 0,
      raw: null,
      late: null,
      final: missing ? 0 : null,
      provisional: false,
      missing,
    };
  }
  const results = new Map(latest.result.questions.map((r) => [r.questionId, r]));
  const answers = new Map(latest.submission.answers.map((a) => [a.questionId, a]));
  const grades = new Map((input.grades ?? []).map((g) => [g.questionId, g]));
  const problems: ProblemScore[] = questions.map((q) => {
    const auto = autoPoints(q, results.get(q.id));
    const human = grades.get(q.id);
    if (human) {
      if (human.answerKey === answerKey(q, answers.get(q.id))) {
        return { questionId: q.id, points: human.points, source: 'human', autoPoints: auto, note: human.note };
      }
      return { questionId: q.id, points: null, source: 'changed', autoPoints: auto, suggestion: human };
    }
    if (auto === null) return { questionId: q.id, points: null, source: 'pending', autoPoints: null };
    return { questionId: q.id, points: auto, source: auto === 0.5 ? 'auto-half' : 'auto', autoPoints: auto };
  });
  const earned = problems.reduce((sum, p) => sum + (p.points ?? 0), 0);
  const P = available > 0 ? earned / available : 0;
  const raw = round1(40 + 60 * P);
  const lateIn = input.due?.late;
  const late =
    dueAt !== undefined && lateIn
      ? {
          ...lateDeduction(latest.submittedAt, dueAt, lateIn.policy, lateIn.calendar),
          waived: 0,
        }
      : null;
  if (late) late.waived = Math.min(late.deduction, Math.max(0, lateIn?.waived ?? 0));
  const final = round1(Math.max(0, raw - (late ? late.deduction - late.waived : 0)));
  return {
    problems,
    earned,
    available,
    P,
    raw,
    late,
    final,
    provisional: problems.some((p) => p.source === 'pending' || p.source === 'changed'),
    missing: false,
  };
}

/**
 * The legacy ✓/✗ reviews an instructor recorded INSIDE an attempt's result
 * (`QuestionResult.manual`, before task 063), as human grades anchored to that
 * attempt's own answers — the one-time migration into stored grades (server
 * db.ts, the local GradingStore) reads them through here, and nothing else.
 */
export function gradesFromLegacyReviews(
  questions: readonly AssignmentQuestion[],
  submission: SubmissionData,
  result: SubmissionResult | undefined,
): HumanGrade[] {
  if (!result) return [];
  const byId = new Map(questions.map((q) => [q.id, q]));
  const answers = new Map(submission.answers.map((a) => [a.questionId, a]));
  return result.questions.flatMap((r) => {
    const q = byId.get(r.questionId);
    if (!q || !r.manual) return [];
    return [{
      questionId: q.id,
      points: (r.manual.pass ? 1 : 0) as Points,
      ...(r.manual.note ? { note: r.manual.note } : {}),
      answerKey: answerKey(q, answers.get(q.id)),
      gradedAt: r.manual.reviewedAt,
      grader: null,
    }];
  });
}

/**
 * What is wrong with a grade someone is about to write, or null: points are
 * 0, ½ or 1, and overriding an autograde (a problem the machine graded)
 * needs a note saying why — the student sees it on release (memo §4.2).
 * Both GradingStores ask this before writing.
 */
export function gradeWriteProblem(
  write: { points: unknown; note?: unknown },
  autograde: Points | null,
): string | null {
  if (write.points !== 0 && write.points !== 0.5 && write.points !== 1) return 'points must be 0, ½ or 1';
  if (write.note !== undefined && typeof write.note !== 'string') return 'the note must be text';
  if (autograde !== null && !(typeof write.note === 'string' && write.note.trim())) {
    return 'overriding the autograde needs a note saying why';
  }
  return null;
}

/**
 * A stored attempt's score, as the counting attempt: its own result and the
 * human grades delivered with it (`record.grades`, task 063 — each applies
 * only while it judges this attempt's answer). The one call every surface
 * makes for "this submission's grade".
 */
export function scoreRecord(
  questions: readonly AssignmentQuestion[],
  record: SubmissionRecord,
  now: number,
  due?: ScoreInput['due'],
): Score {
  return scoreSubmission({
    questions,
    latest: { submission: record.submission, submittedAt: record.submittedAt, result: record.result },
    grades: record.grades,
    due,
    now,
  });
}

/** How many cases a question is autograded on — the N of its ½ rule: value
 *  cases, turbot arenas, perception films, fill-in blanks or a fill-in
 *  table's key rows; 0 for an open problem. (Authoring-side: a student's
 *  sanitized copy has no banks.) */
export function questionCaseCount(q: AssignmentQuestion): number {
  const task = questionTask(q);
  if (task === 'open') return 0;
  if (task === 'fill-in') return fillInCaseCount(q.fill_in, q.fill_in_answers);
  if (task === 'turbot') return q.turbot_cases?.length ?? 0;
  if (task === 'perception') return q.perception_cases?.length ?? 0;
  return q.test_cases?.length ?? 0;
}

/** What is wrong with a question's ½ rule, or null when it is absent or
 *  sound: a whole number K of its N cases with 1 ≤ K < N, and never on an
 *  open problem (nothing to count). Authoring-side — the creator's save and
 *  `problemSet.ts validateDocument` both ask it. */
export function halfCreditProblem(q: AssignmentQuestion): string | null {
  const k = q.half_credit_at;
  if (k === undefined) return null;
  if (questionTask(q) === 'open') return 'an open problem has no cases to give half credit on';
  if (!Number.isInteger(k) || k < 1) return `the ½ rule must be a whole number of cases, at least 1 (got ${k})`;
  const n = questionCaseCount(q);
  if (k >= n) return `the ½ rule asks for ${k} of ${n} case${n === 1 ? '' : 's'} — it must be fewer than all of them`;
  return null;
}

/** A grade as shown: one decimal only when it has one — "82.5", "100", "40". */
export function formatGrade(g: number): string {
  return Number.isInteger(g) ? String(g) : g.toFixed(1);
}
