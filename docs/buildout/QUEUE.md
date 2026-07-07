# Task Queue

_Ordered, atomic tasks. The loop takes the top unblocked `todo`, works it end to
end (build → adversarially verify → update docs → commit), then re-plans. Every
task names an **acceptance** criterion and the **COVERAGE** rows it advances._

**Status:** `todo` · `doing` · `done` · `blocked`.
**Rule:** finish one mode/category *vertical* before broadening. Default walk:
CC → SC → FSM → TM → turbot; within a mode: arithmetic → perception → navigation.

**⚠ Scope shift (user directive 2026-07-06) — interface over correctness.** All
remaining fixture rows (perception + navigation) are tier **interface**: the
deliverable is that the question is authorable and a **plausible attempt**
builds, validates, and grades end-to-end. Its score is reported, not asserted;
no broken variant is needed. Do NOT spend tokens hunting exactly-correct
solutions (Way Finder, Mad Max, Desert Ant, motion detector…) — that is the
future correct-answers project. If a correct machine happens to be trivial
(e.g. the HW4 zig-zag example FSM is printed in the problem set), take it, but
never at the cost of an answer-search.

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
- [x] **P1.2** Reference solutions for **HW2 CC arithmetic** (hw2-p1…p7). — _done
  2026-07-06 (19-agent workflow + cleanup agent; banks authored via the production
  `buildQuestionBank` path; hw2-p7 = 256-case ripple adder; hw2-p6 exercises BOXED
  reuse of the +1 circuit; 0 refutations; appearance 7/7 after a topo-depth
  re-layout of p7)._ Spawned P1.6 (cc.ts label-ordering duplication).
- [x] **P1.3** Reference solutions for **HW3 SC arithmetic** (hw3-p1…p9, incl. the
  three feasible tally items). — _done 2026-07-06 (23-agent workflow, resumed twice
  through 529 outages, + 6-agent layout-fix workflow + manual finish when the
  subagent session limit hit; 0 refutations; drain confirmed on carries; appearance
  9/9 after re-layouts — see LOG iteration 4 for the router lessons)._ Spawned
  P1.7–P1.9.
<!-- Reordered by META-audit-queue 2026-07-06 (iteration 5): P1.9 and P1.7 precede
P1.4 because both de-risk the time-axis/sampled-bank FSM batch; P1.8 must land
before Phase 3 (perception returns to router-rendered CC/SC). Task ids unchanged. -->
- [x] **P1.9** **Reconcile UI-vs-grader drain semantics.** — _done 2026-07-06
  (iteration 6; three fix rounds, each adversarially verified — rounds 1 and 2
  were refuted with real exhibits before round 3 passed)._ The bug was real in
  BOTH directions (tally machine +1 redundant delay: UI showed correct on every
  value, grader 1/9; post-window garbage: grader 16/16, UI looked broken; FSM
  ran zero drain steps). **Canonical semantics: the codec window**
  (`stepCountFor = max(inW,outW)`); grader untouched; UI question runs now
  execute exactly the window, feed the codec's own `encodeInput` stream (typed
  input parsed as a VALUE — fixes tally alignment), and clamp the A/V decode to
  the grader's window; sandbox unchanged (SC L+#MEM, FSM L). FSM typed input is
  now a numeral (MSB-left) like SC/ARG; FSM OUT rows render t1-rightmost per
  VISUAL_VOCAB. All pinned by `app/tools/scWindowCheck.ts` (45 checks, wired
  into `npm run check`). Spawned P1.10, P1.11.
- [x] **P1.7** **Harness hardening: breadth/drain/statement/layout bars.** —
  _done 2026-07-06 (iteration 7; adversarial verifier proved every bar bites by
  MUTATION on the real ledger path — refuted nothing)._ `coverageCheck.ts` now
  prints per-row broken-fail fractions (WARN <25% on sampled SC/FSM/TM banks;
  info-only on exhaustive CC — hw2-p6's 1/16 narrow near-miss stays green by
  policy), warns when an SC/FSM bank lacks a drain witness (all 9 SC banks have
  one), hard-FAILs statement-lint violations (shorthand prefixes, answer
  giveaways), and hard-FAILs layout violations for CC/SC fixtures via the
  promoted `tools/layoutCheck.ts` (real-router oracle, CLI + harness). Five
  synthetic self-test tripwires prove the checks check. Surprise: hw2-p6,
  hw2-p7 (broken machine), hw3-p4 were NOT oracle-clean (predated the strict
  oracle) — repositioned, position-only, regrades unchanged. Accepted minors
  (LOG): bars key off manifest mode (consistency untested), lint regex scoped
  to x/y variables.
