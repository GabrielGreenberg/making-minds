# Engines — shared model

The `app/src/engine/` directory holds the platform's evaluation logic. Read this before any
engine doc; the per-mode specs (`cc.md`, `sc.md`, `fsm.md`, `tm.md`) assume the model here.

## The cardinal rule: framework-agnostic

Every file in `engine/` is **pure TypeScript** — no React, no Zustand, no `store.ts`, no DOM.
It depends only on the data types in `app/src/types.ts`. This is what lets the *same* code run
in the browser (driven by the store) and headlessly in the Node CLI grader
(`app/tools/grade.ts`). If you find yourself reaching for `window`, a hook, or the store
inside `engine/`, you're in the wrong layer — that logic belongs in `store.ts` or a component.

## Data model (`types.ts`)

A circuit is `CircuitData = { components: CircuitComponent[], wires: Wire[] }`.

**`CircuitComponent`** — `{ id, type, x, y, label, ports, value?, storedValue?, memDirection?,
internalCircuit?, … }`. `ComponentType` is one of:

| Type | Ports (`side`) | Role |
|------|----------------|------|
| `INPUT` | `out` (right) | source; carries a `value` (0/1, or `undefined` = blank) |
| `OUTPUT` | `in` (left) | sink; the bit read out |
| `NOT` | `in`→`out` | 1-input gate |
| `AND` / `OR` / `XOR` | `in1`,`in2`→`out` | **2-input only** gates |
| `HA` (half-adder) | `in1`(A),`in2`(B)→`sum`(S),`carry`(C) | 2 outputs |
| `MEM` | `mout`(left), `min`(right) | 1-bit memory cell (SC); holds `storedValue` |
| `BOXED` | per its `internalCircuit` | encapsulated sub-circuit |
| `STATE` | `left`,`right` | FSM state node |

Ports have `side: 'left' | 'right'`. **Convention: left = input, right = output, signal flows
left→right.** `getPortsForType(type)` is the source of truth for a component's ports.

**`Wire`** — `{ id, sourceComponentId, sourcePortId, targetComponentId, targetPortId, value,
transitionLabel? }`. For FSM, the wire IS the transition and carries `transitionLabel` (`"X:Y"`
= input:output). UI: black wire = 0, red = 1.

**`MEM` direction.** Port ids are fixed (`mout`=left, `min`=right) but the *semantic* roles
depend on `memDirection` (`'left-to-right'` | `'right-to-left'` | undefined = undecided). Use
the helpers, never the raw port ids:
- `getMemOutputPortId(comp)` — the port that **emits** the stored value (a source).
- `getMemInputPortId(comp)` — the port that **receives** the next value (a sink).

## Bit-vector ordering (critical, shared by the engines and the codec)

When a circuit is fed a flat bit vector or read out as one:
- **Inputs** are ordered by the numeric suffix of the INPUT label: `IN1, IN2, IN3, …`.
- **Outputs** are ordered by the numeric suffix of the OUTPUT label: `OUT1, OUT2, …`.
- For a multi-bit **group** (the space axis), bits are **MSB first** within the group, and
  groups are concatenated in declaration order.

`engine/cc.ts` (`evaluateCCInputs`) and `engine/codec.ts` (`encodeInput`/`decodeOutput`, space
axis) MUST agree on this layout — if you change one, change both. The **time** axis (SC/FSM)
instead lays each value LSB-first along its own wire over time; FSM uses one bit per step (the
`n=1` time case). See `grading.md` / `pipeline/codec.md` for the codec, `sc.md` for SC.

## Topological evaluation (CC, reused by SC)

`topologicalSort(components, wires)` in `cc.ts` orders components for evaluation. Key subtlety:
**wires feeding a MEM's input (sink) port are treated as feedback and excluded** from the
graph, so MEM blocks become in-degree-0 sources (like INPUTs). This is what makes cyclic
sequential circuits evaluable as a DAG per clock cycle. `evaluateGate(type, inputs, comp?)`
computes one component's outputs.

