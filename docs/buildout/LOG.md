# Session Log

_Append-only. Newest entries at the top. One block per loop iteration: date, what
shipped, what surprised you, what's next. This is the narrative memory that the
COVERAGE ledger and QUEUE don't capture._

---

## 2026-07-05 — Bootstrap (branch `buildout-infra`)

**Shipped — the build-out infrastructure (Phase 0), no machines built:**

- `docs/buildout/` memo system: NORTH_STAR, COVERAGE (56-row matrix), QUEUE
  (phased), VISUAL_VOCAB, this LOG, HANDOFF, README.
- `app/tools/coverageCheck.ts` — the adversarial harness. Self-test reuses the
  existing devData sample machines and **discriminates correct vs. broken across
  all five modes today**. Ledger reads `coverage-manifest.json` (56 rows, all
  pending) and reports verified/pending/regressed + a JSON summary.
- `app/tools/fixtures/coverage-manifest.json` (full HW1–6 set) +
  `fixtures/reference/README.md` (fixture format).
- `npm run coverage` and `npm run check` scripts in `app/package.json`.
- `.claude/commands/handoff.md` — the per-iteration loop procedure; run
  `/loop /handoff` in a separate Ultracode session to drive it.

**Verified:** `npm run coverage` → self-test 10/10 PASS, `COVERAGE OK` (exit 0),
0/56 verified · 56 pending. `npm install` reconciled node_modules to the existing
lockfile (tsx was missing after the pull) — no lockfile change.

**Surprises / reframing:** the pulled codebase is *far* more built out than the
kickoff described — all five modes exist end-to-end per CLAUDE.md. Reading the real
homeworks fixed the true scope: 56 machine-buildable problems, and the genuine
gaps are (1) perception isn't authorable in the current DSL, (2) FSM-turbots can't
turn (1-bit motor), (3) navigation generality needs multi-arena grading, (4) the TM
two-output visual change. These are queued as Phases 2–5, not "build from scratch."

**Next:** run `/loop /handoff` in a fresh session. First real task is **P0.4** —
author + build the **hw1-p1 NAND** reference fixture end-to-end (build in the app,
export `CircuitData`, add a broken variant, wire it into the manifest) to prove the
fixture path and turn the first COVERAGE row green.

_Infra is on branch `buildout-infra` (not pushed). Human will decide when to merge._

## 2026-07-06 — P0.4: fixture path proven (hw1-p1 NAND) · 1/56

**Shipped:** first COVERAGE row green end-to-end. `reference/hw1-p1.json`
(`{question, correct, broken}`) + manifest wiring; harness reports
`hw1-p1 verified` (correct 4/4, broken 0/4 — the AND-only near-miss fails every
case). All gates green: `npm run check`, `tsc --noEmit`, `npm run build`.
Appearance checked in the app against VISUAL_VOCAB (left→right flow, ∧/¬ symbols,
IN/OUT labels, black-0 wires) — clean.

**The template (copy this for every fixture):**
1. Scratch `tsx` script builds correct + broken machines with `tools/builder.ts`
   (real left→right grid positions), authors the question (buildMode, rep,
   `cc_spec` with `max_value` inputs + `formula` outputs, numeric `test_cases`).
2. Script asserts `gradeQuestion(question, correct)` all-pass and
   `gradeQuestion(question, broken)` fails, **then** writes the fixture JSON
   itself — the file is exactly what was proven.
3. Manifest row: set `"fixture": "reference/<id>.json"` (+ flip its bookkeeping
   `status`); `npm run coverage` flips the row.
