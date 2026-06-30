# Codec & function-grading pipeline

> **Status: BUILT.** All four modes (CC/SC/FSM/TM) grade through this pipeline. The space/time
> codec is `engine/codec.ts`; Stage-1 validation is `engine/machineValidation.ts`; the tape axis
> is delegated to `engine/tmCodec.ts` (+ `tmValidate.ts`). `engine/testVectorGen.ts` generates
> numeric `test_cases`; `engine/grader.ts` runs the single
> `validate → encode → run → accept → decode → compare` path. Headless checks:
> `app/tools/codecCheck.ts` (codec + rep core), `pipelineCheck.ts` (CC/SC/FSM end-to-end),
> `tmCheck.ts` (TM). The bit-based `test_vectors` and per-mode adapters are **gone**. See
> `engines/grading.md` for the as-built summary; the design rationale below remains the
> authority for *why* it is shaped this way.
>
> **What differs from the original plan (below):** `RepSystem` keeps `'plus'` (a display-only
> value in the DataTable toggle); the codec treats anything non-`tally` as binary, so grading
> rep is effectively `binary | tally`. `CCEncoding` and per-group `encoding` were removed in
> favour of one question-level `representation`; widths now live on `cc_spec` and the codec reads
> them. `CaseResult` kept its `got: number[]` field (empty `[]` on rejection) plus a `reason`,
> rather than a separate `got`/reason union.

Read `engines/grading.md` (current state), `engines/overview.md` (bit layout), and the DSL
section of `CLAUDE.md` first.

## The core idea

SCs and FSMs (and TMs) are graded **like CCs**: they implement a mathematical function `f`. A
machine implements `f` if, given a representation of input value `x`, it yields a representation
of `f(x)`. So one **machine-agnostic** testcase bank — numeric `(x, f(x))` pairs from the DSL —
grades every mode. The only per-mode knowledge is **how a number maps to/from that mode's bits
over wires/time/tape**, and that lives entirely in the **codec**.

Consequence: testcases store **numbers, not bits**. Bits exist only transiently at grade time.

## The pipeline

```
SUBMISSION → machine (CC / SC / FSM / TM)

1. MACHINE VALIDATION   (static, once per question)
     · interface:        I/O shape matches the reference widths
     · well-definedness: FSM/TM transition function total + deterministic
     → invalid ⇒ FAIL QUESTION (skip testing)

2. TESTING              (per numeric testcase x / f(x))
     encode   x → bits          codec.encodeInput      (rep + axis)
     run      engine(machine, bits) → rawOut | failure (halt/timeout)
     accept   rawOut ok?         acceptor              (TM format + tally codeword validity)
                → reject ⇒ case FAILS (record reason)
     decode   bits → number      codec.decodeOutput → bitsToValue   (TOTAL; assumes accepted)
     compare  number == f(x) ?   value equality
```

Scoring is **all-or-nothing at the question level**: a question passes iff the machine is valid
**and every testcase passes**. A testcase passes iff its output is **accepted** and decodes to
`f(x)`. There is **no partial credit** — implementing `f` means getting *every* input right, so
a rejected output and a wrong value fail a testcase identically. A Stage-1-invalid machine fails
outright with no testing.

The grader still **records every failing testcase** — but for the **instructor only; students
never see failed cases**. Per failing case: input `x`, expected `f(x)`, and either the decoded
`got` value or a **rejection reason** (malformed output / no halt) when the output couldn't be
decoded.

Separation of concerns still holds: **validity is checked before decoding; `bitsToValue` is
total and never sees invalid input.**

## Stage 1 — machine validation

Per mode (`validateMachine(circuit, mode, layout)`):

