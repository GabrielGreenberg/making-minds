# CC — Combinatorial circuits engine

**File:** `app/src/engine/cc.ts` · **Status:** implemented, powers both the live canvas and the
grader. Read `overview.md` first.

A combinatorial circuit is an acyclic network of logic gates with no memory. Output is a pure
function of the current inputs; propagation is **instantaneous** (no clock).

## Evaluation model

1. `topologicalSort(components, wires)` orders components so every component is evaluated after
   its inputs. (MEM input wires are excluded as feedback — see `overview.md`; in a pure CC
   there are no MEM blocks, but the same sort is reused by SC.)
2. INPUT components seed their `out` port with `value`.
3. Each non-input component gathers its left-port inputs from the wires feeding it, then
   `evaluateGate` computes its right-port outputs.
4. OUTPUT components record the bit on their `in` port.

### Undefined / blank propagation

`value` on an INPUT may be `undefined` (blank, not 0). Semantics, preserved from the original
store implementation:
- A blank input propagates as `undefined` through gates: **any** undefined gate input ⇒ all
  that gate's outputs are `undefined`.
- An OUTPUT port is set **only when it is actually wired**; an unwired OUTPUT stays absent.
- The caller decides how to render absence. The store maps absent wire values to a `-1`
  sentinel for display.

`evaluateCC` returns `CCEvalResult = { portValues: Map<"compId:portId", number|undefined>,
wireValues: Map<wireId, number> }`. Only wires carrying a defined value appear in `wireValues`.

## Gate semantics (`evaluateGate`)

| Type | Output |
|------|--------|
| `NOT` | `in === 0 ? 1 : 0` |
| `AND` | `in1 === 1 && in2 === 1` |
| `OR`  | `in1 === 1 \|\| in2 === 1` |
| `XOR` | `in1 !== in2` |
| `HA`  | `[sum = in1 !== in2, carry = in1 && in2]` |
| `INPUT` / `OUTPUT` | pass-through (`inputs[0] ?? 0`) |
| `BOXED` | `evaluateBoxedCircuit(comp, inputs)` |

**Gotcha:** `AND`/`OR`/`XOR` are strictly 2-input. There is no n-ary gate; wider fan-in must be
built from a tree of 2-input gates.

## Boxed circuits (`evaluateBoxedCircuit`)

A `BOXED` component carries an `internalCircuit: CircuitData`. To evaluate it:
- Its internal INPUT components are sorted by the numeric suffix of their label (`IN0`, `IN1`,
  …) and bound to the external input bits in that order.
- The internal circuit is topologically sorted and evaluated exactly like a top-level CC.
- Internal OUTPUT components (sorted by `OUT` suffix) become the box's outputs.
- Nesting works: a boxed circuit may contain boxed circuits (recursion through `evaluateGate`).

Built-in boxes referenced by the course: XOR and Half-Adder (HA is also a first-class gate).

## The grading primitive: `evaluateCCInputs`

```ts
evaluateCCInputs(components, wires, inputBits: number[]): number[]
```

This is what the grader calls. It sets INPUT values from `inputBits` (ordered by IN-label),
evaluates, and returns OUTPUT bits (ordered by OUT-label). It is **non-mutating** — it shallow-
copies components to carry the input values, leaving the caller's arrays untouched. The
input/output ordering matches the canvas exactly (see `overview.md` bit ordering).

## Working-on notes

- Changing the bit ordering here means changing the codec's `space` axis (`engine/codec.ts`,
  `encodeInput`/`decodeOutput`) in lockstep, or CC grading will silently mis-decode. CC is the
  codec's `space` axis: values → wires MSB-first, groups concatenated in declaration order.
- If you add a new gate type: extend `ComponentType` + `getPortsForType` in `types.ts`, add a
  case to `evaluateGate`, and decide its undefined-propagation behaviour.
- This engine is the dependency floor: `sc.ts` imports `topologicalSort` and `evaluateGate`
  from here. Keep it free of clock/state concepts.
