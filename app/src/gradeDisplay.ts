// Student-facing grade display policy (pure — no React, so a headless check
// can pin it). The points come from engine/score.ts, the one grade
// definition; this module only words them for a student's grade sheet and
// the problem-set margin.

import type { AssignmentQuestion, CaseResult, CircuitData, QuestionResult, TurbotCaseResult } from './types';
import { pointsLabel, type ProblemScore } from './engine/score';
import type { LoadedCase } from './store';
import {
  runValueCase,
  runTurbotCase,
  runPerceptionFilm,
  gradingCircuit,
  validateQuestionMachine,
  gradedMachineKey,
} from './engine/caseRun';

export type VerdictTone = 'pass' | 'half' | 'fail' | 'pending' | 'none';
export interface Verdict {
  text: string;
  tone: VerdictTone;
}

/** One problem's verdict in the student's terms: its points (engine/score.ts
 *  — the one grade definition) and how they came about — the case count for
 *  an autograde, "(reviewed)" for a person's grade. Pending until a person
 *  decides. */
export function problemVerdict(p: ProblemScore | undefined, r: QuestionResult | undefined): Verdict {
  if (!p) return { text: 'Not graded', tone: 'none' };
  if (p.points === null) return { text: 'Awaiting review', tone: 'pending' };
  const tone: VerdictTone = p.points === 1 ? 'pass' : p.points === 0.5 ? 'half' : 'fail';
  const pts = `${pointsLabel(p.points)} point${p.points === 0 ? 's' : ''}`; // 1 point, ½ point, 0 points
  if (p.source === 'human') return { text: `${pts} (reviewed)`, tone };
  return { text: r && r.total > 0 ? `${pts} — ${r.passed}/${r.total}` : pts, tone };
}

/** One value case's input as the question names it — `x = 3, y = 5` (the
 *  spec's group names; bare values where there is no name) — plus a TM
 *  case's block gaps when the grader laid the blocks out apart. Input only:
 *  a student's copy of a result has no answer key to show. */
export function describeCaseInput(
  q: AssignmentQuestion | undefined,
  c: Pick<CaseResult, 'input' | 'separations'>,
): string {
  const names = q?.cc_spec?.inputs.map((g) => g.name) ?? [];
  const values = c.input.map((v, i) => (names[i] ? `${names[i]} = ${v}` : String(v))).join(', ');
  const gaps = c.separations?.length ? ` (gap ${c.separations.join(', ')})` : '';
  return values + gaps;
}

/** A machine's decoded output for a case, named like its input:
 *  `out = 7` (the spec's output group names), bare values otherwise. */
export function describeCaseOutput(q: AssignmentQuestion | undefined, got: number[]): string {
  const names = q?.cc_spec?.outputs.map((g) => g.name) ?? [];
  return got.map((v, j) => (names[j] ? `${names[j]} = ${v}` : String(v))).join(', ');
}

/** A turbot case's outcome in words (pose + why, never more than the grade sheet shows). */
function turbotOutcome(r: TurbotCaseResult): string {
  const pose = `${r.stepsTaken} step${r.stepsTaken === 1 ? '' : 's'}, ended at (${r.finalPosition.x}, ${r.finalPosition.y}) ${r.finalPosition.facing}`;
  return r.pass ? `✓ passes — ${pose}` : `✗ ${r.reason ?? 'fails'} — ${pose}`;
}

function sameTurbotOutcome(a: TurbotCaseResult, b: TurbotCaseResult): boolean {
  return (
    a.pass === b.pass &&
    a.stepsTaken === b.stepsTaken &&
    a.hitStepLimit === b.hitStepLimit &&
    a.finalPosition.x === b.finalPosition.x &&
    a.finalPosition.y === b.finalPosition.y &&
    a.finalPosition.facing === b.finalPosition.facing &&
    (a.reason ?? '') === (b.reason ?? '')
  );
}

