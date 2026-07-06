# Problem Coverage Matrix

_The definition of done and the progress ledger. One row per machine-buildable
problem in HW1–HW6. The project is done when every **status** is ✅._

**Source of truth:** the coverage harness (`app/tools/coverageCheck.ts`) is
authoritative; this table is the human-readable mirror. Regenerate it from the
harness each iteration: run `npm run coverage` (from `app/`), read the
`COVERAGE SUMMARY (json)` block, and update the **grades** + **status** columns to
match. `app/tools/fixtures/coverage-manifest.json` holds the same rows in
machine-readable form (fixture paths live there).

**Legend** — status: ⬜ pending · 🟨 in progress · ✅ verified · ⛔ blocked/regressed.
A row is ✅ only when the manifest row has a fixture and the harness reports it
`verified` (correct passes every case, broken variant fails), AND appearance has
been checked against [VISUAL_VOCAB.md](VISUAL_VOCAB.md).

**As of 2026-07-06:** harness live, **1/56 verified** (hw1-p1), 55 pending. The
self-test proves the harness discriminates across all five modes today.

## Columns

`auth` = authorable · `build` = reference solution builds in UI · `grades` =
harness verified (correct✓ + broken✗) · `appr` = appearance matches VISUAL_VOCAB.

---

### HW1 — Basics (CC)  ·  1/7

| id | problem | category | auth | build | grades | appr | status | notes |
|----|---------|----------|:----:|:-----:|:------:|:----:|:------:|-------|
| hw1-p1  | NAND | logic | ✅ | ✅ | ✅ | ✅ | ✅ | fixture `reference/hw1-p1.json`; proven headlessly (4/4 correct, 0/4 broken), appearance checked 2026-07-06 |
| hw1-p2  | reconstruct OR (no OR gate, DeMorgan) | logic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | allowed_components should exclude OR |
| hw1-p3  | splitting outputs (2-in → 2-out) | logic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| hw1-p4  | XOR | logic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| hw1-p5  | combining circuits (2-in → 2-out) | logic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| hw1-p16 | M: successor of tal(I), 1-in → 2-out | arithmetic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | tally successor |
| hw1-p17 | N: successor of bin(I), 1-in → 2-out | arithmetic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | binary successor |

### HW2 — Computing with CCs  ·  0/13

| id | problem | category | auth | build | grades | appr | status | notes |
|----|---------|----------|:----:|:-----:|:------:|:----:|:------:|-------|
| hw2-p1  | +1 [0-15] B | arithmetic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| hw2-p2  | +2 [0-15] B | arithmetic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| hw2-p3  | +3 [0-15] B | arithmetic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| hw2-p4  | 2x [0-15] B | arithmetic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| hw2-p5  | 2x+1 [0-15] B | arithmetic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| hw2-p6  | 2(x+1) [0-15] B | arithmetic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | reuse one +1 sub-part |
| hw2-p7  | x+y [0-15] B | arithmetic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| hw2-p10 | edge detector (≥3 consecutive 1s) | perception | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | 8-in→1-out; **DSL can't express — spike** |
| hw2-p11 | object detector (exactly 3 consecutive 1s) | perception | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | 8-in→1-out |
| hw2-p12 | landmark recognition (= 110010111) | perception | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | pattern 9 bits vs 8-in schematic — reconcile |
| hw2-p13 | spiral (CC turbot, pass-through) | navigation | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| hw2-p14 | full circle (CC turbot, pass-through) | navigation | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| hw2-p15 | zig-zag (CC turbot, pass-through) | navigation | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |

### HW3 — Computing with SCs  ·  0/14

