---
id: 2026-09-23-038
type: bug
title: A box drawn across wires (no IN/OUT of its own) confirms but its placed copy outputs 0 — bind box ports to the wires the box cuts
priority: normal
size: large
requires:
area: app
source: chat
created: 2026-09-23T22:45:00-07:00
status: done
after:
branch:
merged_into:
---

## Description
Found by task 004's workflow (work loop, 2026-09-23); filed by the loop session. It predates
004 and affects CC boxes too.

Repro (sandbox Logic Circuit tab):
1. Add INPUT (IN1), NOT and OUTPUT (OUT1). Wire IN1 → NOT.in and NOT.out → OUT1.
2. Draw a box around the NOT only and confirm it. It is accepted as kind CC, with
   `inputPortIds ['<not>:in']`, `outputPortIds ['<not>:out']` and internals `[NOT]`, so the
   box has no IN/OUT of its own.
3. Clear the canvas and place the box (ports `in1`/`out1`). Add a fresh INPUT and OUTPUT and
   wire INPUT → box.in1 and box.out1 → OUTPUT.
4. With the input at 0, the OUTPUT reads **0** (should be 1). At 1 it reads 0, which is right
   only by accident.

Cause: `evaluateBoxedCircuit` binds a placed box's ports to internal INPUT/OUTPUT components
by label, and a box drawn across wires has none. The crossing keys recorded in
`inputPortIds`/`outputPortIds` are never used, so every output is 0. A memory-holding box
drawn this way reads 0 the same way through 004's netlist inlining (`engine/netlist.ts`).

