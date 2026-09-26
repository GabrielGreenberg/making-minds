import type { CircuitComponent, ConfirmedBoxDef, Port, Wire } from './types';
import { getPortsForType, GRID_SIZE } from './types';
import { orderBoxPorts, type BoxPortKeys } from './boxPorts';
import { hasCombinationalLoop, hasMemory, parsePortKey, sortByLabel, zeroMemState } from './engine/netlist';
import { boxSize, getComponentBounds, getPortPosition, PART_SIZE } from './componentGeometry';
import { isMemSinkPort } from './types';

type BoxShape = Pick<ConfirmedBoxDef, 'internalComponents' | 'inputPortIds' | 'outputPortIds'>;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const snap = (v: number) => Math.round(v / GRID_SIZE) * GRID_SIZE;

export function nodePortKeys(components: CircuitComponent[]): BoxPortKeys {
  return {
    inputs: sortByLabel(components, 'IN').map((c) => `${c.id}:out`),
    outputs: sortByLabel(components, 'OUT').map((c) => `${c.id}:in`),
  };
}

export function instancePorts(box: BoxShape): Port[] {
  const keys = orderBoxPorts(box.internalComponents, box.inputPortIds, box.outputPortIds);
  return [
    ...keys.inputs.map((bind, i) => ({ id: `in${i + 1}`, label: `in${i + 1}`, side: 'left' as const, index: i, bind })),
    ...keys.outputs.map((bind, i) => ({ id: `out${i + 1}`, label: `out${i + 1}`, side: 'right' as const, index: i, bind })),
  ];
}

export function containsCopyOf(components: CircuitComponent[], boxId: string): boolean {
  return components.some(
    (c) =>
      c.type === 'BOXED' &&
      (c.boxedCircuitId === boxId || containsCopyOf(c.internalCircuit?.components ?? [], boxId)),
  );
}

function ioNode(type: 'INPUT' | 'OUTPUT', id: string, label: string, x: number, y: number): CircuitComponent {
  return {
    id,
    type,
    x: snap(x),
    y: snap(y),
    label,
    ports: getPortsForType(type),
    value: type === 'INPUT' ? undefined : 0,
    inputValues: type === 'INPUT' ? [undefined as unknown as number] : undefined,
  };
}

function link(id: string, src: string, srcPort: string, tgt: string, tgtPort: string): Wire {
  return { id, sourceComponentId: src, sourcePortId: srcPort, targetComponentId: tgt, targetPortId: tgtPort, value: 0 };
}

function bounds(components: CircuitComponent[]) {
  const bs = components.map(getComponentBounds);
  return {
    left: Math.min(...bs.map((b) => b.left)),
    top: Math.min(...bs.map((b) => b.top)),
    right: Math.max(...bs.map((b) => b.right)),
    bottom: Math.max(...bs.map((b) => b.bottom)),
  };
}

function stack(desired: number[]): number[] {
  const h = PART_SIZE.INPUT.h;
  const out: number[] = [];
  for (const y of desired) out.push(out.length === 0 ? y : Math.max(y, out[out.length - 1] + h + GRID_SIZE));
  return out;
}

function portY(comp: CircuitComponent | undefined, portId: string, fallback: number): number {
  return comp ? getPortPosition(comp, portId).y - PART_SIZE.INPUT.h / 2 : fallback;
}

export function editableBoxCircuit(box: BoxShape & { internalWires: Wire[] }, mint: () => string): { components: CircuitComponent[]; wires: Wire[] } {
  const components = clone(box.internalComponents);
  const wires = clone(box.internalWires);
  const keys = orderBoxPorts(components, box.inputPortIds, box.outputPortIds);
  const byId = new Map(components.map((c) => [c.id, c]));
  const b = components.length > 0 ? bounds(components) : { left: 100, top: 100, right: 300, bottom: 100 };
  const ins: CircuitComponent[] = [];
  const outs: CircuitComponent[] = [];
  const inYs = stack(keys.inputs.map((key, k) => portY(byId.get(parsePortKey(key).compId), parsePortKey(key).portId, b.top + k * 60)));
  const outYs = stack(keys.outputs.map((key, j) => portY(byId.get(parsePortKey(key).compId), parsePortKey(key).portId, b.top + j * 60)));
  keys.inputs.forEach((key, k) => {
    const { compId, portId } = parsePortKey(key);
    const inner = byId.get(compId);
    if (inner?.type === 'INPUT') return ins.push(inner);
    const node = ioNode('INPUT', mint(), '', b.left - 100, inYs[k]);
    components.push(node);
    if (inner) wires.push(link(mint(), node.id, 'out', compId, portId));
    ins.push(node);
  });
  keys.outputs.forEach((key, j) => {
    const { compId, portId } = parsePortKey(key);
    const inner = byId.get(compId);
    if (inner?.type === 'OUTPUT') return outs.push(inner);
    const node = ioNode('OUTPUT', mint(), '', b.right + 60, outYs[j]);
    components.push(node);
    if (inner) wires.push(link(mint(), compId, portId, node.id, 'in'));
    outs.push(node);
  });
  const relabel = (nodes: CircuitComponent[], all: CircuitComponent[], prefix: 'IN' | 'OUT') => {
    const rest = sortByLabel(all, prefix).filter((c) => !nodes.includes(c));
    [...nodes, ...rest].forEach((c, i) => { c.label = `${prefix}${i + 1}`; });
  };
  relabel(ins, components, 'IN');
  relabel(outs, components, 'OUT');
  return { components, wires };
}

