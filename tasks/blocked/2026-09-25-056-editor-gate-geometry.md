---
id: 2026-09-25-056
type: feature
title: Regularize the gate shapes — AND/OR 60×60, NOT 50×60, boxes sized to their ports, symbols drawn as strokes — and park for Gabriel's look before merging (editor redesign 5 of 6)
priority: normal
size: large
requires: browser
area: app
source: inbox
created: 2026-09-25T16:15:00-07:00
status: blocked
after: 2026-09-25-055
branch: task/056-editor-gate-geometry
merged_into:
---

## Description
Step 5 of the editor workbench redesign. The spec and the chain are in
`docs/buildout/designs/editor-workbench.md` and task 052. This step covers the memo's gate
geometry table and "Symbols are stroked paths".

It changes how saved circuits look:
- **Sizes.** Every stored AND, OR, NOT and placed box redraws at its new size, and the router
  re-lays the wires.
- **Connections.** They survive, because wires reference port ids (`types.ts:70-81`) and
  components store no size (`types.ts:50-65`).
- **Overlap.** Parts can now overlap. This hits every CC and SC canvas in every homework, the
  CC/SC turbot brains and the sandboxes, not only HW1.

> **This task never merges on its own.** Gabriel's instruction: build it on the branch,
> produce the before/after screenshot pass, then **park** it in `blocked/`, unmerged, for his
> yes. It lands only after he releases it. Pushing to `main` is shipping (PROFILE §2), so an
> early merge would put the new geometry in front of students within the hour.

## Done when
**On the branch, not merged:**
- **One size table.** All part sizes come from one explicit per-type table in
  `componentGeometry.ts`, with no default that silently covers several types:
  - **AND and OR** are 60×60, with inputs at (0,20) and (0,40) and the output at (60,30).
  - **OR's input stubs** are 5.3 long.
  - **NOT** is 50×60, with the input at (0,30) and the output at (50,30).
  - **A placed box (BOXED)** is 100 × (max(nIn,nOut,2)·20+20), with ports 20 apart and
    centred on each side.
  - **INPUT and OUTPUT** stay 40×40.
  - **XOR, HA, MEM and STATE keep today's sizes** (F8).
  - **`confirmBox`** uses the same table, not its own.
- **Symbols.** AND, OR and NOT draw ∧, ∨ and ¬ as the memo's 2px stroked paths, not text
  glyphs. XOR's ⊕ is untouched (machine-types session).
- **Router and layout gates.**
  - `routerCheck` keeps its fallback budget at 0; only its geometry pins (:104-125) change,
    to the new table.
  - `layoutCheck`, `bumpCheck` and `coverageCheck` are green.
  - The reference fixture `hw3-p12` is handled by the fix chosen under F9, never by
    loosening a gate.
- **Overlap census.** A census of every stored circuit the repo holds — every fixture, the
  dev sample data and the HW1–HW7 dev seeds — reports, per circuit, the parts that overlap
  under the new geometry but didn't under the old. It is written into the progress log.
- **Screenshot pass.** Before/after screenshots of the same circuits are committed as
  `tasks/attachments/2026-09-25-056-<n>.png`:
  - every HW1 CC reference fixture;
  - `hw3-p12`;
  - an HW1 circuit with placed boxes;
  - an SC circuit;
  - a turbot CC brain.

  They use fixtures and sample data only: never a student's work (F10).
