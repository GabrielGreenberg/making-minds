// Box ports: which internal endpoint each port of a placed box stands for,
// and in what order (task 038; design memo
// docs/buildout/designs/box-port-binding.md).
//
// The engine only FOLLOWS a port's binding (`Port.bind`, resolved by
// engine/netlist.ts boxInterior). Choosing the bindings — the order ports come
// in, and what a box saved before 038 stood for — needs the canvas geometry,
// so it lives here, beside the store that calls it. Pure: no React, no
// Zustand, no DOM, no grader.

import type { CircuitComponent, ConfirmedBoxDef, Port, Wire } from './types';
import { isMemSinkPort } from './types';
import { getPortPosition } from './componentGeometry';
import { parsePortKey, sortByLabel } from './engine/netlist';

/** A box's port keys: `inputs[k]` is what its k-th left port stands for,
 *  `outputs[j]` its j-th right port (`${compId}:${portId}`, inside). */
export interface BoxPortKeys {
  inputs: string[];
  outputs: string[];
}

/**
 * THE port order of a box (confirmBox records it, placeBoxInstance stamps it,
 * a pre-038 box is re-bound by it): its own INs by label first (so a box that
 * encloses its IN/OUT binds exactly as the label rule always did), then every
 * other endpoint top to bottom by where it sits inside (y, then x, then key);
 * outputs the same way with its own OUTs. Duplicates dropped; idempotent.
 */
