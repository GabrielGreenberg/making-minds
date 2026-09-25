#!/usr/bin/env bash
# deploy/backup-install.sh — install or refresh the daily backup job on the box (task 041).
#
# Idempotent; run as root. release.sh runs it from the box's clone on every release, so
# the box always carries the repo's version of the job; by hand:
#   sudo bash /srv/making-minds/repo/deploy/backup-install.sh
# Copies deploy/backup-daily.sh to /usr/local/lib/making-minds/ (the job never runs
# from the clone, which a release may be halfway through updating), installs the units in
# deploy/systemd/, creates the owner-only backup directory, enables the timer, and prints
# its state.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB=/usr/local/lib/making-minds
DIR=/srv/making-minds/backups/daily
[ "$(id -u)" = 0 ] || { echo "backup-install: run as root (sudo)" >&2; exit 1; }

install -d -m 755 "$LIB"
install -m 755 "$HERE/backup-daily.sh" "$LIB/backup-daily.sh"
install -d -o makingminds -g makingminds -m 700 /srv/making-minds/backups "$DIR"

changed=0
for unit in makingminds-backup.service makingminds-backup.timer; do
  if ! cmp -s "$HERE/systemd/$unit" "/etc/systemd/system/$unit"; then
    install -m 644 "$HERE/systemd/$unit" "/etc/systemd/system/$unit"
    changed=1
  fi
done
[ "$changed" = 0 ] || systemctl daemon-reload
systemctl enable --now --quiet makingminds-backup.timer

next=$(systemctl show makingminds-backup.timer -p NextElapseUSecRealtime --value)
latest=$(ls -t "$DIR"/daily-*.sqlite 2>/dev/null | head -1 || true)
echo "daily backup: timer $(systemctl is-active makingminds-backup.timer), next ${next:-unknown}; latest ${latest:-none yet}"
