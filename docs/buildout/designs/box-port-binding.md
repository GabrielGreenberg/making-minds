# Box port binding: what each port of a box stands for
_Status: accepted · 2026-09-24 · Task: 2026-09-23-038_

## Problem family
A placed box's ports were bound by label: its k-th left port to the k-th
internal INPUT in label order, its j-th right port to the j-th OUTPUT. That
holds only for a box that encloses its own IN/OUT nodes. The natural gesture
of drawing a box around gates *in place*, across the wires that feed them,
confirms a box with no IN/OUT inside at all. `confirmBox` recorded the cut
wires' inner endpoints (`inputPortIds`/`outputPortIds`), but nothing ever read
them, so every output of a placed copy read 0: a boxed NOT gave 0 at input 0.
The same shape covers:
- a sequential box drawn around a MEM only (task 004's inlining also bound by
  label, so a delay read 0000);
- one outside source feeding two sinks inside (fan-in: two ports);
- a source inside feeding both inside and out (fan-out: an output port);
- a mixed box, holding its own IN and cutting a wire as well;
- an own IN that also feeds a wire leaving the box (a pass-through), which
  the label rule had silently dropped from the inputs;
- boxes already saved this way, in assignments, sandboxes and workbook files.

## Options
1. **Refuse** (surgical): `confirmBox` rejects a box with no IN/OUT inside.
   New dead boxes stop, saved ones stay dead, and the in-place gesture is gone.
2. **Bind** (deep): each placed port records the internal endpoint it stands
   for, and one resolver turns that into the box's interior. Every place a box
   is evaluated reads ports through it.

## Decision
Option 2. `Port.bind` (`${compId}:${portId}`, BOXED ports only) holds the
endpoint; `engine/netlist.ts boxInterior` is the one port-binding model. A
port bound to an internal IN/OUT is that node. A port bound to any other
endpoint gets a synthesised `#inK`/`#outJ` node wired to it, so the box
computes exactly the circuit it was drawn around. Synthesised nodes live only
in the interior (never saved, never MEM or BOXED, so `memorySlots` and every
saved id are unchanged). `evaluateBoxedCircuit`, `inlineSequentialBoxes`,
`boxMemoryOutputs` and `stepBoxedMemory` all resolve through it.

The engine only follows bindings. Choosing them needs geometry, so it lives
in `app/src/boxPorts.ts`: `orderBoxPorts` is THE port order (own INs/OUTs by
label first, then every other endpoint top to bottom by where it sits inside).
`confirmBox` records it, and `placeBoxInstance` stamps it as `bind`s. A box's
own INPUT is always an input port, and also an output when it feeds outside
(likewise an own OUTPUT fed from outside).

**The legacy rule** (loop-settled 2026-09-24, open to Gabriel's revision).
A box with no port bound keeps the label rule exactly, so every box that
encloses its own IN/OUT evaluates byte-identically. On load (an assignment's
`restoreQuestionCircuits`, the sandbox autosave, an opened workbook file),
`rebindLegacyBoxes` re-binds a pre-038 box when the label rule leaves one of
its ports dead (more ports than own INs/OUTs) and the port map it was
confirmed with (its library entry's keys, or failing that its internals' free
ends) fits its ports. Every port the label rule reaches keeps exactly its own
IN/OUT; each dead port takes the map's next unused key, ordered as a fresh
placement would order it. So a drawn-across box starts computing what it
enclosed, and no port that carried a signal moves: before 038, `confirmBox`
left an own IN that also fed a wire leaving the box out of its inputs (and an
own OUT fed from outside out of its outputs), so the recorded order alone
could put a live port on another node. The same rule runs over every library
entry's internals (`rebindLegacyLibrary`) wherever a library loads, sandbox
and workbook file included, so a box placed from the library computes at
once. This is a load normalisation, not an edit: no undo entry and no
editing-record step. A box no rule can bind (a fan-out box whose library entry
is gone) stays as it is, and the canvas warns (`unboundBoxes`). Re-binding
was judged safe because such boxes computed 0. The term starts 2026-09-24,
before any graded work.

A submitted snapshot is never re-bound. It runs as it was graded, and a
stored result is never silently regraded. A submission carries its bindings,
so the server grades exactly what the live run ran.

## Blast radius
Types: `Port.bind` (workbook files validate it as a string). Engine:
`netlist.ts` (`boxInterior`, `parsePortKey`; inlining through the interior),
`cc.ts evaluateBoxedCircuit`, `sc.ts boxMemoryOutputs`/`stepBoxedMemory`,
`caseRun.ts gradedMachineKey` (a binding joins the key only when present, so
keys from before 038 are unchanged). New `boxPorts.ts`. Store: `confirmBox`,
`placeBoxInstance`, `remint` (bindings follow reminted internal ids),
`importWorkbook`, the sandbox autosave load; `storage/workbookStore.ts
restoreQuestionCircuits`. UI: one canvas warning. The server imports the
engine and needs no change. Pins: `boxScopeCheck [drawn-across boxes]`
(engine, all 62 HW1–HW3 fixtures boxed across plus the legacy round trip,
store, legacy, legacy own IN/OUT), `pipelineCheck [boxed-across answers]`,
server `parityCheck` §8.
