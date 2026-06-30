# FSM — Finite state machine engine

**File:** `app/src/engine/fsm.ts` · **Status:** implemented. Independent of the CC/SC engines
(no shared evaluation; states and transitions are a different graph). Read `overview.md` first.

A **Mealy** finite state machine: STATE nodes connected by transition wires. Each step consumes
one input bit and emits one output bit determined by the transition taken.

## Representation

- **States** are `STATE` components. The start state is the one with the **lowest numeric
  subscript** (`S₀`). Labels use Unicode subscript digits (`S₀`, `S₁`, …).
- **Transitions** are wires whose `transitionLabel` is `"X:Y"` — `X` = input bit, `Y` = output
  bit, each a single `0` or `1`. The wire's `sourceComponentId` / `targetComponentId` give the
  from/to state.

`sortStateComponents(components)` filters to `STATE` and sorts by the numeric value of the
label's subscript suffix (it maps Unicode subscript digits back to ASCII before parsing).

## One step: `evaluateFSMSingleStep`

```ts
evaluateFSMSingleStep(wires, currentStateId, inputBit): { output, nextStateId } | null
```

Scans the wires *out of* `currentStateId`, in wire order, for the first whose `transitionLabel`
parses as a valid `"X:Y"` with `X === inputBit`. Returns that transition's `output` and target
state. Returns **`null` if no transition matches** — the machine halts.

Validation: a label must be exactly two `[01]` parts separated by `:`. Malformed labels are
skipped (not errors).

## A sequence: `evaluateFSMSequence`

```ts
evaluateFSMSequence(components, wires, inputBits: number[])
  : { outputBits: number[], halted: boolean, haltedAt?: number }
```

Starts at `S₀`, consumes `inputBits` one at a time. If a step halts (no matching transition),
returns the outputs produced so far with `halted: true` and `haltedAt` = the 0-based index of
the step that couldn't proceed. With no STATE components it returns `halted: true, haltedAt: 0`.

## Grading

`parseFSMTestVector` passes the flat arrays straight through: **one input bit per step, one
output bit per step**. In `grader.ts`, a case passes only when the machine **did not halt** and
the full output sequence matches:

```ts
pass: !result.halted && bitsEqual(got, expectedBits)
```

A halted FSM fails the case but still returns its partial `got` output, which the gradebook can
show as feedback.

## Working-on notes

- **First-match-wins by wire order.** If a state has two transitions for the same input bit,
  the one earlier in the `wires` array is taken. Authoring should prevent ambiguous transitions
  rather than relying on order.
- Mealy, not Moore: output is on the transition (`X:Y`), not the state.
- No FSM authoring in `QuestionCreator` yet; FSM sample assignments are seeded in
  `app/src/devData/` with vectors generated from a known-correct machine via
  `evaluateFSMSequence`.
- The store's `fsmStep` wraps `evaluateFSMSingleStep` and records an `FsmHistoryEntry` per step
  (`t, stateLabel, input, output, nextStateLabel`) for the state table / history UI.
