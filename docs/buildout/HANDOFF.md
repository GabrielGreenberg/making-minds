# Handoff — the hot state

_Read this first. It says exactly where we are and what to do next. Rewrite it at
the end of every iteration. If it conflicts with the harness, the harness wins —
run `npm run coverage` and reconcile._

## Where we are

Branch `buildout-infra`. **32 / 56 verified**, 24 pending, 0 regressed, 0
warnings. Ten iterations done. **All four arithmetic verticals are complete**
(HW1 7/7, HW2 7/7, HW3 9/9, HW4 9/9 — appearance included). Remaining pending:
CC/SC perception (hw2-p10..12, hw3-p11..12 — needs the P3.1 target-function
design spike), navigation (hw2/hw3/hw4 ×3 — needs arenas + P4.2 multi-arena
grading; FSM 2-bit motor labels already work via the P1.12 seam), HW5 TM (9 —
Phase 2 first), HW6 turbot-TM capstone (1).

## Do this next — iteration 11: META-audit-queue

Five iterations since the last audit (iteration 5). Standard reconcile + one
big re-planning question this time:

1. `npm run coverage`; reconcile COVERAGE/QUEUE with the harness (expect
   clean — 32/0).
2. **Re-rank what remains.** The arithmetic spine is done; what's left splits
   into three tracks with different blockers:
   (a) **Phase 2 TM** (P2.1 two-output notation — now a notation swap per
   `designs/transition-notation.md` — then P2.2's nine HW5 fixtures);
   (b) **Phase 3 perception** (P3.1 design spike — target-function abstraction
   — then hw2-p10..12, hw3-p11..12; ALSO needs P1.8's router memo since
   perception fixtures are CC/SC);
   (c) **Phase 4/5 navigation** (P4.2 multi-arena grading + arenas; P1.12
   already delivered the motor labels; then hw6-p2 capstone).
   Decide the order (suggested: keep the mode walk — TM next since it's
   unblocked and P2.1 is cheap now; perception needs TWO design memos first).
   Also slot the small tasks (P1.5 allowed_components, P1.6 label-ordering,
   P1.11 ARG multi-group, P1.8 router memo) where they gate things.
3. **Patch-accumulation check:** the notation seam absorbed the grammar family
   cleanly; check whether anything new is accumulating (e.g. fixture
   appearance conventions — hand-placed fsmControlPt in p6/p11 vs auto arcs —
   is that a family needing a rule, or fine as-is?).
4. Log; point HANDOFF at the winner.

## Then (default expectation)

P2.1 (TM two-output — implement via the notation seam; VISUAL_VOCAB TM section
+ spec §10.3 updates; migrate devData/fixture labels; tmCheck/coverage green)
→ P2.2 (HW5 TM fixtures ×9) → P1.8 + P3.1 design memos → perception →
navigation → capstone → Phase 6 close-out.

## Watch out for

- **notationCheck's grep gate**: label dissection must stay inside
  `engine/notation.ts` — P2.1's TM swap must go through the seam.
- **P2.1 changes STORED label format** (dual-action `1:0R` → two-output) —
  fixtures/devData/localStorage migration story is pre-planned in the design
  memo (Stage B notes); re-read it before implementing.
- **scWindowCheck + turbotCheck pin everything** the notation seam touches.
- **Ops:** 529 → resume workflow; session limit → finish verification solo.
- **Appearance recipe v3**; seeds from `app/public/` at `/making-minds/`;
  clean keys twice.
- `tsx` missing → `npm install`; no lockfile churn.
