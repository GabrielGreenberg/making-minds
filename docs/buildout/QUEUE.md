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

- [x] **P1.8** **Renderer: wire lanes and junction dots — COMPLETE** _(S4
  landed 2026-07-08, iteration 31: fallback phase-0 pre-classification
  (`isEndpointDoomed`, doomed wires route first and register occupancy; route
  corpus byte-identical across all 62 fixture machines), per-wire
  `usedFallback`/`violation` flags from a read-only H-predicate sweep +
  subtle canvas surfacing (amber dashed halo + tooltip on violations only),
  and a routerCheck §6 regression pin: the P1.3-era hw3-p4 layout (recovered
  from git 0d0c5e5) routes violation-free today. Lane-nudge skipped with
  evidence (sole residual fallback hw3-p9-w21 is oracle-clean); S5 perf
  declined — routing is ~3× faster since S3 and nothing demands more)._
  **Renderer: wire lanes and junction dots.** — _S3 LANDED
  2026-07-07 (the concurrent chip session; commit "Router world model unified
  with the layout oracle", wireRouter.ts + routerCheck.ts + bumpCheck.ts).
  Checked against the acceptance list below: own-endpoint exemption ✓ (budget
  147 → 2, better than the expected ≈3 — hw3-p1/p8's one-off doomed wires
  cured too, hw3-p9's w21 pinned at 2 as genuinely cramped), foreign-lane A*
  cost + near-parallel H1 ✓ (oracle's 3px rule in the cost model + validation),
  H4 bump-drawability round ✓ (undrawable crossings weighted 10× in
  countCrossings + H4 validation with conflict-feedback avoid points — ALL
  CC/SC fixtures now bump-clean incl. hw2-p11's pinned exhibit), bumpCheck
  wired into `npm run check` ✓ (no-arg = manifest sweep). LEFT UNDONE →
  re-enqueued below: INPUT toggle-tab obstacles; the hw3-p9 dot-skip nit
  wasn't re-evaluated._ — _design memo done
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
  **Acceptance sweep (done 2026-07-06, iteration 17):** in-browser sweep of all
  11 CC/SC fixtures with rendered-DOM geometry checks (CTM scale=1) — 237 wires
  (203 across hw3-p1..p9), 0 false merges, 0 through-body, every fan-out dotted
  at its divergence elbow (r=4 #333), no dot at any source port; cleanup
  verified. Two candidates adjudicated non-violations (LOG 17): sub-pixel
  (0.33px) trunk jitter on hw3-p9's own fan-out; one bump-adjacent dot skip at
  hw3-p9 (1375,757) — algorithm-correct, readability nit fed into S3/S4.
  **S3 (done 2026-07-07, chip session):** the router's legality model now
  EQUALS the oracle's — own-endpoint exemption (grid edges carry `blockedBy`
  component attribution; a wire's own source/target bounds don't block edges
  incident to its stub-tip nodes, nor its first/last simplified segments in
  the H2 revalidation — pre-fix, EVERY wire re-tripped H2 and the whole
  circuit silently rerouted twice per route call; routing is ~3× faster now),
  near-parallel (<3px) foreign tracks priced as overlap in A* (per-search
  interval index) and flagged by H1 (fan-out trunks exempt, both per the
  oracle), bump-undrawable crossings weighted 10× in countCrossings + a new
  H4 validation round that feeds exact conflict points back into the re-route
  as overlap-priced avoid points (rip-up-and-reroute memory; edge-fragment
  cost tests are blind to crossings at grid-line intersections), and the A*
  iteration cap scales with grid size (flat 5000 starved honest ~7k-iteration
  paths on the ~30k-node HW3 fixtures). Fallback budget 147 → 2 (hw3-p9 w21
  pinned, genuinely cramped: its only goal approach costs overlap-scale and
  proving it needs ~240k iterations; its fallback is oracle-clean);
  routerCheck pins XOR-in reachability beside MEM.min and prints offender
  wire ids (`getFallbackWireIds`); bumpCheck: all CC/SC fixtures CLEAN (incl.
  the 8 pre-existing failures) + no-arg manifest sweep wired into
  `npm run check`.
  **S3 leftovers — BOTH RESOLVED:** the obstacle-model gap closed in the
  iteration-27 smalls sweep (new `getComponentBounds` footprint seam in
  componentGeometry — body + adjuncts incl. INPUT's 14×20 toggle-tab; the
  router's local body-only copy deleted); the hw3-p9 (1375,757) dot-skip nit
  resolved POSITIVE in the iteration-28 sweep (the divergence dot now renders
  at the junction — S3's re-routing fixed the bump adjacency, no skip-radius
  tuning needed). **S4 remaining (OPTIONAL, unowned):** fallback phase-0 +
  lane-nudge + per-wire `usedFallback`; S5 (optional) perf. Each slice: gates
  green + layoutCheck clean + browser spot-check per the memo's slice plan.
  **Gates Phase 3** (perception fixtures are CC/SC, back on the router).
- [x] **P3.1** **Design spike: perception target authoring.** — _closed as
  OVERTAKEN 2026-07-06 (iteration 18 audit)._ Gabriel shipped perception
  questions on main (PR #12, merged as `b36aed6`): `engine/perception.ts` +
  `gradePerception` — a separate perception question kind (`perception: {rule,
  width}` + generated bit-vector `perception_cases`), fully outside the value
  codec and the notation seam. Rules: `min-run k` / `exact-run k` / `pattern`
  (CC, exhaustive 2^width banks, width ≤ 10), `change` / `motion k` (SC,
  deterministic seeded battery). QuestionCreator has a function|perception
  Task toggle; samples Q9–Q13 ship correct AND incorrect netlist circuits,
  pinned by perceptionCheck (now wired into `npm run check`) + pipelineCheck.
  This is the de-facto decision P3.1 was to make (it chose "separate question
  kind" over the unified target-function abstraction). **Residual, deferred:**
  there are now THREE target-function forms (arithmetic formula / perception
  rule / turbot criteria) with three grading branches — unification is a
  refactor question, not a capability question; revisit only if a fourth form
  appears (record: this queue + LOG iteration 18; no designs/ memo needed).
- [x] **P3.2** **Promote main's CC perception circuits into reference
  fixtures.** — _done 2026-07-06 (iteration 19; 3-agent build workflow +
  adversarial verifier (63/63 checks, banks byte-identical to
  buildPerceptionCases, promotion topologically exact) + browser appearance
  sweep)._ hw2-p10/p11/p12 exact-verified (correct 256/256, 256/256, 512/512;
  broken fails 148/256, 46/256, 2/512) → **44/56**. Discovered: hw2-p11's
  correct circuit renders SIX bumpless crossings — the router lanes a fan-out
  branch inside the port-approach column, within `pathDWithBumps`' 5px
  bump-skip radius; position-jiggling provably can't clear it (an annealing
  probe stalled at 2), so it ships as a documented renderer-class residual.
  New headless predicate `app/tools/bumpCheck.ts` (replicates the canvas
  crossing+skip rules on real routes; at the time NOT in `npm run check` —
  hw2-p11 failed it by design) → fed into P1.8 S3's acceptance. _Since
  resolved: S3 (`d0214ec`) made ALL CC/SC fixtures bump-clean (incl. hw2-p11's
  exhibit) and wired bumpCheck into `npm run check`._
- [x] **P3.3** **Promote main's SC perception circuits into reference
  fixtures.** — _done 2026-07-07 (iteration 20; 2-agent build workflow +
  adversarial verifier + appearance sweep + one bounded diagnosis agent)._
  hw3-p11 (change) + hw3-p12 (motion k=3, 146 comps — PLA-matrix layout with
  ROTATED MEMs reached 0 router fallbacks) exact-verified → **46/56**; banks
  byte-identical to buildPerceptionCases; temporal semantics adversarially
  probed (same-frame discriminators prove MEM-temporality); p11 functional
  in-browser runs semantically correct. **Big diagnostic win:** hw3-p11's 48
  fallbacks (routerCheck initially FAILED) were root-caused as the router's
  STRUCTURAL XOR FLOOR — XOR's left-port inset (11.25px) > STUB_LENGTH(12) −
  ELEMENT_MARGIN(5), so every XOR-in wire costs exactly 3 fallbacks; the
  ENTIRE pre-existing 99 pin is this class (3 × XOR-in wires per fixture).
  Deliberately pinned `hw3-p11: 48` (budget 147, then current) with the
  mechanism + fix candidates documented in routerCheck's header → P1.8 S3 could
  kill the whole floor, not just trim it. _It did: S3's own-endpoint exemption
  (`d0214ec`) erased the XOR floor — budget repinned 147 → 2._ Discovered →
  P1.15, P1.16, S3 obstacle note.

## Phase 4 — Navigation

- [x] **P4.1** **FSM-turbot motor: 2-bit outputs.** — _absorbed by P1.12
  (2026-07-06): `turbotFsmNotation` makes canonical 2-bit motor labels
  (`0:01` = pivot left) executable and pinned in turbotCheck; legacy 1-bit
  labels alias + decay. Remaining surface work (palette/glossary vocabulary
  for 2-bit outputs in the turbot editor) rides P4.3's authoring pass._
<!-- P6.3/P6.4 (enqueued here mid-Phase-4 at iteration 21) moved to Phase 6 by
META-audit-queue 2026-07-07 (iteration 23): both are close-out/backend tasks and
were sitting ABOVE P4.3 as the file's top unblocked todos, contradicting
HANDOFF's "do this next = P4.3". Task ids unchanged. -->
- [x] **P4.2** **Multi-arena navigation grading** for unknown distance/position
  (Mad Max, Way Finder, Desert Ant): put a *family* of arenas in `turbot_cases`;
  confirm the grader requires all to pass. **Acceptance:** a single-layout-only
  solution fails the family. — _done 2026-07-07 (worktree)._ Aggregation was
  already right (`gradeTurbot` grades EVERY case; a question passes iff
  passed === total in both `summarizeResult` and the gradebook's
  `toQuestionGrade`; GradebookView maps ALL turbotCases with 1-based arena
  indices). The real hole was the **criterion**: spec-letter `return-to-start`
  checked only the final position, so a stop-immediately brain — or any fixed
  out-and-back — passed EVERY Mad-Max-style arena (proved headlessly first:
  4 brains × 3 arenas, all vacuous passes). Fixed deep in
  `evaluateTurbotCriterion`: when the arena declares a goal cell,
  return-to-start also requires the trace to VISIT it (goal-less arenas
  unchanged; goal-on-start degenerates gracefully, mirroring pass-through).
  Spec §12.5 + creator hint updated. The exhibit now discriminates: hardcoded
  out-2-back-2 passes the 1-arena family 1/1 but fails the 3-arena family 1/3
  (block at x=3/5/7, goal just before it); out-4-back-4 gets 2/3 ≠ pass; the
  3-state sensor-reactive Mad Max FSM passes 3/3; lazy stop-now brain 0/3.
  12 pins in turbotCheck `[multi-arena]` (incl. two headless Gradebook-logic
  pins: score 0, failedCount 2). P4.3's Mad Max arenas should mark the
  sensing spot (cell before the block) as the goal.
- [x] **P4.3** **Navigation arenas + plausible brains.** — _done 2026-07-07
  (iteration 24; 9-agent build workflow (1 resumed through an API-overload
  death) + grader-fix agent + adversarial verifier + appearance sweep + one
  bounded layout fix)._ All nine rows landed at tier interface with honest
  reported scores (2/2, 2/2, 0/2, 2/2, 3/3, 1/3, 2/2, 2/2, 3/3): arena
  families from the PDFs (hw3-p15 distances 3/4/8 + goal = sensing spot per
  P4.2; hw4-p14 three distinct mazes), brains good-faith (hw2-p15's 0/2 IS
  the course answer — no memoryless CC takes the opposite turn; hw3-p15's
  1/3 recorded as an honest bank for the correct-answers project).
  **Discovered + fixed in-flight: the step-limit/criterion defect** —
  gradeTurbotCase failed ANY hitStepLimit run before consulting the
  criterion, making pass-through (HW2 §III "Pac-Man" rule: crossing the goal
  completes it, no stop needed) structurally unpassable for CC brains. Deep
  fix at the engine seam: `criterionRequiresStop(criterion)` beside
  evaluateTurbotCriterion (pass-through = trace-satisfiable; reach-and-stop /
  return-to-start unchanged), honest reasons, spec §12.5 records "the step
  limit bounds simulation, not success"; 7 new turbotCheck pins + the 12
  [multi-arena] pins untouched; server gates green (engine is cross-imported).
  Verifier corrections recorded: hw4.pdf prints the FSM NOTATION + one example
  machine, not a full zig-zag solution (queue's earlier "printed FSM" claim
  corrected); hw3.pdf's section header says "combinatorial" but its Note 1
  says SC (PDF typo — fixtures follow the note). hw3-p13's MEM feedback pair
  initially took 2 router fallbacks (congestion-starved A* budget) — fixed by
  ONE move+rotate (MEM 270°), no pin edits. ⚠ The task_2cd0dbea chip
  (pass-through grading) became REDUNDANT mid-iteration — the fix was already
  in-tree when Gabriel started the chip session; flagged to him in-session.
- [ ] **P4.4** Add a **turbot sandbox** tab (currently turbot only exists inside
  assignments; `TabBar` lists CC/FSM/TM only). Optional but eases authoring/appr.
- [ ] **P4.5** _(optional)_ Wire the perception/navigation **category taxonomy**
  (`ActiveTask` is typed but unused) to organize questions / gate palettes.

## Phase 5 — TM-turbot capstone

- [x] **P5.1** **Desert Ant capstone (hw6-p2).** — _done 2026-07-07
  (iteration 25; one build agent + adversarial verifier + appearance check)._
  THE LAST ROW: 3× 30×30 walled arenas (food varied in the NE quadrant,
  start varied, food strictly NE of start in every member), criterion
  return-to-start with goal = food per the P4.2 clause (the PDF demands
  find-then-return; pass-through would ignore the return half). Brain: a
  20-state turbot-TM diagonal-staircase forager with unary leg-counting and
  EXACT dead-reckoned return (all three arenas end at start, halted); tape
  span audited ≤20 (worst exactly 20 — the engine doesn't enforce the
  budget, the statement carries it); honest score **1/3**, reported not
  asserted. Verifier confirmed with an independent runBrainStep re-simulation;
  appearance PASS (6 circle-internal / 14 square-external states DOM-verified,
  live TurbotTapePanel, machine table + dimmed internal history rows).
  **LEDGER COMPLETE AT-TIER: 46 exact + 10 interface = 56/56.**
  Discovered → P5.2, P5.3, P6.1 note (below).
- [x] **P5.2** _(done 2026-07-07, iteration-27 smalls sweep — see LOG)_ _(discovered 2026-07-07, capstone build)_ **Instructor arena
  editor caps at 20×20** (`MAX_ARENA_SIZE`) but the capstone needs 30×30 —
  fixtures hand-author the data (works; ArenaCanvas renders any size), but an
  instructor can't author the PDF's own arena in the UI. Raise the cap or
  make it a config with scroll-aware editing.
  **Acceptance:** a 30×30 arena is authorable in QuestionCreator; existing
  arenas unaffected.
- [x] **P5.3** _(done 2026-07-07, iteration-27 smalls sweep — see LOG)_ _(discovered 2026-07-07, capstone verifier)_ **Criterion
  failures without step-limit carry `reason: undefined`** — gradeTurbotCase
  only emits reason text on hitStepLimit, so a clean halt-at-start-without-
  goal-visit shows a reason-less failed arena in the gradebook drill-down.
  Emit a criterion-named reason on every criterion failure.
  **Acceptance:** every failing TurbotCaseResult carries a human-readable
  reason; turbotCheck pins it; existing pins green.

## Phase 5.5 — Small hardening (slot opportunistically before close-out)

- [x] **P2.5** — _closed as DEFERRED 2026-07-08 (iteration-29 audit): this is
  answer-quality work belonging to the future correct-answers project, not
  this build-out (2026-07-06 scope shift); the rows are honest as-is. NOT
  loop-open — re-open there, not here. Original entry follows._
  _(discovered 2026-07-06, P2.4 probe; **DEFERRED to the
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

- [x] **P1.5** — _done 2026-07-07 (chip session)._ One semantics, owned by
  `engine/machineValidation.ts` (`validateAllowedComponents` + palette
  predicate `isComponentTypeAllowed`, doc comment = the authority; spec §1.5
  records it): absent/empty = unrestricted (back-compat); present = only the
  listed types plus always-allowed infrastructure (INPUT/OUTPUT; STATE — the
  whole FSM/TM vocabulary, restriction targets the CC/SC gate vocabulary);
  BOXED is packaging, internals recursed (a boxed OR can't smuggle an OR into
  hw1-p2). All three touchpoints: (1) grading — Stage 1 in every grader branch
  (gradeQuestion/gradeTurbot/gradePerception + coverageCheck's validateStage1
  mirror), violating machine fails every case naming the type(s); (2) palette —
  ComponentLibrary filters entries AND library boxes via the store's new
  `selectAllowedComponents`; (3) authoring — QuestionCreator "Restrict
  available components" toggle + AND/OR/NOT/MEM checkboxes (CC/SC incl.
  perception + turbot CC/SC brains), saves `['INPUT','OUTPUT',...gates]`
  matching the HW1 fixtures' shape, round-trips. Acceptance proven as six
  permanent coverageCheck self-test pins: correct-function OR machine fails
  hw1-p2 0/4 (reason names OR) · absent field = same machine passes 4/4 ·
  DeMorgan correct still passes · boxed-internal smuggling caught 0/4 ·
  palette predicate · interface-tier mirror regresses a violator. hw1-p2's
  fixture field already matched the semantics (no fixture edit); harness
  46 exact · 10 interface · 0 regressed; all gates + server gates green.
  Original discovery entry follows._
  _(discovered 2026-07-06, hw1-p2 critic)_ **Enforce
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
- [x] **P1.6** _(done 2026-07-07, iteration-27 smalls sweep — see LOG)_ _(discovered 2026-07-06, hw2 critic)_ **Unify the IN/OUT
  label-ordering convention in `engine/cc.ts`.** Two separate implementations of
  the same convention: the top-level path orders I/O components via
  `sortByLabel`, while `evaluateBoxedCircuit` binds boxed internals via
  `parseInt(label.replace('IN',''))` — a future relabel/refactor could desync
  them (boxed circuits are now load-bearing: hw2-p6 grades through one). Extract
  one shared label-order helper used by both paths.
  **Acceptance:** single implementation; `npm run check` (incl. hw2-p6 fixture)
  green.
- [x] **P1.15** — _done 2026-07-07 by a concurrent session (commit `e95f74f`),
  exactly the prescribed deep fix: ONE aggregate `resetAllSimState()` (delegating
  to per-mode global resets) on all three navigation paths; pinned by the new
  `app/tools/navResetCheck.ts` (42 checks, 15 fail without the fix) — exceeds
  this task's acceptance criterion. The same session then extended the
  fresh-machine contract to every sandbox canvas swap (`c93fe6e`:
  enterSandbox/addTab/switchTab/removeTab/newWorkbook/importWorkbook);
  navResetCheck is now 86 checks (42 nav + 44 sandbox), in `npm run check`.
  Original discovery entry follows._
  _(discovered 2026-07-07, P3.3 appearance sweep; REAL APP BUG)_
  **SC/FSM sim state leaks across question navigation.** After running one SC
  question, the next question's Global I/O, ARG/VAL, and Sequential Timeline
  show the previous question's data — `switchQuestion` (store.ts ~1402) resets
  only the TM and turbot slices. Same family as the TM leak fixed 2026-07-06
  (commit 0ca35b3), which was a mode-specific patch. **Deep fix: ONE unified
  all-modes sim reset on question load/switch/open** (kill the class — a new
  mode's sim slice should be impossible to forget), replacing the accreting
  per-mode reset calls. The appearance agent also flagged a background task
  chip for Gabriel; coordinate before building (check `git log` for a fix
  landing on main first).
  **Acceptance:** a store harness proves no slice (CC/SC/FSM/TM/turbot sim
  state) survives question navigation; existing tm/turbot reset pins stay
  green.
- [x] **P1.16** _(done 2026-07-07, iteration-27 smalls sweep — see LOG)_ _(discovered 2026-07-07, P3.3 appearance sweep; cosmetic)_
  **Rotated-MEM label placement ignores rotation.** M1–M8 labels on hw3-p12's
  270°-rotated MEMs are bisected by the vertical M_IN wire entering the N
  port — label anchors assume horizontal port sides. Place labels clear of
  the rotated port axis (componentGeometry knows the rotation).
  **Acceptance:** hw3-p12 labels unbisected in-browser; no regression on
  standard-orientation MEMs.
- [x] **P1.11** _(done 2026-07-07, iteration-27 smalls sweep — see LOG)_ _(discovered 2026-07-06, P1.9 round-2 verifier; pre-existing,
  minor)_ **A/V ARG rendering for multi-group questions.** The ARG column
  renders the whole interleaved typed string as ONE numeral — typed "111101"
  (x=2, y=3 on hw3-p9) shows ARG '/' while VAL correctly shows 5. Render
  per-group values ("2, 3") in question mode.
  **Acceptance:** hw3-p6/p9-style questions show per-group ARGs; gates green.

## Phase 6 — Close out

- [x] **P6.1** **Full-matrix appearance sweep.** — _done 2026-07-08
  (iteration 28; polish-fix agent + two-stage sweep — the first sweep agent
  stalled twice on dev-server drops, checkpointed via SendMessage, and a
  continuation agent finished the remainder from the checkpoint)._ All 8
  matrix rows CLEAN across every mode (CC/SC/FSM/TM, all four turbot inner
  modes, both perception types, open question, sandbox tabs): two-output TM
  labels render exactly per spec §10.3; k=2 FSM labels + separated arcs; MEM
  conventions; arena Maps + glossaries; open-question shows zero grading
  leakage; sandbox tab switches reset sim state (verified with real runs).
  Polish fixes landed and browser-validated: `selectLiveFsmStateId` (ONE
  live-state source — arena stepping now green-highlights the brain canvas,
  no cross-context leaks), turbot palette header names the inner machine
  (sandbox's shared "Logic Circuit" label kept + documented as deliberate),
  follow-the-turbot Map auto-scroll (340px scroller, wheel guard ~1.5s).
  Resolved en passant: the hw3-p9 (1375,757) dot-skip — the divergence dot
  NOW RENDERS at the historic junction (S3 fixed the bump adjacency; verdict
  positive). The "all-gray 30×30 Map" scare was a JPEG-downscale artifact
  (DOM: blocks #9e9e9e vs transparent empty cells).
  **ONE ITEM STILL OPEN → P6.1b.**
- [ ] **P6.1b** _(pending GABRIEL's decision)_ **Arena turbot color:** renders
  red `#c73535` (index.css) vs VISUAL_VOCAB §Turbot "yellow triangle". Decide
  which is right and fix the loser (one-line CSS change or one-line vocab
  edit). Asked 2026-07-07; flag-only until answered.
- [x] **P6.2** Reconcile CLAUDE.md status with COVERAGE; final `npm run check` +
  `tsc` + `build` all green; every COVERAGE row green **at its tier** (✅ exact
  for arithmetic, ◐ interface for perception/navigation). — _done 2026-07-08
  (iteration 29, combined with META-audit-queue)._ All gates fresh BY EXIT
  CODE: app tsc 0, every check tool run individually 0 (codec/notation/tm/
  turbot/perception/scWindow/router/bump/pipeline/navReset/coverage), build 0,
  server typecheck 0 + serverCheck 0. Harness 46 exact · 10 interface · 0
  pending · 0 regressed · 0 warnings; COVERAGE.md cross-checked against the
  harness JSON row-by-row BY SCRIPT (56/56 status-at-tier + manifest tier
  agreement, 0 mismatches). CLAUDE.md brought honest (iterations 27–28 were
  undocumented: smalls-sweep + P6.1 entries added; key-files rows gained
  criterionRequiresStop/explainTurbotCriterionFailure, getComponentBounds/
  getLabelAnchor, selectLiveFsmStateId/selectAllowedComponents, outputDisplay
  per-group ARG; stale "46/56, 9 navigation remaining" What's-next bullet
  rewritten). Stale COVERAGE notes fixed (hw1-p2 "unenforced", hw3-p12 "still
  open" appr findings, header). HANDOFF rewritten to the close-out state.
- [x] **P6.3** **Server↔engine grading-parity pin.** — _done 2026-07-08
  (iteration 30)._ `server/tools/parityCheck.ts` (31 checks, chained into
  `server npm run check`): six-mode fixture assignment (CC/SC/FSM/TM axes +
  turbot with failing criterion-reasons on the wire + perception + open)
  submitted through the REAL booted server and deep-compared path-by-path
  against in-process `gradeSubmission` — byte-identical as JSON values; only
  server-owned envelope fields (ids/timestamps/mirrors) asserted rather than
  compared, each documented. **HEADLINE: the pin found and fixed two real
  student-facing answer leaks** — sanitize.ts predated perception and shipped
  `perception_cases` (the answer key) in student assignment copies AND
  `perceptionCases` detail in post-release records; fixed, adversarially
  confirmed (pin fails 2 checks against the pre-fix file). CI note: no checks
  run in CI today (deploy.yml builds only); a server-checks job needs Node
  ≥22.5 — proposed YAML recorded in LOG iteration 30, GABRIEL'S CALL to add.
- [ ] **P6.4** _(enqueued iteration 21; re-homed here from Phase 4 by the
  iteration-23 audit)_ **Remote-store cutover** (backend phase): async
  `Remote*` stores backed by `api/client.ts` (currently 1:1, imported by
  NOTHING) replacing the localStorage seams; retires the
  grade-release/manual-review duplication (server-authoritative + local
  mirror). Gabriel's call on timing — enqueue-only; probably his next
  parallel-session slice.

---

## Recurring meta-tasks  _(fire on cadence; keep the queue honest)_

- [ ] **META-audit-queue** — _every ~5 iterations; last ran iteration 29
  (2026-07-08, combined with P6.2 — see P6.2's done note for the gate/ledger
  evidence): window 24–28 audited; spot-ran every closed task's pins by exit
  code (turbotCheck [multi-arena] + [pass-through step-limit] + criterion-
  reason sections, coverageCheck's 6 allowed_components pins, navResetCheck 86,
  bumpCheck manifest sweep CLEAN, routerCheck budget 2≤2); queue honesty:
  P6.2 closed, P2.5 closed as DEFERRED (correct-answers project, not
  loop-open), P1.8's stale "S3 leftover still open" text rewritten (both
  leftovers resolved iterations 27–28; only optional S4/S5 remain),
  META-reconcile-claude folded into this entry as a duplicate (its job is
  this audit's step 3; its "currently claims all built" note was years stale)
  → open items now EXACTLY: P6.1b + P6.3 + P6.4 (Gabriel-gated), P1.8 S4 +
  P4.4 + P4.5 (optionals), and the two META recurrers; patch-accumulation
  scan over 24–28: NO cluster — every window fix was seam-routed
  (criterionRequiresStop beside evaluateTurbotCriterion, P1.5's one-semantics
  machineValidation slice, sortByLabel unification, getComponentBounds/
  getLabelAnchor in componentGeometry, explainTurbotCriterionFailure clause
  mirror, selectLiveFsmStateId single source; the three criterion functions
  are deliberate co-location at one seam, not accretion). Previous run
  iteration 23 (2026-07-07): post-S3 doc reconciliation — verified harness 46/10/0/0,
  bumpCheck CLEAN + routerCheck budget 2, turbotCheck [multi-arena] and
  navResetCheck (86, in `npm run check`) green, toggle-tab obstacle gap
  confirmed still open; rewrote the stale live-defect notes S3 outdated
  (COVERAGE hw2-p11/hw3-p12, manifest hw3-p12, QUEUE P3.2/P3.3), recorded the
  out-of-band sandbox fresh-machine extension `c93fe6e` (navResetCheck 42→86)
  + Vite PORT `7914966` in P1.15/HANDOFF/LOG, re-homed P6.3/P6.4 from Phase 4
  to Phase 6 (they sat above P4.3 as top todos), fixed CLAUDE.md's serverCheck
  count (22→28) + added the buildout-status bullet; LOG iterations 19–22 +
  out-of-band entries verified coherent/non-duplicated; NO patch cluster (the
  window's fixes were seam-routed deep fixes: S3 model unification, P4.2
  criterion, P1.15 aggregate reset + its sandbox extension). Previous run
  iteration 18 (2026-07-06): merged `origin/main` (open-question sixth mode + turbot
  grading rework, PRs #11/#13) as `e9122e0`, then main's perception-questions
  feature (PR #12) as `b36aed6` — which closed P3.1 as overtaken and rescoped
  P3.2/P3.3 to fixture promotion; all gates green after each; harness
  41/15/0 unchanged, COVERAGE already reconciled; no patch cluster since
  iteration 11 (P2.1–P2.4 + P1.8 all routed through seams); one pin
  adjudicated — main's new "1-bit turbot FSM label rejected" turbotCheck pin
  contradicted the branch's documented P1.12 legacy-alias design and was
  flipped to "accepted as alias" (execution bit-identical, old machines keep
  validating)._ Run `npm run coverage`;
  reconcile COVERAGE + this queue against the harness JSON; prune dead/duplicate
  tasks; re-rank by dependency and value; confirm no drift; **keep CLAUDE.md's
  status honest against COVERAGE** (absorbed from the retired
  META-reconcile-claude entry, iteration-29 audit — downgrade any claim a
  reference solution can't back up). **Also audit for
  patch accumulation:** look for clusters of surgical fixes that landed since the
  last audit and share a family — if found, enqueue one unifying architectural
  task (with a design memo) to replace the cluster's trajectory. Log what changed.
- [ ] **META-visual-vocab** — before starting a new mode's appearance work, re-read
  the relevant `mm_textbook.pdf` chapter + `spec/…/Mock_Ups-*.jpg`; refresh
  VISUAL_VOCAB.
