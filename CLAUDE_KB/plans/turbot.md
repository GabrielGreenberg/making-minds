# Plan — Turbots (arena + internal circuitry, all modes)

> **Status: PLANNED — NOT YET BUILT.** Session handoff doc from a design/scoping conversation.
> Nothing turbot-specific exists in code yet beyond the `'turbot'` `BuildMode`/`ActiveTask` enum
> values (`types.ts`) and the hard grader skip at `engine/grader.ts:85` (`'turbot grading not yet
> implemented'`). Read spec §9 (Turbots), §11 (TM Turbots), §12.5 (Turbot Evaluation), and
> Appendix B (I/O Encoding Reference) in `spec/PHIL_133_Platform_Spec_v2.md` first, plus
> `engines/overview.md`, `engines/fsm.md`, `engines/tm.md`. Update the relevant `engines/*.md`
> docs and delete the corresponding section of this plan as each piece ships; delete the whole
> file once all of it has landed.

## Scope recap

The turbot workspace is a split canvas: an **arena** (grid, blocks, food/goal, turbot
position+facing) in the upper panel, and **internal circuitry** (CC, SC, FSM, or TM) in the
lower panel that reads a sensor and drives a motor each movement cycle. Fixed I/O encoding for
CC/SC/FSM-driven turbots (Appendix B): **1-bit sensor** (0 = empty ahead, 1 = block-or-boundary
ahead) → **2-bit motor command** (00 stop, 01 turn left, 10 turn right, 11 forward). TM-driven
turbots (Phase 6) use a structurally different model — see "TM-turbot design" below.

