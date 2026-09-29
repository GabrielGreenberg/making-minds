# The robot's auditor — spending idle nights finding what nobody reported
_Status: proposed · 2026-09-28 · Task: none yet (design only; build after 043 closes)_

## In plain words

Most hours the robot's work run finds nothing it may work on and stops within a minute.
The auditor uses **one of those idle runs each night**:
1. It picks one part of the app from a list of every part, called **the map**.
2. It looks that part over **read-only** and runs a scripted student session in a headless
   browser.
3. It files what it finds as ordinary tasks, which later robot runs fix and ship through
   the normal gate.

The map **keeps itself complete**: a script checks that every file in the app belongs to
some part, and the auditor adds or extends a part before it picks.

This design ports the auditor Gabriel's Virgil app has run since 2026-07-05. It is scaled
down and fenced in, because MM differs in two ways:
- **The repo is public.** Anything filed is published the moment it is pushed.
- **Pushing ships.** Whatever lands reaches ~80 students the same morning.

**What you'll notice:**
- **Fixes.** At most 7 small fixes a week, found overnight and released together after
  07:00. Most nights file nothing or one thing.
- **Questions.** At most one new question a night in `/catch`, and never more than two
  from the auditor waiting at once. An unanswered one withdraws itself after two weeks.
- **Phone notes.** Rare: a finding that must stay private, or the auditor stalling.
- **Pause, stop, reject.**
  - "Pause audits" (or "audits off for the term") in `/catch` flips one line at the top of
    the map.
  - "NNN wasn't worth it" records the finding, so it is never filed again, and offers a
    revert.

## Problem family

**Idle capacity.** On 2026-09-28 ten consecutive work runs (00:44–09:44 PT) found nothing
eligible and ended in 36–95 s.

**Nobody looks at what nobody reported.**
- About 80 app modules are named by no check tool. Most are React panels no check renders;
  the largest is the canvas.
- Several load-bearing laws exist only in prose. Taking a census of them is the gate
  lens's first job.
- The indexes drift from the code.
- Homework content is pinned for parsing, not for faithfulness to its PDF.

