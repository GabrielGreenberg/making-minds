// Stage 1 of the grading pipeline — machine validation (CLAUDE_KB/pipeline/
// codec.md). Static, once per question: a circuit that fails here FAILS THE
// QUESTION outright (every case 0/total), with no testing. Separated from
// decoding so `bitsToValue`/`decodeOutput` stay total and never see an invalid
// machine.
//
// Framework-agnostic (no React/Zustand/DOM). Per mode:
//   CC   interface: #INPUT == Σ inputWidths, #OUTPUT == Σ outputWidths.
//   SC   interface: #INPUT == #input groups, #OUTPUT == #output groups (one wire
//        per value; the per-value width is the step count, not structural).
//   FSM  well-definedness: ≥1 state and every STATE has exactly one transition
//        per input SYMBOL (total + deterministic; precludes a mid-run halt).
//        The symbol alphabet is all 2^kIn k-bit strings where kIn = the
//        question's input-GROUP count (cc_spec declaration order) — so a
//        multi-group FSM question either validates against the full alphabet
//        or fails Stage 1 loudly; it can never silently grade against wire 0.
//   TM   delegated to validateTMTable (≤ one transition per read symbol; labels
//        parse) — see engine/tmValidate.ts.

import type { CircuitData, CircuitComponent, ComponentType, BuildMode, RepSystem } from '../types';
import type { CodecLayout } from './codec';
import { sortStateComponents } from './fsm';
import { fsmNotation, validateTransitionTable } from './notation';
import { validateTMTable } from './tmValidate';
import { notationForRepresentation } from './tmCodec';

export interface MachineValidation {
  ok: boolean;
  reason?: string; // human-readable, shown to the instructor when invalid
}

const OK: MachineValidation = { ok: true };

// ─── allowed_components — question-level component restriction ───────────────
//
// SEMANTICS (the one authority; spec §1.5). `AssignmentQuestion.allowed_components`
// restricts which component types a submitted machine may contain:
//
//   - ABSENT or EMPTY  ⇒ unrestricted — all components allowed (back-compat:
//     every pre-existing question/fixture without the field is unaffected).
//   - PRESENT          ⇒ the machine may contain ONLY the listed types, plus
//     always-allowed infrastructure:
//       INPUT / OUTPUT — every machine's I/O interface (their *counts* are
//         enforced by the per-mode interface checks below). Questions may list
//         them explicitly (hw1-p2 does) but need not.
//       STATE — the entire vocabulary of FSM/TM canvases. A type-level
//         restriction targets the CC/SC gate vocabulary; banning the only node
//         type of a state machine would just brick the mode.
//   - BOXED is packaging, not vocabulary: the wrapper itself is always allowed,
//     but its internal circuit is checked RECURSIVELY — a boxed OR cannot
//     smuggle an OR into a "no OR gates" question (hw1-p2's pedagogy).
//
// Enforced as part of Stage 1 in every grading branch (grader.ts: gradeQuestion
// for CC/SC/FSM/TM, gradeTurbot for brains, gradePerception; mirrored by
// coverageCheck's validateStage1), so a violating machine fails every case.
// The student palette (ComponentLibrary) and the instructor authoring UI
// (QuestionCreator) read the same helpers.

/** Infrastructure types that are always allowed regardless of the restriction
 *  (see semantics above). BOXED is handled separately — recursed into, never
 *  itself an offender. */
const ALWAYS_ALLOWED_COMPONENTS: ReadonlySet<ComponentType> = new Set([
  'INPUT',
  'OUTPUT',
  'STATE',
]);

/** May a component of `type` appear under this restriction? (Pure; the student
 *  palette filter uses this per entry.) `allowed` absent/empty = unrestricted. */
export function isComponentTypeAllowed(
  type: ComponentType,
  allowed: readonly ComponentType[] | undefined | null,
): boolean {
  if (!allowed || allowed.length === 0) return true;
  if (ALWAYS_ALLOWED_COMPONENTS.has(type)) return true;
  if (type === 'BOXED') return true; // packaging; internals are checked instead
  return allowed.includes(type);
}

/** All disallowed types present in `components`, first-seen order, deduped —
 *  recursing into BOXED internals (nested boxes included). Empty = conforming. */
