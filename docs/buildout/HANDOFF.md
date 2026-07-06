# Handoff — the hot state

_Read this first. It says exactly where we are and what to do next. Rewrite it at
the end of every iteration. If it conflicts with the harness, the harness wins —
run `npm run coverage` and reconcile._

## Where we are

Branch `buildout-infra`. **23 / 56 verified**, 33 pending, 0 regressed. Seven
iterations done. The harness now enforces its own quality bars (P1.7): per-row
broken-fail fractions (breadth WARN <25% on sampled banks), drain-witness
warnings for SC/FSM, a statement lint (hard fail), and the layout oracle
(`tools/layoutCheck.ts`, hard fail for CC/SC fixtures) — all with self-test
tripwires. SC/FSM question runs use the canonical codec window end-to-end
(P1.9, pinned by `tools/scWindowCheck.ts`).

## Do this next — P1.4: HW4 FSM arithmetic (hw4-p3…p11)

Nine FSM fixtures, the same batch-workflow shape as HW1–HW3 (spec-from-PDF →
parallel build+prove → wire → adversarial verify + gates + appearance → critic).
FSM-specific prep:

- **META-visual-vocab first step:** an agent re-reads the textbook FSM chapter
  (`spec/mm_textbook.pdf`) + `Mock_Ups-9.jpg` and refreshes VISUAL_VOCAB's FSM
  section BEFORE the appearance sweep (states = circles S0/S1…, S0 initial with
  incoming arrow from nowhere, `input:output` Mealy labels, ≤1 outgoing arrow
  per input value, missing arrow = halt, state table view, current-state
  highlight).
- **Spec agent reads:** `engine/fsm.ts` (transition-matching semantics, halt
  behavior), the FSM sample in `devData/sampleData.ts` (identity machine), and
  the STATE component conventions in `tools/builder.ts` / types.ts (how
  transitions are stored — wires with `input:output` labels between STATE
  components). Same LSB-first time axis as SC; banks SAMPLED (broken must fail
  broadly — the harness now WARNS under 25%).
- **Problems (manifest):** hw4-p3 "x B (identity)", p4 "+1 B", p5 "+2 B",
  p6 "+3 B", p7 "+4 B", p8 "2x B", p9 "2x+1 B", p10 "2(x+1) B", p11 "x+y B" —
  cross-check against `problem sets/hw4.pdf` (PDF wins; some may be tally not
  binary — verify).
- **Pin full row ids** (`hw4-pN`) in the spec-agent schema.
- **Appearance:** FSM canvas renders STATE circles + curved transition arrows
  (NOT the wire router — layoutCheck skips FSM rows). Vehicle recipe v3 (LOG
  iteration 4); check against the refreshed VISUAL_VOCAB (arrow labels, S0
  marker, current-state highlight during a run).
- **P1.9 groundwork applies:** FSM question runs execute the codec window with
  numeral (MSB-left) typed input — fixtures test exactly what students see.

**Acceptance:** `npm run coverage` → 32/56 verified, 0 regressed, no new
warnings (or explicitly justified ones); hw4-p3..p11 fully ✅ incl. appearance
against the REFRESHED VISUAL_VOCAB; gates green.

## Then

P1.8 (router design memo — gates Phase 3) → P1.5 (allowed_components) →
P1.6/P1.10/P1.11 (small) → Phase 2 (TM two-output, design memo). Next
META-audit-queue due around iteration 10.

## Watch out for

- **The harness now bites:** new fixtures must pass the statement lint and (for
  CC/SC) the layout oracle automatically. FSM rows skip the layout oracle but
  the appearance sweep still applies (STATE-curve rendering).
- **scWindowCheck is load-bearing** (45 checks; drives the real store headlessly
  — copy its window/document-shim pattern for store-level checks).
- **Ops:** 529 outages → `Workflow({scriptPath, resumeFromRunId})`; subagent
  session limit can hit mid-workflow — finish critical verification solo.
- **Appearance seeding recipe v3** (LOG iteration 4): reload → Home → seed
  `mm:inst-asg:<id>` + `mm:asg:<id>` → click-navigate; never seed-then-reload;
  base path `/making-minds/`; clean keys twice.
- `tsx` missing after checkout → `npm install`; no lockfile churn commits.
