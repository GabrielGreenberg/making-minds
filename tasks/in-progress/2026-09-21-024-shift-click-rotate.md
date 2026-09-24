---
id: 2026-09-21-024
type: feature
title: Shift-click a gate to rotate it, with a light "(shift+click to ↻)" hint beside the Rotate button
priority: normal
size: large
requires: browser
area: app
source: chat
created: 2026-09-21T17:40:00-07:00
status: in-progress
after:
branch: task/024-shift-click-rotate
merged_into:
---

## Description
Gabriel: "add shift-click on a logic gate to rotate it, and put a note (shift+click to ↻)
next to the Rotate button in light letters". Provenance: chat, catch session 2026-09-21.
Effort is an hour or so; sized `large` only because a mouse gesture can be proven only in a
browser (README §Sizing).

Today rotation is the toolbar button in `SimulationPanel.tsx:84–96` ("↻ Rotate", rotates every
selected component by calling `rotateComponent` per id). `rotateComponent` (`store.ts:1817`)
is lock-aware (`isCurrentQuestionLocked`), pushes undo history, adds 90°, and re-evaluates.
Shift-click on a component already means something (`CircuitCanvas.tsx:2912–2918`): in FSM/TM,
with one state selected, shift-clicking another state creates the transition
(`tryShiftConnect`, `:2604–2617`); otherwise shift-click **toggles the component in or out of
the selection**. Shift-click on a wire toggles it too (`:2863`); shift+drag on empty canvas is
an additive box-select (`:2996`); alt-drag / middle button pans (`:2635`); triple-click selects
all (`:2907`). No modifier-click currently rotates.

## Done when
- Shift-clicking a gate, a MEM or a boxed circuit (everything the Rotate button rotates; NOT a
  STATE node, whose shift-click keeps the FSM/TM connect gesture) rotates it 90° clockwise,
  through `rotateComponent` — so a locked question ignores it, undo restores it, and wires
  re-route exactly as after the button.
- The Rotate button reads "↻ Rotate" followed by a muted hint "(shift+click to ↻)" in light
  letters (a `.toolbar-hint` span, ~10–11px, `var(--text-secondary)`), visible whenever the
  button is.
- Multi-select still works: toggling a component in/out of the selection moves to
  cmd/ctrl-click (see Assumptions); shift+drag box-select stays additive; wire shift-click
  unchanged.
- The canvas's modifier map is written down in ONE comment block at the top of the pointer-down
  handler (shift / cmd-ctrl / alt / triple-click / detail), so the next gesture is added there.

## Design
- **deepFix:** none bigger is warranted — the gesture layer is one handler. The "deep" part is
  making the modifier map explicit (the comment block above) instead of leaving each modifier's
  meaning scattered across the branches at `:2604`, `:2863`, `:2912`, `:2996`, `:2635`.
- **surgicalFix:** insert `if (e.shiftKey && rotatable) { state.rotateComponent(id); return; }`
  before the toggle at `:2912` after `tryShiftConnect`. Do this, plus the map and the hint.
- Order inside the shift branch: `tryShiftConnect` first (STATE→STATE), then rotate for
  rotatable types, then (no longer) toggle. Rotatable = component types whose geometry honours
  `rotation` (`componentGeometry.ts:135–165`): every non-STATE component; INPUT/OUTPUT rotate
  today via the button, so keep them consistent with it.
- **Assumptions recorded at intake (Gabriel to confirm; none blocks starting):**
  (a) selection-toggle moves from shift-click to cmd/ctrl-click, since shift-click now rotates;
  (b) MEM and boxed circuits rotate on shift-click too, not only gates.
- Pointers: `components/CircuitCanvas.tsx:2596–2620, 2860–2870, 2905–2935, 2990–3000` ·
  `store.ts:1308` (`toggleSelected`), `:1817` (`rotateComponent`) ·
  `components/SimulationPanel.tsx:84–96` · `index.css:317` (`.toolbar-icon`; add
  `.toolbar-hint` beside it) · `componentGeometry.ts:135–165`.

## Verify
- Gates: both `tsc`s, `npm run build`. No harness tool exercises pointer events (the canvas is
  React), so the gesture itself is browser-verified.
- Browser (local mode, Sandbox): CC tab — place an AND gate, shift-click it four times (back to
  0°; wires from IN1/IN2 re-route each time); cmd-click two gates → both selected; shift+drag
  adds to a selection. FSM tab — select S1, shift-click S2 → a transition is created, no
  rotation. An assignment question marked done → shift-click does nothing. Undo after a
  rotation restores it. Screenshot the toolbar hint: `tasks/attachments/2026-09-21-024-hint.png`.

## Progress log