- [x] **P1.4** Reference solutions for **HW4 FSM arithmetic** (hw4-p3…p10; p11
  blocked). — _done 2026-07-06 (iteration 8; 23-agent workflow incl. the
  META-visual-vocab FSM refresh — textbook ch. 22 corrected the initial-state
  rule: NO incoming-arrow marker, S₀ by name alone). 8 fixtures verified, 0
  refutations, 0 warnings; 31/56._ Remainders: **hw4-p11 BLOCKED** (single-bit
  FSM grammar + grader feeds wire 0 only → P1.12); hw4-p8/p9/p10 grading-✅ but
  appearance-blocked on the coincident-arc renderer defect (→ P1.13).
- [x] **P1.12** **Transition-notation design memo + FSM multi-bit alphabet.** —
  _done 2026-07-06 (iteration 9)._ Judge-panel design (3 angles) → **seam-first
  won**: `engine/notation.ts` owns transition-label SYNTAX for all four
  grammars behind one `TransitionNotation` interface; FSM is k-bit native
  (`fsmNotation(inBits,outBits)`, legacy (1,1) byte-compatible); TM/turbot
  parsers untouched behind delegating adapters; editor token fields read the
  seam for all four grammars. Landed as four staged commits (739fcfc..5244276),
  each gates-green. hw4-p11 (k=2 serial adder) **fully verified incl.
  appearance + k=2 editor** → **32/56**. Footgun dead (2-input FSM questions
  fail Stage-1 loudly; verifier proved it previously mis-graded). Adversarial
  verification: byte-identical verdicts for all 31 prior fixtures vs a pristine
  worktree; bit-order pinned from both sides. `tools/notationCheck.ts` (incl. a
  grep gate keeping label dissection inside the seam) added to `npm run check`.
  Memo postscript records two deliberate deviations (runBrainStep flip pulled
  forward for the alias-decay rule; P1.10 folded in). **P2.1 is now a notation
  swap; hw4-p12–14's 2-bit motor labels are already executable.**
- [x] **P1.13** **FSM renderer: coincident opposite-direction arcs.** — _done
  2026-07-06 (iteration 10)._ Root cause: the side-sign AND the per-wire perp
  frame both flip for opposite wires, cancelling to one world point. Fix: each
  auto arc bows left of its own travel direction (distance-scaled, stacking);
  explicit `fsmControlPt` always wins (hw4-p11 byte-identical before/after);
  self-loops + same-direction pairs untouched. Six-machine browser re-sweep
  6/6 with DOM control-point separation evidence; all gates green; UI-only
  diff. hw4-p8/p9/p10 appr → ✅ (HW4 arithmetic complete).
- [x] **P1.10** **Sandbox FSM feed direction.** — _done 2026-07-06, folded into
  P1.12 commit f896943 (the same `fsmStep` lines were being rewritten; the
  scWindowCheck sandbox pin — which had pinned the bug via a palindrome — was
  repointed to the fixed rightmost-char-=-t1 behavior)._

## Phase 2 — TM two-output visual change  _(the one deliberate departure)_

- [x] **P2.1** **TM two-output notation swap.** — _done 2026-07-06 (iteration
  12)._ Canonical stored form **`read:write,move`** (`1:0,R`); canvas renders
  read │ write,move; editor = one input field + two output fields; machine
  table gains separate WRITE/MOVE columns. Legacy `1:0R` parses forever as an
  alias and decays on edit-save (no migration needed; devData migrated anyway).
  `tmNotation(rep)` is native in the seam (adapter deleted;
  `parseTMTransition`/`parseTMAction` removed from tm.ts — the grep gate got
  STRONGER); `validateTMTable` folded onto the generic walker with a
  `TableError.kind`. Engine semantics unchanged (atomic write+move) — verified
  by byte-equal traces vs a pre-swap worktree AND across spellings; two-output
  editor + rep-tied `*` + live sim verified in-browser. Recorded in
  VISUAL_VOCAB §TM, spec §10.3, NORTH_STAR (departure now past tense), design
  memo postscript. All gates green; 32/56 / 0 regressed.
