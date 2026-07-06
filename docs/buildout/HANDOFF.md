# Handoff — the hot state

_Read this first. It says exactly where we are and what to do next. Rewrite it at
the end of every iteration. If it conflicts with the harness, the harness wins —
run `npm run coverage` and reconcile._

## Where we are

Branch `buildout-infra`. **23 / 56 verified** (HW1 7/7, HW2 arithmetic 7/7, HW3
arithmetic 9/9), 33 pending, 0 regressed. Four iterations done. The batch
workflow shape is proven across CC and SC; the SC conventions (LSB-first time
axis, MEM min/mout semantics, drain, canonical-tally ones-block-at-end) are
written up in LOG iteration 4 and inside the hw3 fixtures.

## Do this next — iteration 5: META-audit-queue

Five iterations have elapsed → the recurring audit is due (QUEUE bottom):

1. `npm run coverage`; reconcile COVERAGE.md + QUEUE.md against the harness
   JSON (the harness wins).
2. Prune dead/duplicate tasks; re-rank by dependency and value. In particular
   decide the ordering of the discovered-work backlog **P1.5–P1.9** vs the
   remaining fixture verticals (P1.4 FSM → P2 TM → P3 perception → P4/P5
   navigation/turbot). Recommendation to evaluate: P1.9 (drain-semantics
   divergence) is a potential real grading bug and cheap to investigate — it
   may deserve to jump the queue; P1.8 (router) is app-wide UX depth with a
   design memo; P1.7 hardens the harness the whole rest of the loop leans on.
3. **Audit for patch accumulation** (NORTH_STAR): the three router-adjacent
   items (hw2-p7 re-layout, hw3 layout-fix workflow, P1.8) are one family —
   confirm P1.8's design memo subsumes them rather than more per-fixture
   nudging. Likewise the statement-hygiene fixes (hw2, hw3) suggest adding a
   statement-lint to the harness (fold into P1.7 or queue separately).
4. Log what changed; point HANDOFF at the winner (default: P1.4, HW4 FSM
   arithmetic hw4-p3…p11).

## Then

P1.4 — HW4 FSM arithmetic (hw4-p3…p11), same workflow shape. FSM notes for the
spec agent: states are circles S0/S1/…, transitions `input:output` Mealy labels,
time axis same LSB-first codec as SC; read `engine/fsm.ts` + the FSM sample in
devData; broken variants must fail broadly (sampled banks).

## Watch out for

- **Ops:** 529-Overloaded outages → resume with
  `Workflow({scriptPath, resumeFromRunId})` (cached prefix is free). Subagent
  **session limit** can hit mid-workflow (last reset 4:50am) — finish critical
  verification solo with preview tools if needed.
- **Appearance seeding recipe v3** (LOG iteration 4): reload → land on Home →
  seed localStorage (instructor assignment `mm:inst-asg:<id>` + workbook
  `mm:asg:<id>`) → click-navigate in. NEVER seed-then-reload (flushAutoSave
  clobbers the seed). App is served at base path `/making-minds/` (public files
  fetch from there). Remove seeded keys twice at cleanup.
- **Layout oracle:** `scratchpad/routecheck_near.ts <fixture.json>` (strict 3px
  near-parallel variant; imports the app's real `routeAllWires`) — run it on
  every new fixture BEFORE the browser sweep; consider promoting to `tools/`
  as part of P1.7/P1.8. MEM feedback wires always take a fixed fallback lane at
  (min-port x + 32) — place components so those lanes have clear corridors;
  copy hw3-p7/p9's right-to-left top-row MEM-chain convention.
- **Fixture content hygiene:** statements = clean prose (no ledger shorthand,
  no answer giveaways); spec agents must return full row ids (`hw4-p3`, never
  `p3`) — pin it in their schema.
- `tsx` missing after checkout → `npm install`; don't commit lockfile churn.