4. Appearance: inject the circuit into localStorage key `mm:asg:<assignmentId>`
   as `{currentQuestionIndex, questionCircuits: {<qid>: {...CircuitData,
   textElements: [], comments: [], boxes: []}}}`, open the assignment/question,
   compare to VISUAL_VOCAB. (Note the three extra empty arrays — `QuestionCircuit`
   needs them; `CircuitData` fixtures don't carry them.)

**Surprises:** none material. `tsx` was missing again after checkout
(`npm install`, no lockfile churn). Hash-navigation to `#/assignment/...` from
the console doesn't re-render — click through the UI instead.

**Next:** **P1.1** — HW1 logic (hw1-p2…p5) + synthesis (hw1-p16 M, hw1-p17 N).
Batch job: same template ×6; good Workflow fan-out (build+prove per problem in
parallel, then one verify pass + one appearance sweep). hw1-p2 needs
`allowed_components` without OR — note the field exists on `AssignmentQuestion`
but has no creator UI yet (deferred), setting it in fixture JSON is fine.

## 2026-07-06 (iteration 2) — P1.1: HW1 complete · 7/56

**Shipped:** six fixtures (`hw1-p2..p5, p16, p17`) via one workflow (17 agents,
~890k tokens): spec-extraction from `problem sets/hw1.pdf` → 6 parallel
build+prove agents → manifest wire → 6 adversarial verifiers + regression gates
+ browser appearance sweep → completeness critic. Harness: **7 verified / 49
pending / 0 regressed**; all gates green; 0 refutations; appearance 6/6
(junction dots, the p5 crossing bump, and ¬/∧/∨ glyphs verified in the SVG DOM,
not just screenshots).

**Surprises / gotchas worth keeping:**
- **Tally canonicality:** the textbook's `tal()` is position-insensitive
  (PDF: `tal(01) = one`) but the platform codec only accepts canonical
  1s-then-0s codewords — so hw1-p16's correct circuit must emit `10` for
  successor(0) (O1 = const 1 via `OR(I, NOT I)`, O2 = I), not `01`. Remember
  this for every future tally fixture.
- **`allowed_components` is unenforced** (types.ts:139 is its only mention):
  grader, palette, and creator all ignore it — a student could pass hw1-p2 with
  an OR gate. Enqueued as **P1.5** (three-touchpoint slice: machineValidation
  Stage-1 + ComponentLibrary filter + QuestionCreator field). Broken variants
  must stay *functionally* wrong until it lands.
- **Appearance-injection recipe v2** (the LOG-template step 4 recipe silently
  fails): the store registers `beforeunload`/`pagehide` flushAutoSave handlers,
  so seeding localStorage then reloading lets the OLD page's in-memory circuit
  overwrite the seed. Working sequence: (1) reload to Home (`hash=''`) first,
  (2) seed `mm:asg:cc-basics` while on Home, (3) click through CC basics → Q1
  (`openAssignment` reads localStorage at open time), (4) screenshot + SVG DOM
  inspection for fine details (dots r=4 #333, wire stroke #333, glyph text nodes).
- DSL note: no unary minus context — for "NOT x" as a formula use `x ^ 1` (p3);
  `1 - (a & b)` also works (p1). `~` risks negative values; avoid.

**Next:** **P1.2** — HW2 CC arithmetic (hw2-p1…p7), same workflow shape. Check
the HW2 PDF for exact specs; multi-bit groups will exercise the codec's
IN1-is-MSB convention more heavily (p17's endianness-swap broken variant is the
canonical near-miss for these).

## 2026-07-06 (iteration 3) — P1.2: HW2 CC arithmetic · 14/56

**Shipped:** seven fixtures (`hw2-p1..p7`) — the first multi-bit circuits — via
the batch workflow (19 agents, ~1.19M tokens) plus one cleanup agent. Question
banks authored through the **production path** (`buildQuestionBank`: exhaustive
0..15 enumeration, 16 cases each; 256 for `x+y`), spot-checked against
PDF-derived pairs. Correct machines: HA-ripple increments (+1/+2/+3), wire-shift
2x/2x+1 with synthesized constants (`OR(w, NOT w)` = 1, `AND(w, NOT w)` = 0),
BOXED `+1` reuse for 2(x+1), and a 7-HA/3-OR ripple adder for x+y (256/256).
Verifiers used independent plain-JS oracles against the engine — 0 refutations.
Harness: **14 verified / 42 pending / 0 regressed**; all gates green.

**Surprises / knowledge gained:**
- **XOR, HA, BOXED are engine-native** (`evaluateGate` in cc.ts): HA ports
  in1/in2 → sum/carry; BOXED recursively evaluates `internalCircuit` mapping
  externals to internal IN/OUT by label. Reference fixtures may use them
  directly; boxing XOR/HA from primitives is a pedagogical nicety only.
- **Two batch defects caught by the adversarial stages, fixed pre-commit:**
  (1) the spec agent returned short ids (`p1`) so builders wrote `p1.json..` —
  renamed to `hw2-pN.json` + manifest rewired (**lesson: pin the id format in
  spec-agent schemas**; the README convention is `<row-id>.json`);
  (2) hw2-p7's ripple layout ran its carry chain BACKWARD (appearance sweep
  caught it) — re-laid-out by topological depth (x = 80 + 180·depth), verified
  25/25 wires forward, re-graded 256/256, re-checked in browser.
- **hw2-p6's broken variant diverges only at x=15** — the harness bar
  (fail ≥1) is met, but single-case divergence is fragile if banks ever get
  sampled. Fine for CC (exhaustive); watch for SC/FSM/TM where banks are sampled.
- Discovered (hw2 critic): cc.ts has TWO label-ordering implementations
  (`sortByLabel` vs `parseInt` in `evaluateBoxedCircuit`) → queued **P1.6**.

**Next:** **P1.3** — HW3 SC arithmetic (hw3-p1…p9, incl. three tally items).
New mode for the batch: MEM blocks, time axis, pipeline-drain on carries
(CLAUDE.md: SC runs flush one 0-input drain step per MEM). Builders should read
`engine/sc.ts` + the SC sample in devData first; banks are SAMPLED for SC (not
exhaustive) — broken variants must fail within the sampled bank.

## 2026-07-06 (iteration 4) — P1.3: HW3 SC arithmetic · 23/56

**Shipped:** nine SC fixtures (`hw3-p1..p9`) — first non-CC batch. Six binary
serial machines (incrementer with t1-pulse timer, +2 via constant-stream "2",
delay-register 2x, 2x+1, 2(x+1), serial full adder x+y over a 128-case bank)
and three tally feasibility items built as **window-aware counter machines**
(the unbounded-stream versions of 2x T / x+y T are FSM-infeasible; the
platform's fixed 8-step window + drain makes them constructible — the PDF's
"if not, explain why" prose branch can't be graded anyway). All banks via
production `buildQuestionBank`; verifiers regenerated independent banks +
plain-JS oracles; 0 refutations; drain cases (63→64 etc.) confirmed. Harness:
**23 verified / 33 pending / 0 regressed**; all gates green.

**The hard part — appearance.** First sweep failed 6/9: the auto-router runs
every wire into `MEM.min` down a fixed obstacle-blind **fallback lane** (the
min stub sits inside the router's phantom 75×70 MEM bounds; rendered body is
50×50), and those fixed lanes ran collinear with other wires / through bodies.
Fixed by a 6-agent workflow: each fixer re-implemented the route oracle by
importing the app's real `routeAllWires` (validated against known-good hw3-p7
= 0/0/0), then repositioned components until zero different-source collinear
overlaps / body passes / box collisions — regrades unchanged. One residual the
0.5px oracle missed: two p9 lanes **1px apart** (A* channel hugging a fallback
lane) — found by the in-browser DOM audit, fixed by hand (MEM `g1` x→1040 so
its fallback lane landed in a clear corridor; the strict 3px oracle
`scratchpad/routecheck_near.ts` now passes all six). Browser re-sweep: 9/9.

**Ops surprises:** two consecutive 529-Overloaded outages killed the spec agent
(resume via `Workflow({scriptPath, resumeFromRunId})` worked perfectly — third
attempt ran to completion); then the **subagent session limit** hit during the
re-sweep (resets 4:50am) — finished the sweep + p9 nudge solo with preview
tools. Seeding lesson repeated the hard way: seed localStorage ONLY while
parked on Home after a reload; seeding then reloading in one step lets the old
page's flushAutoSave clobber the seed (cost one confused audit of a stale
canvas). Vite serves the app under base path `/making-minds/`.

**Fixture-content lessons:** statements must be clean prose — stripped ledger
shorthand ("+2 B.") and answer-giveaway parentheticals ("(It is possible: …)")
from p2/p7/p9. Watch spec agents: they must return full row ids AND clean
statements; builders copy whatever they're given.

