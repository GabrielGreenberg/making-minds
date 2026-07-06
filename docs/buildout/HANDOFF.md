# Handoff — the hot state

_Read this first. It says exactly where we are and what to do next. Rewrite it at
the end of every iteration. If it conflicts with the harness, the harness wins —
run `npm run coverage` and reconcile._

## Where we are

Branch `buildout-infra`. Phase 0 is **fully done** — including **P0.4**: the
fixture path is proven end-to-end. COVERAGE: **1 / 56 verified** (hw1-p1 NAND),
55 pending. The authoring template (headless build → prove with `gradeQuestion`
→ write fixture → manifest → appearance check) is written out step-by-step in
**LOG.md, 2026-07-06 entry** — copy it for every fixture.

## Do this next — P1.1: HW1 logic + synthesis (6 fixtures)

Reference solutions for **hw1-p2…p5** (logic) and **hw1-p16, hw1-p17**
(synthesis), following the LOG template. This is a batch of six independent
same-shaped verticals — **use a Workflow**: fan out one build+prove agent per
problem, then an adversarial verify pass, then one appearance sweep; add a
completeness critic asking which HW1 rows are still red.

Problem notes (from COVERAGE + the HW1 PDF — re-check the PDF for exact specs):

- **hw1-p2** — reconstruct OR without the OR gate (DeMorgan). Set
  `allowed_components` (field exists on `AssignmentQuestion`; no creator UI —
  setting it in fixture JSON is fine). Broken variant idea: wrong DeMorgan
  (e.g. NOT(AND(a,b))).
- **hw1-p3** — splitting outputs, 2-in → 2-out (one output feeds two sinks;
  remember split = dot, merge = forbidden).
- **hw1-p4** — XOR from primitives.
- **hw1-p5** — check the PDF for the exact function.
- **hw1-p16 (M)** — successor of tally(I), 1 input group → 2 output groups.
- **hw1-p17 (N)** — successor of binary(I), 1-in → 2-out. For both: representation
  matters (`tally` vs `binary`) and outputs are never truncated (widths derived).

**Acceptance:** `npm run coverage` → 7/56 verified (all of HW1); COVERAGE HW1
section fully ✅ (incl. appearance); gates green (`npm run check`, `tsc`, `build`).

## Then

P1.2 (HW2 CC arithmetic, hw2-p1…p7) → P1.3 (HW3 SC) → P1.4 (HW4 FSM), per QUEUE.
Keep finishing one vertical before broadening.

## Watch out for

- **Depth over patches** (NORTH_STAR): P1.1 is template-stamping, no memo needed.
  But P2.1/P3.1/P4.1 have deep framings spelled out in QUEUE — design memo first.
- **Delegate to survive**: Workflows for the fixture batch; keep only conclusions
  in the driving session.
- Author machines **in code** via `app/tools/builder.ts` (port ids in its header;
  canonical examples in `src/devData/sampleData.ts`). Browser = appearance check
  only. Appearance-injection recipe is in the LOG template (note the
  `QuestionCircuit` extra empty arrays).
- Every fixture needs a **broken** variant that is a *plausible near-miss*, or the
  check is vacuous.
- `tsx` may be missing after checkout → `npm install` (reconciles to committed
  lockfile; don't commit churn).
- In the app, console `location.hash` changes don't re-render — click through the
  UI (tag elements with a data-attribute via `preview_eval`, then `preview_click`).
- After committing, confirm CI (`gh run list --limit 1`) — on `buildout-infra`
  there's no Pages deploy; CI-green just means the branch builds.
