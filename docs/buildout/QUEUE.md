# Task Queue

_Ordered, atomic tasks. The loop takes the top unblocked `todo`, works it end to
end (build → adversarially verify → update docs → commit), then re-plans. Every
task names an **acceptance** criterion and the **COVERAGE** rows it advances._

**Status:** `todo` · `doing` · `done` · `blocked`.
**Rule:** finish one mode/category *vertical* before broadening. Default walk:
CC → SC → FSM → TM → turbot; within a mode: arithmetic → perception → navigation.

---

## Phase 0 — Stand up the system  _(this branch)_

- [x] **P0.1** Scaffold `docs/buildout/*`, seed COVERAGE (56 rows) + this queue +
  VISUAL_VOCAB. — _done (bootstrap commit)_
- [x] **P0.2** Build `tools/coverageCheck.ts` + `coverage-manifest.json` + fixture
  format; wire `npm run coverage` / `npm run check`. Self-test discriminates
  across all 5 modes. — _done_
- [x] **P0.3** Write `.claude/commands/handoff.md`. — _done_
- [ ] **P0.4** _(first loop iteration)_ **Prove the fixture path end-to-end.**
  Author + build a reference solution for the simplest CC problem (**hw1-p1 NAND**)
  by constructing it in the running app and exporting `CircuitData`; add
  `broken` variant; wire the fixture into the manifest.
  **Acceptance:** `npm run coverage` shows `hw1-p1` `verified`; COVERAGE row ✅.
  **Advances:** hw1-p1. This is the template every later fixture follows.

## Phase 1 — CC + SC arithmetic baseline (prove "all built" for the easy path)

- [ ] **P1.1** Reference solutions for **HW1 logic** (hw1-p2…p5) + **HW1 synthesis**
  (hw1-p16 M, hw1-p17 N). Note hw1-p2 must set `allowed_components` without OR.
  **Advances:** hw1-p2..p5, p16, p17.
- [ ] **P1.2** Reference solutions for **HW2 CC arithmetic** (hw2-p1…p7).
  **Advances:** hw2-p1..p7.
- [ ] **P1.3** Reference solutions for **HW3 SC arithmetic** (hw3-p1…p9, incl. the
  three feasible tally items). Confirm SC pipeline-drain behaviour on carries.
  **Advances:** hw3-p1..p9.
- [ ] **P1.4** Reference solutions for **HW4 FSM arithmetic** (hw4-p3…p11).
  **Advances:** hw4-p3..p11.

## Phase 2 — TM two-output visual change  _(the one deliberate departure)_

- [ ] **P2.1** Change TM transition notation from `input:action` (`1:0R`) to the
  one-input → **two-output** form (write output + move output). Touch
  `engine/tm.ts` (`parseTMTransition`/`parseTMAction`), `tmValidate.ts`, the
  transition label editor in `CircuitCanvas.tsx` (~1200–1510), the render
  (`FsmTransitionView`); migrate devData/fixtures; update VISUAL_VOCAB + spec §10.3.
  **Acceptance:** `tmCheck` + `coverage` self-test green; TM editor shows two
  outputs; a TM reference (hw5-p1) still grades.
- [ ] **P2.2** Reference solutions for **HW5 TM arithmetic** — tally (hw5-p1…p6),
  binary (hw5-p7…p9). Expose/verify standard-position halting acceptance
  (`requireStandardHaltPosition`) where the problems require it; TM boxing if
  reuse (x+3 from x+1, …) demands it.
  **Advances:** hw5-p1..p9.

## Phase 3 — Perception

- [ ] **P3.1** **Design spike (decision required):** can perception targets
  (≥3 consecutive 1s; exactly 3; = a literal pattern; current≠previous; motion) be
  authored? Compare (a) extending the arithmetic DSL with predicate/pattern
  operators vs. (b) a separate pattern/truth-table question type. Write the
  decision into this queue + NORTH_STAR before building. **Advances:** unblocks P3.2–3.3.
- [ ] **P3.2** CC perception (hw2-p10…p12), incl. reconciling the 8-in schematic
  with the 9-bit landmark pattern. **Advances:** hw2-p10..p12.
- [ ] **P3.3** SC perception (hw3-p11, p12) — spatio-temporal, 8 parallel inputs.
  **Advances:** hw3-p11, p12.

## Phase 4 — Navigation

- [ ] **P4.1** **Fix the FSM-turbot 2-bit motor.** A 1-bit Mealy output can't
  encode L/R turns, but HW4 navigation needs F/S/R/L (see `runBrainStep` in
  `engine/turbot.ts`). Widen the FSM-brain transition output to a 2-bit motor
  command. **Acceptance:** an FSM turbot can turn; `turbotCheck` green.
- [ ] **P4.2** **Multi-arena navigation grading** for unknown distance/position
  (Mad Max, Way Finder, Desert Ant): put a *family* of arenas in `turbot_cases`;
  confirm the grader requires all to pass. **Acceptance:** a single-layout-only
  solution fails the family.
- [ ] **P4.3** Author the specific arenas + reference brains: CC nav (hw2-p13…p15),
  SC nav (hw3-p13…p15), FSM nav (hw4-p12…p14). **Advances:** those 9 rows.
- [ ] **P4.4** Add a **turbot sandbox** tab (currently turbot only exists inside
  assignments; `TabBar` lists CC/FSM/TM only). Optional but eases authoring/appr.
- [ ] **P4.5** _(optional)_ Wire the perception/navigation **category taxonomy**
  (`ActiveTask` is typed but unused) to organize questions / gate palettes.

## Phase 5 — TM-turbot capstone

- [ ] **P5.1** **Desert Ant** (hw6-p2): TM-brained turbot, 30×30 arena, ≤20 tape
  cells, unknown start + food in NE quadrant; verified over a family of configs.
  **Advances:** hw6-p2.

## Phase 6 — Close out

- [ ] **P6.1** Full-matrix appearance sweep against VISUAL_VOCAB (every mode).
- [ ] **P6.2** Reconcile CLAUDE.md status with COVERAGE; final `npm run check` +
  `tsc` + `build` all green; every COVERAGE row ✅.

---

## Recurring meta-tasks  _(fire on cadence; keep the queue honest)_

- [ ] **META-audit-queue** — _every ~5 iterations._ Run `npm run coverage`;
  reconcile COVERAGE + this queue against the harness JSON; prune dead/duplicate
  tasks; re-rank by dependency and value; confirm no drift. Log what changed.
- [ ] **META-visual-vocab** — before starting a new mode's appearance work, re-read
  the relevant `mm_textbook.pdf` chapter + `spec/…/Mock_Ups-*.jpg`; refresh
  VISUAL_VOCAB.
- [ ] **META-reconcile-claude** — keep `CLAUDE.md`'s status section honest against
  COVERAGE (it currently claims "all built"; downgrade any claim a reference
  solution can't back up).
