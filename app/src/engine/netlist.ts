// Sequential-box netlist: how a boxed sub-circuit that HOLDS MEMORY runs.
//
// Framework-agnostic (law 2): no React, no Zustand, no DOM. The server grades
// through it.
//
// A combinational box is a pure function call: evaluateBoxedCircuit
// (engine/cc.ts) runs its internals once and returns. A box holding a MEM at
// any depth cannot be one: its MEM must be clocked with the rest of the
// machine, and a feedback loop may run THROUGH the box (box out → NOT → box
// in, the MEM inside breaking it). So such a box is INLINED — its internals
// replace it in one flat netlist, its ports spliced onto the wires around it —
// and the ordinary SC step runs on that. "Boxed ≡ unboxed" then holds by
// construction. Only boxes holding memory are inlined: a circuit without one
// comes back as the very same arrays and evaluates exactly as it always has.
//
// Nested memory lives where top-level memory lives — on the nested MEM's own
// `storedValue`, inside the placed instance's `internalCircuit` — so autosave,
// undo, the resets and the grader's zeroing treat both levels alike.
// `memorySlots` is THE state vector over both: top-level MEMs in label order,
// then each memory-holding box's MEMs, box by box in array order. The SC
// engine, a turbot's SC brain, the store's runs and tables, and
// `withMemState`/`zeroMemState` all index by it. (Design memo:
// docs/buildout/designs/sequential-boxes.md.)
//
// Ids: an inlined component's id is its box path joined with its own id
// (`box/inner/M1`). The path is carried as a string[] and only ever JOINED;
// an id string is never split.

import type { CircuitComponent, Wire } from '../types';
import { isMemSinkPort } from '../types';

/**
 * The ONE IN/OUT label-ordering convention: select a circuit's INPUT (or
 * OUTPUT) components and order them by the numeric suffix of their permanent
 * label ("IN2" → 2; unparseable → 0). Both the top-level grading path
 * (`evaluateCCInputs`) and boxed-circuit internal binding
 * (`evaluateBoxedCircuit`, and the port splicing below) MUST bind bit vectors
 * through this helper so they can never desync — and so does the store's
 * graded-case loader (`loadCaseInput`), which sets a CC case's INPUT toggles
 * through it.
 */
export function sortByLabel(components: CircuitComponent[], prefix: 'IN' | 'OUT'): CircuitComponent[] {
  return components
    .filter((c) => (prefix === 'IN' ? c.type === 'INPUT' : c.type === 'OUTPUT'))
    .sort((a, b) => {
      const na = parseInt(a.label.replace(prefix, '')) || 0;
      const nb = parseInt(b.label.replace(prefix, '')) || 0;
      return na - nb;
    });
}

/** True when the circuit holds a MEM at any depth, boxed internals included. */
export function hasMemory(components: CircuitComponent[]): boolean {
  return components.some((c) =>
    c.type === 'MEM' || (c.type === 'BOXED' && hasMemory(c.internalCircuit?.components ?? [])),
  );
}

/** A placed box whose internals hold memory (a "sequential box"). */
export function isSequentialBox(c: CircuitComponent): boolean {
  return c.type === 'BOXED' && hasMemory(c.internalCircuit?.components ?? []);
}

/** A component's id in the inlined netlist: its box path, then its own id. */
function flatId(path: string[], id: string): string {
  return path.length === 0 ? id : `${path.join('/')}/${id}`;
}

/** The engine's MEM order at one level: the numeric part of the label. */
function sortMems(components: CircuitComponent[]): CircuitComponent[] {
  return components
    .filter((c) => c.type === 'MEM')
    .sort((a, b) => (parseInt(a.label.replace(/\D/g, '')) || 0) - (parseInt(b.label.replace(/\D/g, '')) || 0));
}

// ─── The state vector ────────────────────────────────────────────────

export interface MemSlot {
  /** Ids of the box instances around the MEM, outermost first ([] = top level). */
  path: string[];
  /** The MEM component as it sits in its own circuit. */
  mem: CircuitComponent;
  /** The MEM's id in the inlined netlist — also a stable React key. */
  key: string;
  /** Column label: 'M1' on the canvas, 'Box 1·M1' inside a placed box. */
  label: string;
  /** What it holds now (unset reads 0). */
  value: number;
}

/**
 * Every MEM the machine clocks, in THE canonical order: top-level MEMs by
 * label, then each memory-holding box (array order) contributing its own
 * slots the same way, recursively. Two instances of one box keep separate
 * state; the second and later instances of a name are labelled "Box 1 (2)".
 */
export function memorySlots(components: CircuitComponent[]): MemSlot[] {
  const out: MemSlot[] = [];
  const walk = (comps: CircuitComponent[], path: string[], labelPrefix: string) => {
    for (const m of sortMems(comps)) {
      out.push({ path, mem: m, key: flatId(path, m.id), label: labelPrefix + m.label, value: m.storedValue ?? 0 });
    }
    const seen = new Map<string, number>();
    for (const c of comps) {
      if (!isSequentialBox(c)) continue;
      const n = (seen.get(c.label) ?? 0) + 1;
      seen.set(c.label, n);
      const name = n === 1 ? c.label : `${c.label} (${n})`;
      walk(c.internalCircuit!.components, [...path, c.id], `${labelPrefix}${name}·`);
    }
  };
  walk(components, [], '');
  return out;
}

