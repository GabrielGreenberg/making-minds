# SC — Sequential circuits engine

**File:** `app/src/engine/sc.ts` · **Status:** implemented. Builds directly on the CC engine
(imports `topologicalSort` and `evaluateGate` from `cc.ts`). Read `overview.md` and `cc.md`
first.

A sequential circuit is a combinatorial circuit plus **MEM blocks** (1-bit memory cells) and a
clock. State lives in the MEM blocks; each clock cycle reads the current state + inputs and
produces outputs + the next state.

## One clock cycle: `evaluateSCSingleStep`

```ts
evaluateSCSingleStep(
  components, wires,
  inputBitVector: number[],     // this cycle's inputs, ordered IN1, IN2, …
  sortedInputs, sortedOutputs, sortedMems,  // pre-sorted component lists
  memStoredValues: number[],    // current state, parallel to sortedMems
): { outputBits, newMemValues, portValues }
```

Cycle algorithm:
1. Inject this cycle's input values and the current `memStoredValues` into a component snapshot.
2. **Seed every MEM's output port** (`getMemOutputPortId`) with its stored value — MEM feeds
   its state *into* the circuit at the start of the cycle.
3. `topologicalSort` the snapshot. Because wires into a MEM's input port are excluded as
   feedback (see `overview.md`), the otherwise-cyclic circuit sorts as a DAG, with MEM blocks
   acting as in-degree-0 sources.
4. Propagate exactly like CC (`evaluateGate` per component).
5. Read `outputBits` off the OUTPUT components (ordered OUT1, OUT2, …).
6. Compute `newMemValues`: for each MEM, the value arriving on its input port
   (`getMemInputPortId`) this cycle. This becomes the stored state for the *next* cycle.

The caller (store) provides the pre-sorted lists and current MEM values and applies
`portValues` back to the canvas; the function itself is side-effect-free.

## Running a sequence: `evaluateSCSequence`

```ts
evaluateSCSequence(components, wires, inputSteps: number[][], initialMemValues?): number[][]
```

This is what the grader calls. It sorts the INPUT/OUTPUT/MEM components once, then loops over
`inputSteps` (one input bit-vector per time step), threading `newMemValues` from each step into
the next. Returns one output bit-vector per step.

- **Sorting:** inputs by `IN` suffix, outputs by `OUT` suffix, MEMs by the digits in their
  label (`label.replace(/\D/g, '')`).
- **Initial state:** `initialMemValues` (parallel to sorted MEMs) or each MEM's `storedValue`,
  defaulting to **0**. All memory initialises to 0 per the course model.

## Timing / display conventions (UI, not engine)

In the SC time-step table, **time flows right-to-left**: t1 is on the right, later steps extend
leftward. The engine returns steps in chronological order (index 0 = first step); the table
rendering reverses for display.

## Grading & the test-vector format

The grader (`grader.ts`) stores SC test vectors as **flat** arrays and chunks them with
`parseSCTestVector(inputSequence, expectedOutput, numInputs, numOutputs)`:
- `numInputs` / `numOutputs` are **inferred from the submitted circuit's** INPUT / OUTPUT
  component counts.
- The flat `input_sequence` is sliced into `numInputs`-wide steps; `expected_output` into
  `numOutputs`-wide steps. `got` and `expected` are compared after `.flat()`.

This adapter is the **fragile seam**: it assumes the flat encoding matches the circuit's port
counts. If a circuit has a different number of INPUTs than the vector was generated for, the
chunking silently misaligns. Check this adapter first when SC grading looks wrong.

## Working-on notes

- There is no SC authoring in `QuestionCreator` yet — SC sample assignments are built directly
  in `app/src/devData/` (vectors generated from a known-correct circuit via
  `evaluateSCSequence`). The DSL/`testVectorGen` path is CC-only.
- MEM `memDirection` may be undecided in freshly-placed blocks; the helpers treat undecided
  ports as both-capable. Grading assumes a decided, well-formed circuit.
- Keep clock/state logic here; never push it down into `cc.ts`.
