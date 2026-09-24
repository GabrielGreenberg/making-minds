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
status: in-progress
after:
branch: task/038-box-across-wires-port-binding
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
