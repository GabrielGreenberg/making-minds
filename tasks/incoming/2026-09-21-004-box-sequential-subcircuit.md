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
status: ready
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
