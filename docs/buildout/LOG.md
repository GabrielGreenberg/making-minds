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
