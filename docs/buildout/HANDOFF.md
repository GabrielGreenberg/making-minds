# Handoff — the hot state

_Read this first. It says exactly where we are and what to do next. Rewrite it at
the end of every iteration. If it conflicts with the harness, the harness wins —
run `npm run coverage` and reconcile._

## Where we are

Branch `buildout-infra`. **14 / 56 verified** (HW1 complete 7/7 + HW2 arithmetic
7/7), 42 pending, 0 regressed. The CC fixture pipeline is mature: production
`buildQuestionBank` banks, engine-native XOR/HA/BOXED composites, adversarial
verify + appearance sweep. See LOG iterations 1–3 for the template + gotchas.

## Do this next — P1.3: HW3 SC arithmetic (hw3-p1…p9)

Nine sequential-circuit fixtures — the **first non-CC batch**. Same workflow
shape (spec-from-PDF → parallel build+prove → wire → adversarial verify + gates
+ appearance → critic), with SC-specific prep:

- **Spec agent must also read** `app/src/engine/sc.ts` (clocked step semantics,
  MEM ports M_IN/M_OUT), the SC sample machine in `app/src/devData/sampleData.ts`
  (canonical serial circuit, e.g. the 2x delay), and how `buildQuestionBank`
  samples SC banks (`time` axis, bit-length sampling — NOT exhaustive).
- **Pipeline-drain rule** (CLAUDE.md): after the input sequence is consumed, Run
  continues one 0-input drain step per MEM so delayed bits (serial-adder final
  carry) reach the output. Carry problems (x+y serial adder) exercise exactly
  this — confirm the drain behaves before blaming a fixture.
- **Sampled banks change the broken-variant bar:** broken must fail within the
  SAMPLED bank (hw2-p6's diverge-only-at-x=15 trick would be unsafe here). Prefer
  near-misses that fail on many inputs (dropped carry, missing MEM).
- **Three tally items** are in scope (manifest rows say which) — canonical
  1s-then-0s codewords only (LOG iteration 2).
- **Time flows right→left** in SC tables (VISUAL_VOCAB) — appearance sweep should
  check the timeline panel, and MEM sits at the top of the canvas by convention.
- **Pin the id format in the spec-agent schema** (`hw3-pN`, exactly) — iteration
  3's `p1.json` naming bug came from not doing this. Fixture files are
  `reference/<row-id>.json`, no exceptions.

**Acceptance:** `npm run coverage` → 23/56 verified; hw3-p1..p9 rows fully ✅
incl. appearance; gates green.

## Then

P1.4 (HW4 FSM arithmetic, hw4-p3…p11) → P1.5 (`allowed_components` enforcement)
→ P1.6 (cc.ts label-ordering unification) → Phase 2 (TM two-output, design memo
first). A META-audit-queue is due around iteration 5 — next iteration or the one
after should run it.

## Watch out for

- **Depth over patches** (NORTH_STAR): P1.3 is template-stamping in a new mode —
  if SC surprises appear (drain bugs, codec time-axis quirks), decide shallow vs
  deep explicitly and memo significant moves.
- **Delegate to survive:** batch = Workflow (~19 agents / ~1.2M subagent tokens
  observed for 7 fixtures); keep only conclusions here.
- **Appearance recipe v2** (LOG iteration 2): reload to Home FIRST, seed
  `mm:asg:cc-basics` localStorage on Home, click-navigate (tag + preview_click);
  SVG DOM audits for fine detail. The vehicle assignment's Q1 canvas renders any
  mode's components, but an SC/timeline appearance check may need a real SC
  question vehicle — if cc-basics Q1 (CC mode) won't show the SC timeline panel,
  seed the devData sample SC assignment instead (seed.ts) and open its question.
- Constants: no constant sources — `OR(w, NOT w)` = 1, `AND(w, NOT w)` = 0.
- `tsx` missing after checkout → `npm install`; don't commit lockfile churn.
- Dev server for appearance: preview_list first (last serverId
  b866048c-28e4-4f0b-8d27-f69d70a34f61), else preview_start "dev" (5173).
