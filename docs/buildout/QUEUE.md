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
- [x] **P0.4** **Prove the fixture path end-to-end.** — _done 2026-07-06._
  hw1-p1 NAND authored **headlessly in code** (`builder.ts` helpers, proven with
  `gradeQuestion` before writing `reference/hw1-p1.json`; broken = NOT dropped);
  browser used only for the appearance check. Harness: 1/56 verified. This is the
  template every later fixture follows — see LOG 2026-07-06 for the recipe.

## Phase 1 — CC + SC arithmetic baseline (prove "all built" for the easy path)

- [x] **P1.1** Reference solutions for **HW1 logic** (hw1-p2…p5) + **HW1 synthesis**
  (hw1-p16 M, hw1-p17 N). — _done 2026-07-06 (workflow batch: spec-from-PDF → 6
  parallel build+prove → wire → 6 adversarial verifiers + gates + appearance
  sweep → critic; 7/7 HW1 verified, 0 refutations)._ hw1-p2 sets
  `allowed_components` but the field is unenforced → spawned P1.5.
- [ ] **P1.2** Reference solutions for **HW2 CC arithmetic** (hw2-p1…p7).
  **Advances:** hw2-p1..p7.
- [ ] **P1.3** Reference solutions for **HW3 SC arithmetic** (hw3-p1…p9, incl. the
  three feasible tally items). Confirm SC pipeline-drain behaviour on carries.
  **Advances:** hw3-p1..p9.
- [ ] **P1.4** Reference solutions for **HW4 FSM arithmetic** (hw4-p3…p11).
  **Advances:** hw4-p3..p11.
- [ ] **P1.5** _(discovered 2026-07-06, hw1-p2 critic)_ **Enforce
  `allowed_components` end-to-end.** The field exists on `AssignmentQuestion`
  (types.ts:139) but is read by NOTHING — a student can pass hw1-p2 ("no OR
  gate") using an OR gate. The family: question-level component restrictions
  have three touchpoints that must agree — (1) grading: a Stage-1 check in
  `engine/machineValidation.ts` rejecting machines containing component types
  outside the allowed set; (2) student UI: `ComponentLibrary` palette filtered
  to the allowed set; (3) instructor authoring: expose the field in
  `QuestionCreator` (already a deferred follow-up in CLAUDE.md). Do all three as
  one seam-respecting slice, not a grader-only patch.
  **Acceptance:** a correct-function OR-using machine FAILS hw1-p2 grading (add
  a second broken variant or a harness case proving it); palette hides OR on
  hw1-p2; creator can author the restriction; all gates green.

## Phase 2 — TM two-output visual change  _(the one deliberate departure)_

- [ ] **P2.1** TM transitions: one-input → **two-output** notation (write + move).
  **Depth check first (design memo):** the app already has *four* transition
  grammars scattered as string conventions through the canvas/store (FSM `0:1`,
  TM `1:0R`, turbot-TM internal `0:1`/`1:L`, turbot-TM external `E:↑`) — this
  task is one instance of that family. The deep solution is a per-mode
  **transition-notation module** (parse / validate / render / edit as one
  pluggable unit) that all four grammars implement; the TM two-output form then
  becomes a notation swap, not a scatter-edit. Write
  `designs/transition-notation.md` weighing this against the shallow
  string-change; implement at the chosen depth. Touch points either way:
  `engine/tm.ts` (`parseTMTransition`/`parseTMAction`), `tmValidate.ts`, the
  label editor in `CircuitCanvas.tsx` (~1200–1510), `FsmTransitionView`;
  migrate devData/fixtures; update VISUAL_VOCAB + spec §10.3.
  **Acceptance:** `tmCheck` + `coverage` self-test green; TM editor shows two
  outputs; a TM reference (hw5-p1) still grades.
- [ ] **P2.2** Reference solutions for **HW5 TM arithmetic** — tally (hw5-p1…p6),
  binary (hw5-p7…p9). Expose/verify standard-position halting acceptance
  (`requireStandardHaltPosition`) where the problems require it; TM boxing if
  reuse (x+3 from x+1, …) demands it.
  **Advances:** hw5-p1..p9.

## Phase 3 — Perception

- [ ] **P3.1** **Design spike (decision required, design memo):** can perception
  targets (≥3 consecutive 1s; exactly 3; = a literal pattern; current≠previous;
  motion) be authored? The family: a question's **target function** currently has
  exactly one representation — an arithmetic formula over integer values. The
  deep framing is a unified target-function abstraction with multiple
  *specification forms* (arithmetic formula | pattern predicate | explicit
  table…) behind one interface that `buildQuestionBank`/the grader consume —
  perception then becomes a second form, not a bolted-on question type. Compare
  that against (a) extending the DSL with predicate operators and (b) a separate
  truth-table question type; pick the deepest option the actual HW2/HW3
  perception problems warrant. Write `designs/target-functions.md` + the
  decision into this queue before building. **Advances:** unblocks P3.2–3.3.
- [ ] **P3.2** CC perception (hw2-p10…p12), incl. reconciling the 8-in schematic
  with the 9-bit landmark pattern. **Advances:** hw2-p10..p12.
- [ ] **P3.3** SC perception (hw3-p11, p12) — spatio-temporal, 8 parallel inputs.
  **Advances:** hw3-p11, p12.

## Phase 4 — Navigation

- [ ] **P4.1** **FSM-turbot motor: 2-bit outputs.** A 1-bit Mealy output can't
  encode L/R turns, but HW4 navigation needs F/S/R/L (see `runBrainStep` in
  `engine/turbot.ts`). **Depth check:** is this one instance of "FSM transition
  outputs are single-bit" generally (would multi-bit FSM outputs also serve
  arithmetic problems with wider outputs, and unify with how the codec handles
  output groups on the time axis)? If yes, generalize FSM output arity once
  rather than special-casing the turbot brain; note the choice (memo if it grows
  architectural). **Acceptance:** an FSM turbot can turn; `turbotCheck` green.
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
  tasks; re-rank by dependency and value; confirm no drift. **Also audit for
  patch accumulation:** look for clusters of surgical fixes that landed since the
  last audit and share a family — if found, enqueue one unifying architectural
  task (with a design memo) to replace the cluster's trajectory. Log what changed.
- [ ] **META-visual-vocab** — before starting a new mode's appearance work, re-read
  the relevant `mm_textbook.pdf` chapter + `spec/…/Mock_Ups-*.jpg`; refresh
  VISUAL_VOCAB.
- [ ] **META-reconcile-claude** — keep `CLAUDE.md`'s status section honest against
  COVERAGE (it currently claims "all built"; downgrade any claim a reference
  solution can't back up).
