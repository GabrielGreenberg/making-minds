# Problem Coverage Matrix

_The definition of done and the progress ledger. One row per machine-buildable
problem in HW1–HW6. The project is done when every row is green **at its tier**:
✅ exact for the arithmetic rows (already met), ◐ interface for perception &
navigation (a plausible attempt that validates + grades end-to-end; correctness
NOT required — user directive 2026-07-06; exact answers are a separate future
project)._

**Source of truth:** the coverage harness (`app/tools/coverageCheck.ts`) is
authoritative; this table is the human-readable mirror. Regenerate it from the
harness each iteration: run `npm run coverage` (from `app/`), read the
`COVERAGE SUMMARY (json)` block, and update the **grades** + **status** columns to
match. `app/tools/fixtures/coverage-manifest.json` holds the same rows in
machine-readable form (fixture paths live there).

**Legend** — status: ⬜ pending · 🟨 in progress · ✅ exact-verified · ◐
interface-verified · ⛔ blocked/regressed.
✅ = harness `verified` at tier **exact** (correct passes every case, broken
variant fails). ◐ = harness `interface` at tier **interface** (plausible attempt
passes Stage-1 validation + grades end-to-end; score reported, not asserted; no
broken variant needed). Both also require appearance checked against
[VISUAL_VOCAB.md](VISUAL_VOCAB.md). Tier lives on the manifest row; all 15
remaining rows are tier `interface`.

**As of 2026-07-07 (post-iteration 20):** harness live with two tiers,
**46/56 exact-verified** (ALL arithmetic HW1–HW5 + ALL perception hw2-p10..p12
+ hw3-p11..p12, promoted from main's devData samples at exact tier — correct
answers were free), 10 pending at the interface tier, 0 regressed. Remaining
pending: navigation (hw2/hw3/hw4 ×3 each), HW6 turbot-TM capstone (1).
**Do not chase correct answers for these** — the bar is a plausible attempt
through the full pipeline (free correct machines excepted).

## Columns

`auth` = authorable · `build` = reference machine builds in UI · `grades` =
harness green at the row's tier (exact: correct✓ + broken✗; interface: attempt
validates + grades end-to-end) · `appr` = appearance matches VISUAL_VOCAB.

---

### HW1 — Basics (CC)  ·  7/7 ✅

| id | problem | category | auth | build | grades | appr | status | notes |
|----|---------|----------|:----:|:-----:|:------:|:----:|:------:|-------|
| hw1-p1  | NAND | logic | ✅ | ✅ | ✅ | ✅ | ✅ | fixture `reference/hw1-p1.json`; proven headlessly (4/4 correct, 0/4 broken), appearance checked 2026-07-06 |
| hw1-p2  | reconstruct OR (no OR gate, DeMorgan) | logic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw1-p2.json`; correct = DeMorgan (no OR), broken = NAND near-miss; `allowed_components` set on the question but **unenforced** (→ QUEUE P1.5) |
| hw1-p3  | splitting outputs (2-in → 2-out) | logic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw1-p3.json`; AND splits to OUT1 + NOT→OUT2; junction dot verified |
| hw1-p4  | XOR | logic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw1-p4.json`; primitives (2 NOT, 2 AND, OR); broken = plain OR fails on (1,1) |
| hw1-p5  | combining circuits (2-in → 2-out) | logic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw1-p5.json`; half-adder (sum `x ^ y`, carry `x & y`); crossing bump verified |
| hw1-p16 | M: successor of tal(I), 1-in → 2-out | arithmetic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw1-p16.json`; canonical tally forces O1=1, O2=I (PDF's position-insensitive tal() nuance noted in LOG); broken emits non-canonical `01` |
| hw1-p17 | N: successor of bin(I), 1-in → 2-out | arithmetic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw1-p17.json`; one 2-wide output group (OUT1 = MSB); broken = endianness swap |

### HW2 — Computing with CCs  ·  10/13

