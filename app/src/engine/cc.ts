// Combinatorial-circuit evaluation engine.
//
// Framework-agnostic: this module must NOT import React, Zustand, the store,
// or anything DOM-related. It depends only on the pure data definitions in
// `../types`. The same code powers the live canvas (via the store) and any
// future headless grader.

import type { CircuitComponent, Wire, ComponentType } from '../types';
import { getMemOutputPortId, getMemInputPortId } from '../types';

/**
 * Topologically order components for evaluation. Wires feeding a MEM block's
 * input (sink) port are treated as feedback and excluded, so MEM blocks act as
 * in-degree-0 sources alongside INPUTs.
 */
export function topologicalSort(
  components: CircuitComponent[],
  wires: Wire[]
): CircuitComponent[] {
  const compMap = new Map(components.map((c) => [c.id, c]));
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();

  // Initialize all components
  for (const c of components) {
    inDegree.set(c.id, 0);
    adjList.set(c.id, []);
  }

  // Build graph from wires, skipping wires into MEM min ports (feedback)
  for (const w of wires) {
    const targetComp = compMap.get(w.targetComponentId);
    const sourceComp = compMap.get(w.sourceComponentId);
    if (sourceComp && targetComp) {
      // Skip wires going INTO MEM's input port — these are feedback connections
      if (targetComp.type === 'MEM' && w.targetPortId === getMemInputPortId(targetComp)) continue;
      inDegree.set(
        w.targetComponentId,
        (inDegree.get(w.targetComponentId) || 0) + 1
      );
      const list = adjList.get(w.sourceComponentId)!;
      list.push(w.targetComponentId);
    }
  }

  // BFS from nodes with in-degree 0 (INPUTs and MEM blocks will naturally have 0)
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: CircuitComponent[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const comp = compMap.get(id);
    if (comp) sorted.push(comp);
    for (const neighbor of adjList.get(id) || []) {
      const newDeg = (inDegree.get(neighbor) || 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  return sorted;
}

/** Evaluate a single component's output(s) from its input values. */
export function evaluateGate(type: ComponentType, inputs: number[], comp?: CircuitComponent): number[] {
  switch (type) {
    case 'NOT':
      return [inputs[0] === 0 ? 1 : 0];
    case 'AND':
      return [inputs[0] === 1 && inputs[1] === 1 ? 1 : 0];
    case 'OR':
      return [inputs[0] === 1 || inputs[1] === 1 ? 1 : 0];
    case 'XOR':
      return [inputs[0] !== inputs[1] ? 1 : 0];
    case 'HA': {
      const sum = inputs[0] !== inputs[1] ? 1 : 0;
      const carry = inputs[0] === 1 && inputs[1] === 1 ? 1 : 0;
      return [sum, carry];
    }
    case 'INPUT':
      return [inputs[0] ?? 0];
    case 'OUTPUT':
      return [inputs[0] ?? 0];
    case 'BOXED':
      return evaluateBoxedCircuit(comp, inputs);
    default:
      return [0];
  }
}

/**
 * The ONE IN/OUT label-ordering convention: select a circuit's INPUT (or
 * OUTPUT) components and order them by the numeric suffix of their permanent
 * label ("IN2" → 2; unparseable → 0). Both the top-level grading path
 * (`evaluateCCInputs`) and boxed-circuit internal binding
 * (`evaluateBoxedCircuit`) MUST bind bit vectors through this helper so the
 * two can never desync.
 */
function sortByLabel(components: CircuitComponent[], prefix: 'IN' | 'OUT'): CircuitComponent[] {
  return components
    .filter((c) => (prefix === 'IN' ? c.type === 'INPUT' : c.type === 'OUTPUT'))
    .sort((a, b) => {
      const na = parseInt(a.label.replace(prefix, '')) || 0;
      const nb = parseInt(b.label.replace(prefix, '')) || 0;
      return na - nb;
    });
}

/** Simulate the internal circuit of a BOXED component */
export function evaluateBoxedCircuit(comp: CircuitComponent | undefined, externalInputs: number[]): number[] {
  if (!comp?.internalCircuit) return externalInputs.map(() => 0);
  const { components: intComps, wires: intWires } = comp.internalCircuit;
  if (intComps.length === 0) return externalInputs.map(() => 0);

  // Set INPUT component values from external inputs (bound in label order)
  const inputComps = sortByLabel(intComps, 'IN');
  const preppedComps = intComps.map((c) => {
    const idx = inputComps.indexOf(c);
    if (idx >= 0) {
      return { ...c, value: externalInputs[idx] ?? 0 };
    }
    return { ...c };
  });

  // Topologically sort and evaluate the internal circuit
  const sorted = topologicalSort(preppedComps, intWires);
  const portValues = new Map<string, number>();

  for (const ic of sorted) {
    if (ic.type === 'INPUT') {
      portValues.set(`${ic.id}:out`, ic.value ?? 0);
      continue;
    }

    const inputPorts = ic.ports.filter((p) => p.side === 'left');
    const inputVals: number[] = [];
    for (const port of inputPorts) {
      const wire = intWires.find(
        (w) => w.targetComponentId === ic.id && w.targetPortId === port.id
      );
      if (wire) {
        inputVals.push(portValues.get(`${wire.sourceComponentId}:${wire.sourcePortId}`) ?? 0);
      } else {
        inputVals.push(0);
      }
    }

    if (ic.type === 'OUTPUT') {
      portValues.set(`${ic.id}:in`, inputVals[0] ?? 0);
    } else {
      // Recursively evaluate nested BOXED components
      const outputs = evaluateGate(ic.type, inputVals, ic);
      const outputPorts = ic.ports.filter((p) => p.side === 'right');
      for (let i = 0; i < outputPorts.length; i++) {
        portValues.set(`${ic.id}:${outputPorts[i].id}`, outputs[i] ?? 0);
      }
    }
  }

  // Collect outputs from OUTPUT components, sorted by label
  const outputComps = sortByLabel(preppedComps, 'OUT');

  return outputComps.map((oc) => portValues.get(`${oc.id}:in`) ?? 0);
}

/** Result of a pure combinatorial-circuit evaluation. */
export interface CCEvalResult {
  /** "compId:portId" -> value. `undefined` means blank/unset (propagated). */
  portValues: Map<string, number | undefined>;
  /** wireId -> value. Only wires carrying a defined value are present. */
  wireValues: Map<string, number>;
}

/**
 * Pure combinatorial-circuit evaluation. Reads `value` off INPUT components and
 * `storedValue` off MEM blocks, propagates through the acyclic gate network in
 * topological order, and returns the resolved port and wire values.
 *
 * Semantics preserved from the original store implementation: an undefined
 * (blank) input propagates as undefined through gates; OUTPUT ports are only
 * set when actually wired. The caller decides how to render absent wire values
 * (the store maps them to the -1 sentinel).
 */
export function evaluateCC(
  components: CircuitComponent[],
  wires: Wire[]
): CCEvalResult {
  const portValues = new Map<string, number | undefined>(); // "compId:portId" -> value
  const wireValues = new Map<string, number>();

  const sorted = topologicalSort(components, wires);

  // Set input values (undefined = blank/unset)
  for (const comp of sorted) {
    if (comp.type === 'INPUT') {
      portValues.set(`${comp.id}:out`, comp.value);
    }
  }

  // Propagate through sorted components
  for (const comp of sorted) {
    if (comp.type === 'INPUT') continue;

    // MEM blocks: output their stored value via the output port
    if (comp.type === 'MEM') {
      portValues.set(`${comp.id}:${getMemOutputPortId(comp)}`, comp.storedValue ?? 0);
      continue;
    }

    // Gather inputs from wires
    const inputPorts = comp.ports.filter((p) => p.side === 'left');
    const inputVals: (number | undefined)[] = [];
    let hasUndefined = false;
    for (const port of inputPorts) {
      const incomingWire = wires.find(
        (w) => w.targetComponentId === comp.id && w.targetPortId === port.id
      );
      if (incomingWire) {
        const srcVal = portValues.get(
          `${incomingWire.sourceComponentId}:${incomingWire.sourcePortId}`
        );
        inputVals.push(srcVal);
        if (srcVal != null) {
          wireValues.set(incomingWire.id, srcVal);
        }
        if (srcVal == null) hasUndefined = true;
      } else {
        inputVals.push(undefined);
        hasUndefined = true;
      }
    }

    // Evaluate — if any input is undefined, output is undefined
    if (comp.type === 'OUTPUT') {
      const hasIncomingWire = wires.some(
        (w) => w.targetComponentId === comp.id && w.targetPortId === 'in'
      );
      if (hasIncomingWire) {
        portValues.set(`${comp.id}:in`, hasUndefined ? undefined : (inputVals[0] ?? 0));
      }
    } else if (hasUndefined) {
      // Gate with undefined input → undefined output
      const outputPorts = comp.ports.filter((p) => p.side === 'right');
      for (const op of outputPorts) {
        portValues.set(`${comp.id}:${op.id}`, undefined);
      }
    } else {
      const outputs = evaluateGate(comp.type, inputVals as number[], comp);
      const outputPorts = comp.ports.filter((p) => p.side === 'right');
      for (let i = 0; i < outputPorts.length; i++) {
        portValues.set(`${comp.id}:${outputPorts[i].id}`, outputs[i] ?? 0);
      }
    }
  }

  // Wire values for wires coming from INPUTs (and any not yet recorded)
  for (const w of wires) {
    if (!wireValues.has(w.id)) {
      const srcVal = portValues.get(`${w.sourceComponentId}:${w.sourcePortId}`);
      if (srcVal != null) {
        wireValues.set(w.id, srcVal);
      }
      // If srcVal is undefined, leave the wire unset.
    }
  }

  return { portValues, wireValues };
}

/**
 * Headless grading primitive: set INPUT values from a bit vector (ordered by
 * IN-label via the shared `sortByLabel` convention), evaluate the circuit, and
 * return OUTPUT bits (ordered by OUT-label). Input/output ordering matches the
 * canvas exactly.
 *
 * `components`/`wires` are not mutated; a shallow copy carries the input values.
 */
export function evaluateCCInputs(
  components: CircuitComponent[],
  wires: Wire[],
  inputBits: number[]
): number[] {
  const inputs = sortByLabel(components, 'IN');
  const withInputs = components.map((c) => {
    const idx = inputs.indexOf(c);
    return idx >= 0 ? { ...c, value: inputBits[idx] ?? 0 } : c;
  });

  const { portValues } = evaluateCC(withInputs, wires);

  const outputs = sortByLabel(withInputs, 'OUT');
  return outputs.map((o) => portValues.get(`${o.id}:in`) ?? 0);
}
