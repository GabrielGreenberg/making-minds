# TM — Turing machine engine

**File:** `app/src/engine/tm.ts` · **Status:** tape/step engine implemented, but the **semantics
below are the agreed target and the current code does not yet match them** (it hardcodes a
`{0,1}` tape, starts the head at cell 0, and reads a fixed window instead of locating an output
block — see "Implementation status"). Read `overview.md`, `fsm.md`, and `grading.md` first — a
TM here is "the FSM control graph + a tape," and reuses FSM machinery.

A Turing machine is an FSM (STATE nodes + transition wires) augmented with a two-way-infinite
read/write tape. At each step it reads the cell under the head, takes the matching transition,
and performs **one** tape action. The control half reuses `sortStateComponents` from `fsm.ts`.

## Relationship to the codec pipeline (authority: `pipeline/codec.md`)

The cross-cutting grading design lives in **`pipeline/codec.md`** (PLANNED). SC/FSM/TM are all
graded like CC — against a **machine-agnostic** bank of numeric `(x, f(x))` test cases — through
a shared **codec** (value↔bits per axis) and a split **validate → encode → run → accept → decode
→ compare** pipeline. **`codec.md` is authoritative** for the pipeline structure, the data model
(`TestCase`, required `representation`), Stage-1 machine validation, and the accept-then-decode
split. **This doc defines only the TM-specific pieces `codec.md` defers to** — the tape
representation and input layout, the output-block *format*, the TM acceptor (halt + block
well-formedness + optional standard position), and the engine itself. TM is the codec's **`tape`
axis** and adds **no** new pipeline.

Concept mapping (term used here → its home in `codec.md`):

| TM-specific here | Codec pipeline (`codec.md`) |
| --- | --- |
| machine-table validation (ambiguous / unparseable) | **Stage 1** `validateMachine`, TM row |
| `encode(notation, values) → TMTape` | **Stage 2** codec `encodeInput`, `tape` axis (delegated to TM) |
| output-block well-formedness + halt + standard position | **Stage 2** **acceptor** (mode-level, TM) |
| value decode (block → number) | **Stage 2** `decodeOutput` / `bitsToValue` (TOTAL; assumes accepted) |
| `test_case {inputs, outputs}` (numeric) | `TestCase {inputs, outputs}` |

**Accept before decode.** Per `codec.md` the acceptor checks well-formedness/halt and decoding is
**total** (assumes an accepted tape). So the TM "decode" is two things: a TM **acceptor** (halt +
exactly-one-block + optional standard position) and then a **total value decode**. Earlier drafts
of this doc folded both into one `decode` returning a `WellFormednessError`; the split below
matches the codec.

## The model — single-action transitions

Single-action / Post–Turing model (platform spec §10.3): each transition does exactly one of
move-left, move-right, or write-a-symbol — **not** the textbook combined write+move+state. A
write and a move are two separate steps.

> An earlier draft proposed a combined `read:write,move` grammar — **wrong** for this project.
> This section supersedes any such note.

## Module boundaries — keep the engine pure

Three concerns, three modules. **The engine is only the middle one.**

1. **Machine-table validation (pre-engine).** Checks the transition table is *unambiguous* and
   every label *parses*. These are **syntax errors** (below). Shared by the authoring UI and the
   grader. A valid table is a **precondition** of the engine.
2. **Engine (`tm.ts`).** Pure simulation. **Assumes an unambiguous, validated table.** Steps
   until halt or step limit and reports the final tape, final head position, halted/step-limited
   status, and history. It does **not** check ambiguity and does **not** judge whether the output
   is well-formed.
3. **Output acceptance / decoding (post-engine).** Given the final tape + head + notation,
   locates the output block(s), enforces **exactly one** (a well-formedness error otherwise),
   decodes it to a number, and — optionally — checks the head halted in standard position.

Grading composes them: validate → run engine → accept/decode → compare to `f(x)`.

This split is also what the **student UI** needs: a learner can run and step their machine
(engine + tape rendering) **without being told whether the output is well-formed** — the
acceptance module is simply not invoked in that mode.

## What it means for a TM to compute a function

A TM **computes** `x ↦ f(x)` iff, started with a representation of `x` and the head in **standard
position**, it:

1. **halts**,
2. leaves **exactly one output block**, and
3. that output block **encodes `f(x)`**.

Plus one **optional, toggleable** condition:

4. it **halts in standard position** — the head rests on the rightmost symbol of the output
   block.

