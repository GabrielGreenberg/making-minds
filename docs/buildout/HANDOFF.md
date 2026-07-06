# Handoff — the hot state

_Read this first. It says exactly where we are and what to do next. Rewrite it at
the end of every iteration. If it conflicts with the harness, the harness wins —
run `npm run coverage` and reconcile._

## Where we are

Branch `buildout-infra`. **23 / 56 verified** (HW1 7/7, HW2 arithmetic 7/7, HW3
arithmetic 9/9), 33 pending, 0 regressed. Five iterations done; iteration 5 was
the META-audit — ledger clean, Phase-1 tail re-ranked to **P1.9 → P1.7 → P1.4 →
P1.8 → P1.5 → P1.6** (rationale in LOG iteration 5).

## Do this next — P1.9: reconcile UI-vs-grader drain semantics

A potential **real grading-fairness bug**, and a dependency for the FSM batch
(same time axis). The claim to test: CLAUDE.md says the UI's SC Run drains one
0-input step **per MEM** after the input is consumed; the grader's run length
is `stepCountFor = max(inputWidth, outputWidth)` (`engine/codec.ts`),
independent of MEM count.

1. **Reproduce:** build a functionally correct SC machine whose output emerges
   LATE — e.g. a `2x` computed with TWO chained delay registers computing
   `4x/2`… no: simplest is x delayed k extra cycles (compute `2x` as delay∘
   delay∘(divide-by-2)? — impossible; instead take `x + 0` = identity via two
   MEMs: delay twice then nothing arrives in window). Concretely: an identity
   circuit built as a 2-step delay computes 4x on the codec window (every delay
   = ×2 on the LSB-first axis) — so instead craft a machine whose SEMANTIC
   answer needs more steps than max(inW,outW): e.g. grade `2x` (outW = inW+1)
   with a circuit that emits 4x/2 — see LOG iteration 4's bit-order note; or
   simulate the UI path (`store` Run semantics per CLAUDE.md) vs
   `evaluateSCInputs` on the same machine and diff the traces. The point is to
   EXHIBIT a machine the two semantics judge differently (or prove none can
   exist — also a valid outcome, then P1.9 closes as documentation).
2. **Read both sides:** `engine/sc.ts` + `engine/codec.ts` (`stepCountFor`,
   time-axis encode/decode) vs the store's SC Run/drain implementation
   (`store.ts`, SC sim slice; CLAUDE.md "SC runs flush the pipeline").
3. **Decide the canonical semantics** (likely: the codec window — grading and
   UI should agree that a correct circuit emits within max(inW,outW) steps;
   the UI's per-MEM drain then needs to clamp/extend to the same window), fix
   the divergent side, update CLAUDE.md's SC-drain bullet + spec if touched.
4. **Gates:** all hw3 fixtures must still verify (they are the regression bank
   for this change); `npm run check`, `tsc`, `build` green.

**Acceptance:** a written statement of the single canonical drain semantics
(LOG + CLAUDE.md), the divergent side fixed, an exhibit test (or impossibility
note) checked into `app/tools/` or the harness, all gates green, 0 regressed.

## Then

P1.7 (harness: breadth + drain bars, statement lint, promote
`scratchpad/routecheck_near.ts` to `app/tools/`) → P1.4 (HW4 FSM arithmetic,
with its META-visual-vocab first step) → P1.8 (router design memo; gates
Phase 3) → P1.5/P1.6 → Phase 2.

## Watch out for

- **P1.9 is the first app-code change of the loop** — route it through the
  seams (engine/codec vs store), keep it small, and update CLAUDE.md (its
  maintenance rule) — that also starts META-reconcile-claude.
- **Ops:** 529 outages → `Workflow({scriptPath, resumeFromRunId})`; subagent
  session limit can hit (resets were ~4:50am) — critical verification can be
  finished solo with preview tools.
- **Appearance seeding recipe v3** (LOG iteration 4): reload → land on Home →
  seed `mm:inst-asg:<id>` + `mm:asg:<id>` → click-navigate. Never
  seed-then-reload. Base path `/making-minds/`. Clean up keys twice.
- **Layout oracle:** run `scratchpad/routecheck_near.ts <fixture.json>` on any
  new/edited CC/SC fixture before the browser sweep.
- `tsx` missing after checkout → `npm install`; no lockfile churn commits.
