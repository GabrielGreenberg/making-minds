# `tasks/` — the task queue (the store of record)

Every piece of work on Making Minds bigger than a one-line fix flows through this folder.
It is **committed to the repo on purpose**: git is the sync transport, so any machine with a
checkout can add to it (drop a note in `inbox/`, push), and the queue's history *is* the
project's history from 2026-09-21 on (`done/` + `log.md`; the earlier changelog is frozen in
`docs/HISTORY.md`).

Three roles read it, each a thin slash command in `.claude/commands/` that points at the
prompt file here:

| Command | Prompt | What it is |
| --- | --- | --- |
| `/catch` | `CATCHER.md` | Interactive. You describe problems and ideas; it diagnoses, files task files, and surfaces parked questions. Writes only under `tasks/`. |
| `/work` | `WORK.md` | Interactive. Surveys the queue, proposes merges, offers options; you pick one; the session works it in depth on a `task/NNN-slug` branch and lands it. |
| `/work-loop` | `LOOP.md` | Attended loop, started as `/loop /work-loop`. `/work` without the picking: works the ready queue one task at a time (one Workflow per task), lands each, parks what needs you as questions, stops when nothing more can move. Never pushes unless given `push`/`release`. |
| `/worker` | `WORKER.md` | Unattended routine (written, **not yet scheduled** — `START.md`). Claims ONE `size: small` task, fixes it in a worktree, verifies, merges to `main`, logs. |

Every role reads `PROFILE.md` first — the shared operating context (git rules, gates, laws,
context budget).

## Layout

```
tasks/
  README.md       this file: schema, the id rule, lifecycle, sizing
  PROFILE.md      shared operating context — read first by every role
  CATCHER.md      the catcher prompt
  WORK.md         the interactive work-session prompt
  WORKER.md       the unattended routine prompt
  START.md        how to launch each role; how to activate the routine later
  inbox/          raw dumps awaiting the catcher (notes, pasted reports, dictation)
    _processed/   raw items after filing — kept, never deleted
  incoming/       diagnosed, ready to work            ← claims come from here
  in-progress/    claimed; one file per active task
  blocked/        parked with a `## Questions` section for the human
  done/           landed (merged to main), or merged into another task
  attachments/    screenshots etc. referenced by tasks, named <id>-<n>.<ext>
  log.md          append-only: one line per landed task
  tools/          next-id.mjs (id minting) · check-budgets.mjs (the size guard) ·
                  feedback.mjs (app feedback reports → a private copy; CATCHER §3)
```

## Task file

One markdown file per task, `incoming/<id>-<slug>.md`:

```
---
id: 2026-09-21-004          # see "The id rule" below
type: feature               # bug | feature | chore | research | other
title: Box a sequential sub-circuit   # imperative, specific — never "boxing bug"
priority: normal            # low | normal | high | urgent
size: large                 # small | large | unknown — small = the routine may claim it (see Sizing)
requires:                   # optional, any of: browser, ssh, human — the routine never claims these
area: app                   # optional: app | server | deploy | docs | pipeline
source: chat                # chat | inbox | feedback | audit | claude-md | <detector>
created: 2026-09-21T15:00:00-07:00
status: ready               # ready | in-progress | awaiting-merge | blocked | deferred | merged | done
after:                      # optional: id that must land before this one may be claimed
branch:                     # set on claim (task/NNN-slug or fix/NNN-slug); cleared on land
merged_into:                # status: merged only — the surviving task's id
---

## Description
What's wrong / what to build, in plain terms. Provenance for anything that came from
outside chat (inbox file name, feedback report id, machine).

## Done when
Concrete, checkable acceptance criteria. THIS is what lets a worker know it is finished.
A task without a real "Done when" is not `ready`: the catcher parks it, or `/work`
diagnoses it with you before starting.