Condition (4) is a run-time toggle (e.g. `requireStandardHaltPosition`). Architecturally it is
part of the **acceptance check** (it reads the engine's reported final head position); the engine
loop itself does not enforce it. Default and exact semantics TBD with the first TM assignments.

**Standard position** = the head on the **rightmost cell of the rightmost input's block** at
start (for a zero-valued unary input, the single `0` slot it occupies — see Input layout), and,
for condition 4, the rightmost cell of the output block at halt. It is content-relative, **not**
cell 0.

## Notation: alphabets, action sets, and input layout

A TM is either **unary** or **binary**; the two are **separate machines** with different
alphabets and action sets. There is **no blank symbol** — the symbol `0` is the background that
separates and surrounds blocks.

| | Tape alphabet | Action tokens | Output block |
| --- | --- | --- | --- |
| **Unary** | `0`, `1` | `R`, `L`, `0`, `1` | a contiguous run of `1`s (a stroke block); a run of **length 0 is allowed** and denotes 0 |
| **Binary** | `0`, `1`, `*` | `R`, `L`, `0`, `1`, `*` | a binary numeral **enclosed in `*`**: `*d_k…d_0*` |

So a **binary** machine *can* write `*` (its action set includes it); a unary machine cannot.
The `input` half of a transition label ranges over the machine's alphabet too (binary states may
branch on reading `*`).

**Input layout.** Inputs are blocks laid out left-to-right, **consecutive inputs separated by a
single `0`**, with background `0`s on the outside:

- Unary: a value `n > 0` is a run of `n` `1`s; a value `0` is a **single `0` cell** occupying its
  own slot. Consecutive inputs are separated by a single `0`. So with a zero-valued **rightmost**
  input: `… <input n-1> 0 0 0 …` — the three `0`s are, left to right, the separator, the
  zero-valued `input n` (its slot), then the trailing separator; the head's standard position is
  on `input n`'s slot (the middle `0`). Because the tape normalises away `0` cells, a zero input
  contributes **no stored cell** — it is carried purely by `head` + the surrounding positions.
- Binary: `…0 *…* 0 *…* 0…`. A value `0` is `*0*`.

> **Future (not now):** we may let students separate the *encoding* from the *machine* — exposing
> a single 3-symbol (`0,1,*`) machine whose encoding toggles unary/binary. For now, unary and
> binary machines are kept separate as above.

## Output well-formedness (post-engine)

When the machine halts, the acceptance module scans the final tape for output blocks under the
notation:

- **Unary:** accept **zero or one** contiguous run of `1`s. **Zero runs (a blank, all-`0` tape)
  is the valid representation of the output `0`** — nothing to locate, just note the absence of
  `1`s. **Two or more** separate runs is a well-formedness error. Value = the number of strokes
  (0 when blank).
- **Binary:** accept **exactly one** `*…*` block; zero or two-plus is a well-formedness error.
  Value = the numeral between the `*`s.
- A block decoding to `f(x)` does **not** rescue an otherwise ill-formed tape (e.g. a second
  stray block) — the machine does not compute `f`.

These checks live **outside the engine** (module 3). The engine neither produces nor validates
them.

## Machine-table validation — syntax errors (pre-engine)

Two conditions make a table **ill-formed**; both are **syntax errors** that reject the machine
(flagged in authoring, failed in grading) rather than being silently resolved:

1. **Ambiguous transitions** — two transitions out of the same state matching the **same read
   symbol**. The machine is nondeterministic. (No first-match-by-wire-order tie-break.)
2. **Unparseable label** — a `transitionLabel` that is not a valid `input:action` for the
   machine's notation.

This is a pre-engine pass; the engine assumes it has already passed.

## Representation

- **States** are `STATE` components; start state = lowest numeric subscript (`S₀`), via
  `sortStateComponents`.
- **Transitions** are wires with `transitionLabel = "input:action"`; `sourceComponentId` /
  `targetComponentId` give from/to. Valid `input`/`action` tokens are notation-dependent (table
  above).
- **Tape** — `TMTape = { cells: Record<number, TMSymbol>; head: number }`. See **Tape
  representation** below for the full design. *(Current code fixes the symbol type at `0|1` and
  starts the head at cell 0 — see Implementation status.)*

## Tape representation

**`*` never escapes the tape.** Test cases are numeric `(x, f(x))` pairs — abstract *values* (the
codec's machine-agnostic model). The `*` symbol is born in the encoder (value → standard
representation) and consumed in the decoder (tape → value), so it lives only inside the tape type
and the codec's `tape`-axis boundary. The `TestCase` bank therefore stays numeric and
**mode-agnostic** — the codec, grader, gradebook, and other engines are unaffected.

