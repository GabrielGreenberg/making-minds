# Handoff — the hot state

_Read this first. It says exactly where we are and what to do next. Rewrite it at
the end of every iteration. If it conflicts with the harness, the harness wins —
run `npm run coverage` and reconcile._

## Where we are

Branch `buildout-infra`. **32 / 56 verified**, 24 pending, 0 regressed, 0
warnings. Nine iterations done. All HW1–HW4 **arithmetic** rows are
grading-verified; hw4-p8/p9/p10 remain appearance-blocked on the coincident-arc
renderer defect. The transition-notation seam landed (P1.12,
`designs/transition-notation.md` + postscript): `engine/notation.ts` owns label
syntax for all four grammars, FSM is k-bit, the 2-input footgun is dead, P2.1
is now a notation swap, and 2-bit motor labels are already executable.

## Do this next — P1.13: FSM coincident-arc renderer fix

The last blocker on the HW4 arithmetic vertical. CircuitCanvas renders
opposite-direction transition pairs (S₀→S₁ and S₁→S₀) as geometrically
coincident quadratic curves with superimposed labels (identical control
points) — one transition visually hidden. hw4-p11 dodged it with hand-placed
`fsmControlPt`; hw4-p8/p9/p10 need the real fix (their machines inherently use
both directions).

1. Find the FSM transition-curve construction in CircuitCanvas.tsx (the "FSM
   transition curves" branch, ~line 3660s; `fsmControlPt` override exists).
   When a wire has NO explicit `fsmControlPt` and an opposite-direction sibling
   exists between the same two states, offset the control point perpendicular
   to the state-center line (one arc bows up/left, the other down/right —
   VISUAL_VOCAB: "A→B/B→A separated arcs"). Respect existing `fsmControlPt`
   (hw4-p11 must render unchanged). Check multiple SELF-LOOPS on one state fan
   out at distinct angles (the auto-fan exists — verify it holds for 3+ loops,
   hw4-p11's case, though its loops auto-fanned fine).
2. Label placement must follow the offset arcs (labels at each arc's apex, not
   superimposed).
3. Re-sweep hw4-p8/p9/p10 in the browser (recipe v3; VISUAL_VOCAB FSM rules) —
   their appr cells + statuses flip ✅ in COVERAGE. Spot-check hw4-p5/p6/p11
   and the devData FSM sample for rendering regressions (opposite pairs are
   common).
4. Gates: check/tsc/build + coverage (32/0 regressed — this is UI-only, no
   grading change).

**Acceptance:** hw4-p8/p9/p10 appearance passes → HW4 arithmetic fully ✅ in
COVERAGE; no rendering regressions elsewhere; gates green.

## Then

P1.8 (wire-router design memo — gates Phase 3 perception) → P1.5
(allowed_components) → P1.6/P1.11 (small) → **P2.1 TM two-output** (now a
notation swap per the P1.12 seam; its design questions are pre-answered in
`designs/transition-notation.md`) → P2.2 (HW5 TM fixtures). META-audit-queue
due ~iteration 10 (next iteration or the one after).

## Watch out for

- **notationCheck's grep gate** fails the build if label dissection leaks
  outside the seam — new code must use `engine/notation.ts`.
- **hw4-p11 has hand-placed `fsmControlPt`** — the P1.13 auto-offset must not
  fight explicit control points.
- **scWindowCheck (45+ pins) + turbotCheck pin the notation seam** — store/
  editor changes must keep them green.
- **Ops:** 529 → resume workflow; session limit → finish verification solo.
- **Appearance recipe v3**; seeds served from `app/public/` at `/making-minds/`;
  clean keys twice.
- `tsx` missing → `npm install`; no lockfile churn.
