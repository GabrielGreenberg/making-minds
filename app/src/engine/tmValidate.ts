// TM machine-table validation (pre-engine — module 1 of CLAUDE_KB/engines/tm.md).
//
// Framework-agnostic: no React, no Zustand, no DOM. Shared by the authoring UI
// (flag errors at save time) and the grader (an invalid table fails every case).
// This is the TM row of the codec pipeline's Stage-1 `validateMachine`
// (CLAUDE_KB/pipeline/codec.md); when the codec rewrite lands this can fold into
// the unified machineValidation module unchanged.
//
// A valid table is a PRECONDITION of the engine: the engine assumes the matching
// transition is unique and every label parses, and does NOT re-check either.

import type { CircuitComponent, Wire, TMNotation } from '../types';
import { sortStateComponents } from './fsm';
import { parseTMTransition } from './tm';

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
 *      `input:action` for the notation.
 *
 * Only wires leaving a STATE component are considered transitions.
 */
export function validateTMTable(
  components: CircuitComponent[],
  wires: Wire[],
  notation: TMNotation
): TMValidationError[] {
  const errors: TMValidationError[] = [];
  const stateIds = new Set(sortStateComponents(components).map((s) => s.id));

  // (sourceStateId → readSymbol → wire ids matching that read)
  const byStateAndRead = new Map<string, Map<string, string[]>>();

  for (const w of wires) {
    if (!stateIds.has(w.sourceComponentId)) continue;
    const parsed = parseTMTransition(w.transitionLabel, notation);
    if (!parsed) {
      errors.push({
        kind: 'unparseable',
        message: `Transition "${w.transitionLabel ?? ''}" is not a valid "input:action" label for a ${notation} machine.`,
        stateId: w.sourceComponentId,
        wireIds: [w.id],
      });
      continue;
    }
    let perRead = byStateAndRead.get(w.sourceComponentId);
    if (!perRead) {
      perRead = new Map<string, string[]>();
      byStateAndRead.set(w.sourceComponentId, perRead);
    }
    const list = perRead.get(parsed.input) ?? [];
    list.push(w.id);
    perRead.set(parsed.input, list);
  }

  for (const [stateId, perRead] of byStateAndRead) {
    for (const [readSymbol, wireIds] of perRead) {
      if (wireIds.length > 1) {
        errors.push({
          kind: 'ambiguous',
          message: `State has ${wireIds.length} transitions on reading "${readSymbol}"; the machine is nondeterministic.`,
          stateId,
          wireIds,
        });
      }
    }
  }

  return errors;
}