- **All gates** in PROFILE §6 are green on the branch.
- **Then PARK, don't land:**
  1. Push the branch.
  2. On `main`, add `## Questions` ("Approve the new gate geometry as the screenshot pass
     shows it?", linking the attachments and the census), set `status: blocked`, and set
     `branch:` to the branch name.
  3. `git mv` the file to `blocked/`, commit, and push.

**After Gabriel's yes:** release, land through PROFILE §5, and confirm that CI is green.

## Design
**deepFix.**
- **One geometry table.** A single, explicit per-type geometry table (size + port rule +
  symbol anchor) in `componentGeometry.ts` is the one source of truth. The canvas, the router,
  the layout oracle, `confirmBox` and the harness pins all read from it.
- **Where it lands today:**
  - `COMP_WIDTH`/`COMP_HEIGHT` (`types.ts:886-887`) are the silent default for AND, OR, XOR
    and BOXED (`componentGeometry.ts:63`) and feed HA (:55).
  - `getComponentSize` is at `componentGeometry.ts:47-64`.
  - `store.ts:2685-2686` (`confirmBox`) keeps a second, stale size table (80×60, 70 for HA).
- **The overlap class:** saved layouts break when geometry changes. Handle it once,
  deterministically:
  - a pure load-time pass nudges a component (down or right, by grid steps) only where its
    new bounds overlap a neighbour that its old bounds cleared;
  - it is idempotent, pinned in `layoutCheck`, and applied wherever a stored circuit is
    shown (workbook, submission view, fixtures);
  - the nudged layout persists on the next ordinary save.
- **Scope it to the census** (PROFILE §1: verify the problem is general before generalising
  the fix). Most student work is snapped to the 20px grid (`snapToGrid`, `store.ts:1086`),
  and on the grid NOT growing from 50 to 60 tall turns a 60px stack from a 10px gap into
  touching, not overlapping. Placed boxes widen from 75 to 100 and can collide sideways. If
  the census finds new overlaps only in the off-grid fixture `hw3-p12` (its NOTs sit on a
  54–56px pitch: `pmo-121` y1122, `pmo-123` y1176, `pmo-186` y1232), the surgicalFix is
  proportionate. Record the census and the choice in the progress log. Either way the park
  puts the result in front of Gabriel.

**surgicalFix.** Update the table, fix the pins, and hand-move `hw3-p12`'s stacked NOTs in
the fixture.

**Code as it stands (read 2026-09-25).**
- **Ports:** `getPortPositionLocal` (`componentGeometry.ts:67-102`) spaces a side's ports
  `h/(n+1)`, which already gives 20/40 on a 60-tall gate. BOXED needs its own "20 apart,
  centred" rule: `h/(n+1)` is not 20 apart on the shorter side.
- **The OR/XOR inset** (:96-99) is `(XOR ? 6 : 0) + w*0.07`. Make OR 5.3 and leave XOR's
  inset as it is.
- **Rotation:** handled in `getPortPosition` :150-171. `getComponentBounds` is :191-221 (the
  INPUT tab at :41-44 / :198-199).
- **Gate bodies:** `renderGateBody` at `CircuitCanvas.tsx:389`. AND :504-529, OR :531-556,
  NOT :558-580: path or polygon plus a bold, stroked `<text>` glyph.
- **Manual wire segments:** `manualSegments` (`types.ts:78, :84-88`) are per-segment offsets
  re-applied to freshly routed paths (`CircuitCanvas.tsx:110-116, :3474`). After re-routing
  they can land on the wrong segment. Decide whether to drop the offsets whose path changed
  shape, and include a circuit with manual segments in the screenshot pass.
- **Harness coupling:**
  - `routerCheck.ts` hard-codes NOT 55×50 (:104), AND/OR/XOR 75×70 (:105-106), HA 75×80
    (:107), AND ports (:113-118) and the OR/XOR insets (:122-125). The budget is
    `MAX_TOTAL_FALLBACKS=0` (:220). The hw3-p4 pin replays historical positions (:350-400).
  - `coverageCheck`'s layout-oracle bar is a hard FAIL (:298-312), and its synthetic machines
    use absolute coordinates.
  - `layoutCheck` takes sizes from `getComponentSize` (:174-196).
  - Fixtures: `tools/fixtures/coverage-manifest.json` + `tools/fixtures/reference/*.json`.
- **Screenshots:** `tools/shootProblemSets.mjs` can't load a chosen circuit today (:64-107).
  Its output names are hard-coded to `2026-09-21-020-*`. Give it (or a sibling tool) a
  "load this circuit into the canvas" mode and a before/after naming scheme.

### Resolved decisions
Gabriel, 2026-09-25 (catch):
- **5. NOT is 50×60, as designed.** It matches the AND/OR height, and the overlaps it causes
  are judged at the screenshot pass.
- **8. Build, then park for his yes.** This task is worked like any other, but its last step
  is a park with the screenshot pass, never a land (Done when).

### Where the memo meets the laws (flagged at filing)
- **F8. `COMP_WIDTH`/`COMP_HEIGHT` are shared.** Changing them as the memo's "Where it lands"
  says would also resize XOR (to 60×60) and HA (to 60×70), which the memo leaves out of this
  pass. Use the explicit per-type table instead.
- **F9. This touches saved work beyond HW1.** AND, OR, NOT and BOXED are shared by every CC
  and SC canvas. A read-only simulation (2026-09-25) found `hw3-p12` gaining 19 box overlaps
  at NOT 60 tall, which trips `layoutCheck`, `coverageCheck`'s REGRESSED bar and
  `routerCheck`'s oracle-clean pin. No other fixture overlapped. Boxes were simulated at the
  old default, so the 100-wide rule is still unmeasured.
- **F10. Student data never enters git** (law 9). The memo asks for "a pass over real HW1
  workbooks". Real student circuits are student data, and `tasks/attachments/` is public.
  - Committed screenshots use fixtures and sample data only.
  - The real-workbook pass is owed by Gabriel (below) and reported as counts.

## Verify
- **Gates:** everything in PROFILE §6, in particular `routerCheck` (fallback budget 0),
  `layoutCheck`, `bumpCheck`, `coverageCheck`, `boxScopeCheck`, `caseRunCheck` and
  `pipelineCheck`. Grading reads no geometry, so the grading gates must be byte-identical in
  outcome.
- **Browser (requires: browser):**
  - Open HW1 P1–P5 and a boxed HW1 part as a student with seeded work, and check that every
    connection is intact.
  - Rotate each gate 4× and check the ports.
  - Check the symbols at 100% and 200% zoom.
- **Owed, not claimed: real workbooks.** A pass over real pilot workbooks is human-run and
  needs `requires: ssh`-level access.
  - **Recipe:** copy the latest DB backup (`deploy/README.md` §Backups) to a private folder
    outside the repo.
  - Run the census tool against it, and report counts only: circuits, circuits with new
    overlaps, and broken connections, which must be 0.
  - Screenshots of it stay private.

## Questions
1. **Approve the new gate geometry as the screenshot pass shows it?** The pairs are in
   `tasks/attachments/2026-09-25-056-NN-<circuit>-before.jpg` / `-after.jpg` (fixtures and
   sample data only; each is the same circuit on the old and the new code, framed whole):
   - 01–07 every HW1 CC reference fixture (p1–p5, p16, p17);
   - 08 HW1 P3 boxed whole, 09 HW1 P4 boxed across (the builder's own placement, cramped
     in both shots), 10 HW2 P6's placed boxes;
   - 11 HW3 P1 and 12 HW3 P12 (sequential; P12's NOT columns re-spaced, below);
   - 13 HW2 P13, a turbot's CC brain;
   - 14 the three gates rotated 0/90/180/270° at 200% (after only).

   **Yes** → I release it: land the branch `task/056-editor-gate-geometry` through
   PROFILE §5 and confirm CI (the robot then ships it within the hour). **No / change X** →
   say what, and it stays parked on the branch.
2. **Real student work (owed, yours — needs the DB copy).** The repo census can't see it.
   On the 20px grid the NOT change only makes 60px stacks touch, and AND/OR shrink, but a
   placed box widens 75 → 100 (and grows with its ports), so tightly packed boxes in real
   HW1 work (a box per part) could newly overlap. Before releasing, would you run the census
   against a private DB copy (recipe under ## Verify) and report counts? If it finds box
   overlaps, do you want the load-time nudge pass (## Design deepFix) before release, or
   release and let students drag apart?

## Progress log

### 2026-09-26 — built on the branch, gates green, PARKED for Gabriel's look (/work)
- **Branch:** `task/056-editor-gate-geometry` (pushed; code `2a25fae`). Not merged: it
  lands only on Gabriel's yes (## Questions).
- **One size table** (`app/src/componentGeometry.ts` `PART_SIZE`, a `Record` over the
  types, so none falls to a default): AND/OR 60×60, NOT 50×60, ports on the 10px
  half-grid (in 20/40, out 30); XOR 75×70, HA 75×80, MEM 50×50 and STATE 60×60 unchanged
  (F8). A placed box is `boxSize(nIn, nOut)` = 100 × (max(nIn, nOut, 2)·20 + 20), with ports
  20 apart and centred. An OR's ports sit on its box edge with 5.3 stubs to the curve, per
  the memo's table (the filing's "OR inset 5.3" read as this); XOR keeps its inset.
  `COMP_WIDTH/COMP_HEIGHT` retire. `confirmBox` reads the table (its stale 80×60 one is
  gone).
- **Symbols** ∧ ∨ ¬ are the memo's 2px stroked paths. They stay upright under rotation
  (counter-rotated about their own centre, so a rotated NOT's ¬ stays inside it — the old
  glyph drifted); XOR's ⊕ untouched.
- **Census** (`app/tools/geometryCensus.ts`, the legacy sizes frozen inside; run
  `npx tsx tools/geometryCensus.ts --verbose`): **128 stored circuits** (every fixture's
  correct + broken machine, the sample data). **Only hw3-p12 gains overlaps: 19 new pairs**
  (12 in `correct`, 7 in `broken`), all NOT × NOT at x=480 on the off-grid 54–56px pitch;
  0 anywhere else, 0 from the 100-wide boxes (hw2-p6's included). Per ## Design this makes
  the surgicalFix proportionate: the NOT runs in hw3-p12 are re-spaced to a 60px pitch
  (19 y-values; nothing else moved). After it the census reads 0. The unmeasured risk is
  real work with packed boxes — ## Questions 2.
- **Router:** re-laid on the new geometry, hw2-p11 (4) and hw3-p9 (1) gained
  bump-undrawable crossings. Cause: a wire hugging a column of target gates runs on the
  column's margin line, `ELEMENT_MARGIN` (5) = `CROSSING_BUMP_RADIUS` (5) from the ports,
  so every approach it crosses is in the dead band. The H4 rip-up-and-reroute (built for
  this) converges but needed 4 rounds (3 is mid-swap: hw2-p11 got 7). The cap rises from 2
  to 4 (`VALIDATION_ROUNDS`); a clean round exits early. A wider margin (6, 7) was tried
  first and broke 12–15 fallbacks, so it stays. The budget stays 0; every fixture is
  oracle-clean and bump-clean. Cost on the heaviest fixtures: hw2-p11 3.1 → 4.4s,
  others ~flat.
- **Manual segments:** an offset now records where its segment was routed (`base`) and
  is dropped once the route moves (`app/src/wireSegments.ts`, pure). Offsets saved before
  apply only to a draggable middle run, never a stub, so a re-laid wire is never pulled
  off its port. No fixture carries manual segments, so none are in the pass; the rule is
  pinned in routerCheck instead.
- **Pins:** routerCheck — the new table and box ports, "one size table" (`confirmBox`,
  a `Record` with no default), manual segments. layoutCheck, bumpCheck and coverageCheck
  are green and unchanged; grading gates (pipeline, caseRun, parity) are unchanged in
  outcome.
- **Gates (branch):** app tsc, tools typecheck, build, `npm run check` (exit 0), server
  `npm run check` (exit 0).
- **Tools:** `app/tools/shootCircuits.mjs` (fixture circuits on the real canvas, visitor
  sandbox, before/after naming; waits for the dev server) made the pass.
- **Owed:** Questions 2 (real workbooks, counts only); a browser eyeball of seeded HW1 work
  after release.
