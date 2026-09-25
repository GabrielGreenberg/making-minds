---
id: 2026-09-21-004
type: feature
title: Allow boxing a sequential (MEM-containing) sub-circuit on SC canvases
priority: normal
size: large
requires:
area: app
source: claude-md
created: 2026-09-21T15:30:00-07:00
status: done
after:
branch:
merged_into:
---

## Description
`confirmBox` refuses a selection containing MEM because a boxed circuit is evaluated
statelessly and `evaluateSCSequence` clocks only TOP-LEVEL MEMs: a boxed one-tick delay reads
0000 instead of 0101 (`boxScopeCheck` pins the evidence). Students building serial adders
etc. would like to box sequential parts.

## Done when
- A boxed sub-circuit with MEMs advances its internal state every tick exactly as the
  unboxed circuit does (0101 case passes boxed).
- Grading, the live SC run, the timeline, save/load and undo all agree; `boxScopeCheck`'s
  refusal pin flips to an equivalence pin.

## Design
- **deepFix:** nested MEM state — `evaluateSCSequence` (engine/sc.ts) carries per-instance
  state for BOXED components (keyed by instance id + internal MEM id), the codec/grader thread
  it through, the store's SC slice snapshots it for Step/undo, and `CircuitData` needs no
  change (state is runtime only). `placeableBoxKinds`/`confirmBox` lift the refusal.
- Note (catch 2026-09-21): `confirmBox` writes NO `kind` on the new library entry
  (`app/src/store.ts:2232-2242`), so every box today defaults to CC — correct while boxes are
  combinational-only. A sequential box must be stored with `kind: 'SC'`, and
  `placeableBoxKinds('SC')` / the palette filter (`ComponentLibrary.tsx:322-326`) must
  keep an SC box off CC canvases.
- **surgicalFix:** none honest — inlining the box at evaluation time is the same work.

## Verify
`boxScopeCheck` (boxed ≡ unboxed on the delay and a serial adder), `scWindowCheck`,
`pipelineCheck`; a fixture-level grade parity check.

## Progress log

### 2026-09-23 — implemented (work loop)
- **Inline, don't call.** New pure module `app/src/engine/netlist.ts` (law 2):
  `inlineSequentialBoxes` replaces every placed box holding a MEM (at any depth) with its
  internals — ports bound exactly as `evaluateBoxedCircuit` binds them (left port k ↔ k-th
  internal IN by label, right port j ↔ j-th OUT), internal IN/OUT nodes spliced away,
  inlined ids = box path joined with the own id (the path is a `string[]`, never split),
  top-level wires keep their ids, and `portAlias` maps `box:outN` to what drives it so the
  original wires still paint. Combinational boxes stay BOXED calls and a circuit with no
  memory-holding box comes back as the same arrays, so every existing circuit evaluates
  byte-identically. A loop THROUGH a box (box out → NOT → box in, the MEM inside breaking it)
  works by construction, which a box-by-box state thread could not do. Also there:
  `sortByLabel` (moved from cc.ts, re-exported there), `memorySlots` (THE state vector:
  top-level MEMs by label, then each box's, recursively; labels `Box 1·M1`, a second instance
  of a name `Box 1 (2)·M1`), `withMemState`, `zeroMemState`, `hasMemory`, `isSequentialBox`,
  `hasCombinationalLoop` (DFS on the inlined netlist; MEM-sink wires skipped). Design memo:
  `docs/buildout/designs/sequential-boxes.md`.
- **Where the state lives (deviation from the Design sketch's "runtime slice").** Nested
  state lives on the nested MEM's own `storedValue` inside the placed instance's
  `internalCircuit` — where top-level MEM state already lives. Undo snapshots, autosave,
  `gradingCircuit` and every reset then treat both levels alike with no second slice to keep
  in step, and `CircuitData` does not change.
- **Engine.** `sc.ts`: `scNetlist` + `evaluateSCStep(net, inputBits, memValues)` replace
  `evaluateSCSingleStep`; `portValues` carry the aliases; `evaluateSCSequence` keeps its
  signature (initial values in `memorySlots` order). `cc.ts`: `evaluateCC` inlines when a box
  holds memory (idle display right, loop included); `evaluateBoxedCircuit` seeds an internal
  MEM's output from `storedValue` and inlines a nested memory-holding box (the local step
  evaluates a placed box as one gate). `turbot.ts` SC brains use `memorySlots` +
  `evaluateSCStep`. `caseRun.ts gradingCircuit` = `zeroMemState`. Grader, perception, caseRun
  and the server inherit it all.
