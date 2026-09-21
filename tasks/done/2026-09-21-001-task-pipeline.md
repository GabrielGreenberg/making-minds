---
id: 2026-09-21-001
type: chore
title: Set up the task pipeline (catcher / work / worker) and shrink CLAUDE.md to an index
priority: high
size: large
requires:
area: pipeline
source: chat
created: 2026-09-21T14:40:00-07:00
status: done
after:
branch:
merged_into:
---

## Description
Gabriel wants a committed task queue with three roles: a catcher session to file diagnosed
tasks, an interactive work session that offers options and works one task in depth, and an
unattended worker routine (written now, activated later, small tasks only). Template: the
Virgil pipeline handoff (`~/Downloads/HANDOFF-task-pipeline-template.md`). Differences from
Virgil: the queue lives in the repo (git is the sync transport, so no remote-inbox role) and
there is an interactive work role.

## Done when
- `tasks/` exists with README (schema + the one id rule), PROFILE, CATCHER, WORK, WORKER,
  START, the state directories, `log.md`, `tools/next-id.mjs`, `tools/check-budgets.mjs`.
- `/catch`, `/work`, `/worker` commands exist; `/handoff` is retired; `todos/fixes.md` moved
  into the inbox for verification.
- `CLAUDE.md` ≤ 40 KB, the changelog frozen in `docs/HISTORY.md`, the size guard runs in CI
  and in app `npm run check`; `claudeMdExcludes` set for worktrees.
- The known backlog from CLAUDE.md "What's next" is filed as tasks.

## Design
- **deepFix (chosen):** queue state on `main`, code on branches; one landing procedure shared
  by both workers; a `size:` + `requires:` gate so the routine can coexist with interactive
  work by construction; every rule stated in one file and cited elsewhere.
- **surgicalFix:** a TODO.md list. Rejected: no diagnosis, no claim semantics, no history.

## Verify
`node tasks/tools/check-budgets.mjs` exits 0; `node tasks/tools/next-id.mjs` prints the next
id; app `tsc` + `npm run check` and server `npm run check` green (package.json changed).

## Progress log
- 2026-09-21 — Built everything in one session; CLAUDE.md 135 KB → index; changelog frozen;
  17 tasks seeded (002–018), two of them parked in `blocked/` with questions for Gabriel.
  Landed via `task/001-task-pipeline` → `main` (merge commit). Not pushed. Next step: none —
  the first `/catch` should verify `tasks/inbox/legacy-fixes-md.md`.