**Grading** (§12.5) is behavioral, not value-based: run to a max step count, then check a
per-problem success criterion (reach-goal-and-stop / pass-through-goal / return-to-start) against
the trajectory. This does **not** fit the codec's `validate → encode → run → accept → decode →
compare` pipeline (`pipeline/codec.md`) that CC/SC/FSM/TM currently share end-to-end — it needs
its own arena-trajectory evaluator, invoked instead of the codec for turbot questions.

## Per-engine reuse assessment

- **CC** (`engine/cc.ts`) — works unchanged. `evaluateGate`/`topologicalSort` are already general
  over arbitrary input/output port counts; a 1-in/2-out circuit needs no engine change.
- **SC** (`engine/sc.ts`) — works unchanged, same reason (`evaluateSCSingleStep` takes
  `sortedInputs`/`sortedOutputs` as arrays of arbitrary length).
- **FSM** (`engine/fsm.ts`) — **needs a change.** `evaluateFSMSingleStep`'s transition-label
  parser hard-requires `/^[01]$/` on *both* halves of `"X:Y"` — it rejects the 2-bit motor output
  (`00`/`01`/`10`/`11`) outright. Widening only the output half (input stays 1 bit — the sensor)
  touches: the parser here, `machineValidation.ts`'s uniqueness checks, and the label-editing UI
  (built for single-digit entry).
- **TM** (`engine/tm.ts`) — the big one; a new dual-domain model, not a widening. See below.

## Recommended build order

1. Arena/turbot engine (`engine/turbot.ts`) + **CC-based turbot only** — zero engine changes
   needed elsewhere, cheapest path to a working vertical slice (arena model, step function,
   sensor/motor wiring into an existing CC circuit).
2. Arena-trajectory grader (a new path alongside, not through, the codec pipeline).
3. Store + UI wiring — mirrors `tm-store.md`'s `tmStep` pattern: live arena state, history,
   run/pause/reset actions, split-canvas UI.
4. FSM output-widening (small, scoped, per above).
5. SC-driven turbots (no engine change; just store/UI wiring once (3) exists).
6. TM combined-action change (affects **all** TMs, not just turbot — see below; needs its own
   decision record before turbot work depends on it).
7. `engine/tmTurbot.ts` (depends on 1 and 6).

## TM-turbot design (settled in the planning session)

### Spec transcription (source: session-provided image)

> - Turbots have an *internal* tape, but also act on an *external* world.
> - At any moment, a Turbot has both an **internal position** (on the tape) and an **external
>   position** (in the world).
> - At each transition, a Turbot can perform either an internal operation, or an external
>   operation, but not both.
> - When performing an internal operation, its external position remains unchanged; when
>   performing an external operation, its internal position remains unchanged.
> - Turbots start with a blank tape (unless otherwise noted).
> - **Internal** (○ circle state) — Input: `0` = read 0, `1` = read 1, `*` = read `*`. Output:
>   `0`/`1`/`*` = write that symbol, `R` = move right, `L` = move left.
> - **External** (▢ square state) — Input: `B` = see block, `E` = see empty, `F` = see food.
>   Output: `↑` = move forward, `⌐→` = right turn, `⌐←` = left turn.
> - By convention, states are either internal or external, never both. External states are
>   square, internal states are circular.
> - The Turbot **cannot** pass through blocks. It **can** pass through food.
> - Internally, perceives only the cell currently under the head. Externally, perceives only the
>   cell in front of it.

### Decision: combined write+move action (reverses the current doc)

Already decided independently of turbots: TM transitions move from **one primitive per step**
(the current model — a write and a move are separate steps, per `engines/tm.md`'s "single-action
transitions" section, which explicitly supersedes an earlier combined-grammar draft as "wrong for
this project") to **combined write+move `{digit}{direction}` pairs per step** (e.g. `"0R"`,
`"1L"`). This changes `tm.ts`'s `parseTMAction`/`applyAction` for **every** TM, not just turbot
ones.

> **Action item:** `engines/tm.md`'s "single-action transitions" section must be rewritten (not
> amended) once this lands — it currently documents the opposite as settled, in bold.

### Decision: separate module (`engine/tmTurbot.ts`), not an enriched `tm.ts` or a generic engine

Three options were considered: (a) enrich `tm.ts` in place to also handle external
percepts/actions; (b) a separate module that composes `tm.ts`/`fsm.ts`/`turbot.ts` primitives;
(c) a fully parametrized generic state-machine interpreter (configurable alphabets, state kinds,
domain mutation). **Chose (b).**

- **(a) rejected** — plain-TM grading (codec value-decode via `tmCodec.ts`) and turbot-TM grading
  (arena trajectory) are fundamentally different pipelines. Mixing the external alphabet into
  `tm.ts`/`tmValidate.ts`/`tmCodec.ts` would thread turbot-only branching through a
  grading-critical file that has nothing to do with arenas.
- **(c) rejected** — only two concrete cases exist (plain TM, turbot TM), no third in view;
  premature abstraction, and it can't unify the part that most needs unifying (grading) anyway,
  since the two modes' success criteria are incompatible (value-decode vs. trajectory).
- **(b) matches the codebase's existing composition pattern** — `sc.ts` already imports `cc.ts`'s
  `topologicalSort`/`evaluateGate`; `tm.ts` already imports `fsm.ts`'s `sortStateComponents`.
  `tmTurbot.ts` reuses `tm.ts`'s tape primitives for the internal half and `turbot.ts`'s arena
  primitives for the external half, adding only the dispatch and the external alphabet.

### `tmTurbot.ts` sketch

```ts
// Turbot-TM evaluation engine. Framework-agnostic.
//
// A turbot-TM is a state graph (STATE nodes + transition wires, same shape as
// FSM/TM) where each state is tagged internal (circle) or external (square).
// Internal states act on the tape; external states act on the arena — never
// both in one step. This module owns only the dispatch and the external
// alphabet; the internal half reuses tm.ts's tape primitives as-is, and the
// external half reuses turbot.ts's arena-mutation primitives as-is.

import type { CircuitComponent, Wire, TMTape, TMNotation, TurbotArenaState } from '../types';
import { readCell, applyAction, parseTMAction } from './tm';       // tape half, unchanged reuse
import { applyMotorCommand, senseAhead } from './turbot';          // arena half, unchanged reuse

export type TurbotPercept = 'B' | 'E' | 'F';
export type TurbotActionToken = 'F' | 'TR' | 'TL'; // forward / turn-right / turn-left; UI renders ↑ / ⌐→ / ⌐←