- **Store.** `confirmBox`: the MEM refusal is gone; a box holding memory is written
  `kind: 'SC'` (else `'CC'`), its library copy zeroed; refused only where
  `selectPlaceableBoxKinds` lacks SC ("Memory cannot go inside a box here: M1 …"); Rule 1 =
  `hasCombinationalLoop`; Rule 3 reads a MEM port by its role (`isMemSinkPort`), not its side
  — otherwise every MEM failed as "Free end: input port mout". New
  `selectPlaceableBoxKinds` (the sandbox Logic Circuit tab = CC + SC; else
  `placeableBoxKinds(effective mode)`: CC → CC, SC → CC + SC; shared constant arrays for
  zustand); `placeBoxInstance` refuses a kind it excludes (and legacy FSM entries), and
  stamps each instance's memory at rest. `scStep` runs the netlist and writes all memory back
  with `withMemState`; the sandbox drain and the four DataTable drain sites count
  `memorySlots`; `scReset`/`scGlobalReset`/`loadScGlobalSequence` use `zeroMemState` (so
  `resetAllSimState` on every canvas swap zeroes nested memory, law 6); `hasMemory` decides SC
  in `evaluateCircuit`, DataTable, SequentialTimeline, SimulationPanel. Locks untouched: both
  box actions still start with `isCurrentQuestionLocked`, simulation is never locked (law 3).
- **Local I/O step.** Boxed MEMs are state columns (loop-settled below). `localStepSelect`
  sets nested state via `withMemState`; a sequential box's outputs that its memory alone
  decides (`boxMemoryOutputs`) are seeded as sources and their wires are not ordering edges,
  so a loop through the box sorts; wires still unordered (a real combinational loop) are
  annotated anyway; a `comp:<box>` step after the MEM update steps advances the box's memory
  (`stepBoxedMemory`), mirroring what the step does to a canvas MEM. **Fixed in passing
  (pre-existing, same lines):** the OUTPUT step's table upsert keyed the row by the POST-step
  MEM value — `localStepSelect([1],[0])` on a delay filed out 0 under (in 1, m 1). It now
  files under the selected pre-step row (`localStepRow`, read back from
  `localStepSelectedKey`), and `localStepReset` re-runs that row instead of the next state's.
- **UI.** Palette filters boxes through `selectPlaceableBoxKinds` + `kind`; the canvas loop
  warning is `hasCombinationalLoop`; the input-toggle row select sends `memorySlots` bits.
- **Settled by the loop session (open to Gabriel's revision): nested memory IS a state-table
  column.** The SC Local I/O table (and history `memValues`) show each boxed MEM as its own
  column, `Box 1·M1`. The table is keyed by the machine's whole state; hiding a boxed MEM
  would make distinct states share a row and overwrite each other's outputs, breaking "the
  live SC run … agree".
- **Out of scope, for the loop session to file — a box drawn ACROSS wires is dead when
  placed.** Pre-existing, CC too. Repro (sandbox Logic Circuit tab, headless store): add
  INPUT (IN1), NOT, OUTPUT (OUT1); wire IN1→NOT.in, NOT.out→OUT1; draw a box around the NOT
  only; `confirmBox` → accepted, kind CC, `inputPortIds ['<not>:in']`, `outputPortIds
  ['<not>:out']`, internals `[NOT]` (no IN/OUT of its own). Clear the canvas, place the box
  (ports in1/out1), add a fresh INPUT and OUTPUT, wire INPUT→box.in1, box.out1→OUTPUT: with
  the input at 0 the placed copy's OUTPUT reads **0** (should be 1), at 1 it reads **0**
  (correct only by accident). Cause: `evaluateBoxedCircuit` binds ports to internal
  INPUT/OUTPUT components by label, and a box drawn across wires has none — the crossing
  keys in `inputPortIds`/`outputPortIds` are never used, so the box's outputs are 0 (a
  memory-holding box drawn that way reads 0 the same way through the netlist). Needs a
  port-binding design plus a decision for boxes already saved that way. 004 pins boxes that
  enclose their own IN/OUT.
- **Also noticed:** an SC box (or a bare MEM) could be pasted onto a CC question (both are
  canvas kind `circuit`); it grades like a top-level MEM held at 0. The SC box is now refused
  (review fixes below); a bare MEM still pastes (pre-existing, and `pasteCheck` pins
  "MEM into an unrestricted CC question: ok" at the seam). A pasted box
  copy gets fresh ids (`remint`) and its own `internalCircuit`, so its state is its own; it
  carries the copied value, exactly as a pasted canvas MEM does, and any run start zeroes it.