| id | problem | category | auth | build | grades | appr | status | notes |
|----|---------|----------|:----:|:-----:|:------:|:----:|:------:|-------|
| hw2-p1  | +1 [0-15] B | arithmetic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw2-p1.json`; HA-ripple increment; bank via `buildQuestionBank` (16 cases); broken = dropped carry |
| hw2-p2  | +2 [0-15] B | arithmetic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw2-p2.json`; shifted ripple from bit 1; broken = carry-free `x^2` |
| hw2-p3  | +3 [0-15] B | arithmetic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw2-p3.json`; two-bit constant add (XOR/OR/HA); broken = `x^3` |
| hw2-p4  | 2x [0-15] B | arithmetic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw2-p4.json`; wire shift + synthesized const-0 LSB; broken = endianness swap |
| hw2-p5  | 2x+1 [0-15] B | arithmetic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw2-p5.json`; shift + const-1 LSB (`OR(w, NOT w)`); broken = const-0 (computes 2x) |
| hw2-p6  | 2(x+1) [0-15] B | arithmetic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw2-p6.json`; **BOXED `+1` reuse exercised** (internals = p1 circuit); broken diverges only at x=15 (narrowest near-miss) |
| hw2-p7  | x+y [0-15] B | arithmetic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw2-p7.json`; ripple adder (7 HA + 3 OR), 256/256; layout re-computed by topo depth after appr failure (backward carry wires) — now 25/25 forward |
| hw2-p10 | edge detector (≥3 consecutive 1s) | perception | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw2-p10.json`; devData Q9 (min-run 3, w8) promoted at exact tier; 256-case exhaustive bank; broken (OR-all) fails 148/256 |
| hw2-p11 | object detector (exactly 3 consecutive 1s) | perception | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw2-p11.json`; devData Q10 (exact-run 3, w8); broken (= the ≥3 detector) fails 46/256; appr ✅ with ONE known renderer-class residual: 6 bumpless crossings (router lane hugs port column, inside pathDWithBumps' 5px skip) — P1.8 S3's exhibit, pinned by `tools/bumpCheck.ts` |
| hw2-p12 | landmark recognition (= 110010111) | perception | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw2-p12.json`; devData Q11 (pattern, w9 — width follows the pattern; 8-in schematic question resolved); 512-case bank; broken (AND-all) fails exactly the 2 pattern-adjacent cases |
| hw2-p13 | spiral (CC turbot, pass-through) | navigation | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| hw2-p14 | full circle (CC turbot, pass-through) | navigation | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| hw2-p15 | zig-zag (CC turbot, pass-through) | navigation | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |

### HW3 — Computing with SCs  ·  11/14

| id | problem | category | auth | build | grades | appr | status | notes |
|----|---------|----------|:----:|:-----:|:------:|:----:|:------:|-------|
| hw3-p1  | +1 B | arithmetic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw3-p1.json`; serial incrementer (t1-pulse timer + carry MEM); drain case 63→64 |
| hw3-p2  | +2 B | arithmetic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw3-p2.json`; serial full adder vs constant stream "2" (t2 pulse); broken = t1 pulse (+1) |
| hw3-p3  | 2x B | arithmetic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw3-p3.json`; canonical 1-step delay register; broken = pass-through |
| hw3-p4  | 2x+1 B | arithmetic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw3-p4.json`; delay + one-shot t1 OR (2x is even → no carry); broken = bare delay |
| hw3-p5  | 2(x+1) B | arithmetic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw3-p5.json`; serial +1 then delay; broken = delay-then-+1 order swap |
| hw3-p6  | x+y B | arithmetic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw3-p6.json`; serial full adder, 128-case bank; broken = carry-less XOR (57% fail) |
| hw3-p7  | +3 T (feasible) | arithmetic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw3-p7.json`; window-aware counter (canonical tally: ones block must END at final step); every case exercises drain |
| hw3-p8  | 2x T (feasible) | arithmetic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw3-p8.json`; window-aware (unbounded-stream version is FSM-infeasible — noted in LOG); 16-step runs |
| hw3-p9  | x+y T (feasible) | arithmetic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw3-p9.json`; counter/latch over 81-case bank; layout uses the p7 right-to-left MEM-chain convention |
| hw3-p11 | change detector (current ≠ previous) | perception | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw3-p11.json`; devData Q12 promoted at exact tier; per-lane XOR-vs-MEM + OR fold; broken (memoryless OR) fails 7/8; temporal semantics adversarially probed; bumpCheck CLEAN; its 48 router fallbacks = the structural XOR floor, deliberately pinned in routerCheck (see iteration-20 LOG) |
| hw3-p12 | motion detector (object image moving up) | perception | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw3-p12.json`; devData Q13 (motion k=3) promoted at exact tier; 146-comp PLA-matrix layout, ROTATED MEMs (sanctioned), 0 router fallbacks; broken fails 6/9; 17 bumpless crossings = P1.8 S3 class; 2 cosmetic appr findings logged (toggle-tab elbow — router obstacle gap; rotated-MEM label bisection) |
| hw3-p13 | zig-zag: reach & keep going | navigation | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | SC turbot, pass-through |
| hw3-p14 | three ahead: reach & stop | navigation | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | SC turbot, reach-and-stop |
| hw3-p15 | Mad Max: block ahead unknown dist, return & stop | navigation | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | return-to-start; **multi-arena + memory** |

_Note: HW3 #10 (x·y B) is an impossibility argument (not SC-computable) — excluded._

### HW4 — Computing with FSMs  ·  9/12 (arithmetic complete)

| id | problem | category | auth | build | grades | appr | status | notes |
|----|---------|----------|:----:|:-----:|:------:|:----:|:------:|-------|
| hw4-p3  | +1 T | arithmetic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw4-p3.json`; 10-state leading-zero counter (canonical tally: ones arrive last); broken fails 9/9 |
| hw4-p4  | +2 T | arithmetic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw4-p4.json`; 12-state counted +2; broken = counted +1 (window degeneracy note in LOG: p3's saturating machine also passes p4 — do not use as its broken) |
| hw4-p5  | +1 B | arithmetic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw4-p5.json`; 2-state carry FSM; broken = carry-dropper (62.5%) |
| hw4-p6  | +2 B | arithmetic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw4-p6.json`; 3-state shifted carry |
| hw4-p7  | +4 B | arithmetic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw4-p7.json`; 4-state (echo two bits + carry) |
| hw4-p8  | 2x B | arithmetic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw4-p8.json`; 2-state delay; appr ✅ after the P1.13 arc fix (arcs 166px apart, DOM-verified) |
| hw4-p9  | 2x+1 B | arithmetic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw4-p9.json`; 3-state; appr ✅ after P1.13 (202px separation) |
| hw4-p10 | 2(x+1) B | arithmetic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw4-p10.json`; 3-state delayed increment; appr ✅ after P1.13 |
| hw4-p11 | x+y B | arithmetic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw4-p11.json`; 2-state serial adder, k=2 labels `xy:o` via the P1.12 notation seam; 128/128 correct, broken 57%; hand-placed `fsmControlPt` dodges the P1.13 arc defect; k=2 label editor verified in-browser |
| hw4-p12 | zig-zag: reach & keep going | navigation | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | FSM turbot; **needs 2-bit motor F/S/R/L** |
| hw4-p13 | three ahead: reach & stop | navigation | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | FSM turbot; needs 2-bit motor |
| hw4-p14 | way finder: any non-branching maze | navigation | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | general solver; **multi-arena** |

