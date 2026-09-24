// One graded case, run exactly as the grader runs it — the half of grading
// that does not know the answer.
//
// Framework-agnostic (no React/Zustand/DOM). The grader (engine/grader.ts) is
// this module plus a comparison: it validates the machine once, runs every
// case through `runValidatedValueCase` / `runValidatedTurbotCase`, and holds
// each outcome against the bank's `outputs`. The student's canvas replays a
// failed case through the SAME functions (store `loadCaseInput`, the graded-
// case banner), so the run on screen is the grader's run by construction —
// and since nothing here reads `outputs`, a remote student's copy of the
// question (test_cases stripped, server/src/sanitize.ts) replays it too: the
// case's input (and TM block separations) ride on the student's own result.
//
//   questionLayout      the codec layout the grader derives from the question
//   gradingCircuit      the machine as graded: every MEM starts at 0
//   validateQuestionMachine   Stage 1, in the grader's order
//   caseStimulus        the exact engine input for a case (bits / steps / tape)
//   recordedCaseSeparations   a recorded case's TM block gaps (older results:
//                       from the bank, when it is the same case)
//   runValueCase        a CC/SC/FSM/TM case → the decoded output, or why the
//                       run was rejected
//   runTurbotCase       a turbot arena case → the grader's TurbotCaseResult

import type {
  AssignmentQuestion,
  BuildMode,
  CaseResult,
  CircuitData,
  TMNotation,
  TMTape,
  TurbotCaseResult,
  TurbotTestCase,
} from '../types';
import { evaluateCCInputs } from './cc';
import { evaluateSCSequence } from './sc';
import { evaluateFSMSymbolSequence } from './fsm';
import { fsmNotation } from './notation';
import { evaluateTMSequence, tapeCellsUsed } from './tm';
import {
  runTurbot,
  evaluateTurbotCriterion,
  explainTurbotCriterionFailure,
  criterionRequiresStop,
  validateTurbotTM,
  validateTurbotFSM,
} from './turbot';
import { validateMachine, validateAllowedComponents, validateComponentLimits } from './machineValidation';
import {
  axisForMode,
  encodeInput,
  decodeOutput,
  outputAccepted,
  type CodecLayout,
  type EncodedInput,
  type RawOutput,
} from './codec';
import { encodeTM, acceptTM, decodeTM, notationForRepresentation } from './tmCodec';

/** Stage-1 verdict. `skip` marks a question the grader cannot grade at all
 *  (an authoring gap — no spec, no inner mode), as opposed to a machine it
 *  rejects: the grader reports the first as `skipped`, the second as every
 *  case failed with `reason`. */
export interface StageOne {
  ok: boolean;
  reason?: string;
  skip?: boolean;
}

/** A value case's run: the decoded output value per output group, or the
 *  reason the run was rejected before decoding (Stage 1, no halt, malformed
 *  output, tape budget). Never carries the expected output. */
export type ValueCaseRun = { got: number[]; reason?: undefined } | { reason: string; got?: undefined };

/** The engine input for one case on the question's axis. */
export type CaseStimulus = EncodedInput | { axis: 'tape'; tape: TMTape };

const NO_SPEC = 'question has no spec (group widths unknown)';
const NO_INNER_MODE = 'question has no inner mode (CC/SC/FSM/TM) set';

/**
 * The codec layout of a value question — the grader's view of it. TM: the
 * tape axis (widths are content-relative, so no cc_spec is needed). CC/SC/
 * FSM: the per-group widths from the authoring spec, or null without one.
 * Turbot and open questions have no value layout (null).
 */
export function questionLayout(question: AssignmentQuestion): CodecLayout | null {
  const mode = question.buildMode;
  if (mode === 'turbot' || mode === 'open') return null;
  const rep = question.representation ?? 'binary';
  const axis = axisForMode(mode);
  if (axis === 'tape') return { axis: 'tape', rep, inputWidths: [], outputWidths: [] };
  const spec = question.cc_spec;
  if (!spec) return null;
  return {
    axis,
    rep,
    inputWidths: spec.inputs.map((g) => g.width),
    outputWidths: spec.outputs.map((g) => g.width),
  };
}

/**
 * The machine as graded: every top-level MEM starts at 0 ("all memory
 * initializes to 0"). A saved circuit carries whatever `storedValue` the
 * student's last UI run left behind — autosaved and submitted as-is — and
 * the SC engine, a turbot's SC brain and SC perception all seed their MEMs
 * from it; grading that scratch state would let a correct serial adder
 * submitted mid-run fail. (SC boxing refuses MEM, so boxed internals carry
 * none.) Returns the circuit itself when there is nothing to zero.
 */