| Mode | interface check | well-definedness |
|------|-----------------|------------------|
| CC | `#INPUT == Σ inputWidths`, `#OUTPUT == Σ outputWidths` | — |
| SC | `#INPUT == #args`, `#OUTPUT == #outputs` (one wire per value) | — |
| FSM | none (single implicit channel) | every STATE has exactly one transition per input bit `{0,1}` (total + deterministic; precludes mid-run halt) |
| TM | tape alphabet ok | each state ≤ one transition per read symbol; labels parse per `engines/tm.md` grammar |

Note: for the **time** (SC/FSM) and **tape** (TM) axes the per-value **bit width is question-
driven** (= step count / tape length), not inferable from the circuit — only the wire counts are
structural. The width-mismatch check therefore only bites on the spatial dimension.

## Stage 2 — codec (`engine/codec.ts`, new)

Engine-agnostic, pure (no React/Zustand/DOM). Knows nothing about MEM/state/tape mechanics —
only how to lay a number's bits along an axis.

```ts
type Axis = 'space' | 'time' | 'tape';
interface CodecLayout { axis: Axis; rep: RepSystem; inputWidths: number[]; outputWidths: number[] }

axisForMode(mode): Axis                                  // CC→space, SC/FSM→time, TM→tape
encodeInput(values: number[], layout): EncodedInput
decodeOutput(raw: EncodedOutput, layout): number[]       // TOTAL; precondition: acceptor passed
```

Axis behaviour:
- **space (CC):** one step; each value's bits across wires **MSB-first**; concat in declaration
  order. Decode = slice output wire-vector by `outputWidths`, decode each.
- **time (SC/FSM):** grid `[step][wire]`, **LSB-first**, `stepCount = max(...inWidths,
  ...outWidths)`. Each input value LSB-first on its wire for its width, then **0-padded** (drain
  steps let carry propagate). Decode each output wire's step-series LSB-first over its width. FSM
  = the `n=1` case; the grader flattens the single wire to the FSM engine's `inputBits`.
- **tape (TM):** the codec **delegates** this axis to a TM-owned helper — the space/time
  bit-laying logic does not apply. Encode lays the input *values* out as a `TMTape` with the head
  in **standard position**; decode reads the single output block back to a number. The tape
  layout, output-block format, and acceptor are **TM-specific — see `engines/tm.md`**. (Time is
  internal computation, not an I/O axis.)

Why LSB-first in time but MSB-first in space: the SC/FSM table runs right-to-left (t1 on the
right), so LSB-at-t1 renders as a normal MSB-left numeral; it also matches serial-carry
arithmetic. Sanity check: a 1-step delay register on the time axis decodes to `2x` — and `2 * x`
is a legal DSL formula, so the model closes on itself. Space stays MSB-first to match the
existing "IN1 is MSB" A/V convention. **Zero-latency Mealy**: output at step `t` reflects inputs
`1..t` (both engines already model this); no latency parameter.

## Stage 2 — rep core (`engine/representation.ts`, extended)

Number ↔ bits, with validity split out from decoding:

```ts
valueToBits(n, width, rep): number[]      // binary MSB-first | tally (n ones then zeros)
isValidCodeword(bits, rep): boolean       // tally: 1s-then-0s; binary: always true
bitsToValue(bits, rep): number            // TOTAL; precondition isValidCodeword
```

Supersedes `encodeBits`/`decodeBits(+encoding)` and folds in `bitsToBinary`/`bitsToTally`. The
binary-encode width truncation remains the **implicit modulus** the DSL relies on.

## Stage 2 — acceptor

