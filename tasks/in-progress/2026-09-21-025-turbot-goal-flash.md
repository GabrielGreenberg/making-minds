---
id: 2026-09-21-025
type: feature
title: Flash and briefly hold when the turbot reaches the goal, then continue the run
priority: normal
size: large
requires: browser
area: app
source: chat
created: 2026-09-21T17:40:00-07:00
status: in-progress
after:
branch: task/025-turbot-goal-flash
merged_into:
---

## Description
Gabriel: "when the turbot rolls over the goal, put a little pause/flash (minimal animation) to
have the satisfaction of it reaching its goal, then continue the run". Provenance: chat, catch
session 2026-09-21. Effort is small; sized `large` only because an animation can be proven
only in a browser.

Today the arena has no event feedback at all. `turbotRun` (`store.ts:3671–3685`) is a 300 ms
`setInterval` calling `turbotStep` (`:3627–3669`), which computes the next pose and halts only
on motor stop / no transition; nothing notices the moment the pose lands on a goal cell.
`ArenaCanvas.tsx:22–58` draws the goal as a static green circle (`.arena-goal`,
`index.css:1353`) and the turbot as a red triangle (`.arena-turbot`, `:1360`). The engine's
`cellAt` / `isGoal` (`engine/turbot.ts:55`, `:512`) are module-private. The one animation
precedent in the app is the table `row-flash-anim` keyframe (`index.css:866–872`).

## Done when
- When a step moves the turbot onto a goal cell from a non-goal cell (Run or Step), the goal
  cell plays one short, minimal animation (a pulse/glow of the green circle, ≤ 600 ms), and a
  running run **holds ~600 ms (two ticks)** before the next step; Step mode flashes without a
  hold.
- A `reach-and-stop` run that halts on the goal still flashes; `pass-through` and
  `return-to-start` runs continue after the hold. Pause during the hold, then Run, resumes
  cleanly; Reset (and every canvas swap via `resetAllSimState`) clears it — no stray timers.
- `prefers-reduced-motion` disables the motion (the hold may stay).
- The instructor's arena editor and the sandbox's "Edit map" mode never animate.
- A headless pin in `navResetCheck` (the one harness tool that already drives `turbotStep`):
  stepping a forward-driving brain onto a goal sets the goal-reached event for that step, and
  the run loop skips the hold ticks; Reset clears the event.

## Design
- **deepFix (recommended, and no bigger than the surgical one):** the store owns the moment.
  `turbotStep` sets `turbotLastEvent: { kind: 'goal-reached', t } | null` (t = the new
  history length) using a pure `isGoalCell(arena, x, y)` exported from `engine/turbot.ts`
  (wrap the private `isGoal`); it also sets `turbotHoldTicks = 2`. The `turbotRun` interval
  callback decrements `turbotHoldTicks` and returns while it is > 0, so Pause/Run/Reset need
  no new timers. Both fields join the slice's reset list (`store.ts:3715–3722`).
  `ArenaCanvas` gains an optional `highlightGoal?: boolean` prop and adds
  `.arena-goal--hit` (keyframe: scale 1 → 1.35 → 1 with a soft box-shadow) to the goal cell;
  `TurbotArenaPanel` passes `turbotLastEvent?.kind === 'goal-reached' &&
  turbotLastEvent.t === turbotHistory.length`. The event shape leaves room for a later
  'halted' or 'blocked' cue without touching the loop again.
- **surgicalFix (rejected):** a `useEffect` in `TurbotArenaPanel` watching `turbotState`,
  toggling a class and doing `turbotPause(); setTimeout(turbotRun, 600)`. A timer outside the
  store races Pause, Reset and `resetAllSimState` (law 6).
- **Assumptions recorded at intake (Gabriel to confirm; none blocks starting):**
  (a) hold = 600 ms, i.e. two ticks at the 300 ms cadence; (b) the animation is the goal
  circle pulsing once, nothing on the turbot itself; (c) same behaviour in the sandbox and
  in assignment questions.
- Pointers: `store.ts:693–703` (slice fields), `:3627–3669`, `:3671–3685`, `:3687–3693`,
  `:3695–3710`, `:3715–3722` · `engine/turbot.ts:55, 512` (export `isGoalCell`; keep the
  engine pure) · `components/ArenaCanvas.tsx:22–58` · `components/TurbotArenaPanel.tsx:
  285–300` (where `ArenaCanvas` is rendered), `:338–350` (Step/Run/Pause/Reset) ·
  `index.css:866–872` (flash precedent), `:1353–1363` (`.arena-goal`, `.arena-turbot`).

## Verify
- Gates: both `tsc`s, `npm run build`, `npx tsx tools/navResetCheck.ts` (with the new pin),
  `npm run check`; `turbotCheck` stays green (engine grading untouched — the exported helper
  is a wrapper).
- Browser (local mode): Sandbox → Turbot tab (CC brain: wire the sensor so motor = 11
  forward), "Edit map" → place the goal three cells ahead → Done → Run: the circle pulses as
  the turbot crosses it and the turbot pauses ~0.6 s, then keeps going; Reset → Step ×3: pulse,
  no hold. HW6 P2 (after Load HW1–HW7): same with a TM brain. Owed: `prefers-reduced-motion`
  cannot be emulated by the browser tools — check once in a real browser with the OS setting.
