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

## Do this next — nothing. The buildout is COMPLETE at-tier.

**No loop-owned work remains.** Iteration 40 (this pass) ran the META-audit-queue
as the cutover's final reconciliation and it came back clean:

- **All four P6.4 remote-store doc claims CONFIRMED against code** (a 3-verifier +
  critic workflow): backend.ts is the sole `VITE_API_BASE` mode switch and sole
  store-instance exporter; sanitize.ts strips `test_cases` + `perception_cases`
  from student assignments and per-case detail from results; remoteStores/journal/
  migrateLocal are grader-free with remoteStoreCheck's grep gate over exactly those
  modules; parityCheck pins the redaction. CLAUDE.md's S4 rewrite is accurate.
- **Patch-accumulation scan over iterations 30–39: NO cluster.** The window is the
  memo-driven remote-stores program (S1–S4 + design memo + P6.3 parity groundwork)
  plus P1.8-S4 and P4.4 — all seam-routed depth. The two surgical bits (the two
  sanitize leaks, the removeTab mode-swap) are each guarded by a standing pin and
  share no family. No unifying task warranted.
- **Staleness pruned:** P6.1b was stale-open in QUEUE + CLAUDE.md though resolved
  it.34 → flipped `[x]`; the P6.3 "no CI checks / Gabriel's call" note was false
  (deploy.yml has the server-checks job) → annotated; HANDOFF's untracked
  "Vite Remote Mode"/5177 CORS hint → generalized (below).

The open QUEUE items are the two recurring METAs plus ONE optional, non-blocking
hardening item (**P-TOOLS-1**, a portability grep-gate motivated by the bumpCheck
bug — explicitly "do not reopen the loop just for this"). The METAs fire on cadence
but have **no new material to audit** — the ledger is complete and no fresh
loop-owned work is being produced. The next agent should **report done and STOP the
loop**; do not schedule an empty iteration. Re-open the loop only if new buildable
coverage appears (e.g. real HW content that yields constructed machines) or the
correct-answers project (upgrading the 10 interface rows to exact) is chartered —
both are separate, human-initiated efforts. If a real iteration does occur, fold
P-TOOLS-1 into it.

**Verified-green baseline (2026-07-08, iteration 40) — now GENUINELY green:**
all gates fresh by exit code — app tsc 0 · `npm run check` 0 (12 tools;
remoteStoreCheck 56, navResetCheck 120, coverage 46+10/0/0) · build 0 · server
typecheck 0 · check 0 (serverCheck 35 + parityCheck 36). ⚠ This required a
one-line tooling fix: `app/tools/bumpCheck.ts:27-28` had hardcoded absolute
imports from a foreign checkout (`/Users/gabriel/.../making-minds/...`),
introduced ~iteration 19 (`70af455`) — so `npm run check` had been **silently
red on this machine for ~21 iterations**, hidden behind seven passing tools. The
prior handoffs' "check green" were true only on the authoring checkout. Fixed to
relative `../src/...` (matching every sibling tool). Also: `server/` needs its
own `npm install` before the server-booting checks pass (`cd server && npm ci`,
no lockfile churn) — this is a per-machine setup step, not a code issue.

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
  `npm install` (remoteStoreCheck/serverCheck/parityCheck all fail with express
  `ERR_MODULE_NOT_FOUND` until then); appearance recipe v3; no lockfile churn;
  remote browser smokes need the API server started with `MM_CORS_ORIGINS` set to
  match the Vite dev origin (e.g. `http://localhost:5173`) or every POST preflight
  403s. (An untracked "Vite Remote Mode" launch config on port 5177 was used in
  iteration 37; it is NOT in `.claude/launch.json` — set the origin to whatever
  port your remote-mode Vite actually serves.)