export function gradingCircuit(circuit: CircuitData): CircuitData {
  const dirty = circuit.components.some((c) => c.type === 'MEM' && (c.storedValue ?? 0) !== 0);
  if (!dirty) return circuit;
  return {
    ...circuit,
    components: circuit.components.map((c) => (c.type === 'MEM' ? { ...c, storedValue: 0 } : c)),
  };
}

/** The two question-wide component rules, checked together at the head of
 *  Stage 1 in every grading branch: which types are allowed, and how many of
 *  each. Both are absent by default and both recurse into BOXED internals. */
export function questionComponentRules(
  question: AssignmentQuestion,
  circuit: CircuitData,
): { ok: boolean; reason?: string } {
  const allowed = validateAllowedComponents(circuit, question.allowed_components);
  if (!allowed.ok) return allowed;
  return validateComponentLimits(circuit, question.component_limits);
}

/**
 * Structural layout for a turbot brain's fixed sensor/motor interface, keyed
 * by inner mode. Only CC/SC brains reach validateMachine (FSM brains
 * validate against turbotFsmNotation via validateTurbotFSM; TM brains
 * against validateTurbotTM), so only those two rows are read.
 */
function turbotLayout(innerMode: BuildMode): CodecLayout {
  if (innerMode === 'SC') return { axis: 'time', rep: 'binary', inputWidths: [1], outputWidths: [1, 1] };
  return { axis: 'space', rep: 'binary', inputWidths: [1], outputWidths: [2] };
}

/**
 * Stage 1 for a value or turbot question, in the grader's order: the
 * question-wide component rules first, then the machine's interface/table.
 * A turbot TM brain is a *turbot TM* (per-state internal/external grammar,
 * single actions) with its own validator; an FSM brain validates through
 * validateTurbotFSM, which delegates to turbotFsmNotation — the SAME
 * notation runBrainStep executes and the store's label editor accepts;
 * CC/SC brains reuse the shared machine validation. The question's encoding
 * (representation) picks a turbot TM's internal tape alphabet. (The type
 * restriction is vacuous for STATE-vocabulary FSM/TM machines — STATE is
 * infrastructure — but uniform; a budget can still bite.)
 */
export function validateQuestionMachine(question: AssignmentQuestion, circuit: CircuitData): StageOne {
  const restriction = questionComponentRules(question, circuit);
  if (!restriction.ok) return restriction;
  const rep = question.representation ?? 'binary';
  if (question.buildMode === 'turbot') {
    const innerMode = question.innerMode;
    if (!innerMode) return { ok: false, reason: NO_INNER_MODE, skip: true };
    if (innerMode === 'TM' || innerMode === 'FSM') {
      const errors = innerMode === 'TM'
        ? validateTurbotTM(circuit.components, circuit.wires, notationForRepresentation(rep))
        : validateTurbotFSM(circuit.components, circuit.wires);
      return errors.length === 0 ? { ok: true } : { ok: false, reason: errors.map((e) => e.message).join(' ') };
    }
    return validateMachine(circuit, innerMode, turbotLayout(innerMode), rep);
  }
  const layout = questionLayout(question);
  if (!layout) return { ok: false, reason: NO_SPEC, skip: true };
  const valid = validateMachine(circuit, question.buildMode, layout, rep);
  return valid.ok ? valid : { ok: false, reason: valid.reason ?? 'invalid machine' };
}

/**
 * The exact engine input the grader feeds for one value case: the codec's
 * wire vector (CC, space), its [step][wire] stream (SC/FSM, time), or the
 * initial tape (TM — the case's block `separations` included). Null when the
 * question has no value layout.
 */
export function caseStimulus(
  question: AssignmentQuestion,
  input: number[],
  separations?: number[],
): CaseStimulus | null {
  const layout = questionLayout(question);
  if (!layout) return null;
  if (layout.axis === 'tape') {
    return { axis: 'tape', tape: encodeTM(notationForRepresentation(layout.rep), input, separations) };
  }
  return encodeInput(input, layout);
}

/**
 * A recorded value case's TM block separations — part of the grader's
 * stimulus. The ones its result carries; else (a result graded before cases
 * recorded them) bank case `k`'s, when that is the same input — results are
 * parallel to their banks, and a bank edited since no longer vouches for the
 * case. Undefined when the case had none or they cannot be known. The server
 * fills a student's own results this way (sanitize.ts); local mode's store
 * has the bank at hand.
 */