- Screenshot mid-pulse: `tasks/attachments/2026-09-21-025-goal.png`.

## Progress log

### 2026-09-24 — implemented and browser-verified (work loop, Implement stage)
**What a student sees now.** When a step moves the turbot onto a goal from a cell that is not
one, the Map's green goal circle pulses once: it swells to 1.35× and back with a soft green
glow that reaches past the turbot drawn over it, in 500 ms. A Run then waits two ticks (600 ms)
before its next step; Step pulses the same way but never waits. A turn, a stop or a turbot-TM
tape op on the goal, or a move from one goal cell onto the next, is not an arrival. Sandbox
and assignment questions behave the same. With `prefers-reduced-motion` the circle does not
move, and a Run still holds. "Edit map" and the instructor's arena editor never animate, and
leaving "Edit map" (Done) does not replay a pulse the run already showed.

**Assumptions applied (the intake's (a)–(c)), Gabriel to confirm:** (a) hold = two ticks of
the existing 300 ms Run interval (there is no speed control, so two ticks IS 600 ms); (b) only
the goal circle animates, nothing on the turbot; (c) sandbox and questions alike.

**How.** The store owns the moment. `engine/turbot.ts` exports the pure `isGoalCell` (the
private `isGoal` renamed; the criteria call it unchanged, and it is also in the barrel).
`turbotStep`'s recorded step writes `turbotLastEvent: { kind: 'goal-reached', t } | null`
(null for an eventless step); the limit and brain-halt branches record no entry and leave it
alone, so the cue neither restarts nor gets cut by a halt. `selectTurbotGoalHit` = the event
names the newest history entry. **Departure from the Design:** the `turbotRun` interval, not
`turbotStep`, arms `turbotHoldTicks = TURBOT_GOAL_HOLD_TICKS` (2), and only when the tick's
step recorded an entry. That way Step never leaves a stale hold that would delay a later Run,
and a halting tick (same `t`) cannot re-arm it. The callback's first line skips a tick while
the hold is > 0: no timer of its own. `turbotPause` zeroes the hold (a Run after a mid-hold
Pause steps at once); `turbotReset` clears both, and it is the one list that
`resetAllSimState`, the edit law's `restartLiveRuns`, `setTabArena`, `loadCaseInput` and
`resetForPrincipal` all reach (law 6). `ArenaCanvas` gains `highlightGoal` and adds
`.arena-goal--hit` only on the goal under the turbot and never with `onCellClick`.
`TurbotArenaPanel` passes it gated on `!editingMap`, and remembers (by object identity) the
event live when "Edit map" opened so Done does not replay it. CSS literals only (themeCheck),
plus the app's first `prefers-reduced-motion` rule.

- **Pins:** `navResetCheck` gets a new `[turbot goal flash]` block, and the fresh/junk helpers
  now cover `turbotLastEvent`/`turbotHoldTicks`, so every navigation and principal-change
  sweep proves that `resetAllSimState` clears both. Q5's corridor with Step covers: no event
  on steps 1–3; the event at t=4 with hold 0; step 5 (motor 00 on the goal) clears it; Reset
  clears it. Run is driven by a captured interval callback: ticks 1–4 reach the goal with
  hold 2, ticks 5–6 only hold, tick 7 stops on the goal, tick 8 ends the loop. It also
  covers a mid-hold Pause and then Run stepping at once, and an edit mid-hold clearing both.
  In the sandbox, goal→goal is no arrival. An FSM brain halting right after it arrives keeps
  the event and arms no second hold; mutation-tested: dropping the loop's length guard fails
  it. Source pins: the pulse is ≤ 600 ms; reduced-motion sets `animation: none`;
  `ArenaCanvas` gates the class; the panel is gated on `!editingMap` and uses no timer; the
  editor and document never pass `highlightGoal`; the turbot slice has one
  `window.setInterval` and no `setTimeout`. `turbotCheck` is green and unchanged.

**Browser.**
- Pane (local mode, John Doe's sandbox, in a fresh "Goal check" tab I removed afterwards,
  arena zoom restored). I placed the goal three cells ahead with Edit map → Goal, then Done →
  Run. The class went on at the arrival (911 ms, `arena-goal-hit 0.5s`). The hold ticks came
  at 1211 and 1511, and the next step at 1811: a 900 ms gap against the normal 300. The class
  came off when the turbot left, and the run went on to the wall. Reset → Step ×3: the pulse
  played with hold 0. The mid-pulse frame showed the glow ring around the triangle. ✓
- The pane was hidden, so its screenshots lagged; the proof screenshots are from headless
  Chrome over CDP on the dev server (a scratch script in the style of
  `tools/shootProblemSets.mjs`). Visitor sandbox, the same setup:
  - Step ×3 gave the class, `arena-goal-hit`, hold 0. ✓
  - Edit map with the event live: no class. Done: no replay. A fresh hit after Reset pulsed
    again. ✓
  - Run: arrival at 904 ms; hold ticks at 1204 and 1505; next step at 1804. ✓
  - **`prefers-reduced-motion: reduce` emulated** (`Emulation.setEmulatedMedia`): the class
    is set, the computed `animation-name` is `none`, and the hold is unchanged (the same
    904/1204/1505/1804 timeline). So that owed check is now covered headlessly; one look in
    a real browser with the OS setting is still worth doing. ✓
  - Smallest map zoom (8 px cells): the glow still shows past the tiny turbot. ✓
- **HW6 P2 (TM brain; after Load HW1–HW7 as the instructor, opened as John):** a 14-state
  external-only TM (6 × `E/F:↑`, `↰`, 6 × `E/F:↑`) on the 30×30 arena arrives at the goal
  (14,9) on step 13. Event t=13, then hold 2 → 1 → 0 at 300 ms apart. At the next tick the
  brain halts (no transition), which records no entry and arms no new hold; the loop stops
  one tick later. ✓
- Mid-pulse screenshot (the animation paused at 250 ms, its peak):
  `tasks/attachments/2026-09-21-025-goal.png`.

**Gates:** app `tsc` 0 · `navResetCheck` 0 (449 passed) · `turbotCheck` 0 · `themeCheck` 0 ·
`npm run build` 0 · app `npm run check` 0 · server `typecheck` 0 · server `npm run check` 0 ·
`check-budgets` 0 (CLAUDE.md 39,996 B: the Engine turbot.ts row names `isGoalCell`, and the
Store row names `selectTurbotGoalHit`/`turbotLastEvent`/`turbotHoldTicks`, with stale detail in
both rows trimmed to fit). VISUAL_VOCAB §Turbot (arena) has a new "Goal reached" bullet.

**Review fix (2026-09-24):** the navResetCheck pin "turbotReset clears the event and the hold"
passed trivially: it ran after step 5 had already cleared the event, and Step never holds. It is
now two checks, each starting from live state: "turbotReset clears a live event (Step path)"
(steps 1-4 onto the goal, then Reset) and "turbotReset mid-hold clears the event and the hold,
stops the run" (Run to the goal, hold 2, then Reset). Both fail when `turbotReset` stops clearing
`turbotLastEvent`/`turbotHoldTicks`. I checked that by removing those lines from the store, running
the check, then restoring the file. Gates: app `tsc` 0 · app `npm run build` 0 · app `npm run check`
0 (navResetCheck 451 passed) · server `typecheck` 0 · server `npm run check` 0.

### 2026-09-24 — implemented (work loop)
**Built.** When a Run or Step moves the turbot onto a goal from a cell that is not a goal, the
Map's green circle pulses once (500 ms: it scales up and glows). A Run then holds for two
ticks (600 ms) and carries on. Step never holds. The same happens in the sandbox and in
questions. Reduced motion stops the pulse but keeps the hold. "Edit map" and the instructor
editor never pulse. The store owns the moment: `isGoalCell` (engine), `turbotLastEvent` and
`selectTurbotGoalHit`, and `turbotHoldTicks`, which counts skipped ticks inside the ONE
`turbotRun` interval, so no new timer. Pause and `turbotReset` zero the hold. Every reset
path, including the edit law's restart, goes through `turbotReset`. Intake assumptions
(a)–(c) are applied as written. The hold is two ticks, which is 600 ms, since there is no
speed control.

**Pins.** `navResetCheck [turbot goal flash]` covers:
- Step: the event lands at t=4, with no hold.
- Run: hold 2→1→0, then it steps on and halts on the goal.
- Reset from a live Step event, and Reset mid-hold.
- Pause mid-hold, then Run.
- An edit mid-hold.
- Goal→goal is not an arrival.
- An FSM brain halting after it arrives keeps the event and arms no second hold.

The fresh/junk helpers now cover both fields, so every `resetAllSimState` sweep proves they
clear. Source pins cover the pulse length (≤ 600 ms), reduced motion, the class gate, the
`!editingMap` gate, that no editor passes `highlightGoal`, and the one-interval rule.
`turbotCheck` is unchanged and green.

**Gates (exit codes).** app tsc 0 · app build 0 · app check 0 (navResetCheck 451 passed) ·
server typecheck 0 · server check 0.

**Review.** One finding, fixed: the old Reset pin passed trivially and is now two pins that
start from live state, mutation-tested. Nothing skipped. Two nits left alone:
- The CSS pin reads only the duration, not the iteration count.
- Going to the overview and back to the same question remounts the Map, which replays a
  still-live pulse. This is cosmetic.

**Owed.** The loop session has the browser recipes in the harness notes: sandbox Run/Step,
Pause and Reset mid-hold, Edit map with no replay, HW6 P2, and a screenshot at small zoom.
The Implement stage already covered most of them (see above; the screenshot is attached).
Two things are owed to Gabriel:
- One real-OS check with "Reduce motion" on (the headless emulation already passed).
- Confirm intake assumptions (a)–(c) at landing.

**Next step.** Loop session: do the visual check if it is still owed, then land per PROFILE §5.
