# Plan — Unify the question editor across CC/SC/FSM/TM

> **Status: PLANNED — NOT YET BUILT.** Session-handoff doc. Read `../engines/overview.md`,
> `../engines/grading.md`, `../pipeline/codec.md`, `../engines/tm.md`, and the DSL section of
> `CLAUDE.md` first. This plan is **self-contained** — a fresh session can execute it from the
> repo plus this doc alone. Keep it in sync as the work lands; delete it once the editor supports
> all four modes and `CLAUDE.md`'s "SC/FSM/TM authoring" line under "What's next" is cleared.

## Why

Today `instructor/QuestionCreator.tsx` only builds CC questions. Its first screen is a full mode
picker (`MODES`, lines 20–25) with SC/FSM/TM buttons disabled ("coming soon"); picking a mode is a
separate step before the real form appears. The ask: replace that gate with an ordinary dropdown
field inside one shared form, because — per the inventory below — almost nothing about the form
actually needs to differ per mode.

## What's already shared (confirmed, needs no forking)

- **`CCSpec` shape** (`types.ts:97-111`) — `inputs`/`outputs` groups of `{name, width}` (+
  `formula` on outputs) — is already mode-agnostic. Nothing about the type needs to change to
  support SC/FSM/TM; `generateTestCases`/`ccPreview` already run the same enumeration math for any
  mode (`inputValues`/`cartesian`/`evalFormula`).
- **The DSL** (`formulaEval.ts`) and the **representation toggle** (`binary`/`tally`) — identical
  everywhere; TM's tape notation *is* `representation` (`notationForRepresentation`), not a
  separate field.