## Module map

| File | Exports | Doc |
|------|---------|-----|
| `engine/cc.ts` | `topologicalSort`, `evaluateGate`, `evaluateBoxedCircuit`, `evaluateCC`, `evaluateCCInputs` | `cc.md` |
| `engine/sc.ts` | `evaluateSCSingleStep`, `evaluateSCSequence`, `SCSingleStepResult` | `sc.md` |
| `engine/fsm.ts` | `sortStateComponents`, `evaluateFSMSingleStep`, `evaluateFSMSequence` | `fsm.md` |
| `engine/tm.ts` | `evaluateTMSingleStep`, `evaluateTMSequence`, tape/parse helpers, `DEFAULT_TM_MAX_STEPS` | `tm.md` |
| `engine/grader.ts` | `gradeQuestion`, `gradeSubmission`, `summarizeResult` | `grading.md` |
| `engine/codec.ts` | `axisForMode`, `encodeInput`, `decodeOutput`, `outputAccepted`, `stepCountFor`, `CodecLayout` | `grading.md` + `pipeline/codec.md` |
| `engine/machineValidation.ts` | `validateMachine` (Stage 1, all modes) | `grading.md` + `pipeline/codec.md` |
| `engine/tmCodec.ts` / `tmValidate.ts` | TM tape axis (`encodeTM`/`acceptTM`/`decodeTM`) + TM Stage 1 | `tm.md` |
| `engine/testVectorGen.ts` | `generateTestCases(spec, rep)` | `grading.md` |
| `engine/formulaEval.ts` | `evalFormula`, `FormulaError` | `grading.md` + CLAUDE.md DSL section |
| `engine/representation.ts` | `valueToBits`, `isValidCodeword`, `bitsToValue`, `bitsToTally`, `bitsToBinary`, `interpretBits` | `grading.md` |
| `engine/index.ts` | barrel re-exports of the above | — |

## Unified engine interface (grader + frontend)

Every mode engine exposes the **same two-function shape**, so the **grader/codec** and the
**frontend store** drive identical logic — no mode reimplements evaluation for the UI:

- **`evaluate<Mode>SingleStep(...)`** — one step/cycle; pure; returns the next state plus per-port
  (or tape) values. The **store** (`scStep` / `fsmStep` / `tmStep`) calls this to animate run/step
  and build the history tables.
- **`evaluate<Mode>Sequence(...)`** — runs a whole input to completion; what the **grader/codec**
  calls. CC is the degenerate one-step case.

| Mode | single-step (store) | sequence (grader) | codec axis (`pipeline/codec.md`) |
|------|---------------------|-------------------|----------------------------------|
| CC | — (combinational) | `evaluateCCInputs` | space |
| SC | `evaluateSCSingleStep` | `evaluateSCSequence` | time |
| FSM | `evaluateFSMSingleStep` | `evaluateFSMSequence` | time (`n=1`) |
| TM | `evaluateTMSingleStep` | `evaluateTMSequence` | tape |

**The engines speak bits/tapes, never values.** Converting a question's numeric `TestCase` to/from
that bit/tape layout is the **codec**'s job (`engine/codec.ts` for space/time, `tmCodec.ts` for
tape — see `grading.md` and `pipeline/codec.md`), not the engine's or the store's, so the *same*
engine code serves both grading and the canvas unchanged. The codec is built: the grader runs one
`validate → encode → run → accept → decode → compare` path for all four modes.

## How the store relates to the engine

`store.ts` is a thin Zustand wrapper. `scStep` / `fsmStep` build the sorted component lists and
current values, call the engine (`evaluateSCSingleStep` / `evaluateFSMSingleStep`), then apply
the returned values back into Zustand state (components, wires, history, table rows). The
engine has no side effects; the store owns all state mutation and rendering.
