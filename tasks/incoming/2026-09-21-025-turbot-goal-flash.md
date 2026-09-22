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
status: ready
after:
branch:
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