**Queued:** P1.7 (harness: enforce broken-breadth ≥25% + drain-coverage bars),
P1.8 (renderer: router fallback bounds / lane separation / divergence dots —
design memo), P1.9 (**possible grading-fairness bug**: UI drains one step per
MEM but the grader's window is max(inWidth,outWidth) — a late-emitting correct
circuit could pass UI and fail grading).

**Next:** iteration 5 = **META-audit-queue** (due: 5 iterations elapsed), then
P1.4 (HW4 FSM arithmetic, hw4-p3…p11).

## 2026-07-06 (iteration 5) — META-audit-queue · ledger clean, queue re-ranked

**Reconciled:** harness (23 verified / 33 pending / 0 regressed) matches
COVERAGE.md and QUEUE.md exactly — no drift after four fixture iterations.
tsc/coverage green; tree clean at `0d0c5e5`.

**Re-ranked Phase 1 tail** (ids unchanged): **P1.9 → P1.7 → P1.4 → P1.8 →
P1.5 → P1.6**. Rationale: P1.9 (UI-vs-grader drain divergence) is a potential
real grading bug on the same time axis the FSM batch builds on — settle
canonical semantics BEFORE authoring nine more time-axis fixtures; P1.7
hardens the harness bars those fixtures are graded against. Verified by code
read: FSM/TM transitions render as quadratic curves between STATE circles
(CircuitCanvas "FSM transition curves" branch), bypassing `routeAllWires` — so
P1.8 (router) does not block P1.4/P2 but MUST precede Phase 3 (perception is
CC/SC, back on the router).

**Patch-accumulation audit:** three router-adjacent patch rounds (hw2-p7
re-layout, hw3 six-fixture re-layout workflow, the p9 1px hand-nudge) are one
family → P1.8 is the unifying task; no further per-fixture nudge rounds on
router-rendered fixtures. Statement hygiene recurred twice (hw2, hw3) → folded
a statement lint into P1.7, along with promoting the layout oracle
(`routecheck_near.ts`) into `app/tools/` as a harness gate. P1.4 gained its
META-visual-vocab first step (FSM textbook chapter + Mock_Ups-9).

**CLAUDE.md:** untouched — no app-code change has shipped in iterations 1–5
(fixtures + memos only), so its status section remains accurate.
META-reconcile-claude stays pending until an app change lands (P1.9/P1.7 will
be the first).

**Next:** **P1.9** — reproduce the drain divergence with a deliberately
late-emitting SC circuit (passes UI-style per-MEM drain, fails the codec
window, or vice versa), decide canonical semantics, fix the divergent side,
document. Then P1.7.

## 2026-07-06 (iteration 6) — P1.9: drain semantics reconciled · first app-code change

