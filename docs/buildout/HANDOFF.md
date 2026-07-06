# Handoff — the hot state

_Read this first. It says exactly where we are and what to do next. Rewrite it at
the end of every iteration. If it conflicts with the harness, the harness wins —
run `npm run coverage` and reconcile._

## Where we are

Branch `buildout-infra`. **23 / 56 verified**, 33 pending, 0 regressed. Six
iterations done. Iteration 6 shipped the loop's first app-code change (P1.9):
SC/FSM question runs now execute the **canonical codec window** and feed the
codec's own encoded input stream, the A/V decode is window-clamped, FSM rows
render t1-rightmost — all pinned by `app/tools/scWindowCheck.ts` (45 checks in
`npm run check`). Grader behavior unchanged. A pedagogy flag for Gabriel sits in
LOG iteration 6 (late-but-right tally = wrong; say the word to revisit).

## Do this next — P1.7: harness hardening

`coverageCheck.ts` only asserts the broken variant fails ≥1 case. Add:

1. **Broken-breadth bar:** per-row broken-fail fraction printed in the ledger;
   warn (or fail) under 25% of the bank. hw2-p6 (fails 1/16 — the narrowest
   near-miss) is the known edge: decide warn-vs-fail so it stays green or gets
   a second broken variant.
2. **Drain-coverage bar (SC/FSM rows):** assert the bank contains ≥1 case whose
   output width exceeds input width (the drain-exercising case); currently
   hw3-p1/p2 hang on a single such case each.
3. **Statement lint:** no ledger-shorthand prefixes (`+2 [0-15] B.`-style), no
   answer-giveaway parentheticals ("(It is possible: …)") — two manual cleanup
   rounds (hw2, hw3) prove it recurs.
4. **Promote the layout oracle:** `scratchpad/routecheck_near.ts` (strict 3px
   near-parallel variant, imports the app's real `routeAllWires`) →
   `app/tools/layoutCheck.ts`, run for router-rendered (CC/SC) fixtures in the
   manifest; TM/FSM/turbot rows skip it (STATE curves bypass the router).
5. Wire all of it into `npm run coverage` / `npm run check`; a synthetic
   single-case-divergence fixture must trip the breadth warning (prove the
   check checks).

**Acceptance:** harness prints per-row fractions; all 23 verified rows stay
green (or get explicitly better broken variants); statement lint + layout
oracle run in the harness; gates green.

## Then

P1.4 (HW4 FSM arithmetic, hw4-p3…p11 — META-visual-vocab first step; note the
P1.9 groundwork: FSM question runs now 0-pad to the codec window, typed input
is a numeral, so fixtures test exactly what students see) → P1.8 (router design
memo; gates Phase 3) → P1.5/P1.6/P1.10/P1.11 → Phase 2.

## Watch out for

- **scWindowCheck is now load-bearing** — any store/DataTable/codec touch must
  keep its 45 checks green; it drives the real zustand store headlessly
  (window/document shims before dynamic import — copy that pattern for new
  store-level checks).
- **Ops:** 529 outages → `Workflow({scriptPath, resumeFromRunId})`; subagent
  session limit can hit mid-workflow — finish critical verification solo.
- **Appearance seeding recipe v3** (LOG iteration 4): reload → Home → seed
  `mm:inst-asg:<id>` + `mm:asg:<id>` → click-navigate; never seed-then-reload;
  base path `/making-minds/`; clean keys twice.
- **Layout oracle** on any new/edited CC/SC fixture before the browser sweep.
- `tsx` missing after checkout → `npm install`; no lockfile churn commits.