export interface ParsedExternalTransition {
  percept: TurbotPercept;
  action: TurbotActionToken;
}

export function parseExternalTransition(label: string | undefined): ParsedExternalTransition | null {
  if (!label) return null;
  const [inTok, outTok] = label.split(':');
  if (inTok !== 'B' && inTok !== 'E' && inTok !== 'F') return null;
  if (outTok !== 'F' && outTok !== 'TR' && outTok !== 'TL') return null;
  return { percept: inTok, action: outTok };
}

export interface TMTurbotStepResult {
  domain: 'internal' | 'external';
  nextStateId: string;
  tape?: TMTape;                 // set when domain === 'internal'
  arena?: TurbotArenaState;      // set when domain === 'external'
}

/** Dispatch on the current state's machineKind; null = no matching transition (halt). */
export function evaluateTMTurbotSingleStep(
  components: CircuitComponent[],
  wires: Wire[],
  currentStateId: string,
  tape: TMTape,
  arena: TurbotArenaState,
  notation: TMNotation
): TMTurbotStepResult | null {
  const comp = components.find((c) => c.id === currentStateId);
  const transitions = wires.filter((w) => w.sourceComponentId === currentStateId);

  if (comp?.machineKind === 'external') {
    const percept = senseAhead(arena);
    for (const t of transitions) {
      const parsed = parseExternalTransition(t.transitionLabel);
      if (parsed?.percept === percept) {
        return { domain: 'external', nextStateId: t.targetComponentId, arena: applyMotorCommand(arena, parsed.action) };
      }
    }
    return null;
  }

  // internal (default)
  const read = readCell(tape, tape.head);
  for (const t of transitions) {
    const parsed = parseTMAction(t.transitionLabel, notation); // tm.ts, post write+move change
    if (parsed?.input === read) {
      return { domain: 'internal', nextStateId: t.targetComponentId, tape: applyAction(tape, parsed.action) };
    }
  }
  return null;
}

// evaluateTMTurbotRun(...) — loop to halt/step-limit, mirroring evaluateTMSequence's shape,
// building a TmTurbotHistoryEntry[] (see below).
```

### Dependencies this creates elsewhere

- `types.ts` — `CircuitComponent.machineKind?: 'internal' | 'external'` (undefined ⇒ `'internal'`,
  so plain FSM/TM states are unaffected); `TmTurbotHistoryEntry` (same family as `TmHistoryEntry`
  plus a `domain: 'internal' | 'external'` tag).
- `engine/turbot.ts` — needs a **ternary** percept reader (`B`/`E`/`F`) for TM-turbots, distinct
  from the 1-bit sensor CC/SC/FSM turbots use (which has no food percept at all — food only
  matters for grading there, not sensing). Likely two separate functions rather than one
  generalized sensor.
- `engine/tmValidate.ts` — a sibling `validateTurbotTMTable`, branching determinism/grammar
  checks on `machineKind` per state.
- Component library / canvas — two placeable state kinds (circle/square); the transition-label
  editor needs state-kind-aware grammar.
- Grading — none in `tmTurbot.ts` itself; routes through the same arena-trajectory grader as
  CC/SC/FSM turbots (see "Scope recap" above), never `tmCodec.ts`.

### Open questions (not settled — resolve before implementing)

- **Halting semantics mid-run.** A plain TM halting = success. What does an *internal* state
  halting mean for a turbot mid-arena-run — does it just stop where it is (evaluated as-is
  against the arena criterion), or is that an error state distinct from a normal stop?
- **The external alphabet has no explicit "stop" token** (unlike the CC/SC/FSM 2-bit motor code's
  `00`). Confirm halting-on-no-transition is the intended "stop," not a missing case.

## Testing

Once `engine/turbot.ts` lands, mirror `app/tools/tmCheck.ts`'s pattern: a headless
`turbotCheck.ts` driving a hand-built CC-turbot through a small arena. `tmTurbot.ts` gets the same
treatment once built, plus a fixture exercising the write+move change in `tm.ts`.
