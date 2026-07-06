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
- [ ] **P1.12** _(discovered 2026-07-06, hw4 batch — absorbs P4.1's depth check
  and is the P2.1 design's first slice)_ **Transition-notation design memo +
  FSM multi-bit alphabet.** One engine change unblocks TWO clusters: hw4-p11
  needs 2-bit INPUT symbols (`xy:o`, alphabet 00/01/10/11 per the codec's wire
  order) and hw4-p12–14 navigation needs 2-bit OUTPUT symbols (motor 11=F/00=S/
  10=R/01=L per hw4.pdf p188). The family is P2.1's: FOUR transition grammars
  live as scattered string conventions (FSM `0:1`, TM `1:0R`, turbot-TM
  internal/external). Write `designs/transition-notation.md` FIRST (per-mode
  notation module: parse/validate/render/edit as one pluggable unit), then
  implement the FSM k-bit slice through it: `engine/fsm.ts` match on the joined
  input row, `machineValidation.ts` enumerate 2^k symbols, `grader.ts` feed the
  full row (not `s[0]`), editor label entry, store typed-sequence feeding.
  **Also fix the silent-misgrading footgun** even for unsupported cases:
  validateMachine must reject/flag an FSM question whose input-group count
  exceeds the supported alphabet width (today it grades wire 0 silently).
  **Acceptance:** memo written; hw4-p11 fixture builds + verifies (33/56);
  a 2-input FSM question can no longer silently mis-grade; scWindowCheck/
  tmCheck/turbotCheck/coverage all green.
- [ ] **P1.13** _(discovered 2026-07-06, hw4 appearance sweep)_ **FSM renderer:
  coincident opposite-direction arcs.** S₀→S₁ and S₁→S₀ render as geometrically
  coincident quadratic curves with superimposed labels (one transition visually
  hidden) — violates the textbook's separated-arcs rule (VISUAL_VOCAB, refreshed
  from ch. 22). Fix the curve control-point offset for opposite-direction pairs
  in CircuitCanvas; re-sweep hw4-p8/p9/p10 (their appr cells + statuses flip ✅).
  Renderer family sibling of P1.8 (wire router) — one CircuitCanvas fix, not
  fixture nudges (the machines NEED both directions).
  **Acceptance:** hw4-p8/p9/p10 appearance passes; no regression in the other
  FSM fixtures' rendering; gates green.
- [ ] **P1.8** _(discovered 2026-07-06, hw3 appearance sweep)_ **Renderer: wire
  lanes and junction dots** — design memo first (`designs/wire-routing.md`).
  Family: the auto-router (a) sends every wire into `MEM.min` down a fixed
  obstacle-blind fallback path because the min stub sits inside the router's
  phantom 75×70 MEM bounds (rendered body is 50×50) — these fixed lanes caused
  all six HW3 appearance failures; (b) can run different-source wires collinear
  or 1px apart (reads as a forbidden merge); (c) draws the split junction dot
  only at the source port, leaving multi-branch divergence elbows undotted.
  Deep fix: align router obstacle bounds with rendered geometry (or make
  min-stub reachable), add a lane-separation cost for foreign collinear runs,
  and dot divergence points. Improves every student's canvas, not just fixtures.
  **Acceptance:** memo written; hw3 fixtures still oracle-clean under the
  (P1.7-promoted) layout oracle. _(Audit 2026-07-06: FSM/TM transitions render
  as curves between STATE circles, bypassing the router — this task gates
  Phase 3 perception (CC/SC), not P1.4/P2.)_
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
- [ ] **P1.10** _(discovered 2026-07-06, P1.9 round-3 verifier; sandbox-only,
  minor)_ **Sandbox FSM feed direction.** The FSM IN/OUT display is now
  t1-rightmost everywhere, but the sandbox FSM feed still consumes the typed
  string leftmost-first (SC sandbox parses rightmost = t1) — a sandbox identity
  FSM typed "110" displays OUT "011". Reverse the sandbox FSM feed to match SC
  and update the corresponding scWindowCheck sandbox pin.
  **Acceptance:** sandbox identity FSM displays OUT == IN; scWindowCheck green.
- [ ] **P1.11** _(discovered 2026-07-06, P1.9 round-2 verifier; pre-existing,
  minor)_ **A/V ARG rendering for multi-group questions.** The ARG column
  renders the whole interleaved typed string as ONE numeral — typed "111101"
  (x=2, y=3 on hw3-p9) shows ARG '/' while VAL correctly shows 5. Render
  per-group values ("2, 3") in question mode.
  **Acceptance:** hw3-p6/p9-style questions show per-group ARGs; gates green.

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
