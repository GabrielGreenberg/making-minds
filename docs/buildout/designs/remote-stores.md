# Remote Stores: Make the Seams Honest, Migrate Every Consumer Once
_Status: accepted · 2026-07-08 · Task: P6.4 · Judged competition: "ASYNC-FIRST" 82 vs "ADAPTER-MINIMAL" 72 vs "offline-first-sync" 58_

## 1. Problem, and the shape of the code it lands in

The three storage seams (`WorkbookStore`, `AssignmentStore`, `SubmissionStore` in
`app/src/storage/`) plus the `gradeRelease.ts` flag are **synchronous** and consumed
synchronously — at render time (`HomeScreen.tsx:19/77`, `InstructorDashboard.tsx:25/83`,
`GradebookView.tsx:50/62`, `AssignmentEditor.tsx:18`, `QuestionCreator.tsx:174/323`), at
action time (`store.ts:1443` openAssignment, `:1615/1620` submitAssignment, `:3770`
debounced autosave with flush hooks at `:3836-3838`), and at **Zustand module init**
(`store.ts:789` → `loadSubmissions`, `:3745-52`). Meanwhile `api/client.ts` (P6.2/P6.3)
already maps 1:1 onto every server endpoint, Promise-returning, token-bearing — and is
imported by **nothing**. The server (`server/src/app.ts`) already grades on receipt with
the same pure engine, sanitizes student payloads (`sanitize.ts`: `test_cases: []`,
results withheld pre-release), and stamps identity/timestamp itself (`app.ts:193-198`).

