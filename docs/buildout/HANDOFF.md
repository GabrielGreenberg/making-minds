# Handoff — the hot state

_Read this first. It says exactly where we are and what to do next. Rewrite it at
the end of every iteration. If it conflicts with the harness, the harness wins —
run `npm run coverage` and reconcile._

## Where we are

Branch `buildout-infra`. **41 / 56 verified**, 15 pending, 0 regressed, 0
warnings. Fourteen iterations done. **ALL arithmetic is complete** (HW1–HW5,
appearance included), and `requireStandardHaltPosition` is live end-to-end
(P2.3). Remaining pending: perception (hw2-p10..12, hw3-p11..12), navigation
(hw2-p13..15, hw3-p13..15, hw4-p12..14), the HW6 turbot-TM capstone.
Remaining walk: **P2.4 → P1.8 → P3.1 → P3.2/P3.3 → P4.2 → P4.3 → P5.1 →
smalls (P1.5/P1.6/P1.11) → P6**.

## Do this next — P2.4: codec-level block-separation variation

hw5-p4's statement (and the PDF) require an x+y machine to work for ANY number
of 0-cells between the argument blocks, and the reference machine now genuinely
does (gap-robust, proven on hand-laid tapes) — but `encodeTM` hardcodes exactly
one separator cell, so the grading pipeline can never test a STUDENT machine's
robustness: a gap=1-only machine passes the whole bank.

1. Read `engine/tmCodec.ts` (encodeTM two-arg layout) + how TM test_cases carry
   values (grader.ts tape branch; TMTestCase shape if any). Design the smallest
   seam-respecting way to vary separation per case — e.g. an optional
   per-test-case layout hint (`separations?: number[]` alongside inputs) that
   encodeTM honors, defaulting to 1 — so banks can mix gaps without changing
   the value-based contract. Watch: the codec is shared by grading AND the
   UI question-run path (scWindowCheck pins SC/FSM; TM UI runs go through the
   store's tape panel — check whether question runs encode via the same path
   and keep them consistent).
2. Regenerate hw5-p4's bank to include gap>1 cases (e.g. gaps 1,2,3,5 spread
   across the 64 pairs); consider p5/p6 too IF their statements promise
   arbitrary separation (read them — if they don't, leave them).
3. Prove the teeth: the OLD refuted gap=1-only p4 machine (regression-pinned in
   `scratchpad/prove_hw5_p4_v2.ts`) must now FAIL the new bank through the
   normal grader; the current gap-robust correct machine must pass 100%.
4. Pins: tmCheck or coverageCheck addition proving varied-separation encoding
   round-trips (encode → run → accept → decode) at gap≠1.
5. Gates: check/tsc/build/coverage — 41/56, 0 regressed (hw5-p4 stays verified
   with its NEW bank; fraction may change — report).

**Acceptance:** hw5-p4's bank contains varied separations; the old gap=1-only
machine demonstrably fails via the grader; all gates green.

## Then

P1.8 (wire-router design memo — gates Phase 3 perception) → P3.1
(target-functions design memo) → P3.2/P3.3 perception fixtures → P4.2
multi-arena grading → P4.3 navigation arenas → P5.1 capstone → smalls → P6.

## Watch out for

- **TM UI runs**: if the student-facing tape panel encodes inputs through the
  same codec path, varied separations must not confuse the UI question-run
  seeding (the P1.9 lesson: UI must feed exactly what the grader feeds — check
  how TM question runs seed the tape; keep parity).
- **notationCheck grep gate + tmCheck pins** (incl. the three new P2.3
  standard-halt pins) must stay green.
- **Ops:** 529 → resume workflow; session limit → finish solo.
- **Appearance recipe v3**; seeds from `app/public/` at `/making-minds/`.
- `tsx` missing → `npm install`; no lockfile churn.