```ts
// In types.ts (the store and saved workspace reference a tape — avoid a types→engine dep).
type TMSymbol = '0' | '1' | '*';        // unary machines never use '*'
interface TMTape {
  cells: Record<number, TMSymbol>;      // sparse; an absent key reads as background '0'
  head: number;                         // absolute index; never renormalised
}
```

- **String-union symbols.** Uniform with the `input:action` label grammar (tokens are chars), so
  `read`-compare and `write` need no number↔string juggling, and `'*'` renders directly in the
  tape strip. Numeric `0/1` elsewhere is unaffected because `*` never leaves the tape.
- **Sparse, normalised to non-background.** Store only `'1'`/`'*'` cells; **writing `'0'` deletes
  the key.** Then a blank tape is `{}`, the unary-`0` check is exactly "no keys," block scans walk
  only real marks, and saved tapes stay small. JSON-clean (negative indices serialise as string
  keys).
- **Head absolute, never renormalised** — keeps history/stepping and the render window stable.
  The render window and block bounds are **derived** (`Object.keys(cells).map(Number)` → min/max,
  padded around `head`), never stored.
- **Immutability.** `applyAction` is pure: a *move* shares the `cells` ref (head changes only); a
  *write* returns a new object (`{...cells,[head]:sym}`, or clone-minus-key when writing `'0'`).
  The store needs immutable per-step snapshots anyway, so pure is the default. At ≤ `maxSteps` the
  per-write spread is fine; if it ever profiles hot, the grader may run a mutable working copy and
  snapshot only for history — without changing the public API.

### Encode / accept / decode — the codec `tape` axis

These are the TM implementation of the codec's `tape` axis + acceptor (see `codec.md` Stage 2);
they are **not** a parallel TM-only boundary, and they replace the interim `makeTape`/`readTape`:

```ts
encode(notation, values: number[]): TMTape    // codec tape-axis encodeInput → blocks + single-'0'
                                              // separators, head at standard position.
acceptTM(notation, run): TMReject | null      // acceptor: halted (not step-limited) + exactly one
                                              // well-formed output block + (optional) standard pos.
decodeTM(notation, tape): number              // TOTAL value decode; precondition: acceptTM passed.
```

The accept/decode split mirrors the codec (validity before decoding; the decode is total). The
codec delegates its `tape` axis to these because TM tape layout (blocks, separators, `*`
delimiters, standard position) is irreducibly TM-specific — `codec.md`'s generic `encodeInput`/
`decodeOutput` cover only `space`/`time`. **These live in a TM-owned helper the codec's `tape`
axis calls** (decided) — `codec.ts` stays thin and the tape mechanics stay with TM. The same
`TMTape` serves the future unified 3-symbol machine; only validation (which symbols/actions are
legal) changes.

## Engine: one step / a run

```ts
evaluateTMSingleStep(wires, currentStateId, tape): { read, action, nextStateId, tape } | null
evaluateTMSequence(components, wires, initialTape, maxSteps = DEFAULT_TM_MAX_STEPS)
  : { tape, halted, steps, hitStepLimit, history }
```

`evaluateTMSingleStep` reads under the head, takes the (unique, on a valid table) matching
transition, applies its action, and returns the next state + new tape. **`null` ⇒ halt** (no
matching transition).

`evaluateTMSequence` starts at `S₀` and steps until:

- **Halt** — returns `halted: true`. **For a TM, halting is the success precondition** — the
  inverse of FSM (where `halted` = failure). Do not pattern-match `halted`'s meaning from `fsm.ts`.
- **Step limit** — `maxSteps` reached (default `DEFAULT_TM_MAX_STEPS = 10000`); returns
  `hitStepLimit: true`. Halting is undecidable, so the bound is mandatory.

`history: TmHistoryEntry[]` (`t, stateLabel, read, action, headBefore, nextStateLabel`) — one per
step, for the (not-yet-built) status table.

## Grading (target semantics)

Grading follows the codec pipeline (`codec.md`); this section is just its TM instantiation. Each
`TestCase` is one `(x, f(x))` pair of **values**. Per case: **Stage 1** validate the table →
`encode(notation, inputs)` (head at **standard position**) → **run** to halt or step limit →
**acceptor** (halted, exactly one well-formed output block, optional standard position) → **total
decode** to a number → compare to `outputs`.

- **Notation** comes from `question.representation` (`'tally'` → unary, `'binary'` → binary);
  "representation" and "notation" are the same thing here.
- **Test cases carry values, not tape/bit encodings** — the codec's machine-agnostic model
  (CC/SC/FSM too): `TestCase.inputs` is the list of input *values* (≥ 1, for multi-input
  functions); `outputs` is `[f(x)]`.
