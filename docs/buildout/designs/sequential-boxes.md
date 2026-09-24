# Sequential boxes: a boxed MEM
_Status: accepted · 2026-09-23 · Task: 2026-09-21-004_

## Problem family
A box is evaluated as a stateless call (`evaluateBoxedCircuit`), and the SC
engine clocked only top-level MEMs, so a boxed one-tick delay read 0000
instead of 0101. `confirmBox` therefore refused MEM. Students building serial
adders, counters and toggles want to box the sequential part, and the class
covers every place a machine is clocked: the grader (value, perception and
turbot-brain cases), the live SC run and its tables, the timeline, save/load,
undo and the resets.

A second shape matters as much as the first: a feedback loop may run
THROUGH the box (box out → NOT → box in), broken only by the MEM inside. Any
box-by-box evaluation (compute each box from its inputs) sees that as a cycle.

## Options
1. **Per-instance state threaded through a box call** (the task's sketch):
   `evaluateSCSequence` carries state keyed by instance + internal MEM id, and
   each box computes outputs and next state from its inputs. Leaves the loop
   through a box unsolvable without a second, box-aware scheduler, and needs a
   parallel runtime slice kept in step with undo, autosave and the resets.
2. **Inline.** Replace every box holding memory with its internals — one flat
   netlist, ports spliced onto the wires around it — and run the ordinary SC
   step on it. "Boxed ≡ unboxed" holds by construction, loops included.

## Decision
Option 2 (`app/src/engine/netlist.ts`). Only boxes holding memory are inlined,
so every existing circuit evaluates as it always has (same arrays, same
topological order). Ports bind through the one port-binding model that
`evaluateBoxedCircuit` also reads (`boxInterior`, task 038 —
[box-port-binding.md](box-port-binding.md)); an inlined id is its box path
joined with its own id, the path kept as a `string[]` and never recovered by
splitting.

Nested state lives where top-level state lives: on the nested MEM's own
`storedValue`, inside the placed instance's `internalCircuit`. Undo snapshots,
autosave, `gradingCircuit` and the resets then treat both levels alike, and
`CircuitData` does not change. `memorySlots` is the one state vector (top-level
MEMs by label, then each box's, recursively) that the engine, turbot SC brains,
the store's runs and the state table index by — so the table shows a boxed
MEM as its own column ('Box 1·M1'): the table is keyed by the machine's state,
and hiding part of it would file distinct states under one row.

A box holding memory is confirmed as `kind: 'SC'` and is placeable only where
a machine may be sequential (`placeableBoxKinds`: SC questions and brains, the
sandbox Logic Circuit tab); `confirmBox`, `placeBoxInstance` and `paste` all
enforce it (a paste cannot tell CC from SC by canvas kind alone).

## Blast radius
Engine: `netlist.ts` (new), `sc.ts` (`scNetlist`/`evaluateSCStep` replace
`evaluateSCSingleStep`), `cc.ts` (`evaluateCC` inlines; a boxed MEM reads its
value), `turbot.ts`, `caseRun.ts gradingCircuit`. Store: `confirmBox`,
`placeBoxInstance`, `paste`, `selectPlaceableBoxKinds`, `scStep`, the resets, the local
I/O step. UI: palette filter, state-table columns, SC detection. The server
imports the engine and needs no change. Pins: `boxScopeCheck [sequential
boxes]` (engine, all SC reference fixtures boxed whole, store),
`scWindowCheck`, `pipelineCheck`.
