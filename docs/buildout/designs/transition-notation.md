# Transition-Notation Module: Seam First, Migrate Next
_Status: accepted · 2026-07-06 · Task: P1.12 (family owner: P2.1)_

## 1. Problem family, and why now

Four transition-label grammars live as scattered string conventions: **FSM** `0:1`
(regex `^[01]:[01]$` hardcoded in `engine/fsm.ts:43`, `engine/machineValidation.ts:34-39`,
the CircuitCanvas label editor's token arrays, `store.setTransitionLabel` (store.ts:3016-3040),
and `addWire`'s default label (store.ts:990)); **TM dual-action** `1:0R`
(`parseTMTransition`/`parseTMAction` in `engine/tm.ts` + `tmValidate.ts`); **turbot-TM
internal** `0:1`/`1:L` and **external** `E:↑` (`validateTurbotTM` in `engine/turbot.ts`,
per-state-kind).

Why now (P1.12): (a) hw4-p11 `x+y` needs FSM **2-bit input symbols** (`xy:o`, alphabet
00/01/10/11, symbol char order = `cc_spec.inputs` declaration order = codec wire order);
(b) hw4-p12–14 turbot navigation needs FSM **2-bit output symbols** (motor 11=F/00=S/10=R/01=L,
hw4.pdf p188 — `runBrainStep`'s 1-bit Mealy output can't express turns); (c) a **silent-misgrading
footgun**: `grader.ts:140` feeds `enc.steps.map(s => s[0])` — wire 0 only — so a 2-input FSM
question authors fine and grades wrong with no error. Its UI twin is `store.ts:3088`
(`codecSteps[tIdx]?.[0]`): the student-visible run flattens identically. Ahead: **P2.1** migrates
TM notation to a two-output form (write, move) — the one deliberate textbook departure.

## 2. Decision

**Introduce one framework-agnostic module, `app/src/engine/notation.ts`, owning transition-label
SYNTAX (parse / format / input alphabet / editor token fields / default label) — and implement
only the FSM notation (k-bit capable) through it now.** TM and turbot-TM keep their existing
parsers untouched; ~20-line adapters DELEGATE to them (no grammar duplicated). The one
cross-grammar consumer adopting the seam for all four notations immediately is the label editor's
token lists (a provenance swap: same tokens, new source) — the seam is load-bearing from day one,
not decorative. Semantics (what an output token *means*) stay per-engine; unifying semantics
across four different machines would be false generality. P2.1 then becomes a notation swap, not
a scatter-edit.

```ts
// app/src/engine/notation.ts — no React/Zustand/DOM
export interface ParsedTransition { input: string; outputs: string[] } // '10' → ['1'] | ['0','R'] | ['↑']
export interface OutputField { name: string; tokens: string[]; width: number }
export interface TransitionNotation {
  id: 'fsm' | 'tm-dual' | 'turbot-fsm' | 'turbot-internal' | 'turbot-external';
  inputAlphabet: string[];      // FULL enumeration — drives totality validation AND editor tokens
  inputWidth: number;
  outputFields: OutputField[];  // FSM: 1; TM dual: [write, move] (mirrors editor's rightSubField)
  defaultLabel: string;
  parse(label: string | undefined): ParsedTransition | null;  // null = malformed
  format(t: ParsedTransition): string;  // canonical string; Wire.transitionLabel stays a plain string
}
export function fsmNotation(inBits: number, outBits: number): TransitionNotation;
//   fsmNotation(1,1).parse ≡ legacy ^[01]:[01]$, byte-for-byte. Symbol char i = input group i.
export const turbotFsmNotation: TransitionNotation;  // fsmNotation(1,2) + legacy widening '1'→'11', '0'→'00'
export function tmDualNotation(n: TMNotation): TransitionNotation;  // wraps parseTMTransition
export const turbotInternalNotation: TransitionNotation;            // wraps parseTurbotInternalLabel
export const turbotExternalNotation: TransitionNotation;            // wraps parseTurbotExternalLabel
export function validateTransitionTable(states, wires,
  notationFor: (source: CircuitComponent) => TransitionNotation,   // per-source-state (turbot-TM kinds fit later)
  mode: 'total' | 'at-most-one'): TableError[];
```

**Decided now, binding on P2.1 (stored-form contract):** `tmDualNotation.outputFields` stay
`[write, move]`; P2.1's parse accepts the old `1:0R` concatenation **forever**; `format` emits
the canonical new form. The seam's fit for its second client is a contract, not a prediction.
**Legacy-alias decay:** because `format` is canonical, every edit-save re-emits the canonical
form — the turbot-FSM `'1'→'11'` widening (and later old TM labels) decays out of stored machines
instead of living as a permanent dialect. **One validity function per grammar:** `turbotFsmNotation`
is the single answer to "is this turbot-FSM label legal" for grader AND store, with a pin.

## 3. Slice plan

**This iteration (P1.12) — four commits, each independently green and revertible:**
1. **Seam:** `notation.ts` + `tools/notationCheck.ts`, consumed by nothing. Pins: adapters ≡
   engine parsers (exhaustive label corpora incl. malformed); `fsmNotation(1,1)` ≡ legacy regex.
2. **Engine flip:** `fsm.ts` gains `evaluateFSMSymbolStep/Sequence` (match on
   `parse(label).input === inputSymbol`); legacy `evaluateFSMSingleStep/Sequence` become
   `fsmNotation(1,1)` wrappers, signatures unchanged. `machineValidation.ts` FSM branch →
   `validateTransitionTable(..., 'total')` over 2^kIn symbols; delete `fsmInputBit`; explicit cap
   `kIn > 3 → { ok:false }` (nothing silently degrades). `grader.ts:138-143` feeds
   `enc.steps.map(s => s.join(''))`. **Footgun dies twice** (grader feed + Stage-1 arity totality).
3. **Store/UI flip:** store FSM question-run feed joins the full row (kills the store.ts:3088
   twin); `setTransitionLabel`'s three regex branches → `isValidLabel(selectWireNotation(...))`;
   `addWire` default → `notation.defaultLabel` (a 2-input FSM wire defaults `'00:0'`, not `'0:0'`).
   Editor: token lists for all four grammars read from notation objects (same tokens for TM/turbot
   — provenance only); FSM entry becomes width-driven multi-char, reusing the proven TM
   sub-field precedent. Turbot-FSM 2-bit *output* tokens stay OFF until slice 3 flips
   `runBrainStep` — the editor never accepts labels the engine can't execute.
4. **Payload:** hw4-p11 fixture (hand-placed `fsmControlPt` per arc via `builder.ts transition()`'s
   `Partial<Wire>`), coverage row, docs. **Acceptance:** memo written; hw4-p11 builds + verifies
   (33/56); 2-input FSM can't silently mis-grade; all gates green.

**Slice 2 (P2.1, deferred):** swap `tmDualNotation`'s parse/format to two-output; migrate
`tm.ts`/`tmValidate.ts` off `parseTMTransition`; fold `validateTMTable` onto the generic walker;
fixture-label rewrite; VISUAL_VOCAB + spec §10.3; dev-mode assert `format(parse(l)) === l` after
label writes. Acceptance: tmCheck/coverage green under new labels; old `1:0R` still parses.

**Slice 3 (turbot adoption, with hw4-p12–14):** `runBrainStep` decodes the 2-bit motor from
`turbotFsmNotation`; fold `validateTurbotTM`'s grammar walk onto `validateTransitionTable`;
pin that store and grader validate turbot-FSM brains through the SAME function; one-shot devData
normalization pass; **budget the vocabulary work** — the Map glossary, VISUAL_VOCAB, and the
DataTable turbot machine-table legend all currently describe FSM brains as stop/forward-only and
must gain the 2-bit motor vocabulary. Acceptance: hw4-p12–14 fixtures verify; turbotCheck green.

## 4. Compatibility contract (must never break)

- `Wire.transitionLabel` stays a plain string. **No stored-format change; no fixture/devData/
  localStorage migration this slice.**
- `parseTMTransition`, `parseTurbotInternalLabel/ExternalLabel`, `validateTMTable`,
  `validateTurbotTM`, and every TM/turbot evaluation path: **not edited** this iteration.
- All existing single-bit FSM labels (`'0:1'`) remain valid forever — `fsmNotation(1,1)` is
  byte-compatible with the legacy regex; k=1 editor paths degrade to today's exact behavior.
- Gates green after **every** commit: scWindowCheck (45), tmCheck, turbotCheck, pipelineCheck,
  coverageCheck (31 verified rows incl. 8 FSM fixtures with `0:1` labels).
- Sandbox FSM feed direction is deliberately **unchanged** (see Risks: P1.10).

## 5. Test plan

Existing pins: the five check suites above. New (`notationCheck`, in `npm run check`):
- Adapter ≡ parser equivalence for tm-dual / turbot-internal / turbot-external; `fsmNotation(1,1)`
  ≡ legacy regex; k=2 parse/format round-trips; `turbotFsmNotation` widening (`'1:1'` still means
  forward).
- **Bit-order pin (asymmetric):** end-to-end grade of a tiny 2-input FSM computing an asymmetric
  function (`x + 2*y`-style) so a swapped symbol join misgrades. hw4-p11's `x+y` is symmetric —
  blind to exactly this defect — so it cannot serve as the pin.
- Totality/arity errors, with the student's mistake named: *"transition '0:1' has a 1-bit input
  symbol; this question has 2 input wires."*
- **Grep gate:** a check asserting raw `transitionLabel` string-dissection occurs only inside
  `notation.ts` (whitelisting the delegated legacy parsers in `tm.ts`/`turbot.ts` until P2.1/slice 3).
  Anti-rot as enforced structure, not process.
- scWindowCheck addition: a 2-input FSM question's store-run output ≡ grader output (the store
  twin's stated purpose: student-visible runs must agree with the grader).

## 6. Risks and mitigations

- **Renderer legibility of hw4-p11 (the real appearance risk).** A k=2 serial adder has THREE
  self-loops per state plus an opposite-direction arc pair — worse than the coincident-arc defect
  already blocking hw4-p8/p9/p10 (P1.13); existing fixtures set zero `fsmControlPt`. Plan: verify
  self-loop separation via hand-placed `fsmControlPt` **first** in commit 4. If control points
  cannot fan multiple same-state self-loops, hw4-p11 goes *grading-verified / appearance-blocked*
  (the p8–p10 precedent) and P1.13's scope explicitly grows to cover self-loop fanning. p11's
  verification is **not** otherwise gated on P1.13.
- **P1.10 adjacency (fsmStep touched twice, deliberately).** The sandbox feed's leftmost-first
  bug (P1.10) lives in the lines this slice rewrites. We do NOT fold the fix in: this slice's
  strongest evidence of faithfulness is that every existing pin passes unchanged; folding in a
  behavior change that flips a scWindowCheck pin destroys that property. P1.10 stays a separate
  one-line task with its own pin flip, immediately after.
- **Editor regression (no harness, manual verification).** k=1 paths compile to today's shape;
  multi-char entry copies the TM sub-field mechanism. Pre-authorized fallback: if
  `FsmTransitionView` generalization fights back, adopt the editor seam for FSM only this pass —
  the anti-rot story survives via the grep gate.
- **Interim scatter (D2's honest weakness).** Until P2.1/slice 3, TM/turbot grammar knowledge
  stays in their engines and three table walkers coexist. Held by the grep gate, the adapter≡parser
  pins, and the queue (slices 2–3 are scheduled, not aspirational).
- **Adapter drift** (two paths answering "what does this TM label mean"): impossible to drift
  silently — notationCheck pins adapter ≡ parser on every run.

## 7. Rejected alternatives

**Full module now (D1, 78/100).** Rewrite all four grammars through the module plus a unified
per-field editor in one iteration (~1,050 lines). Genuinely the best end state — P2.1 becomes a
pure render swap, and it de-scatters everything including the store sites. Rejected because it
flips five engine files that three check suites pin, for zero functional gain today, spending the
project's scarcest resource (manual editor verification) on a refactor no acceptance criterion
needs. Its best parts are grafted here: the store `setTransitionLabel`/`addWire` sites, the
four-commit staging, the P2.1 stored-form decision, the editor fallback posture.

**Structured data model, staged (D3, 75/100).** Parse labels into stored structure with
`transitionOf` as the single legal reader. Strongest structural anti-rot (its grep gate is
adopted here), but parser bodies MOVE, `validateTurbotTM` is rewritten, engine signature breaks
ripple through store/turbot call sites now — and Stage B's dual-representation hydrate/dehydrate
designs in a silent-divergence risk of exactly the class this work exists to kill. Its bit-order
pin also used symmetric `x+y` — blind to the swap class. Grafts taken: grep gate, the store-twin
framing, the dev-mode round-trip assert (deferred to P2.1), the arity error phrasing.

**Shallow string patch.** Widen the regexes in place at each of the six scatter sites. Leaves the
family intact, leaves P2.1 a scatter-edit across engine/validator/editor/store, and leaves the
grader/store joins ad hoc. Rejected by NORTH_STAR's depth principle and by P1.12's own text.

---

## Implementation postscript (2026-07-06, commits 739fcfc..5244276)

The slice landed as designed, with two deliberate deviations from §3/§4,
both adversarially verified as behavior-preserving:

1. **`runBrainStep`'s FSM branch flipped onto `turbotFsmNotation` now** (memo
   deferred it to slice 3). The alias-decay rule (edit-save emits canonical
   `0:11`) is only safe if the engine executes canonical labels, so the ~8-line
   flip came forward. Bit-identical on all legacy labels; pinned in turbotCheck
   (legacy ≡ canonical run, both spellings accepted, canonical turn label
   pivots). Slice 3's remaining scope is the authoring/glossary surface, not
   the engine.
2. **P1.10 folded in** (memo said keep separate): the sandbox FSM feed now
   consumes typed input rightmost-char-first (t1), matching SC; the
   scWindowCheck sandbox pin was repointed (it had pinned the bug via a
   palindrome). Folded because the same `fsmStep` lines were being rewritten —
   the design-judge's "missed by all" finding, adopted by the orchestrator.

Also noteworthy: Stage-1 FSM validation is now stricter (unparseable stray
labels error loudly instead of being silently ignored) — no fixture affected;
consistent with the footgun-guard philosophy.
