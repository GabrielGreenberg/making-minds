# Handoff — the hot state

_Read this first. It says exactly where we are and what to do next. Rewrite it at
the end of every iteration. If it conflicts with the harness, the harness wins —
run `npm run coverage` and reconcile._

## Where we are

Phase 0 (stand up the system) is **done** on branch `buildout-infra`. The memo
system, coverage harness, manifest, and `/handoff` command all exist and pass.
COVERAGE: **0 / 56 verified**, 56 pending. No course machines built yet — that's
the loop's job, starting now.

## Do this next — P0.4: prove the fixture path (hw1-p1 NAND)

The single most important first iteration: turn **one** COVERAGE row green
end-to-end, establishing the template every later fixture copies.

1. Start the dev server (`preview_start`, config in `.claude/launch.json`, port 5173).
2. In the app, build a **NAND** circuit (2 inputs → AND → NOT → 1 output). Verify
   it computes NAND, then **export** its `CircuitData` (components + wires).
3. Also make a **broken** variant (e.g. drop the NOT, so it computes AND) and export it.
4. Author the question: `buildMode: "CC"`, `representation: "binary"`, a `cc_spec`
   with two 1-wide inputs + one 1-wide output, and the four NAND `test_cases`.
5. Write `app/tools/fixtures/reference/hw1-p1.json` as
   `{ question, correct, broken }` (see `fixtures/reference/README.md`).
6. Set the `hw1-p1` row's `"fixture": "reference/hw1-p1.json"` in
   `coverage-manifest.json`.
7. `npm run coverage` → `hw1-p1` must report **verified** (correct passes all 4
   cases, broken fails ≥1). Appearance-check the NAND render against VISUAL_VOCAB.
8. Update COVERAGE (row → ✅), QUEUE (P0.4 done), LOG (append), this HANDOFF
   (point at P1.1), then commit.

**Acceptance:** `npm run coverage` shows 1/56 verified; COVERAGE hw1-p1 fully ✅.

## Then

P1.1 → the rest of HW1 (logic + synthesis), then P1.2 (HW2 CC arithmetic), following
QUEUE order. Keep finishing one vertical before broadening.

## Watch out for

- Building the `correct` machine JSON by hand is error-prone (component/port/wire
  ids). Prefer **export from the running app**.
- Every fixture needs a **broken** variant or the harness flags it as regressed —
  that's intentional (the check must be adversarial).
- Keep the lockfile clean: if `tsx`/deps are missing, `npm install` (it reconciles
  to the committed lock; don't commit lockfile churn unless deps truly changed).
- After committing, confirm CI (`gh run list --limit 1`) — but only `main` deploys;
  on `buildout-infra` there's no Pages deploy, so CI-green means the branch builds.
