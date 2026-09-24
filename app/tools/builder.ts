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

import type { CircuitComponent, CircuitData, Port, Wire } from '../src/types';
import { getPortsForType } from '../src/types';
import { sortByLabel } from '../src/engine/netlist';

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

/**
 * A placed box: a BOXED instance of `inner`, stamped the way placeBoxInstance
 * stamps one — ports `in1..inN` (left) and `out1..outM` (right), bound in
 * label order to the inner circuit's INs and OUTs, internals deep-copied.
 */
export function boxed(id: string, label: string, inner: CircuitData, x = 0, y = 0): CircuitComponent {
  const nIn = inner.components.filter((c) => c.type === 'INPUT').length;
  const nOut = inner.components.filter((c) => c.type === 'OUTPUT').length;
  const ports: Port[] = [
    ...Array.from({ length: nIn }, (_, i) => ({ id: `in${i + 1}`, label: `in${i + 1}`, side: 'left' as const, index: i })),
    ...Array.from({ length: nOut }, (_, i) => ({ id: `out${i + 1}`, label: `out${i + 1}`, side: 'right' as const, index: i })),
  ];
  return {
    id, type: 'BOXED', x, y, label, ports, value: 0,
    boxedCircuitId: id,
    internalCircuit: JSON.parse(JSON.stringify(inner)) as CircuitData,
  };
}

/**
 * The whole machine inside ONE box, with fresh top-level INs/OUTs (same
 * labels) wired to its ports — the same machine, boxed. Grading it must match
 * grading the machine itself (boxScopeCheck, scWindowCheck, pipelineCheck).
 */
export function boxWhole(machine: CircuitData, label = 'Box 1'): CircuitData {
  const ins = sortByLabel(machine.components, 'IN');
  const outs = sortByLabel(machine.components, 'OUT');
  const box = boxed('bw-box', label, machine, 160, 0);
  return circuit(
    [
      ...ins.map((c, i) => comp(`bw-in${i + 1}`, 'INPUT', c.label, 0, 80 * i)),
      box,
      ...outs.map((c, j) => comp(`bw-out${j + 1}`, 'OUTPUT', c.label, 480, 80 * j)),
    ],
    [
      ...ins.map((_, i) => wire(`bw-wi${i + 1}`, `bw-in${i + 1}`, 'out', 'bw-box', `in${i + 1}`)),
      ...outs.map((_, j) => wire(`bw-wo${j + 1}`, 'bw-box', `out${j + 1}`, `bw-out${j + 1}`, 'in')),
    ],
  );
}