**The bug was real, in both directions.** Investigation exhibits: (B) a tally
identity with ONE redundant MEM delay looked correct in the UI for every value
(tally decode is shift-invariant over the UI's whole-history string) but graded
1/9 — the extra stroke slides out of the grader's fixed window; (C) a binary
machine emitting garbage after the window graded 16/16 while looking broken in
the UI; FSM ran ZERO drain steps in the UI (grader reads steps the UI never
executed whenever outW > inW). Root cause: two different run windows (UI: L +
#MEM for SC, L for FSM; grader: `stepCountFor = max(inW,outW)`) and a UI A/V
decode over the whole history string.

**Decision:** the codec window is canonical (grading contracts on it; it's
machine-independent — the point of value-based grading). Grader untouched; the
UI stops misleading.

**Shipped (three rounds, each adversarially verified — rounds 1–2 REFUTED with
real counter-exhibits before round 3 passed):**
- `store.ts`: `selectCodecLayout`/`selectCodecWindow` (question-run predicate =
  open SC/FSM question with a `cc_spec`); SC/FSM question runs execute exactly
  the codec window; typed input parsed as a VALUE per group and fed as the
  codec's `encodeInput` stream (round 2 — fixes tally, whose ones arrive LAST
  in time; round 1's char-per-step feed matched only binary); sandbox unchanged
  (SC L+#MEM, FSM L, raw bits).
- `DataTable.tsx` (+ new `components/outputDisplay.ts`): the REAL Run/Step
  buttons (which bypass store `scRun` — round-1 discovery) use the window; A/V
  VAL decodes via the codec's own `timeOutputBits` (now exported); FSM IN/OUT
  rows render t1-rightmost per VISUAL_VOCAB (round 3).
- FSM typed input is now a numeral (MSB-left, "110" = 6) like SC/ARG —
  intentional unification, caught undisclosed+unpinned by the round-2 verifier
  (their non-palindrome probe; the fixer's own test used palindrome "101").
- `tools/scWindowCheck.ts` (NEW, in `npm run check`, 45 checks): pins grader
  exhibits B/C, store-driven window+content parity for SC/FSM × binary/tally
  (incl. the real hw3-p7 fixture and a 2-group hw3-p9 probe), display
  direction, invalid-codeword fallback, and sandbox behaviors.
- CLAUDE.md: drain bullet rewritten (codec window canonical; per-MEM flush is
  sandbox-only), changelog + tools row updated.

**Pedagogy flag for Gabriel:** canonicalizing the window means a tally machine
that emits the right numeral one step LATE is WRONG (it always was, to the
grader — now the UI agrees). If late-but-right should count, the codec window
must grow instead; say the word and we revisit.

**Queued:** P1.10 (sandbox FSM feed direction — display flip made the sandbox
mirror its IN; minor), P1.11 (ARG column renders multi-group typed input as one
numeral — pre-existing).

**Next:** **P1.7** — harness hardening (breadth ≥25% + drain bars, statement
lint, promote `routecheck_near.ts` to `app/tools/`).

## 2026-07-06 (iteration 7) — P1.7: harness hardening · four bars encoded

**Shipped:** the quality bars that lived only as memo lore are now code.
`coverageCheck.ts` prints every fixtured row's broken-fail fraction and
enforces: **breadth** (WARN <25% on sampled SC/FSM/TM banks; info-only on
exhaustive CC — hw2-p6's designed 1/16 narrow near-miss stays green),
**drain coverage** (WARN when an SC/FSM bank with outW>inW lacks a case whose
expected output emits during drain steps — all 9 SC banks verified to carry a
witness), **statement lint** (hard FAIL: shorthand prefixes, answer-giveaway
parentheticals), and the **layout oracle** (hard FAIL for CC/SC fixtures;
`scratchpad/routecheck_near.ts` promoted to `tools/layoutCheck.ts`, geometry
unchanged, CLI + harness integration, machines routed once per run). Five
synthetic self-test tripwires prove each check fires. JSON summary gained
warnings counts + per-row fractions without breaking existing keys.

**Adversarial verification (refuted nothing):** the verifier proved every bar
bites by MUTATION on the real ledger path — injected a shorthand statement
(row regressed), reverted the builder's hw2-p6 layout nudge (row regressed —
proving the nudge was a genuine fix), and filtered a bank to a 14% broken
fraction (WARN fired, row stayed verified). Tree restored byte-identical.

**Surprise:** three fixtures were NOT oracle-clean — hw2-p6 (1 near-parallel
pair), hw2-p7 (14 collinear pairs in the BROKEN machine: its input→XOR wires
all fell back to one midpoint track), hw3-p4 (4 pairs). hw2 predates the
oracle; hw3-p4 passed the first browser sweep but was never re-run under the
strict 3px variant. Repositioned (position-only — verified byte-identical
otherwise; regading unchanged). Lesson encoded: the oracle now runs in the
harness, so this class can't silently recur.

**Accepted minors:** bars key off the manifest row's mode (a mistyped manifest
mode would misroute policy — all 23 rows consistent today); lint's shorthand
regex admits only x/y variable letters; sub-0.5% fractions print as "(0%)".

**Next:** **P1.4** — HW4 FSM arithmetic (hw4-p3…p11), with its
META-visual-vocab first step (textbook FSM chapter + Mock_Ups-9). The P1.9/P1.7
groundwork pays off here: FSM question runs now execute the codec window with
numeral input, and the new bars gate the batch automatically.

## 2026-07-06 (iteration 8) — P1.4: HW4 FSM arithmetic · 31/56, one engine gap exposed

**Shipped:** eight FSM fixtures (`hw4-p3..p10`) — tally +1/+2 as leading-zero
counter machines (10/12 states; canonical ones-arrive-last streams), binary
+1/+2/+4/2x/2x+1/2(x+1) as 2–4-state carry/delay Mealy machines. All banks via
`buildQuestionBank`; 0 refutations (verifiers hand-traced drain steps); 0
harness warnings (lowest broken-fail fraction 62.5%). **31/56 verified, 0
regressed.** Plus the META-visual-vocab FSM refresh from textbook ch. 22 —
notably it CORRECTED our vocab: the initial state has NO incoming-arrow
marker (S₀ is identified by name alone), and function-computing FSMs must
never halt (final state needs 0:0/1:0 self-loops).

**Engine gap exposed (hw4-p11 x+y BLOCKED):** the FSM transition grammar is
strictly single-bit (`^[01]:[01]$` across fsm.ts / machineValidation / editor)
and `grader.ts` feeds `enc.steps.map(s => s[0])` — wire 0 only. Proven: an
identity machine passes exactly the 16/128 y=0 cases of the p11 bank. Worse,
this is a **silent-misgrading footgun**: QuestionCreator can author a 2-input
FSM question today and it grades wrong without any error. One engine change
(multi-bit transition alphabet) unblocks BOTH hw4-p11 (2-bit inputs) and the
Phase-4 FSM navigation cluster (2-bit motor outputs, 11=F/00=S/10=R/01=L per
hw4.pdf p188) — queued as **P1.12**, which absorbs P4.1's depth check and is
the first slice of P2.1's transition-notation design (memo first).

**Renderer defect (appearance 4/8 → 7/8 after a fixture fix):** hw4-p4 just
had plain-ASCII state labels (relabeled to S₀-style subscripts solo, regraded
green). But hw4-p8/p9/p10 hit a real CircuitCanvas defect: **opposite-direction
transition pairs render as coincident quadratic curves** with superimposed
labels — one transition visually hidden. Machines inherently need both
directions, so this is a renderer fix (→ **P1.13**), not fixture nudging (P1.8
lesson applied). Their rows: grades ✅, appr ⚠ in COVERAGE.

**Process notes:** HANDOFF's guessed problem list was wrong (p3 was "+1 T" not
"x B identity") — the PDF-wins spec step caught it, as designed. The
p3-saturating-+1-machine-also-passes-p4 window degeneracy is documented in the
prove script (don't reuse saturating machines as broken variants for adjacent
questions). hw4-p11's manifest row now carries the blocker note.

**Next:** **P1.12** — write `designs/transition-notation.md`, then the FSM
k-bit alphabet slice (unblocks hw4-p11 → 32/56; kills the footgun). Then P1.13.

## 2026-07-06 (iteration 9) — P1.12: transition-notation seam + FSM k-bit · 32/56

**The loop's first design-memo architecture change, landed end-to-end.**
Judge-panel design (three angles: full-module-now / seam-first / structured
data model) → **seam-first won** on iteration-delivery + compat weights, with
two sharp judge catches: (a) x+y is symmetric and useless as a bit-order pin —
an asymmetric x+2y probe is mandated; (b) ALL designs missed that a k=2 serial
adder has three self-loops per state, colliding with the P1.13 renderer defect
— the fixture must hand-place `fsmControlPt`. Memo:
`designs/transition-notation.md` (+ implementation postscript).

**Shipped (four staged commits, 739fcfc..5244276, gates green after each):**
1. `engine/notation.ts` — `TransitionNotation` interface (parse / canonical
   format / input alphabet / editor token fields / default label); native k-bit
   `fsmNotation` (legacy (1,1) byte-compatible); TM/turbot parsers untouched
   behind ~20-line delegating adapters; `turbotFsmNotation` = the ONE validity
   answer for turbot-FSM brains (legacy 1-bit alias → canonical 2-bit motor,
   decays on edit-save). `tools/notationCheck.ts` in `npm run check` (adapter ≡
   parser corpora, byte-compat, alphabet enumeration, asymmetric x+2y grade
   pin, and a grep gate keeping label dissection inside the seam).
2. Engine flip: FSM evaluates k-bit symbols; validator checks totality over
   2^kIn (cap kIn≤3) with kIn derived from the question's input groups — the
   **silent-misgrading footgun is dead** (verifier proved it previously alive:
   wire-0 identity passed 16/128; now fails Stage-1 loudly with the arity
   named); grader feeds the full encoded row.
3. Store/UI flip: question runs join the full row (scWindowCheck's 45 pins
   stay green + new k=2 store-twin pin); label editor reads token fields from
   the seam for all four grammars; **P1.10 folded in** (sandbox FSM feed now
   rightmost-char-first; the palindrome pin that had pinned the bug repointed).
4. hw4-p11: 2-state serial adder, four `xy:o` transitions per state, 128/128
   correct / broken 57%; appearance PASSES (hand-placed control points beat the
   coincident-arc defect; k=2 editor verified in-browser) → **32/56, 0
   regressed**.

**Adversarial verification (refuted nothing):** byte-identical verdicts for
all 31 pre-slice fixtures against a pristine worktree (62 grades); bit-order
pinned from BOTH sides (verifier built its own x+2y machine AND the
swapped-halves variant that must fail); turbot legacy labels bit-identical;
single-validator rule confirmed by grep.

**Consequences downstream:** P2.1 (TM two-output) is now a notation swap;
hw4-p12–14's 2-bit motor labels are already executable by the engine (the
navigation task shrinks to arenas + authoring surface + P4.2 multi-arena
grading). Stage-1 FSM validation is stricter (stray malformed labels error).

**Next:** **P1.13** — FSM coincident-arc renderer fix (opposite-direction
pairs get automatic control-point offsets), flipping hw4-p8/p9/p10's appr
cells → all HW4 arithmetic fully ✅.

## 2026-07-06 (iteration 10) — P1.13: FSM arc renderer fix · HW4 arithmetic complete

**Shipped:** the coincident opposite-direction arc defect is fixed in
CircuitCanvas. Root cause was a beautiful sign-cancellation: the old code
picked a side via `sourceId < targetId` **inside each wire's own perp frame**,
and the perp frame itself flips between opposite wires — two flips cancel, so
S₀→S₁ and S₁→S₀ computed the IDENTICAL world control point and printed both
labels at the same pixels. Fix: an auto arc with an opposite-direction sibling
bows LEFT of its own travel direction (offset = min(150, max(50, dist·0.3)) +
25px per extra same-direction wire) — deterministic, textbook-style (top/bottom
arcs), matching hw4-p11's hand-placed convention. Explicit `fsmControlPt`
always wins (p11 paths byte-identical before/after — verified at DOM and
persisted-data level); self-loop fanning and same-direction parallel stacking
untouched.

**Verified:** six-machine browser re-sweep 6/6 (p8: arcs 166px apart; p9:
202px; p10: 166px; p5 self-loops, p6 hand-placed parallel pair, p11 explicit
overrides all clean); DOM audit deduped every FSM path — no coincident control
points anywhere; all gates green; UI-only diff (one file). hw4-p8/p9/p10 appr →
✅: **HW4 arithmetic fully complete; 32/56 with all arithmetic verticals done.**

**Next:** iteration 11 = **META-audit-queue** (due — 5 iterations since the
last). Then P1.8 (wire-router design memo, gating Phase 3 perception).

## 2026-07-06 (iteration 11) — META-audit-queue · tracks ordered for the back half

**Reconciled:** harness (32 verified / 24 pending / 0 regressed, 0 warnings)
matches COVERAGE/QUEUE exactly; tsc clean; tree clean at `1d80b05`. All four
arithmetic verticals complete — the project's back half is TM, perception,
navigation, capstone, close-out.

**Re-ranked (remaining todo order):** P2.1 (TM two-output swap — re-scoped:
its design-memo prerequisite ALREADY LANDED with P1.12, so it shrinks to a
notation swap through the seam + label migration) → P2.2 (HW5 ×9) → P1.8
(router memo, MOVED to gate Phase 3 — perception fixtures are CC/SC and hit
the router) → P3.1 (target-functions memo) → P3.2/P3.3 (perception fixtures)
→ P4.2 (multi-arena grading) → P4.3 (nav arenas + brains) → P5.1 (Desert Ant
capstone) → smalls (P1.5/P1.6/P1.11, bucketed as Phase 5.5) → P6 close-out.

**Pruned/absorbed:** P4.1 closed — P1.12's `turbotFsmNotation` already makes
canonical 2-bit motor labels executable (pinned in turbotCheck); only the
authoring-surface vocabulary rides P4.3. P2.1's stale depth-check text
replaced (memo exists; four grammars already behind the seam).

**Patch-accumulation check:** clean. The notation seam absorbed the grammar
family; the arc fix absorbed the FSM-rendering family. One convention noted,
not a cluster: fixtures p6/p11 carry hand-placed `fsmControlPt` from before
the auto-offset — fine (explicit wins), and NEW fixtures should prefer auto
arcs, hand-placing only when a sweep fails.

**Next:** **P2.1** — the TM two-output swap. Read
`designs/transition-notation.md` (incl. Stage-B migration notes) before
implementing; the exact rendered form must be recorded in VISUAL_VOCAB + spec
§10.3. Note there are NO TM fixtures yet (HW5 is pending), so label migration
touches only devData + any sandbox localStorage story.

## 2026-07-06 (iteration 12) — P2.1: TM two-output notation · the deliberate departure lands

**Shipped:** TM transition labels moved off the textbook's dual-action token
(`1:0R`) to the industry-standard two-output form: canonical stored
**`read:write,move`** (`1:0,R`), canvas pill read │ write,move, editor = one
input + two output fields (write, move — write tokens representation-tied, `*`
binary only), machine table gains separate WRITE/MOVE columns, history shows
`0,R`. **Alias + decay** (the P1.12 pattern): legacy `1:0R` parses forever and
canonicalizes on any edit-save — zero migration for old localStorage machines;
devData migrated to canonical anyway. `tmNotation(rep)` is now NATIVE in
`engine/notation.ts` (delegating adapter deleted; `parseTMTransition`/
`parseTMAction` removed from tm.ts entirely — the grep gate de-whitelisted
tm.ts and got stronger); `validateTMTable` folded onto the generic
`validateTransitionTable` walker with a semantic `TableError.kind`
(unparseable/ambiguous/missing) instead of message-sniffing. Engine semantics
untouched: every transition still writes and moves atomically.

**Verified (0 refutations):** byte-equal step traces for three machines × 8
tapes across (a) canonical vs legacy spellings and (b) live engine vs a
pre-swap worktree at `cc8d962`; parse∘format identity over the full corpus; 26
aliases decay correctly; in-browser: three-field editing with rep-tied tokens
(`*` accepted on binary read/write, rejected in move; rejected wholesale on
tally), default label `0:0,R`, live sim writes+moves with canonical history.
Docs recorded everywhere the old token lived: VISUAL_VOCAB §TM, spec §10.3
(departure note rewritten), CLAUDE.md, NORTH_STAR (past tense), design-memo
postscript. Three stale comments the verifier flagged were fixed at close-out.

**Consequence:** the transition-notation seam has now absorbed its third
grammar natively (FSM k-bit, turbot-FSM motor, TM two-output) with turbot-TM
still adapter-delegated — exactly the staged-migration path the design memo
drew. HW5 fixtures (next) author directly in the new notation.

**Next:** **P2.2** — the nine HW5 TM fixtures (tally p1…p6, binary p7…p9).
Batch workflow; spec agent must nail TM codec conventions (tape axis,
`requireStandardHaltPosition`, boxing-for-reuse questions) from engine/tmCodec
+ hw5.pdf; builders author labels in the NEW notation.

## 2026-07-06 (iteration 13) — P2.2: HW5 TM arithmetic · 41/56, all arithmetic done

**Shipped:** nine TM fixtures (`hw5-p1..p9`) in the new two-output notation —
tally x+1/x+3/3x/x+y/3(x+y)/x+3y (3–12 states each) and binary x+1/x−1/x+y
(with real tape-cleanup teeth: the codec rejects extra `*` markers, and p9's
broken variant fails on exactly that). **41/56 verified, 0 regressed,
appearance 9/9** (two-output labels, tape strip, READ|WRITE|MOVE tables, `*`
rendering on binary — all confirmed in-browser; the P1.13 arc auto-offsets held
across 24-arc machines with zero coincident paths).

**The adversarial layer caught a real one:** hw5-p4's first "correct" machine
was REFUTED — it assumed the codec's fixed one-cell block separation while the
statement (and PDF) require ARBITRARY separation. Rebuilt as a 6-state
shift-until-adjacent machine and proven outside the codec on hand-laid tapes
(8 pairs × gaps {1,2,3,5,10} = 40/40; the old machine fails all 32 gap>1
cells, regression-pinned in the prove script). Termination leans on the
documented domain x,y ≥ 1 — a gap-robust machine cannot distinguish a wider
gap from "no y at all".

**Platform-vs-PDF findings (recorded, queued where actionable):**
- `requireStandardHaltPosition` is a DEAD FIELD end-to-end (mechanism exists +
  pinned in tmCodec; grader never sets it; not on the question type) → P2.3.
  Several HW5 statements promise standard position the grader ignores.
- The codec can't test arbitrary block separation (encodeTM hardcodes gap=1)
  → P2.4 (bank layout variation).
- Tally domain: buildQuestionBank samples 0..8 but tally 0-blocks are
  invisible on tape — HW5 banks hand-set to the PDF's x,y ≥ 1. p8's
  max(0, x−1) is DSL-inexpressible → hand-authored bank (documented).
- p7: the PDF's "extra leftmost 0" assumption doesn't hold on this platform
  (encodeTM writes minimal digits) — the reference machine grows the block
  itself; statement adjusted, machine handles both layouts.
- No TM boxing mechanism exists — the five "reuse" problems are flat-inlined;
  grading is functional so this is pedagogy-only.

**Next:** **P2.3** (wire requireStandardHaltPosition — small, makes five
fixture statements honest), then **P1.8** (router memo, gating Phase 3).

## 2026-07-06 (iteration 14) — P2.3: requireStandardHaltPosition wired · statements now honest

**Shipped:** the TM standard-halt-position toggle is live end-to-end: question
field (types.ts) → `gradeTape` AcceptOptions → `acceptTM` (which always
enforced it — nothing upstream ever set it). TM-only checkbox in
QuestionCreator (emits the field only when checked; round-trip verified live
in the browser). hw5-p1..p8 flagged to match their statements' promises; p9
correctly unflagged (promises cleanup, not position). Three new end-to-end
tmCheck pins prove the flag bites and the default path is untouched.

**Verification highlights (0 refutations):** the verifier built its OWN
wrong-position machine (right tape, head one cell left) — fails 0/8 flagged
with position-named reasons, passes 8/8 unflagged; default-path regression via
a HEAD worktree showed the full 56-row ledger byte-identical EXCEPT the one
predicted improvement (hw5-p8 broken 15/16 → 16/16 — its survivor had the
right tape in the wrong position, now caught); flag/statement mapping audited
across all nine fixtures.

**Bookkeeping:** first of CLAUDE.md's two deferred authoring follow-ups
closed; only `allowed_components` (P1.5) remains.

**Next:** **P2.4** — codec-level block-separation variation so hw5-p4's
arbitrary-gap clause has teeth against student machines. Then P1.8 (router
memo, gating Phase 3).

## 2026-07-06 (iteration 15) — P2.4: block-separation variation · hw5-p4's clause has teeth

**Shipped:** `TestCase.separations?: number[]` — an optional per-case layout
hint honored solely inside `encodeTM` (gap after each argument block; absent =
the legacy single cell; other axes ignore it; grader passes it through
opaquely). hw5-p4's bank regenerated: 64 cases spread deterministically across
gaps 1/2/3/5 (16 each; the gap-1 cases omit the field so the default codec
path stays exercised on the graded path). Six new tmCheck [separations] pins
(layout, default-unchanged, round-trip at gap 3, gap=1-only fails raw + via
gradeQuestion). README documents the field.

**Verified (0 refutations):** the pinned old machine AND the verifier's OWN
independently-constructed gap=1-only adder (different algorithm) both fail
EXACTLY the 48 varied cases index-by-index; hand-decoded gap-5 tapes match the
hint cell-for-cell; default-path verdicts byte-identical across six fixtures
(TM/CC/SC/FSM) vs a HEAD worktree — and the same dump for hw5-p4 differs in
exactly the 48 new cases, proving the comparison exercised the change.

**Findings:** TM UI runs never touch encodeTM (students hand-lay tapes;
store seeds blank) — so `separations` is grader-only by construction, no P1.9
parity concern. hw5-p5/p6 reference machines are empirically gap=1-only; their
statements don't promise robustness (the PDF's clause is on P4 only) but they
"reuse" the p4 adder → queued **P2.5** (smalls bucket). Edge noted: encodeTM
clamps separations entries to ≥1 (documented, untested — trivial).

