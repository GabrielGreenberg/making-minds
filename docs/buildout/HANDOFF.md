# Handoff — the hot state

_Read this first. It says exactly where we are and what to do next. Rewrite it at
the end of every iteration. If it conflicts with the harness, the harness wins —
run `npm run coverage` and reconcile._

## Where we are — 🏁 THE LEDGER IS COMPLETE AT-TIER

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

The /handoff completion criterion is met; the loop PARKED itself after this
iteration (no auto-reschedule). Resume with `/loop /handoff` (or run
`/handoff` once per task) for the close-out queue below.

## What remains in the queue (close-out, in order)

1. **P1.5 allowed_components** — the ONE remaining grading-integrity gap: the
   field is unenforced (a student can pass hw1-p2's "no OR gate" using an OR
   gate). Three-touchpoint slice: Stage-1 check in machineValidation +
   ComponentLibrary palette filter + QuestionCreator authoring.
2. **Smalls:** P1.6 cc.ts label-order helper; P1.11 ARG multi-group
   rendering; P1.16 rotated-MEM label placement; P5.2 arena-editor 20×20 cap
   (capstone's 30×30 not UI-authorable); P5.3 reason-less criterion failures;
   P1.8 leftovers (INPUT toggle-tab obstacles; hw3-p9 dot-skip nit; S4
   optional).
3. **P6.1** full-matrix appearance sweep (scope includes: arena-turbot red
   `#c73535` vs VISUAL_VOCAB's yellow — decide which is right; FSM
   live-state highlight during arena runs; SC palette header label; 30×30
   Map panel UX).
4. **P6.2** final reconciliation (all gates + CLAUDE.md honest + this file).
5. **P6.3** server↔engine grading parity pin + server in CI. **P6.4**
   Remote-store cutover (Gabriel's timing).
META-audit-queue due ~iteration 28 if the loop resumes.

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
