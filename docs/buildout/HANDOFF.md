# Handoff — the hot state

_Read this first. It says exactly where we are and what to do next. Rewrite it at
the end of every iteration. If it conflicts with the harness, the harness wins —
run `npm run coverage` and reconcile._

## Where we are

Branch `buildout-infra`. **32 / 56 verified**, 24 pending, 0 regressed, 0
warnings. Eleven iterations done; the second META-audit just ran. All four
arithmetic verticals (HW1–HW4) are fully complete. Remaining walk (QUEUE):
**P2.1 → P2.2 → P1.8 → P3.1 → P3.2/P3.3 → P4.2 → P4.3 → P5.1 → smalls → P6**.

## Do this next — P2.1: TM two-output notation swap

The one deliberate departure from the textbook (spec §10.3): TM transitions
must show ONE input (read symbol) driving TWO outputs (write symbol, move) —
industry style — instead of the dual-action token `1:0R`.

The heavy lifting is already done: `engine/notation.ts` (P1.12,
`designs/transition-notation.md` + postscript) owns TM label syntax behind a
delegating adapter, and the editor's token fields are seam-driven. The swap:

1. **Read the design memo first** — especially its Stage-B/migration notes and
   the P2.1-shaped slice description.
2. Replace the tm notation object's parse/format with the two-output grammar.
   Decide the exact stored + rendered form (e.g. `1:0,R` stored; rendered as
   two labeled output fields) — record it in VISUAL_VOCAB §TM (it has a
   placeholder: "Record the exact rendered form here once P2.1 lands") and
   spec §10.3 if the spec file carries it.
3. Fold `validateTMTable` onto the generic `validateTransitionTable` walker
   (the memo planned this); keep turbot-TM grammars byte-unchanged.
4. **Migrate stored labels:** devData TM sample (`sampleData.ts`), any sandbox
   localStorage story per the memo. There are NO TM fixtures yet — HW5 comes
   next — so migration surface is small. Keep `parseTMAction`-based engine
   execution working (the engine stores TMAction {write, move} separately
   already; this is notation-layer).
5. Editor: the TM label editor should present input → two output fields
   (write, move) via the seam's token fields; verify in-browser.
6. Repoint notationCheck's TM adapter≡parser pins to the new grammar; tmCheck
   must stay green (it pins engine semantics, which don't change).

**Acceptance:** tmCheck + notationCheck + scWindowCheck + turbotCheck +
coverage (32/0 regressed) + tsc + build green; TM editor shows two outputs
in-browser; a TM machine round-trips edit→store→grade; VISUAL_VOCAB §TM
records the rendered form.

## Then

P2.2 — HW5 TM fixtures (tally hw5-p1…p6, binary p7…p9; check
`requireStandardHaltPosition` where problems demand standard-position halting;
TM boxing if reuse demands it). Then P1.8 (router memo — gates Phase 3).

## Watch out for

- **notationCheck's grep gate**: TM label logic must live in the seam.
- **tmCheck pins engine semantics** — the TM engine's dual-action execution
  (TMAction {write, move}) is NOT changing; only the label notation is.
- **Turbot-TM grammars must be byte-unchanged** (internal `0:1`/`1:L`,
  external `E:↑`) — turbotCheck is the canary.
- **TM tape alphabet is representation-tied** (`*` only on binary questions) —
  the notation's token fields must respect that (the current editor does).
- **Ops:** 529 → resume workflow; session limit → finish solo.
- **Appearance recipe v3**; seeds from `app/public/` at `/making-minds/`.
- `tsx` missing → `npm install`; no lockfile churn.