/** Rewrite MEM stored values at every depth. `next` returns the new value, or
 *  undefined to leave the MEM as it is. Untouched levels keep their arrays;
 *  nothing to change returns `components` itself. */
function mapMems(
  components: CircuitComponent[],
  path: string[],
  next: (mem: CircuitComponent, key: string) => number | undefined,
): CircuitComponent[] {
  let changed = false;
  const out = components.map((c) => {
    if (c.type === 'MEM') {
      const v = next(c, flatId(path, c.id));
      if (v === undefined || v === c.storedValue) return c;
      changed = true;
      return { ...c, storedValue: v };
    }
    if (c.type === 'BOXED' && c.internalCircuit) {
      const ic = c.internalCircuit;
      const inner = mapMems(ic.components, [...path, c.id], next);
      if (inner === ic.components) return c;
      changed = true;
      return { ...c, internalCircuit: { ...ic, components: inner } };
    }
    return c;
  });
  return changed ? out : components;
}

/** The machine with its memory set to `values` (parallel to memorySlots;
 *  an undefined entry leaves that MEM alone). */
export function withMemState(components: CircuitComponent[], values: (number | undefined)[]): CircuitComponent[] {
  const byKey = new Map<string, number>();
  memorySlots(components).forEach((s, i) => {
    const v = values[i];
    if (v !== undefined) byKey.set(s.key, v);
  });
  return mapMems(components, [], (_m, key) => byKey.get(key));
}

/** The machine at rest: every MEM, boxed ones included, holding 0. Returns
 *  `components` itself when that is already so. */
export function zeroMemState(components: CircuitComponent[]): CircuitComponent[] {
  return mapMems(components, [], (m) => (m.storedValue !== 0 ? 0 : undefined));
}

// ─── Inlining ────────────────────────────────────────────────────────

export interface Netlist {
  /** Flat components: everything but the inlined boxes, with those boxes'
   *  internals in their place (minus the internal IN/OUT port nodes). */
  components: CircuitComponent[];
  /** Flat wires. Top-level wires keep their ids; a wire leaving an inlined
   *  box is re-sourced to whatever drives that box output inside. */
  wires: Wire[];
  /** `${boxId}:${portId}` of every inlined box OUTPUT port (box ids in their
   *  flat form) → the flat `${compId}:${portId}` source it carries, or null
   *  when nothing inside drives it (it reads 0). Lets the UI paint the
   *  original wires and label the box. */
  portAlias: Map<string, string | null>;
  /** Box ports wired into a loop with no component on it (a box's IN wired
   *  straight to its OUT, and that output fed back into the input): a
   *  combinational loop with nothing to evaluate. */
  wireLoop: boolean;
}

interface Level {
  path: string[];
  comps: CircuitComponent[];
  wires: Wire[];
  byId: Map<string, CircuitComponent>;
  /** `${targetId}:${portId}` → the FIRST wire into that port (the engine's
   *  `wires.find`, so a merged link reads as it always has). */
  inWire: Map<string, Wire>;
  ins: CircuitComponent[];
  parent: { level: Level; box: CircuitComponent } | null;
}

function makeLevel(
  comps: CircuitComponent[],
  wires: Wire[],
  path: string[],
  parent: Level['parent'],
): Level {
  const inWire = new Map<string, Wire>();
  for (const w of wires) {
    const k = `${w.targetComponentId}:${w.targetPortId}`;
    if (!inWire.has(k)) inWire.set(k, w);
  }
  return {
    path, comps, wires, inWire, parent,
    byId: new Map(comps.map((c) => [c.id, c])),
    ins: sortByLabel(comps, 'IN'),
  };
}

/**
 * Replace every BOXED instance that holds memory (at any depth) with its
 * internals. A box's ports bind exactly as evaluateBoxedCircuit binds them:
 * its k-th left port to the k-th internal IN in label order, its j-th right
 * port to the j-th internal OUT. Combinational boxes stay BOXED calls. With no
 * memory-holding box on the top level, the input arrays come back untouched.
 */
