// Headless circuit builders for authoring reference fixtures in code — no
// browser required. The engine is pure and machines are plain JSON, so a
// fixture-authoring script can construct a diagram with these helpers, grade it
// with the real grader, and write the fixture straight to
// fixtures/reference/<row-id>.json.
//
// Same pattern as devData/sampleData.ts (the canonical examples of programmatic
// machines for all five modes — CC, SC delay register, FSM identity, TM unary
// successor, turbot CC brain).
//
// Port ids (from getPortsForType in src/types.ts):
//   INPUT  → out                     OUTPUT → in
//   NOT    → in, out                 AND/OR/XOR → in1, in2, out
//   HA     → in1, in2, sum, carry    MEM    → mout (left), min (right)
//   STATE  → left, right  (transitions: source 'right' → target 'left',
//            label via { transitionLabel: '0:1' } etc.)
//
// Positions only affect rendering, never grading — but give components real
// grid coordinates (left→right signal flow, ~160px column spacing) so the same
// fixture loads cleanly in the UI for the appearance check.

import type { CircuitComponent, CircuitData, Wire } from '../src/types';
import { getPortsForType } from '../src/types';

/** Create a component. Positions are for rendering; grading ignores them. */
export function comp(
  id: string,
  type: CircuitComponent['type'],
  label: string,
  x = 0,
  y = 0,
  extra: Partial<CircuitComponent> = {},
): CircuitComponent {
  return { id, type, x, y, label, ports: getPortsForType(type), ...extra };
}

/** Create a wire from an output port to an input port. */
export function wire(
  id: string,
  src: string,
  srcPort: string,
  tgt: string,
  tgtPort: string,
  extra: Partial<Wire> = {},
): Wire {
  return {
    id,
    sourceComponentId: src,
    sourcePortId: srcPort,
    targetComponentId: tgt,
    targetPortId: tgtPort,
    value: 0,
    ...extra,
  };
}

/**
 * FSM/TM transition: a wire between STATE nodes (or a self-loop), labeled.
 * `label` is the mode's transition grammar (FSM '0:1'; TM per current notation).
 */
export function transition(
  id: string,
  fromState: string,
  toState: string,
  label: string,
  extra: Partial<Wire> = {},
): Wire {
  return wire(id, fromState, 'right', toState, 'left', { transitionLabel: label, ...extra });
}

/** Bundle components + wires into CircuitData. */
export function circuit(components: CircuitComponent[], wires: Wire[]): CircuitData {
  return { components, wires };
}