**Next:** **P1.8** — the wire-router design memo (fallback lanes, lane
separation, junction dots at divergence elbows), gating Phase 3 perception.

## 2026-07-06 (iteration 16) — P1.8: wire-router model fix · S1+S2 landed (design memo + 2 slices)

**Design (judge panel, 2 angles):** MODEL-FIX beat POST-PASS 77–65 — fix the
router's world model rather than institutionalize a repair layer. The winning
design agent pre-validated its riskiest claim against the real oracle (all 23
fixtures clean post-bounds-fix; fallbacks 283→99 with the exact residual
distribution). Memo: `designs/wire-routing.md` (5 slices). Judge surfaced five
things both designs missed (continuity bias already mostly dead; two crossing
pipelines; zoom-space thresholds; the oracle replicates port math too, not just
dims; `validateSegmentPosition` shares the phantom bounds) — folded into the
memo + slice acceptance.

**Shipped (2 staged commits, gates green each):**
- **S1** (`4e62a7e`): `src/componentGeometry.ts` owns rendered dimensions
  (MEM 50×50 — the phantom 75×70 default was why every MEM.min wire took the
  obstacle-blind fallback lane) AND port math; CircuitCanvas / wireRouter /
  layoutCheck all import it (local copies deleted → the oracle can't structurally
  desync). Fallbacks **283→99** across 23 CC/SC fixtures, all oracle-clean,
  exact predicted distribution. New `tools/routerCheck.ts` in `npm run check`
  pins the budget, distribution, MEM.min A*-reachability, and geometry parity.
