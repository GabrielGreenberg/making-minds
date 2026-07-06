# Handoff — the hot state

_Read this first. It says exactly where we are and what to do next. Rewrite it at
the end of every iteration. If it conflicts with the harness, the harness wins —
run `npm run coverage` and reconcile._

## Where we are

Branch `buildout-infra`. **31 / 56 verified**, 25 pending, 0 regressed, 0
warnings. Eight iterations done. HW1–HW3 arithmetic fully ✅; HW4 arithmetic
8/9 (hw4-p8/p9/p10 are grading-✅ but appearance-blocked on a renderer defect
→ P1.13; hw4-p11 is BLOCKED on an engine gap → P1.12). VISUAL_VOCAB's FSM
section was refreshed from textbook ch. 22 (initial state has NO arrow marker;
never-halt rule for function FSMs).

## Do this next — P1.12: transition-notation design memo + FSM k-bit alphabet

The most valuable unblock: ONE engine change opens hw4-p11 (needs 2-bit input
symbols) AND the Phase-4 FSM navigation cluster (needs 2-bit motor outputs),
and kills a **silent-misgrading footgun** (a 2-input FSM question authors fine
today and grades against wire 0 only — proven by an identity machine passing
exactly the y=0 slice).

1. **Design memo first** (`docs/buildout/designs/transition-notation.md`): the
   family is QUEUE P2.1's — four transition grammars live as scattered string
   conventions (FSM `0:1`, TM `1:0R`, turbot-TM internal `0:1`/`1:L`, external
   `E:↑`). Design the per-mode notation module (parse / validate / render /
   edit as one pluggable unit) that all four implement; the FSM k-bit alphabet
   is the first slice; TM two-output (P2.1) becomes a notation swap later.
   Weigh against the shallow FSM-only string change; decide slice boundaries so
   the harness stays green this iteration (seam first, migrate next).
2. **Implement the FSM k-bit slice** through the chosen seam. Touch points
   (verified by the hw4 spec agent): `engine/fsm.ts` (match on the joined
   input row `enc.steps[t].join('')`), `engine/machineValidation.ts` (enumerate
   all 2^k symbols per state; REJECT/flag questions whose input-group count
   exceeds the supported width — the footgun guard), `engine/grader.ts:139-141`
   (feed the full row, not `s[0]`), the label editor in CircuitCanvas
   (left-half token width k), store typed-sequence feeding (k parallel streams;
   scWindowCheck's FSM branch must stay green — it pins numeral input).
   Convention: left half = one bit per input group concatenated in cc_spec
   declaration order (`xy:o`), matching the codec's wire order and the course's
   own 2-bit motor notation.
3. **Prove with the fixture:** build hw4-p1 1 (x+y B, 2-state serial adder with
   4 transitions per state) via the standard template; the batch spec's
   construction sketch is in the workflow output (task w2rz02yu0). Wire it;
   coverage → 32/56.
4. **Gates:** scWindowCheck (45 checks), tmCheck, turbotCheck (turbot FSM
   brains use 1-bit labels — must keep working), pipelineCheck, coverage, tsc,
   build.

**Acceptance:** memo written; hw4-p11 verified (32/56, 0 regressed); a 2-input
FSM question without engine support can no longer silently mis-grade; all
gates green.

## Then

P1.13 (FSM coincident-arc renderer fix → hw4-p8/p9/p10 appr ✅) → P1.8 (wire-
router design memo; gates Phase 3) → P1.5/P1.6/P1.10/P1.11 (small) → Phase 2
(P2.1 TM two-output — now just a notation swap if the P1.12 design holds).
META-audit-queue due ~iteration 10.

## Watch out for

- **The transition-notation design must not break turbot-TM grammars** —
  `validateTurbotTM` and the turbot FSM brain path use the same label
  plumbing; turbotCheck is the canary.
- **scWindowCheck (45) and the harness bars are load-bearing**; statement lint
  + layout oracle run automatically (layout oracle skips FSM rows).
- **Window degeneracy** when picking broken variants for adjacent questions
  (p3's saturating +1 also passes p4's bank — see LOG iteration 8).
- **Ops:** 529 → resume workflow; session limit → finish verification solo.
- **Appearance recipe v3** + serve seeds from `app/public/` at base path
  `/making-minds/`; clean keys twice.
- `tsx` missing → `npm install`; no lockfile churn.