export function boxEntryFromInstance(comp: CircuitComponent): ConfirmedBoxDef {
  const internals = comp.internalCircuit ?? { components: [], wires: [] };
  const bound = comp.ports.some((p) => p.bind !== undefined);
  const keys = bound
    ? {
        inputs: comp.ports.filter((p) => p.side === 'left').map((p) => p.bind ?? ''),
        outputs: comp.ports.filter((p) => p.side === 'right').map((p) => p.bind ?? ''),
      }
    : nodePortKeys(internals.components);
  return {
    id: comp.boxedCircuitId ?? comp.id,
    name: comp.label,
    kind: hasMemory(internals.components) ? 'SC' : 'CC',
    inputPortIds: keys.inputs,
    outputPortIds: keys.outputs,
    internalComponents: internals.components,
    internalWires: internals.wires,
  };
}

export function boxCircuitProblem(components: CircuitComponent[], wires: Wire[]): string | null {
  if (components.length === 0) return 'The box is empty. Build its circuit first.';
  if (components.some((c) => c.type === 'STATE')) return 'A box holds a circuit, not states.';
  if (!components.some((c) => c.type === 'OUTPUT')) return 'Give the box at least one output: an OUT node.';
  if (hasCombinationalLoop(components, wires)) return 'Loop detected: a box cannot contain a loop.';
  const fedCount = new Map<string, number>();
  for (const w of wires) {
    const key = `${w.targetComponentId}:${w.targetPortId}`;
    fedCount.set(key, (fedCount.get(key) ?? 0) + 1);
  }
  const used = new Set(wires.map((w) => `${w.sourceComponentId}:${w.sourcePortId}`));
  for (const c of components) {
    if (c.type === 'INPUT') continue;
    for (const p of c.ports) {
      const key = `${c.id}:${p.id}`;
      const sink = c.type === 'MEM' ? isMemSinkPort(c, p.id) : p.side === 'left';
      if (sink && (fedCount.get(key) ?? 0) > 1) return `Merged link: ${c.label} has two wires into one input.`;
      if (sink && !fedCount.has(key)) return `Free end: an input of ${c.label} is not connected.`;
      if (!sink && !used.has(key)) return `Free end: an output of ${c.label} is not connected. Wire it on, or to an OUT node.`;
    }
  }
  return null;
}

export function boxEntryFromCanvas(
  id: string,
  name: string,
  components: CircuitComponent[],
  wires: Wire[],
  origin: number | undefined,
): ConfirmedBoxDef {
  const keys = nodePortKeys(components);
  return {
    id,
    name,
    kind: hasMemory(components) ? 'SC' : 'CC',
    inputPortIds: keys.inputs,
    outputPortIds: keys.outputs,
    internalComponents: zeroMemState(clone(components)),
    internalWires: clone(wires),
    ...(origin !== undefined ? { origin } : {}),
  };
}

export function replaceCopies(
  components: CircuitComponent[],
  wires: Wire[],
  entry: ConfirmedBoxDef,
): { components: CircuitComponent[]; wires: Wire[] } {
  const ports = instancePorts(entry);
  const portIds = new Set(ports.map((p) => p.id));
  const replaced = new Set<string>();
  let changed = false;
  const next = components.map((c) => {
    if (c.type !== 'BOXED') return c;
    if (c.boxedCircuitId === entry.id) {
      replaced.add(c.id);
      changed = true;
      return {
        ...c,
        label: entry.name,
        ports: ports.map((p) => ({ ...p })),
        internalCircuit: {
          components: zeroMemState(clone(entry.internalComponents)),
          wires: clone(entry.internalWires),
        },
      };
    }
    const ic = c.internalCircuit;
    if (!ic) return c;
    const inner = replaceCopies(ic.components, ic.wires, entry);
    if (inner.components === ic.components && inner.wires === ic.wires) return c;
    changed = true;
    return { ...c, internalCircuit: { ...ic, ...inner } };
  });
  if (!changed) return { components, wires };
  const dangling = (compId: string, portId: string) => replaced.has(compId) && !portIds.has(portId);
  const kept = wires.filter(
    (w) => !dangling(w.sourceComponentId, w.sourcePortId) && !dangling(w.targetComponentId, w.targetPortId),
  );
  return { components: next, wires: kept.length === wires.length ? wires : kept };
}