export function recordedCaseSeparations(
  question: AssignmentQuestion,
  k: number,
  c: Pick<CaseResult, 'input' | 'separations'>,
): number[] | undefined {
  if (c.separations) return c.separations;
  const tc = question.test_cases?.[k];
  if (!tc?.separations) return undefined;
  const sameInput = tc.inputs.length === c.input.length && tc.inputs.every((v, i) => v === c.input[i]);
  return sameInput ? tc.separations : undefined;
}

/** The rejection reason for a run that used more tape than the question
 *  allows, or undefined when it is within budget (or unbudgeted). */
function tapeOverrun(used: number, maxTapeCells: number | undefined): string | undefined {
  if (maxTapeCells === undefined || used <= maxTapeCells) return undefined;
  return `machine used ${used} tape cells — this question allows at most ${maxTapeCells}`;
}

/**
 * One value case on an ALREADY-VALIDATED machine (the grader validates once
 * per question, then runs every case through here). `machine` is the
 * grading circuit and `layout` the question's (see questionLayout).
 *
 * Tape axis (TM): `requireStandardHaltPosition` tightens the acceptor — the
 * head must halt on the output block's rightmost cell; `maxTapeCells` caps
 * the span of tape the run occupies, checked AFTER acceptance so a run that
 * never halted is reported as such rather than as a tape overrun. The case's
 * optional layout hint (block separations) rides through untouched — the
 * codec owns what it means.
 */
export function runValidatedValueCase(
  question: AssignmentQuestion,
  machine: CircuitData,
  layout: CodecLayout,
  input: number[],
  separations?: number[],
): ValueCaseRun {
  if (layout.axis === 'tape') {
    const notation = notationForRepresentation(layout.rep);
    const initialTape = encodeTM(notation, input, separations);
    const run = evaluateTMSequence(machine.components, machine.wires, initialTape, notation);
    const rej = acceptTM(notation, run, {
      requireStandardHaltPosition: question.requireStandardHaltPosition,
    });
    if (rej) return { reason: rej.reason };
    const overrun = tapeOverrun(tapeCellsUsed(run, initialTape), question.maxTapeCells);
    if (overrun) return { reason: overrun };
    return { got: [decodeTM(notation, run.tape)] };
  }

  const enc = encodeInput(input, layout);
  let raw: RawOutput;
  if (enc.axis === 'space') {
    // CC — one combinational evaluation.
    raw = { axis: 'space', bits: evaluateCCInputs(machine.components, machine.wires, enc.bits) };
  } else if (question.buildMode === 'SC') {
    raw = { axis: 'time', steps: evaluateSCSequence(machine.components, machine.wires, enc.steps) };
  } else {
    // FSM — feed the FULL encoded row per step as one input symbol: symbol
    // char i = input wire i (cc_spec declaration order = codec wire order).
    // Stage 1 validated totality over this notation's whole alphabet, so a
    // valid FSM cannot halt mid-run; guard anyway.
    const notation = fsmNotation(layout.inputWidths.length, layout.outputWidths.length);
    const symbols = enc.steps.map((s) => s.join(''));
    const r = evaluateFSMSymbolSequence(machine.components, machine.wires, symbols, notation);
    if (r.halted) return { reason: 'machine halted before consuming the input' };
    raw = { axis: 'time', steps: r.outputs.map((sym) => sym.split('').map(Number)) };
  }

  // Acceptor (rep-level) before decoding; decode is total.
  if (!outputAccepted(raw, layout)) return { reason: 'malformed output' };
  return { got: decodeOutput(raw, layout) };
}

/**
 * One value case (CC/SC/FSM/TM) on any machine, as the grader would run it:
 * the grading circuit, Stage 1 (a rejection is the case's reason), then the
 * run. The answer never enters — the caller compares, or shows.
 */
export function runValueCase(
  question: AssignmentQuestion,
  circuit: CircuitData,
  input: number[],
  separations?: number[],
): ValueCaseRun {
  const machine = gradingCircuit(circuit);
  const valid = validateQuestionMachine(question, machine);
  if (!valid.ok) return { reason: valid.reason ?? 'invalid machine' };
  return runValidatedValueCase(question, machine, questionLayout(question)!, input, separations);
}

/** A turbot case rejected at Stage 1: it never ran, so it sits at the start. */
export function rejectedTurbotCase(tc: TurbotTestCase, reason: string | undefined): TurbotCaseResult {
  return {
    pass: false,
    stepsTaken: 0,
    finalPosition: { ...tc.arena.start },
    hitStepLimit: false,
    reason,
  };
}

/** One turbot arena case on an ALREADY-VALIDATED brain: the arena driver
 *  loop, then the case's success criterion. */
