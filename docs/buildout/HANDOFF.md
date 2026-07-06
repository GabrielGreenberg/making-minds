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

1. **Author headlessly — no browser needed.** In a scratch `tsx` script, build a
   **NAND** diagram (IN1, IN2 → AND → NOT → OUT1) with the helpers in
   `app/tools/builder.ts` (`comp`/`wire`), plus a **broken** variant (drop the
   NOT → plain AND). Give components real grid positions (left→right) so the
   fixture also renders well later. This exact machine has already been proven
   headlessly (simulate + grade 4/4 correct, 0/4 broken) during bootstrap.
2. Author the question: `buildMode: "CC"`, `representation: "binary"`, a `cc_spec`
   with two 1-wide inputs + one 1-wide output, and the four NAND `test_cases`.
3. In the same script, assert `gradeQuestion(question, correct)` passes 4/4 and
   the broken variant fails; only then write
   `app/tools/fixtures/reference/hw1-p1.json` as `{ question, correct, broken }`
   (see `fixtures/reference/README.md`).
4. Set the `hw1-p1` row's `"fixture": "reference/hw1-p1.json"` in
   `coverage-manifest.json`.
5. `npm run coverage` → `hw1-p1` must report **verified**.
6. Appearance check (this is the only step that uses the browser): load the
   machine in the app (`preview_start`, port 5173) and compare against
   VISUAL_VOCAB.
7. Update COVERAGE (row → ✅), QUEUE (P0.4 done), LOG (append), this HANDOFF
   (point at P1.1), then commit.

**Acceptance:** `npm run coverage` shows 1/56 verified; COVERAGE hw1-p1 fully ✅.

## Then

P1.1 → the rest of HW1 (logic + synthesis), then P1.2 (HW2 CC arithmetic), following
QUEUE order. Keep finishing one vertical before broadening.

## Watch out for

- **Depth over patches** (NORTH_STAR's central design principle): before
  implementing any non-trivial task, name the problem's family, weigh shallow vs.
  deep, and prefer the unified architectural solution the phenomena warrant —
  with a design memo (`designs/`) for significant moves. Several queue tasks
  (P2.1, P3.1, P4.1) have their deep framing spelled out; don't take the
  surgical shortcut silently.
- **Delegate to survive**: use Workflows/Explore agents for read-heavy and
  fan-out work so this session's context lasts through the memo updates.

- Author machines **in code** via `app/tools/builder.ts` (port ids documented in
  its header; canonical five-mode examples in `src/devData/sampleData.ts`). The
  running app is only needed for the appearance check — and as a fallback for
  diagrams easier to draw than to code.
- Every fixture needs a **broken** variant or the harness flags it as regressed —
  that's intentional (the check must be adversarial).
- Keep the lockfile clean: if `tsx`/deps are missing, `npm install` (it reconciles
  to the committed lock; don't commit lockfile churn unless deps truly changed).
- After committing, confirm CI (`gh run list --limit 1`) — but only `main` deploys;
  on `buildout-infra` there's no Pages deploy, so CI-green means the branch builds.
