---
id: 2026-09-21-010
type: feature
title: Author an arena family (several turbot_cases) in the question creator
priority: normal
size: large
requires:
area: app
source: claude-md
created: 2026-09-21T15:30:00-07:00
status: in-progress
after:
branch: task/010-turbot-multi-arena-authoring
merged_into:
---

## Description
`turbot_cases` is already a LIST and grading requires every arena to pass (Mad Max-style
families have teeth since P4.2), but `QuestionCreator` authors exactly one arena; the
reference fixtures with families were built in code.

## Done when
- The creator shows the arena list (add / duplicate / remove / reorder), edits each with the
  existing arena editor (`instructor/arenaEditing.ts`, ≤ 30×30), each with its own
  criterion + max-steps; round-trips through save/load; the gradebook already lists per-arena.

## Design
Lift the single-arena state in `QuestionCreator.tsx` into an array with an active index;
the editor component is unchanged. **surgicalFix** is the same shape.

## Verify
tsc; `pipelineCheck` authoring path with a 2-arena question; browser eyeball owed.

## Progress log

### 2026-09-23 — implemented (work loop)
**Built.** The question creator now authors a turbot's whole arena family instead of one
arena. A list of arena rows (size · criterion · steps) with Add / Duplicate / ↑ ↓ / Remove
sits above the unchanged ≤ 30×30 grid editor, which edits the ONE active arena together with
its own criterion and step budget (only the active grid renders, in a scroll box, so HW6's
three 30×30 arenas stay light). The last arena cannot be removed. A goal-less arena under
reach-and-stop / pass-through is named ("Arena #k …") and blocks Save, since no brain could
pass it. Reordering, removing or inserting before a saved arena warns (in the list, and a
confirm at save) that already-graded runs will be listed/replayed against a different arena —
the same guard as task 005's blanks. Pure logic: `app/src/instructor/turbotCaseAuthoring.ts`
(drafts ↔ `turbot_cases`, add/duplicate/remove, defects, `misplacedArenas`); widget:
`TurbotArenasEditor.tsx`; `engine/turbot.ts` gains `arenaHasGoal` + `criterionNeedsGoal`.
No server, schema or deploy change (remote stores the JSON as-is).
**Pins.** `pipelineCheck [turbot arena authoring]`: drafts → `turbot_cases` round-trips every
sample + HW turbot question; add/duplicate (copy owns its cells)/remove/reorder/active-key;
the misplaced-arena guard (9 checks on HW3 P14) + a grep pin that the creator wires it;
goal-less defects; a 2-arena question authored → student copy unchanged → graded 2/2, 1/2
with arena 2 moved, 0/2 for an idle brain, results follow arena order; a grep pin that the
creator touches `turbot_cases` only through the drafts. `turbotCheck [goal-less arenas]`.
**Gates** (exit codes): app tsc 0, app build 0, app check 0, server typecheck 0, server
check 0 (tsc + pipelineCheck + turbotCheck + budgets re-run 0 at checkpoint).
**Review.** Fixed: [minor] missing misplaced-arena guard (TurbotArenasEditor). Skipped: none.
Nits left: `turbotCheck` `[goal-less arenas]` run literal omits `tapeCellsUsed` (tools/ is
outside tsconfig.app.json, so CI never sees it); CLAUDE.md's Instructor UI row names
`turbotCaseAuthoring.ts` but not `TurbotArenasEditor.tsx`.
**Owed (browser, local mode — "dev", port 5173).** HW3 P14 in the creator: 3 rows (6×6, 7×5,
4×6; reach-and-stop; 20 steps), switching shows each grid; Duplicate/paint/Move/Remove leave
other arenas intact; goal-less pass-through warns "Arena #2 …" and disables Save; Add + Save
+ reopen persists rows/order/criteria/steps and the preview reads "Graded on 4 arenas";
HW6 P2's 30×30 arenas scroll in their box; a new turbot question starts with one arena, Remove
disabled; ~375px wraps with no page scroll; student smoke — after moving an arena to #1, the
student Map and problem page show it. Nothing owed to Gabriel.
**Next step.** Loop session: the owed browser check above, then land per PROFILE §5.
