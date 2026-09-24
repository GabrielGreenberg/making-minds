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
status: in-progress
after:
branch: task/012-sc-perception-frame-player
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
`perceptionCheck` pins `[frames ↔ lanes]` (the film's lane layout, the player's shift = the
motion rule's "up") and `[store: SC perception frame run ≡ grader]` (hw3 #11 change / #12
motion, correct / incorrect / boxed-whole / dirty-MEM machines: every case runs exactly its
frames, the fed bits ARE the frames, the output per step ≡ the grader's `got`, no step past
the film).

Browser-checked 2026-09-24 (dev server, local mode, instructor Ada; recipe below). The loop
session's fuller pass is still owed (see the progress log's "implemented" entry).
- **hw3 #11 (change)**, `perceptionChangeCorrect` on the canvas: "Retina frames" replaces
  Global I/O. `+` three times gives t3 t2 t1; toggling IN3 at t2 then Run gives OUT1 = 0,1,1
  and stops at t=4. The Sequential Timeline shows the same raw bits (IN3 t2 = 1).
- **hw3 #12 (motion)**, `perceptionMotionCorrect`: IN4–IN6 set at t1, `+` (a copy), t2
  shifted up; Run feeds 00011100 then 00111000 and gives OUT1 0 then 1 (upward motion). The
  timeline rows match the player rows exactly.
- **Run speed in the player** (#11, frames blank / IN3 / IN3): the player's own "Nx" chip
  opens the slider; a 3-frame Run takes 471 ms at 8x and 2420 ms at 0.5x, OUT1 0,1,0 both.
Both workbooks and the UI prefs were restored to their pre-check state afterwards.

## Progress log

### 2026-09-24 — review fixes
The frame player replaces the Global I/O block, which held the SC panel's only run-speed
control, so a perception question had no reachable speed setting. The control is now one
component (`components/RunSpeedControl.tsx`: the "Nx" chip + log-scale slider, saving the
`runSpeed` pref) used by both: DataTable owns the speed state and hands it to the player,
whose Run uses it and shows the chip beside the frame count. The browser check (above) is
recorded; the eyeball is no longer owed.

### 2026-09-24 — implemented (work loop)
**Built.** On an SC perception question (hw3 #11 change, #12 motion) the right panel's
Global I/O block gives way to a **retina frame player** (`components/PerceptionFramePlayer.tsx`):
one row per retina wire (IN1 on top), one column per frame (t1 rightmost), click to toggle,
`+` adds a copy of the newest frame, a selected frame shifts up/down, duplicates or deletes,
Clear, Run / Step / Reset, and the run-speed chip.
The film is not a new slice: `setScFrames` (store.ts) writes it as the SC lanes
(`perception.ts framesToLanes`, the inverse `lanesToFrames`, `shiftFrame`), so the Sequential
Timeline shows the same raw bits and both reset laws + the edit-restart law cover it.
`selectScRunWindow` stops the run at exactly the frame count, with no MEM drain step, the
way `runPerceptionCase` clocks a case. `caseRun.questionLayout` returns null for a perception
question, so a stray `cc_spec` can never route frames through the value codec. The speed
chip + slider became one shared `components/RunSpeedControl.tsx` (review fix).
**Pins.** `perceptionCheck` `[frames ↔ lanes]` and `[store: SC perception frame run ≡ grader]`
(24 new checks: hw3 #11/#12, correct / incorrect / boxed-whole / dirty-MEM; fed bits = the
frames, output per step ≡ grader `got`, no step past the film); `scWindowCheck` pins
`selectScRunWindow` = the codec window on a value question.
**Gates.** app-tsc 0, app-build 0, app-check 0, server-tsc 0, server-check 0.
**Review.** Fixed 2 (no reachable run-speed control on perception questions →
`RunSpeedControl`; browser check unrecorded → recorded in Verify). Skipped none. Nit left
alone: with no INPUT on the canvas, DataTable's empty-canvas early return hides the player
too, although the player needs only the retina width.
**Owed.** Loop-session browser pass for what the 2026-09-24 check did not cover: the 4-frame
change film (OUT t1..t4 = 0,1,0,1, stop at t4, no drain column); Step/Reset (Reset keeps the
frames); a mid-run cell edit restarts at t=1; deleting an INPUT shows the retina warning and
the player keeps working; a ≤ 0.6-scale width screenshot at the 260px panel for this log.
Nothing is owed to Gabriel (no ssh or real data; remote mode reads only the sanitized
`q.perception`).
**Next step.** Loop session: the visual check above, then land per PROFILE §5.

### 2026-09-24 — loop browser check and land
- **Fixed here: the review's leftover nit.** The frame player didn't render until the canvas
  had an INPUT, because DataTable's empty-canvas early return came first. A student opening a
  perception question saw no player. The empty-canvas branch now mounts
  `PerceptionFramePlayer` too (it depends only on the retina). Checked with app tsc, build,
  perceptionCheck and themeCheck, all exit 0.
- **Browser, local mode (dev server restarted on the branch), Ada, HW3 P11 "Change
  detector".**
  - On an empty canvas, "RETINA FRAMES" shows IN1–IN8 and OUT1, a "+" to add frames,
    Run/Step/Reset, "0 / 24 frames", the 1x chip, and the Stage-1 warning "expected 8 input
    wires, found 0 — the grader rejects this machine; the run still plays". Frames step there
    with no errors.
  - With `perceptionChangeCorrect` loaded and frames blank, 10100000, 10100000, 10100001,
    Step×4 gives OUT **0,1,0,1**. A 5th Step does nothing (no drain column). Reset → t=1 with
    the 4 frames kept. Adding a NOT mid-run → t=1 with the frames kept (task 011's law).
- **Still owed:** a width screenshot at the default 260 px panel (the pane was hidden), and the
  motion question's "shift up" tools by eye (pinned in perceptionCheck).
- Landed via a merge into `main`.
