---
id: 2026-09-26-072
type: chore
title: Win back CLAUDE.md headroom — tighten its wording by 3–4 KB, dropping no fact, path, seam, law or gate
priority: high
size: small
requires:
area: docs
source: chat
created: 2026-09-26T21:48:03-0700
status: ready
after:
branch:
merged_into:
---

## Description
`CLAUDE.md` is 39,988 bytes against the 40,000-byte budget in `tasks/tools/check-budgets.mjs`
(CI and app `npm run check`). Every landing updates its status in place (PROFILE §9, WORK §E),
so the next task that touches it fails the gate. Gabriel (chat, 2026-09-26): free roughly
3–4 KB by tightening wording, not by dropping facts.

## Done when
1. `CLAUDE.md` ≤ ~36,500 bytes and `node tasks/tools/check-budgets.mjs` passes.
2. Every file path, backticked identifier, seam, law (PROFILE §8) and gate it named before
   still appears; its section headings (cited by PROFILE and the role prompts) are unchanged.
3. Still an index, updated in place — nothing appended, no narrative added.
4. All gates green (PROFILE §6); pushed; `gh run list --limit 1` green.

## Design
- **Where the bytes are:** Part 1 "Where we are now" restates what Part 2's Key files and
  Critical design rules already say (student flow, autograding, instructor side, server);
  long parentheticals; task-number asides (`task 026`, `052–057`…) whose home is the task
  files; the Key files table's longest cells (Types, Store, Problem-set document, Page
  surfaces, Provenance, Student UI, Server, Tools).
- **deepFix:** tighten in place — Part 1 says what exists in one pass and leaves mechanism to
  Part 2; drop task-number asides (grep `tasks/done/` finds them); compress cells without
  losing a named symbol. A token diff (every backticked span and path, old vs new) proves
  nothing named was dropped.
- **surgicalFix (not taken):** raise the budget — defeats PROFILE §9's point.
- Structural follow-up, not this task: the budget will be hit again as the grading build
  (061–071) lands; the discipline is "replace, don't append", which this pass restores room for.

## Verify
`node tasks/tools/check-budgets.mjs`; the token-diff script (old vs new backticked spans and
paths) empty; all gates in PROFILE §6 by exit code. No visual surface.

## Progress log
