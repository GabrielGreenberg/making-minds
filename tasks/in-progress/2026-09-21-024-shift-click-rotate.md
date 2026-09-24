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

### 2026-09-24 — implemented and browser-verified (work loop, Implement stage)
**What a student sees now.** Shift-clicking a gate, a MEM, a boxed circuit, an INPUT or an
OUTPUT turns it 90° clockwise, the same as the ↻ Rotate button: a locked question ignores it,
undo brings it back, and its wires re-route. Beside the button, a muted "(shift+click to ↻)"
hint (11px, `var(--text-secondary)`) shows whenever the button does. To add or remove a part
from the selection, use cmd-click (Mac) or ctrl-click (elsewhere). Shift-click on a wire still
toggles it, and shift- or cmd/ctrl+drag on the background adds the rectangle to the selection.
FSM/TM states keep their shift-click (connect s1 → s2, else the old toggle / wire).

**Assumptions applied — Gabriel to confirm:**
(a) the selection toggle moved from shift-click to cmd/ctrl-click, since shift-click now
rotates; (b) MEM, boxed circuits and INPUT/OUTPUT rotate on shift-click too, the same set the
Rotate button rotates. STATE nodes don't rotate. **Spec edited in place** (§2.2 Selection and
Editing): "Multi-select (cmd/ctrl-click; shift-click on wires and FSM/TM states)", "Box select
(drag rectangle; shift or cmd/ctrl adds)", and a new "Rotate (↻ Rotate button, or shift-click
a component)".

**How.** `CircuitCanvas.tsx handlePointerDown` opens with the ONE `// ── Modifier map` comment
block, and the branches point back to it. `modifierClick(comp)` runs in this order: shift + a
STATE→STATE connect; then shift on a non-STATE, which selects the part if needed and calls
`state.rotateComponent`; then cmd/ctrl, which toggles the part. It is called from BOTH the port
branch and the component branch, because the 20px port circles cover most of a NOT, MEM or
IN/OUT, a gate's edges and a state's rim. In the component branch it runs BEFORE the
`e.detail >= 3` triple-click, because rapid shift-clicks count `detail` up. On a Mac,
ctrl-click would also open the context menu, so `menuSuppressRef` (set at the top of the
handler, before the button early return) makes `onContextMenu` swallow it. The component has
no lock or history code of its own: `rotateComponent` owns the lock, `pushHistory` and
`recordEdit` (law 3). The dead `DragInfo.shiftKey` is gone.
- **Found and fixed on the way:** shift+drag box-select was never additive. Pointer-down
  skipped the clear, but pointer-up *replaced* the selection with the rectangle's contents.
  The drag now carries `additive` (shift or cmd/ctrl), and pointer-up merges it with the
  selection held at pointer-down.
- **Pins:** `navResetCheck [mark as done]` covers a refused rotation while done (no turn, no
  history), then after unlocking 90° with exactly one history step, undo back to 0°, and four
  turns back to 0°. `[viewing a submission]` adds "rotateComponent is refused". The new
  `[canvas gestures]` source pins cover: the map at the top of the handler naming shift,
  cmd/ctrl, alt and detail; the gesture calling `rotateComponent` with no lock anywhere in the
  canvas; `modifierClick` before `e.detail >= 3` in the component branch and present in the
  port branch; the hint span and its CSS. I mutation-tested the three structural pins on
  altered copies, and each one fails when its property breaks.