export function replaceCopiesInLibrary(library: ConfirmedBoxDef[], entry: ConfirmedBoxDef): ConfirmedBoxDef[] {
  return library.map((b) => {
    if (b.id === entry.id) return entry;
    const inner = replaceCopies(b.internalComponents, b.internalWires, entry);
    if (inner.components === b.internalComponents && inner.wires === b.internalWires) return b;
    return { ...b, internalComponents: inner.components, internalWires: inner.wires };
  });
}

export type Extraction =
  | { error: string }
  | { entry: ConfirmedBoxDef; instance: CircuitComponent; components: CircuitComponent[]; wires: Wire[] };

export function extractSelection(
  components: CircuitComponent[],
  wires: Wire[],
  selectedIds: readonly string[],
  opts: { id: string; name: string; origin?: number; mint: () => string },
): Extraction {
  const selected = new Set(selectedIds);
  const inside = components.filter(
    (c) => selected.has(c.id) && c.type !== 'INPUT' && c.type !== 'OUTPUT' && c.type !== 'STATE',
  );
  if (inside.length === 0) return { error: 'Select the parts to box first. Inputs and outputs stay on the canvas.' };
  const ids = new Set(inside.map((c) => c.id));
  const byId = new Map(components.map((c) => [c.id, c]));
  const internal = wires.filter((w) => ids.has(w.sourceComponentId) && ids.has(w.targetComponentId));
  const incoming = wires.filter((w) => !ids.has(w.sourceComponentId) && ids.has(w.targetComponentId));
  const outgoing = wires.filter((w) => ids.has(w.sourceComponentId) && !ids.has(w.targetComponentId));
  if (hasCombinationalLoop(inside, internal)) return { error: 'Loop detected: a box cannot contain a loop.' };

  const srcKey = (w: Wire) => `${w.sourceComponentId}:${w.sourcePortId}`;
  const at = (key: string) => {
    const { compId, portId } = parsePortKey(key);
    const c = byId.get(compId);
    return c ? getPortPosition(c, portId) : { x: 0, y: 0 };
  };
  const distinct = (ws: Wire[]) =>
    [...new Set(ws.map(srcKey))].sort((a, b) => at(a).y - at(b).y || at(a).x - at(b).x || (a < b ? -1 : 1));
  const inSources = distinct(incoming);
  const outSources = distinct(outgoing);

  const b = bounds(inside);
  const firstTarget = (key: string) => {
    const w = incoming.find((x) => srcKey(x) === key)!;
    return portY(byId.get(w.targetComponentId), w.targetPortId, b.top);
  };
  const inYs = stack(inSources.map(firstTarget));
  const outYs = stack(outSources.map((key) => at(key).y - PART_SIZE.OUTPUT.h / 2));
  const ins = inSources.map((_, k) => ioNode('INPUT', opts.mint(), `IN${k + 1}`, b.left - 100, inYs[k]));
  const outs = outSources.map((_, j) => ioNode('OUTPUT', opts.mint(), `OUT${j + 1}`, b.right + 60, outYs[j]));

  const innerWires: Wire[] = clone(internal);
  for (const w of incoming) {
    const k = inSources.indexOf(srcKey(w));
    innerWires.push(link(opts.mint(), ins[k].id, 'out', w.targetComponentId, w.targetPortId));
  }
  outSources.forEach((key, j) => {
    const { compId, portId } = parsePortKey(key);
    innerWires.push(link(opts.mint(), compId, portId, outs[j].id, 'in'));
  });
  const entry = boxEntryFromCanvas(opts.id, opts.name, [...clone(inside), ...ins, ...outs], innerWires, opts.origin);

  const size = boxSize(ins.length, outs.length);
  const instance: CircuitComponent = {
    id: opts.mint(),
    type: 'BOXED',
    x: snap((b.left + b.right) / 2 - size.w / 2),
    y: snap((b.top + b.bottom) / 2 - size.h / 2),
    label: opts.name,
    ports: instancePorts(entry),
    value: 0,
    boxedCircuitId: entry.id,
    internalCircuit: { components: clone(entry.internalComponents), wires: clone(entry.internalWires) },
  };
  const outerWires = wires.filter((w) => !ids.has(w.sourceComponentId) && !ids.has(w.targetComponentId));
  inSources.forEach((key, k) => {
    const { compId, portId } = parsePortKey(key);
    outerWires.push(link(opts.mint(), compId, portId, instance.id, `in${k + 1}`));
  });
  for (const w of outgoing) {
    const j = outSources.indexOf(srcKey(w));
    outerWires.push(link(opts.mint(), instance.id, `out${j + 1}`, w.targetComponentId, w.targetPortId));
  }
  return {
    entry,
    instance,
    components: [...components.filter((c) => !ids.has(c.id)), instance],
    wires: outerWires,
  };
}
