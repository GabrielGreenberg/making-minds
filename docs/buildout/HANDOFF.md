# Handoff — the hot state

_Read this first. It says exactly where we are and what to do next. Rewrite it at
the end of every iteration. If it conflicts with the harness, the harness wins —
run `npm run coverage` and reconcile._

## Where we are

Branch `buildout-infra`. **41 / 56 verified**, 15 pending, 0 regressed, 0
warnings. Thirteen iterations done. **ALL arithmetic is complete** (HW1–HW5,
appearance included). Remaining pending: perception (hw2-p10..12,
hw3-p11..12), navigation (hw2-p13..15, hw3-p13..15, hw4-p12..14), the HW6
turbot-TM capstone. Remaining walk: **P2.3 → P2.4 → P1.8 → P3.1 → P3.2/P3.3 →
P4.2 → P4.3 → P5.1 → smalls (P1.5/P1.6/P1.11) → P6**.

## Do this next — P2.3: wire `requireStandardHaltPosition`

Small grading-fidelity task that makes five HW5 statements honest. The
mechanism exists and is pinned (tmCodec `AcceptOptions.requireStandardHaltPosition`,
enforced at acceptTM and tested by tmCheck) but is dead end-to-end:

1. Add the field to `AssignmentQuestion` (types.ts — check: QUEUE says it
   already exists as an optional field from the original spec; verify) and
   make `gradeTape` (grader.ts ~177) pass it through to `acceptTM`.
2. Expose the toggle in `QuestionCreator` (the CLAUDE.md "deferred authoring
   follow-ups" item — TM-mode only).
3. Set it `true` on the HW5 fixtures whose statements promise standard
   position (p1, p2, p3, p4, p5, p6 tally; p7 binary — check each statement);
   re-run coverage — all should stay verified (builders future-proofed: every
   correct machine already halts in standard position; hw5-p8's broken variant
   should now fail its one surviving case, IMPROVING its breadth fraction).
4. Add a tmCheck/pipelineCheck pin: a machine with the right tape but wrong
   halt position FAILS a question with the flag set.
5. Gates: check/tsc/build/coverage (41/56, 0 regressed).

**Acceptance:** the flag is honored by the grader + exposed in the creator;
HW5 rows re-verify; a wrong-position machine demonstrably fails; CLAUDE.md's
deferred-follow-up note updated.

## Then

P2.4 (codec: vary tally block separation so hw5-p4's robustness clause has
teeth) → P1.8 (wire-router design memo — gates Phase 3) → P3.1
(target-functions design memo) → perception fixtures → navigation → capstone.

## Watch out for

- **HW5 fixtures' correct machines all halt in standard position** — setting
  the flag must not regress them; if one fails, the machine (not the flag) is
  wrong.
- **notationCheck grep gate** + **tmCheck** pin the TM grammar and engine.
- **Ops:** 529 → resume workflow; session limit → finish solo.
- **Appearance recipe v3**; seeds from `app/public/` at `/making-minds/`
  (delete seed files from `app/dist/` too if a build ran after seeding).
- `tsx` missing → `npm install`; no lockfile churn.