export function disallowedComponentTypes(
  components: readonly CircuitComponent[],
  allowed: readonly ComponentType[] | undefined | null,
): ComponentType[] {
  if (!allowed || allowed.length === 0) return [];
  const offenders: ComponentType[] = [];
  const seen = new Set<ComponentType>();
  const walk = (comps: readonly CircuitComponent[]): void => {
    for (const c of comps) {
      if (c.type === 'BOXED') {
        walk(c.internalCircuit?.components ?? []);
        continue;
      }
      if (!isComponentTypeAllowed(c.type, allowed) && !seen.has(c.type)) {
        seen.add(c.type);
        offenders.push(c.type);
      }
    }
  };
  walk(components);
  return offenders;
}

/** Stage-1 check for the restriction (see semantics above). Runs before the
 *  per-mode interface checks in every grading branch. */
export function validateAllowedComponents(
  circuit: CircuitData,
  allowed: readonly ComponentType[] | undefined | null,
): MachineValidation {
  const offenders = disallowedComponentTypes(circuit.components, allowed);
  if (offenders.length === 0) return OK;
  return {
    ok: false,
    reason: `machine uses disallowed component type(s): ${offenders.join(', ')} — this question allows only: ${allowed!.join(', ')} (boxed circuits are checked inside)`,
  };
}

function sum(ns: number[]): number {
  return ns.reduce((a, b) => a + b, 0);
}

/** Hard cap on FSM input groups: totality is checked over 2^kIn symbols and
 *  the editor enters symbols one bit per group — beyond 3 groups the alphabet
 *  (16+) stops being teachable or checkable. Nothing silently degrades: a
 *  wider question fails Stage 1 with an explicit reason. */
const FSM_MAX_INPUT_GROUPS = 3;

/**
 * Validate a submitted machine against the question's mode + codec layout.
 * `rep` is needed only for TM (it selects the tape notation).
 */
export function validateMachine(
  circuit: CircuitData,
  mode: BuildMode,
  layout: CodecLayout,
  rep: RepSystem,
): MachineValidation {
  const inputs = circuit.components.filter((c) => c.type === 'INPUT').length;
  const outputs = circuit.components.filter((c) => c.type === 'OUTPUT').length;

  if (mode === 'CC') {
    const wantIn = sum(layout.inputWidths);
    const wantOut = sum(layout.outputWidths);
    if (inputs !== wantIn) return { ok: false, reason: `expected ${wantIn} input wires, found ${inputs}` };
    if (outputs !== wantOut) return { ok: false, reason: `expected ${wantOut} output wires, found ${outputs}` };
    return OK;
  }

  if (mode === 'SC') {
    const wantIn = layout.inputWidths.length;
    const wantOut = layout.outputWidths.length;
    if (inputs !== wantIn) return { ok: false, reason: `expected ${wantIn} input wire(s), found ${inputs}` };
    if (outputs !== wantOut) return { ok: false, reason: `expected ${wantOut} output wire(s), found ${outputs}` };
    return OK;
  }

  if (mode === 'FSM') {
    const states = sortStateComponents(circuit.components);
    if (states.length === 0) return { ok: false, reason: 'machine has no states' };
    // THE FOOTGUN GUARD: kIn comes from the question's cc_spec input-group
    // count (via the codec layout the grader built from it), so the totality
    // check below covers every k-bit symbol the grader will feed. A machine
    // labeled for the wrong arity fails here with the arity named — it can
    // never author fine and grade wrong against wire 0 alone.
    const kIn = layout.inputWidths.length;
    const kOut = layout.outputWidths.length;
    if (kIn > FSM_MAX_INPUT_GROUPS) {
      return {
        ok: false,
        reason: `FSM questions support at most ${FSM_MAX_INPUT_GROUPS} input groups (this question declares ${kIn}; totality would need ${2 ** kIn} transitions per state)`,
      };
    }
    const notation = fsmNotation(kIn, kOut);
    const errors = validateTransitionTable(states, circuit.wires, () => notation, 'total');
    if (errors.length > 0) return { ok: false, reason: errors.map((e) => e.message).join(' ') };
    return OK;
  }

  if (mode === 'TM') {
    const notation = notationForRepresentation(rep);
    const errors = validateTMTable(circuit.components, circuit.wires, notation);
    if (errors.length > 0) return { ok: false, reason: errors.map((e) => e.message).join(' ') };
    return OK;
  }

  return OK;
}
