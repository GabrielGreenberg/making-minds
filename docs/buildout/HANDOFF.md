# Handoff — the hot state

_Read this first. It says exactly where we are and what to do next. Rewrite it at
the end of every iteration. If it conflicts with the harness, the harness wins —
run `npm run coverage` and reconcile._

## Where we are

Branch `buildout-infra`. **32 / 56 verified**, 24 pending, 0 regressed, 0
warnings. Twelve iterations done. Arithmetic verticals HW1–HW4 complete. P2.1
landed: TM transitions are now the two-output form (`read:write,move`, stored
`1:0,R`; legacy `1:0R` aliases forever, decays on edit-save). Remaining walk:
**P2.2 → P1.8 → P3.1 → P3.2/P3.3 → P4.2 → P4.3 → P5.1 → smalls → P6**.

## Do this next — P2.2: HW5 TM arithmetic fixtures (hw5-p1…p9)

Nine TM fixtures — tally: p1 `x+1`, p2 `x+3` (reuse x+1), p3 `3x` (reuse x+3),
p4 `x+y` (arbitrary block separation), p5 `3(x+y)`, p6 `x+3y`; binary: p7 `x+1`
(extra leftmost 0), p8 `x-1` (0 if x=0), p9 `x+y` (reuse; clean up tape).
Standard batch workflow (spec → parallel build+prove → wire → adversarial
verify + gates + appearance → critic). TM-specific prep:

- **Spec agent must nail the TM codec conventions** from
  `engine/tmCodec.ts` + `engine/tm.ts` + the devData TM sample: how a value
  lays onto the tape (position, direction, blanks), how accept/decode reads the
  final tape, halting semantics (missing transition = halt), the
  `requireStandardHaltPosition` acceptance toggle on AssignmentQuestion
  (exposed? grader-honored? — QUEUE says expose/verify where problems demand
  standard-position halting), and how TWO tape arguments encode for x+y
  (block separation — p4 says ARBITRARY separation, so the bank/codec must
  vary it or the spec agent must report how the codec lays two values).
- **Labels in the NEW two-output notation** (`1:0,R`) — builders author via
  `tmNotation(rep)`; tape alphabet representation-tied (`*` binary only).
- **Reuse questions** (p2 from p1, p3 from p2, p9 from p7/p8): grading is
  functional — boxing/reuse is pedagogy, not a grading requirement (note in
  issues if skipped, per the hw2-p6 precedent). BUT check whether TM boxing
  even exists as a mechanism before promising it.
- **hw5.pdf** for exact statements (clean prose — the lint bites); pin full
  row ids `hw5-pN`.
- **Broken variants** must fail broadly (sampled banks; breadth bar warns
  <25%).
- **Appearance:** TM canvas = FSM-style state editor + tape strip below
  (`TMTapePanel`); machine table READ|WRITE|MOVE|NEXT columns; VISUAL_VOCAB
  §TM (two-output form just recorded). FSM arc auto-offsets apply to TM state
  diagrams too (same renderer) — no hand-placed control points unless a sweep
  fails.

**Acceptance:** `npm run coverage` → 41/56, 0 regressed, no unexplained
warnings; hw5-p1..p9 fully ✅ incl. appearance; gates green.

## Then

P1.8 (wire-router design memo — gates Phase 3) → P3.1 (target-functions memo)
→ perception fixtures → P4.2/P4.3 navigation → P5.1 capstone → smalls → P6.

## Watch out for

- **`requireStandardHaltPosition`** is a deferred authoring follow-up
  (CLAUDE.md) — if HW5 problems need it, exposing it may become part of P2.2
  (small QuestionCreator + grader surface; check what exists first).
- **notationCheck grep gate**: TM label handling must stay in the seam.
- **tmCheck + notationCheck pin the new grammar** — fixture labels must be
  canonical (`1:0,R`).
- **Ops:** 529 → resume workflow; session limit → finish solo.
- **Appearance recipe v3**; seeds from `app/public/` at `/making-minds/`.
- `tsx` missing → `npm install`; no lockfile churn.