export function inlineSequentialBoxes(components: CircuitComponent[], wires: Wire[]): Netlist {
  if (!components.some(isSequentialBox)) {
    return { components, wires, portAlias: new Map(), wireLoop: false };
  }
  let wireLoop = false;
  const children = new Map<CircuitComponent, Level>();
  const childOf = (level: Level, box: CircuitComponent): Level => {
    let child = children.get(box);
    if (!child) {
      const ic = box.internalCircuit!;
      child = makeLevel(ic.components, ic.wires, [...level.path, box.id], { level, box });
      children.set(box, child);
    }
    return child;
  };

  // The flat source that really drives (compId, portId) at `level`: through a
  // box output to what drives it inside, through an internal IN up to what
  // feeds the box's matching input. null = nothing drives it.
  const resolve = (
    level: Level, compId: string, portId: string, seen: Set<string>,
  ): { id: string; port: string } | null => {
    const c = level.byId.get(compId);
    const through = !c ? null
      : isSequentialBox(c) ? 'box-out'
      : c.type === 'INPUT' && level.parent !== null ? 'box-in'
      : null;
    if (!c || !through) return { id: flatId(level.path, compId), port: portId };
    const key = `${flatId(level.path, compId)}:${portId}`;
    if (seen.has(key)) { wireLoop = true; return null; }
    seen.add(key);
    if (through === 'box-out') {
      const j = c.ports.filter((p) => p.side === 'right').findIndex((p) => p.id === portId);
      const out = j >= 0 ? sortByLabel(c.internalCircuit!.components, 'OUT')[j] : undefined;
      const outPort = out?.ports.find((p) => p.side === 'left')?.id ?? 'in';
      const inner = childOf(level, c);
      const w = out ? inner.inWire.get(`${out.id}:${outPort}`) : undefined;
      return w ? resolve(inner, w.sourceComponentId, w.sourcePortId, seen) : null;
    }
    // An internal IN node: bound to the box's k-th left port.
    const { level: up, box } = level.parent!;
    const k = level.ins.indexOf(c);
    const port = box.ports.filter((p) => p.side === 'left')[k];
    const w = port ? up.inWire.get(`${box.id}:${port.id}`) : undefined;
    return w ? resolve(up, w.sourceComponentId, w.sourcePortId, seen) : null;
  };

  const outComps: CircuitComponent[] = [];
  const outWires: Wire[] = [];
  const portAlias = new Map<string, string | null>();

  const flatten = (level: Level) => {
    const top = level.parent === null;
    for (const c of level.comps) {
      if (isSequentialBox(c)) {
        flatten(childOf(level, c));
        for (const p of c.ports.filter((q) => q.side === 'right')) {
          const src = resolve(level, c.id, p.id, new Set());
          portAlias.set(`${flatId(level.path, c.id)}:${p.id}`, src ? `${src.id}:${src.port}` : null);
        }
        continue;
      }
      // An inlined box's own IN/OUT nodes are its ports, spliced away.
      if (!top && (c.type === 'INPUT' || c.type === 'OUTPUT')) continue;
      outComps.push(top ? c : { ...c, id: flatId(level.path, c.id) });
    }
    for (const w of level.wires) {
      const tgt = level.byId.get(w.targetComponentId);
      // Into an inlined box: its inside reads this wire's source directly.
      if (tgt && isSequentialBox(tgt)) continue;
      // Into a box's internal OUT node: read through the box's output instead.
      if (!top && tgt?.type === 'OUTPUT') continue;
      const src = resolve(level, w.sourceComponentId, w.sourcePortId, new Set());
      if (!src) continue; // an undriven box port: the input it fed reads 0
      if (top && src.id === w.sourceComponentId && src.port === w.sourcePortId) {
        outWires.push(w);
        continue;
      }
      outWires.push({
        ...w,
        id: flatId(level.path, w.id),
        sourceComponentId: src.id,
        sourcePortId: src.port,
        targetComponentId: flatId(level.path, w.targetComponentId),
      });
    }
  };
  flatten(makeLevel(components, wires, [], null));

  return { components: outComps, wires: outWires, portAlias, wireLoop };
}

/**
 * A combinational loop anywhere in the machine — a cycle not broken by a MEM,
 * looking THROUGH memory-holding boxes (a loop around a box is fine exactly
 * when a MEM inside breaks it). The canvas warning and confirmBox's "no
 * loops" rule both ask this.
 */
export function hasCombinationalLoop(components: CircuitComponent[], wires: Wire[]): boolean {
  const net = inlineSequentialBoxes(components, wires);
  if (net.wireLoop) return true;
  const byId = new Map(net.components.map((c) => [c.id, c]));
  const adj = new Map<string, string[]>();
  for (const w of net.wires) {
    // A wire into a MEM's input is the next tick's value, not this tick's.
    const tgt = byId.get(w.targetComponentId);
    if (tgt?.type === 'MEM' && isMemSinkPort(tgt, w.targetPortId)) continue;
    const list = adj.get(w.sourceComponentId);
    if (list) list.push(w.targetComponentId);
    else adj.set(w.sourceComponentId, [w.targetComponentId]);
  }
  const visited = new Set<string>();
  const onStack = new Set<string>();
  const cycleFrom = (id: string): boolean => {
    visited.add(id);
    onStack.add(id);
    for (const next of adj.get(id) ?? []) {
      if (onStack.has(next)) return true;
      if (!visited.has(next) && cycleFrom(next)) return true;
    }
    onStack.delete(id);
    return false;
  };
  return net.components.some((c) => !visited.has(c.id) && cycleFrom(c.id));
}