| id | problem | category | auth | build | grades | appr | status | notes |
|----|---------|----------|:----:|:-----:|:------:|:----:|:------:|-------|
| hw3-p1  | +1 B | arithmetic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| hw3-p2  | +2 B | arithmetic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| hw3-p3  | 2x B | arithmetic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| hw3-p4  | 2x+1 B | arithmetic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | reuse 2x + +1 |
| hw3-p5  | 2(x+1) B | arithmetic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | reuse 2x + +1 |
| hw3-p6  | x+y B | arithmetic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| hw3-p7  | +3 T (feasible) | arithmetic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | expected constructible |
| hw3-p8  | 2x T (feasible) | arithmetic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | expected constructible |
| hw3-p9  | x+y T (feasible) | arithmetic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | expected constructible |
| hw3-p11 | change detector (current ≠ previous) | perception | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | 8-in SC, spatio-temporal |
| hw3-p12 | motion detector (object image moving up) | perception | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | 8-in SC, spatio-temporal |
| hw3-p13 | zig-zag: reach & keep going | navigation | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | SC turbot, pass-through |
| hw3-p14 | three ahead: reach & stop | navigation | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | SC turbot, reach-and-stop |
| hw3-p15 | Mad Max: block ahead unknown dist, return & stop | navigation | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | return-to-start; **multi-arena + memory** |

_Note: HW3 #10 (x·y B) is an impossibility argument (not SC-computable) — excluded._

### HW4 — Computing with FSMs  ·  0/12

| id | problem | category | auth | build | grades | appr | status | notes |
|----|---------|----------|:----:|:-----:|:------:|:----:|:------:|-------|
| hw4-p3  | +1 T | arithmetic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| hw4-p4  | +2 T | arithmetic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| hw4-p5  | +1 B | arithmetic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| hw4-p6  | +2 B | arithmetic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| hw4-p7  | +4 B | arithmetic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| hw4-p8  | 2x B | arithmetic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| hw4-p9  | 2x+1 B | arithmetic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| hw4-p10 | 2(x+1) B | arithmetic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| hw4-p11 | x+y B | arithmetic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| hw4-p12 | zig-zag: reach & keep going | navigation | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | FSM turbot; **needs 2-bit motor F/S/R/L** |
| hw4-p13 | three ahead: reach & stop | navigation | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | FSM turbot; needs 2-bit motor |
| hw4-p14 | way finder: any non-branching maze | navigation | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | general solver; **multi-arena** |

_Note: HW4 #1–2 (state abstraction / multiple realizability) are analysis essays — excluded._

### HW5 — Computing with TMs  ·  0/9

| id | problem | category | auth | build | grades | appr | status | notes |
|----|---------|----------|:----:|:-----:|:------:|:----:|:------:|-------|
| hw5-p1  | x+1 T | arithmetic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | standard-position rules |
| hw5-p2  | x+3 T | arithmetic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | reuse x+1 |
| hw5-p3  | 3x T | arithmetic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | reuse x+3 |
| hw5-p4  | x+y T (arbitrary separation) | arithmetic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | blocks not adjacent |
| hw5-p5  | 3(x+y) T | arithmetic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| hw5-p6  | x+3y T | arithmetic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| hw5-p7  | x+1 B (extra leftmost 0) | arithmetic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | std-position + well-formed output |
| hw5-p8  | x−1 B (0 if x=0) | arithmetic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| hw5-p9  | x+y B (clean up tape) | arithmetic | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | reuse x+1, x−1 |

_Note: HW5 #10–11 (multiplication strategy / multi-function machine) are prose/flowchart — excluded._

### HW6 — Navigation with Turbots (TM-brained)  ·  0/1

| id | problem | category | auth | build | grades | appr | status | notes |
|----|---------|----------|:----:|:-----:|:------:|:----:|:------:|-------|
| hw6-p2 | Desert Ant: find food (NE), pass over, return to start | navigation | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | TM-turbot; 30×30, ≤20 tape cells; unknown start+food; **multi-arena** |

_Note: HW6 #1 & #3 (flowchart / life-cycle prose) are excluded._

---

**Totals:** 0 / 56 verified.
