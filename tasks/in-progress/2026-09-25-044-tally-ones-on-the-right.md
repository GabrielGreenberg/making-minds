---
id: 2026-09-25-044
type: bug
title: Write tally numerals with their 1s on the right, as the textbook and the spec do, on every axis
priority: urgent
size: large
requires: browser
area: app
source: audit
created: 2026-09-25T10:35:00-07:00
status: in-progress
after:
branch: task/044-tally-ones-on-the-right
merged_into:
---

## Description
From the HW1 release audit (2026-09-25, chat; Gabriel's "HW1 Release Audit" page). The
textbook (pp. 26–27, "Tally Syntax": a well-formed tally numeral is `0…0 1…1`, "the first n
bits from the right are 1's"; `0011` well-formed, `1000` not), the platform spec
(`spec/PHIL_133_Platform_Spec_v2.md:769`, "'0011' represents 2") and `VISUAL_VOCAB.md` §Tally
all put a tally numeral's 1s on the RIGHT. The engine's rep core does the mirror image:
`app/src/engine/representation.ts` `bitsToTally` accepts "consecutive 1's from the left" and
`valueToBits` writes the ones first. Reproduced with the real grader:

- **Space (CC).** HW1 P16's textbook answer (O₁O₂ = `01` for I = 0; the PDF's own example
  says tal(01) = one) grades 1/2, "malformed output". The reference fixture passes with `10`,
  which the book calls ill-formed (COVERAGE.md even notes "broken emits non-canonical `01`").
- **Time (SC/FSM).** The codec lays tally 2 over eight steps as t1…t8 = 0,0,0,0,0,0,1,1, so
  the ones arrive LAST. The textbook's +1 T FSM (p. 101: S₀ 1:1 loop, 0:1 → S₁, S₁ 0:0),
  given an unused S₁ 1-arrow, scores 1/9 on HW4 P3; its reference "correct" machine is a
  10-state leading-zero counter built to fit the grader.
- **Display.** The I/O tables' tally reading shows `0011` as '/'.

Affected questions: HW1 P16, HW3 P7–9, HW4 P3–4 (none released). HW5 is not affected
(`tmCodec` lays tally blocks itself). The sandbox's raw typed feed (rightmost char at t1)
already puts the ones first, so after the fix question runs and the sandbox agree. The
"ones arrive LAST" convention was written down on purpose in task P1.9b
(`app/tools/scWindowCheck.ts` header) — against the spec; Gabriel approved reversing it
(2026-09-25).

## Done when
1. `valueToBits(n, w, 'tally')` writes zeros then n ones; `bitsToTally` accepts `0…01…1`
   only. The codec (both axes), question runs, the data table and test-vector generation
   follow from the core — no per-axis special case.
2. HW1 P16 grades the textbook answer (OUT1 = I, OUT2 = 1) 2/2 and the mirrored one fails;
   the textbook's p. 101 +1 T FSM (plus the unused S₁ 1-arrow that task 047 would make
   unnecessary) passes HW4 P3. Both pinned.
3. Fixtures `hw1-p16`, `hw3-p7`, `hw3-p8`, `hw3-p9`, `hw4-p3`, `hw4-p4` re-authored as
   textbook-shaped machines (correct passes every case, broken fails, layout oracle green);
   their COVERAGE.md rows rewritten.
4. The pins in `codecCheck` / `scWindowCheck` / `caseRunCheck` state the new orientation, and
   the comments that describe "ones arrive last / ones leftmost" (store.ts, outputDisplay.ts,
   scWindowCheck.ts) are rewritten.
5. All gates green (PROFILE §6).

## Design
- **deepFix (chosen):** flip the ONE rep core (`valueToBits` + `bitsToTally`). Everything that
  lays out, accepts or displays a tally numeral already derives from it.
- **surgicalFix (rejected):** accept both orientations for P16 only. It leaves HW3/HW4 grading
  against the book and the table showing '/'.

## Verify
Gates. The P16 and p. 101 probes become pins. A browser look at an SC tally question run
(typed `0011` reads as 2; a textbook machine's run decodes) — owed against `main` if the
worktree cannot run a dev server.

## Progress log
- 2026-09-25 — filed and claimed from the HW1 audit; worked in the worktree
  `.claude/worktrees/hw1-release` because the main checkout is on task/042. Next: flip the
  core, run the gates, re-author the six fixtures.