export function runValidatedTurbotCase(
  machine: CircuitData,
  innerMode: BuildMode,
  tc: TurbotTestCase,
  notation: TMNotation,
  maxTapeCells?: number,
): TurbotCaseResult {
  const run = runTurbot(machine.components, machine.wires, innerMode, tc.arena, tc.maxSteps, notation);
  // The step limit bounds SIMULATION; whether a truncated run also fails is
  // the criterion's call (criterionRequiresStop, engine/turbot.ts). Stop-
  // requiring criteria (reach-and-stop, return-to-start) judge how the run
  // ends, so a turbot that never came to rest fails outright. pass-through
  // is trace-satisfiable (HW2 §III: cross the goal, "need not stop"), so a
  // step-limited run is still judged on the trace it produced.
  if (run.hitStepLimit && criterionRequiresStop(tc.criterion)) {
    return { pass: false, stepsTaken: tc.maxSteps, finalPosition: run.finalState, hitStepLimit: true, reason: 'exceeded max steps' };
  }
  // A TM brain's private tape is budgeted the same way as a base TM's
  // (HW6 P2: "Use at most 20 cells of the Turing machine tape"). Checked
  // before the criterion: a navigation that only succeeds by overrunning the
  // budget has not solved the problem as set.
  const overrun = tapeOverrun(run.tapeCellsUsed, maxTapeCells);
  if (overrun) {
    return { pass: false, stepsTaken: run.history.length, finalPosition: run.finalState, hitStepLimit: run.hitStepLimit, reason: overrun };
  }
  const pass = evaluateTurbotCriterion(tc.arena, run, tc.criterion);
  // Failure reasons — EVERY failing case carries one: a step-limited trace
  // that never satisfied its criterion names the criterion (the limit is not
  // why it failed); a halted-but-not-stopped brain (a dead FSM — a turbot
  // TM's halt counts as its stop) gets the explanatory reason; any other
  // failure (a clean stop that just doesn't satisfy the criterion, e.g.
  // halting at the start without visiting the goal) is explained in the
  // criterion's own terms by explainTurbotCriterionFailure.
  const reason = pass
    ? undefined
    : run.hitStepLimit
      ? `'${tc.criterion}' criterion not satisfied within max steps`
      : run.haltedByBrain && !run.stopped
        ? 'brain halted without a matching transition'
        : explainTurbotCriterionFailure(tc.arena, run, tc.criterion);
  return { pass, stepsTaken: run.history.length, finalPosition: run.finalState, hitStepLimit: run.hitStepLimit, reason };
}

/**
 * Turbot case `k` (`turbot_cases[k]`) on any brain, exactly as the grader
 * records it — including the Stage-1 rejection shape. Null when the question
 * has no such case or no inner mode.
 */
export function runTurbotCase(
  question: AssignmentQuestion,
  circuit: CircuitData,
  k: number,
): TurbotCaseResult | null {
  const tc = question.turbot_cases?.[k];
  const innerMode = question.innerMode;
  if (!tc || !innerMode) return null;
  const machine = gradingCircuit(circuit);
  const valid = validateQuestionMachine(question, machine);
  if (!valid.ok) return rejectedTurbotCase(tc, valid.reason);
  const notation = notationForRepresentation(question.representation ?? 'binary');
  return runValidatedTurbotCase(machine, innerMode, tc, notation, question.maxTapeCells);
}

/**
 * The parts of a machine a grade depends on, as one comparable string: each
 * component's identity, type, label, ports, MEM direction, turbot-TM state
 * kind and boxed internals, and each wire's endpoints and transition label —
 * never positions, rotation, wire geometry or live simulation values (INPUT
 * toggles, MEM contents). Two machines with the same key grade the same.
 * Replay uses it to say whether the canvas still holds the machine that was
 * graded.
 */
export function gradedMachineKey(circuit: CircuitData): string {
  const comps = circuit.components
    .map((c) =>
      JSON.stringify([
        c.id,
        c.type,
        c.label,
        c.ports.map((p) => `${p.side}${p.index}:${p.id}`),
        c.memDirection ?? '',
        c.stateKind === 'external' ? 'external' : '', // absent = internal
        c.boxedCircuitId ?? '',
        c.internalCircuit ? gradedMachineKey(c.internalCircuit) : '',
      ]),
    )
    .sort();
  const wires = circuit.wires
    .map((w) =>
      JSON.stringify([w.sourceComponentId, w.sourcePortId, w.targetComponentId, w.targetPortId, w.transitionLabel ?? '']),
    )
    .sort();
  return `${comps.join('|')}#${wires.join('|')}`;
}