- **S2** (`bdf13b1`): `findDivergencePoints` — multi-branch splits get a dot at
  the divergence elbow (consuming canvas-side crossings for bump-collision
  skip), source-port dot subsumed; 9-case headless corpus; browser-verified a
  fan-out dots at the trunk elbow, not the port.

**Verified (0 refutations):** independent oracle reproduction (23 fixtures
clean, 99 fallbacks, pre-fix 283 baseline reproduced from a worktree), synthetic
MEM-feedback route probe (min wire A*-routed, not fallback), own divergence-dot
corpus, no engine/grader changes.

**⚠ Left undone (model/credit limit mid-sweep):** the **browser sweep** of the
~72 hw3 routes that MOVED under S1 did not run (sweep agent hit the Fable 5
limit). Headless legs all pass; the visual confirmation of the moved MEM routes
+ S2 dots is the first task next session, before S3. Side effect flagged by the
verifier: the shared-geometry swap also shrank MEM's bottom drag-halo and STATE
obstacle bounds in `validateSegmentPosition` (no CC/SC fixture has STATE; no
gate impact) — a beneficial but unswept user-facing drag-validation change.

**Handoff note:** user switched to opus-4-8 and asked to push everything for
pickup in a fresh session. Pushed at this point.

**Next:** browser-sweep S1's moved routes (pending acceptance), then P1.8 S3/S4,
then P3.1 (target-functions design memo).

