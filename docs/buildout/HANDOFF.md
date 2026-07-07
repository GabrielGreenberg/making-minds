# Handoff — the hot state

_Read this first. It says exactly where we are and what to do next. Rewrite it at
the end of every iteration. If it conflicts with the harness, the harness wins —
run `npm run coverage` and reconcile._

## Where we are — 🏁 LEDGER COMPLETE AT-TIER · close-out in progress

Branch `buildout-infra`. **46 exact + 10 interface = 56/56 at-tier**, 0
pending, 0 regressed, 0 warnings. Twenty-five iterations. Every
machine-buildable problem in HW1–HW6 has a verified reference fixture:
- **Exact tier (46):** all arithmetic (HW1–HW5) + all perception — correct
  machine passes every case, broken variant fails, appearance checked.
- **Interface tier (10):** all navigation + the Desert Ant capstone —
  plausible attempts validate Stage-1 and grade end-to-end; scores reported,
  never asserted (2/2, 2/2, 0/2, 2/2, 3/3, 1/3, 2/2, 2/2, 3/3, and the
  capstone's 1/3). Exactly-correct answers remain the separate future
  correct-answers project.

Gabriel resumed the loop for close-out (iteration 26+). The grading-integrity
gap (P1.5) is CLOSED; the remaining queue is polish + final sweeps.

## What remains in the queue (close-out, in order)

1. ~~P1.5~~ **DONE (iteration 26)** — allowed_components enforced end-to-end
   (Stage-1 all grader branches + palette + creator; 6 pins; boxed recursion).
2. **NEXT — the smalls sweep (one batch iteration):** P1.6 cc.ts label-order
   helper; P1.11 ARG multi-group rendering; P1.16 rotated-MEM label
   placement; P5.2 arena-editor 20×20 cap (capstone's 30×30 not
   UI-authorable); P5.3 reason-less criterion failures; P1.8 leftovers (INPUT
   toggle-tab obstacles in the router obstacle model; hw3-p9 (1375,757)
   dot-skip nit re-evaluation; S4 optional). Each is small and independent —
   a parallel workflow (one agent per small, gates + verifier after) fits one
   iteration; browser-check the UI-visible ones (P1.16, P5.2).
3. **P6.1** full-matrix appearance sweep (scope: arena-turbot red vs
   VISUAL_VOCAB yellow — decide; FSM live-state highlight during arena runs;
   SC palette header label; 30×30 Map panel UX).
4. **P6.2** final reconciliation (all gates + CLAUDE.md honest + this file).
5. **P6.3** server↔engine grading parity pin + server in CI. **P6.4**
   Remote-store cutover (Gabriel's timing).
META-audit-queue due ~iteration 28.

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