## Design
- **deepFix:** the unified solution that retires the whole class and improves the app.
- **surgicalFix:** the minimal patch, for contrast / fallback.
- `file:line` pointers, the root-cause mechanism, which seams it goes through.
- `### Members` — for a cluster: every symptom this one fix retires, with its source.
- `### Resolved decisions` — the human's answers, recorded when a blocked task is released.

## Verify
How to prove it: which gates (PROFILE.md §Gates), which check tool to extend, a live
recipe for the browser preview, and anything that can't be verified in the dev environment
("owed, not claimed").

## Progress log
<!-- dated entries appended across sessions/runs; empty at intake. The LAST entry always
     states the exact next step, so a fresh session can resume cold. -->
```

`## Questions` exists only while a task is in `blocked/`: exactly what is needed to unblock,
in plain language. It is cleared (answers moved into `### Resolved decisions`) on release.

**Types.** `bug` (reproduce, fix, test, land) · `feature` (implement to the acceptance
criteria) · `chore` (mechanical change) · `research` (investigate; write `## Findings`;
usually no code) · `other` (act only if confidently actionable, else park).

## The id rule (stated here only — every minter cites this line)

`YYYY-MM-DD-NNN`. The date is the mint date. **NNN is global**: one past the highest NNN
found anywhere in `incoming/`, `in-progress/`, `blocked/`, `done/`, regardless of date.
Run `node tasks/tools/next-id.mjs` immediately before writing, write, run it again; on a
collision, rename. Never re-issue a retired number. The worker never mints ids while
working a task; only the catcher and `/work` mint (and, later, the auditor).

## Lifecycle

```
  human ─describes─▶ /catch ─diagnoses─▶ incoming/ ─claims─▶ /work or /worker ─lands─▶ done/ + log.md
    ▲                                                              │
    │  surfaces parked questions; human answers; released ◀─ blocked/ ◀── can't decide alone
```

Statuses: `ready` → `in-progress` → (`awaiting-merge`, worker only, if the main checkout was
busy) → `done`; or → `blocked` → (answered) `ready`; or `deferred` ("real value, not now,
don't re-surface" — the human's call; stays in `blocked/` with a dated note); or `merged`
(absorbed into another task: `merged_into:` set, file moved to `done/`).

**Queue state lives on `main`; code lives on branches.** Concretely:

- **Claim** — on `main`: set `status: in-progress` and `branch:`, `git mv` the file to
  `in-progress/`, commit (`tasks: claim NNN`). *Then* cut the branch. A claim that isn't on
  `main` is invisible to other sessions, which is how something gets picked up twice.
- **Checkpoint** — on the branch: append to `## Progress log`, commit with the code.
- **Land** — on the branch: `status: done`, clear `branch:`, final progress entry, `git mv`
  to `done/`, append the `log.md` line, commit (`tasks: land NNN`); then merge `--no-ff` into
  `main` and delete the branch. Exact commands: `PROFILE.md` §Landing.
- **Park** — on `main`: add `## Questions`, `status: blocked`, `git mv` to `blocked/`, commit.
  `/work` keeps the branch (note it in the file); the worker discards its worktree.
- **Release** — the catcher, on `main`: answers into `### Resolved decisions`, remove
  `## Questions`, `status: ready`, `git mv` back to `incoming/`, commit.

## Sizing (what `size:` means)

`small`: one bounded change that the gates alone can verify — no browser eyeball, no
credentials, no product decision, roughly one unattended run (≲ 30 min) — and nothing in
`requires:`. Anything else is `large`. Unsure → `unknown` (treated as large). Only `small`
tasks are ever claimed by the routine; `large`/`unknown` are worked interactively with the
human in `/work`. This split is what lets both workers run side by side.

## `log.md` line

`<id> · <type> · <title> · <landed ISO> · <branch> · <last code commit sha>` — one line, ≤ 300
characters (enforced by `tools/check-budgets.mjs`). Narrative lives in the task file, not here.
