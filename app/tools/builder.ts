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
import { orderBoxPorts } from '../src/boxPorts';

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

/**
 * Everything but the machine's top-level INs/OUTs (or just the components
 * `only` names) inside ONE box, the way a student draws a box across wires
 * (task 038): one left port per inner end of a wire the box cuts coming in,
 * one right port per inner source of a wire it cuts going out, each port bound
 * (`bind`) to that endpoint. The same machine, boxed — grading it must match
 * grading the machine itself (boxScopeCheck, pipelineCheck, server
 * parityCheck).
 */
export function boxAcross(machine: CircuitData, label = 'Box 1', only?: string[]): CircuitData {
  const isNode = (c: CircuitComponent) => (only ? !only.includes(c.id) : c.type === 'INPUT' || c.type === 'OUTPUT');
  const inside = machine.components.filter((c) => !isNode(c));
  if (inside.length === 0) return machine;
  const ids = new Set(inside.map((c) => c.id));
  const cut = (w: Wire) => ids.has(w.sourceComponentId) !== ids.has(w.targetComponentId);
  // THE port order (boxPorts.ts), as confirmBox records it and a placement
  // stamps it — so unbind → rebindLegacyBoxes gives these bindings back.
  const { inputs: inKeys, outputs: outKeys } = orderBoxPorts(
    inside,
    machine.wires.filter((w) => cut(w) && ids.has(w.targetComponentId)).map((w) => `${w.targetComponentId}:${w.targetPortId}`),
    machine.wires.filter((w) => cut(w) && ids.has(w.sourceComponentId)).map((w) => `${w.sourceComponentId}:${w.sourcePortId}`),
  );
  const outer: Wire[] = [];
  for (const w of machine.wires) {
    if (ids.has(w.sourceComponentId) && ids.has(w.targetComponentId)) continue;
    if (!cut(w)) outer.push(w);
    else if (ids.has(w.targetComponentId)) {
      const k = inKeys.indexOf(`${w.targetComponentId}:${w.targetPortId}`);
      outer.push({ ...w, targetComponentId: 'ba-box', targetPortId: `in${k + 1}` });
    } else {
      const j = outKeys.indexOf(`${w.sourceComponentId}:${w.sourcePortId}`);
      outer.push({ ...w, sourceComponentId: 'ba-box', sourcePortId: `out${j + 1}` });
    }
  }
  const ports: Port[] = [
    ...inKeys.map((bind, i) => ({ id: `in${i + 1}`, label: `in${i + 1}`, side: 'left' as const, index: i, bind })),
    ...outKeys.map((bind, j) => ({ id: `out${j + 1}`, label: `out${j + 1}`, side: 'right' as const, index: j, bind })),
  ];
  const box: CircuitComponent = {
    id: 'ba-box', type: 'BOXED', x: 160, y: 0, label, ports, value: 0,
    boxedCircuitId: 'ba-box',
    internalCircuit: JSON.parse(JSON.stringify({
      components: inside,
      wires: machine.wires.filter((w) => ids.has(w.sourceComponentId) && ids.has(w.targetComponentId)),
    })) as CircuitData,
  };
  return circuit([...machine.components.filter(isNode), box], outer);
}

/** `c` with every box port's binding stripped, at any depth: a box as it was
 *  saved before task 038 (bound by label). */
export function unbind(c: CircuitData): CircuitData {
  return {
    ...c,
    components: c.components.map((comp) =>
      comp.type !== 'BOXED' ? comp : {
        ...comp,
        ports: comp.ports.map(({ bind: _bind, ...p }) => p),
        ...(comp.internalCircuit ? { internalCircuit: unbind(comp.internalCircuit) } : {}),
      },
    ),
  };
}