- **The live preview table** (`ccPreview.ts`'s `buildPreview`) — same enumeration approach for
  every mode (with one exception below).
- **Statement, id/label assignment, save/cancel plumbing** — untouched by mode.

**Consequence for the UI**: switching the mode dropdown on a draft should **not** clear the
entered input/output groups or formulas — they're valid regardless of mode. Only the mode value
and a couple of captions/branches change.

## What differs, and what to do about each

### 1. A real bug that must be fixed before TM authoring ships

`generateTestCases` (`engine/testVectorGen.ts:43-56`) computes every output the same way:
`truncate(evalFormula(...), out.width, rep)`, i.e. `bitsToValue(valueToBits(value, width, rep),
rep)`. `valueToBits` (`engine/representation.ts:60-67`) always **masks to `width` bits** — correct
for CC (the circuit structurally can't hold more) and consistent for SC/FSM (the time-axis decode
window is also bounded to `width` steps, `pipeline/codec.md`). It is **wrong for TM**: `encodeTM`/
`decodeTM` (`engine/tmCodec.ts`) take no width parameter — the tape is unbounded — so truncating
the *stored expected value* by a declared `outputWidth` will disagree with what a genuinely correct
(unbounded) TM actually produces whenever `f(x)` exceeds that width. Documented in
`../known_bugs.md`; fixing it is Step 1 below. TM authoring must not ship without this fix.

### 2. `generateTestCases` needs to know the mode

Reuse `axisForMode(mode): Axis` (already exported from `engine/codec.ts`) rather than inventing a
new enum. New signature:

```ts
export function generateTestCases(spec: CCSpec, rep: RepSystem, mode: BuildMode): TestCase[]
```

- `axisForMode(mode) !== 'tape'` (CC/SC/FSM): behavior unchanged — `truncate(value, width, rep)`.
- `axisForMode(mode) === 'tape'` (TM): store the **raw** `evalFormula` result for outputs,
  untruncated. Input enumeration (`inputValues(width, rep)`) stays as-is for TM too — `width`
  still legitimately bounds *which* input values get tested (an authoring choice), it just must
  not also bound the stored output.

Update both call sites: `instructor/QuestionCreator.tsx:97` and `devData/sampleData.ts:184`
(thread `question.buildMode`/the selected mode through).

### 3. `ccPreview.ts`'s preview needs the same TM branch, for the same reason

`buildPreview` (`ccPreview.ts:130-139`) builds each output cell via `valueToBits(result, g.width,
rep)` — same width-masking problem, this time in the live preview an instructor sees while
authoring. Needs a `mode` parameter threaded in from `QuestionCreator`, with a TM branch that does
not width-truncate.

Beyond truncation, TM's *display* is a bigger mismatch than CC/SC/FSM's: a fixed-width `bits: number[]`
array doesn't represent what's actually on the tape (unary has no padding — it's exactly `n` ones;
binary has no padding either, plus a `*`-delimited alphabet `valueToBits` doesn't produce at all).
Recommended approach: add a small TM-only formatter (e.g. `formatTMValue(value, notation): string`
— `'1'.repeat(n)` for unary, `value.toString(2)` for binary, mirroring what `encodeTM` actually
writes) and extend `PreviewCellInput`/`PreviewCellOutput` with an optional string-display field
used instead of `bits` when `mode === 'TM'`. Exact field naming is an implementation call, not
fixed by this plan — the requirement is: **TM preview cells show the natural (unpadded) tape
encoding, not a fixed-width bit vector**, for both inputs and outputs.

### 4. Width means something different per mode — caption it, don't hide it

| Mode | What `width` actually bounds | Suggested caption |
|------|-------------------------------|--------------------|
| CC | Structural — the circuit has exactly this many wires; Stage-1 validation enforces it (`machineValidation.ts`). | "width (input/output wires)" |
| SC/FSM | Not structural (Stage 1 doesn't check wire count against it for SC, and FSM has no wire-count check at all) — it's the time-axis step count the codec runs, so it bounds how large a test value gets serialized. A valid FSM must be total over `{0,1}` at every state (`../engines/tm.md`'s Stage-1 table), i.e. it must handle input streams of **any** length — `width` is not a capacity of the machine, only how large a value this question happens to test. See "Open design question" below. | "width (time steps to test)" |
| TM | Not structural at all (`encodeTM`/`decodeTM` take no width). Bounds only which input values get enumerated at authoring time; must **not** bound the stored/displayed output (§1–3 above). | "width (max input value to test)" — and arguably no output-width field is even needed for TM once §2/§3 land (see open item below). |

Add a small `Record<BuildMode, string>` caption map in `QuestionCreator.tsx` and swap the "width"
label text based on the selected mode. Optionally, a one-line caveat under the Input/Output groups
section head for SC/FSM/TM, surfacing the "this doesn't bound what the machine can actually do"
point to instructors — cheap, and honest about the current model's limits.

**Open item, not resolved by this plan**: since TM's output isn't width-bounded at all, does the
output group even need a `width` field for TM? Two options: (a) keep it, but stop using it for
anything except a "typical output size" hint; (b) drop the requirement that TM output groups
declare a width (make it optional / ignored). Deferred to whoever picks this up — flag it in the
PR/commit, don't silently decide.

### 5. TM's `requireStandardHaltPosition` toggle — new field, **optional/deferred**

`tmCodec.ts`'s `acceptTM` supports `AcceptOptions.requireStandardHaltPosition`, but nothing sets it
today — `grader.ts:170` calls `acceptTM(notation, run)` with no options, so it's always off. If TM
authoring should expose this, it needs: a new optional field (e.g. on `AssignmentQuestion`, not
`CCSpec` — it's an acceptance option, not an I/O shape), `grader.ts` reading it and passing it
through, and a TM-only checkbox in the editor. **Not required** for the initial unification; call
out as a follow-up once TM questions are actually being authored and the semantics are settled
("TBD with the first TM assignments" per `../engines/tm.md`).

### 6. `allowed_components` — mode-filtered list, **optional/deferred**

Already an optional field on `AssignmentQuestion` (`types.ts:134`), unused by every sample
question today. If exposed, its *options* would be mode-specific (CC: NOT/AND/OR/XOR/HA/BOXED; SC:
+MEM; FSM/TM: N/A — transitions are the content, not a component palette) but the field itself
needs no per-mode plumbing beyond a mode-filtered options list. Not required for this plan; skip
unless asked.

## Step-by-step

1. **Fix the TM truncation bug** (`engine/testVectorGen.ts`): add the `mode: BuildMode` parameter,
   branch on `axisForMode(mode) === 'tape'` to skip output truncation. Update both call sites
   (`QuestionCreator.tsx`, `sampleData.ts`). Run `cd app && npx tsx tools/tmCheck.ts` and
   `pipelineCheck.ts` after.
2. **Fix the TM preview** (`instructor/ccPreview.ts`): thread `mode` into `buildPreview`, add the
   TM-only unpadded-display path for both input and output cells.
3. **Restructure `QuestionCreator.tsx`**:
   - Delete the `mode == null` full-screen gate (lines 61–86). New questions default to a mode
     (e.g. `'CC'`); existing questions keep `existingQuestion.buildMode`.
   - Replace the `MODES` button-group concept with an inline `<select>` (or small button-group,
     matching existing `instructor-encoding-toggle` styling used for `RepToggle`) placed near the
     Representation control, all four modes enabled.
   - Swap the hardcoded `buildMode: 'CC'` in `handleSave` (line 110) for the selected mode; pass
     `mode` into `generateTestCases`.
   - Add the width-caption map (§4) and swap labels in the Input/Output group rows (currently
     hardcoded `width` text at lines 151 and 194).
   - Confirm changing the mode dropdown does **not** reset `inputs`/`outputs`/`statement` state —
     this is the entire point of the shared-shape design; verify no `useEffect` accidentally
     clears them on mode change.
4. **Manual QA**: in the running app, author one question per mode (SC/FSM/TM in addition to CC),
   save, then run `cd app && npx tsx tools/grade.ts` (or `pipelineCheck.ts`) against a hand-built
   correct/incorrect circuit for each to confirm the generated `test_cases` grade sensibly. TM
   needs a real circuit in the canvas to test against — the store/UI for TM (`tmStep`, tape strip)
   is a separate, not-yet-built prerequisite (`../plans/tm-store.md`); until that lands, TM
   authoring can be validated headlessly (generate `test_cases`, feed them through
   `engine/grader.ts` against a hand-written TM circuit fixture) even though there's no canvas yet
   to build that circuit interactively.
5. **Docs**: once shipped, update `CLAUDE.md`'s "SC/FSM/TM authoring" bullet (Part 1, "What's
   next") and the DSL section ("Today CC only in the UI"), `../instructor/frontend.md` if it
   describes `QuestionCreator` as CC-only, and delete this plan file. Resolve/annotate the two
   entries in `../known_bugs.md` this plan addresses.

## Open design question carried forward, not solved here

Whether `width` should mean anything at all for FSM/SC input/output groups — since a valid FSM
must handle input streams of arbitrary length by construction (Stage-1 totality), `width` there is
only "how large a value this question happens to test," not a capacity of the machine, unlike CC.
This doesn't block shipping the unified editor (generation and grading stay internally consistent
for SC/FSM — see `../known_bugs.md`), but it means exhaustive testing up to a declared width isn't
the same completeness guarantee it is for CC. This plan ships with the caption/caveat from §4 and
defers any deeper rework (e.g. a different authoring model for streaming machines) to a future
decision.

## Non-goals

- Resolving the FSM/SC width question architecturally (caveat text only, see above).
- `requireStandardHaltPosition` UI (§5) and `allowed_components` UI (§6) — both optional, deferred.
- The TM store/UI (`tmStep`, tape strip) — separate work, see `../plans/tm-store.md`.
- Any change to the `test_cases` bank shape (`TestCase {inputs, outputs}`) — unaffected by this plan.