- An ill-formed table (Stage-1 invalid) **fails every case** (0 / total) with the syntax error as
  feedback — never `skipped`.

A case passes iff the table is valid **and** the output is **accepted** (machine halted, exactly
one well-formed block, and — if the toggle is on — head in standard position) **and** the decoded
value equals `f(x)`. A rejected output and a wrong value fail identically — no partial credit, per
`codec.md`. Instructor-only feedback records the decoded `got` value or the rejection reason.

TM input is an infinite space and TM correctness is undecidable, so grading is
**correctness-by-sampling**: instructors supply representative vectors (short/long, zero-valued,
boundary cases like carry propagation). There is no exhaustive mode, and there cannot be one.

## Implementation status — where the code diverges

`tm.ts` / `grader.ts` were written to an earlier, simpler model and **must be reworked**:

| Concern | Current code | Target |
| --- | --- | --- |
| Tape alphabet | `{0,1}`, blank = 0 | notation-dependent: `{0,1}` unary, `{0,1,*}` binary |
| Action set | `{R,L,0,1}` only | `{R,L,0,1}` unary, `{R,L,0,1,*}` binary |
| Head start | cell 0 (`makeTape`) | standard position (rightmost symbol of rightmost input) |
| Output location | fixed window `readTape(tape, len)` | post-engine module locates the one block by content |
| Block-count / well-formedness | none | post-engine acceptance check (exactly one) |
| Standard-halt-position | none | optional toggle in the acceptance check |
| Ambiguous transitions | first-match by wire order (in `evaluateTMSingleStep`) | pre-engine **syntax error** |
| Unparseable label | silently skipped | pre-engine **syntax error** |
| Validation / acceptance modules | none (logic inlined in grader) | two separate modules around the engine |

`app/tools/tmCheck.ts` tests the interim cell-0 behaviour and must be updated with the rework.

## Not yet built (store + UI)

- **Store.** No `tmStep`. Mirror `fsmStep`: wrap `evaluateTMSingleStep`, hold the tape
  **immutably** (`applyAction` shares `cells` on a *move*, clones only on a *write* — never
  mutate `tape.cells` in place), append a `TmHistoryEntry` per step.
- **UI.** Tape strip (click-to-toggle cells + head marker, scrollable, §10.2), §10.5 status
  display, `input:action` validation + syntax-error reporting in the transition editor,
  `buildMode === 'TM'` in the library.
- **Authoring.** No TM path in `QuestionCreator` / `testVectorGen.ts`; samples are hand-authored.
  Generation must **sample** tapes, not enumerate.

## Module map

**Today** `tm.ts` exports: `readCell`, `makeTape`, `readTape`, `parseTMAction`,
`parseTMTransition`, `applyAction`, `evaluateTMSingleStep`, `evaluateTMSequence`,
`DEFAULT_TM_MAX_STEPS`, and types `TMAction`, `TMActionToken`, `TMTape`, `TMStepResult`,
`TMEvalResult`, `ParsedTMTransition`. `TmHistoryEntry` already lives in `types.ts`.

**After the rewrite** (see "Rewrite plan"):
- `TMTape`, `TMSymbol`, and `TMNotation` move to `types.ts` (the store + saved workspace need
  them without a types→engine dependency).
- `makeTape`/`readTape` are removed from `tm.ts`; `encode`/`decode` take their place in the new
  **input-layout** and **acceptance** modules.
- New files for the pre-engine **validation** and post-engine **acceptance/decoding** modules —
  separate from `tm.ts`, never inside it.
- `parseTMAction`/`parseTMTransition` become **notation-aware** (accept `*` only for binary).

## Rewrite plan

> **Self-contained.** A fresh session can execute this from the repo plus this doc alone. The
> engine stays framework-agnostic (no React/Zustand/DOM — see `overview.md`). There is **no test
> framework**; smoke-test with `tsx` like `app/tools/pipelineCheck.ts`. After each step run
> `cd app && npx tsx tools/tmCheck.ts`. Mirror the shapes in `app/src/engine/fsm.ts` and
> `sc.ts`, and the grader dispatch in `grader.ts`. Keep this doc in sync as the surface changes
> (CLAUDE_KB convention). Do the store/UI **later** — out of scope here.

**Settled decisions — do not re-litigate (baked in from design review):**

- **Notation = `question.representation`**: `'tally'` → unary, `'binary'` → binary. No new field;
  "representation" and "notation" are the same thing.
