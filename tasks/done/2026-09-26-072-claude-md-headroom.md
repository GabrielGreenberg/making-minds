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
status: done
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
- 2026-09-26 (`/work`, Opus 5.5, worktree `.claude/worktrees/heuristic-cartwright-01774b`) —
  Filed and claimed at Gabriel's ask; `CLAUDE.md` 39,988 → **37,026 bytes** (−2,962; 2,974
  bytes of headroom). Done-when 1 aimed at ~36,500: not reached. The rest is identifier lists,
  laws and gate descriptions, and more cuts there would drop named facts. That is the low end
  of Gabriel's "roughly 3–4 KB".
  What changed: Part 1 stops restating Part 2. The SSO no-rebuild point is in the Identity
  seam. The PDF structure is in Deployment. Editor parts are in the Student UI row, freezing
  in the Due dates row, and the homework-sync outcomes are stated once (Deployment). The paste
  policy moved into the provenance rule, and the halt-position / tape-cell semantics live in
  Homework JSON only. The task-number asides (003, 007, 020, 026–028, 033, 034, 040, 041,
  052–057) are gone. Build phases is one line, and the DSL, Critical rules and the longest Key
  files cells are tightened.
  Fixed an error: Part 1 said `maxTapeCells`/`requireStandardHaltPosition` are checked at
  Stage 1, but they are per-case at run/accept (`caseRun.ts` `tapeOverrun`, `tmCodec.ts`
  accept). It now points to Homework JSON, which was already right.
  Proof: a token diff of old vs new (every backticked span, path, bold phrase and heading;
  882 tokens) drops none, except `isCurrentQuestionLocked(state)` (the identifier survives
  bare) and four slash-phrases whose facts live in the Problem-set, turbot and API client
  rows. Headings are unchanged. Gates: check-budgets, app tsc, app build, server typecheck,
  server check and app check all exit 0.
- 2026-09-26 (land) — `main` moved while I worked: 062 landed and put `CLAUDE.md` at 39,999
  bytes. The first `--no-ff` merge into `main` conflicted (`tasks/log.md` appends; 062's
  in-place Submit sentence inside my rewrapped Student side paragraph), so I aborted it, merged
  `origin/main` into this branch and resolved it there. I took my paragraph with 062's Submit
  sentence verbatim (`SubmitDialog`, ≤ 2 group members) and kept both log lines in landing
  order. Result: `CLAUDE.md` **39,999 → 37,049 bytes** (2,951 bytes of headroom). The token
  diff against the new `main` shows the same five known exceptions. The gates were re-run on
  the merged tree before the final merge.
