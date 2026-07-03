# Plan — TM two-action model (write + move per step)

> **Status: DONE (engine + docs), except step 10.** Steps 1–9 are implemented: `engine/tm.ts`
> (compound `[symbol][L|R]` tokens, always write-then-move), the sample circuits, `tools/tmCheck.ts`
> coverage, and every KB doc (`../engines/tm.md`, `tm-store.md`, `CLAUDE.md`) now describe the
> two-action grammar consistently. Verified green by `tmCheck.ts` / `pipelineCheck.ts` /
> `codecCheck.ts`. **Still open: step 10** — `spec/PHIL_133_Platform_Spec_v2.md` §10.3–10.4 edits
> need explicit sign-off before touching the checked-in source-of-truth doc. Kept as the design
> record.

## The change

Transition action tokens move from single-primitive actions (`R`, `L`, `0`, `1`, `*` — a move
*or* a write, never both) to compound write+move tokens: every step both writes a symbol under
the head and moves the head, as one atomic action.

- Unary action tokens: `0L 0R 1L 1R`
- Binary action tokens: `0L 0R 1L 1R *L *R`

Label format is unchanged: `input:action`, e.g. `1:0R` = read `1`, write `0`, move right. The
`input` half of the label is still a single symbol; only `action` becomes 2 characters
(`[symbol][L|R]`).

## Settled decisions

- `*L`/`*R` extend to binary machines uniformly, since `*` is already the binary-only write
  symbol today.
- No migration path needed — no TM transition labels exist anywhere outside `devData/sampleData.ts`
  and `tools/tmCheck.ts` (grep-confirmed: no bundled TM assignment JSON, no persisted student
  work). Clean break, not a data migration.
- `tmCodec.ts` (encode/accept/decode) and the grader are **unaffected** — they only look at tape
  content and head position after a run, never at how many actions produced them.
- The store/UI (`tm-store.md`) don't exist yet, so there is no UI-side migration debt; the future
  transition-label editor and default label just need to target the new grammar when built.

## Steps (ordered; each independently testable via `tmCheck.ts`)

1. **`engine/tm.ts`.**
   - `TMActionToken = '0L'|'0R'|'1L'|'1R'|'*L'|'*R'`.
   - `TMAction`: drop the `kind: 'move'|'write'` discriminant — every action is always
     `{ raw, symbol, dir }`.
   - `parseTMAction(token, notation)`: require exactly 2 characters, `[symbol][L|R]`; symbol
     legality stays notation-gated via `isSymbolForNotation`.
   - `applyAction`: always write-then-move — write `symbol` at `head` (delete the key if `'0'`),
     then shift `head` by `dir`. Every step now clones `cells`; drop the old move-only
     ref-sharing optimization (there is no longer a move without a write).
   - `evaluateTMSingleStep` / `evaluateTMSequence` keep their current shapes; `history[].action`
     is still `result.action.raw` (now 2 characters).
   - Update the top-of-file model comment to describe the two-action grammar.

2. **`engine/tmValidate.ts`.** No structural change — `parseTMTransition` already routes through
   `parseTMAction`, so the unparseable check adopts the new grammar automatically; ambiguity is
   keyed on the `input` half, untouched. Comment-only pass.

3. **`engine/tmCodec.ts`.** No change.

4. **`engine/grader.ts`, `machineValidation.ts`.** No change.

5. **`devData/sampleData.ts`.** Rewrite `tmCorrect()` / `tmIncorrect()` transition labels:
   - `tmCorrect` (unary successor, `y = x+1`): `S₀ --1:1R--> S₀`, `S₀ --0:1R--> S₁` (halt).
   - `tmIncorrect` (constant-zero): collapses to one state — `S₀ --1:0L--> S₀`, halting once it
     reads background `0`.
   Update the header comment describing what each sample circuit computes.

6. **`tools/tmCheck.ts`.**
   - Update `tmIncrement` / `tmZero` / `tmAmbiguous` wire labels to the new grammar.
   - Update the `parseTMAction('*', 'binary')` sanity check to 2-character tokens (`'*R'`).
   - Add coverage: a legacy single-character token (`'R'`, `'0'`) is now unparseable; a bad
     direction character (`'0X'`) is unparseable; `'*L'`/`'*R'` parse only for binary.

7. **`tools/pipelineCheck.ts`.** No direct edits; rerun after step 6 to confirm the sample
   assignment still scores 4/4 (correct) and 0/4 (incorrect).

8. **`CLAUDE_KB/engines/tm.md`.** Update throughout so the doc consistently describes the
   two-action model (no mixed old/new grammar left in the file):
   - The "model" section — every transition performs a write and a move together.
   - The action-tokens table (unary/binary rows).
   - The "Module map" note on `TMAction`'s shape.
   - Any other prose or examples referencing single-primitive actions (e.g. transition-label
     examples like `1:R`, `0:1` become `1:1R`, `0:1R`, etc.).

9. **`CLAUDE_KB/plans/tm-store.md`.** Update the example default transition label (`'0:R'` →
   e.g. `'0:0R'`) to match.

10. **`spec/PHIL_133_Platform_Spec_v2.md` §10.3–10.4.** Update the action grammar and the
    operation-cycle wording ("execute the tape action (move or write)" → write, then move).
    **Needs explicit sign-off before editing** — this is the checked-in source-of-truth doc; flag
    it rather than bundling it into the engine steps above.

## Testing

After steps 1, 6, and 7:

```
cd app && npx tsx tools/tmCheck.ts && npx tsx tools/pipelineCheck.ts && npx tsx tools/codecCheck.ts
```

## Out of scope here

The store (`tmStep`) and UI — unaffected by this revision beyond the default-label example in
`tm-store.md` (step 9). See that doc for the store/UI work itself.
