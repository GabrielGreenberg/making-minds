# Handoff — the hot state

_Read this first. It says exactly where we are and what to do next. Rewrite it at
the end of every iteration. If it conflicts with the harness, the harness wins —
run `npm run coverage` and reconcile._

## Where we are — ledger complete · remote-stores cutover S3/4 done

Branch `buildout-infra`. **46 exact + 10 interface = 56/56 at-tier**, 0
pending, 0 regressed, 0 warnings — the coverage ledger has been complete
since iteration 25 and every close-out task through P6.3 is done (thirty-six
iterations). The active program is **P6.4, the Remote-store cutover**, per
`designs/remote-stores.md` (async-first won the judge panel 82–72–58):

- **S1 DONE (iteration 35):** the three storage seams are Promise-returning;
  Local impls async-wrapped, zero behavior change; `storage/backend.ts`
  backendMode flag; sequence-guarded openAssignment; single-flight autosave;
  `useAsyncValue` in the five async views; navResetCheck 120.
- **S2 DONE (iteration 36):** grade-release lives ON the AssignmentStore seam
  (summaries carry `gradesReleased`; `storage/gradeRelease.ts` DELETED, key
  format byte-compatible); manual review's pure `applyManualReview` moved to
  the leaf `storage/manualReview.ts` (server-importable); the server gained
  the review route the design judge identified as a GAP
  (`POST /api/assignments/:id/submissions/:attempt/review`, instructor-only,
  server-stamps reviewedAt); serverCheck 35, parityCheck 36 (incl. a true
  parity pin: server-applied review ≡ in-process). Browser-verified:
  release toggle + review verdicts survive reload; pre-release stays
  grade-silent.

- **S3 DONE (iteration 37):** Remote{Workbook,Assignment,Submission}Store
  over api/client.ts (no cache; grader-free, grep-gated);
  `storage/backend.ts` is the sole store-instance exporter by mode; full
  auth flow (remote login → bearer → me() restore → 401 hook; stubAuth
  DELETED; initRouting inside AuthGate, idempotent); recordManualReview
  gained `student` (Local byte-identical); bundled assignments are
  local-mode-only by design; a TDZ import cycle broken. remoteStoreCheck
  (31 pins, in npm run check — 12 tools) drives the Remote seams against
  the booted server headlessly. Remote browser smoke ran END-TO-END.

## Do this next — remote-stores S4 (the last slice)

Per the memo's S4: fill-empty localStorage migration (`migrateLocalData`,
idempotence pinned in remoteStoreCheck); per-email crash buffer + keepalive
flush; boot health-probe + retry screen; the loading/error/backoff UX sweep
('error' autosave status); online-only-submit UX (server stamps time,
visible retry). AND the BATCHED DOC REWRITE the memo scoped here: CLAUDE.md
(seams table — localStorage entries become 'Local impl behind backend.ts
switch; Remote live', auth row, key-files rows for remoteStores/backend/
manualReview/remoteStoreCheck, Part 1 narrative), plus QUEUE close of P6.4
when S4 lands. Local mode byte-identical; all gates + the 12-tool chain
green.

## Then

**S4** (error/backoff UX, per-email crash buffer, fill-empty localStorage
migration, online-only-submit UX — and the BATCHED DOC REWRITE: CLAUDE.md
narrative + seams table + key-files rows for the whole cutover). After S4:
the queue is empty again except optionals (ActiveTask trim if Gabriel wants
it) and the recurring METAs (~iteration 39 next audit).

## Watch out for

- **Fetch main + `git status` for foreign WIP at the START of every
  iteration** (memory: project-shared-worktree-concurrency).
- **Judge gates by EXIT CODE**, never a piped tail.
- **The memo is the spec** for S3/S4 — deviations allowed when narrowing;
  report them. HARD STOP if a slice balloons structurally.
- **CLAUDE.md intentionally lags until S4** (memo decision — batched
  narrative); the buildout memos stay per-iteration.
- **parityCheck + serverCheck are the cutover's teeth** (36 + 35 checks) —
  extend, never weaken; the review parity pin guards the shared
  `applyManualReview`.
- **Local-mode byte-compatibility** is S1–S3's invariant: same localStorage
  keys, same visible flows; the harness drives local mode headlessly.
- **Runaway agents:** hard bar + stop rule; checkpoint-then-continue for
  long serial work; resume-don't-redo after API deaths.
- **Ops:** 529/overload → workflow resume; `server/` needs its own
  `npm install`; appearance recipe v3; no lockfile churn.