/**
 * What the graded-case banner (components/GradedCaseBanner) says about a case
 * loaded into the run: the case, the verdict RECORDED for it in
 * `loaded.attempt`, the verdict of THIS run (the canvas machine through the
 * grader's own case run — engine/caseRun.ts; a decoded output, never the key),
 * and how the two relate:
 *   same        the canvas holds the machine graded in that attempt and the
 *               run ended as the recorded one did;
 *   differs     the graded machine, yet a different ending (shown, not hidden);
 *   changed     the canvas is not that attempt's machine, and that attempt is
 *               the latest — edited since submitting (grades released before
 *               the due date): this runs the CURRENT machine;
 *   resubmitted the canvas is not that attempt's machine and a later attempt
 *               has been submitted since — equally the current machine.
 * The comparison is against the machine of `loaded.attempt` (its gradedKey),
 * never the latest record's, so a resubmit never turns an old verdict into a
 * claim about a new machine.
 */
export interface GradedCaseView {
  what: string;
  recorded: { text: string; pass: boolean };
  now: { text: string; pass?: boolean };
  note: 'same' | 'differs' | 'changed' | 'resubmitted';
  noteText: string;
}

export function gradedCaseView(
  question: AssignmentQuestion,
  loaded: LoadedCase,
  canvas: CircuitData,
  latestAttempt: number | undefined,
): GradedCaseView {
  let what: string;
  let recorded: GradedCaseView['recorded'];
  let now: GradedCaseView['now'];
  let same: boolean;
  if (loaded.kind === 'turbot') {
    const arenas = question.turbot_cases?.length ?? 0;
    what = `Arena #${loaded.caseIndex + 1}${arenas > 1 ? ` of ${arenas}` : ''}`;
    recorded = { text: turbotOutcome(loaded.recorded), pass: loaded.recorded.pass };
    const r = runTurbotCase(question, canvas, loaded.caseIndex);
    now = r ? { text: turbotOutcome(r), pass: r.pass } : { text: 'no such arena' };
    same = r != null && sameTurbotOutcome(r, loaded.recorded);
  } else if (loaded.kind === 'perception') {
    const n = loaded.frames.length;
    what = n === 1 ? `Frame ${loaded.frames[0].join('')}` : `Film #${loaded.caseIndex + 1} — ${n} frames`;
    const rec = loaded.recorded;
    recorded = {
      text: rec.pass
        ? '✓ correct'
        : `✗ ${rec.reason ?? (rec.failStep !== undefined && n > 1 ? `wrong output at t${rec.failStep}` : 'wrong output')}`,
      pass: rec.pass,
    };
    // The grader's Stage 1, then its run of the film — the machine's own
    // output bits (t1 first), never the expected ones.
    const valid = validateQuestionMachine(question, gradingCircuit(canvas));
    if (!valid.ok) {
      now = { text: `✗ ${valid.reason ?? 'invalid machine'}`, pass: false };
    } else {
      const got = runPerceptionFilm(question, canvas, loaded.frames);
      now = { text: n === 1 ? `output ${got[0] ?? 0}` : `output ${got.join(' ')} (t1 first)` };
    }
    same = (valid.ok ? '' : valid.reason ?? '') === (rec.reason ?? '');
  } else {
    what = `Input ${describeCaseInput(question, loaded)}`;
    const rec = loaded.recorded;
    recorded = { text: rec.pass ? '✓ correct' : `✗ ${rec.reason ?? 'wrong output'}`, pass: rec.pass };
    const run = runValueCase(question, canvas, loaded.input, loaded.separations);
    now =
      run.reason !== undefined
        ? { text: `✗ ${run.reason}`, pass: false }
        : { text: `output ${describeCaseOutput(question, run.got)}` };
    // Without the answer key the two can only be compared by how the run
    // ended: the same rejection, or a decoded output both times (the engine
    // is deterministic, so on the graded machine that output is the graded one).
    same = (run.reason ?? '') === (rec.reason ?? '');
  }
  const diverged = loaded.gradedKey === null || gradedMachineKey(canvas) !== loaded.gradedKey;
  const note: GradedCaseView['note'] = diverged
    ? latestAttempt !== undefined && latestAttempt !== loaded.attempt
      ? 'resubmitted'
      : 'changed'
    : same
      ? 'same'
      : 'differs';
  const noteText = {
    same: 'Same as when graded.',
    differs: 'This run does not match the recorded grade.',
    changed: "You've changed this question since you submitted — this runs your current machine.",
    resubmitted: `You've submitted again since attempt ${loaded.attempt} was graded — this runs your current machine.`,
  }[note];
  return { what, recorded, now, note, noteText };
}
