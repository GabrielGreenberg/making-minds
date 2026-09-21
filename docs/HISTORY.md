# Making Minds — changelog (frozen 2026-09-21)

This is the dated "Last updated" narrative that lived at the top of `CLAUDE.md` until the
task pipeline landed (2026-09-21). It is **frozen**: nothing is appended here any more.
From that date on, the history of the project is `tasks/done/*` (one file per landed task,
with its progress log) plus `tasks/log.md` (one line per landing). Newest entry first.

_Last updated: 2026-09-21 (**repo hygiene — the two-branch model is retired.** The build-out
loop's long-lived working branch `buildout-infra` — and three other fully-merged leftovers,
`merge-hw-homeworks`, `worktree-auth-accounts`, `worktree-per-question-box-library` — were each
verified at ZERO commits unique to them vs `origin/main` and deleted locally and on GitHub;
`main` (938330f, 2026-09-17; app build + server typecheck green on a fresh `npm ci`) is now the
ONE long-lived branch, and the remote lists only `origin/main`. Any future loop iteration cuts a
fresh `buildout-*` branch from `main` (`.claude/commands/handoff.md`); every later mention of
`buildout-infra` in this log is history. No code changed. Earlier 2026-09-17: **FSM boxing
retired — notes/todos.md item 2, follow-up to the pass
below**. The one item that pass left unfixed: `fsmPlaceBoxInstance` placed a STATE node with
`boxedCircuitId` set, but `evaluateFSMSymbolStep` never read it, so a placed FSM box rendered
as a labeled rectangle but ran as an ordinary, transition-less state. Investigated and refused
by design, for the same underlying reason as the TM boxing refusal (also this file, below):
`confirmBox`'s FSM rules (one entry state S_A, one terminal state S_B with no outgoing
transitions, every other state complete on 0/1) describe a sub-automaton meant to consume
MULTIPLE subsequent input symbols — tracking its own internal position across steps — before
handing control back to the placed instance's own outgoing transitions. That is not a stateless
function call like a boxed CC/SC circuit; it needs an invented call/return convention (the
running machine's "current state" becoming a stack) threaded through `evaluateFSMSymbolStep`,
the store's live sim, turbot FSM brains, and the grader — and it was never wired for headless
grading either, since a placed instance carried only `boxedCircuitId`, never a frozen internal
circuit the way a CC/SC `BOXED` component carries `internalCircuit`. Rather than leave a
half-working feature, it's removed: `fsmPlaceBoxInstance`, confirmBox's FSM branch, and the
STATE-specific `boxedCircuitId` rendering/geometry/hit-testing in `CircuitCanvas.tsx` and
`componentGeometry.ts` are gone; `placeableBoxKinds('FSM')` (`types.ts`) now returns `[]`
(mirroring TM) and carries the full reasoning inline; the palette's "New Box" tool is no longer
offered on FSM canvases. `boxScopeCheck`/`routerCheck` pins updated to match; no seeded/sample
data used FSM boxing (checked), so no existing data decays. App tsc/build/check all green.

Earlier 2026-09-17 (**the `notes/todos.md` pass — 13 items**. Three new seams landed,
following the established Local/Remote pattern exactly (Promise-returning interface, a
localStorage-backed Local impl, a server-backed Remote impl, wired in `storage/backend.ts`):
**`FeedbackStore`** (`storage/feedbackStore.ts` + `remoteStores.ts`; server `feedback` table +
`POST/GET /api/feedback` + `PUT /api/feedback/:id/status`) backs a student "Feedback" link
(`components/FeedbackPanel.tsx`, in both `MenuBar` and `HomeScreen` headers) — category
dropdown (platform design / homework content), message, up to 2 screenshots
client-downscaled-and-JPEG-compressed before base64 encoding (server caps them too, 400/413 on
abuse) — feeding an instructor queue at `#/instructor/feedback`
(`instructor/FeedbackQueueView.tsx`: open/resolved/all filter, mark resolved/reopen). Works in
BOTH backends, unlike the roster. **`NotesStore`** (`storage/NotesStore.ts` + `remoteStores.ts`;
server single-row `instructor_notes` table + `GET/PUT /api/instructor-notes`, both
instructor-gated) backs one shared markdown document instructors use to coordinate, at
`#/instructor/notes` (`instructor/NotesView.tsx`: split raw-markdown textarea + live preview,
saves only on "Save" per the ask, warns before overwriting if the server's `updatedAt` moved
since load — last-write-wins otherwise, surfaced rather than silent since this is explicit
multi-instructor coordination). Rendering uses **`marked` + `dompurify`**, added as new
dependencies (a real decision, confirmed with Paul first): `statementFormat.ts`'s parser is a
narrow, pinned grammar for question statements, not general markdown, so extending it would
have meant rebuilding a chunk of what a markdown library already does correctly. Neither new
dep introduced a new `npm audit` vulnerability (checked; the pre-existing ones are all
build-tooling transitives). The third change is data/behavior, not a new seam: **freezing +
failed-case detail** (todos 3 & 4). `dueDates.ts` gains `isFrozen(dueDate, now, hasSubmission)`
— the header comment's "a due date never gates anything" rule now has its one deliberate
exception, spelled out there: due-date gating applies to EDITING, never to submitting, and only
once a submission already exists (a student who never submitted stays fully editable past the
deadline and can still submit late; the moment they do, THAT submission freezes their view from
then on — this is how "late submissions are always accepted" and "freeze it in place" both stay
true at once, confirmed with Paul as the intended semantics). `store.ts`'s
`selectAssignmentFrozen` + `selectQuestionLocked` extend the SAME lock `isCurrentQuestionLocked`
already used for "mark as done" (todo 8, below) — frozen behaves exactly like every question
being marked done at once: `switchQuestion`/`openAssignment` load each question's actually-
SUBMITTED circuit (`frozenQuestionCircuit`, not the possibly-diverged live workbook) read-only,
the same ~26 mutating store actions refuse edits, and the autosave subscriber's own guard means
nothing frozen ever overwrites the real saved workbook. Run/Step stay live on purpose — the ask
was "see and run their submission, but not edit it." `server/src/sanitize.ts` now widens
`stripQuestionResult`: students always saw scores-only before; now their own results also carry
`input`/`pass`/`reason` (value cases), `frames`/`pass`/`failStep`/`reason` (perception),
`label`/`pass` (fill-in), and full `turbotCases` (no answer key exists in that shape) — `cases[].expected`/`got`
and `fillCases[].expected`/`got` (a STRING secret, which needed `parityCheck.ts`'s `findLeaks`
extended to catch non-empty strings, not just non-empty arrays) stay hidden exactly as before.
`GradesPanel.tsx` surfaces this as a per-question "▸ failed inputs" dropdown (never in the main
pane, per the ask) whose "Open my submission" link navigates into the frozen view. Scope
decision, documented rather than silently dropped: clicking a failing input does NOT
auto-populate it into a live Run — CC/SC/FSM/TM/turbot each have a different "set this input"
mechanism, and building all of them without live browser testing (unavailable this session) was
judged too large/risky for this pass; the student sees exactly which input failed and can set it
themselves. Also this pass: **"mark as done"** (todo 8) — `QuestionCircuit.done`, a toggle in
the question nav bar (`TabBar.tsx`), the `isCurrentQuestionLocked` guard (store.ts) that
freezing above also reuses, read-only open-response/fill-in inputs, an "N of M done" summary +
per-question badge on the assignment overview. Deliberately NOT locked: INPUT toggles, MEM
overrides, TM tape edits while idle — those are exploratory/reset-on-navigation, not the graded
answer. **Box TMs** (todo 13) investigated and refused by design, documented beside
`placeableBoxKinds` in `types.ts`: a TM has one tape and one control thread, so there is no wire
boundary to box the way CC/SC/FSM boxing works (a single stateless function call); "boxing" a
TM sub-graph would mean splicing transition tables (shared state-id namespace, shared tape, an
invented call/return convention) — a materially different, uninvented feature. (Also surfaced,
not fixed: the FSM "box" path places a `boxedCircuitId` that `evaluateFSMSymbolStep` never
reads — a pre-existing rendering-only placeholder, worth a look independent of this todo.) Five
small UI fixes round out the pass: manual-review notes are now shown to students in
`GradesPanel` (the data already reached the browser; nothing rendered it); `HomeScreen`/
`AssignmentOverview` re-fetch `submissions` on every visit instead of only once at app boot (the
actual cause of "requires re-releasing to see an update" — every server read was already fresh,
the client just never asked again); instructor-dashboard action buttons get a fixed min-width so
"Publish" vs "Hide" no longer shifts later buttons; the Submissions pane's per-question columns
scroll horizontally with the Score column pinned via `position: sticky`; the top bar shows a
student's name without also announcing their role; the TM tape strip gets `user-select: none`
(shift-click was selecting cell text) and an explicit `max-width: 100%`. Gates: app tsc/build/
check (`navResetCheck` grew a `[mark as done]` section — 9 checks — and a `[frozen assignment]`
section — 17 checks — 136 → 162) and server tsc/check both
green; `parityCheck.ts` grew 5 checks (incl. a `findLeaks` self-test for string-valued secrets,
needed for fill-in's `expected`/`got`) proving the sanitize.ts widening exposes the safe fields
AND still hides the answer key, plus its two existing leak checks re-scoped to the narrower
`expected`/`got` forbidden set; `serverCheck.ts` grew 20 checks (13 feedback + 7 notes) plus one
updated per-case-detail assertion; `remoteStoreCheck.ts` grew 9 checks (5 feedback + 4 notes)
plus one updated leak assertion. Not done this pass, flagged for a human: auto-loading a failed
input into a live Run (todo 4's harder half); a dedicated due-date-independent "view this
submission" mode for the edge case where grades release before the due date; live browser
verification of the CSS-only fixes (Chrome automation was unavailable this session — the changes
are small, standard, and low-risk, but not visually re-confirmed).

Earlier 2026-09-11: **accounts and sign-in — the launch auth system**. The
server now owns a real account system behind the same one-swap seam, so UCLA SSO stays a
drop-in: `MM_AUTH_MODE` picks the provider (`server/src/auth.ts`, `createAuthProvider`) and
**the default is now `password`**, not `dev`. The shape: a **CSV roster** decides who may have
an account (pure `server/src/roster.ts` — RFC-4180 reader plus tolerant header detection for
email / name-or-first+last / student ID / role, reporting per-row issues rather than dropping
rows); each person **creates their own account** with a password (scrypt via
`server/src/password.ts`, self-describing `scrypt$N$r$p$salt$hash`, so the cost can be raised
later without invalidating anyone), verified against the roster **and** the student ID on file;
afterwards they sign in with email + password and the 30-day bearer session persists as before.
Someone whose email isn't on the roster files an **access request** an instructor approves or
rejects. New endpoints: `GET /api/auth/config` (unauthenticated capabilities — the login screen
renders from THIS, so switching the server to SSO or dev mode needs no frontend rebuild),
`POST /api/auth/register`, `POST /api/auth/password`, `POST /api/auth/access-requests`, and the
instructor's `/api/roster*` + `/api/access-requests/*` set. Security posture: one message for
every failed sign-in (no roster enumeration), an equal-cost dummy hash for unknown accounts,
a per-(email, IP) `LoginThrottle` that never locks an account by proxy, roster import that
**only adds and updates** (a mid-quarter re-import never removes anyone or touches a password),
password change and instructor reset that end every other session, and roster removal that
keeps the person's submitted work. No mail server, so forgotten passwords are an instructor
reset → the student registers again with the same email. Frontend: the login screen is now
Sign in / Create account / Not on the roster? (or a single "Sign in with UCLA" button under
`mode: 'sso'`), driven by the fetched capabilities; a "Password" control (`auth/AccountPanel.tsx`)
sits beside the session chip wherever chrome offers session controls; and the instructor gains
a **Roster & accounts** screen (`instructor/RosterView.tsx`, route `#/instructor/roster`) —
CSV import by paste or file with a column/issue report, who has created an account, reset
password, add/remove one person, approve/reject access requests. Local mode is unchanged: the
toy-account picker, which now reports `mode: 'mockup'` with registration and requests off.
Deploy: `MM_AUTH_MODE=password` in the systemd unit, and a new admin CLI
`npm run roster -- import|add|set-password|reset|remove|list|requests` that bootstraps the first
instructor (the one thing the web UI can't do for itself). Gates: new `server/tools/authCheck.ts`
(138 checks, in `server`'s `npm run check`) covering roster parsing, password hashing/policy,
every provider's decision table, and the whole HTTP lifecycle incl. the refusals; app
`remoteStoreCheck` grew a section driving `api/client.ts` against a second real server booted in
password mode (85 pins total); app tsc/build/check and server tsc/check all green, coverage
ledger unchanged at 46 exact + 10 interface, 0 regressed. Still NOT done: UCLA SSO itself
(`SsoAuthProvider.authenticate` is one honest TODO), and seeding HW1–HW7 into the server DB.
Earlier 2026-09-10: **box naming: unique defaults + student renaming** — default names
are now unique across the whole homework: `confirmBox` draws the next free `Box n` / `FSM Box n`
from the union of the assignment-wide `confirmedBoxLibrary` and the boxes drawn on the live
canvas (`takenBoxNames`/`nextBoxName` in store.ts), where it used to count only the live
canvas's boxes and so handed out "Box 1" again on every question. Renaming is a first-class
action: `renameBox(id, name)` trims, refuses an empty or already-taken name (returning the
message), and sweeps the name everywhere at once — the library entry, the drawn rectangle, and
the label of every placed instance in every question's saved circuit (`questionCircuits`), all
under one `pushHistory` so undo restores it. Two entry points: the palette's Boxes items each
carry a ✎ button that swaps the tile for an inline input (Enter/blur commits, Escape restores),
and the existing double-click-the-box-name-on-canvas path now routes through `renameBox` too
(previously `updateBox`, which never touched other questions). boxScopeCheck grew an 18-pin `[naming]`
section (38 → 56 checks). Earlier same day: **drag-to-reorder for assignments and questions** — the ↑/↓ buttons
are gone from both instructor lists; a grip handle on each row starts an HTML5 drag, the whole
row is the drop target, and the list rearranges live under the cursor (`instructor/dragReorder.ts`
— the pure `moveItem` plus the `useDragReorder` hook, which previews the move on every dragenter
and commits on drop; a cancelled drag reverts). Bundled assignments stay PINNED (they live
outside the store and can't be renumbered): their handle is inert and they can't be displaced by
a row dragged past them. Persistence is unchanged — the dashboard still renumbers every
non-bundled `AssignmentData.order` on commit, and the editor commits the reordered
`questions` array. Earlier same day: **the `notes/pset_updates.md` pass — 23 items, one commit each**.
Student workspace: question statements are now rendered markup rather than a `pre-wrap` blob
(`statementFormat.ts` + `components/StatementBody.tsx` — LaTeX via KaTeX, `` `code` ``, bold,
italic, paragraphs; inline `IN1=0,IN2=1 -> OUT=1` profiles lifted into tables; `(a)/(b)` parts
split onto their own lines), with new optional `title` (bold, own line) and `hint` (italic,
coloured, own line) fields on `AssignmentQuestion` that 27 + 5 HW1–HW7 problems were migrated
into; the text-annotation and comment tools are GONE; the Argument/Value panel is GONE (with
its Tally/Binary/+ toggle — a sandbox TM's alphabet is now fixed at binary); the turbot Map is
zoomable and sits below the percept/motor glossary; the editor names the open assignment; the
home and assignment-overview pages are flat rather than a card on grey; students get a
per-question **grade sheet** once grades are released. Grading gained three question-level
constraints — `component_limits` (how many of a type, counted through boxed internals),
`maxTapeCells` (the span of tape a run may occupy, `engine/tm.ts tapeCellsUsed`), and
fill-in-the-blank autograding (`engine/fillIn.ts`; HW1 P11 is now 11 numbered boxes graded by
string, leading zeros normalised, with `fill_in_answers` stripped server-side like
`test_cases`). Instructor side gained ↑/↓ **reordering** (`AssignmentData.order` +
`sortAssignments`) and a **Publish/Hide** toggle: every assignment — bundled and seeded
included — is now HIDDEN until published, absent from a student's list, 404 on fetch, and
unopenable by URL. Boxing: the confirmed-box library is now shared across a whole HOMEWORK
rather than per question (`AssignmentState.boxLibrary`, legacy per-question saves merged on
load), and SC canvases can box their COMBINATIONAL sub-circuits — MEM is refused, because a
boxed circuit is evaluated statelessly and a boxed MEM never advances (0101 unboxed vs 0000
boxed; boxScopeCheck pins the evidence). Two items ended differently from the note: the sticky
palette tool was reverted at Paul's request (right-click-to-disarm kept), and boxing a
SEQUENTIAL sub-circuit is explicitly NOT done — it needs nested MEM state threaded through
`evaluateSCSequence`, the codec and the store's SC slice. Gates: app tsc/build/check (now 16
tools — `statementFormatCheck` added; boxScopeCheck 16 → 38, navResetCheck 136 → 139,
pipelineCheck + 18, remoteStoreCheck + 8, serverCheck + 9) and server tsc/check all green,
coverage ledger unchanged at 46 exact + 10 interface, 0 regressed. Earlier 2026-09-02:
**pilot deployment live** — Cloudflare Pages
(`https://making-minds.pages.dev`, direct upload, project `making-minds`) serving a remote-mode
build against the Lightsail API on the placeholder hostname `https://100-22-69-95.sslip.io`.
Three repo changes carried it: `app/vite.config.ts`'s `base` is now
`process.env.VITE_BASE_PATH ?? '/making-minds/'` (GitHub Pages keeps its subpath; Pages builds
pass `/`), `deploy/README.md` §2 records the real values plus the domain-swap procedure, and
`.gitignore` now covers `secrets/` (the Cloudflare token) and `ssh/` (the Lightsail key, which
had been sitting untracked-but-unignored). Verified over the public network: assets at the
root, CORS preflight from the Pages origin, and a full student flow — login → `/api/auth/me`
→ assignment list — with `test_cases` stripped from the student payload. The box was running
`MM_AUTH_MODE=dev` (passwordless) at the time; since 2026-09-11 the default is `password` and
the deploy unit sets it, so what the pilot box still needs is the real roster imported and
HW1–HW7 seeded (it holds only the toy roster + `cc-basics`). Earlier 2026-07-19: **turbot grading pinned trajectory- and orientation-independent** —
audit confirmed the success criteria (`evaluateTurbotCriterion`, engine/turbot.ts) already judge
only positions, per Paul's rule that grading must ignore the path taken and the turbot's facing:
no criterion reads `facing`; `pass-through` needs the goal anywhere in the position trace;
`reach-and-stop` needs a stop on the goal cell; `return-to-start` needs end-at-start (+ the
goal-visit clause in goal-ful arenas). No engine change needed — the property is now pinned by
turbotCheck's new `[trajectory & orientation independence]` section (7 checks): all four final
facings grade equally under reach-and-stop, direct vs roundabout routes to the same rest cell
grade alike, pass-through's mid-trace-crossing vs skipped-goal pair, home-with-a-turned-facing
passes return-to-start, and an end-to-end grader run whose FSM brain spins in place on the goal
before stopping still passes with its final facing ≠ start facing. Same day, **assignment due
dates** — `AssignmentData` gains an optional
`dueDate` (ISO timestamp; display/annotation policy only — late submissions are still accepted
and graded), settable via a datetime-local field in the assignment editor and carried on
`AssignmentSummary` through both backends (local store list, bundled mapping, `api/client.ts`,
and the server's `/api/assignments` summaries; `stripAnswers` spreads it through untouched).
Presentation policy lives in the pure `app/src/dueDates.ts` (`dueStatus` — green >3 days out,
amber <3 days, red overdue; `lateBy` — 0 = on time = NO signal; `formatDuration`): the student
home card shows a colored "Due …" badge (+" · Overdue" once past) and a red "· late by X" beside
its Submitted timestamp when late; the instructor gradebook appends the same late tag to every
submission/attempt timestamp. Pinned by `app/tools/dueDateCheck.ts` (18 checks, in
`npm run check`: the 3-day band incl. the exact-boundary edges, on-time-is-silent, duration
wording). Earlier 2026-07-12: HW1–HW7 shipped as seedable, editable assignments — the seven
real PHIL 133 homeworks now exist as `AssignmentData` JSON (`app/src/devData/homeworks/hw{1..7}.json`,
84 questions total): the 56 machine-buildable problems reuse the reference fixtures' hand-verified
question objects verbatim (same statements/specs/test banks the coverage harness pins), and the 28
prose problems (HW1 functions/representations, the impossibility/reflection paragraphs, HW5
algorithmic-design, HW6 flow-chart/life-cycle, the HW7 final-project essay) are transcribed from
the PDFs as open questions. The PDFs' unnumbered challenge problems are deliberately omitted;
HW4 P1–P2 reference circuit diagrams that exist only in the PDF, so their statements describe the
drawn machines in words and point at the handout. Instructor dashboard gains a local-mode
"Load HW1–HW7" button → `seedHomeworks()` (`devData/homeworks.ts`): FILL-EMPTY per assignment
(existing ids skipped, instructor edits never clobbered — the seeded copies live in the ordinary
instructor store, fully editable), plus 22 sample submissions (3 artificial students per HW —
all-correct with written open answers, fixture-broken, and a half-answering partial; HW1 carries a
two-attempt history) cleared + resubmitted through `localSubmissionStore.submit` on every seed so
the gradebook always shows real autogrades. Verified headlessly: every machine question grades its
fixture's correct circuit through the real `gradeQuestion` (partial scores only where the fixture
bank is the known honest interface-tier attempt: hw2-p15 0/2, hw3-p15 1/3, hw6-p2 1/3), and the
full seed→autograde→reseed flow runs through the real stores (~1.15 MB localStorage). Remaining to
product: deploy, UCLA SSO, and server-side seeding of these homeworks for remote mode. Earlier
same day: **per-question confirmed-box library** — the palette's "Boxes"
section (`confirmedBoxLibrary`) is now scoped PER CANVAS: it swaps alongside `boxes` on every
question/tab navigation and persists as the new optional `confirmedBoxes` field on
`QuestionCircuit`/`WorksheetData` (absent in older saves = none, back-compatible), so a box
confirmed in one CC question no longer appears in other questions or machines — and it now
survives reload/reopen, which the old global in-memory slice never did (it also leaked across
the sandbox↔assignment boundary and between sandbox tabs; both fixed). `removeConfirmedBox`
sweeps only its own canvas (a box's instances can't exist elsewhere anymore), undo/redo
history snapshots include the library, and a confirmed-box change arms the autosave. Pinned
by the new store-level harness `app/tools/boxScopeCheck.ts` (16 checks, in `npm run check`):
confirm-on-Q1 → absent-on-Q2 → restored-with-internals-and-placeable back on Q1, the
goHome/close/reopen persistence round-trip, sandbox-tab isolation, and
removeConfirmedBox + undo semantics. Earlier 2026-07-08: **P6.4 — the Remote-store cutover, S1–S4 COMPLETE** — the frontend
now runs against the API server whenever it is built with `VITE_API_BASE` (remote mode) and
stays byte-identical localStorage-only without it (local mode — still the default, the dev
environment, and what the headless harness drives). The whole switch is ONE decision point:
`storage/backend.ts` exports `backendMode` plus the three store INSTANCES, and nothing else
constructs a store. Per the accepted design memo (`docs/buildout/designs/remote-stores.md`,
async-first won the judge panel 82–72–58), in four slices: **S1** flipped the three storage
seams Promise-returning and migrated every consumer once, compiler-driven — Local impls
async-wrapped with zero logic change, `openAssignment` sequence-guarded (a stale resolve can't
clobber a newer navigation) with flush-on-entry, autosave single-flight with a trailing rerun,
module-init submission hydration replaced by `hydrateSubmissions()` on auth-ready, and one
shared `useAsyncValue` hook (fetch/loading/error/reload) replacing the five views'
render-time reads. **S2** absorbed grade-release into the `AssignmentStore` seam
(`gradeRelease.ts` deleted; key byte-compatible) and closed the server's manual-review GAP:
`POST /api/assignments/:id/submissions/:attempt/review` applies the SAME pure
`applyManualReview` (moved to the leaf `storage/manualReview.ts` so the server imports it like
the grader); serverCheck 35, parityCheck 36 incl. a server≡in-process review pin. **S3**
landed the `Remote{Workbook,Assignment,Submission}Store` as direct `api/client.ts` calls (no
cache layer; 404→seam-null; a grep gate forbids grader imports in remote-store modules —
grading stays where the test cases are) and the full remote auth flow: email login → bearer
token (`mm:auth:token`) → `me()` session restore on mount → any 401 clears to the login screen
via the client's `onUnauthorized` hook; `initRouting()` moved inside AuthGate so deep links
can't fire unauthenticated; `stubAuth.tsx` deleted; bundled assignments are local-mode-only
(the client bundle's answer bank never ships beside sanitized server copies). **S4** added the
resilience layer: `storage/migrateLocal.ts` (first-remote-login **fill-empty** migration of
`mm:asg:*` workbooks + instructor `mm:inst-asg:*` assignments, per-user guard
`mm:migrated:<email>`, server data NEVER overwritten, submissions/release/reviews deliberately
not migrated), `storage/journal.ts` (the per-email crash buffer `mm:journal:<email>:<asgId>` —
written synchronously on unload-time flushes and failed remote saves, cleared by every
confirmed save, REPLAYED by the next `openAssignment`: buffer supersedes the fetched server
copy and re-uploads, so a hard tab kill loses nothing; unload PUTs also go `keepalive`),
`auth/HealthGate.tsx` (remote boot probes `GET /api/health` and shows a friendly auto-retrying
screen while the server is down — no white screen, no silent local fallback; session restore
only runs against a live server, so an outage can't be misread as a dead session), the
autosave indicator's new `'error'` state with exponential backoff retry ("⚠ Not saved —
retrying"), and online-only submit UX (a failed submit alerts and records NOTHING — the server
stamps time, so nothing is silently late; no offline queue by design). `tools/remoteStoreCheck.ts`
grew 31 → **56 pins** (health-probe true/503/dead-port, the migration decision table —
server-null uploads, server-present never touched, guard + guard-less idempotence, student
role never publishes authored assignments — and journal keying/replay/clear semantics), all
in the 12-tool `npm run check` chain. Browser-verified both ways: remote boot with the server
down → retry screen → automatic recovery; an edit made during an outage survives a hard tab
kill via journal replay and lands back on the server; local mode byte-identical with zero
`/api` traffic. Remaining to product: deploy (`deploy/README.md`), UCLA SSO
(server-side `AuthProvider` swap), real HW content. Earlier same day:
**P4.4 — turbot sandbox tab** — the sandbox + menu gains a
"Turbot ›" entry (second menu page picks the CC/SC/FSM/TM brain); the new tab is the full
turbot workspace via the existing selector seams — `SandboxTab` records optionally carry
`innerMode` + their own `arena` (seeded by `sandboxDefaultArena()`, a 10×8 bordered field with
one goal), and `selectTurbotInnerMode`/`selectTurbotArena` fall back to the active sandbox tab
when no assignment is open, so the palette/grammar/Map/tape-panel/glossary all follow with NO
new UI branches. The Map gains a sandbox-only **"Edit map"** mode (reuses
`instructor/arenaEditing.ts` block/goal/erase/start tools + resize through the new
`setTabArena` action, which turbotResets). Tabs persist through the sandbox autosave and
workbook export/import (`WorksheetData.innerMode`/`arena`). Also fixed in passing: active-tab
`removeTab` now swaps in the survivor's `buildMode`/`activeTask` with its canvas (previously
the removed tab's mode leaked, e.g. a CC sheet kept rendering the turbot workspace).
navResetCheck grew a sandbox-turbot section (117 checks): tab seeding, selector fallback,
run/switch/re-enter reset semantics, and the removeTab mode-swap pin. Earlier same day:
**P1.8 S4 (re-scoped) — router fallback phase-0 + route-quality
flags** — `routeAllWires` now routes structurally-doomed wires (a stub tip buried in a FOREIGN
component's bounds: every incident edge blocked) via the fallback L-path in a **phase-0 pass
before any A\* search**, so later wires see those lanes as occupied tracks (iteration-exhaustion
fallbacks stay in the main loop with the H1 validation rounds as their interaction net; doomed
wires are skipped by validation reroutes — they can only re-fail identically). Route corpus
byte-identical across all 62 CC/SC fixture machines. `WireRouteResult` gains warn-don't-block
quality flags — `usedFallback` (final route is the L-path) and `violation` (a final READ-ONLY
oracle-predicate sweep: the router's own near-overlap + rendered-body predicates, mirroring
layoutCheck's, since src/ can't import tools/) — surfaced unobtrusively in `CircuitCanvas`:
hover tooltip for either flag, faint dashed amber halo only on `violation` (wire color stays
semantic black/red). routerCheck adds flag pins (hw3-p9's residual w21 = usedFallback + NO
violation — the recorded rationale for skipping the S4 lane-nudge; a doomed tripwire carries
both flags and falls back exactly once) and a **pre-fix layout regression pin**: the P1.3-era
hw3-p4 positions (git 0d0c5e5; 4 collinear pairs pre-P1.8, dodged then by repositioning) must
route oracle-clean under today's router — fallbacks allowed, violations not. Earlier same day:
**buildout close-out, iterations 27–29** — three wrap-up passes on
branch `buildout-infra`. **Iteration 27, the smalls sweep** (six fixes, one batch, each replacing
a duplication with a shared owner): `engine/cc.ts` now has ONE `sortByLabel` for both the
top-level and boxed-internal I/O ordering paths (P1.6); the A/V **ARG column renders per-group
values** in question mode ("2, 3", not one interleaved numeral — pure builders in
`components/outputDisplay.ts` reusing the codec's own value parse; invalid numerals still '/';
P1.11); `componentGeometry` gained **`getLabelAnchor`** (rotation-aware, snapped 90° — rotated-MEM
labels no longer bisected by the M_IN wire; P1.16) and **`getComponentBounds`** (the full obstacle
footprint — body + adjuncts like INPUT's 14×20 toggle-tab — replacing wireRouter's local
body-only copy, so toggle-tabs are now router obstacles; the last P1.8-S3 leftover); the
instructor **arena editor cap rose 20→30** (`MAX_ARENA_SIZE`, scroll-aware — the Desert Ant's
30×30 arena is now authorable in the UI; P5.2); and **every failing turbot case now carries a
criterion-named reason** (`explainTurbotCriterionFailure` beside `evaluateTurbotCriterion`, e.g.
"'return-to-start' criterion not satisfied: goal cell never visited"; pinned per criterion in
turbotCheck; P5.3). **Iteration 28, P6.1 full-matrix appearance sweep:** all modes validated
against VISUAL_VOCAB (CC/SC/FSM/TM, all four turbot inner modes, both perception types, open
question, sandbox tabs), plus three polish fixes: **`selectLiveFsmStateId`** (one selector owns
the canvas live-state highlight — FSM sim and turbot arena stepping both feed it, leak-free
across navigation), the turbot palette header names the inner machine, and the arena Map
auto-scrolls to follow the turbot (wheel guard). One open sub-item: arena turbot red vs
VISUAL_VOCAB yellow — Gabriel's call. **Iteration 29, final reconciliation (META-audit + P6.2):**
all gates fresh by exit code (app tsc/check/build, server typecheck/check), coverage ledger
**56/56 at-tier re-confirmed row-by-row by script** (46 exact + 10 interface, 0 regressed,
0 warnings), docs reconciled; remaining buildout queue is EXACTLY P6.1b/P6.3/P6.4
(Gabriel-gated) + optionals. Earlier 2026-07-07: **P1.5 — `allowed_components` enforced end-to-end** — the
question-level component restriction (optional on `AssignmentQuestion`) now has ONE semantics,
owned by `engine/machineValidation.ts` (`validateAllowedComponents` + palette predicate
`isComponentTypeAllowed`): absent/empty = unrestricted (back-compat); present = only the listed
types plus always-allowed infrastructure (INPUT/OUTPUT — the I/O interface; STATE — the whole
FSM/TM vocabulary, since the restriction targets the CC/SC gate vocabulary); BOXED is packaging,
recursed into, so a boxed OR can't smuggle an OR into hw1-p2 ("reconstruct OR without OR").
Enforced at all three touchpoints: (1) grading — Stage 1 in every grader branch
(`gradeQuestion`/`gradeTurbot`/`gradePerception`, mirrored by coverageCheck's `validateStage1`);
a violating machine fails every case with the offending type(s) named; (2) student UI — the
palette (`ComponentLibrary`, via the store's `selectAllowedComponents`) hides disallowed gates
and any library box whose internals contain one; (3) authoring — `QuestionCreator` gains a
"Restrict available components" toggle + AND/OR/NOT/MEM checkboxes for gate-vocabulary questions
(CC/SC incl. perception, turbot CC/SC brains), round-tripping through save/load. Six new
coverageCheck self-test pins (correct-function OR machine fails hw1-p2 0/4 · absent field
permissive · DeMorgan still passes · boxed smuggling caught · palette predicate ·
interface-tier mirror); harness unchanged at 46 exact · 10 interface · 0 regressed; spec §1.5
records the semantics. This closes the LAST deferred authoring follow-up. Earlier same day:
**coverage buildout COMPLETE at-tier: 56/56** — the Desert Ant
capstone (hw6-p2) landed as the final reference fixture: 3× 30×30 walled arenas (food varied
in the NE quadrant), return-to-start with goal = food, and a 20-state turbot-TM
diagonal-staircase forager with exact dead-reckoned return (tape span ≤20; honest score 1/3,
reported not asserted). The reference-fixture ledger now covers every machine-buildable
problem in HW1–HW6: 46 rows exact-verified (correct passes every case, broken fails) + 10
navigation/capstone rows interface-verified (plausible attempt validates + grades end-to-end).
Close-out items remain queued in docs/buildout/QUEUE.md (allowed_components enforcement was the
one open grading-integrity gap — closed later the same day by P1.5, above). Earlier same day, **turbot navigation: nine reference questions + the step-limit/criterion
fix** — the buildout landed interface-tier reference fixtures for every HW2/HW3/HW4 navigation
problem (arena families transcribed from the PDFs; plausible CC/SC/FSM brains with honest
reported scores), which exposed and fixed a real grading defect: `gradeTurbotCase` failed any
step-limited run BEFORE consulting the criterion, making pass-through questions (HW2 §III's
Pac-Man rule — crossing the goal completes navigation, no stop needed) unpassable for
memoryless CC brains. New engine seam `criterionRequiresStop(criterion)` (engine/turbot.ts,
beside evaluateTurbotCriterion): pass-through is judged on the trace with the step limit
bounding only the simulation; reach-and-stop / return-to-start keep exact prior behavior.
Honest reasons name the unsatisfied criterion, spec §12.5 records the rule, turbotCheck gains
a 7-pin [pass-through step-limit] section, and `TurbotCaseResult.pass === true` with
`hitStepLimit === true` is now a legitimate shape (UI note: render as "simulated full budget",
not an error). Coverage ledger: 46 exact + 9 interface = 55/56 at-tier; only the HW6 Desert
Ant capstone remains. Earlier same day, **sim-state reset extended to every sandbox canvas swap** — the
sandbox had the same leak class the question-navigation fix (below) closed: `switchTab`
swapped the canvas but reset no transient sim state, so one tab's SC/FSM/TM run or turbot
pose rendered against the next tab's circuit. Every sandbox/workbook canvas swap now calls
`resetAllSimState()` too — `enterSandbox`, `addTab`, `switchTab`, `removeTab`'s
active-tab-change branch (removing a background tab deliberately leaves the live run
untouched — the visible canvas doesn't change), `newWorkbook` (also covers enterSandbox's
empty-tabs fallback), and both `importWorkbook` format branches — so ANY canvas entry hands
back a fresh machine at t=1. `navResetCheck.ts` grew a sandbox section: **86 checks** total
(42 assignment-nav + 44 sandbox; the sandbox half fails 28 without its fix), including a pin
on the background-tab-removal asymmetry. Also: `vite.config.ts` honors an assigned `PORT`
env var (parallel sessions' dev servers collide on 5173; default unchanged). Earlier same
day, **router world model unified with the layout oracle (P1.8 S3)** —
`wireRouter.ts` now grants every wire an **own-endpoint exemption**: grid edges carry
`blockedBy` component attribution, and edges incident to a wire's stub-tip nodes ignore the
wire's OWN source/target bounds — exactly the oracle's own-stub exemption. This erases the
structural XOR fallback floor (the curved-face left-port inset put XOR stub tips inside their
own expanded bounds, so every XOR-in wire was born A*-unreachable and burned 3 fallbacks).
The H2 revalidation gained the same exemption (previously EVERY wire's stub crossed its own
margin sliver, so each validation round silently rerouted the entire circuit — routing is now
~3× faster), H1 adopted the oracle's rules (near-parallel <3px counts as overlap;
same-source fan-out trunk sharing exempt), the A* cost model repels near-parallel foreign
tracks (per-search interval index) and weights bump-undrawable crossings 10× (crossings the
canvas can't arc within CROSSING_BUMP_RADIUS of a horizontal segment's end), a new **H4**
validation round catches bumpless crossings on the final simplified paths and feeds the exact
conflict points back into the re-route as overlap-priced avoid points (rip-up-and-reroute
memory — the edge-local cost model is blind to crossings at grid-line intersections), and the
A* iteration cap now scales with grid size (a flat 5000 silently doomed honest long paths on
the ~30k-node HW3 fixtures). Net: fallback budget **147 → 2** (hw3-p9's w21, a genuinely
cramped goal approach, deliberately pinned; `getFallbackWireIds()` names offenders in check
output), all CC/SC reference fixtures oracle-clean AND bump-clean — including the 8 fixtures
whose bumpless crossings predate this work — `bumpCheck` grew a no-arg all-CC/SC sweep mode
and joined `npm run check`, and routerCheck pins XOR-in reachability beside MEM.min.
Remaining S3 leftover, enqueued: INPUT toggle-tab obstacles. Earlier same day,
**P4.2 — multi-arena navigation grading with teeth** — a turbot
question's `turbot_cases` arena FAMILY now genuinely discriminates: aggregation was already
all-or-nothing (`gradeTurbot` grades every case; a question passes iff passed === total in
`summarizeResult` and the gradebook's `toQuestionGrade`; GradebookView lists every failing
arena by 1-based index), but the spec-letter `return-to-start` criterion checked ONLY the
final position, so a Mad-Max-style family (hw3-p15: block at unknown distance, drive to it,
come home) was vacuously passable — a stop-immediately brain, or any fixed out-and-back,
passed every arena (proved headlessly before the fix). `evaluateTurbotCriterion` now adds a
goal-visit clause: when the arena declares a goal cell (the "out there" checkpoint, e.g. the
cell before Mad Max's block), return-to-start also requires the position trace to visit it;
goal-less arenas keep plain end-at-start, goal-on-start degenerates gracefully (mirrors
pass-through). Spec §12.5 records the rule; the question creator's criterion hint states it.
Exhibit (pinned in turbotCheck's new `[multi-arena]` section, 12 checks): a hardcoded
out-2-back-2 FSM passes the 1-arena family but fails the 3-arena family 1/3, out-4-back-4
gets 2/3 ≠ pass, the 3-state sensor-reactive Mad Max FSM passes 3/3, the lazy stop-now brain
0/3; two headless Gradebook-logic pins. Earlier same day,
**buildout-infra merged into main** — the fixture build-out
branch (21 loop iterations, previously never merged back) landed on main: the two-tier
reference-fixture coverage harness (`coverageCheck.ts` + hand-verified fixtures under
`app/tools/fixtures/reference/`; ledger **46/56 at the exact tier** — all HW1–HW5 arithmetic
AND all five perception problems; the 10 open rows are navigation/capstone at tier
`interface` per the 2026-07-06 scope shift); the transition-label **syntax seam**
`engine/notation.ts` (k-bit FSM symbols, the TM **two-output** label `read:write,move` — a
deliberate textbook departure, legacy `1:0R` stays a parse alias — and the turbot-FSM 1-bit
alias grammar, all behind `TransitionNotation`; label dissection outside the seam is banned
by notationCheck's grep gate); the canonical SC/FSM codec run window (grading-fairness fix,
pinned by `scWindowCheck.ts`); `requireStandardHaltPosition` wired end-to-end plus per-case
TM block-separation variation; shared component geometry (`componentGeometry.ts`) + the
cost-based A* orthogonal wire router (`wireRouter.ts`, divergence dots; `routerCheck`/
`layoutCheck`/`bumpCheck` — bumpCheck deliberately NOT a gate yet, and routerCheck's fallback
budget deliberately repinned 99 → 147 for hw3-p11's structural XOR floor of 48); separate
opposite-direction FSM transition arcs; and the build-out loop infrastructure
(`docs/buildout/` memos — HANDOFF/QUEUE/LOG/COVERAGE + design memos — and the `/handoff`
command). The branch's 2026-07-06 TM-reset-on-navigation store change (0ca35b3) is subsumed
by the same-day `resetAllSimState()` below — navResetCheck still pins the behavior.
`buildout-infra` stayed alive as the loop's working branch (merging main each iteration) until
its retirement on 2026-09-21 (top of this log); its in-flight wireRouter S3 work was NOT part of
this merge. Earlier same day,
**sim-state reset on question navigation** — every question
navigation path (`switchQuestion`, `openAssignment`, `loadAssignment`) now calls the new
aggregate store action `resetAllSimState()` — which delegates to the per-mode global resets
(`scGlobalReset`/`fsmGlobalReset`/`tmGlobalReset`/`turbotReset`) so each slice's field list
lives in one place — replacing the bare `tmGlobalReset()` + `turbotReset()` pair. Previously
a run from one question leaked into the next: SC typed input rows, OUT strings, ARG/VAL
decodes and the full Sequential Timeline (`scGlobalSequences`/`scHistory`/`scTimeStep`/
`scInputSequence`), the I/O `tableRows`, and FSM run state (on main, which never received
this branch's 0ca35b3 TM-reset fix, the TM tape leaked too). Question entry now hands back
a fresh machine at t=1: MEM re-zeroed, input values cleared, circuit structure untouched.
Pinned by the new committed store-level harness `app/tools/navResetCheck.ts` (42 checks;
15 fail without the fix). Earlier same day, **merge #3: server groundwork + grade release + manual grading**
— merged main's PR #15 (API server + typed client + deploy recipes), PR #14 (instructor manual
grading of open questions), and the grade-release gate. All three compose cleanly with the
branch: the server/client sit BEHIND the existing seams (`api/client.ts` is deliberately
unwired; the server grades with the SAME pure `engine/grader.ts`), grade release is display
POLICY outside the grading pipeline (submissions still autograde on receipt — pipelineCheck/
coverageCheck read autogrades directly and are unaffected), and manual review ANNOTATES the
pending result (status stays `'pending'`, 0/0 — the open-question contract the coverage
self-test pins holds unchanged). Since merge #2 the branch also promoted all five perception
fixtures to the exact tier (hw2-p10..p12, hw3-p11/p12 — ledger 46/56), added
`tools/bumpCheck.ts` (headless bump-renderability predicate; not in `npm run check`), and
deliberately repinned routerCheck's fallback budget 99 → 147 (hw3-p11's structural XOR floor
of 48; see the tool header). Main's entries follow. From origin/main: **grade release** — students see NO grades (not even on submit)
until the instructor releases them per assignment. Server: `grades_released` column beside the
assignment row (policy, not content — never inside the AssignmentData JSON), new instructor
endpoint `PUT /api/assignments/:id/grades-release` `{released: boolean}` (idempotent;
unrelease re-hides), `gradesReleased` on assignment list/detail responses, and
`studentRecord(record, released)` in `server/src/sanitize.ts` now withholds the result
entirely until release (after release: scores only, still no per-case detail). Instructors
always see everything immediately. serverCheck grew to 28 checks covering the full lifecycle
(hidden on submit → 403 for student release → release → student sees scores → unrelease
re-hides). Local prototype mirrors the rule behind a seam (originally
`app/src/storage/gradeRelease.ts`; since remote-stores S2 (2026-07-08) the flag lives ON the
`AssignmentStore` seam — `getGradesReleased`/`setGradesReleased` + `gradesReleased` on
list/get, with `mm:release:` as the local impl's private key — and gradeRelease.ts is
deleted): the student submit alert no longer shows the autograde, the home screen
shows "Grade: n/m questions" beside a submitted assignment only once released, and the
instructor gradebook header gets a "Release grades"/"Hide grades" toggle (with confirm).
API client: `setGradesReleased`, `gradesReleased` on summaries/detail. Earlier same day,
**server groundwork** — a complete API server package (`server/`,
Express 5 + Node's built-in `node:sqlite`, zero native deps) implementing the whole backend
seam set ahead of AWS access: dev auth (roster-email → bearer token; `AuthProvider` interface
in `server/src/auth.ts` is where UCLA SSO plugs in via `MM_AUTH_MODE=sso`), assignment CRUD
(instructor-gated), per-student workbook GET/PUT, and the submission endpoint — the server
stamps identity/timestamp, grades on receipt with the SAME pure `app/src/engine/grader.ts` the
browser uses (imported directly across packages), and persists the record. Redaction lives
server-side (`server/src/sanitize.ts`): students get assignments without `test_cases` and
results without per-case detail; instructors get everything. Storage is one SQLite file
(users/sessions/assignments/workbooks/submissions; WAL). `npm run seed [-- --sample]` loads
the toy roster + cc-basics (+ the sample assignment with graded demo submissions);
`npm run check` (`server/tools/serverCheck.ts`) boots the real app on an ephemeral port
against an in-memory DB and drives the full student→instructor flow over HTTP — 22 checks,
all passing (incl. post-merge with perception/open questions). Browser half:
`app/src/api/client.ts`, a typed function per endpoint ready to back future `Remote*` stores
(nothing imports it yet — the app still runs on the Local* stores; the cutover needs the
store seams to go async). Deployment is copy/paste-ready in `deploy/` (Lightsail setup
README, systemd unit, Caddyfile for TLS; Cloudflare Pages settings incl. `VITE_API_BASE`).
Same day, **manual grading for open questions** — the instructor can now
record a verdict on a pending open question from the gradebook drill-down: ✓ Correct / ✗
Incorrect buttons + an optional feedback note next to the displayed response. The verdict is a
`ManualReview` (`{pass, note?, reviewedAt}`, new in `types.ts`) stored as `manual` on the
record's pending `QuestionResult` — the result **stays `'pending'`** (annotated, not replaced,
so it's re-reviewable and distinguishable from an autograde; a future LLM pass could write the
same shape). Persistence goes through the submission seam: new
`SubmissionStore.recordManualReview(id, attempt, questionId, {pass, note})` backed by the pure
`applyManualReview(records, …)` helper in `submissionStore.ts` (returns a new array; rejects
non-pending questions and unknown attempts). Once reviewed, the gradebook counts the question
like any other: `toQuestionGrade` maps the verdict to passed/pending, so it enters the score
(the score is now over autogradeable + reviewed questions; unreviewed stay excluded), the ✎
mark becomes ✓/✗ (tooltip "manually graded"), and the open question's stat tile shows "✎ n to
review" until every latest attempt is reviewed, then its manual pass rate. Legacy records with
no stored result stay display-only. `pipelineCheck` grew a [manual review] section (7 checks).
Earlier same day, **merge #2: perception questions (CC + SC)** — merged main's PR #12: the perception homeworks are
now authorable and autogradable: a CC/SC question can be a **Perception** task (question
creator's new "Task" toggle) whose machine reads its inputs as an array of stimulations (a
retina) and outputs one classification bit. Grading is **bit-level, outside the value codec**
(new `engine/perception.ts` + `gradePerception` branch in `grader.ts`): cases carry raw
`frames` (bit-vectors, IN1 first; an SC case is one frame per clock tick) and the `expected`
output bit per step, generated at save from an authored `PerceptionRule` — CC rules `min-run`
(≥k consecutive 1s, "edge detector"), `exact-run` (a maximal run of exactly k, "object
detector"), `pattern` (input = an exact bit string, "landmark recognition"; width = pattern
length); SC rules `change` (current frame ≠ previous frame) and `motion` (an exactly-k object
image moving **up** — toward IN1 — 1 unit per tick). CC banks enumerate all 2^width frames
(width capped at 10); SC banks are a fixed deterministic battery of frame sequences (climbs,
drifts, statics, jumps, noise, random streams). SC timing convention: the "previous input"
before the first frame is the all-zero frame — exactly what fresh MEM blocks hold. New types
(`PerceptionRule`/`PerceptionSpec`/`PerceptionTestCase`/`PerceptionCaseResult`,
`perception`/`perception_cases` on `AssignmentQuestion`, `perceptionCases` on
`QuestionResult`); structural Stage 1 = width input wires + 1 output wire; a case passes iff
every step matches. Students need **zero new UI** — a perception question opens the ordinary
CC/SC canvas (mode chips read "CC - perception"); the gradebook drill-down shows failed
stimuli (frames → expected/got bit strings + first wrong step). Sample assignment grew to 13
questions (Q9–Q13 = the five textbook perception problems) with correct/incorrect sample
circuits built by a small netlist builder in `sampleData.ts` (the motion detector is ~80
gates); new `tools/perceptionCheck.ts` (44 checks) and `pipelineCheck` now 13/13 vs 0/13.
Merged with the same-day open-questions work: sample ids are machine Q1–Q8, perception
Q9–Q13, open Q14.
Merge-2 notes: `perceptionCheck` is now wired into `npm run check`, and the coverage
harness's Stage-1 mirror (`validateStage1` in tools/coverageCheck.ts) was brought back to
parity with `gradeQuestion`'s full dispatch — open questions short-circuit (no Stage 1),
perception validates the retina interface via `validatePerceptionMachine`, and turbot
validation is notation-aware (`validateTurbotTM(…, notation)` / `validateTurbotFSM`).
Earlier same day, **merge: buildout-infra × origin/main** — combined the build-out
branch's P2/P1.8 work with main's two PRs (open questions; turbot encoding/glossary + FSM/SC
turbot grading). Both sides had independently implemented turbot-FSM 2-bit motors; the
notation-seam implementation won: `turbotFsmNotation` (engine/notation.ts) remains the single
validity answer for turbot-FSM brain labels (legacy 1-bit outputs stay valid as aliases), main's
`validateTurbotFSM` now DELEGATES to the generic `validateTransitionTable` walker over it (its
local `parseTurbotFSMLabel` regex is gone), and main's encoding-awareness landed on the seam:
`turbotInternalNotation(tapeNotation)` is a memoized function whose alphabet/tokens come from
`turbotTMReadSymbols`, so editor, validator, engine, and grader share one per-encoding answer.
Both sides' entries follow. From origin/main: **open questions** — a sixth question mode, `buildMode: 'open'`,
for free-text answers that cannot be autograded: the student workspace swaps the canvas for a
writing panel (`OpenResponsePanel`; copy/cut/paste/drop are blocked in the textarea to
discourage pasting in prepared text — a soft deterrent, not a security boundary) with the same
chrome/nav/autosave/Submit as machine questions; the answer lives as `responseText` on
`QuestionCircuit` (mirrored by the store's `openResponse` at every canvas sync point) and on
the submission's answer; the grader returns a new `QuestionResult` status `'pending'`
("open question — needs manual review") carrying the `response`, contributing 0/0 to tallies —
designed so a future LLM-grading pass can consume the same field and replace the pending
result (not implemented). The question creator gains an 'Open' mode (name + statement only);
the gradebook marks open questions ✎ (excluded from the auto score — `SubmissionGrade.score`
is now over autogradeable questions only), shows a "manual review" stat tile instead of a pass
rate, and the attempt drill-down displays the full response; the grading CLI prints a word
count. A sample open question (the binary-vs-tally design question, now Q14) + sample
responses; `pipelineCheck` asserts the pending path. Verified: tsc/build clean, all tool
checks pass, and a store-level Node harness drove the open-question student flow (type →
switch → reload → submit → pending result). Earlier same day: **sample turbot questions for
all four inner modes** — the seeded
sample assignment now has eight questions: CC/SC/FSM/TM plus one turbot question per inner
mode (Q5 CC corridor, Q6 SC 3×3 L-course needing a MEM turner, Q7 FSM corridor, Q8 TM textbook
walker on a tally/unary question), each with correct/incorrect sample brains wired into the
sample submissions and `pipelineCheck` (now 8/8 vs 0/8); mode chips in the student question
list and the instructor assignment editor now name a turbot question's inner machine
("turbot - TM") via the new `questionModeLabel` helper in `types.ts`. Also: **turbotCheck FSM/SC coverage** — the turbot smoke test now
grades questions in all four inner modes: new FSM- and SC-brained graded questions beside the
existing TM and CC ones, plus first engine coverage for SC brains — a MEM-latching turner that
threads a 3×3 L-course (forward → turn left at the first wall → stop at the second), proving
brain state carries across arena cycles. Same day, **turbot-FSM 2-bit motors** — an FSM-brained turbot's Mealy
transitions now output the full 2-bit motor code (`in:ij`, e.g. `0:11`, `1:01` — same
wheel-motor encoding as CC/SC output wires), so FSM brains can issue every movement command,
turns included, closing the old stop/forward-only limitation. Post-merge this rides the
notation seam: `validateTurbotFSM` (`engine/turbot.ts`, used by `gradeTurbot`'s Stage 1;
every state must handle both sensor inputs exactly once) delegates to the generic
`validateTransitionTable` walker over `turbotFsmNotation`, `runBrainStep`'s FSM branch
executes via `evaluateFSMSymbolStep` under the same notation (so legacy 1-bit labels stay
valid as aliases), and the notation-driven transition editor picks up the two motor bits
from `turbotFsmNotation.outputFields` (new turbot-FSM default label `0:11`); the glossary's
CC/SC/FSM rows merged into one motor-code table. Same day, **turbot encoding + glossary polish** — turbot questions now carry an
authored **encoding** (binary | unary; the question creator's "Encoding" toggle, stored as the
question's `representation`, no longer hardcoded to 'tally'): it picks a turbot-TM brain's
internal tape alphabet (binary {0,1,*}, unary {0,1}) everywhere — the transition editor's token
sets (no `*` enterable under unary; post-merge via `turbotInternalNotation(tapeNotation)`, now a
memoized function on the notation seam), the glossary, `validateTurbotTM`/`parseTurbotInternalLabel`/
`runBrainStep`/`runTurbot` (new `TMNotation` param, default binary), the store's live stepping,
and grading (`gradeTurbot` maps `representation` → notation; a `*`-using table fails Stage 1 on a
unary question — `turbotCheck` covers this). The Map glossary sits **level with the Map** when
the data panel is wide enough and wraps below it when not (`.turbot-map-row` flex-wrap), and its
output lines now name **motor states**, not movements: circuit brains "00 = both motors off /
01 = right motor on / 10 = left motor on / 11 = both motors on"), and
the turbot-TM arrows are glossed as ↑ = both motors on, ↱ = left motor on, ↰ = right motor on.
The engine's `TURBOT_TM_READ_SYMBOLS`/`TURBOT_TM_INTERNAL_ACTIONS` constants became the
notation-aware `turbotTMReadSymbols`/`turbotTMInternalActions`. Earlier 2026-07-05: a From buildout-infra: **TM sim-state reset on question nav** — navigating between assignment
questions (`switchQuestion`, `openAssignment`, `loadAssignment`) now calls `tmGlobalReset()`
alongside the existing `turbotReset()`, so the TM tape, head, step counter `t`, run history, and
current state no longer leak from one TM question into the next; verified by a two-TM-question
store harness (fails 14 checks without the fix, all pass with it). Earlier same day: **P2.3 — standard-halt-position toggle wired end-to-end** —
`requireStandardHaltPosition` is now an optional field on `AssignmentQuestion`; the grader's
tape branch passes it into `acceptTM` (absent/false = position-agnostic, unchanged), and the
question creator exposes it as a TM-only checkbox that round-trips through save/load. HW5
fixtures p1–p8 — whose statements promise standard-position halting — are flagged (p9's does
not); all stay verified, and hw5-p8's broken variant now fails 16/16 (was 15/16: one case
slipped through only because position was unenforced). tmCheck pins the flag end-to-end
through `gradeQuestion` (off-position machine passes without the flag, fails every case with
it; a standard-position machine passes with it). Earlier same day: **P2.1 — TM two-output
notation** — TM transition labels moved
off the textbook's dual-action token (`1:0R`) to the industry-standard **two-output form**
`read:write,move` (stored `1:0,R`; canvas renders read │ write,move with the comma shown;
the label editor presents one input field + two output fields (write, move); the machine
table gains separate WRITE/MOVE columns; history shows `1,R`) — the platform's ONE
deliberate departure from the textbook, recorded in spec §10.3 and VISUAL_VOCAB §TM. The
grammar now lives natively in `engine/notation.ts` (`tmNotation(rep)` — replacing the
delegating `tmDualNotation` adapter; alphabet still representation-tied, `*` only on
binary); the legacy dual-action spelling parses FOREVER as an alias and decays to canonical
on any edit-save, so old localStorage machines keep working with no migration (devData's TM
sample migrated to canonical anyway). `parseTMTransition`/`parseTMAction` are gone from
`engine/tm.ts` — the engine parses through the seam — and `validateTMTable` folded onto the
generic `validateTransitionTable` walker (which now carries a `kind`:
unparseable/ambiguous/missing), preserving its error shape. Engine SEMANTICS are unchanged:
every transition still writes and moves as one atomic step. notationCheck pins the new
grammar (canonical corpus, alias≡canonical, decay, `*` binary-only, outputFields contract)
and its grep gate no longer whitelists tm.ts; tmCheck gained legacy-alias engine-equivalence
pins. Earlier same day: **FSM arc-rendering fix** — opposite-direction transition
pairs (S₀→S₁ and S₁→S₀) now auto-offset into two separated arcs (each bows left of its
own travel direction, distance-scaled); previously both curves computed to the same
control point and rendered coincident with superimposed labels. Explicit `fsmControlPt`
still wins; self-loop fanning and same-direction parallel stacking unchanged. Earlier
same day: **Transition-notation seam + k-bit FSM (P1.12)** — new
framework-agnostic `engine/notation.ts` owns transition-label SYNTAX for all four grammars
(FSM, base-TM, turbot-TM internal/external) behind one `TransitionNotation`
interface: parse / canonical format / input alphabet / editor token fields / default label.
FSM is k-bit capable — `fsmNotation(inBits, outBits)`, symbol char i = cc_spec group i — so
multi-input FSM questions (hw4-p11 `x+y`) now validate (totality over all 2^kIn symbols,
kIn ≤ 3), grade (the grader feeds the FULL encoded row per step, not wire 0), and run in the
UI (question runs join the row into one k-char symbol; the label editor enters symbols one
character at a time for every grammar). TM/turbot parsers are unchanged behind delegating
adapters; `turbotFsmNotation` is the single validity answer for turbot-FSM brain labels
(legacy 1-bit outputs alias to the canonical 2-bit motor form and decay on edit-save;
`runBrainStep` decodes both identically). Also folded in **P1.10**: the sandbox FSM feed now
consumes typed input rightmost-char-first (t1), matching SC. `tools/notationCheck.ts` (in
`npm run check`) pins adapter≡parser equivalence, legacy byte-compat, an asymmetric `x + 2*y`
bit-order grade, and a grep gate keeping label dissection inside the seam. Earlier same day:
**SC/FSM question runs mirror the grader exactly — window AND content** — inside an assignment question, Run/Step execute exactly the grader's `stepCountFor`
window and feed exactly the grader's input stream: the typed global input is parsed as a
**value** per input group (exactly how the A/V ARG column reads it — tally "11" = 2, binary
"110" = 6) and laid on the time axis by the codec's `encodeInput` (LSB at t1, so a tally
value's ones arrive LAST, zeros leading) in `scStep`/`fsmStep` via the store's
`selectCodecLayout`; the SC A/V numeral decodes only the grader's window per output group
(`timeOutputBits`). What the student types is the value the grader tests, and UI verdicts
match grades in **both representations**. Note this changes FSM question-run typed input: it
is now read as a **numeral** (MSB-left, "110" = 6) like SC and the ARG column — previously it
was fed t1-first raw; sandbox FSM is unchanged. The FSM Input/Output row's OUT display now
also renders t1-rightmost (time flows right-to-left, matching SC) via the pure builder
`components/outputDisplay.ts`, so a passing identity's OUT reads as the same numeral as its
typed IN. A typed string that is not a valid numeral for the
representation (tally "101") denotes no value: the run falls back to the raw typed bits and
the ARG column flags it '/'; values wider than a group clamp/mask via `valueToBits` as
everywhere else. Sandbox behavior is unchanged (raw typed bits; SC: L + one 0-drain step per
MEM; FSM: L). Pinned by `tools/scWindowCheck.ts` (grader + real-store headless runs, incl. the
real hw3-p7 tally fixture's correct machine), part of `npm run check`. Earlier 2026-07-05: a
percept/motor **glossary** under the Map — TM brains list the
internal/external vocabularies (B/E/F → ↑/↱/↰; 0/1/* → write/move), circuit brains the 1-bit
sensor and motor codes — and the question creator's Save/Cancel now also appear at the top of
the form. Same day, **turbot TM + Map relocation** — the TM-brained turbot is now the
textbook's real model ("Turbots: Operation"), replacing the earlier placeholder that reused the
base dual-action TM engine: STATE nodes carry a `stateKind` (internal = circle, external =
square; toolbar "In/External" toggle), internal transitions read the private {0,1,*} tape and
perform ONE single action (write a symbol OR move L/R), external transitions sense the cell
ahead as B (block/boundary) / E (empty) / F (food — passable, and F IS the goal cell) and move
forward (↑) or turn (↱/↰); every transition is one time step, turbots start on a blank tape
(shown read-only below the canvas via `TurbotTapePanel`), and halting is the turbot TM's stop —
`reach-and-stop` accepts a TM that halts on the goal (`TurbotRunResult.stopped`). Turbot-TM
tables get their own validator (`validateTurbotTM`, per-state-kind grammar) and the transition
editor/label store enforce the per-kind grammars. The student Map moved from above the canvas
into the right data panel (below the question statement, above the machine/history tables).
`TurbotHistoryEntry` is now kind/input/action (internal rows dimmed in the history table).
Earlier same day: **turbots, end to end** — the full Phase 4 feature block in five
staged commits: (1) pure `engine/turbot.ts` (arena driver loop around the existing CC/SC/FSM/TM
single-step evaluators — sense → one brain cycle → apply motor command → record history, halting
on motor "00", a halted FSM/TM brain, or the step limit) + the grader's `gradeTurbot` branch
(arena success criteria: reach-and-stop / pass-through / return-to-start) + new types
(`ArenaConfig`, `TurbotState`, `TurbotHistoryEntry`, `TurbotTestCase`, `TurbotCaseResult`,
`innerMode`/`turbot_cases` on `AssignmentQuestion`); (2) the store's turbot sim slice
(`turbotStep/Run/Pause/Reset`, pose + brain state + history), with reset wired into question
load/switch; (3) the student workspace — `TurbotArenaPanel` (Map grid + Step/Run/Pause/Reset +
cycle/sensor/motor readout) mounted above the normal canvas, `selectEffectiveMode` so a turbot
question's canvas edits its `innerMode` brain (palette, transition grammar, STATE interactions,
toolbar reset all follow it), and a DataTable turbot branch (machine table for FSM/TM brains +
movement history); (4) instructor authoring — 'Turbot' mode in `QuestionCreator` with an
inner-machine picker, clickable arena editor (blocks/goals/start+facing, resizable ≤30×30),
criterion + max-steps; gradebook drill-down shows per-arena steps/final-pose/reason; (5) sample
Q5 turbot question + correct/incorrect sample brains; `pipelineCheck` now covers all five modes.
Verified: tsc/build clean; `turbotCheck`/`tmCheck`/`codecCheck`/`pipelineCheck` all pass; a
store-level Node harness drove the full student flow (open → switch to turbot question → build
brain → step to goal → halt/reset/switch semantics). Earlier 2026-07-04: UI/UX batch —
FSM/TM connection rework, TM alphabet tied to representation, gradebook by student, single
target function; see git history)_