Composes two checks; reject ⇒ question-level fail:
- **mode-level:** TM only — did it halt within the step bound with **exactly one well-formed
  output block** (and, optionally, the head in standard position), in the format defined in
  `engines/tm.md`? CC/SC always accept (engine always returns bits). FSM always accepts *because*
  Stage 1 enforced totality (it can't halt mid-run).
- **rep-level:** `isValidCodeword(rawOut, rep)` — a tally output `101` is rejected, not decoded.

## Test-case generation (`engine/testVectorGen.ts`, generalized)

```ts
generateTestCases(spec: CCSpec, rep: RepSystem): TestCase[]
```
Enumerate input tuples (binary `0..2ʷ−1`, tally `0..w`), eval DSL formulas, store **numbers**.
The `encodeBits` step is **removed** — mode never enters generation. (TMs sample rather than
enumerate; see `engines/tm.md` — same numeric `TestCase` shape.)

## Data-model changes (`types.ts`)

```ts
interface TestCase { inputs: number[]; outputs: number[] }      // values, one per group

interface AssignmentQuestion {
  representation: RepSystem;     // now REQUIRED + authoritative for grading
  test_cases?: TestCase[];       // renamed from test_vectors; numeric (was bit arrays)
  // REMOVED: grading_mode (everything is enumerate-or-sample now)
  // ...
}
```
- Drop per-group `encoding` from `CCInputGroup`/`CCOutputGroup`; rep is one value per question.
- Converge representation vocabulary on `RepSystem` (`binary` | `tally`); retire `CCEncoding`'s
  `'unary'` (≡ `tally`) and the unimplemented `'plus'`.
- The **submission** still carries a `repSystem` (`viewPreferences`, the DataTable toggle) — that
  is **display-only** and the grader must NOT read it. Grading rep comes from the question.
- `CaseResult` is **value-oriented and instructor-only** (students never see failed cases): per
  failing case record `input` (x), `expected` (f(x)), and either the decoded `got` value or a
  rejection reason (malformed / no-halt). **Values only — no raw bits.**

## Integration / blast radius

| File | Change |
|------|--------|
| `types.ts` | `TestCase`, rename `test_vectors`→`test_cases`, require `representation`, drop `grading_mode` + per-group `encoding` |
| `engine/representation.ts` | add `valueToBits` / `isValidCodeword` / total `bitsToValue` |
| `engine/codec.ts` *(new)* | axes; `encodeInput` / `decodeOutput` / `axisForMode` |
| `engine/testVectorGen.ts` | `generateTestCases(spec, rep)`; drop `encodeBits` |
| `engine/grader.ts` | rewrite: validate → encode → run → accept → decode → compare; delete `parseSC/FSMTestVector`; one path replaces the three branches |
| `engine/machineValidation.ts` *(new, or fold into grader)* | Stage 1 checks |
| `instructor/QuestionCreator.tsx`, `ccPreview.ts` | one question-level rep selector (replaces per-group toggles); numeric preview |
| `instructor/ccSummary.ts`, `tools/pipelineCheck.ts` | `test_cases` rename (one-liners) |
| `devData/sampleData.ts` | **re-seed**, not migrate: delete the `scExpected`/`fsmExpected` reference-machine helpers and hand-built bit vectors; regenerate from DSL formulas + rep |

## Tests (headless, pure)

- rep-core round-trips: binary, tally, `isValidCodeword` rejects `101` tally;
- space encode/decode reproduces today's CC bit layout exactly (regression guard);
- **time-axis consistency:** a 1-step delay decodes to `2x` (pins LSB-first + drain);
- tape round-trip against a `bits→bits` stub engine (codec testable before real TM engine).

## Sequencing

1. rep core + codec (`space`/`time`) + unit tests.
2. `generateTestCases` + `ccPreview` + types rename + drop `grading_mode`.
3. grader rewrite + machine validation + acceptor; re-seed; run `pipelineCheck`.
4. QuestionCreator rep selector; SC/FSM authoring (same form, pick mode + rep).
5. `tape` axis against stub; the real `engine/tm.ts` plugs into the codec's **`tape`-axis
   delegation** (a TM-owned encode/accept/decode helper — `engines/tm.md`) with **no change to the
   space/time codec**.

## Out of scope

- Bit-exact / representation-as-target grading (everything is value-equality for now).
- `'plus'` representation (junk; ignored).
- The TM engine and its tape encode/accept/decode (`engines/tm.md`, separate work) — the codec
  defines only the `tape`-axis **delegation seam**, not the tape format.