## Done when
- A box drawn across wires, with no IN/OUT inside, behaves when placed exactly as the
  circuit it enclosed: CC, and SC with memory (boxed ≡ unboxed, pinned in `boxScopeCheck`
  like 004's delay).
- Boxes that enclose their own IN/OUT keep working byte-identically (004's pins stay green).
- Boxes already saved the drawn-across way are handled by a stated rule: re-bound on load,
  or flagged. Grading agrees with the live run for them (server ≡ engine parity).

## Design
- **deepFix (recommended):** one port-binding model. A confirmed box records, for each port,
  the internal endpoint it stands for: an internal INPUT/OUTPUT, or a cut wire's inner
  endpoint (`<comp>:<port>`, which confirmBox already records). `evaluateBoxedCircuit`
  and `inlineSequentialBoxes` both resolve ports through that one map. The resolver in
  `engine/netlist.ts` (box out-port → internal OUT's feeding wire) is the natural place to
  extend.
- **surgicalFix:** refuse to confirm a box with no IN/OUT inside. It stops new dead boxes,
  but leaves saved ones dead and removes a natural gesture (boxing a gate in place).
- Needs a decision (catch or `/work`): what happens to boxes students have already saved this
  way. Re-binding is likely safe, since they currently compute 0.
- Pointers: `app/src/engine/cc.ts evaluateBoxedCircuit`, `app/src/engine/netlist.ts`,
  `app/src/store.ts confirmBox` / `placeBoxInstance`, `app/tools/boxScopeCheck.ts`,
  `docs/buildout/designs/sequential-boxes.md`.

## Verify
Both `tsc`s, build, `npm run check` (`boxScopeCheck` with the drawn-across pins,
`pipelineCheck`), server `npm run check` (parity). Browser: the repro above now reads 1 at
input 0.

## Progress log
- 2026-09-24 — Implement (uncommitted). **Loop-settled decision, open to Gabriel's revision:
  boxes already saved the drawn-across way are RE-BOUND on load, not flagged** (the task's own
  lean: they computed 0; the term starts 2026-09-24 and HW1 is due 2026-10-04, so no graded
  work depends on the old behaviour). A submitted snapshot is never re-bound and a stored
  result is never regraded. Built the deep fix: `Port.bind` + `engine/netlist.ts boxInterior`
  (the one port-binding model, read by `evaluateBoxedCircuit`, the inlining,
  `boxMemoryOutputs`, `stepBoxedMemory`); new `app/src/boxPorts.ts` (THE port order,
  `rebindLegacyBoxes`, `unboundBoxes` → a canvas warning); confirm/place/paste/load paths in
  `store.ts` and `restoreQuestionCircuits`. Re-bind rule as built: an unbound box is re-bound
  when its confirmed map (library keys, else its internals' free ends) fits its ports and
  differs from what the label rule binds — slightly wider than "the label rule can't bind
  every port", so an own-IN-that-fed-outside box with a cut wire is caught too; own-IN boxes
  stay untouched. Memo `docs/buildout/designs/box-port-binding.md`. Pins: `boxScopeCheck
  [drawn-across boxes: engine | fixture parity | store | legacy]`, `pipelineCheck
  [boxed-across answers]`, server `parityCheck` §8. Browser repro owed (Verify).
- 2026-09-24 — Fix (uncommitted), after review. **Re-bind rule narrowed** (still loop-settled:
  re-bound, not flagged; open to Gabriel's revision): a pre-038 box is re-bound only when the
  label rule leaves a port dead, and every port the label rule reaches KEEPS its own IN/OUT;
  only the dead ports take the confirmed map's remaining keys (`boxPorts.ts legacyBindings`).
  The earlier rule re-bound the whole recorded order, which moved a live port when pre-038
  `confirmBox` had dropped an own IN that also fed outside (or an own OUT fed from outside).
  Sandbox loads now re-bind the library too (`rebindLegacyLibrary` in `storedTabCircuit` and
  `importWorkbook`, as `restoreQuestionCircuits` does), and the pre-formatVersion-2 autosave
  re-binds its canvas. Pins: `boxScopeCheck [drawn-across boxes: legacy]` (library entry
  holding a pre-038 box, autosave + workbook file; the v1 autosave) and `[drawn-across boxes:
  legacy own IN/OUT]` (the review's own-IN repro, the own-OUT analogue, a fully label-bound box
  untouched) — each checked to fail with its fix removed. Memo updated in place.

### 2026-09-24 — implemented (work loop)
- **Built.** A box drawn across wires now computes what it enclosed. Each placed port records
  the internal endpoint it stands for (`Port.bind`), and `engine/netlist.ts boxInterior` is
  the one port-binding model, read by `evaluateBoxedCircuit`, the sequential inlining,
  `boxMemoryOutputs` and `stepBoxedMemory`. `app/src/boxPorts.ts` holds THE port order
  (`orderBoxPorts`), the legacy re-bind (`rebindLegacyBoxes`/`rebindLegacyLibrary`) and
  `unboundBoxes` (a canvas warning). A box with no port bound keeps the label rule exactly,
  and `gradedMachineKey` adds a binding only when one exists, so own-IN/OUT boxes and 004's
  behaviour are unchanged. Memo: `docs/buildout/designs/box-port-binding.md`.
- **Legacy rule (loop-settled, open to Gabriel's revision): re-bound, not flagged.** On load
  (an assignment, the sandbox autosave incl. v1, an opened workbook file), a pre-038 box is
  re-bound only when the label rule leaves a port dead. Every live port keeps its own IN/OUT,
  and only the dead ports take the confirmed map's remaining keys. A submitted snapshot is
  never re-bound, and a stored result is never regraded.
- **Pins.** `boxScopeCheck [drawn-across boxes: engine | fixture parity (62 HW1–HW3
  machines) | store | legacy | legacy own IN/OUT]` (194 pass). `pipelineCheck [boxed-across
  answers]`. Server `parityCheck` §8 (boxed-across answers plus a pre-038 re-bound save, both
  ≡ unboxed).
- **Gates.** app tsc 0, build 0, `npm run check` 0; server typecheck 0, `npm run check` 0.
- **Review.** 1 major and 1 minor finding fixed (the narrowed re-bind rule; sandbox and
  workbook-file loads re-bind the library). None skipped. One nit left alone: the
  `unboundBoxes` warning also shows on a frozen question or a viewed submission, where it
  cannot be cleared.
- **Owed (browser, loop session).** (1) The sandbox CC repro: the OUTPUT reads 1 at 0 and 0
  at 1; screenshot the port markers and the placed box. (2) An SC MEM-only box: Run 1010
  gives 0101 and shows the `Box 1·M1` column; also a mixed box. (3) A legacy re-bind via
  a stripped `bind` in the `making-minds-autosave:*` save, plus the fan-out warning. (4) Local
  HW SC question: place, reopen, Run, submit, and the gradebook shows the pass. Optional for
  Gabriel (ssh, read-only): count the pilot workbooks that hold legacy drawn-across boxes,
  counts only.
- **Next step:** loop session: visual check if owed, then land per PROFILE §5.

### 2026-09-24 — loop browser check and land
- **Fixed here: the review nit.** The canvas's "has ports not connected to anything inside —
  draw and place it again" warning showed on a locked canvas (marked done, frozen, a viewed
  submission), where the re-place it asks for is refused and a submitted snapshot is never
  re-bound. `CircuitCanvas` now reads `selectQuestionLocked` and skips that warning when
  locked. app tsc and build exit 0; boxScopeCheck 194 passed.
- **Browser, local mode (dev server restarted on the branch), sandbox Logic Circuit tab: the
  task's repro.** IN1 → NOT → OUT1, with a box drawn around the NOT only. confirmBox accepted
  it as "Box 1", kind CC, with `in ['<not>:in']` and `out ['<not>:out']`. After clearing the
  canvas, placing the box and wiring a fresh INPUT → in1 and out1 → OUTPUT, OUTPUT reads **1
  at input 0 and 0 at input 1**; before 038 it read 0 at both. No unbound-box warning.
- **Still owed:** the SC drawn-across delay and the legacy re-bind by eye (pinned headless:
  boxScopeCheck `[drawn-across boxes: engine / store / legacy / legacy own IN/OUT]`, parityCheck
  §8). Also Gabriel's optional read-only count of legacy drawn-across boxes in the pilot DB
  (ssh; recipe above).
- **For Gabriel to confirm:** already-saved drawn-across boxes are re-bound on load, not
  flagged, and only ports the old rule left dead take the recorded crossing (loop-settled).
- Landed via a merge into `main`.
