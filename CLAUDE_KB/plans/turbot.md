# Plan — Turbots (arena + internal circuitry, all modes)

> **Status: PLANNED — NOT YET BUILT.** Nothing turbot-specific exists in code yet beyond the
> `'turbot'` `BuildMode`/`ActiveTask` enum values (`types.ts`) and the hard grader skip at
> `engine/grader.ts:85`. Read spec §9, §11, §12.5, Appendix B (`spec/PHIL_133_Platform_Spec_v2.md`)
> and `engines/overview.md`/`fsm.md`/`tm.md` first. Delete each section below as it ships and fold
> the result into the relevant `engines/*.md`.

## Scope

Split canvas: **arena** (grid, blocks, food/goal, turbot position+facing) upper panel, **internal
circuitry** (CC/SC/FSM/TM) lower panel, reading a sensor and driving a motor each movement cycle.
CC/SC/FSM-driven turbots use the fixed I/O encoding in Appendix B: 1-bit sensor (0 empty, 1
block-or-boundary ahead) → 2-bit motor (00 stop, 01 turn left, 10 turn right, 11 forward).
TM-driven turbots use a different model (see below).

**Grading is behavioral, not value-based** (§12.5): run to a max step count, check a per-problem
criterion (reach-goal-and-stop / pass-through-goal / return-to-start) against the trajectory. This
does not fit the codec's `validate→encode→run→accept→decode→compare` pipeline — it's a separate
evaluator, invoked instead of the codec for turbot questions.

## Tasks, in order

1. **`engine/turbot.ts`** — arena model (grid, blocks, food, turbot position/facing) + step
   function (read sensor → run internal circuit → apply motor command → new arena state) + a
   **CC-based turbot only**. `cc.ts`/`sc.ts` need no changes — both already handle arbitrary
   input/output port counts, so a 1-in/2-out circuit just works.
2. **Arena-trajectory grader** — new function in `grader.ts` for `buildMode === 'turbot'`,
   replacing the current hard skip at line 85. Loads arena config, runs to step limit, checks the
   success criterion, reports pass/fail + steps + final position.
3. **Store + UI** — mirror `tm-store.md`'s `tmStep` pattern: live arena state, step history,
   run/pause/reset actions, split-canvas rendering, arena-editing (place turbot/block/goal).
4. **FSM output-widening** — `evaluateFSMSingleStep` (`fsm.ts`) requires `/^[01]$/` on both halves
   of a `"X:Y"` label; the output half must widen to 2 bits (`00`/`01`/`10`/`11`) for FSM-driven
   turbots. Input half stays 1 bit. Touches: the parser, `machineValidation.ts`'s uniqueness
   checks, and the label-editing UI (built for single-digit entry).
5. **SC-driven turbots** — no engine change; store/UI wiring only, once (3) exists.
6. **TM action-grammar change** — `tm.ts`'s `parseTMAction`/`applyAction` change from one
   primitive per step to a combined write+move token (`"0R"`, `"1L"`, etc). This affects **every**
   TM, not just turbot ones — update `engines/tm.md`'s "single-action transitions" section to
   match once it lands.
7. **`engine/tmTurbot.ts`** — depends on (1) and (6). See design below.

## TM-turbot design

Each STATE node is tagged **internal** (circle) or **external** (square) — add
`CircuitComponent.machineKind?: 'internal' | 'external'` to `types.ts` (undefined ⇒ `'internal'`,
so plain FSM/TM states are unaffected). A step acts on exactly one domain:

- **Internal** states read the tape (`{0,1,*}`) and write a combined digit+move action — reuse
  `tm.ts`'s `readCell`/`applyAction`/`parseTMAction` directly (post the change in task 6).
- **External** states read the arena percept in front of the turbot — `B` (block), `E` (empty), or
  `F` (food) — and act with one of `{forward, turn-right, turn-left}` (no "stop" token; halting on
  no matching transition is the intended stop). This percept is **ternary** and distinct from the
  1-bit CC/SC/FSM sensor, which has no food percept at all (food only matters there for grading,
  not sensing) — `turbot.ts` needs a separate reader for it.

`tmTurbot.ts` itself is only the dispatch: look up the current state's `machineKind`, read from
the matching domain, find the transition whose label matches, apply the action to that domain
only, advance state. New types: `TurbotPercept`, `TurbotActionToken`, `TmTurbotHistoryEntry`
(like `TmHistoryEntry` + a `domain` tag). New validation: a sibling `validateTurbotTMTable` in
`tmValidate.ts`, checking determinism/grammar per state's kind. Grading routes through the same
arena-trajectory grader as CC/SC/FSM turbots (task 2) — never `tmCodec.ts`.

**Open questions to resolve before implementing:**
- What does an internal-state halt mean mid-run for a turbot — does it just stop where it is,
  graded as-is against the arena criterion?
- Confirm halt-on-no-transition is genuinely the intended "stop" for external states (no explicit
  stop token exists in that alphabet).

## Out of scope for this pass

- Turbot authoring UI (`QuestionCreator`) — hand-author/seed turbot assignments in `devData/`,
  same as SC/FSM today.
- SC/FSM/TM-driven turbots beyond the CC-based vertical slice, until (1)-(3) are proven out.

## Testing

Once `engine/turbot.ts` lands, add a headless `turbotCheck.ts` mirroring `tmCheck.ts`: drive a
hand-built CC-turbot through a small arena. `tmTurbot.ts` gets the same treatment, plus a fixture
covering `tm.ts`'s write+move change.
