# Handoff — the hot state

_Read this first. It says exactly where we are and what to do next. Rewrite it at
the end of every iteration. If it conflicts with the harness, the harness wins —
run `npm run coverage` and reconcile._

## Where we are

Branch `buildout-infra`. **46 exact + 9 interface = 55/56 at-tier**, 1 pending
(hw6-p2 Desert Ant), 0 regressed, 0 warnings. Twenty-four iterations done.
Iteration 24 landed ALL NINE navigation rows at interface tier (scores
reported: hw2 2/2, 2/2, 0/2 — the last is the course answer, no memoryless CC
takes the Z's opposite turn; hw3 2/2, 3/3, 1/3; hw4 2/2, 2/2, 3/3) AND fixed
the pass-through grading defect the batch exposed: `criterionRequiresStop()`
in the engine — pass-through is trace-satisfiable (HW2 §III Pac-Man rule),
the step limit bounds simulation, not success; stop-requiring criteria
byte-identical; 7 new pins + the 12 [multi-arena] pins green; spec §12.5
records the rule; server gates green.

## ⚠ SCOPE SHIFT (user directive 2026-07-06)

The one remaining row (hw6-p2) is tier `interface`: the capstone is an
INTERFACE proof, not a solved Desert Ant. Free correct machines excepted.

## Do this next — P5.1: the Desert Ant capstone (the LAST row)

hw6-p2 (problem sets/hw6.pdf, problem 2): TM-brained turbot, 30×30 arena,
food in the NE quadrant, ≤20 tape cells; criteria per the manifest row
("find food (NE), pass over, return to start" — check the PDF's exact task
and the manifest note). Deliverable at interface tier:
- A 30×30 arena FAMILY (vary food placement within the NE quadrant + maybe
  start pose) in `turbot_cases`; pick the criterion the PDF's statement
  actually promises (food leg = pass-through vs return-to-start with
  goal-visit per the P4.2 clause) — READ THE PDF first.
- A plausible **turbot-TM** brain within the 20-cell tape budget: internal
  (circle) states doing single {0,1,*} tape ops + external (square) states
  sensing B/E/F with ↑/↱/↰ moves (engine/turbot.ts runBrainStep TM branch;
  validateTurbotTM(…, notation); devData has a TM-turbot sample to model —
  check `sampleData.ts`). It must validate Stage-1, step in the arena, and
  grade end-to-end across the family; whether it FINDS the food is reported,
  not required.
- Fixture { question, correct }; wire the manifest row; harness → 46 exact +
  10 interface + 0 pending; appearance check (arena Map + the TM brain canvas
  incl. the read-only TurbotTapePanel below the canvas + internal/external
  state shapes per VISUAL_VOCAB §turbot-TM).
One build agent + verifier + appearance (the P4.3 pattern, scaled to one
row). Then the ledger is COMPLETE AT-TIER — the loop moves to close-out.

## Then (close-out sequence)

Smalls: P1.5 allowed_components (the one remaining grading-integrity gap),
P1.6 cc.ts label-order, P1.11 ARG multi-group, P1.16 rotated-MEM labels,
P1.8 leftovers (INPUT toggle-tab obstacles; hw3-p9 dot-skip nit; S4
optional). Then P6.1 full-matrix appearance sweep (its scope now includes
the iteration-24 app-wide observations: arena-turbot color vs vocab, FSM
live-state highlight during arena runs, SC palette header), P6.2 final
reconciliation (every row green AT ITS TIER + all gates + CLAUDE.md honest),
P6.3 server↔engine parity pin, P6.4 Remote-store cutover (Gabriel's timing).
META-audit-queue due ~iteration 28.

## Watch out for

- **Fetch main + `git status` for foreign WIP at the START of every
  iteration** (memory: project-shared-worktree-concurrency). ⚠ Gabriel
  started the task_2cd0dbea chip (pass-through grading) AFTER the fix was
  already in-tree — it was flagged to him as redundant; if a stray session
  re-touches grader.ts/turbot.ts, reconcile against the committed fix.
- **Judge gates by EXIT CODE** — piping `npm run check` through grep/tail
  swallowed a routerCheck failure this iteration (the verifier caught it).
- **Runaway fix agents:** hard bar + stop rule (iteration-20 template); the
  iteration-24 layout fix honored it (one move+rotate, 0 fallbacks, no pin
  edits).
- **Interface tier:** scores reported, never asserted; free correct machines
  excepted. Interface rows show ◐ and never count toward exact totals.
- **routerCheck budget = 2** (hw3-p9's one pinned wire). New fixtures route
  fallback-free or get pinned deliberately. MEM rotation (270°) is the
  standard fix for feedback-lane congestion.
- **criterionRequiresStop** is the criterion-semantics seam: new criteria
  must be classified there; the step limit bounds simulation only.
- **Perception grades OUTSIDE the codec**; Stage-1 mirror in lockstep with
  gradeQuestion's dispatch (open → perception → turbot → codec).
- **Server exists:** engine changes must keep `server npm run check` green
  (cross-package import); `server/` needs its own `npm install`.
- **notationCheck grep gate**, **scWindowCheck**, **tmCheck**,
  **turbotCheck**, **perceptionCheck**, **bumpCheck**, **navResetCheck**,
  **serverCheck** all green.
- **Ops:** 529/overload → `Workflow({scriptPath, resumeFromRunId})` (worked
  again this iteration: 8 cached, 1 re-ran); commit landed slices early;
  serial browser work = ONE agent; appearance recipe v3 (seeds from
  `app/public/`, clean keys twice, delete seed JSONs + dist copies).
- `tsx` missing → `npm install`; no lockfile churn.
