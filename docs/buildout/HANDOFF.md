# Handoff — the hot state

_Read this first. It says exactly where we are and what to do next. Rewrite it at
the end of every iteration. If it conflicts with the harness, the harness wins —
run `npm run coverage` and reconcile._

## Where we are

Branch `buildout-infra`. **46 / 56 exact-verified**, 10 pending (tier
`interface` — 9 navigation + the HW6 capstone), 0 regressed, 0 warnings.
Twenty-two iterations done. All arithmetic AND all perception complete at
exact tier. **P4.2 landed (iteration 22, merge `d34d037`):** turbot arena
families genuinely discriminate — `evaluateTurbotCriterion`'s return-to-start
gained a goal-visit clause (a stop-immediately or fixed out-and-back brain no
longer vacuously passes; spec §12.5), all-or-nothing aggregation verified,
turbotCheck gained a 12-check [multi-arena] section, gradebook drill-down
verified N-arena. Concurrently landed by other sessions the same morning:
**P1.8 S3** (`d0214ec` — own-endpoint exemption, fallbacks 147→2, bumpCheck
all-clean + wired into `npm run check`, H4 conflict-feedback re-routing) and
**P1.15** (`e95f74f` — `resetAllSimState()` + navResetCheck 42 checks). Merge `8dc2ff5` (iteration 21) brought main's
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

## Do this next — P4.3: navigation arenas + plausible brains (9 rows)

The last fixture batch. hw2-p13..15 (CC turbots: spiral / full circle /
zig-zag, pass-through), hw3-p13..15 (SC turbots: zig-zag / three-ahead /
Mad Max), hw4-p12..14 (FSM turbots: zig-zag / three-ahead / Way Finder).
Tier `interface`: arenas from the HW diagrams + a PLAUSIBLE brain per row
that validates Stage-1, steps in the arena, and grades end-to-end — score
reported, not asserted. Free correct machines only (the HW4 zig-zag FSM is
PRINTED in the problem set — take it; the 3-state Mad Max FSM from
turbotCheck's [multi-arena] exhibit is also free for hw3-p15).
Per P4.2: express generality as multi-arena `turbot_cases` families
(hand-authored in fixtures — the creator UI still authors one arena, that's
fine); on return-to-start arenas mark the sensing spot as the GOAL cell
(manifest hw3-p15 note). 2-bit motor labels via `turbotFsmNotation` (default
`0:11`); CC/SC brains are circuits behind the 1-bit sensor / 2-bit motor
interface. Batch it as a workflow (build per row → verify per row →
appearance), like P1.2/P2.2. Interface rows show as ◐ in the harness — the
first non-exact greens; make sure the manifest tier stays `interface` unless
a brain is genuinely correct for its whole family.

## Then

P5.1 Desert Ant capstone (interface proof) → P4.4 turbot sandbox tab
(optional) → smalls (P1.5 allowed_components, P1.6 cc.ts label-order, P1.11
ARG multi-group, P1.16 rotated-MEM labels, P1.8 leftovers: INPUT toggle-tab
obstacles + hw3-p9 dot-skip nit; S4 fallback-phase-0 is unowned — optional
now that fallbacks are 2) → P6 close-out incl. P6.3 server↔engine parity pin
and P6.4 Remote-store cutover (Gabriel's timing). **META-audit-queue is DUE
(iteration 23)** — run it next iteration or the one after P4.3.

## Watch out for

- **Fetch main + `git status` for foreign WIP at the START of every
  iteration** (memory: project-shared-worktree-concurrency). Main moves
  several times a day; the tree may be shared with live sessions.
- **Runaway fix agents:** hard bar + stop rule in every fix-agent prompt; the
  iteration-20 bounded-diagnosis agent is the template.
- **Interface tier, not answer-chasing** — free correct machines excepted.
- **routerCheck pins:** fallback budget is 2 (post-S3; hw3-p9's w21
  deliberately pinned; `getFallbackWireIds()` names offenders). New fixtures
  must route fallback-free or be pinned deliberately.
- **Perception grades OUTSIDE the codec**; Stage-1 mirror in lockstep with
  gradeQuestion's dispatch (open → perception → turbot → codec).
- **Server exists now:** engine changes must keep `server npm run check`
  green too (it imports app engine sources cross-package); P6.3 will pin
  parity formally.
- **Rotated MEMs sanctioned**; P1.16 label bisection open. **turbotFsmNotation
  single grammar answer**; 1-bit = alias BY DESIGN (flagged for Gabriel).
- **notationCheck grep gate**, **scWindowCheck**, **tmCheck**,
  **perceptionCheck**, **serverCheck**, **navResetCheck**, **bumpCheck** (now
  IN `npm run check` — all CC/SC fixtures pinned bump-clean) green.
- **Ops:** 529 → `Workflow({scriptPath, resumeFromRunId})`; commit landed
  slices early; serial browser work = ONE agent; appearance recipe v3 (seeds
  from `app/public/`, clean keys twice, delete seed JSONs).
- `tsx` missing → `npm install`; no lockfile churn. `server/` has its OWN
  deps — `npm install` there too before server gates (bit iteration 22).