**The precedent** (Virgil's queue, measured 2026-09-28).

What worked:
- **Precision.** About 1–2% of its findings were wholly wrong.
- **Real bugs.** 8 of a stratified 17 were user-visible, several of them silent corruption.
- **The regression net.** Re-auditing a changed surface caught a reintroduced incident.
- **Auto-queue over ask.** Confirmed defects stopped waiting on Gabriel on 2026-08-08;
  after that they landed in a median of 0 days, against 14 for questions.

What failed:
1. **A self-feeding firehose.**
   - It produced 74% of all landed work, 96–98% since mid-September.
   - Its back-off condition (a whole rotation with zero findings and no commits) was
     unreachable: only 4% of ticks were clean, and its own fixes supplied the commits.
2. **Hygiene.** 40–45% of its output was doc drift, dead code and polish. About 10% more
   finished siblings that earlier fixes had missed.
3. **Priority inflation.** Its default was `low`, yet by September 46% of its tasks were
   filed `high`.
4. **A hand-listed map missed the riskiest subsystem for two months.** The worst incidents
   were user-reported.
5. **Static reading missed a runtime error in real Chrome.** It was live for 14 days.
6. **Cost.** About 800k subagent tokens a tick before its "frugal breadth" rules. Its
   volume drove the weekly-limit outages. Its ledgers reached ~1.5 MB.
7. **Stalled questions.** Surfaced items waited a median of 14 days, and two are unanswered
   after 65+ days.

## Options

- **A. Port Virgil as-is.** Rejected: it brings failures 1–7 and nothing for public-repo
  or student safety.
- **B. A step inside the robot's work routine, once a night (chosen).**
  - It holds the run lock already, so it never overlaps a work run.
  - Its clone is the only one with `npm` deps (gates, builds, headless Chrome).
  - Night is when releases wait anyway. The night's fixes ship together at the first run
    after 07:00, and a student report caught at :00 during the day is never delayed by an
    audit holding the lock.
- **C. A third clone with its own routine.** Rejected: it would be a third pusher, and CI
  cancels in-progress runs on every push to `main`.
- **D. Attended only.** Not an alternative but part of B: `/audit <part>` is how the parts
  that need Gabriel's eyes or judgment get audited (§2).
- **Not the catch clone.** It has no deps and no lock, and it runs every hour whatever the
  backlog.

## Decision

### 1. When and where it runs

**Scheduled.** At `ROBOT-WORK.md` §2.3 ("nothing eligible"), after the §4.6 release step,
inside the same run and lock. The tick runs only if all of these hold:
- it is 00:00–05:59 PT;
- the map's first line reads `Scheduled audits: on`;
- no robot audit commit exists since midnight PT;
- the brakes in §9 allow it.

**Time box: 40 minutes.**
- The tick writes its deadline into the lock directory and checks it before each step.
- Past the deadline, it skips to Record with whatever the skeptic has confirmed.
- `ROBOT-WORK.md` §1 treats a lock whose audit deadline is more than 15 minutes past as
  stale: it kills the tick's scratch processes, removes the lock and notifies.

**Isolation.**
- The tick works in a throwaway `git worktree` of `HEAD` under the scratchpad, with
  `node_modules` symlinked. It holds tracked files only, so `secrets/`, `ssh/` and local
  state are absent.
- The work clone's settings deny reading `secrets/` and `ssh/`, and deny `ssh` and `scp`.
- Scratch servers, databases (a temp `MM_DB_PATH`, never the default) and Chrome profiles
  live in the scratchpad and are killed or removed on exit.

**Agents.** At most 3 `Explore` agents: 2 finder lanes plus 1 skeptic that tries to refute
every candidate in one pass. That is PROFILE §9 as written, and `ROBOT-WORK.md` §0's "only
multi-agent use" line gains this case. No Workflow.

**Attended: `/audit [part]`.** A new `.claude/commands/audit.md`, which Gabriel runs in his
checkout.
- It runs on `main` and refuses on a task branch.
- It uses the same frugal lanes (ultracode only if he asks in that session).
- It may use the browser pane on localhost only.
- It stamps the part and commits with subject `(attended)`.
- It doesn't count toward the nightly cap.

### 2. The map

`tasks/AUDIT_MAP.md` opens with three header lines:
- `Scheduled audits: on | paused | off`
- `Term ends: YYYY-MM-DD`, which Gabriel sets
- how to read the table

Each row of the table is one **part** (Virgil's "surface"). Its columns:

| Column | Holds |
|---|---|
| Part | the part's name |
| Scope | globs |
| Audience | who uses it |
| Risk | H / M / L |
| Lenses | which lenses apply |
| Last audited | `date @ commit`, `never`, or `attended-only — why` |
| Result | ≤ 120 characters |

**Risk is Gabriel's.** The auditor never sets or raises it. A part it adds starts at M, or
H when its Scope touches the release gate's hold list; any other change is proposed in
Result for Gabriel to make.

**Seed rows (26).** 18 are scheduled; 8 are attended-only.

| Area | Parts (Risk) |
|---|---|
| Student journey | sign-in and accounts (H) · front door, route access, sandbox (M) · Home, problem-set document, due dates (M) · autosave, crash journal, resume (H) · submit, freeze, late (H) · Grades and viewing a submission (H) |
| Editor | editor frame and canvas interactions (H) · wires, boxes, layout (M) · SC and FSM editors (M) · TM and turbot editors (M) · perception, open and fill-in panels (M) · the store's laws: locks, resets, restarts (H) · sandbox and workbook files (M) |
| Engine and grading | codec, simulators, notation (H) · grader, case runs, score and late math (H) · provenance and integrity (H) |
| Instructor | publishing, assignment editor, question creator (H) · grading tab, regrade, export (H) · roster, feedback queue, notes (H) |
| Server | API, auth and answer stripping (H) · database, config, homework sync (H) |
| Delivery and meta | build, CI and release (H) · pipeline docs, commands, check chains (L) · design system (L) |
| Attended-only | HW1 … HW7 content (7 rows: reading a PDF against its transcription is Gabriel's call, task 009) · the live pilot (ssh) |

**`tasks/tools/check-audit-map.mjs`** keeps the map complete. It uses Node built-ins only,
because portabilityCheck R4 forbids packages in `tasks/tools/`. It checks:
- every tracked file under `app/src`, `server/src`, `deploy`, `app/tools`, `tasks/tools`,
  `.claude/workflows`, `.claude/commands` and `.github` matches some row's Scope;
- every Scope glob matches a file;
- a row touching the hold list is Risk H;
- the header lines parse.

**Curation** is the first step of each tick, never a CI gate, so feature work never has to
touch the map. An orphan file extends the best-fitting row, or starts a new row at M. A row
grown past what one tick can cover (about 25 files) is split, and the log says so.

### 3. Which part tonight

Each Risk has an interval: **H 30 days, M 60, L 90**. A part is **due** when it was never
audited, or when days since its last audit ÷ its interval ≥ 1. The most overdue due part
wins; ties go to the stalest.

A part stamped `PARTIAL` (it had more survivors than the cap) is due again after 7 days.

With 18 scheduled parts, about 12 of them H, **about half the nights nothing is due**, and
the tick exits in seconds.

There is deliberately no "files changed" trigger in v1. Every land already runs the full
gates, and the nightly smoke (§4) is the live regression net. A change trigger that counts
only non-audit lands is a v2 option.

### 4. A tick

1. **Set up.** The deadline, the worktree, and the stamp commit, which is the `HEAD` the
   lanes will read.
2. **Smoke — every tick, due part or not.**
   - A script drives headless Chrome over CDP through a toy student's session: sign in,
     open a homework, place, wire and label, run, wait for autosave, reload and confirm the
     work persisted, submit, open Grades.
   - It runs in local mode, and in remote mode against a scratch server once that harness
     exists.
   - Any uncaught exception, console error or failed step is a bug candidate.
   - It is a script, not an agent, so it costs almost no tokens. It answers Virgil's
     failure 5.
3. **Curate** (§2).
4. **Pick** (§3). If nothing is due and the smoke is clean, stamp nothing, commit nothing,
   and stop.
5. **Sweep.**
   - Run the part's named check tools, by exit code.
   - 2 `Explore` lanes read its Scope through the part's next lens (§5) and return short,
     structured candidates with evidence.
6. **Skeptic.** One `Explore` lane tries to refute every candidate: is it real, intended,
   already handled, or an artefact of the scratch environment? It also rules on
   sensitivity, value class and priority (§6).
7. **Split.** Sensitive survivors leave the tick now, to the private channel (§7). They are
   never capped, counted or named in public.
8. **Dedup and cap.**
   - `git fetch` and `merge --ff-only` first.
   - Drop anything already in `incoming/`, `in-progress/`, `blocked/`, `done/`,
     `wontfix.md`, or the private index.
   - **File at most 2.** Survivors beyond the cap go into the commit body by signature, and
     the part is stamped `PARTIAL`. Nothing is carried in prose.
9. **File.**
   - Mint ids per the README rule. The auditor becomes a minter, and the README's id line
     says so.
   - Each task gets `source: audit` and `finding: <part>::<symptom>`.
10. **Record and push.**
    - Stamp the row and replace its Result.
    - Commit `tasks: audit <part> — N filed (robot)`. The body is the tick's log entry,
      ≤ 1,500 characters.
    - Run `check-budgets.mjs` and `check-disclosure.mjs` (§7) on the staged change, then
      push.
    - If the push is rejected: fetch, `reset --hard origin/main`, re-dedup, re-mint,
      rewrite and retry, at most 3 times.
    - Still rejected: leave `main == origin/main`, the part stays unstamped, and notify
      "records fault".
    - A failing budget check: shorten and re-run. Never push red, because CI red holds
      every release.
11. **Clean up** the worktree and scratch processes.

### 5. Lenses, and how far each may look

**Unattended in v1:**

| Lens | Looks for |
|---|---|
| **correctness** | behaviour contradicting the spec, `CLAUDE.md`, or a landed task's Done-when |
| **gate** | a law or promise held only in prose. The finding is a *census pin*: an assertion over a whole population (every mutating store action, every route, every result shape) that fails until each member is accounted for. A pin like that retires the class, which a single-instance test doesn't (Virgil's 10% of "missed sibling" follow-ups). |

**Attended-only in v1:**
- **integrity:** anything touching answers, self-grading, cross-student data or the
  integrity check. It is sensitive by nature.
- **content:** statement vs PDF, profile vs bank, figures and alt text.
- **visual / design:** screenshots against `VISUAL_VOCAB.md`.

**Scripted, not a lens:** index drift (tool counts and check lists in `CLAUDE.md` and
`PROFILE.md`). `check-audit-map.mjs` prints it, and it is filed at most once a week as one
task.

**The observation ladder.** The cheapest rung that settles the question wins:

| Rung | What the run does |
|---|---|
| L0 | read and grep |
| L1 | a pure-module script (`tsx`: engine, answer stripping, the homework JSON, the CLI grader) |
| L2 | one check tool |
| L3 | the full gates, plus a production build, bundle grepped |
| L4 | the real server on a scratch database, driven as toy principals |
| L5 | headless Chrome on a scratch Vite. `shootProblemSets.mjs` gets its ports parametrized so it can't collide with the work clone's dev server. |

**Evidence** is a command, its exit code, counts and `file:line`. It is never an output
line carrying an email, a 9-digit number, a token, an answer value or a bank row.

### 6. What gets filed, and who decides

**Value class.** The filer proposes it; the skeptic confirms or lowers it.

| Class | Meaning | Filed? |
|---|---|---|
| **a** | user-visible bug | yes |
| **b** | latent correctness bug, or a law violated today | yes |
| **g** | missing census pin | only for a law in `CLAUDE.md`/`PROFILE.md`, or for behaviour on the `high` list below; at most one per tick |
| **h** | hygiene | never filed in v1; one line in Result at most |

**`high` is a closed list.** A finding is `high` only if the skeptic can quote the clause
it meets:
- a correct machine grades wrong, or a wrong one passes;
- student work is lost or corrupted;
- answer material reaches a student;
- a student can grade or alter their own result;
- a student can't open, save or submit homework.

Everything else is `low`. This answers Virgil's failure 3.

**The routing test** (from Virgil): *is it unclear what the app **should do**, or only
**how** to build it?*
- **How** auto-queues into `incoming/`, with both fix shapes and a recommendation in
  `## Design`.
- **Should-do** goes to Gabriel in `blocked/`. The task must complete the sentence "I
  cannot just take my own recommendation because ___" with a reason about behaviour.
- Deep refactors go to `blocked/` as `class: deep-refactor` decision items, never
  auto-queued and never inflated from a contained fix.

**Questions are budgeted:**
- At most one needs-Gabriel item per tick, across every route.
- None while 2 or more audit-born items already wait on him. That counts `blocked/`, plus
  `incoming/` items the robot can't take (`requires: human` or `ssh`).
- Auto-queued fixes still file while questions are blocked. Parking a bug behind a
  question is what Virgil's 2026-08-08 review undid.

**Unanswered questions withdraw themselves.**
- At the start of a tick, an audit-born question older than 14 days is deleted and its
  signature written to `wontfix.md` as `expired`, which dedups for 60 days.
- `/catch` reports the withdrawal, and Gabriel can revive it by saying so.
- `deferred` stays Gabriel's word; the auditor never sets it.

**Every filed task's Done-when names its pin:**
- a census pin where the class has a population;
- a single regression test only for class a, in the owning check tool;
- UI behaviour in the smoke script, never as a source grep;
- no pin parses `CLAUDE.md` or `PROFILE.md` prose.

### 7. Sensitive findings: the public-repo rule

**Private by default.** A finding is private if any of these hold:
- it comes from the integrity lens;
- it is a gate pin that *fails today* on answer secrecy, student data, or a role,
  visibility or session rule;
- its evidence cites answer stripping, auth, identity, passwords, provenance, route guards,
  a bundle grep, or student data;
- it is a grading or bank error on a published, not-yet-due problem that lets a wrong
  answer pass.

A finding is public only when it is none of these, or when its pin passes today.

**The channel is a draft GitHub security advisory.** It is private to the repo's owner,
reachable from either machine with `gh`, and made for "known, not yet disclosed".
- The auditor creates it with one call and never edits, publishes, closes or requests a CVE
  for one. Only Gabriel changes an advisory's state.
- Its title carries the `finding:` signature, and the list of open drafts is the private
  dedup index.
- An open private finding is re-notified at most weekly, never re-filed.
- A rejected one is marked in the advisory, never copied to the public `wontfix.md`.
- `/catch` lists open drafts every session, so discovery never depends on the phone.

**No public trace.**
- The part's Result, commit subject and body are written exactly as if the finding were
  absent.
- An integrity-lens visit's Result is always the fixed text `integrity: visited`.

**A backstop for mislabels: `tasks/tools/check-disclosure.mjs`.** It runs on the staged
change before every audit push.
- It fails on a short list of exploit words (bypass, leak, unguarded, oracle, "another
  student", and so on), email and student-ID shapes, and key material.
- A hit unstages the item, moves it private and notifies.
- A false positive costs one private item; a false negative can't be undone. Phase 1 tunes
  the list.

**The fix.** Gabriel works a private finding attended, on an unpushed branch, never the
robot. It lands with a neutral commit message and a class-wide pin (an inventory, never the
single reported case), and he pushes and hand-releases back to back. While a term is live,
the public task file minted at land carries a neutral title and the pin's name only. No
reproduction of an open gap is ever committed or run against the pilot.

### 8. Students mid-term

**"During term"** means today is on or before the map's `Term ends:` line. If that line is
unset, the fallback is the latest `dueDate` in the repo's homework JSON plus 14 days. The
auditor reads this from the repo, never from the gate or the pilot.

During term:
- **Formats students' saved work depends on.** An audit-born task touching saved workbooks
  (storage, journal, the remote workbook shape), transition-label parsing, or minted
  id/trace formats carries a **compatibility pin** in its Done-when: a committed corpus of
  current-format saves, labels and ids still loads, parses and verifies. Without that pin,
  the robot parks it at land.
- **Grader fixes** follow task 073 unchanged: they ship through the gate.
- **What already applies.** Unattended v1 files no design or hygiene findings, so nothing
  cosmetic moves under a student mid-problem-set. The gate already holds content, answer
  stripping, auth, the database and `deploy/`, waits outside 07–22 PT, and waits in the
  24 h before a due date.

### 9. Volume and cost

**The brakes, each checkable by hand:**
1. **Idle only.** The tick runs only when nothing is eligible, so real work always comes
   first.
2. **Once a night,** 00:00–05:59 PT.
3. **Due parts only** (§3). About half the nights nothing is due.
4. **Weekly budget.** No tick once 7 audit-born task files have been created in the last
   7 days. The count is read from `created:` in the four folders.
5. **Backpressure.** No tick while 3 audit-born tasks the robot *can* take sit open in
   `incoming/` and `in-progress/`.
6. **Yield brake.** After four scheduled ticks in a row with no class a or b filed, audit
   only every third night, until a tick files one or Gabriel resets it in `/catch`.
7. **The questions brake** (§6).

**Cost** (estimates for phase 2 to measure):
- A tick is about 0.2–0.4M tokens: the session plus 3 `Explore` lanes. The smoke and the
  map check are scripts.
- Each filed task then runs one `mm-task` Workflow, about 0.7–1.5M.
- At the weekly cap that is roughly **7–13M tokens a week**, on the account shared with
  Virgil. That compares with Virgil's ~800k per tick at ~4 ticks a day, before its frugal
  rules.

**Notifications:**
- about one morning release note, when the night's lands ship together;
- a private finding (rare);
- "auditor stalled": 3 audit-born tasks no one can take;
- "records fault".

Prerequisite: the gate stops re-notifying an unchanged hold on every new land. That is an
attended `deploy/` change.

### 10. Records

**No audit log file.** The audit commit *is* the log: its subject counts ticks, and its
body holds the narrative, including the signatures of anything dropped at the cap. Git
history is the archive. This retires Virgil's 1.5 MB of ledgers.

| Record | What it is | Budget, in `check-budgets.mjs` |
|---|---|---|
| `AUDIT_MAP.md` | state: header plus rows | ≤ 16 KB; a Result ≤ 120 chars, **replaced** each visit |
| `wontfix.md` | public rejected or expired signatures | ≤ 200 chars a line |

Each new file lands in the same commit as its budget, because the script `stat`s it.

### 11. Is it worth it? Measured, not assumed

**Findings can be judged invalid.** The `mm-task` Plan stage gains one ruling for
`source: audit` tasks: `finding: valid | invalid | duplicate-of <id>`, with evidence.
- Invalid or duplicate: the task closes without code (`status: done`,
  `outcome: invalid|duplicate`, its signature to `wontfix.md`, a `log.md` line). A non-bug
  is never "fixed" and shipped.
- Gabriel's rejections in `/catch` write the same `outcome:`.

**Reporting.** `/catch` adds one digest line: nights audited, filed, invalid, rejected by
Gabriel, clean nights, and the a/b share.

**Review.** After phase 2's first two weeks Gabriel reads those numbers and moves the dials:
the weekly budget, the intervals, and whether to add a second nightly tick.

### 12. Never

**The pilot and private material:**
- No contact with the pilot, the box or Pages, other than the routine's own release step
  before the tick.
- Never run `feedback.mjs`, `pilot-api.mjs` or `release-gate.mjs`.
- Never read `secrets/`, `ssh/`, `rosters/`, `~/making-minds-private/` or any `*.sqlite`.
- Never run the seed, homeworks or roster CLIs except against a fresh temp database with
  the repo's toy roster.

**The auditor writes only `tasks/`:**
- It never edits app code, homework JSON, banks, fixtures or figures.
- Content findings are yes/no questions, filed only by attended `/audit hwN`.

**What may be made public:**
- Never commit a screenshot that is not of toy or sample data.
- Stage explicit paths only.
- Never write an exploit or a reproduction of an open gap anywhere public.
- `gh` is used only to create and list draft advisories.

**Questions it never decides:**
- Never decide product or policy questions.
- Never flag local mode holding answers as a bug; that is by design. Whether any publicly
  reachable build or file should hold them is a question for the private channel, asked
  once.

**Leave nothing behind:**
- Never leave a spawned process, server or browser running.
- Never churn lockfiles.

## Blast radius

**New files:**
- `tasks/AUDITOR.md` (≤ 12 KB)
- `tasks/AUDIT_MAP.md`
- `tasks/wontfix.md`
- `tasks/tools/check-audit-map.mjs`
- `tasks/tools/check-disclosure.mjs`
- the smoke script under `app/tools/`
- `.claude/commands/audit.md`

**Edits to existing files:**

| File | Change |
|---|---|
| `ROBOT-WORK.md` | §2.3 hook; §0 lanes line; §1 stale-deadline rule; §7 notification cases |
| `README.md` | the auditor as a minter; `finding:`, `class:` and `outcome:` in the schema; `source: audit` |
| `CATCHER.md` §1 | audit questions; reject → `outcome:` + `wontfix.md` (public findings only); list draft advisories; the pause and term lines; the digest line |
| `LOOP.md` §2.2 | `low` audit tasks sort last |
| `START.md` | the "Later" note becomes the mechanism, with its pause and off lines |
| `PROFILE.md` | law 9 gains "a sensitive finding never enters git before its fix ships" |
| `.claude/workflows/mm-task.js` | the Plan stage's `finding:` ruling |
| `check-budgets.mjs` | the map, Result-cell and `wontfix.md` budgets |
| `shootProblemSets.mjs` | port parameters |
| work clone settings | deny reads of `secrets/` and `ssh/` |
| `CLAUDE.md` | one "How work flows" bullet, paid for in place |

**Prerequisites:**
- Close 043: phone notifications proven, and the day-after probe.
- Fix the stale "catch starts work" text in `CLAUDE.md`, the two robot command files and
  the live catch routine's prompt.
- Headroom in `CLAUDE.md` and `PROFILE.md`.
- The gate's hold-note fix (attended).
- The smoke script, local mode first.

**Rollout:**

| Phase | Mode | Scope |
|---|---|---|
| 1 | Attended | Build the files and `/audit`. Gabriel runs about five audits on the riskiest parts. Tune the lenses, classes, routing and the disclosure list against what he actually wants filed. |
| 2 | Robot, nightly | The §2.3 hook for two weeks, then the review (§11). |
| v2 dials, only if the numbers justify them | — | the map check reads routes, endpoints, modes and laws too; a change trigger counting non-audit lands; unattended design and visual lenses; a batched hygiene task; a second nightly tick; the remote-mode smoke if not done in phase 1. |

## Open questions for Gabriel

1. **Screens students use.** Should fixes the auditor finds there go live without your
   yes, as grader fixes do since 073? Or should they wait for your yes, like fixes students
   report? Recommended: go live. They are verified and revertible, and they ship
   together each morning, never mid-afternoon.
2. **Budget.** Up to 7 small fixes a week, roughly 7–13M tokens, on the allowance you share
   with Virgil. When the weekly limit runs short, which yields? Recommended: MM's auditor
   pauses first.
3. **Content checks.** Only when you run `/audit hwN` yourself (recommended)? Or
   unattended, adding one yes/no question list per homework to `/catch`?
