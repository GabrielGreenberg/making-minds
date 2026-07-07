# Handoff — the hot state

_Read this first. It says exactly where we are and what to do next. Rewrite it at
the end of every iteration. If it conflicts with the harness, the harness wins —
run `npm run coverage` and reconcile._

## Where we are

Branch `buildout-infra` (pushed to `origin`). **41 / 56 verified**, 15 pending,
0 regressed, 0 warnings. Sixteen iterations done. All arithmetic complete
(HW1–HW5). The wire-router **model fix** is underway (P1.8): the design memo
(`designs/wire-routing.md`) plus slices **S1** (shared geometry — MEM is 50×50
now, fallbacks 283→99, all fixtures oracle-clean) and **S2** (divergence dots)
landed as commits `4e62a7e` and `bdf13b1`, verified headless with 0 refutations.

**Model note:** the session switched to opus-4-8 mid-P1.8 (the Fable 5 credit
limit was hit during S1's browser sweep). Everything is committed and pushed.

## ⚠ SCOPE SHIFT (user directive 2026-07-06) — read before picking work

**Interface over correctness.** For everything that remains (perception +
navigation, all 15 pending rows), the bar is that the *interface* exists: the
question authors, a **plausible attempt** builds in the editor, passes Stage-1
validation, and grades end-to-end. The attempt's score is reported, **not
asserted** — do NOT spend tokens hunting exactly-correct solutions (Way Finder,
Mad Max, Desert Ant, motion detector). That is a separate future
"correct-answers project". Enforced in the harness as tier `interface` (all 15
pending manifest rows are tagged; state ◐); NORTH_STAR and QUEUE carry the full
statement. The 41 exact rows stay exact as regression pins. P2.5 is deferred to
the correct-answers project. P1.8 (router) is unaffected — that IS interface
quality work.

## Do this next — finish P1.8 S1 acceptance, then S3/S4

**FIRST (S1's one pending acceptance item):** browser-sweep the ~72 hw3 routes
that MOVED under S1. The sweep agent hit the model limit before running it.
Headless legs all pass (23 fixtures oracle-clean, fallback budget 99 pinned in
`routerCheck`), but confirm in-browser that the moved MEM routes read cleanly
(no false merges, no through-body) and S2's divergence dots render at elbows.
Recipe v3: assignment `router-sweep` with the nine hw3 fixtures + hw2-p7 +
hw1-p4 (fan-out, for dots), served from `app/public/` at `/making-minds/`,
seeded on Home after reload, click-navigate. If any moved route reads as a
merge, that's an S1 regression to fix before proceeding (the oracle passed, so
it would be a zoom/rendering-space issue the memo flags, not an oracle miss).

**THEN P1.8 S3–S4** (per `designs/wire-routing.md` slice plan):
- **S3** — foreign-lane A* cost + an H4 near-merge validation round using the
  oracle's own `collinearOverlap` predicate; this kills the 1px-hug class
  generally (not just where fixtures were hand-tuned). Budget the browser-sweep
  effort here; W_LANE calibration capped at two sweep rounds before falling
  back to H4-only.
- **S4** — fallback phase-0 (route residual fallbacks first so A* sees them) +
  lane-nudged fallback + per-wire `usedFallback`/violation flags. Regression-pin
  a pre-fix HW3 layout → zero oracle violations.
Each slice: `npm run check` (incl. `routerCheck`) + `tsc` + `build` +
`coverage` (41/56, 0 regressed) + layoutCheck clean + browser spot-check.

## Then

P3.1 (target-functions design memo — perception authoring) → P3.2/P3.3
perception fixtures → P4.2 multi-arena grading → P4.3 nav arenas → P5.1
capstone → smalls (P1.5 allowed_components, P1.6 cc.ts label-order, P1.11 ARG
multi-group, P2.5 gap-robust hw5-p5/p6) → P6 close-out. META-audit-queue is
due around iteration 17 (last ran iteration 11) — consider it next or the one
after.

## Watch out for

- **Interface tier, not answer-chasing** (see SCOPE SHIFT above): if you notice
  an iteration burning effort trying to make an attempt *pass* its cases,
  stop — report the score and move on. Only statement lint, Stage-1 validity,
  end-to-end grading, layout, and appearance gate an interface row.
- **`routerCheck` pins the fallback budget (99) + exact distribution** — S3/S4
  deliberately ratchet it down, so those pins are EXPECTED to change; edit the
  `EXPECTED_FALLBACKS` table intentionally, don't just relax the bound.
- **layoutCheck now imports `componentGeometry`** — geometry changes flow to
  the oracle automatically; a "violation" after a router change is real, not
  oracle drift.
- **`componentGeometry.ts` is the single source** for dims + port math — never
  reintroduce a local copy in CircuitCanvas/wireRouter/layoutCheck.
- **notationCheck grep gate**, **scWindowCheck (45+)**, **tmCheck** (incl. the
  P2.3 standard-halt + P2.4 separations pins) all stay green.
- **Ops:** 529 → `Workflow({scriptPath, resumeFromRunId})`; model/credit limit
  can kill an agent mid-workflow — commit landed slices first (the S1/S2 agent
  did, which is why they survived).
- **Appearance recipe v3**; seeds from `app/public/` at `/making-minds/`; clean
  seed keys twice + delete the `app/public/*-seed.json` (and any `app/dist/`
  copy if a build ran).
- `tsx` missing → `npm install`; no lockfile churn.

## Background task in flight

The user started `task_dbe95a5e` ("Reset TM sim state on question switch") in a
separate local session — unrelated to P1.8, running independently. Check its
outcome before touching the TM store slice.