The judged census (verified line-by-line): the entire consumer surface is **8 files,
~25 call sites**, and only two of the eleven `npm run check` tools drive the store at all
(`navResetCheck.ts:181/184`; `scWindowCheck.ts` is already fully async). Two facts settle
the hardest tension up front: **(a)** no student-facing code reads `test_cases` or calls
`gradeSubmission` — the only UI callers are `Gradebook.ts:55` and `GradebookView.tsx:320`
(instructor-only, and both already prefer `record.result` with local regrade as a
legacy fallback) — so sanitized payloads break nothing except local grading, which remote
students must not do anyway; **(b)** manual review is not a duplication to retire but a
**gap**: the server has no review endpoint at all (grep-confirmed), while grade-release
genuinely exists twice (`mm:release:` key + the server's `grades_released` column).

## 2. Decision

**Flip the seam interfaces to Promise-returning and migrate every consumer once,
compiler-driven.** No cache layer, no sync engine, no hydration mirror: `Remote*` stores
are direct `api/client.ts` calls; `Local*` stores are the same bodies with `async` in
front (zero logic change). A remote backend is intrinsically async; a sync facade must
lie about staleness and hide failures, and both rival designs ended up punching async
holes in their own facades (submit, boot, write failure) — the tell that async-with-
loading-states is the app's true architecture. The churn is affordable because it is
enumerable (§1) and strict CI tsc (`noUnusedLocals` etc.) enforces exhaustiveness.

```ts
// storage/backend.ts — the ONE mode decision; sole exporter of store instances.
// import.meta.env?. guard (same as client.ts:42) keeps Node/tsx harness runs local.
export const backendMode = import.meta.env?.VITE_API_BASE ? 'remote' : 'local';
export const workbookStore / assignmentStore / submissionStore;

interface WorkbookStore {
  loadAssignmentState(id): Promise<AssignmentState | null>;
  saveAssignmentState(id, state): Promise<void>;
}
// AssignmentStore ABSORBS grade-release — policy rides the assignment row exactly as it
// already does server-side (db grades_released; summaries carry gradesReleased on the wire):
interface AssignmentStore {
  list(): Promise<AssignmentSummary[]>;                 // summary gains gradesReleased
  get(id): Promise<{ assignment; gradesReleased } | null>;
  save(a): Promise<void>;  remove(id): Promise<void>;
  setGradesReleased(id, released): Promise<void>;
}
interface SubmissionStore {                             // buildSubmission/applyManualReview stay pure+sync
  submit(id, submission): Promise<SubmissionRecord>;    // remote sends answers only; identity+time = server's word
  listSubmissions(id) / getLatest(id) / recordManualReview(...): Promise<...>;
}
```

- **`storage/gradeRelease.ts` is deleted**; the `mm:release:` key becomes a private
  detail of `LocalAssignmentStore`. One read path, one write path, server-authoritative
  in remote mode. `clearSubmissions` leaves the seam (dev-only; `devData/seed.ts` pins
  the concrete `LocalSubmissionStore`; the seed button is gated to local mode).
- **Manual review**: the pure `applyManualReview` (`submissionStore.ts:61`) stays the
  ONE implementation. New server endpoint
  `POST /api/assignments/:id/submissions/:attempt/review` (instructor-only) imports it
  across the repo boundary exactly as `app.ts` already imports the grader; new client fn;
  `RemoteSubmissionStore.recordManualReview` calls it. The local path becomes the dev
  impl of one contract, not a mirror.
- **Who grades**: grading stays where the test cases are. Remote students: server grades
  on receipt, `studentRecord` withholds results pre-release — the student path never
  invokes the engine (belt, grafted from offline-first-sync: a grep gate in the harness
  forbids grader imports in remote-store modules, house pattern from notationCheck).
  Remote instructors: trust the stored server record — the existing
  `record.result ?? gradeSubmission(...)` fallback never fires remotely (every record has
  a server grade; parity pinned byte-for-byte by P6.3's parityCheck) and stays as-is for
  legacy local records. Local mode: unchanged, `LocalSubmissionStore` keeps autograding —
  the documented dev server stand-in, and what the headless harness exercises.
- **Store/React consumers, once, properly**: `openAssignment(id): Promise<boolean>` with
  `flushAutoSave()` on entry, `Promise.all` over assignment+workbook, and a `loadSeq`
  counter so a stale resolve can't clobber a newer navigation; module-init
  `loadSubmissions()` becomes `submissions: {}` + `hydrateSubmissions()` on auth-ready
  and after each submit; autosave awaits the seam single-flight with trailing rerun and
  an `'error'` status + backoff; routing's assignment branch goes `void ...then(ok => …)`
  with the same stale-deep-link repair. One shared `useAsyncValue(fetcher, deps)` hook
  (~30 lines, no library) replaces the render-time reads in the five views — and
  *deletes* the existing force-rerender ceremony (`InstructorDashboard.tsx:22`'s `force`,
  `GradebookView.tsx:35`'s `setReviewVersion`) in favor of `reload()`.
- **Auth**: same exports (`AuthProvider`/`useAuth`/`getCurrentUserEmail`;
  `auth/types.ts` already declares `loading`, `AuthGate.tsx` already renders it). Remote:
  token in `mm:auth:token` (already implemented in client.ts) → `me()` on mount → user
  cached for the non-hook `getCurrentUserEmail` (three submit buttons); any 401 clears
  the token via an `onUnauthorized` hook in `request()`. LoginScreen grows an email field
  behind `backendMode`. UCLA SSO later swaps the server's `AuthProvider`
  (`server/src/auth.ts`); the client flow is unchanged. **Ordering fix**: `initRouting()`
  moves from `main.tsx:9` into an AuthGate effect gated on `user != null`, so a deep link
  can't fire an unauthenticated `openAssignment`.
- **Durability without a cache** (grafted, hardened): the debounced save is the primary
  path; visibilitychange flushes with a normal fetch; beforeunload fires a best-effort
  `keepalive` fetch (~64KB cap — known-insufficient for big circuits) AND always writes a
  **write-only local crash buffer**, keyed per user `mm:journal:<email>:<asgId>`
  (ADAPTER-MINIMAL's keying — shared lab browsers must not leak circuits across
  accounts), read only by the fill-empty reconcile at `openAssignment`. Not a cache;
  never a read path.
- **Migration**: fill-empty-only, per-user, at first remote login (guard
  `mm:migrated:<email>`): each `mm:asg:*` with no server workbook is PUT up; instructor
  `mm:inst-asg:*` likewise. Never overwrites server state; never deletes local keys
  (local mode remains the dev environment). Submissions / release flags / reviews are
  deliberately NOT migrated — prototype data; the cutover lands before the real HW1–HW7
  content is authored.
- **Failure UX** (proportionate to ~80 students on campus wifi): `useAsyncValue` error
  states with Retry; a health-probe + explicit retry screen if the boot fetches fail
  (grafted from ADAPTER-MINIMAL); autosave error chip + backoff; a failed submit alerts,
  records nothing, and offers retry — submit is **online-only, never queued**: the server
  stamps time (`app.ts:197`), so nothing can be silently late near a deadline, and the
  student's work is already saved either way.

## 3. Slice plan

Each slice lands green (`app npm run check`, `tsc -p tsconfig.app.json --noEmit`, build,
`server npm run check`) and is independently revertible. Local mode stays the default, so
the app harness runs untouched throughout.

1. **S1 — The async flip (mechanical, still all-local).** Interfaces → Promise; Local
   impls wrapped `async`; registry (`assignments/index.ts`) async; store actions
   (`openAssignment`/`submitAssignment`/`hydrateSubmissions`/`performAutoSave`) with
   `loadSeq` + flush-on-open + single-flight; routing branch; `useAsyncValue`; five views
   + `seed.ts` awaits. Behavior identical (microtask latency only). **Acceptance:**
   navResetCheck green with ~4 added awaits + an explicit `backendMode === 'local'` pin +
   one NEW interleaving pin (open A, immediately open B → B wins); scWindowCheck +2
   awaits; full instructor browser sweep while still local, so the UI churn is validated
   before any network exists. Escape hatch if it overruns: split S1a
   (storage+store+routing+tools) / S1b (view loading/error polish) — S1a converts views
   minimally so both halves compile green.
2. **S2 — Seam absorbs release + review.** `AssignmentStore` gains `setGradesReleased` +
   `gradesReleased` on list/get (local impl folds the `mm:release:` key; delete
   `gradeRelease.ts`); HomeScreen/GradebookView move onto the seam. Server: review
   endpoint + `db.updateSubmissionResult` reusing pure `applyManualReview`; client fn.
   **Acceptance:** serverCheck +4 pins (instructor 201; student 403; verdict present in
   instructor GET; absent in student pre-release GET; re-review overwrites); parityCheck
   pins server-applied review ≡ in-process `applyManualReview`; app check green.
3. **S3 — Remote impls + backend switch + auth.** `storage/backend.ts`;
   `Remote{Workbook,Assignment,Submission}Store` as direct client calls (grep-gated: no
   grader imports); remote AuthProvider (`me()` bootstrap, async login, 401 hook);
   LoginScreen email form; `initRouting()` into AuthGate. **Acceptance:**
   serverCheck/parityCheck green; NEW `tools/remoteStoreCheck.ts` (grafted from
   ADAPTER-MINIMAL) — Remote stores driven headlessly against a booted real server (the
   serverCheck pattern) pinning round-trips, 401 handling, and the grep gate; scripted
   browser E2E: student logs in → opens sanitized assignment → builds → autosave
   round-trip → submits → no grade shown; instructor sees the server record → reviews an
   open question → releases → student sees scores only.
4. **S4 — Migration + resilience.** `migrateLocalData()` (fill-empty, per-user guard);
   autosave retry/backoff + keepalive flush + per-email crash buffer & reconcile;
   health-probe retry screen; loading-skeleton/error sweep. **Acceptance:**
   remoteStoreCheck pins the reconcile decision table (server-null + local-present →
   upload; server-present → never touch; buffer keyed per email) and migration
   idempotence; full two-browser manual E2E; CLAUDE.md Part 1/2 + QUEUE + deploy notes
   (CF Pages `VITE_API_BASE`, Lightsail `MM_CORS_ORIGINS`, SQLite backup = copy the file).

## 4. Test plan

The harness stays local and headless by construction: all eleven `npm run check` tools
grade via the pure engine and Local stores; the `import.meta.env?.` guard resolves
`backendMode = 'local'` under Node, and navResetCheck asserts it so drift fails loudly.
Additions: the S1 interleaving pin (the one genuinely new race class);
serverCheck/parityCheck review pins (S2); `remoteStoreCheck` (S3/S4) for Remote-store
round-trips, reconcile rules, migration idempotence, and the grader-import grep gate.

## 5. Risks

- **New interleavings in a 3,982-line born-sync store** (stale open resolve; debounce
  retargeting across a switch; autosave racing submit) — the real risk, and no compiler
  enumerates it. Mitigation: `loadSeq`, flush-on-open, single-flight autosave, and the
  dedicated navResetCheck interleaving pin so the race class is harness-covered; S1 ships
  while still all-local so races surface before the network adds latency variance.
- **Unload-time loss in remote mode** — keepalive caps at ~64KB; multi-question circuits
  exceed it. Mitigation: debounced save is primary; visibilitychange uses a live fetch;
  the per-email crash buffer + fill-empty reconcile recovers hard kills. Residual = the
  last debounce window on a hard kill — same class as today's silent localStorage-full
  fail; accepted and documented.
- **Instructor-view regressions from render-read → fetch-on-mount** (double fetch, flash
  of empty). Mitigation: one shared hook used identically five times; `reload()` replaces
  the existing hacks 1:1; the S1 all-local browser sweep validates the UI churn first.
- **Every read is a network round trip** — assignment-open and dashboards ride Lightsail
  RTT with small N+1s (`hydrateSubmissions` ≈ 7 GETs). Accepted at course scale (~7
  assignments, 80 students; the gradebook is one request); `Promise.all` everywhere; a
  batch summary endpoint is an enumerated follow-up that changes no seam shape.
- **Single box, no HA** — server down blocks login and submits (work in progress is safe
  locally via the crash buffer, but there is no offline mode, by design — a silent local
  fork of student data is worse than a visible outage). Mitigation: health probe + retry
  screen; Lightsail restarts are minutes; deadline-window deploys are a course-ops rule,
  not a code rule.
- **Multi-device last-write-wins on workbooks** silently drops the loser. Accepted for
  the pilot (single-device typical); the crash buffer preserves the local loser for
  manual recovery; an `updatedAt`/If-Match precondition (offline-first-sync's 409
  protocol) is the noted follow-up **if it bites** — not built speculatively.

## 6. Deliberate exclusions

No client cache/mirror layer; no offline mode or outbox queue (submit is online-only);
no conflict-resolution protocol (LWW + crash buffer); no submissions/release/review data
migration (prototype data); no batch endpoints yet; no SSO (server-side `AuthProvider`
swap later, client flow unchanged); no httpOnly-cookie hardening (client.ts's documented
threat-model trade-off stands).

## 7. Rejected alternatives

**ADAPTER-MINIMAL (72/100)** — keep the seams sync; hydrate an in-memory cache once
behind AuthGate; optimistic write-through; localStorage journal + three-branch reconcile.
Its code census was accurate and its hydration-gate observation (AuthGate is the app's
one async gate) is genuinely right — this memo grafts its per-email journal keying, the
health-probe retry screen, and the injectable-transport `remoteStoreCheck`. Rejected
because the facade doesn't hold its own weight: submit, boot, and write-failure all
punch async holes through it anyway; the "sync reads valid only post-hydration" invariant
is enforced by convention, not types (a pre-gate caller gets `undefined` with no compiler
complaint); a global `storeRevision` re-renders whole views — a hand-rolled, worse
SWR; and its riskiest code (journal/reconcile) exists only to compensate for reads the
async design can simply await. Its own self-critique concedes the case: the app's true
architecture is async-with-loading-states, and the adapter implements it where React
can't see it.

**offline-first-sync (58/100)** — localStorage stays the synchronous source of truth; a
background sync engine (dirty-set outbox, 409 revision protocol, conflict stashes,
per-user key namespacing, new `syncCheck` tool) reconciles with the server. The most
thorough server-gap analysis of the three (it correctly reframed manual review as a gap,
not a duplication — adopted), and its grader-import grep gate and online-only-submit
deadline framing are grafted. Rejected on proportionality and steady-state cost: for ~80
students on stable campus wifi against one box, a **permanent** two-truth reconciliation
layer — where every future storage bug starts with "which copy is right?" — buys outage
tolerance the deployment rarely redeems, at open-ended operational cost versus the
bounded one-time refactor it avoids; wall-clock newest-edit-wins invites exactly the
cross-device corruption it exists to prevent; and its meaty slice (S3, self-scored at 2
iterations) strains the land-green-in-1-2 guardrail. Its own self-critique points away
from itself, and correctly.
