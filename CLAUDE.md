# Making Minds — Project Guide

This file is read automatically at the start of every session. It has two parts:
**Part 1 — Project Status** (an overview of what's done and what's left, for humans and
Claude) and **Part 2 — Technical Reference** (architecture, key files, and design rules for
Claude to load into context).

> **Maintenance — keep this file current.** Whenever you finish a task that changes what is
> built, how it works, or what comes next, update this file **as part of that task** (before you
> report it done) — do not leave it stale for a later pass. Specifically:
> - Update **Part 1** ("Where we are now" / "What's next") to match what actually shipped, and
>   bump the _Last updated_ date below.
> - Update **Part 2** when the architecture, file layout, key files, or a design rule changes.
>
> A change isn't finished until the docs that describe it are too.

_Last updated: 2026-07-08 (**P6.4 — the Remote-store cutover, S1–S4 COMPLETE** — the frontend
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
`buildout-infra` stays alive as the loop's working branch (it merges main each iteration);
its in-flight wireRouter S3 work was NOT part of this merge. Earlier same day,
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

---

# Part 1 — Project Status

## The goal

A platform where a student logs in (eventually UCLA SSO), picks an assignment, works on it
(one canvas per question, in the right mode — CC / SC / FSM / TM), leaves, comes back, and
resumes exactly where they left off — then submits the whole assignment with one button. On
submit it goes to the **server** and is **autograded**. Instructors author assignments and
view scores. **Students cannot grade their own work** — grading is a server/instructor
capability.

## Where we are now

A single-page app supporting the full target flow end-to-end in **two backends behind one
switch** (`storage/backend.ts`): **local** mode (browser-only, localStorage — the default, the
dev environment, and what the headless harness drives) and **remote** mode (built with
`VITE_API_BASE`; every seam backed by the `server/` API — server-side grading, sanitized
student payloads, real sessions). The flows below are identical in both modes except where
noted:

- **Student side** — sign in (local: mockup account picker; remote: roster email → server
  session, restored across reloads, with a boot health-probe retry screen when the server is
  unreachable) → browse assignments →
  open one to its **question list** (`AssignmentOverview`) → click a question to open its
  dedicated canvas in the correct mode (**CC, SC, FSM, TM, and turbot** — TM has a clickable tape
  strip below the canvas plus machine-table/run/history panels; its tape alphabet is tied to the
  question's `representation`, so `*` can only be entered — in the transition editor or on the
  tape — on binary questions; a turbot question's canvas is the normal editor for the question's
  `innerMode` brain, with the arena "Map" (grid + Step/Run/Pause/Reset + cycle/sensor readout) in
  the right data panel below the question statement, above the machine table and step history;
  TM-brained turbots additionally show their internal tape read-only below the canvas; an
  **open** question swaps the canvas for a free-text writing panel — same nav/autosave/Submit,
  copy/paste blocked in the textarea) →
  navigate back to the list or between questions via the nav bar → debounced autosave through
  the `WorkbookStore` seam (local: instant localStorage; remote: server PUT with an `'error'`
  indicator + backoff retry, a keepalive unload flush, and a per-email crash-buffer journal
  replayed on the next open — a hard tab kill loses nothing) →
  leave and resume (reload/Back returns you into the assignment) → Submit a timestamped
  snapshot (remote submit is online-only: a failure alerts and records nothing — the server
  stamps time, so nothing is silently late).
  The editor chrome is minimal: no File/Edit menus (Home + Submit + session controls only).
  The freeform **sandbox** offers every machine as a worksheet tab — the + menu lists Logic
  Circuit / FSM / TM **and Turbot** (a second menu page picks the CC/SC/FSM/TM brain); a sandbox
  turbot tab is the full turbot workspace (same selectors as questions) with its own **editable**
  arena — the Map's sandbox-only "Edit map" mode reuses the instructor arena tools
  (block/goal/erase/start + resize) — persisted per tab in the sandbox autosave.
- **Autograding (the codec)** — pure headless `engine/` simulators for **CC, SC, FSM, and TM**,
  graded through one **value-based codec pipeline**: every machine implements a function `f`, and
  `grader.ts` checks it against a machine-agnostic bank of numeric `(x, f(x))` `test_cases` via
  `validate → encode → run → accept → decode → compare`. The only per-mode knowledge is the
  **axis** — how a number maps to/from bits over wires (CC `space`), time (SC/FSM `time`), or tape
  (TM `tape`) — which lives in the **codec** (`engine/codec.ts` + `tmCodec.ts`). The old bit-based
  `test_vectors` are gone. **Turbots grade outside the codec**: a turbot's brain is a CC/SC/FSM
  circuit with a fixed 1-bit sensor / 2-bit motor interface, or a **turbot TM** (textbook model:
  internal states do single-action tape ops on the question's encoding's alphabet — binary
  {0,1,*}, unary {0,1}; external states sense B/E/F and move forward/turn; halting is its stop).
  `gradeTurbot` maps the question's `representation` to that notation and runs the brain in each
  `turbot_cases` arena (`engine/turbot.ts` driver loop; turbot-TM tables validated by the
  notation-aware `validateTurbotTM`) and checks
  the case's success criterion (reach-and-stop / pass-through / return-to-start) — positional
  results (`TurbotCaseResult`), not value comparisons. `turbot_cases` is an arena FAMILY and
  every arena must pass (navigation questions promise generality — block/goal at unknown
  distance); return-to-start in a goal-ful arena additionally requires the trace to visit the
  goal before ending at start, so hardcoded out-and-back brains fail the family
  (turbotCheck `[multi-arena]`). **Perception questions also grade outside
  the codec** (`engine/perception.ts`, `gradePerception`): a CC/SC question with a `perception`
  spec is graded bit-level against `perception_cases` — raw input frames in (one frame per SC
  clock tick; the pre-first-frame "previous input" is the all-zero frame, matching MEM init),
  one output bit compared per step, a case passing iff every step matches
  (`PerceptionCaseResult`). **Open questions aren't autograded at
  all**: the answer travels as `responseText` on the submission and the grader returns a
  `'pending'` result carrying it for manual review (an LLM-grading pass could later replace
  that pending result — the seam is there, not implemented). Submissions **autograde on
  receipt** and the result is persisted on the record — in local mode inside
  `LocalSubmissionStore`, in remote mode on the SERVER (same pure engine; the student's
  browser never sees `test_cases` and never grades — grep-gated by remoteStoreCheck; byte
  parity pinned by `server/tools/parityCheck.ts`).
- **Instructor side** — role-gated `#/instructor` mode: dashboard, assignment editor, a **question
  creator**, and a **gradebook** that reflects stored autogrades, **grouped by student**: one row
  per student showing the **latest** submission's scores (only the latest counts for grading) and a
  per-student attempt count; expanding a student reveals the full submission history with
  failed-case drill-down per attempt (value questions: input/expected/got; turbot questions:
  arena #, steps taken, final pose, failure reason; perception questions: input frames,
  expected/got bit strings, first wrong step; open questions: the full text response with
  **manual grading controls** — ✓ Correct / ✗ Incorrect + an optional note, recorded through
  `SubmissionStore.recordManualReview` onto the stored result; unreviewed open questions are
  marked ✎ and excluded from the score, reviewed ones count like any other question and the
  ✎ stat tile tracks how many latest attempts still need review). Sample data for all six
  modes plus the five perception problems can be seeded to demo the pipeline.
  The question creator is one shared form authoring **all six modes** (CC/SC/FSM/TM/turbot/open) —
  mode is an ordinary field, not a gate; question names are editable; there is no bit-width field
  and no example-preview table. CC/SC/FSM/TM questions compute exactly **one output**: the
  **Target function** section shows `f(x, y, …) = <formula>` over the declared input-group names,
  with a lightweight live single-input check inline next to it. CC input groups declare a **max
  input value**; SC/FSM/TM have no size field — they're tested on a **sampled** set of values
  across a range of input lengths (`buildQuestionBank` in `engine/testVectorGen.ts`, which also
  derives all group widths). **Turbot questions** replace the formula pipeline with an
  inner-machine picker (CC/SC/FSM/TM), an **encoding** toggle (binary | unary, stored as the
  question's `representation`; it picks a TM brain's internal tape alphabet), a clickable
  **arena editor** (paint blocks/goals, place + rotate the turbot start; resizable up to 30×30;
  helpers in `instructor/arenaEditing.ts`), and a
  success criterion + max-steps pair; goal-directed criteria require a goal cell before save.
  **Perception questions** (CC/SC only) are a "Task" toggle on the same form: pick a rule
  (CC: ≥k run / exactly-k run / exact pattern; SC: change / upward motion), a retina size
  (2–10 wires; a pattern's width is its length), and the bit-level case bank generates at save
  (`buildPerceptionCases`); representation is implicitly binary bits.
  **Open questions** are just a name + question text (no representation, formula, or bank).
- **Reference-function DSL** — instructors don't hand-write test cases. They declare a question's
  input/output groups + one representation and specify the correct output with a small
  **affine/bitwise arithmetic mini-language** (the "reference function"); the system enumerates
  inputs, evaluates the formula, and auto-generates the numeric `test_cases` — the full
  enumeration runs once, at save. While editing, a live check evaluates the formula on a single
  input per keystroke and a button previews up to 16 worked examples on demand (enumerating the
  whole space per keystroke was too slow). See the DSL section in Part 2.

- **Server (built and WIRED to the frontend; not yet deployed)** — `server/` is a runnable API
  server implementing the backend half of every seam: dev auth + sessions (roster email →
  bearer token), assignment CRUD, workbook sync, submit-with-server-side-autograding (same
  `engine/grader.ts`, imported directly), manual review (same pure `applyManualReview` from
  `storage/manualReview.ts`), grade release, and an unauthenticated `/api/health` probe. It
  keeps `test_cases` server-only and strips per-case detail from student results
  (`sanitize.ts`). SQLite storage, seed script, a 35-check HTTP smoke test plus the 36-check
  server↔engine grading-parity pin (`cd server && npm run check`). Since P6.4 the app's
  `Remote*` stores and remote auth consume it end-to-end (`app/src/api/client.ts`;
  `tools/remoteStoreCheck.ts` drives the Remote seams against the booted real server — 56
  pins). Deployment recipes for Lightsail + Cloudflare Pages sit in `deploy/`.
  See `server/README.md`.

What's missing is the **deployment** (waiting on the UCLA AWS account), **UCLA SSO** (a
server-side `AuthProvider` swap; the client flow is done), and **real assignment content**
(HW1–HW7).

## What's next

**Near-term (still no backend):**

- **Reference-fixture buildout — COMPLETE AT-TIER** (branch `buildout-infra`, memos in
  `docs/buildout/`) — **46 exact + 10 interface = 56/56**: every machine-buildable problem in
  HW1–HW6 has a hand-verified reference fixture behind the two-tier coverage harness. All
  arithmetic + perception at the **exact** tier (correct passes every case, broken variant
  fails); all navigation + the Desert Ant capstone at the **interface** tier (plausible attempt
  validates + grades end-to-end; scores reported, never asserted — 2026-07-06 scope shift;
  exactly-correct answers are a separate future project). Close-out queue (see
  `docs/buildout/QUEUE.md`): everything through P6.4 (the Remote-store cutover) is DONE,
  including P6.1b (resolved iteration 34 — Gabriel chose the implemented red `#c73535`
  over the mockups' yellow; VISUAL_VOCAB updated to record it). No loop-owned buildout
  work remains — the ledger is complete at-tier and the queue holds only the two
  recurring META tasks plus one optional non-blocking hardening item (P-TOOLS-1, a
  harness-tool portability grep-gate); product remainder (deploy / UCLA SSO / real HW
  content) is human/backend-gated, below.
- **Turbot polish** — the full turbot flow (engine, grader, store, student workspace, instructor
  authoring, gradebook, sample data) shipped 2026-07-05, including the textbook turbot TM
  (internal/external states, single tape actions, B/E/F senses, ↑/↱/↰ motors); FSM brains got
  full 2-bit motor outputs 2026-07-06, and the sample assignment gained a turbot question per
  inner mode the same day; the **sandbox turbot tab** (P4.4, 2026-07-08) added scratch-building
  turbot brains outside assignments, with a per-tab editable arena. Known follow-ups:
  multi-arena authoring UI (the `turbot_cases` data model already holds a list; the creator
  authors one), and live-linking arena stepping to circuit-edit invalidation (currently the
  student Resets manually after editing mid-run, same as TM).
- **Perception polish** — the CC/SC perception flow (rules, bit-level grading, authoring,
  gradebook drill-down, samples) shipped 2026-07-06. Known follow-ups: a student-facing frame
  player for SC perception (today students hand-enter per-wire input sequences in the normal SC
  timeline to test their circuit), instructor-editable/custom frame sequences for SC banks (the
  battery is fixed), and richer rules (downward/any-direction motion, multi-object scenes).
- **Deferred authoring follow-ups — both done.** `requireStandardHaltPosition` (2026-07-06):
  wired end-to-end through `gradeQuestion` and exposed as a TM-only checkbox in the question
  creator. `allowed_components` (2026-07-07, P1.5): one semantics in
  `engine/machineValidation.ts` (absent/empty = unrestricted; present = listed types only, plus
  always-allowed INPUT/OUTPUT/STATE; BOXED internals recursed so a boxed gate can't smuggle a
  banned one), enforced as Stage-1 grading in every grader branch, filtered out of the student
  palette (`ComponentLibrary` via `selectAllowedComponents`), and authored via a
  "Restrict available components" toggle + gate checkboxes in the question creator.
- **Open-question grading follow-ups** — manual grading shipped 2026-07-07 (gradebook
  drill-down: correct/incorrect + note, stored as `ManualReview` on the pending result via
  `SubmissionStore.recordManualReview`). Remaining: optional LLM-assisted grading — the
  `pending` `QuestionResult` carries the `response` and `ManualReview` is the shape a
  server-side LLM pass would write; and surfacing the instructor's feedback note to the
  student (today it's instructor-only).

**The backend phase (server shipped 2026-07-07; frontend cutover DONE 2026-07-08 = P6.4):**

- **Frontend cutover — DONE (P6.4 S1–S4, 2026-07-08).** The seams are async, the `Remote*`
  stores back them via `app/src/api/client.ts` behind the `storage/backend.ts` switch, remote
  auth (email login / bearer session / 401 handling / boot health gate) is live, first-login
  fill-empty migration and the crash-buffer journal cover durability, and
  `tools/remoteStoreCheck.ts` (56 pins, in `npm run check`) drives it all against the booted
  real server. Local mode is byte-identical and remains the default without `VITE_API_BASE`.
- **Deploy** — once the UCLA AWS account lands: Lightsail box for `server/` (+ Caddy TLS),
  Cloudflare Pages for `app/` (set `VITE_API_BASE` at build; set `MM_CORS_ORIGINS` on the box;
  SQLite backup = copy the file) — step-by-step in `deploy/README.md`.
- **Real auth** — implement the `SsoAuthProvider` in `server/src/auth.ts` once UCLA SSO
  details exist; roles from the token. Roster ingestion in `server/src/seed.ts`. The client
  flow (AuthGate/HealthGate/login) is done and unchanged by that swap.
- **Real assignment content** — author the actual PHIL 133 homeworks (HW1–HW7).

---

# Part 2 — Technical Reference

## What this is

An interactive web platform for **PHIL 133 ("Making Minds")**, a philosophy/computation
course (~80 students). Students build circuits, finite state machines, and grid-based agents
("turbots"), completing and submitting homeworks that are automatically graded. Built as a
**single-page React + TypeScript app** with two backends behind one switch: local (browser-only
localStorage; the default and the dev/harness environment) and remote (the `server/` API,
selected at build time by `VITE_API_BASE`).

## Architecture principle: seams

Every external dependency sits **behind an interface**. This is how the no-backend prototype
BECAME a server-backed product (P6.4, 2026-07-08) by swapping implementations — not rewriting
the UI. The seams are Promise-returning; `storage/backend.ts` is the ONE mode decision and the
sole exporter of store instances. **Route new features through these seams, not around them.**

| Seam        | Interface                        | Local mode (default; dev + harness)          | Remote mode (`VITE_API_BASE` set) — LIVE since P6.4 |
| ----------- | -------------------------------- | -------------------------------------------- | -------------------------- |
| Evaluation  | `engine/` (pure, headless)       | runs in browser                              | same code grades on server (imported directly) |
| Grading     | `engine/grader.ts`               | grades on receipt in `LocalSubmissionStore`  | server grades on submit; client never sees `test_cases` (grep-gated); parity pinned |
| Identity    | `src/auth/` (one provider per mode) | mockup login: pick a toy account; role gates views | email login → bearer session → `me()` restore; 401 hook; boot health gate; UCLA SSO later = server-side `AuthProvider` swap |
| Persistence | `WorkbookStore`                  | `LocalWorkbookStore` (localStorage)          | `RemoteWorkbookStore` + crash-buffer journal & fill-empty migration |
| Assignments | `AssignmentStore` + registry     | bundled + localStorage (instructor-authored); release flag on the seam | server CRUD, role-sanitized; bundled set is empty remotely |
| Submission  | `SubmissionStore`                | `LocalSubmissionStore` (localStorage)        | `RemoteSubmissionStore` (answers only; identity/time = server's word) |
| Navigation  | `routing` (`Route` + `navigate`) | hash URLs via History API (starts inside AuthGate) | same routes                |

**Keep evaluation logic framework-agnostic.** All circuit/FSM evaluation lives in
`app/src/engine/` (pure TypeScript — no React, Zustand, or DOM) so the same code runs in the
browser and headlessly for server-side autograding. The store and UI are thin wrappers over
the engine.

## Key files

| Area          | Path                                                                           | What's there                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Types         | `app/src/types.ts`                                                             | All domain types: `AssignmentData`, `AssignmentQuestion`, `SubmissionData`/`SubmissionRecord`, `CircuitData`, `CCSpec`, `SubmissionResult` |
| Engine        | `app/src/engine/cc.ts`, `sc.ts`, `fsm.ts`                                      | Pure simulators per mode (topological eval for CC; clocked step for SC; transition-matching for FSM)                                       |
| Engine        | `app/src/engine/tm.ts`, `tmValidate.ts`, `tmCodec.ts`                          | TM: notation-aware tape engine — **two-output** labels `read:write,move` (e.g. `1:0,R`; legacy `1:0R` parses as an alias), executed as one **atomic step** (every transition writes a symbol AND moves; grammar lives in `engine/notation.ts`); pre-engine table validation (ambiguous/unparseable, via the generic walker); encode/accept/decode (the codec `tape` axis; accept honors the question's optional `requireStandardHaltPosition` — head must halt on the output block's rightmost cell)          |
| Engine        | `app/src/engine/grader.ts`                                                     | `gradeSubmission` / `gradeQuestion` — one value-based codec pipeline for CC/SC/FSM/TM against numeric `test_cases`, plus a separate `gradeTurbot` branch (arena success criteria, not the codec); open questions short-circuit to a `'pending'` result carrying the free-text `response` for manual (later maybe LLM) review          |
| Engine        | `app/src/engine/codec.ts`, `machineValidation.ts`                              | The codec (`space`/`time` value↔bits; `tape` → `tmCodec`) and Stage-1 machine validation for all modes, incl. the `allowed_components` restriction semantics (`validateAllowedComponents`/`isComponentTypeAllowed` — absent/empty = unrestricted; INPUT/OUTPUT/STATE always allowed; BOXED internals recursed)                                     |
| Engine        | `app/src/engine/testVectorGen.ts`, `formulaEval.ts`                            | Authoring-time: affine-formula language → `buildQuestionBank(inputs, outputs, rep, mode)` → `{spec, test_cases}` (widths derived; SC/FSM/TM sampled). Legacy `generateTestCases(spec, rep, mode)` remains for the sample data |
| Engine        | `app/src/engine/notation.ts`                                                   | Transition-label SYNTAX seam: `TransitionNotation` (parse/format/alphabet/editor token fields/default) for all four grammars — native k-bit `fsmNotation(inBits,outBits)` + `turbotFsmNotation` (1-bit alias → canonical 2-bit motor, decays on edit-save); TM/turbot grammars delegate to their engine parsers; generic `validateTransitionTable` walker. Label dissection is allowed ONLY here + the delegated parsers (notationCheck grep gate)  |
| Engine        | `app/src/engine/representation.ts`, `index.ts`                                 | value↔bits core (`valueToBits`/`isValidCodeword`/`bitsToValue`) + display helpers; barrel exports                                          |
| Engine        | `app/src/engine/turbot.ts`                                                     | Turbot arena driver loop: `senseAhead`(bit)/`senseAheadSymbol`(B/E/F)/`applyMotorCommand`, `runBrainStep`/`initialBrainState` (one transition per call: CC/SC circuit brains, the **turbot FSM** — Mealy transitions with full 2-bit motor outputs `in:ij`, executed and validated through `turbotFsmNotation` (engine/notation.ts; `validateTurbotFSM` delegates to the generic walker, legacy 1-bit labels stay valid as aliases) — or the **turbot TM** — per-state internal/external kinds, single tape actions, ↑/↱/↰ motor labels, own validator `validateTurbotTM`; internal alphabet per the question's encoding, a `TMNotation` param — binary {0,1,*}, unary {0,1}), and `runTurbot` (`stopped` = motor 00 or a TM halt). `evaluateTurbotCriterion` judges `reach-and-stop` / `pass-through` / `return-to-start` (spec §12.5; return-to-start in a goal-ful arena also requires the trace to VISIT the goal — the clause that gives out-and-back arena families (Mad Max) their teeth; goal-less arenas are plain end-at-start), with two seam companions beside it: `criterionRequiresStop` (pass-through is trace-satisfiable — the step limit bounds SIMULATION, not success, so `pass: true` + `hitStepLimit: true` is a legitimate shape) and `explainTurbotCriterionFailure` (read-only clause mirror; every failing `TurbotCaseResult` carries a criterion-named reason) |
| Engine        | `app/src/engine/perception.ts`                                                 | Perception (bit-level, outside the codec): `PerceptionRule` evaluators (`hasRunAtLeast`/`hasRunExactly`/`singleObjectAt`/`expectedPerceptionOutputs` — the pre-first-frame "previous input" is the blank frame, "up" = toward IN1), save-time bank generation `buildPerceptionCases` (CC: exhaustive 2^width, width ≤ 10; SC: deterministic frame-sequence battery), `validatePerceptionMachine` (width inputs + 1 output), and `runPerceptionCase` (CC frame eval / SC clocked sequence) |
| Store         | `app/src/store.ts`                                                             | Zustand UI state; delegates simulation to `engine/`. Per-mode sim state incl. TM (`tmTape`/`tmStep`/`setTmCell`) and turbot (`turbotState`/`turbotStep`/`turbotRun`); ALL transient sim slices (SC/FSM/TM/turbot + I/O `tableRows`) are app-wide, not per-canvas, so every canvas swap — question navigation (`loadAssignment`/`openAssignment`/`switchQuestion`) and sandbox tab/workbook entry (`enterSandbox`/`addTab`/`switchTab`/active-tab `removeTab`/`newWorkbook`/`importWorkbook`; background-tab removal leaves the live run alone) — flushes them via `resetAllSimState()` (delegates to `scGlobalReset`/`fsmGlobalReset`/`tmGlobalReset`/`turbotReset`; pinned by `tools/navResetCheck.ts`); selectors `selectTmNotation` (TM alphabet: open question's `representation`, sandbox falls back to `repSystem`), `selectTurbotArena`/`selectTurbotInnerMode` (open turbot question's arena/`innerMode`; in the sandbox both fall back to the active turbot tab — a `SandboxTab` carries optional `innerMode` + its own `arena`, seeded by `addTab(…, 'turbot', …, innerMode)` with `sandboxDefaultArena()` (10×8 bordered field) and edited via `setTabArena`, persisted through the sandbox autosave and workbook export/import), `selectEffectiveMode` (turbot → the question's/tab's `innerMode`; drives every editor-behavior branch), `selectAllowedComponents` (the open question's `allowed_components`, filters the palette), and `selectLiveFsmStateId` (the ONE source for the canvas live-state highlight — FSM sim and turbot arena stepping both feed it), plus `assignmentView` ('overview' \| 'question') and `openResponse`/`setOpenResponse` (the open question's free-text answer, synced into `QuestionCircuit.responseText` at every canvas sync point)  |
| Routing       | `app/src/routing.ts`                                                           | `Route` union, `parseHash`/`routeToHash`, `navigate()`                                                                                     |
| Wire layout   | `app/src/componentGeometry.ts`, `app/src/wireRouter.ts`                        | `componentGeometry` is the SINGLE source of truth for rendered component dimensions (`getComponentSize`; MEM 50×50) + port math (`getPortPosition(Local)`, incl. OR/XOR left-port inset and rotation), the full obstacle footprint `getComponentBounds` (body + adjuncts — INPUT's 14×20 toggle-tab — so tabs are router obstacles; wireRouter's old body-only copy is deleted), and the rotation-aware label anchor `getLabelAnchor` (snapped 90°, keeps rotated-MEM labels clear of the port axis), imported by `CircuitCanvas`, `wireRouter`, and `tools/layoutCheck` so renderer/router/oracle geometry can never desync; `wireRouter` is the cost-based A* orthogonal wire router (obstacle bounds from the shared geometry; structurally-doomed wires take the L-path fallback in a **phase-0 pass** so every A* search sees their lanes; fallback instrumented via `get/resetFallbackCount` for `tools/routerCheck.ts`; per-wire warn-don't-block flags `usedFallback`/`violation` from a final read-only oracle-predicate sweep, surfaced by `CircuitCanvas` as a hover tooltip + a faint amber dashed halo on violations) plus the pure `findDivergencePoints` (VISUAL_VOCAB junction dots: fan-out split dots at the elbow where displayed paths part, skipping dots on canvas-side crossing bumps)          |
| Storage       | `app/src/storage/workbookStore.ts`, `AssignmentStore.ts`, `submissionStore.ts` | The three Promise-returning seam interfaces + their Local (localStorage) impls; grade release lives ON the `AssignmentStore` seam (`getGradesReleased`/`setGradesReleased`, `mm:release:` = the local impl's private key); `submissionStore` owns manual review of open questions (`recordManualReview`)                                                                                                        |
| Storage       | `app/src/storage/backend.ts`, `remoteStores.ts`, `manualReview.ts`             | `backend.ts` — the ONE mode decision (`backendMode` from `VITE_API_BASE`) and sole exporter of store instances. `remoteStores.ts` — the three Remote impls as direct `api/client.ts` calls (404→seam-null; answers-only submit; GRADER-FREE, grep-gated by remoteStoreCheck). `manualReview.ts` — the leaf pure `applyManualReview`, the ONE review implementation, imported by both the local store and the server's review route |
| Storage       | `app/src/storage/journal.ts`, `migrateLocal.ts`                                | Remote-mode durability grafts. `journal.ts` — per-email crash buffer (`mm:journal:<email>:<asgId>`): written synchronously on unload flushes + failed remote saves, cleared by every confirmed save, replayed (supersede + re-upload) by the next `openAssignment`. `migrateLocal.ts` — first-remote-login fill-empty migration of local workbooks + (instructor) authored assignments; guard `mm:migrated:<email>`; server data never overwritten; submissions/release/reviews deliberately not migrated |
| Auth          | `app/src/auth/`                                                                | `AuthGate.tsx` (holds rendering until a user exists; `initRouting()` fires here so deep links never run unauthenticated), `HealthGate.tsx` (remote boot: `/api/health` probe + auto-retrying outage screen; local mode renders through untouched), `LoginScreen.tsx` (toy-account picker local / roster-email form remote), `authProvider.tsx` (one provider per mode; remote: login → bearer token → `me()` restore, 401 hook logs out, first-login migration awaited before user set), `session.ts` (non-hook user cache for `getCurrentUserEmail`), `accounts.ts`, `instructorRole.ts` |
| Async UI      | `app/src/useAsyncValue.ts`                                                     | The shared fetch-on-mount hook (`value`/`loading`/`error`/`reload`) behind every view that reads the async seams (HomeScreen, InstructorDashboard, AssignmentEditor, GradebookView); stale resolves dropped, previous value kept during reloads       |
| Assignments   | `app/src/assignments/index.ts`, `cc-basics.json`                               | Registry over the `AssignmentStore` seam (`listAssignments`/`getAssignment`); the bundled CC assignment is LOCAL-mode-only (an empty bundled set remotely — the client bundle's answer bank must never ship beside sanitized server copies)                                                       |
| Instructor UI | `app/src/instructor/`                                                          | `InstructorApp`, `InstructorGate`, `InstructorDashboard`, `AssignmentEditor`, `QuestionCreator` (incl. turbot arena editor — up to 30×30 (`MAX_ARENA_SIZE`), scroll-aware; pure paint/resize/place helpers in `arenaEditing.ts`), `Gradebook(.ts/View.tsx)`                 |
| Student UI    | `app/src/components/`                                                          | `CircuitCanvas`, `ComponentLibrary`, `DataTable`, `HomeScreen`, `AssignmentOverview` (question list), `MenuBar`, `SequentialTimeline`, `TMTapePanel` (clickable tape), `ArenaCanvas` (shared arena grid renderer), `TurbotArenaPanel` ("Map" + run controls, in the right data panel; in the sandbox also the "Edit map" mode — instructor arena tools + resize via `setTabArena`), `TurbotTapePanel` (turbot TM's read-only internal tape), `OpenResponsePanel` (open question's writing panel; copy/cut/paste/drop blocked), `SimulationPanel`, `TabBar` (question nav bar in assignments; the sandbox + menu — CC/FSM/TM plus a Turbot entry whose second menu page picks the brain kind), `outputDisplay.ts` (pure OUT/ARG display builders — t1-rightmost OUT rows, per-group ARG values in question mode) |
| API client    | `app/src/api/client.ts`                                                        | Typed browser client for the API server (one function per endpoint; bearer token under `mm:auth:token`; `onUnauthorized` hook fired on any 401; `health()` boot probe; `putWorkbook` takes `keepalive` for unload flushes). LIVE since P6.4: consumed by the `Remote*` stores and the remote AuthProvider; `setApiBase` is the harness override |
| Server        | `server/src/app.ts`, `db.ts`, `auth.ts`, `sanitize.ts`, `config.ts`, `seed.ts` | The API server (Express 5 + `node:sqlite`): routes (incl. the instructor manual-review route reusing the app's pure `applyManualReview`, and the unauthenticated `/api/health` liveness probe), storage, the `AuthProvider` seam (dev login now, UCLA SSO later), student-facing redaction + grade-release withholding, env config, DB seeding. Smoke test: `server/tools/serverCheck.ts` (35 checks), plus the server↔engine grading-parity pin `server/tools/parityCheck.ts` (representative fixtures — all four codec axes, turbot, perception, open — graded through the real HTTP submit path AND directly via `gradeSubmission`, payloads deep-compared with only JSON-canonicalization; also pins the perception-aware student redaction — `perception_cases`/`perceptionCases` leaked to students until 2026-07-08); both run in `npm run check` in `server/`. Deploy recipes in `deploy/` |
| Dev/sample    | `app/src/devData/sampleData.ts`, `seed.ts`                                     | Builders + seeding for demo CC/SC/FSM/TM/turbot/perception/open assignments and submissions (one turbot question per inner mode; netlist-built perception circuits; `questionModeLabel` in `types.ts` names a turbot question's inner machine / a perception task in mode chips)                                                                |
| Tools         | `app/tools/grade.ts`, `pipelineCheck.ts`, `codecCheck.ts`, `notationCheck.ts`, `tmCheck.ts`, `turbotCheck.ts`, `perceptionCheck.ts`, `scWindowCheck.ts`, `routerCheck.ts`, `coverageCheck.ts`, `layoutCheck.ts`, `bumpCheck.ts`, `navResetCheck.ts`, `remoteStoreCheck.ts` | Headless CLI grader (prints a word count for pending open questions), submit→grade pipeline check (all modes, incl. perception and the open question's pending path; 13/13 vs 0/13), codec + rep-core unit checks, the transition-notation seam check (adapter≡parser equivalence incl. per-encoding turbot-internal, legacy byte-compat, k=2 asymmetric bit-order grade pin, arity/totality errors, label-dissection grep gate), TM engine/codec/grader smoke test, turbot engine/grader smoke test (all four inner modes graded — CC/SC/FSM/TM — incl. the turbot-FSM one-notation validity pins, the encoding-aware `*`-rejection pins, and the `[multi-arena]` family pins: hardcoded out-and-back brains pass a 1-arena Mad Max family but fail the 3-arena one, 2/3 arenas ≠ pass, per-arena results identify the failures, and Gradebook logic counts them; plus the `[pass-through step-limit]` pins — a goal-crossing brain passes without stopping, step limit ≠ failure per `criterionRequiresStop` — and per-criterion failure-reason pins), the perception rules/generation/grading smoke test, the SC/FSM question-run contract check (grader window length + codec input-stream content parity, via real-store headless runs incl. the hw3-p7 fixture and a k=2 FSM store-run≡grader pin), the wire-router world-model pins (shared-geometry smoke, MEM.min + XOR-in A* reachability — the own-endpoint exemption keeps inset-port stub tips reachable — fallback budget 2 total (hw3-p9's one genuinely-cramped wire, deliberately pinned; the structural XOR floor is gone), the divergence-dot corpus, the route-quality flag pins (hw3-p9's w21 usedFallback + violation-free; the doomed tripwire carries both flags, falling back exactly once in phase 0), and the pre-fix hw3-p4 layout regression pin (P1.3-era positions route oracle-clean today — fallbacks allowed, violations not)), the reference-fixture coverage harness (two-tier ledger — `exact`: correct passes + broken fails, vs `interface`: a plausible attempt validates + grades end-to-end, score reported not asserted (scope shift 2026-07-06) — plus breadth/drain warnings + statement lint, six permanent `allowed_components` self-test pins — OR machine fails hw1-p2 with the reason naming OR, absent field permissive, boxed-OR smuggling caught, palette predicate, interface-tier mirror — and its Stage-1 mirror tracks the grader's full dispatch: open/perception/turbot/codec), and the canvas layout oracle (real `routeAllWires` route prediction: collinear/near-parallel overlaps, body crossings, box collisions; CLI + used by the harness for CC/SC fixtures), and the bump-renderability predicate `bumpCheck.ts` (replicates the canvas crossing-bump draw/skip rules headlessly; no-arg = sweep of every CC/SC reference fixture, wired into `npm run check`; all fixtures pinned bump-clean since the router learned the drawability rule), and the store-level canvas-swap sim-reset regression check `navResetCheck.ts` (drives `loadAssignment`/`openAssignment`/`switchQuestion` AND the sandbox swaps — `enterSandbox`/`addTab`/`switchTab`/`removeTab` both branches/`newWorkbook`/`importWorkbook` — through real SC/FSM/TM runs and asserts `resetAllSimState` leaves every sim slice fresh; 120 checks, incl. the `backendMode === 'local'` harness pin and the open-A-then-open-B interleaving pin), and the remote-seam check `remoteStoreCheck.ts` (56 pins: boots the REAL server on an ephemeral port against in-memory SQLite and drives the `Remote*` stores through `api/client.ts` — the grader-import grep gate over the remote-store module graph, 401/`onUnauthorized` paths, answer-stripped student payloads, answers-only submit with spoofed identity/timestamp ignored, release/review round-trips, the `health()` probe (live/503/dead-port), the fill-empty migration decision table + guard/guard-less idempotence, and crash-buffer journal keying/replay/clear) (`npx tsx`)          |

## Reference-function DSL (instructor authoring)

Instructors specify _what a student circuit must compute_ with a small arithmetic
mini-language instead of writing test cases by hand. This is an authoring-time convenience
only — the grader never sees the formula; it runs against the generated numeric `test_cases`.

- **Where it lives** — `engine/formulaEval.ts` (`evalFormula(expr, vars)` → non-negative
  integer; throws `FormulaError`) and `engine/testVectorGen.ts`
  (`buildQuestionBank(inputs, outputs, rep, mode)` → `{spec, test_cases}`, all at save). The
  instructor UI (`instructor/QuestionCreator.tsx`, with `instructor/ccPreview.ts`) validates
  formulas **live on a single input** (`probeFormulas`, cheap per keystroke); there is no
  example-preview table. Blocks save on any formula error.
- **The language** — variables (declared input-group names like `x`, `y`), non-negative
  integer literals, and the operators `+ - *` and bitwise `& | ^ ~`, with parentheses. No
  division, modulo, conditionals, or function calls. Each formula is one expression returning a
  single non-negative integer.
- **No width fields; widths are derived.** Instructors never enter bit widths. A CC input group
  declares a **max input value** (stored as `max_value`; width = bits/strokes to hold it) and is
  enumerated exhaustively 0..max. SC/FSM/TM input spaces are unbounded/streaming, so they get no
  size field: `buildQuestionBank` tests a **sample** of values across a range of input lengths
  (binary: min/mid/max of each bit-length up to `SAMPLE_MAX_LEN`; tally: 0..`TALLY_SAMPLE_MAX`
  exhaustively; cartesian capped at `MAX_SAMPLED_CASES`). Output group widths are derived from
  the largest generated output, so **outputs are never truncated** — there is no
  width-as-modulus trick; write `x ^ y` for XOR, and `x + y` always keeps its carry.
- **Representation** — one per question (`binary` | `tally`), not per group. It governs the input
  value ranges, how the codec lays values onto the machine's axis, and how outputs decode. The
  codec — not the DSL — owns the value↔bits mapping at grade time.
- **All four modes in the UI.** `QuestionCreator` authors CC/SC/FSM/TM through one shared form
  (mode is a field, not a separate step; the question **name** is editable); the same DSL
  expresses every mode's function (the sample SC delay is `2 * x`, the FSM identity is `x`, the
  TM increment is `x + 1`). `buildQuestionBank` takes the mode to pick exhaustive-vs-sampled
  enumeration per axis. The grader handles all modes via the codec.
- **Safety** — `evalFormula` validates against a strict token whitelist (digits, declared
  variable names, the allowed operators) before evaluating via `new Function()`. Acceptable
  because formulas are instructor-authored, never student-supplied.

## Source-of-truth docs (in repo, not auto-loaded)

- `spec/PHIL_133_Platform_Spec_v2.md` — full platform spec; the authority for behavior,
  layout, and feature decisions. Read before implementing a phase.
- `CLAUDE_CODE_PROMPT.md` — the original implementation brief (phase plan + design details).
- `spec/mm_textbook.pdf` — course textbook for pedagogy and notation.
- `problem sets/hw1.pdf`…`hw7.pdf` — the real homeworks the grader must handle.
- `spec/Private & Shared/.../Mock_Ups-*.jpg` — UI mockups (CC/SC workspaces, FSM editor,
  turbot split view, TM).

## Build phases (from the spec)

1. **CC** — gates (NOT/AND/OR), I/O, validated wiring, I/O & A/V tables, boxed circuits
   (XOR, Half-Adder), drag-and-drop snap-to-grid canvas. _(built)_
2. **SC** — MEM block, clock/time model, right-to-left time-step table. _(built)_
3. **FSM** — state nodes, `input:output` transition arrows, simulation with state
   highlighting, state table. _(built)_
4. **Turbots** — split arena/circuitry workspace, grid arena, hardcoded sensor/motor
   encoding, live-linked internal circuit. _(built: engine + grading + store + UI +
   instructor arena authoring; brain = CC/SC/FSM/TM circuit behind a fixed 1-bit sensor /
   2-bit motor interface)_
5. **Turing Machines** — infinite tape, read/write head, TM transition labels, op cycle.
   _(built: engine + grading + store + UI — FSM-style state editor, two-output
   `read:write,move` labels (the platform's one deliberate textbook departure, spec §10.3),
   clickable tape strip, machine table / run controls / history)_
6. **TM Turbots** — turbot with TM-based internal circuitry. _(built, per the textbook
   "Turbots: Operation" model: internal (circle) states do single-action {0,1,*} tape ops,
   external (square) states sense B/E/F and move ↑/↱/↰, one transition per time step, blank
   starting tape shown read-only below the canvas, halting = stopping)_

## Critical design rules (don't miss these)

- **Directionality** — every component has inputs on the **left**, outputs on the **right**;
  signal flows left→right (gates, MEM, boxed circuits alike).
- **Wires** — splitting allowed (one output → many inputs); merging forbidden. Crossings
  draw a bump/arc; splits draw a dot. Color: **black = 0, red = 1**.
- **Validation** — _warn, don't block_ on loops, merged links, and free ends (red highlight +
  tooltip).
- **I/O vs A/V tables** — I/O shows raw per-wire bits; A/V shows concatenated numerals under
  **tally or binary**. Local scope = per-wire; global scope = all inputs as one number, all
  outputs as one number.
- **Time flows right-to-left** in SC and FSM tables (t1 on the right; later steps extend left).
- **SC/FSM question runs are the grader's runs** — inside an assignment question, Run/Step
  execute exactly the grader's run length (`stepCountFor` = max(input widths, output widths)
  time steps) AND feed exactly the grader's input stream: the typed global input is parsed as
  a **value** per input group (as the A/V ARG column reads it — tally "11" = 2) and laid on
  the time axis by the codec's `encodeInput` (LSB at t1 — a tally value's ones arrive last,
  zeros leading), and the SC A/V numeral decodes only the grader's window per output group.
  What the student types is the value the grader tests; the UI verdict matches the grade in
  both representations (`selectCodecLayout`/`selectCodecWindow` in the store; pinned by
  `tools/scWindowCheck.ts`, incl. the real hw3-p7 tally fixture). Typed input that is not a
  valid numeral for the representation (tally "101") runs on the raw typed bits and is flagged
  '/' in ARG. The per-MEM flush rule — after the typed input is consumed, Run continues for
  one 0-input drain step per MEM so delayed bits (a serial adder's final carry) reach the
  output — applies only to **sandbox** SC runs (which feed raw typed bits); sandbox FSM runs
  stop at the typed length L.
- **MEM block** — M_OUT (left) feeds the stored value in; M_IN (right) receives the new value.
  All memory initializes to 0; display the stored value during simulation.
- **Input labels** — assigned at creation and permanent; new inputs get the next sequential
  number regardless of vertical position.
- **Turbot encoding is hardcoded** — sensor in: 0 empty, 1 block. Motor out `ij` = the two
  wheel motors (i = left wheel, j = right wheel): 00 stay, 01 right motor on → turn left,
  10 left motor on → turn right, 11 both on → forward.
- **CC evaluation** — topological sort for gate order; propagation is instantaneous.
- **Homework JSON** (spec §1.5) carries numeric `test_cases` (`{inputs, outputs}` of values); the
  codec encodes/decodes per axis and the grader compares decoded outputs to expected. TM
  questions may additionally set `requireStandardHaltPosition: true` (authored via a TM-only
  checkbox in the question creator) to reject runs whose head does not halt on the output
  block's rightmost cell; absent/false, acceptance is position-agnostic. Any question may set
  `allowed_components` to restrict the component vocabulary (semantics in
  `engine/machineValidation.ts`: listed types only + always-allowed INPUT/OUTPUT/STATE, boxed
  internals recursed; absent/empty = unrestricted) — enforced at Stage-1 grading, in the student
  palette, and authored via the question creator's "Restrict available components" toggle.

## Things to watch

- **Test cases must not ship to the client in production — SOLVED in remote mode (P6.4).**
  The server strips `test_cases`/`perception_cases` from student assignment copies and
  per-case detail from student results (`server/src/sanitize.ts`; parity-pinned), students
  submit answers only, grading happens server-side, and the bundled assignment (whose JSON
  carries answers) is excluded from remote builds (`assignments/index.ts`). LOCAL mode still
  bundles answers and grades in the browser — by design, it is the dev/demo prototype, never
  the deployment students use. Keep it that way: never re-wire the bundled set or the engine
  grader into the remote-store module graph (remoteStoreCheck's grep gate enforces this).
- **localStorage is a stopgap — LOCAL mode only.** Per-browser, per-device, ~5 MB; fine for
  dev. In remote mode the seams are server-backed and localStorage holds only the session
  token (`mm:auth:token`), the crash-buffer journal (`mm:journal:<email>:<asgId>`, transient
  by design), and the migration guard (`mm:migrated:<email>`). Old local prototype data is
  never deleted — first remote login uploads it fill-empty (`storage/migrateLocal.ts`).
- **Remote workbooks are last-write-wins across devices** (accepted pilot trade-off,
  `docs/buildout/designs/remote-stores.md` §5): simultaneous multi-device editing silently
  drops the loser; the crash-buffer journal covers crashes, not conflicts. An
  `updatedAt`/If-Match precondition is the noted follow-up if it ever bites.
- **Deploy knobs live in `deploy/README.md`**: Cloudflare Pages sets `VITE_API_BASE` at build
  time; the Lightsail box sets `MM_CORS_ORIGINS` (and friends) via systemd; SQLite backup =
  copy the file.
