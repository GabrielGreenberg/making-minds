---
id: 2026-09-27-074
type: feature
title: Box a Turing machine as the textbook does — a named sub-machine between an entry and an exit state
priority: normal
size: large
requires: browser
area: app
source: feedback
created: 2026-09-27T17:30:00-07:00
status: blocked
after:
branch:
merged_into:
---

## Description
App Feedback report `fb-mukhzb5w-nrtnam` (author-role: instructor, category: platform
design): the machine builder should support boxes for FSMs and Turing machines, following
the textbook's syntactic constraints.

Today both are refused outright: `placeableBoxKinds` (`app/src/types.ts:424`) returns no
kinds for FSM or TM, `confirmBox` refuses FSM (`app/src/store.ts:3097`), the palette's Boxes
tile and the canvas "▣ Box" action hide themselves (`palette.ts:62`,
`components/CanvasActions.tsx:20`), and `boxScopeCheck.ts:380-384` pins the refusal. The
long comment at `types.ts:371-423` calls the refusal "by design": a state machine has no wire
boundary, so a box would need an invented call/return convention.

**What the textbook actually says** (`mm_textbook.pdf`, repo root; printed page = PDF page):
- **TMs — defined** (ch. 23 "Turing Machine Abstraction and Composition", pp. 132–136).
  You box a machine by drawing a frame that touches only its initial state S_A and its
  halting state S_B, then drop the interior: what's left is `S_A —[f]— S_B`, the box
  labelled with the function it computes (e.g. "+1 Tally"). Boxes chain by sharing a
  boundary state (`S_A —f— S_B —f— S_C` = +2 Tally, p. 134) and mix freely with ordinary
  states and arrows. **Constraints on boxing (p. 133):** M computes a function; S_A is its
  initial state; S_B is its only terminal state — it halts in standard position, in S_B,
  in no other state, and S_B has no arrows back into M. **Use:** a placed box's S_A has no
  arrows to states outside the box. Standard position = tally: the rightmost cell of the
  rightmost block; binary: the rightmost `*` of the rightmost block (p. 135). No multiple
  exits, parameters or recursion; nesting is not discussed.
- **FSMs — not defined, and ruled out.** The FSM chapter (pp. 99–101) never boxes, and
  HW4 Part II carries a margin note that composition does not work for FSMs (two +1
  machines do not chain into +2, because an FSM diagram shows the states of the whole
  machine, not a flow of information). That is the product fork in `## Questions`.
- **Homework use:** HW5's rules allow boxed earlier solutions that meet the criteria and
  its problems reuse them (P2 uses P1, P3 uses P2, P4 uses P1, P5–6 use P3–4, P9 uses
  P7–8); HW6 P2 (the desert-ant turbot) asks for modular boxed functions.

## Questions
1. **FSM boxes: leave them out?** Recommendation: **yes, TMs only.** Your own HW4 note
   tells students FSM composition doesn't work, and the textbook defines no FSM box; an
   FSM box would teach against the course. If you do want them, say what a boxed FSM
   means (which symbols it consumes, what it outputs meanwhile) and it becomes its own task.
2. **Turbot TM brains (HW6 P2) too, or plain TMs first?** Recommendation: **plain TMs
   first, turbot TMs as a follow-up task.** A turbot TM's external (square) states move the
   robot and have no "standard position" exit, so the p. 133 constraints need a turbot
   reading you'd have to give.
3. **Are the p. 133 constraints enforced (refuse to box) or warned about?**
   Recommendation: **enforce the structural ones at "Box" time** — exactly one entry state
   (the only selected state reached from outside, and the one the box starts in), exactly
   one terminal state (no arrow leaving it inside the selection), no arrow from the
   terminal back in — with a plain refusal message naming the rule, as CC/SC `confirmBox`
   already refuses loops. **Warn, don't block** on the behavioural ones the editor can't
   decide statically (halts in standard position; S_A arrows leaving the box once
   placed), per the project's "warn, don't block" rule; the grader's own
   `requireStandardHaltPosition` check covers the halt position where a question asks.