---

## Scope shift — interface over correctness (user directive, 2026-07-06, between iterations 16 and 17)

Gabriel: what matters is that the model can build a **plausible** machine for
each homework problem — that the interface exists (author, build, simulate,
grade). Exactly-correct answers are a **different, future project**; do not
spend large token budgets chasing them.

**Embedded as a second harness tier.** `coverageCheck.ts` now has tier
`interface` (all 15 pending perception/navigation manifest rows tagged): green
("◐ interface") when the fixture's machine passes Stage-1 validation (mirrored
from the grader's dispatch — CC/SC/FSM/TM/turbot-inner) and `gradeQuestion`
runs end-to-end; the attempt's score is printed, not asserted; broken variant
optional; statement lint + layout oracle still hard. Two new tripwires prove
the tier both accepts a valid-but-wrong machine and regresses a
Stage-1-invalid one. The 41 exact rows are untouched pins (41 exact + 0
interface + 15 pending, 0 regressed; tsc clean).

**Docs updated:** NORTH_STAR (goal + two-tier definition of done), COVERAGE
legend (◐), QUEUE (banner + P3.2/P3.3/P4.3/P5.1 reframed to interface tier;
P2.5 deferred to the correct-answers project; P6.2 per-tier), HANDOFF (scope-
shift banner + watch-out), /handoff command (operating-style directive),
manifest meta. P1.8 router work is unaffected (it IS interface quality).

## 2026-07-06 (iteration 17) — P1.8 S1/S2 acceptance: the browser sweep · 0 violations

**Shipped:** the pending acceptance leg of P1.8 S1+S2 — the in-browser sweep of
the ~72 hw3 routes that MOVED under the shared-geometry fix (iteration 16's
sweep agent died on the model limit before running it). One delegated agent
(128k tokens, 73 tool uses, ~21 min) built a `router-sweep` seed assignment
from the 11 fixtures' correct machines (hw3-p1..p9 + hw2-p7 + hw1-p4), seeded
it per recipe v3, and swept every question with rendered-DOM geometry
extraction (CTM scale=1, SVG user px = rendered px) plus screenshot eyeballing:

- **237 wires checked** (203 across hw3), **0 false merges, 0 through-body**.
- **Dots:** every multi-branch fan-out dotted at the divergence ELBOW, never
  the source port (hw3-p7: port (1480,85) undotted, both sequential 3-branch
  split elbows dotted; hw1-p4: dot 111px downstream of IN1; hw3-p8: 15 dots
  over 8 fan-outs in the densest lattice, no spurious/orphan). r=4 #333
  throughout. hw2-p7 correctly renders zero dots (no fan-outs).
