---
id: 2026-09-21-011
type: feature
title: Reset or flag a live run when the machine is edited mid-run (turbot and TM)
priority: normal
size: unknown
requires:
area: app
source: claude-md
created: 2026-09-21T15:30:00-07:00
status: in-progress
after:
branch: task/011-invalidate-run-on-edit
merged_into:
---

## Description
Editing the brain/table while an arena run or TM run is in progress leaves stale sim state
on screen; the student must Reset manually. Same gap in both modes (and possibly SC/FSM).

## Done when
One policy, applied in every mode: a structural edit during a run either resets the run to
t=1 or visibly marks it stale, and the harness pins it.

## Design
- **deepFix (recommended):** the mutating store actions already funnel through
  `isCurrentQuestionLocked`; add a sibling hook there — "an edit invalidates the live run" —
  that calls the existing `resetAllSimState()` (or a per-mode reset), so no component decides.
- **surgicalFix:** per-mode checks in the turbot and TM panels.
- Members: turbot arena stepping; TM tape run; check whether SC/FSM Run has the same leak.

## Verify
`navResetCheck` gets an `[edit during run]` section (SC/FSM/TM/turbot CC + TM brains, the
sandbox, undo at rest and mid-run, a raw setState, a locked canvas, moves/rotation restart
nothing, CC toggles survive, a toggle-fed SC run keeps its toggles, an INPUT added/removed
re-splits the typed row, undo keeps live values — MEM override, local-step row, a run's
memory); `caseRunCheck [same question]` pins an edit after "Run this
input" (restarts on the case's tape / arena, case kept, banner reads "changed").

Browser-checked 2026-09-24 (dev server, local mode, a sandbox SC tab, delay circuit, typed
01101): the I/O panel's Run is now the store's `scRun` (button disabled while it runs); a wire
deleted mid-Run stopped it at t=1 with the row's input kept and its output blank, no step
followed in the next 2.5 s, and Run again ran the edited machine to the end (6 steps).

Owed (browser, PROFILE §7 — the harness proves the store, not the other panels): in a question
per mode (the sample assignment's Q3 FSM, Q4 TM, Q5 turbot, or any HW), mid-run, (a) drag a
component — the run carries on; (b) delete a wire or relabel a transition — Run stops, the FSM
table and TM history empty to t=1, the TM strip shows the initial tape again, the turbot sits
back on the arena's start; press Run — it runs the edited machine. Also: a halted TM/FSM,
fixed by adding the missing transition, steps again without pressing Reset.

## Progress log

### 2026-09-24 — policy settled (work loop)
**Loop-settled, from the Design's recommended deepFix: RESET, not "mark stale".** A machine
edit — `gradedMachineKey` changes (components, wires, labels, ports, MEM direction, state
kind, box internals; never a move, rotation, wire geometry or a live value) — during or after
a run restarts every live run (SC, FSM, TM, turbot) at t=1, keeping its input (typed
sequence / global row, initial tape, arena, loaded graded case) and the undo history, so the
student presses Run again. CC has no run beyond instant evaluation (its I/O table and local
step were already cleared on a structural edit). Simulation actions (Run/Step, INPUT toggles,
MEM overrides, tape edits) are not edits. One mechanism, no component decides: the store's
end-of-file machine-key subscriber (it replaced `connectivitySignature`), not a hook beside
`isCurrentQuestionLocked` — layout actions read that lock and the canvas calls `pushHistory`
on every click, so either would restart runs on a drag. Recorded in CLAUDE.md Critical design
rules and PROFILE §8 law 6.

### 2026-09-24 — review fixes
The SC restart keeps ITS input: a typed row is re-loaded split for the INPUTs now on the
canvas (an added/removed INPUT re-splits it at rest too), timeline bits via `scReset`, and a
toggle-fed run keeps its toggles. Undo/redo restore structure with today's live values
(`withLiveValues`: toggles, MEM contents, displayed values; restored MEMs hold 0) and
re-evaluate only when the machine changed — a move undone mid-run no longer rewinds its
memory, and at rest a MEM override or local-step row survives. Pinned in `[edit during run]`.

### 2026-09-24 — implemented (work loop)
**Built:** editing the machine (not moving it) mid-run or after a run now restarts that run at
t=1 in SC, FSM, TM and turbot (CC has no run), with the student's input kept so Run works
again. One store subscriber on `gradedMachineKey` (`store.ts restartLiveRuns` /
`restartScRun`), replacing `connectivitySignature`; undo/redo keep live values
(`withLiveValues`); the I/O panel's Run is the store's `scRun` (`DataTable.tsx`); a loaded
graded case restarts on its own tape/arena and its banner reads "changed" (`caseRun.ts`).
**Pins:** `navResetCheck [edit during run]` (45 checks: every mode, the sandbox, raw setState,
locked canvas, moves restart nothing, toggles, INPUT re-split, undo at rest/mid-run);
`caseRunCheck [same question]` (TM + turbot edit after "Run this input"); `scWindowCheck`
adjusted. **Gates:** app-tsc=0 app-build=0 app-check=0 server-tsc=0 server-check=0.
**Review:** 5 findings fixed (SC restart input, undo live values ×3, INPUT-count re-split),
none skipped. **Owed (browser, loop session):** the sandbox FSM / TM / turbot (CC and TM
brains) edit-mid-run recipes, a question's SC run, and Grades → "Run this input" then edit
(recipe in `## Verify`; the banner stays and "Run again" works).
**Next step:** loop session: visual check if owed, then land per PROFILE §5.

### 2026-09-24 — loop browser check and land
- **Browser, local mode (dev server restarted on the branch), Ada's sandbox Logic Circuit
  tab.** Built IN → MEM → OUT and typed 1011001 into the Global I/O row.
  - The panel's **Run** (now the store's `scRun`) ran 8 steps to output **10110010** (the
    delay) and stopped.
  - Reset, then Run. Mid-run (t=3, running), adding a NOT stopped the run and reset it to
    **t=1**: history empty, the global output blank, the typed input kept
    (`[[1,0,0,1,1,0,1]]`). It stayed stopped 1.5 s later, with no leftover interval.
  - Run again, then moving the MEM mid-run changed nothing: still running at t=3, and it
    finished at t=9 with 10110010.
- **Still owed:** TM, FSM and turbot eyeballs of the same reset (pinned headless in
  `navResetCheck [edit during run]`, 45 checks, and `caseRunCheck [same question]`).
- Landed via a merge into `main`.
