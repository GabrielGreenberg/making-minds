---
id: 2026-09-21-012
type: feature
title: Give students a frame player for SC perception questions
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
For SC perception questions students hand-enter per-wire input sequences in the normal SC
timeline to test their circuit. A retina "frame player" (draw/pick frames, step them through
as clock ticks, show the output bit per step) would match how the question is graded
(`engine/perception.ts runPerceptionCase`).

## Done when
A perception SC question shows a frame editor + player feeding the SAME clocked run the
grader uses; the timeline still shows raw bits; verified in the browser.

## Design
Reuse the SC run window/stream plumbing (`selectCodecLayout` is value-based; perception is
bit-level, so this is a parallel "frame stream" input path into `scStep`). Undiagnosed
beyond that.

## Verify
`perceptionCheck` store-run ≡ grader pin; browser eyeball owed.

## Progress log
