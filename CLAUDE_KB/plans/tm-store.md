# Plan — TM store + UI wiring (`tmStep`)

> **Status: PLANNED — NOT YET BUILT.** Session handoff doc. The TM **engine and grading are
> done** (`engine/tm.ts`, `tmValidate.ts`, `tmCodec.ts`, the grader TM branch — see
> `../engines/tm.md`). This plan is the *next* TM step: the store actions that drive run/step on
> the canvas, plus the UI that depends on them. Read `../engines/tm.md` and `../engines/overview.md`
> ("How the store relates to the engine") first. Keep this file in sync as the work lands; delete
> it once the store + UI ship and `../engines/tm.md` "Not yet built" is cleared.

## Why TM stepping differs from FSM (the design driver)

`fsmStep` (store.ts:2803) consumes a fixed `fsmInputSequence` one bit per step while the state is
derived. A TM has **no per-step input** — the input is the *initial tape*, and the machine then
runs autonomously, **mutating the tape in place** until it halts (success) or hits the step
limit. So the store must hold a live `TMTape` and a snapshot of the *initial* tape to reset to.
Halting is **success** for a TM (the inverse of FSM) — do not copy `fsmHalted`'s meaning.

Mirror the shape of `scStep`/`fsmStep` (store.ts:2399, 2803). Engine purity does the heavy
lifting: `applyAction` shares `cells` on a move and clones on a write, and `evaluateTMSingleStep`
returns a fresh tape — the store just swaps in the returned object and **never mutates
`tmTape.cells` in place**.

## Settled decisions (agreed in the planning session)

- **Notation source.** Add a `tmNotation()` store helper: read the active question's
  `representation` first (`notationForRepresentation`, from `engine/tmCodec.ts`), else fall back to
  the global `repSystem`. Anything but `binary` ⇒ `'unary'`. (Sandbox/free-canvas TM has no
  `representation` today; the fallback covers it.)
- **Tape persistence.** `tmTape`/`tmHistory` are **transient** — like `fsmHistory`/`scHistory`,
  excluded from `getAutoSaveData` (store.ts:2908); they reset on reload. The machine itself
  (components/wires/labels) persists through the normal circuit save.

## State additions (`AppState`, beside the FSM state ~store.ts:2762)

```ts
tmTape: TMTape;                 // live tape; default { cells: {}, head: 0 }
tmInitialTape: TMTape | null;   // snapshot captured when a run/step begins; tmReset restores it
tmCurrentStateId: string | null;
tmTimeStep: number;             // starts at 1
tmHistory: TmHistoryEntry[];
tmRunning: boolean;
tmRunIntervalId: number | null;
tmHalted: boolean;              // reached a config with no transition — SUCCESS for a TM
tmHitStepLimit: boolean;        // bailed at DEFAULT_TM_MAX_STEPS — probable infinite loop
```

`TMTape`, `TMSymbol`, `TMNotation`, `TmHistoryEntry` are in `types.ts`; engine helpers come from
`./engine` (`evaluateTMSingleStep`, `sortStateComponents`, `DEFAULT_TM_MAX_STEPS`, `encodeTM`,
`notationForRepresentation`, `validateTMTable`, `parseTMTransition`).

## Actions

- **`tmStep()`** — guard on `tmHalted || tmHitStepLimit`; resolve `currentStateId ||
  sortStateComponents(components)[0].id`; on the first step snapshot `tmInitialTape`; call
  `evaluateTMSingleStep(wires, currentStateId, tmTape, tmNotation())`. `null` ⇒ set `tmHalted:
  true` (done). Otherwise set `tmTape = result.tape`, append a `TmHistoryEntry` (same fields the
  engine builds in `evaluateTMSequence`: `t, stateLabel, read, action: result.action.raw,
  headBefore, nextStateLabel`), advance `tmCurrentStateId` + `tmTimeStep`; if `tmTimeStep >=
  DEFAULT_TM_MAX_STEPS` set `tmHitStepLimit: true`.
- **`tmRun()` / `tmPause()`** — `setInterval` loop like `fsmRun` (store.ts:2842); stop on
  `tmHalted || tmHitStepLimit`.
- **`tmReset()`** — restore `tmTape` to `tmInitialTape` (or leave as-is if null), clear
  `tmCurrentStateId`/`tmHistory`, `tmTimeStep: 1`, all flags false, clear the interval.
- **`tmGlobalReset()`** — clear `tmTape` to `{ cells: {}, head: 0 }` and reset everything.
- **Tape setup (for the §10.2 strip):** `toggleTmCell(index)` / `setTmCell(index, symbol)` and
  `setTmHead(index)` — build a **new** `cells` object, never mutate in place. Optional
  `setTmTapeFromValues(values)` using `encodeTM(tmNotation(), values)` as a convenience.
- **Transition labels:** STATE→STATE wire creation hardcodes `transitionLabel: '0:0'`
  (store.ts:802) and `setTransitionLabel` enforces the FSM regex `^[01]:[01]$` (store.ts:2771).
  For TM the default should be a valid TM label (e.g. `'0:0R'` — write `0`, move right, under the
  two-action model) and the setter must validate `input:action` via
  `parseTMTransition(label, notation)`. Either branch these by `buildMode` or
  add a `setTmTransitionLabel`.

## Integration points (small, easy to miss)

- Wire `tmGlobalReset` into the same context-switch spots FSM uses: `SimulationPanel.tsx:114`
  (`fsmReset`) and `DataTable.tsx:474` (`fsmGlobalReset`), plus the question/tab-switch paths.
- `buildMode === 'TM'` already exists in `TabBar.tsx:10` but the panels only branch on SC/FSM —
  see the `isSC`/`isFSM` checks in `SimulationPanel.tsx` (99,103), `DataTable.tsx` (191,192),
  `SequentialTimeline.tsx:12`, and the library in `ComponentLibrary.tsx` (191,237,266).

## UI follow-ups (depend on the store above)

- **Tape strip** (spec §10.2) — render a derived window from `tmTape.cells` (`Object.keys → Number`
  → min/max, padded around `head`) with a head marker; click-to-toggle calls `toggleTmCell`.
- **Status display** (spec §10.5) — reads `tmHistory` + `tmHalted`/`tmHitStepLimit`.
- **Transition-label editor** — `input:action` validation, notation-aware, surfacing
  `validateTMTable` syntax errors (ambiguous / unparseable) in the editor.
- **Library/panels** — add `buildMode === 'TM'` branches (TM library items, a TM `SimulationPanel`
  branch with run/step/reset, the tape strip in place of the SC/FSM table).

## Authoring (separate, later)

No TM path in `QuestionCreator` / `testVectorGen.ts`; TM samples are hand-authored as value-based
`test_cases`. TM generation must **sample** tapes, not enumerate (TM correctness is undecidable) —
see `../engines/tm.md` "Grading (target semantics)".

## Testing

The engine/codec/grader are covered by `app/tools/tmCheck.ts`. Store logic is best validated once
the UI lands; if store-level coverage is wanted earlier, add a small headless assertion that drives
`tmStep` over the unary-increment machine and checks `tmTape`/`tmHalted`.
