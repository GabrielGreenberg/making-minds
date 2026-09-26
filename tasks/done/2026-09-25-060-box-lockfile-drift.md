---
id: 2026-09-25-060
type: bug
title: Keep npm's lockfile rewrites on the pilot box from blocking a release — drop the stray root lockfile, discard npm drift before the pull
priority: high
size: small
requires:
area: deploy
source: chat
created: 2026-09-25T15:40:00-07:00
status: done
after:
branch:
merged_into:
---

## Description
Gabriel's hand release of 029 (2026-09-25, box `91931d8 → 6bce813`) printed "note:
uncommitted edits on the box (kept; the pull fails if they collide): M package-lock.json".
Harmless that time, but the box's `git pull --ff-only` refuses the day a commit touches that
file — a failed release, and with the robot (029) releasing unattended, a failed release
every hour until someone ssh-es in.

## Done when
1. The stray root `package-lock.json` is gone from git and ignored at the root.
2. `deploy/release.sh`'s box step discards npm's rewrites of tracked lockfiles before it
   pulls (said in its output), so npm output can never block a pull; any other edit on the box
   is still kept and reported, as now.
3. `deploy/README.md`'s by-hand update runs npm in `server/`.
4. A pin in `server/tools/releaseGateCheck.ts` [release.sh]; all gates green.

## Design
- **Root cause:** the repo root holds a tracked, empty `package-lock.json` (no `package.json`
  beside it — committed by accident in `e98a1b5` "wire crossing", 2026-04). npm writes one
  wherever `npm install` runs without a `package.json`; `deploy/README.md:113` tells whoever
  updates the box by hand to run `git pull && npm install` from the repo root, and npm then
  rewrote the file's `name` to the folder's (`"making-minds"` → `"repo"`, seen on the box by
  a read-only ssh diff). `server/package-lock.json` on the box is clean.
- **Class:** npm output (lockfiles) drifting in the box's clone — the root one now, a
  `server/` one the day the box's npm differs from the laptop's — and any drift in a tracked
  file blocks `git pull --ff-only` once an incoming commit touches it.
- **deepFix (taken):** remove the source (delete + ignore the root lockfile; the README runs
  npm in `server/`), and make the release immune to the class: before the pull, the box
  restores every tracked `package-lock.json` npm rewrote (`git checkout --`), saying so;
  other edits stay "kept and reported". `npm ci` instead of `npm install` was considered and
  not taken: it deletes `node_modules` under the still-running server for the install's
  duration, and the guard already makes lockfile drift harmless.
- **surgicalFix:** ssh in once and `git checkout -- package-lock.json` — fixes today, not the
  next drift.
- This touches `deploy/`, so the gate holds it for Gabriel's hand release — which is also the
  release that applies it to the box.

## Verify
Gates (PROFILE §6); `releaseGateCheck` [release.sh] pins the discard-before-pull.
**Owed:** Gabriel's next hand release prints "discarded npm's rewrite of package-lock.json"
and no "uncommitted edits" note, and the box's clone is clean afterwards
(`git -C /srv/making-minds/repo status --porcelain` empty, as `makingminds`).

## Progress log
- 2026-09-25 (`/work`) — Filed and claimed from the 029 release output at Gabriel's ask
  ("complete it here"); diagnosed with a read-only ssh diff of the box's clone.
- 2026-09-25 (`/work`) — Landed. The box snippet was run against a scratch repo (a drifted
  root and `server/` lockfile + an unrelated edit): both lockfiles restored with the message,
  the edit kept. Gates by exit code: app `tsc` 0, build 0, `npm run check` 0, server
  typecheck 0, server check 0. **Owed:** Gabriel's next hand release (the gate holds
  `deploy/` changes) — expect "discarded npm's rewrite of package-lock.json", no
  "uncommitted edits" note, and a clean clone on the box after.
