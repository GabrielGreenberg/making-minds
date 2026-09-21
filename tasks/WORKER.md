# WORKER — the unattended routine (`/worker`; scheduled hourly once activated)

You are one unattended run. Nobody is watching and nobody can answer a question: read
`tasks/PROFILE.md` first and follow it exactly. Process **exactly one task**, then stop.
No ultracode, no Workflows; at most ~3 `Explore` agents for read-only fan-out with short
structured answers. Never push. Never deploy. Never mint ids. Parking is always better than
doing the wrong thing.

## 1. Pick (first match wins)
1. **Land pending merges** — any `tasks/in-progress/` task at `status: awaiting-merge`
   (verified earlier; the main checkout was busy): go to step 5.
2. **Resume** — else the oldest `in-progress/` task whose `branch:` starts with `fix/` (yours;
   `task/` branches belong to interactive sessions — never touch them). Its worktree still
   exists; read its `## Progress log` — the last entry is the exact next step.
3. **Claim** — else the top `incoming/` task that is **claimable**: `size: small`, empty
   `requires:`, and every `after:` id already in `done/`. Order: urgent > high > normal >
   low, then oldest `created`. Precondition: the main checkout is on `main` and
   `git status --porcelain` is empty — otherwise print one line ("main checkout busy") and
   stop. Claim on `main`: `status: in-progress`, `branch: fix/NNN-slug`, `git mv` →
   `in-progress/`, `git add`, commit `tasks: claim NNN`.
4. **Nothing claimable** — print one line and stop. (The auditor idle mode is not built yet.)

Exactly one task per run. Exception: after a small task lands in under ~10 minutes, you may
take one more `small` task, up to ~20 minutes total.

## 2. Set up
`git -C <repo> log --oneline -1` — HEAD moves between runs; re-check the task's diagnosis
against the current code before trusting it. Create the worktree per PROFILE §4 (both
`node_modules` symlinks). **All edits by absolute path inside the worktree.** Subagents
write to the main checkout, not your worktree — use them read-only only.

## 3. Implement
Implement the `deepFix` by default. Fall back to `surgicalFix` only if the deep fix cannot
land verified in this run; say so in the progress log. A cluster's fix must retire every
`### Members` symptom. Extend the matching `app/tools/*Check.ts` (or server tool) with a pin
wherever the task names a contract. Do not touch `CLAUDE.md` except to update a status line
in place if what's built changed (never append; it must stay ≤ 40 KB).

## 4. Verify — in the worktree, by exit code
`cd`-free, `git -C`/absolute paths. From `<worktree>/app`: `npx tsc -p tsconfig.app.json
--noEmit`, `npm run build`, `npm run check`. From `<worktree>/server`: `npm run typecheck`,
`npm run check`. Anything the task's `## Verify` marks as owed (visual, ssh) stays owed —
write it into the progress log as owed, never as done. Commit on the branch BEFORE any
"neuter the fix to prove the pin catches it" experiment.

## 5. Land-and-clean — PROFILE §5, exactly
Land commit on the branch (`done/` move + `log.md` line). Main checkout on `main` and clean?
No → `status: awaiting-merge` (commit that on the branch), leave the worktree, stop.
Yes → `merge --no-ff`, remove the worktree, delete the branch, stop. A merge conflict →
`git merge --abort`, then escalate (§7).

## 6. Large in practice — checkpoint, don't force
Work to a natural stop (gates green on a coherent unit, or ~20–30 min): append a dated
progress entry with what's done / what remains / the **exact next step**, commit on the
branch (do not merge), leave the file in `in-progress/`, stop.

## 7. Escalate
Ambiguous, underspecified, needs a product decision, a merge conflict needing judgment, or a
fix that won't verify → on `main`: add `## Questions` (exactly what's needed to unblock),
`status: blocked`, `git mv` → `blocked/`, commit `tasks: park NNN`; discard the worktree and
branch (yours only). Stop.

## 8. Report
Print: task id + title, what happened (landed / checkpointed / parked / nothing claimable),
gates run and their results, anything owed. Then stop.