**Browser (pane, local mode, John Doe's sandbox, in fresh tabs I removed afterwards):**
- CC tab: IN1/IN2 → AND → OUT1, plus a NOT and a MEM. Four shift-clicks on the AND went 0 →
  90 → 180 → 270 → 0, one undo step each, with the wires re-routing every time and returning to
  their first route. ✓
- The injected clicks carry `detail: 0`, so I dispatched pointer-downs with shift and
  `detail` 3 and then 4. Both rotated and did not select all; a plain `detail` 3 still selected
  all 6. ✓
- Cmd+Z after a rotation restored it (180 → 90). ✓
- Shift-clicks landing on port circles (NOT's input, MEM's port, IN1, OUT1) rotated each part
  and armed no wire (still 3 wires). ✓
- A shift-click on the INPUT toggle tab flipped the value and did not rotate. ✓
- Cmd-click added the NOT, then the MEM (on its port), then removed the AND. Ctrl-click added
  IN2, and the context menu that followed arrived `defaultPrevented`. No rotations. ✓
- Shift-click on a wire toggled it in, then out. ✓
- The pane's drag tool drops modifiers, so I dispatched the box-select drags as pointer
  events. Shift+drag and cmd+drag over OUT1 with {NOT, M1} selected gave {NOT, M1, OUT1}; a
  plain drag gave {OUT1}; there were no duplicates. ✓
- FSM tab: with S₀ selected, shift-click on S₁ created S₀→S₁ and moved the selection to S₁,
  with no rotation. A repeat shift-click on S₁ fell back to the old toggle, and cmd-click on S₀
  toggled it. ✓
- HW1 P1 marked done: shift-clicks on the AND and the OR changed nothing (rotation 0, undo 0),
  only the selection. I unlocked it again afterwards, and nothing had changed. ✓
- Hint screenshot: `tasks/attachments/2026-09-21-024-hint.png`. It is a headless Chrome shot
  of the visitor sandbox: the enabled Rotate button with the hint beside it, and a selected AND
  turned 90° with re-routed wires.

**Gates:** app `tsc` 0 · `navResetCheck` 0 (417 passed) · `npm run build` 0 · app
`npm run check` 0 · server `npm run typecheck` 0 · server `npm run check` 0. I left CLAUDE.md
unchanged: nothing in it describes the gestures, and it has 25 bytes of headroom.

**Follow-up (out of scope):** the Rotate button calls `rotateComponent` once per selected id,
so N selected parts make N undo steps, and selected wire ids push no-op history. A
`rotateComponents(ids)` action that pushes once would fix both.

### 2026-09-24 — review fixes (work loop, Fix stage)
Assumptions (a) and (b) stay applied as recorded above. Gabriel still has to confirm them.
- **Wire segments.** A routed wire's middle segment has its own hit line over the wire, and a
  shift- or cmd/ctrl-click on it used to start a segment drag and add an undo step that did
  nothing. Now the segment branch takes only plain presses (`&& !e.shiftKey && !mod`), and
  the wire branch covers `'wire' || 'wiresegment'`. So a modifier-click anywhere on a wire
  toggles it, and a plain drag still moves the segment. The modifier map now lists every
  branch in the order the handler tests it. That includes the segment, the box resize handle,
  name and edge, and the armed palette tool on the background (draws or places under any
  modifier, and stays armed).
- **The Mac ctrl-click menu.** `menuSuppressRef` is no longer set on every ctrl+left press.
  `swallowMacMenu()` sets it only where a cmd/ctrl gesture actually ran: a toggle in
  `modifierClick`, a wire toggle, or an additive box-select. A capture-phase pointer-up
  listener that runs once clears it again. `onContextMenu` still disarms the palette tool and
  any pending wire when it swallows the menu. The fix covers two bugs. (a) On a Mac, a
  ctrl-click with a tool armed places the part and then disarms the tool, as on main. (b) On
  Windows and Linux, a ctrl-click raises no menu, so it no longer leaves the flag set to
  swallow a later context menu.
- **Pins.** `navResetCheck [canvas gestures]` now also checks these five things:
  1. In `modifierClick`'s shift branch, the order is `tryShiftConnect` → the STATE guard →
     `state.rotateComponent(comp.id)`.
  2. The cmd/ctrl branch only toggles.
  3. `rotateComponent(` appears exactly once in the handler.
  4. The segment branch excludes modifiers, and the wire branch includes segments.
  5. `menuSuppressRef` is only ever written as `true` or `false`, and set true once, inside
     `swallowMacMenu`, which guards on `e.ctrlKey`. `onContextMenu` has no early `return`
     before the disarm.

  The port-branch pin's anchor now follows the wire branch's new condition. I mutation-tested
  the pins on scratch copies of the canvas. Each of these six mutants failed at least one pin:
  - drop the STATE guard
  - `if (e.shiftKey)` → `if (mod)` (the reviewer's mutant)
  - rotate in the cmd/ctrl branch
  - revert the segment condition
  - re-arm on every ctrl press
  - an early `return` in `onContextMenu`
- **Browser (pane, John Doe's sandbox, a fresh CC tab I removed afterwards).** These were
  real CDP clicks, not dispatched events, and Chromium on macOS turns a ctrl+left press into
  a context menu.
  - A ctrl-click on an AND selected it with no rotation. The `contextmenu` event (button 0,
    ctrl) arrived after pointer-down and before pointer-up, and it was `defaultPrevented`.
    This confirms that clearing on pointer-up is safe on a Mac.
  - With OR armed, a ctrl-click on the background placed an OR, then the menu was swallowed
    and the tool disarmed (`selectedTool` null).
  - I dispatched the Windows sequence (ctrl pointer-down/up on the AND, no menu), then a
    later `contextmenu` on the svg. It was not prevented.
  - A shift-click on a routed wire's middle segment toggled the wire in, and a ctrl-click
    toggled it out. Neither added an undo step, and the ctrl-click's menu was swallowed. A
    plain click on the same segment still started a segment drag (one history step).
  - A shift-click on the AND rotated it to 90°.

**Gates:** app `tsc` 0 · app `npm run build` 0 · app `npm run check` 0 (`navResetCheck` 421
passed) · server `npm run typecheck` 0 · server `npm run check` 0.

### 2026-09-24 — implemented (work loop)
**Built.** Shift-clicking a gate, a MEM, a boxed circuit, an INPUT or an OUTPUT now turns it
90° clockwise through `rotateComponent`. So a locked question ignores it, undo restores it, and
the wires re-route, just as with the ↻ Rotate button. The button now has a muted
"(shift+click to ↻)" hint beside it (`.toolbar-hint`, 11px, `var(--text-secondary)`). Cmd/ctrl-click
toggles a part in or out of the selection. Shift-click still toggles wires. Shift- or cmd/ctrl+drag
box-select now really adds to the selection: before, pointer-up replaced it. STATE nodes keep
shift-connect. One `// ── Modifier map` block at the top of `handlePointerDown` lists every
gesture in the order it is tested. Spec §2.2 was edited to match.
**Assumptions (a) and (b) applied** as the intake recorded them. Gabriel still has to confirm them.
**Pins:** `navResetCheck [mark as done]` (a refused rotate while done; 90° with one history step;
undo; four turns back to 0°) · `[viewing a submission]` (rotate refused) · `[canvas gestures]`
(the map at the top of the handler; modifierClick order connect → STATE guard → rotate; cmd/ctrl
only toggles; one `rotateComponent(` in the handler; modifierClick before `e.detail >= 3` and in
the port branch; segment/wire routing; the menuSuppressRef/onContextMenu discipline; the hint
span and its CSS). All mutation-tested.
**Gates:** app-tsc 0 · app-build 0 · app-check 0 (navResetCheck 421 passed) · server-tsc 0 ·
server-check 0.
**Review:** 3 findings fixed:
1. Modifier-clicks on a wire segment now toggle the wire instead of starting a no-op drag, and
   the map is complete.
2. The rotation-order pins were added.
3. `menuSuppressRef` is armed only where a ctrl gesture ran, and is cleared on pointer-up.

None skipped. Nits left alone: `rotationOf`'s `?? 0` would also pass if undo removed the gate
(navResetCheck.ts:313).
**Owed (loop session, browser, local mode, `dev` on 5173):**
- CC sandbox checks:
  - Four FAST shift-clicks on a wired AND come back to 0°, rotating each time and never
    selecting all. Cmd+Z restores.
  - Shift-clicks on NOT, MEM, IN/OUT and BOXED near a port rotate each one and arm no wire.
    Shift-click on the INPUT toggle tab still flips it.
  - Cmd-click toggles components. Shift- and cmd+drag add to the selection. Shift-click on a
    wire toggles it. Alt-drag pans. Ctrl-click on a Mac shows no menu.
- FSM: with S1 selected, shift-click S2's body and rim → a transition is created, with no
  rotation. With nothing selected, shift-click toggles.
- HW question marked done → shift-click does not rotate. Unmark it, and rotate + undo work.
- Re-shoot the hint with nothing selected (the button disabled, the hint legible) and with a
  selection, into `tasks/attachments/2026-09-21-024-hint.png`. Check that the widest toolbar
  (a Turbot TM brain) at about 1024px does not clip.
**For Gabriel (landing report):**
- Confirm (a) and (b).
- The hint also shows in FSM/TM, where shift-click connects rather than rotates. It was left
  that way because the task says the hint shows whenever the button does.
- Spec §2.2 multi-select wording was edited.
**NEXT STEP:** loop session: do the owed browser/visual checks above, then land per PROFILE §5.

### 2026-09-24 — loop browser check and land
- **Browser, local mode (dev server restarted on the branch), John's sandbox, real modifier
  clicks.**
  - Logic tab, an AND and a NOT. Four fast shift-clicks on the AND gave 90° after the first and
    0° after the fourth, with no select-all (the `detail ≥ 3` branch comes after
    modifierClick). Undo restored the previous angle (270°).
  - With nothing selected, cmd-click on the AND gave [AND]; cmd-click on the NOT gave
    [AND, NOT]; a second cmd-click on the NOT gave [AND]. (The first try looked wrong because
    my "background" click had landed in the right panel, so the AND was still selected.)
  - The toolbar reads "↻ Rotate (shift+click to ↻)". The hint stays legible when the button is
    disabled.
  - FSM tab, S₀ and S₁. Click S₀, shift-click S₁: the transition S₀→S₁ is created, nothing
    rotates, and the selection moves to S₁.
- **For Gabriel to confirm:**
  - Intake assumptions (a) and (b) as implemented. (a) The component multi-select toggle is now
    cmd/ctrl-click; shift still toggles wires and STATE nodes, and shift+drag stays additive.
    (b) MEM, BOXED and IN/OUT rotate too.
  - The hint also shows on FSM/TM canvases, where shift-click connects states. That is as
    specified ("visible whenever the button is").
  - Spec §2.2's multi-select line was edited to match.
- Landed via a merge into `main`.