## Design
- **Why the refusal comment is wrong for TMs.** It assumes a box must be a *call* (a
  stack, a return). The textbook's box is not a call: it is an **abbreviation**. S_A and
  S_B stay ordinary states of the outer machine, and the box stands for the interior
  states and arrows between them — so it can be *expanded* before running, exactly as
  `engine/netlist.ts` `inlineSequentialBoxes` (`:311`) already expands SC boxes holding
  memory into the one netlist the SC step runs. One tape, one control thread, no stack.
- **deepFix — box = macro, expanded at the engine seam.**
  1. *Model:* a TM box definition in the existing `ConfirmedBoxDef` library (new
     `kind: 'TM'`, `types.ts:893-901`) holding the frozen interior (states + labelled
     arrows) with its entry and terminal marked. A placed instance is a new canvas element
     drawn between two outer states, `S_A —[f]— S_B` (the p. 132 picture), carrying its own
     deep-copied interior as a CC `BOXED` component carries `internalCircuit` — so a
     submitted JSON grades headlessly (the gap the earlier FSM attempt, git a05e3d6, never
     closed).
  2. *Engine (pure, law 2):* `engine/tmBoxes.ts` `inlineTmBoxes(components, wires)` →
     a flat table: interior state ids path-prefixed (never split, as netlist does), the
     interior's entry identified with the outer S_A and its terminal with S_B, nested boxes
     expanded recursively. `evaluateTMSequence` (`engine/tm.ts:152`), `evaluateTMSingleStep`,
     `tmValidate.ts`, the codec's `tape` axis, `caseRun.ts` and the grader all run the
     expanded table — one expansion, every consumer, so live runs ≡ grading by
     construction. History rows name an interior state `+1 Tally·S1`.
  3. *Store/UI:* `placeableBoxKinds('TM')` → `['TM']`; `confirmBox` gets a TM branch
     (the Question 3 checks); `placeBoxInstance`, `renameBox`, the Boxes pop-out, the box
     editor, undo and the reset laws follow the CC/SC paths. Library scope unchanged (per
     homework in an assignment, per tab in the sandbox) — HW5's "reuse P1 in P2" works
     because the library is homework-wide.
  4. *Rewrite the `types.ts:371-423` comment* to say why TMs box as macros and (per Q1)
     why FSMs don't.
- **surgicalFix:** let the student select states and "collapse" them visually only
  (a drawing group, no library, nothing reused). Cheap, but it isn't the textbook's box —
  no reuse across problems, which is HW5's whole point. Not recommended.
- **Watch:** `component_limits`/`allowed_components` recurse through boxes
  (`machineValidation.ts:85-96,145-165`) — keep counting a TM box as one `BOXED`; the
  provenance/paste seam (`provenance.ts:187`) recurses the same way and must mint interior
  ids through `mintId`; the start state is `sortStateComponents(...)[0]` (`tm.ts:163`), so
  expanded interior ids must never sort ahead of the outer start; `maxTapeCells` and step
  budgets count expanded steps (the textbook's machine *is* the expanded one).

## Done when
- In a TM canvas (sandbox and assignment), selecting a sub-machine that meets the
  p. 133 structure and pressing Box adds it to the box library; a selection that breaks a
  structural rule is refused with a message naming the rule.
- A placed TM box draws as `S_A —[name]— S_B` between two states, can be chained
  (+1 Tally twice = +2 Tally) and mixed with ordinary arrows; rename, delete, undo, save,
  reload and the box editor behave as for CC/SC boxes.
- Run/Step, the history panel, grading (`caseRun`/grader) and the server's grading give the
  same result for a boxed machine and its hand-expanded twin.
- Per the answers: FSM (and turbot TM) boxing stays refused, with the `types.ts` comment
  rewritten to say why.

## Verify
- Gates: PROFILE §6, all of them.
- `boxScopeCheck`: flip the TM placeable-kinds pin; add `[tm boxes]` — the p. 133 correct
  example boxes, the two wrong ones (second halting branch; extra states/arrows) refuse;
  boxed ≡ hand-expanded on +2 Tally and a binary chain; nested box; rename sweep.
- `tmCheck` / `caseRunCheck` / `pipelineCheck`: an expanded run equals the flat twin,
  step for step and verdict for verdict; `server/tools/parityCheck.ts` stays green.
- Owed, not claimed: a browser eyeball of the `S_A —[f]— S_B` drawing, the Boxes pop-out
  in TM mode, and HW5 P2 built from a boxed P1 (Robot Dev Server, a TM question).

## Progress log
