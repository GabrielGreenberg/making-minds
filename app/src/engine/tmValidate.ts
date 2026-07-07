// TM machine-table validation (pre-engine — module 1 of CLAUDE_KB/engines/tm.md).
//
// Framework-agnostic: no React, no Zustand, no DOM. Shared by the authoring UI
// (flag errors at save time) and the grader (an invalid table fails every case).
// This is the TM row of the codec pipeline's Stage-1 `validateMachine`
// (CLAUDE_KB/pipeline/codec.md).
//
// Since P2.1 this is a thin wrapper over the generic transition-table walker
// (engine/notation.ts `validateTransitionTable`, mode 'at-most-one') with the
// TM two-output notation — the grammar (incl. the legacy dual-action alias
// `1:0R`) lives entirely in the seam. Only the error SHAPE is TM-flavored:
// `kind` distinguishes ambiguous from unparseable, which callers rely on.
//
// A valid table is a PRECONDITION of the engine: the engine assumes the matching
// transition is unique and every label parses, and does NOT re-check either.

import type { CircuitComponent, Wire, TMNotation } from '../types';
import { sortStateComponents } from './fsm';
import { tmNotation, validateTransitionTable } from './notation';

export type TMValidationKind = 'ambiguous' | 'unparseable';

export interface TMValidationError {
  kind: TMValidationKind;
  message: string;
  stateId?: string;       // offending source state, when applicable
  wireIds: string[];      // offending transition wire id(s)
}

/**
 * Validate a TM transition table for the given notation. Returns the list of
 * syntax errors; an empty list means the table is well-formed and may be run.
 *
 * Two conditions reject a table (both are syntax errors, never silently
 * resolved):
 *   1. Ambiguous transitions — two transitions out of the same state matching
 *      the same read symbol (nondeterministic; no wire-order tie-break).
 *   2. Unparseable label — a transition wire whose label is not a valid
 *      `read:write,move` transition for the notation.
 *
 * Unlike an FSM table, a TM table is NOT required to be total — a missing
 * transition is how a TM halts — hence walker mode 'at-most-one'.
 * Only wires leaving a STATE component are considered transitions.
 */
export function validateTMTable(
  components: CircuitComponent[],
  wires: Wire[],
  notation: TMNotation
): TMValidationError[] {
  const states = sortStateComponents(components);
  const grammar = tmNotation(notation);
  return validateTransitionTable(states, wires, () => grammar, 'at-most-one')
    .map((e) => ({
      // 'missing' cannot occur in 'at-most-one' mode.
      kind: e.kind === 'ambiguous' ? 'ambiguous' : 'unparseable',
      message: e.message,
      stateId: e.stateId,
      wireIds: e.wireIds,
    }));
}
