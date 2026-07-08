# Handoff — the hot state

_Read this first. It says exactly where we are and what to do next. Rewrite it at
the end of every iteration. If it conflicts with the harness, the harness wins —
run `npm run coverage` and reconcile._

## Where we are — ledger complete · remote-stores cutover S2/4 done

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

## Do this next — remote-stores S3 (the remote implementations)

Per the memo's S3: `Remote*` store implementations calling `api/client.ts`
directly; `storage/backend.ts` exports the mode-switched store instances;
auth/token flow wired (login → bearer → stores; `initRouting` moves inside
AuthGate per the memo); RemoteSubmissionStore threads the student email into
`reviewSubmission` (S2's noted punt — the seam signature may grow; keep Local
in lockstep). Acceptance per the memo's S3 criteria + `remoteStoreCheck`
groundwork if the memo scopes it here (check §test-plan). Local mode must
remain byte-identical; the harness stays local and green.

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