- Docs-only iteration: no code changes. `npm run check` + tsc green; coverage
  steady 41/56 exact · 15 pending (interface) · 0 regressed · 0 warnings.

**Adjudicated non-violations (evidence in the sweep report):**
1. hw3-p9 w49/w50 "merge" candidate = the fan-out's OWN shared trunk with a
   0.33px integer-rounding jitter (trunk rides y=1036.67; the elbow vertex
   rounds to 1037) — sub-pixel, invisible at zoom 1, the dot marks the split.
   S3 note: keep H4 near-merge thresholds ≥0.5px so this class can't
   false-positive.
2. hw3-p9 split at (1375,757) renders as an UNDOTTED T-junction: the split sits
   2px from w53's crossing bump, so `findDivergencePoints`' documented
   bump-collision skip suppresses the dot — rendered output matches the
   headless corpus exactly. Real but borderline readability nit → recorded as
   S3/S4 input (does lane separation moot it, or does the skip radius need
   tuning?).
3. Eight "through-body" candidates were all OR/XOR left-port lead-ins (ports
   inset ~11px inside the curved-body bbox by design) — whitelisted; zero real
   body crossings anywhere.

**Also:** removed HANDOFF's stale "background task in flight" note — the TM
sim-state reset landed as `0ca35b3` and is documented in CLAUDE.md.

**Next:** META-audit-queue (due — last ran iteration 11), then P1.8 S3
(foreign-lane A* cost + H4 near-merge round).

## 2026-07-06 (iteration 18) — META-audit-queue: merged origin/main · gates green · no drift

**Shipped:** the due queue audit (last ran iteration 11), whose main body was
reconciling the branch with `origin/main`, which had moved 7 commits ahead:
PR #13 adds a SIXTH question mode ("open" free-text, manually reviewed;
`gradeQuestion` gains an optional `responseText` and short-circuits open
questions to a `pending` 0/0 result) and PR #11 reworks turbot samples +
turbotCheck (grades FSM- and SC-brained turbots, all four inner modes). Merge
commit `e9122e0` (delegated agent, 184k tokens: 7 conflicted files resolved
preserving BOTH sides; gates run green before commit; independently re-run
after).

**Key resolutions (full detail in the merge report):**
- `engine/turbot.ts`: main's notation-threading (TMNotation param through
  runBrainStep/runTurbot) kept; main's separate `parseTurbotFSMLabel` regex
  grammar DELETED — `validateTurbotFSM` now delegates to the notation seam
  (`validateTransitionTable` over `turbotFsmNotation`), so there is still
  exactly ONE grammar answer and legacy 1-bit aliases keep validating.
- **Pin adjudication (flag for Gabriel):** main's new turbotCheck pin asserted
  1-bit turbot FSM labels are REJECTED; that contradicts the branch's
  documented P1.12 legacy-alias design (alias → canonical 2-bit, decays on
  edit-save, bit-identical execution). The alias design won; the pin now
  asserts acceptance-as-alias. If strict rejection was deliberate on main,
  say so and we'll flip it back with a localStorage migration plan.
- `CircuitCanvas.tsx`: ours wholesale — main's label-editor changes targeted
  the pre-notation editor; both its intents (2-bit turbot editing,
  encoding-tied alphabet) already flow from the notation objects.
  `turbotInternalNotation` is now TMNotation-aware (no `*` on unary questions,
  one answer for editor/validator/engine/grader); turbot-FSM default label is
  main's forward `0:11`.
- `coverageCheck` taught the open-question contract (self-test asserts
  `pending` 0/0), mirroring pipelineCheck.

**Audit findings:** harness 41 exact · 15 pending (interface) · 0 regressed —
COVERAGE.md already matches; no dead/duplicate queue tasks; no patch-cluster
since iteration 11 (P2.1–P2.4 and P1.8 all went through seams/design memos);
queue order stands (P1.8 S3 next). Noted for later phases: SubmissionGrade
scores now denominate over autogradeable questions only, and a `pending`
result carries the raw student response into `SubmissionRecord` (fine locally;
part of the server-split surface). P6.1/P4.3 annotated.

**Next:** P1.8 S3 — foreign-lane A* cost + H4 near-merge validation round
(inputs from the iteration-17 sweep recorded in HANDOFF/QUEUE).

## 2026-07-06 (iteration 18, continued) — merge #2: main's perception questions · P3.1 overtaken

Main moved AGAIN mid-audit (PR #12, `worktree-perception-questions`): merged as
`b36aed6` (same delegated agent, resumed with its merge-#1 context; only
CLAUDE.md conflicted textually). Gates green (perceptionCheck now wired into
`npm run check` — main had never added it; coverageCheck's Stage-1 mirror
brought to parity with gradeQuestion's full post-merge dispatch: open →
perception → turbot → codec). Independently re-verified.

**The big queue consequence:** main's `engine/perception.ts` covers ALL FIVE
queued perception rows exactly — hw2-p10 (min-run 3) / p11 (exact-run 3) / p12
(pattern 110010111, w9 — width follows the pattern, settling the old 8-vs-9
reconciliation) / hw3-p11 (change) / p12 (motion k=3) — as samples Q9–Q13 with
correct AND incorrect circuits pinned 13/13 vs 0/13. So:
- **P3.1 closed as overtaken** (de-facto decision: separate perception question
  kind, outside the codec/notation seams). Residual recorded: three
  target-function forms now exist (formula / perception rule / turbot
  criteria); unification is a deferred refactor question.
- **P3.2/P3.3 rescoped to fixture promotion** (devData circuits → reference
  fixtures; correct answers are FREE here, so the rows go exact tier —
  41→46 when done). Watch: Q13's motion detector is ~80 gates; if the layout
  oracle trips on it, that's evidence to pull P1.8 S3 forward.

Perception grades outside the value codec (raw bit-vector frames); no contact
with the notation seam or requireStandardHaltPosition — the audit found clean
composition everywhere in the auto-merged dispatch.

**Next:** P3.2 (CC perception fixture promotion), then P3.3, then P1.8 S3/S4.
