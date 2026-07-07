# Handoff — the hot state

_Read this first. It says exactly where we are and what to do next. Rewrite it at
the end of every iteration. If it conflicts with the harness, the harness wins —
run `npm run coverage` and reconcile._

## Where we are

Branch `buildout-infra` (pushed to `origin`). **46 / 56 exact-verified**, 10
pending (tier `interface` — 9 navigation + the HW6 capstone), 0 regressed, 0
warnings. Twenty-one iterations done. All arithmetic AND all perception
complete at exact tier. Merge `8dc2ff5` (iteration 21) brought main's
**backend-phase opening wave**: an Express+sqlite API server that grades
server-side with the SAME `engine/grader.ts` (test cases stripped from client
payloads; results withheld until release), instructor manual grading for open
questions (annotates, doesn't change the pending 0/0 contract), grade-release
gating (display policy in its own localStorage seam), deploy recipes, and
`server npm run check` (28 checks, green). `api/client.ts` maps 1:1 to future
Remote* stores and is imported by nothing yet.

## TREE CONTENTION — RESOLVED (S3 landed 2026-07-07)

The concurrent chip session's work LANDED on buildout-infra the same day
(commit "Router world model unified with the layout oracle" —
wireRouter.ts + routerCheck.ts + bumpCheck.ts + package.json + docs). The
tree is no longer contended; normal protocol resumes. Its commit was checked
against the S3 acceptance list (QUEUE P1.8, updated in place): EXPECTED_FALLBACKS
repinned to 2 total (better than the expected ≈3), bumpCheck clean on ALL
CC/SC fixtures AND wired into `npm run check` (no-arg manifest sweep), H4
near-merge/bump-drawability round done (with conflict-feedback re-routing).
LEFT UNDONE and still queued under P1.8: INPUT toggle-tab obstacles; the
hw3-p9 dot-skip nit re-evaluation. S4 (fallback phase-0 + lane-nudge +
`usedFallback`) is unowned again — the loop may take it.
- Durable memory saved: `project-shared-worktree-concurrency`.

## ⚠ SCOPE SHIFT (user directive 2026-07-06)

All 10 remaining rows are navigation/capstone at tier `interface`: a plausible
attempt that authors, builds, validates, and grades end-to-end; scores
reported, not asserted. Free correct machines excepted — the HW4 zig-zag FSM
is PRINTED in the problem set; take it.

## Do this next — P4.2: multi-arena navigation grading

Files are disjoint from the concurrent session's (engine/turbot.ts, grader.ts,
turbotCheck, types) but BUILD AND GATE IN AN ISOLATED WORKTREE anyway (tree
contention above), merging back only when the shared tree is quiet.

The task: navigation problems demand generality — Mad Max ("unknown
distance"), Way Finder ("any non-branching maze"), Desert Ant. The data model
already holds a LIST (`turbot_cases`); verify/complete the grader's
all-arenas-must-pass semantics and prove it has teeth.
**Acceptance:** a single-layout-only brain (hardcoded step count) PASSES a
1-arena family but FAILS a multi-arena family through `gradeTurbot`; grader
requires every arena; per-arena results readable in the gradebook drill-down
(already built for turbots — verify it renders multi-arena). Add turbotCheck
pins. Check first what already works — this may be mostly a verification +
pins task (the grader loops `turbot_cases` already; the authoring UI edits
only ONE arena — the multi-arena AUTHORING gap is P4.3's problem, fixtures
can hand-author the list).

## Then

P4.3 nav arenas + plausible brains (9 rows: hw2-p13..15 CC, hw3-p13..15 SC,
hw4-p12..14 FSM; zig-zag FSM printed in HW4 = free; 2-bit motor labels via
`turbotFsmNotation`, default `0:11`) → P4.4 turbot sandbox tab (optional) →
P5.1 Desert Ant capstone (interface proof) → smalls (P1.5, P1.6, P1.11, P1.15
SC-sim-leak unified reset — CHECK main for Gabriel's fix first, P1.16
rotated-MEM labels) → P6 close-out incl. P6.3 server↔engine parity pin and
P6.4 Remote-store cutover (Gabriel's timing). META-audit-queue due
~iteration 23.

## Watch out for

- **Fetch main + `git status` for foreign WIP at the START of every
  iteration** (memory: project-shared-worktree-concurrency). Main moves
  several times a day; the tree may be shared with live sessions.
- **Runaway fix agents:** hard bar + stop rule in every fix-agent prompt; the
  iteration-20 bounded-diagnosis agent is the template.
- **Interface tier, not answer-chasing** — free correct machines excepted.
- **routerCheck pins are mechanism-named** (XOR floor; 147 total). The
  concurrent S3 session will repin ≈3 — expect that diff, don't fight it.
- **Perception grades OUTSIDE the codec**; Stage-1 mirror in lockstep with
  gradeQuestion's dispatch (open → perception → turbot → codec).
- **Server exists now:** engine changes must keep `server npm run check`
  green too (it imports app engine sources cross-package); P6.3 will pin
  parity formally.
- **Rotated MEMs sanctioned**; P1.16 label bisection open. **turbotFsmNotation
  single grammar answer**; 1-bit = alias BY DESIGN (flagged for Gabriel).
- **notationCheck grep gate**, **scWindowCheck**, **tmCheck**,
  **perceptionCheck**, **serverCheck** green; `bumpCheck.ts` NOT a gate until
  S3 lands.
- **Ops:** 529 → `Workflow({scriptPath, resumeFromRunId})`; commit landed
  slices early; serial browser work = ONE agent; appearance recipe v3 (seeds
  from `app/public/`, clean keys twice, delete seed JSONs).
- `tsx` missing → `npm install`; no lockfile churn.