- **Pins.** `boxScopeCheck [sequential boxes]` (placeable kinds; delay 0101 boxed = unboxed —
  the old 0000 pin flipped; toggle through a box; a loop through a CC box still a loop; serial
  adder boxed whole and with only its carry MEM boxed over 64 streams; nested both ways; two
  instances = a 2-step delay with their own slots; a box evaluated as one gate reads its
  memory through a nested loop; `gradingCircuit` zeroes a boxed MEM, with teeth),
  `[sequential boxes: fixture parity]` (all 25 SC / perception / SC-turbot reference
  machines, correct and broken, grade deep-equal boxed whole — builder `boxWhole`),
  `[sequential boxes: store]` (confirm kind SC + zeroed; both MEM directions; CC question
  refuses; placeable per canvas; placement refused on CC; a Q2 question run equal to the
  unboxed delay and to the engine; nested state advances, resets on `scGlobalReset` and on a
  question swap; undo/redo then rerun; close/reopen keeps kind SC and reruns the same; sandbox
  scStep ×4 on 1,0,1,0 → 0101 with the wire leaving the box carrying it; `Box n·M1` column;
  row (1,0) → 0 and (1,1) → 1 under their own keys, and the same key fix on a canvas MEM;
  local step through the toggle annotates every wire; a boxed serial adder's final carry
  drains). `scWindowCheck`: hw3-p7 boxed whole — same window, same `encodeInput` stream,
  the grader's numeral. `pipelineCheck`: the sample SC answer boxed whole grades 8/8 with
  per-case results equal to unboxed.
- **Gates.** app `tsc` 0, `npm run build` 0, `npm run check` 0 (boxScopeCheck 108/0); server
  `typecheck` 0, `check` 0. `CLAUDE.md` edited in place (What's next, Engine row, Tools row,
  build phase 2), 39,960 / 40,000 bytes.