- [x] **P2.2** Reference solutions for **HW5 TM arithmetic**. — _done
  2026-07-06 (iteration 13; 23-agent batch + one fix agent)._ Nine fixtures in
  the new two-output notation; **41/56**; appearance 9/9; ONE refutation caught
  and cured: hw5-p4's first correct machine was gap=1-only — rebuilt as a
  6-state gap-robust shift-until-adjacent machine, proven on hand-laid tapes at
  gaps 1–10 (old machine's failure regression-pinned). Tally banks hand-set to
  the PDF domain x,y ≥ 1 (0-blocks invisible); p8's max(0,x−1) hand-authored
  (DSL can't express it); no TM boxing mechanism exists (reuse flat-inlined,
  grading functional). Spawned P2.3 + P2.4.
- [x] **P2.3** **Wire `requireStandardHaltPosition` into grading +
  authoring.** — _done 2026-07-06 (iteration 14)._ Question field → `gradeTape`
  AcceptOptions → `acceptTM`; TM-only checkbox in QuestionCreator (round-trip
  verified in-browser); hw5-p1..p8 flagged per their statements (p9 correctly
  unflagged — it promises cleanup, not position; mapping fully audited by the
  verifier). hw5-p8's broken fraction improved 15/16 → 16/16 exactly as
  predicted; the HEAD-worktree ledger diff shows that as the ONLY change.
  Three end-to-end tmCheck pins (flag absent passes / flag set fails with
  "rightmost cell" reasons / standard-position machine passes flagged). This
  closes the first of CLAUDE.md's two deferred authoring follow-ups (only
  `allowed_components` = P1.5 remains).
- [x] **P2.4** **Codec: vary tally block separation.** — _done 2026-07-06
  (iteration 15)._ `TestCase.separations?: number[]` (gap after each block,
  absent = legacy single cell), honored solely inside `encodeTM` (grader passes
  it through opaquely; other axes ignore it; TM UI runs never touch encodeTM —
  students hand-lay tapes, so no parity issue). hw5-p4's bank: 64 cases at gaps
  1/2/3/5 (16 each; gap-1 cases omit the field so the default path stays
  exercised). Teeth proven twice over: the pinned old machine AND the
  verifier's independently-constructed gap=1-only adder both fail exactly the
  48 varied cases through gradeQuestion; default-path verdicts byte-identical
  across 6 fixtures vs a HEAD worktree. Six new tmCheck [separations] pins;
  README documents the field. Spawned P2.5.

## Phase 3 — Perception