_Note: HW4 #1–2 (state abstraction / multiple realizability) are analysis essays — excluded._

### HW5 — Computing with TMs  ·  9/9 ✅

| id | problem | category | auth | build | grades | appr | status | notes |
|----|---------|----------|:----:|:-----:|:------:|:----:|:------:|-------|
| hw5-p1  | x+1 T | arithmetic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw5-p1.json`; 3 states; bank x=1..8 (PDF domain — tally 0-blocks invisible); `requireStandardHaltPosition: true` (enforced since P2.3) |
| hw5-p2  | x+3 T | arithmetic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw5-p2.json`; triple-append, 5 states; reuse pedagogy is flat-inlined (no TM boxing mechanism exists) |
| hw5-p3  | 3x T | arithmetic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw5-p3.json`; 10 states; hand-authored bank x=1..8 |
| hw5-p4  | x+y T (arbitrary separation) | arithmetic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw5-p4.json`; **gap-robust** 6-state shift-until-adjacent machine; since P2.4 the bank itself varies gaps (16 cases each at 1/2/3/5 via `separations`) — a gap=1-only machine now fails 48/64 through the grader |
| hw5-p5  | 3(x+y) T | arithmetic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw5-p5.json`; 12 states, 64-case bank |
| hw5-p6  | x+3y T | arithmetic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw5-p6.json`; 11 states; broken = mirror 3x+y (87.5%) |
| hw5-p7  | x+1 B (extra leftmost 0) | arithmetic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw5-p7.json`; 4 states; platform encodes MINIMAL digits so the machine grows the block itself (PDF's padded-block assumption noted, statement adjusted); broken fails all-ones inputs (37.5%) |
| hw5-p8  | x−1 B (0 if x=0) | arithmetic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw5-p8.json`; bank hand-authored (max(0,x−1) inexpressible in the DSL); broken = inverted borrow (94%) |
| hw5-p9  | x+y B (clean up tape) | arithmetic | ✅ | ✅ | ✅ | ✅ | ✅ | `reference/hw5-p9.json`; 10 states, 128 cases; cleanup pedagogy has real codec teeth (extra `*` markers reject) — broken fails on exactly that |

_Note: HW5 #10–11 (multiplication strategy / multi-function machine) are prose/flowchart — excluded._

### HW6 — Navigation with Turbots (TM-brained)  ·  0/1

| id | problem | category | auth | build | grades | appr | status | notes |
|----|---------|----------|:----:|:-----:|:------:|:----:|:------:|-------|
| hw6-p2 | Desert Ant: find food (NE), pass over, return to start | navigation | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | TM-turbot; 30×30, ≤20 tape cells; unknown start+food; **multi-arena** |

_Note: HW6 #1 & #3 (flowchart / life-cycle prose) are excluded._

---

**Totals:** 46 / 56 exact-verified · 10 pending (interface tier) — the harness
JSON is authoritative.
