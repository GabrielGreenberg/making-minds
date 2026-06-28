// Sequential-circuit evaluation engine.
//
// Framework-agnostic: no React, no Zustand, no DOM. Importable from Node (CLI grader).

import type { CircuitComponent, Wire } from '../types';
import { getMemOutputPortId, getMemInputPortId } from '../types';
import { topologicalSort, evaluateGate } from './cc';

export interface SCSingleStepResult {
  outputBits: number[];
  newMemValues: number[];
  portValues: Map<string, number>;
}

/**
 * Evaluate a single clock cycle of a sequential circuit.
 *
 * @param components      - All circuit components. INPUT `value` and MEM
 *                          `storedValue` fields are ignored; pass the live
 *                          values via the remaining parameters instead.
 * @param wires           - All wires.
 * @param inputBitVector  - Input bits for this cycle (sorted IN1, IN2, …).
 * @param sortedInputs    - INPUT components sorted by numeric label suffix.
 * @param sortedOutputs   - OUTPUT components sorted by numeric label suffix.
 * @param sortedMems      - MEM components sorted by numeric label suffix.
 * @param memStoredValues - Current stored values for each MEM (parallel to sortedMems).
 */
export function evaluateSCSingleStep(
  components: CircuitComponent[],
  wires: Wire[],
  inputBitVector: number[],
  sortedInputs: CircuitComponent[],
  sortedOutputs: CircuitComponent[],
  sortedMems: CircuitComponent[],
  memStoredValues: number[]
): SCSingleStepResult {
  // Build snapshot with current input + MEM values injected
  const snapshot = components.map((c) => {
    if (c.type === 'INPUT') {
      const idx = sortedInputs.findIndex((inp) => inp.id === c.id);
      return { ...c, value: idx >= 0 ? (inputBitVector[idx] ?? 0) : (c.value ?? 0) };
    }
    if (c.type === 'MEM') {
      const idx = sortedMems.findIndex((m) => m.id === c.id);
      return { ...c, storedValue: idx >= 0 ? memStoredValues[idx] : (c.storedValue ?? 0) };
    }
    return c;
  });

  const portValues = new Map<string, number>();

  // Seed MEM output ports
  for (const comp of snapshot) {
    if (comp.type === 'MEM') {
      portValues.set(`${comp.id}:${getMemOutputPortId(comp)}`, comp.storedValue ?? 0);
    }
  }

  const sorted = topologicalSort(snapshot, wires);

  // Seed INPUT ports
  for (const comp of sorted) {
    if (comp.type === 'INPUT') {
      portValues.set(`${comp.id}:out`, comp.value ?? 0);
    }
  }

  // Propagate
  for (const comp of sorted) {
    if (comp.type === 'INPUT' || comp.type === 'MEM') continue;

    const inputPorts = comp.ports.filter((p) => p.side === 'left');
    const inputVals: number[] = inputPorts.map((port) => {
      const wire = wires.find((w) => w.targetComponentId === comp.id && w.targetPortId === port.id);
      return wire ? (portValues.get(`${wire.sourceComponentId}:${wire.sourcePortId}`) ?? 0) : 0;
    });

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

  const outputBits = sortedOutputs.map((o) => portValues.get(`${o.id}:in`) ?? 0);

  // Compute new MEM stored values from their input wires
  const newMemValues = sortedMems.map((mem) => {
    const minWire = wires.find(
      (w) => w.targetComponentId === mem.id && w.targetPortId === getMemInputPortId(mem)
    );
    return minWire ? (portValues.get(`${minWire.sourceComponentId}:${minWire.sourcePortId}`) ?? 0) : 0;
  });

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
 * @param initialMemValues - Initial storedValue for each MEM block (sorted by
 *                           numeric label suffix). Defaults to all-zeros.
 * @returns One inner array per time step = output bit-vector (sorted OUT1, OUT2, …).
 */
export function evaluateSCSequence(
  components: CircuitComponent[],
  wires: Wire[],
  inputSteps: number[][],
  initialMemValues?: number[]
): number[][] {
  const sortedInputs = components
    .filter((c) => c.type === 'INPUT')
    .sort((a, b) => (parseInt(a.label.replace('IN', '')) || 0) - (parseInt(b.label.replace('IN', '')) || 0));

  const sortedOutputs = components
    .filter((c) => c.type === 'OUTPUT')
    .sort((a, b) => (parseInt(a.label.replace('OUT', '')) || 0) - (parseInt(b.label.replace('OUT', '')) || 0));

  const sortedMems = components
    .filter((c) => c.type === 'MEM')
    .sort((a, b) => (parseInt(a.label.replace(/\D/g, '')) || 0) - (parseInt(b.label.replace(/\D/g, '')) || 0));

  let memStoredValues = sortedMems.map((m, i) =>
    initialMemValues != null && initialMemValues[i] != null ? initialMemValues[i] : (m.storedValue ?? 0)
  );

  const results: number[][] = [];

  for (const inputBitVector of inputSteps) {
    const step = evaluateSCSingleStep(
      components, wires, inputBitVector,
      sortedInputs, sortedOutputs, sortedMems, memStoredValues
    );
    results.push(step.outputBits);
    memStoredValues = step.newMemValues;
  }

  return results;
}
