# Handoff — the hot state

_Read this first. It says exactly where we are and what to do next. Rewrite it at
the end of every iteration. If it conflicts with the harness, the harness wins —
run `npm run coverage` and reconcile._

## Where we are

Branch `buildout-infra`. **41 / 56 verified**, 15 pending, 0 regressed, 0
warnings. Fifteen iterations done. All arithmetic complete (HW1–HW5);
`requireStandardHaltPosition` live (P2.3); the TM codec varies block
separation so hw5-p4's robustness clause bites (P2.4). Remaining pending:
perception (hw2-p10..12, hw3-p11..12), navigation (hw2-p13..15, hw3-p13..15,
hw4-p12..14), HW6 capstone. Remaining walk: **P1.8 → P3.1 → P3.2/P3.3 → P4.2
→ P4.3 → P5.1 → smalls (P1.5/P1.6/P1.11/P2.5) → P6**.

## Do this next — P1.8: wire-router design memo (+ fix if it fits)

Gates Phase 3 (perception fixtures are CC/SC — back on the router). The family
(QUEUE P1.8, evidence from the hw3 layout battle, LOG iteration 4):

- (a) every wire into `MEM.min` takes a fixed obstacle-blind **fallback path**
  because the min stub sits inside the router's phantom 75×70 MEM bounds
  (rendered body is 50×50) — these fixed lanes caused all six HW3 appearance
  failures;
- (b) different-source wires can run collinear or 1px apart (reads as a
  forbidden merge) — the A* lane cost doesn't know about foreign wires'
  segments (incl. fallback lanes it can't see);
- (c) the split junction dot is drawn only at the source port; multi-branch
  trunks have undotted divergence elbows (VISUAL_VOCAB wants dots at splits).

Deep fix direction (weigh in the memo): align router obstacle bounds with
rendered geometry (or make the min stub reachable so A* handles MEM wires);
add a lane-separation cost for foreign collinear/near-parallel runs; dot
divergence points. Improves every student's canvas, not just fixtures.

1. **Design memo** `designs/wire-routing.md`: the family, evidence, the chosen
   fix per sub-problem (a/b/c), what stays (the deterministic fallback as a
   last resort?), compat contract (all 16 CC/SC fixtures must stay
   layoutCheck-clean — the oracle in `tools/layoutCheck.ts` gates them in the
   harness; hw3-p7/p9's right-to-left MEM chains and hw2-p6/p7/hw3-p4's
   repositioned layouts must not regress), test plan (layoutCheck is the
   regression oracle; add router-level unit pins), risks. Judge-panel the
   design if the trade-offs look wide (the P1.12 memo pattern worked well).
2. **Implement if it fits the iteration** (guardrail: green within the
   iteration or split seam-first): the likely slices are (a) obstacle-bounds
   alignment (small, high value), (b) lane-separation cost (medium), (c)
   divergence dots (small, renderer-side). Each slice must keep
   `npm run coverage` at 41/56 with layoutCheck green — if a slice makes a
   previously-clean fixture dirty because routes CHANGED (better or worse),
   re-run the browser sweep for the affected fixtures before accepting.
3. Gates: check/tsc/build/coverage; browser spot-check of one MEM-heavy
   fixture (hw3-p8) and one CC fixture (hw2-p7) after any route change.

**Acceptance:** memo written; implemented slices leave all 16 CC/SC fixtures
oracle-clean + spot-checked in-browser; gates green. If implementation splits,
the memo + slice 1 is an acceptable iteration.

## Then

P3.1 (target-functions design memo — perception authoring) → P3.2/P3.3
(perception fixtures) → P4.2 (multi-arena grading) → P4.3 (navigation arenas)
→ P5.1 (Desert Ant capstone) → smalls → P6 close-out.

## Watch out for

- **layoutCheck is the harness gate** for CC/SC fixtures — router changes that
  alter routes will show up there first; a "violation" after a route change
  may mean the oracle's replicated geometry drifted from the router (keep them
  in sync — the oracle imports the real `routeAllWires`, so only the port/body
  geometry constants can drift).
- **hw4-p11/hw5 fixtures use STATE curves, not the router** — out of scope.
- **Ops:** 529 → resume workflow; session limit → finish solo.
- **Appearance recipe v3**; seeds from `app/public/` at `/making-minds/`.
- `tsx` missing → `npm install`; no lockfile churn.
