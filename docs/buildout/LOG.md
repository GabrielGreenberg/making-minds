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
