# Handoff — the hot state

_Read this first. It says exactly where we are and what to do next. Rewrite it at
the end of every iteration. If it conflicts with the harness, the harness wins —
run `npm run coverage` and reconcile._

## Where we are — ledger complete · P6.4 remote-store cutover COMPLETE (S1–S4)

Branch `buildout-infra`. **46 exact + 10 interface = 56/56 at-tier**, 0
pending, 0 regressed, 0 warnings. The Remote-store cutover
(`designs/remote-stores.md`, async-first, judge 82–72–58) is DONE — all four
slices landed all-green, one per iteration (35–38); the full evidence trail
is in QUEUE's P6.4 close and LOG iterations 35–38:

- **S1 (35):** async seam flip — Promise-returning seams, async-wrapped Local
  impls (zero behavior change), sequence-guarded openAssignment, single-flight
  autosave, `useAsyncValue` views; navResetCheck 120.
- **S2 (36):** release + review on the seams — `gradeRelease.ts` deleted
  (flag on `AssignmentStore`, key byte-compatible), pure `applyManualReview`
  in leaf `storage/manualReview.ts`, server review route; serverCheck 35,
  parityCheck 36.
- **S3 (37):** Remote impls + backend switch + auth — `Remote*` stores as
  direct api/client calls (grader-free, grep-gated), `storage/backend.ts`
  sole store-instance exporter, remote login/session/401 flow, stubAuth
  deleted, bundled assignments local-mode-only; remoteStoreCheck joined the
  chain (12 tools).
- **S4 (38):** migration + resilience + the batched doc rewrite —
  `storage/migrateLocal.ts` (fill-empty first-login upload, per-email guard),
  `storage/journal.ts` (per-email crash buffer; keepalive unload flush;
  replay-on-open — an outage-era edit survives a hard tab kill, browser-
  verified), `auth/HealthGate.tsx` (boot probe + auto-retrying outage
  screen), autosave `'error'` + backoff, online-only-submit alerts;
  remoteStoreCheck 31 → **56 pins**; CLAUDE.md fully reconciled (narrative,
  both-modes status, seams table, key files, Things-to-watch honesty pass)
  and QUEUE's P6.4 closed. Local mode stayed byte-identical throughout
  (zero /api traffic, pinned + browser-checked).

## Do this next

The queue is empty of committed work. Open items are exactly: **P6.1b**
(arena-turbot color — GABRIEL'S CALL), optionals (ActiveTask trim), and the
recurring METAs. **~Iteration 39 = META-audit-queue**, which should double as
the cutover's final reconciliation: spot-run the S1–S4 pins by exit code
(remoteStoreCheck 56, navResetCheck 120, serverCheck 35 + parityCheck 36),
verify CLAUDE.md's new claims against the harness, and do the
patch-accumulation scan over iterations 30–38.

## Then

Product remainder (not loop-owned): deploy per `deploy/README.md` (waiting on
the UCLA AWS account; CF Pages `VITE_API_BASE`, Lightsail `MM_CORS_ORIGINS`,
SQLite backup = copy the file), UCLA SSO (server-side `AuthProvider` swap —
client flow done), and authoring the real HW1–HW7 content.

## Watch out for

- **Fetch main + `git status` for foreign WIP at the START of every
  iteration** (memory: project-shared-worktree-concurrency).
- **Judge gates by EXIT CODE**, never a piped tail.
- **remoteStoreCheck (56) + parityCheck (36) + serverCheck (35) are the
  cutover's teeth** — extend, never weaken; the grep gate keeps the grader
  out of the remote-store module graph; the review parity pin guards the
  shared `applyManualReview`.
- **Local-mode byte-compatibility** is the cutover's standing invariant:
  same localStorage keys, same visible flows; the harness drives local mode
  headlessly (navResetCheck pins `backendMode === 'local'` under Node).
- **Journal replay is deliberately replay-wins** (supersedes a present
  server copy; LOG 38 records the memo deviation + rationale) — don't
  "fix" it back to fill-empty without re-reading journal.ts's header.
- **Runaway agents:** hard bar + stop rule; checkpoint-then-continue for
  long serial work; resume-don't-redo after API deaths.
- **Ops:** 529/overload → workflow resume; `server/` needs its own
  `npm install`; appearance recipe v3; no lockfile churn; remote browser
  smokes need the API server started with `MM_CORS_ORIGINS=http://localhost:5177`
  (the "Vite Remote Mode" launch config's origin) or every POST preflight 403s.
