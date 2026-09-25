---
id: 2026-09-25-041
type: chore
title: Back up the pilot database daily and keep the copies for weeks, independent of releases
priority: high
size: small
requires: ssh
area: deploy
source: chat
created: 2026-09-25T10:00:00-07:00
status: done
after:
branch:
merged_into:
---

## Description
Split from 008 (2026-09-25, `/work` with Gabriel), whose other half (a real domain) waits on
UCLA. Today the only backups are the ones `deploy/release.sh` takes before each release, and
it keeps the **last 7** (`backup-*.sqlite` in `/srv/making-minds/data/`). Once the robot
pipeline (029) releases up to hourly, that rotation is ~7 hours of history: a bad change
noticed the next day would have no clean copy left. **This is the hard prerequisite of 042
and 029.**

## Done when
1. A daily job on the box (systemd timer or cron, as the `makingminds` user) writes a
   WAL-safe copy (`VACUUM INTO`, as `release.sh` already does via `node:sqlite` — the box has
   no `sqlite3` CLI) to a dated file in a SEPARATE directory from the release backups
   (e.g. `/srv/making-minds/backups/daily/`), keeping **35 days**.
2. The release backups keep their own rotation, untouched by the daily one (neither job can
   delete the other's files).
3. `deploy/README.md` documents both (where, how long, how to restore: stop the service, copy
   a backup over the DB, start) and the install recipe, so the timer can be recreated on a
   new box.
4. The job's script lives in the repo (`deploy/backup-daily.sh` or similar) and the install
   is idempotent; `release.sh` checks the timer is present and warns if not.

## Design
- **deepFix:** backups on their own schedule and rotation, independent of how often we
  release; the recipe in the repo so the box is rebuildable.
- **surgicalFix:** raise the release rotation from 7 to ~200. Rejected: history length would
  still depend on release frequency (zero releases for a month = one backup a month).
- Off-box copies (S3 / Lightsail snapshots) are a later step; note it in the README.
- Pointers: `deploy/release.sh` (its `VACUUM INTO` backup step and the keep-7 rotation),
  `deploy/README.md` §1, the box facts in the memory note on Lightsail access (repo at
  `/srv/making-minds/repo`, DB at `/srv/making-minds/data/making-minds.sqlite`, service
  `makingminds-api`, `sudo -u makingminds -H …`).

## Verify
On the box: trigger the timer once by hand → a dated file appears and opens (a read-only
`node:sqlite` count of `users`); `systemctl list-timers` shows the next run; a restore
rehearsal into a scratch path boots `npm start` against it. Owed: a copy aged past 35 days
is pruned (check after five weeks, or rehearse with a back-dated file).

## Progress log
- 2026-09-25 (`/work`): built and installed. `deploy/backup-daily.sh` (VACUUM INTO →
  integrity check under `.partial` → rename; prunes only `daily-*.sqlite` past 35 days;
  umask 077), `deploy/systemd/makingminds-backup.{service,timer}` (User=makingminds, runs the
  INSTALLED copy `/usr/local/lib/making-minds/backup-daily.sh`, 03:30 America/Los_Angeles,
  Persistent), `deploy/backup-install.sh` (idempotent, root). Done-when 4 went further than
  "warn": `release.sh` runs the installer on every release and a failure stops the release
  before the restart. Release backups made owner-only (they were 644 with password hashes),
  on the box now and in `release.sh`. `server/tools/backupCheck.ts` (23 pins, in server
  `check`; neutered: umask 022 + a `*.sqlite` prune → 2 FAIL; a plain file copy that loses
  the WAL → 3 FAIL). On the box: installed by piping the three files over ssh (no release, so
  036 was not shipped with it); a hand run wrote `daily-2026-09-25.sqlite` (464K, 600); live
  vs copy row counts equal (users 92, feedback 1, assignments 8, submissions 5, workbooks 13),
  integrity ok on both; a restore rehearsal booted a scratch server on 127.0.0.1:8199 from
  the copy (health + auth config answered), then removed (a self-matching `pkill` cut the
  first cleanup short; the leftover temp copy was deleted and the port freed by hand); the
  real API healthy throughout. All gates green. Owed: the first scheduled run (tonight 03:33
  Pacific — `systemctl list-timers makingminds-backup.timer`, `journalctl -u
  makingminds-backup`) and pruning at day 36 on the box (pinned locally with back-dated files).
