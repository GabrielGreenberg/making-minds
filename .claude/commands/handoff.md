---
description: Run one build-out loop iteration — orient from the buildout memos, do the next queue task end-to-end, update the memos, commit, and schedule the next wake.
---

ultracode

You are one iteration of the **Making-Minds build-out loop**. All durable state
lives in `docs/buildout/`, `app/tools/fixtures/coverage-manifest.json`, and
`app/tools/fixtures/reference/*.json`. Treat this session as disposable: rely on
the memos and the harness, not on remembered context. Work through the phases below
in order. Do exactly **one** task this iteration (or one meta-task), then hand off.

Run git/npm from the repo; `app/` is the working dir for npm. Work on a
`buildout-*` branch (do not commit to `main`).

## A · Orient
1. Read `docs/buildout/HANDOFF.md`, then `QUEUE.md`, `COVERAGE.md`, `NORTH_STAR.md`,
   and the repo `CLAUDE.md`. Skim `VISUAL_VOCAB.md` if this task touches appearance.
2. Ground truth: from `app/`, run `npm run coverage` and
   `npx tsc -p tsconfig.app.json --noEmit`. If `tsx`/deps are missing, `npm install`
   (it reconciles to the committed lockfile — don't commit lockfile churn).
3. Reconcile: if the harness JSON disagrees with COVERAGE.md, fix COVERAGE to match
   the harness (the harness wins). If it disagrees with HANDOFF, note it.

## B · Select
Take the top unblocked `todo` in QUEUE.md (honor deps; finish one mode/category
vertical before broadening: CC→SC→FSM→TM→turbot, arithmetic→perception→navigation).
If a meta-task is due (e.g. META-audit-queue every ~5 iterations), do that instead.
State which task you picked and its acceptance criterion.

## C · Build / fix
Implement the vertical slice the task needs (engine / store / UI / instructor
authoring / a reference fixture). Reference solutions are best produced by building
in the running app (`preview_start`, port 5173) and exporting `CircuitData`, then
pairing with an authored `question` and a **broken** variant — see
`app/tools/fixtures/reference/README.md`.

## D · Adversarially verify  (use a Workflow for multi-problem sections)
- `npm run coverage` — the task's COVERAGE rows must go `verified` (correct passes
  every case, broken fails). Never mark a row green on assertion alone.
- Appearance: load the machine in the app and check it against `VISUAL_VOCAB.md`
  with `preview_inspect` / `preview_snapshot` / `preview_screenshot`.
- Regression gates: `npm run check` (codec/tm/turbot/pipeline/coverage) and
  `npx tsc -p tsconfig.app.json --noEmit` and `npm run build` stay green.
- For a section of problems, run a Workflow: fan out (build reference → verify
  grader pass/fail → appearance) and add a completeness-critic agent asking *which
  COVERAGE rows are still red and why*.

## E · Update the memos  (a task isn't done until its docs are)
- `COVERAGE.md` — flip the advanced rows' columns/status to match the harness.
- `QUEUE.md` — close the task; enqueue any newly discovered work.
- `LOG.md` — append a dated block: shipped / surprises / next.
- `HANDOFF.md` — rewrite the hot state to point at the next task.
- `CLAUDE.md` — update its status if what's built changed (its own maintenance rule).

## F · Commit + confirm
Commit on the `buildout-*` branch with a clear message. If pushing, confirm the
build with `gh run list --limit 1` and fix red before handing off. End commit
messages with the Co-Authored-By trailer.

## G · Schedule the next iteration
If any COVERAGE row is still pending, call `ScheduleWakeup` (self-paced) re-firing
this same `/handoff` prompt, with a one-line reason naming the next task. If every
row is ✅ and all checks pass, do **not** reschedule — report the project done.

Keep scope tight: one task, verified, documented, committed. Then stop.