- [~] **P1.8** **Renderer: wire lanes and junction dots.** — _design memo done
  (`designs/wire-routing.md`, judge-panel: MODEL-FIX won 77–65); S1+S2 landed
  2026-07-06 (iteration 16, commits `4e62a7e`, `bdf13b1`); S3–S5 remain._
  **S1 (done):** new `src/componentGeometry.ts` owns rendered dimensions (MEM
  now 50×50, killing the phantom 75×70) + port math, imported by CircuitCanvas
  / wireRouter / layoutCheck (oracle can't desync). Fallbacks 283→99 across the
  23 CC/SC fixtures, all oracle-clean; `tools/routerCheck.ts` (in `npm run
  check`) pins the budget + distribution + MEM.min A*-reachability.
  **S2 (done):** `findDivergencePoints` — multi-branch splits dotted at the
  divergence elbow (consuming canvas-side crossings for bump-collision skip),
  not the source port; 9-case headless corpus.
  **Verified:** adversarial verifier refuted nothing (independent oracle
  reproduction, MEM route probe, dot corpus, no engine changes).
  **⚠ PENDING acceptance (do this next session before S3):** the **browser
  sweep** of the ~72 hw3 routes that MOVED under S1 was not run — the sweep
  agent hit the model limit. Headless legs pass (oracle-clean, budget pinned),
  but confirm in-browser that the moved MEM routes read cleanly (no false
  merges / through-body) and the S2 dots render at elbows, before S3.
  **S3–S5 remaining:** S3 foreign-lane A* cost + H4 near-merge round (kills the
  1px-hug class generally); S4 fallback phase-0 + lane-nudge + per-wire
  `usedFallback`; S5 (optional) perf. Each slice: gates green + layoutCheck
  clean + browser spot-check per the memo's slice plan.
  **Gates Phase 3** (perception fixtures are CC/SC, back on the router).
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
  with the 9-bit landmark pattern. **Interface tier:** the deliverable is the
  *authoring capability* (P3.1's decision) + a plausible attempt per row that
  validates and grades end-to-end; correctness optional (these CC detectors may
  be cheap to get right — take it only if it's genuinely cheap).
  **Advances:** hw2-p10..p12.
- [ ] **P3.3** SC perception (hw3-p11, p12) — spatio-temporal, 8 parallel inputs.
  **Interface tier:** same bar; do not chase a correct motion detector.
  **Advances:** hw3-p11, p12.

## Phase 4 — Navigation

- [x] **P4.1** **FSM-turbot motor: 2-bit outputs.** — _absorbed by P1.12
  (2026-07-06): `turbotFsmNotation` makes canonical 2-bit motor labels
  (`0:01` = pivot left) executable and pinned in turbotCheck; legacy 1-bit
  labels alias + decay. Remaining surface work (palette/glossary vocabulary
  for 2-bit outputs in the turbot editor) rides P4.3's authoring pass._
- [ ] **P4.2** **Multi-arena navigation grading** for unknown distance/position
  (Mad Max, Way Finder, Desert Ant): put a *family* of arenas in `turbot_cases`;
  confirm the grader requires all to pass. **Acceptance:** a single-layout-only
  solution fails the family.
- [ ] **P4.3** Author the specific arenas + plausible brains: CC nav (hw2-p13…p15),
  SC nav (hw3-p13…p15), FSM nav (hw4-p12…p14). **Interface tier:** the arenas
  (from the HW diagrams) + a plausible brain per row that validates, steps in
  the arena, and grades end-to-end. The HW4 zig-zag example machine is printed
  in the problem set — use it; for Way Finder / Mad Max, any good-faith brain
  suffices. **Advances:** those 9 rows.
- [ ] **P4.4** Add a **turbot sandbox** tab (currently turbot only exists inside
  assignments; `TabBar` lists CC/FSM/TM only). Optional but eases authoring/appr.
- [ ] **P4.5** _(optional)_ Wire the perception/navigation **category taxonomy**
  (`ActiveTask` is typed but unused) to organize questions / gate palettes.

## Phase 5 — TM-turbot capstone

- [ ] **P5.1** **Desert Ant** (hw6-p2): TM-brained turbot, 30×30 arena, ≤20 tape
  cells, food in NE quadrant. **Interface tier — the capstone is an INTERFACE
  proof, not a solved Desert Ant:** the 30×30 arena family authors and renders,
  a plausible turbot-TM brain (within the 20-cell tape budget) validates, steps,
  and grades across the family end-to-end. Whether it finds the food is
  reported, not required — a correct Desert Ant is the future correct-answers
  project's flagship, not this one's. **Advances:** hw6-p2.

## Phase 5.5 — Small hardening (slot opportunistically before close-out)

- [ ] **P2.5** _(discovered 2026-07-06, P2.4 probe; **DEFERRED to the
  correct-answers project** per the 2026-07-06 scope shift — this is
  answer-quality work, not interface work)_ **Gap-robust hw5-p5/p6
  reference machines.** Their statements don't promise arbitrary separation
  (the PDF's clause is on P4 only) so the rows are honest as-is — but both
  problems say "use your solution from (4)", whose adder IS gap-robust, and an
  empirical probe showed both reference machines are gap=1-only. Rebuild their
  adder stages on the p4 shift-until-adjacent construction and optionally
  spread `separations` in their banks.
  **Acceptance:** p5/p6 correct machines pass gap 2/3/5 probes; rows stay
  verified.

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
- [ ] **P1.6** _(discovered 2026-07-06, hw2 critic)_ **Unify the IN/OUT
  label-ordering convention in `engine/cc.ts`.** Two separate implementations of
  the same convention: the top-level path orders I/O components via
  `sortByLabel`, while `evaluateBoxedCircuit` binds boxed internals via
  `parseInt(label.replace('IN',''))` — a future relabel/refactor could desync
  them (boxed circuits are now load-bearing: hw2-p6 grades through one). Extract
  one shared label-order helper used by both paths.
  **Acceptance:** single implementation; `npm run check` (incl. hw2-p6 fixture)
  green.
- [ ] **P1.11** _(discovered 2026-07-06, P1.9 round-2 verifier; pre-existing,
  minor)_ **A/V ARG rendering for multi-group questions.** The ARG column
  renders the whole interleaved typed string as ONE numeral — typed "111101"
  (x=2, y=3 on hw3-p9) shows ARG '/' while VAL correctly shows 5. Render
  per-group values ("2, 3") in question mode.
  **Acceptance:** hw3-p6/p9-style questions show per-group ARGs; gates green.

## Phase 6 — Close out

- [ ] **P6.1** Full-matrix appearance sweep against VISUAL_VOCAB (every mode).
- [ ] **P6.2** Reconcile CLAUDE.md status with COVERAGE; final `npm run check` +
  `tsc` + `build` all green; every COVERAGE row green **at its tier** (✅ exact
  for arithmetic, ◐ interface for perception/navigation).

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
