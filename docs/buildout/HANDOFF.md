# Handoff — the hot state

_Read this first. It says exactly where we are and what to do next. Rewrite it at
the end of every iteration. If it conflicts with the harness, the harness wins —
run `npm run coverage` and reconcile._

## Where we are — 🏁 CLOSE-OUT DONE pending Gabriel-gated items

Branch `buildout-infra`. **46 exact + 10 interface = 56/56 at-tier**, 0
pending, 0 regressed, 0 warnings. Twenty-nine iterations. Every
machine-buildable problem in HW1–HW6 has a verified reference fixture:
- **Exact tier (46):** all arithmetic (HW1–HW5) + all perception — correct
  machine passes every case, broken variant fails, appearance checked.
- **Interface tier (10):** all navigation + the Desert Ant capstone —
  plausible attempts validate Stage-1 and grade end-to-end; scores reported,
  never asserted (2/2, 2/2, 0/2, 2/2, 3/3, 1/3, 2/2, 2/2, 3/3, and the
  capstone's 1/3). Exactly-correct answers remain the separate future
  correct-answers project.

**Iteration 29 (2026-07-08) ran the combined META-audit-queue + P6.2 final
reconciliation:** all gates fresh BY EXIT CODE (app tsc 0 · every check tool
individually 0 · build 0 · server typecheck 0 + serverCheck 0), COVERAGE.md
cross-checked against the harness JSON row-by-row by script (0 mismatches),
CLAUDE.md caught up (iterations 27–28 documented; key-files rows honest),
queue pruned honest, NO patch-accumulation cluster in the window (all fixes
seam-routed). **There is no loop-actionable work left.**

## What remains (exactly this — all gated or optional)

1. **P6.1b** _(GABRIEL'S CALL)_ arena turbot red `#c73535` vs VISUAL_VOCAB
   yellow — one-line fix either way once answered (asked 2026-07-07).
2. **P6.3** server↔engine grading parity pin + fold server gates into CI.
3. **P6.4** _(GABRIEL'S TIMING)_ Remote-store cutover to `api/client.ts`.
4. **Optionals, unowned:** P1.8 S4 (router fallback phase-0 + lane-nudge +
   per-wire `usedFallback`; S5 perf), P4.4 (turbot sandbox tab), P4.5
   (category taxonomy).
5. **Recurring META:** META-audit-queue (~every 5 iterations; last ran 29;
   now also owns CLAUDE.md honesty — META-reconcile-claude retired as a
   duplicate), META-visual-vocab (before any new mode's appearance work).
P2.5 is CLOSED as deferred (correct-answers project — not loop-open).

## Watch out for (standing)

- **Fetch main + `git status` for foreign WIP at the START of every
  iteration** (memory: project-shared-worktree-concurrency).
- **Judge gates by EXIT CODE**, never a piped tail.
- **Runaway fix agents:** hard bar + stop rule in every fix-agent prompt.
- **Interface tier:** scores reported, never asserted; free correct machines
  excepted. ◐ rows never count toward exact totals.
- **routerCheck budget = 2**; new fixtures route fallback-free or get pinned
  deliberately; MEM rotation 270° is the standard feedback-lane fix.
- **criterionRequiresStop** is the criterion-semantics seam (step limit
  bounds simulation, not success).
- **Perception grades OUTSIDE the codec**; coverageCheck's Stage-1 mirror in
  lockstep with gradeQuestion's dispatch (open → perception → turbot →
  codec).
- **Server:** engine changes must keep `server npm run check` green;
  `server/` needs its own `npm install`.
- **Appearance recipe v3**; seeds from `app/public/` at `/making-minds/`;
  clean keys twice (a debounced autosave can re-write a seed key once —
  remove again on a fresh Home load); delete seed JSONs + dist copies.
- 529/overload → `Workflow({scriptPath, resumeFromRunId})`; `tsx` missing →
  `npm install`; no lockfile churn.
