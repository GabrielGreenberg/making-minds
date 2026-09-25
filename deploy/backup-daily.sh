#!/usr/bin/env bash
# deploy/backup-daily.sh — the pilot database's daily backup (task 041).
#
# Run once a day on the box by makingminds-backup.timer (deploy/systemd/), as
# the service user. Writes a consistent online copy of the live database
# (VACUUM INTO through node:sqlite — the box has node but no sqlite3 CLI),
# checks the copy (PRAGMA integrity_check) before it counts, and keeps
# KEEP_DAYS days of them. Its own directory and file names (daily-*.sqlite),
# so it and release.sh's pre-release backups (data/backup-*.sqlite, the last
# 7) can never prune each other's files. The copies hold password hashes:
# owner-only (umask 077).
#
# Installed and refreshed by deploy/backup-install.sh (release.sh runs it on
# every release). Restore: deploy/README.md §"Backups".
# Env (defaults = the box): MM_DB_PATH, MM_BACKUP_DIR, MM_BACKUP_KEEP_DAYS.
# Pinned by server/tools/backupCheck.ts.
set -euo pipefail
umask 077

DB="${MM_DB_PATH:-/srv/making-minds/data/making-minds.sqlite}"
DIR="${MM_BACKUP_DIR:-/srv/making-minds/backups/daily}"
KEEP_DAYS="${MM_BACKUP_KEEP_DAYS:-35}"
export NODE_NO_WARNINGS=1

[ -f "$DB" ] || { echo "backup: no database at $DB" >&2; exit 1; }
mkdir -p "$DIR"
out="$DIR/daily-$(date +%F).sqlite"
tmp="$out.partial"
trap 'rm -f "$tmp"' EXIT
rm -f "$tmp"

# The copy is made under a temporary name and only renamed into place once it
# passes the integrity check, so a daily-*.sqlite file is always a good one.
node - "$DB" "$tmp" <<'JS'
const { DatabaseSync } = require('node:sqlite');
const [src, dst] = process.argv.slice(-2);
const live = new DatabaseSync(src);
live.exec(`VACUUM INTO '${dst.replace(/'/g, "''")}'`);
live.close();
const copy = new DatabaseSync(dst, { readOnly: true });
const verdict = Object.values(copy.prepare('PRAGMA integrity_check').get())[0];
copy.close();
if (verdict !== 'ok') {
  console.error(`backup: the copy failed its integrity check (${verdict})`);
  process.exit(1);
}
JS
mv -f "$tmp" "$out"

# Retention: only this job's own files, by age.
find "$DIR" -maxdepth 1 -type f -name 'daily-*.sqlite' -mtime +"$KEEP_DAYS" -delete
kept=$(find "$DIR" -maxdepth 1 -type f -name 'daily-*.sqlite' | wc -l | tr -d ' ')
echo "backup: $out ($(du -h "$out" | cut -f1)); $kept daily copies kept (up to $KEEP_DAYS days)"