- **Test cases carry values** (the codec model, shared with CC/SC/FSM): `TestCase.inputs` = list
  of input *values* (≥ 1); `outputs = [f(x)]`. (`codec.md` renames `test_vectors → test_cases`.)
- **An ill-formed table fails every vector** (passed 0 / total) with the syntax error as
  feedback — never `skipped`.
- **Zero-valued unary input** occupies a single `0` slot (`… <input n-1> 0 0 0 …` = sep / the
  zero input / trailing sep); standard position is the head on that slot. It contributes no
  stored cell (tape normalises away `0`s) — see "Input layout."

**Steps** (ordered; each independently testable):

1. **Types — `app/src/types.ts`.** Add `TMSymbol = '0'|'1'|'*'`, `TMNotation = 'unary'|'binary'`,
   and `TMTape { cells: Record<number, TMSymbol>; head: number }`. (`TmHistoryEntry` is already
   here.) The engine imports these rather than defining its own.

2. **Engine core — `app/src/engine/tm.ts`.**
   - `cells: Record<number, TMSymbol>`; `readCell` returns `'0'` for absent keys.
   - `parseTMAction(token, notation)` / `parseTMTransition(label, notation)` become
     **notation-aware**: `*` is a legal input/action symbol **only** for binary.
   - `applyAction`: writing `'1'`/`'*'` sets the cell; writing `'0'` **deletes the key**
     (normalise-to-non-background); a *move* shares `cells` and shifts `head`.
   - `evaluateTMSingleStep` / `evaluateTMSequence` keep their current shapes but **assume a
     validated table** (the matching transition is unique — no first-match tie-break).
   - **Remove** `makeTape` and `readTape` (superseded by `encode`/`decode` in step 4).

   > Steps 3–5 implement the **TM slice of the codec pipeline** (`codec.md`), not a parallel
   > TM-only boundary. Coordinate names/homes with `codec.md`; if the codec rewrite lands first,
   > TM plugs into its unified `validate → encode → run → accept → decode → compare` path with no
   > new grader branch.

3. **Stage-1 validation (TM row of the codec's `validateMachine`).** Implement the TM checks —
   each state has **≤ one transition per read symbol** (ambiguous → error) and every label parses
   (`parseTMTransition(label, notation)`; unparseable → error). Return structured errors (kind +
   offending state/wire id(s) + message) for the grader and the authoring UI. Home: the codec's
   Stage-1 module (`machineValidation.ts`) or a `tmValidate` helper it calls — match `codec.md`.

4. **Codec `tape` axis + TM acceptor** (the codec delegates `tape` to TM — see "Relationship").
   - `encode(notation, values: number[]): TMTape` — input blocks left-to-right, single-`0`
     separators, head at **standard position**. Unary: value `n>0` → run of `n` `'1'`s; value `0`
     → an (unstored) single-`0` slot (a zero rightmost input leaves the head on that slot).
     Binary: value → `'*'` + binary digits + `'*'` (value 0 → `*0*`).
   - `acceptTM(notation, run): TMReject | null` — halted (not step-limited) + exactly one
     well-formed output block + (optional) standard position. Unary: 0 runs of `'1'` = value 0,
     1 run = ok, ≥2 = reject. Binary: exactly one `*…*`, else reject.
   - `decodeTM(notation, tape): number` — **total**; precondition `acceptTM` passed. Unary = run
     length (0 if blank); binary = the numeral between the `*`s.
   - Home: a TM-owned helper the codec's `tape` axis calls (decided — `codec.ts` stays thin).

5. **Grader.** TM plugs into the codec grader path: Stage-1 validate (errors → fail all cases) →
   `encode(notation, TestCase.inputs)` → `evaluateTMSequence` → `acceptTM` → `decodeTM` → compare
   to `TestCase.outputs[0]`. `CaseResult.got` records the decoded value or the rejection reason.
   If the codec rewrite hasn't landed, add an interim TM branch in `grader.ts` mirroring this
   pipeline, to be folded into the unified path later.

6. **Tests — `app/tools/tmCheck.ts`.** Rewrite for value-based vectors + notation. Cover: unary
   increment (standard position); **zero output** (blank tape decodes to 0); a **binary** example;
   an **ambiguous-transition** table (validation → all vectors fail); a **two-block** tape
   (well-formedness failure); and the **standard-halt-position** toggle.

7. **Barrel + spec — `app/src/engine/index.ts` and this doc.** Export the new modules/types;
   update the "Module map" and retire the "Implementation status" divergence rows as resolved.

**Out of scope here:** the store (`tmStep`) and UI (tape strip, §10.5 status display, label
editor) — a separate later phase (see "Not yet built").
