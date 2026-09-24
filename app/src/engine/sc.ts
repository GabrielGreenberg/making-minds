// Sequential-circuit evaluation engine.
//
// Framework-agnostic: no React, no Zustand, no DOM. Importable from Node (CLI grader).
//
// Every clocked run goes through `scNetlist`: the machine with its
// memory-holding boxes inlined (engine/netlist.ts), so a MEM inside a placed
// box is clocked exactly as it would be on the canvas. The memory vector is
// always `memorySlots` order — top-level MEMs by label, then boxed ones.

import type { CircuitComponent, Wire } from '../types';
import { getMemOutputPortId, getMemInputPortId } from '../types';
import { topologicalSort, evaluateGate, evaluateCC } from './cc';
import { inlineSequentialBoxes, memorySlots, sortByLabel, withMemState, type Netlist } from './netlist';

/** A machine ready to clock: the inlined netlist plus everything a step
 *  needs that depends only on its structure. */
export interface SCNetlist extends Netlist {
  /** Top-level INPUTs in label order — the order of an input bit vector. */
  inputs: CircuitComponent[];
  /** Top-level OUTPUTs in label order — the order of an output bit vector. */
  outputs: CircuitComponent[];
  /** The netlist's MEMs, parallel to memorySlots(components). */
  mems: CircuitComponent[];
  /** Evaluation order (MEM inputs are next-tick feedback, so they break cycles). */
  order: CircuitComponent[];
  /** `${compId}:${portId}` → the first wire into that port. */
  inWire: Map<string, Wire>;
}

export function scNetlist(components: CircuitComponent[], wires: Wire[]): SCNetlist {
  const net = inlineSequentialBoxes(components, wires);
  const byId = new Map(net.components.map((c) => [c.id, c]));
  const inWire = new Map<string, Wire>();
  for (const w of net.wires) {
    const k = `${w.targetComponentId}:${w.targetPortId}`;
    if (!inWire.has(k)) inWire.set(k, w);
  }
  return {
    ...net,
    inputs: sortByLabel(net.components, 'IN'),
    outputs: sortByLabel(net.components, 'OUT'),
    mems: memorySlots(components).map((s) => byId.get(s.key) ?? s.mem),
    order: topologicalSort(net.components, net.wires),
    inWire,
  };
}

export interface SCStepResult {
  outputBits: number[];
  /** Next tick's memory, parallel to memorySlots. */
  newMemValues: number[];
  /** "compId:portId" → value, including each inlined box's output ports
   *  under their own keys (`boxId:out1`), so the original wires paint. */
  portValues: Map<string, number>;
}

/**
 * One clock cycle.
 *
 * @param net        - scNetlist(components, wires).
 * @param inputBits  - This cycle's input bits (net.inputs order; missing = 0).
 * @param memValues  - What each MEM holds now (memorySlots order; missing = 0).
 */
export function evaluateSCStep(net: SCNetlist, inputBits: number[], memValues: number[]): SCStepResult {
  const portValues = new Map<string, number>();
  const read = (w: Wire | undefined) =>
    w ? (portValues.get(`${w.sourceComponentId}:${w.sourcePortId}`) ?? 0) : 0;

  net.mems.forEach((m, i) => portValues.set(`${m.id}:${getMemOutputPortId(m)}`, memValues[i] ?? 0));
  net.inputs.forEach((c, i) => portValues.set(`${c.id}:out`, inputBits[i] ?? 0));

  for (const comp of net.order) {
    if (comp.type === 'INPUT' || comp.type === 'MEM') continue;
    const inputVals = comp.ports
      .filter((p) => p.side === 'left')
      .map((port) => read(net.inWire.get(`${comp.id}:${port.id}`)));
    if (comp.type === 'OUTPUT') {
      portValues.set(`${comp.id}:in`, inputVals[0] ?? 0);
    } else {
      const evalOutputs = evaluateGate(comp.type, inputVals, comp);
      const outputPorts = comp.ports.filter((p) => p.side === 'right');
      for (let i = 0; i < outputPorts.length; i++) {
        portValues.set(`${comp.id}:${outputPorts[i].id}`, evalOutputs[i] ?? 0);
      }
    }
  }

  const outputBits = net.outputs.map((o) => portValues.get(`${o.id}:in`) ?? 0);
  const newMemValues = net.mems.map((m) => read(net.inWire.get(`${m.id}:${getMemInputPortId(m)}`)));
  for (const [alias, src] of net.portAlias) {
    portValues.set(alias, src === null ? 0 : (portValues.get(src) ?? 0));
  }
  return { outputBits, newMemValues, portValues };
}

/**
 * Run a sequential circuit for multiple clock cycles and return the output
 * bit-vector for each cycle.
 *
 * @param components - All circuit components.
 * @param wires      - All wires.
 * @param inputSteps - One inner array per time step; each is the full input
 *                     bit-vector for that cycle (sorted IN1, IN2, …).
 * @param initialMemValues - Initial value for each MEM, memorySlots order
 *                           (top-level by label, then boxed). Defaults to
 *                           each MEM's own storedValue.
 * @returns One inner array per time step = output bit-vector (sorted OUT1, OUT2, …).
 */
export function evaluateSCSequence(
  components: CircuitComponent[],
  wires: Wire[],
  inputSteps: number[][],
  initialMemValues?: number[]
): number[][] {
  const net = scNetlist(components, wires);
  let memValues = memorySlots(components).map((s, i) =>
    initialMemValues != null && initialMemValues[i] != null ? initialMemValues[i] : s.value
  );
  const results: number[][] = [];
  for (const inputBits of inputSteps) {
    const step = evaluateSCStep(net, inputBits, memValues);
    results.push(step.outputBits);
    memValues = step.newMemValues;
  }
  return results;
}

// ─── A placed box as one gate (the store's local I/O step) ───────────

/**
 * The outputs of a memory-holding box that its memory alone decides — known
 * before its inputs are (undefined where an output depends on an input).
 * Right-port order. The local step seeds these like a MEM's output, so a
 * feedback loop through the box still animates.
 */
export function boxMemoryOutputs(box: CircuitComponent): (number | undefined)[] {
  const ic = box.internalCircuit;
  if (!ic) return [];
  const ins = sortByLabel(ic.components, 'IN');
  const blank = ic.components.map((c) => (ins.includes(c) ? { ...c, value: undefined } : c));
  const { portValues } = evaluateCC(blank, ic.wires);
  return sortByLabel(blank, 'OUT').map((o) => portValues.get(`${o.id}:in`));
}

/** The box after one clock tick on `inputs` (left-port order): its MEMs, at
 *  every depth, now hold their next values. */
export function stepBoxedMemory(box: CircuitComponent, inputs: number[]): CircuitComponent {
  const ic = box.internalCircuit;
  if (!ic) return box;
  const now = memorySlots(ic.components).map((s) => s.value);
  const { newMemValues } = evaluateSCStep(scNetlist(ic.components, ic.wires), inputs, now);
  const components = withMemState(ic.components, newMemValues);
  return components === ic.components ? box : { ...box, internalCircuit: { ...ic, components } };
}