export function orderBoxPorts(internals: CircuitComponent[], inKeys: string[], outKeys: string[]): BoxPortKeys {
  const byId = new Map(internals.map((c) => [c.id, c]));
  const at = (key: string): { x: number; y: number } => {
    const { compId, portId } = parsePortKey(key);
    const c = byId.get(compId);
    if (!c) return { x: Infinity, y: Infinity };
    const p = getPortPosition(c, portId);
    // Rotation leaves float noise; a thousandth of a pixel is the same place.
    return { x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 };
  };
  const order = (keys: string[], own: 'IN' | 'OUT'): string[] => {
    const unique = [...new Set(keys)];
    const ownKeys = sortByLabel(internals, own)
      .map((c) => `${c.id}:${own === 'IN' ? 'out' : 'in'}`)
      .filter((k) => unique.includes(k));
    const rest = unique
      .filter((k) => !ownKeys.includes(k))
      .map((k) => ({ k, p: at(k) }))
      .sort((a, b) => a.p.y - b.p.y || a.p.x - b.p.x || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
      .map(({ k }) => k);
    return [...ownKeys, ...rest];
  };
  return { inputs: order(inKeys, 'IN'), outputs: order(outKeys, 'OUT') };
}

/** `ports` with each left port bound to `keys.inputs` in turn, each right
 *  port to `keys.outputs`. */
export function bindPorts(ports: Port[], keys: BoxPortKeys): Port[] {
  let l = 0;
  let r = 0;
  return ports.map((p) => ({ ...p, bind: p.side === 'left' ? keys.inputs[l++] : keys.outputs[r++] }));
}

// ─── Boxes saved before 038 ──────────────────────────────────────────

const sides = (box: CircuitComponent) => ({
  left: (box.ports ?? []).filter((p) => p.side === 'left').length,
  right: (box.ports ?? []).filter((p) => p.side === 'right').length,
});

// A save is data from outside the app: a box whose internals aren't lists is
// left to the engine, which reads it as it always has.
const isBox = (c: CircuitComponent) =>
  c.type === 'BOXED' && Array.isArray(c.internalCircuit?.components) && Array.isArray(c.internalCircuit?.wires);

const isUnbound = (box: CircuitComponent) => !(box.ports ?? []).some((p) => p.bind !== undefined);

/** What the label rule binds a box to (its own INs/OUTs by label). */
function labelKeys(internals: CircuitComponent[]): BoxPortKeys {
  return {
    inputs: sortByLabel(internals, 'IN').map((c) => `${c.id}:out`),
    outputs: sortByLabel(internals, 'OUT').map((c) => `${c.id}:in`),
  };
}

/** The box's ports read off its internals alone, for an instance whose
 *  library entry is gone: its own INs plus every sink nothing inside feeds
 *  (a wire from outside fed it), its own OUTs plus every source feeding
 *  nothing inside (it fed a wire leaving the box). A source that fed both
 *  inside and out cannot be seen this way. */
function derivedKeys(internals: CircuitComponent[], wires: Wire[]): BoxPortKeys {
  const fed = new Set(wires.map((w) => `${w.targetComponentId}:${w.targetPortId}`));
  const used = new Set(wires.map((w) => `${w.sourceComponentId}:${w.sourcePortId}`));
  const inputs: string[] = [];
  const outputs: string[] = [];
  for (const c of internals) {
    if (c.type === 'INPUT') inputs.push(`${c.id}:out`);
    if (c.type === 'OUTPUT') outputs.push(`${c.id}:in`);
    for (const p of c.ports ?? []) {
      const key = `${c.id}:${p.id}`;
      const sink = c.type === 'MEM' ? isMemSinkPort(c, p.id) : p.side === 'left';
      if (sink ? !fed.has(key) : !used.has(key)) (sink ? inputs : outputs).push(key);
    }
  }
  return orderBoxPorts(internals, inputs, outputs);
}

/** A pre-038 instance's bindings for the ports the label rule leaves dead;
 *  null = the label rule reaches every port (or no map fits), leave it as it
 *  is. Every port the label rule reaches — its k-th left port the k-th own IN
 *  by label, its j-th right port the j-th own OUT — keeps exactly that
 *  binding: no port that carried a signal moves. (The confirmed map alone
 *  won't do: confirmBox before 038 left an own IN that also fed a wire
 *  leaving the box out of its inputs, and an own OUT fed from outside out of
 *  its outputs, so its order can disagree with the label rule's on a live
 *  port.) Each port beyond the label rule's reach — one that carried nothing,
 *  so the cut wire behind it read 0 — takes the next key of the confirmed map
 *  not already bound, in THE port order. */
function legacyBindings(box: CircuitComponent, library: ConfirmedBoxDef[]): BoxPortKeys | null {
  const { components: internals, wires } = box.internalCircuit!;
  const n = sides(box);
  const label = labelKeys(internals);
  if (n.left <= label.inputs.length && n.right <= label.outputs.length) return null;
  const ids = new Set(internals.map((c) => c.id));
  const usable = (k: BoxPortKeys) =>
    k.inputs.length === n.left && k.outputs.length === n.right &&
    [...k.inputs, ...k.outputs].every((key) => ids.has(parsePortKey(key).compId));
  const entry = library.find((b) => b?.id === box.boxedCircuitId);
  const recorded = entry && Array.isArray(entry.inputPortIds) && Array.isArray(entry.outputPortIds)
    ? orderBoxPorts(internals, entry.inputPortIds, entry.outputPortIds)
    : null;
  const keys = recorded && usable(recorded) ? recorded : derivedKeys(internals, wires);
  if (!usable(keys)) return null;
  // `confirmed` has exactly `count` keys (usable), so the fill never runs short.
  const beyondLabel = (reached: string[], confirmed: string[], count: number): string[] => {
    const kept = reached.slice(0, count);
    return [...kept, ...confirmed.filter((k) => !kept.includes(k)).slice(0, count - kept.length)];
  };
  return {
    inputs: beyondLabel(label.inputs, keys.inputs, n.left),
    outputs: beyondLabel(label.outputs, keys.outputs, n.right),
  };
}

/**
 * The re-binding rule for boxes saved before 038 (a load normalisation, not
 * an edit): every unbound placed box, at any depth, with a port the label
 * rule leaves dead and a confirmed port map — its library entry's keys
 * (`boxedCircuitId`), or failing that its internals' free ends — that fits
 * its ports, gets port bindings: each port the label rule reaches keeps its
 * own IN/OUT, each dead one takes the map's next unused key, ordered as a
 * fresh placement orders them. A box drawn across wires then computes what it
 * enclosed instead of 0; no port that carried a signal moves (only a cut wire
 * that read 0 now carries its port), and a box the label rule fully binds is
 * left exactly as it is. Arrays with nothing to change come back as the same
 * objects, so an untouched save stays equal.
 */
export function rebindLegacyBoxes(components: CircuitComponent[], library: ConfirmedBoxDef[]): CircuitComponent[] {
  let changed = false;
  const out = components.map((c) => {
    if (!isBox(c)) return c;
    const ic = c.internalCircuit!;
    const inner = rebindLegacyBoxes(ic.components, library);
    let next = inner === ic.components ? c : { ...c, internalCircuit: { ...ic, components: inner } };
    const keys = isUnbound(next) ? legacyBindings(next, library) : null;
    if (keys) next = { ...next, ports: bindPorts(next.ports, keys) };
    if (next !== c) changed = true;
    return next;
  });
  return changed ? out : components;
}

/** The same rule over a library: each entry's internals (boxes placed inside
 *  a box). The same array when nothing changes. */
export function rebindLegacyLibrary(library: ConfirmedBoxDef[]): ConfirmedBoxDef[] {
  let changed = false;
  const out = library.map((b) => {
    if (!Array.isArray(b?.internalComponents)) return b;
    const internalComponents = rebindLegacyBoxes(b.internalComponents, library);
    if (internalComponents === b.internalComponents) return b;
    changed = true;
    return { ...b, internalComponents };
  });
  return changed ? out : library;
}

/** Labels of the placed boxes, at any depth, that no rule could bind: an
 *  unbound box with more ports than its label rule reaches (drawn across
 *  wires, its map lost). Those ports read 0 — the canvas warns. */
export function unboundBoxes(components: CircuitComponent[]): string[] {
  const found = new Set<string>();
  const walk = (comps: CircuitComponent[]) => {
    for (const c of comps) {
      if (!isBox(c)) continue;
      walk(c.internalCircuit!.components);
      if (!isUnbound(c)) continue;
      const n = sides(c);
      const label = labelKeys(c.internalCircuit!.components);
      if (n.left > label.inputs.length || n.right > label.outputs.length) found.add(c.label);
    }
  };
  walk(components);
  return [...found];
}