- **Browser (dev server, local mode, sandbox Logic Circuit tab).** Built IN→MEM→OUT, boxed
  it (library "Box 1", kind SC, in the palette's Boxes), cleared, placed it from the palette,
  wired a fresh IN1/OUT1: the canvas held no MEM yet showed the SC panel with a `Box 1·M1`
  column and the timeline. Local rows (1,0) → 0 and (1,1) → 1, each in its own row, box wire
  red when 1. Global IN `0101` → OUT `01010` (t1 rightmost; the fifth step is the boxed MEM's
  drain), timeline matching. A toggle (box out → NOT → box in) showed box 0 / NOT 1 / OUT1 0
  at idle with no loop warning. The sandbox was left empty afterwards. Not eyeballed: the
  palette hiding an SC box on a CC question (pinned at the store selector only).

### 2026-09-23 — review fixes (work loop)
- **Decisions confirmed by the loop session.** Nested memory as a state-table column
  (`Box 1·M1`) stands as recorded above — loop-settled, a correctness matter, open to
  Gabriel's revision. A box drawn across wires (no IN/OUT of its own) is out of scope for
  004; the repro above ("Out of scope, for the loop session to file") is the one to file.
- **Local step: a free end on a sequential box blanked its memory outputs.** The wire
  branch of `localStepOne` counted an unwired box input as ready-but-undefined and then set
  EVERY output of the box undefined, including the memory-decided ones `localStepSelect`
  had seeded — so the table filed 0 where `scStep` and the engine give 1. New store helper
  `boxMemoryPortValues` (the seeded `comp:port` keys) is used by the seed and skipped by the
  re-evaluation: only the outputs the box's inputs decide are blanked or re-evaluated.
- **Paste routed around the placement rule.** `paste` now refuses a clip holding a
  sequential box on a canvas that takes combinational boxes only (`selectPlaceableBoxKinds`
  has CC but not SC), before `pushHistory` ("A box holding memory can't go on this canvas:
  Box 2 …"). Canvases that take no boxes (sandbox FSM/TM tabs, where paste is free) are left
  as they were. Memo updated.
- **Pins given teeth (`boxScopeCheck [sequential boxes: store]`).** The Q2 run's last fed
  bit is the codec's padding 0, so every reset pin passed with the nested MEM already at 0.
  A `dirty()` helper now steps the loaded '101' up to (not into) its padding step, asserts
  the nested MEM holds 1, and only then: `scReset` → 0, `scGlobalReset` → 0, a
  `loadScGlobalSequence` run from dirty memory equals the unboxed delay and the engine run of
  `gradingCircuit`, `switchQuestion` away and back → 0, and a close/reopen saved holding 1 →
  back at rest. Local rows are now selected against the grain (the box holds 0 when row
  (1,1) is selected, 1 when (1,0) is), each asserting the selection itself wrote the
  row's memory into the box. New: the free-in2 box (IN1→MEM→OUT1, IN2→OUT2) files the
  engine's output (1) for row (1,1) with the box's out wire annotated; the SC box pasted onto
  Q1 is refused, naming it, adding nothing and no undo entry.
- **Mutation-tested on a scratch copy of `app/`:** `scReset` / `scGlobalReset` /
  `loadScGlobalSequence` zeroing top-level MEMs only, `localStepSelect` ignoring or
  truncating the boxed memory bits, `localStepOne` blanking the seeded ports, and the paste
  rule removed — each now fails `boxScopeCheck` (1 to 6 failures each); unmutated 123/0.
- **Gates after the fixes.** app `tsc` 0, `npm run build` 0, `npm run check` 0
  (boxScopeCheck 123/0, navResetCheck 361/0); server `typecheck` 0, `check` 0.

### 2026-09-23 — implemented (work loop)
Checkpoint (details in the two entries above).
- **Built.** A student can now box a sub-circuit holding memory on an SC canvas: the box is
  stored `kind: 'SC'`, sits in the palette only where SC boxes place (SC questions, the
  sandbox Logic Circuit tab), and runs tick for tick like the unboxed circuit — grading,
  Run/Step, the timeline, the local I/O table, undo/redo, save/load and every reset agree.
  Mechanism: `engine/netlist.ts` inlines memory-holding boxes into the netlist; nested state
  lives on the nested MEM's `storedValue`; `CircuitData` unchanged.
- **Pins.** `boxScopeCheck` `[sequential boxes]` / `[: fixture parity]` (25 reference
  machines, correct + broken, boxed whole grade deep-equal) / `[: store]` — the old 0000
  refusal pin is now the 0101 equivalence pin (123/0); `scWindowCheck` hw3-p7 boxed;
  `pipelineCheck` `[boxed SC answer]` 8/8 = unboxed.
- **Review.** Fixed 4 (reset pins given teeth via `dirty()`; local rows selected against
  the box's memory; `localStepOne` free-end blanking of memory-decided outputs
  (`boxMemoryPortValues`); paste of an SC box onto a CC-box-only canvas refused). Skipped 0.
  Nit left: `boxScopeCheck.ts:518` "naming it" checks `includes('M')`, always true.
- **Loop-settled (open to Gabriel):** nested MEM = its own state column (`Box 1·M1`). **Out
  of scope, to file:** a box drawn across wires (no IN/OUT of its own) reads 0 when placed —
  repro in the first entry.
- **Gates (exit codes).** app tsc 0, build 0, check 0; server typecheck 0, check 0.
  Re-confirmed at checkpoint: app tsc 0, boxScopeCheck 123/0, scWindowCheck OK, pipelineCheck
  OK. `CLAUDE.md` 39,960 B.
- **Owed (browser, local mode, port 5173):** SC question IN→MEM→OUT boxed, placed, `1010`
  Run → delayed timeline, wire colours, Reset, no loop warning; the SC box absent from a CC
  question's palette and present on another SC question; toggle through the box (no loop
  warning, Step alternates, local row select animates); sandbox Logic Circuit tab with only
  the box (SC panel + `Box n·M1` column); turbot SC-brain question boxed → same trajectory;
  undo/redo + page reload → still 0101. Optional: remote-mode submit of a boxed SC answer.
- **NEXT STEP:** loop session: visual check (owed above), file the drawn-across-wires task
  from the repro, then land per PROFILE §5.

### 2026-09-23 — loop browser check and land
- **Browser, local mode (dev server restarted on the branch), John's sandbox Logic Circuit
  tab.** Built IN → MEM → OUT and confirmed a box around all three: the library holds "Box 1"
  with `kind: 'SC'`, and the palette lists it under BOXES. The originals were cleared, then the
  box was placed with a fresh IN and OUT. The SC controls appeared with no top-level MEM
  ("Reset to t=1", timeline Run/Step/Reset). Global input 1010 ran to output **10100**, the
  one-step delay, with the history's boxed memory at 0, 0, 1, 0, 1 and no "Loop detected"
  warning. The Local Input / Output table's columns read **IN1 · Box 1·M1 · OUT1**, with rows
  (0,0)→0, (0,1)→1, (1,0)→0. After a page reload the box was still placed and still ran 10100.
- **Fixed here:** the review nit at `boxScopeCheck.ts:518`. The pin now checks that the
  refusal names `M1` ("…inside a box here: M1"). boxScopeCheck: 123 passed.
- **Still owed:** the turbot SC-brain and toggle-through-a-box eyeballs (pinned headless in
  `boxScopeCheck [sequential boxes]`), and a CC question's palette hiding an SC box (pinned).
- **For Gabriel to confirm:** the "Box 1·M1" state column (loop-settled).
- **Filed:** the box-drawn-across-wires bug as its own task (see `tasks/log.md` / incoming).
- Landed via a merge into `main`.

### 2026-09-24 — Gabriel confirmed
The loop-settled nested-memory column ("Box 1·M1" in the state table and history) stands, confirmed by Gabriel.
