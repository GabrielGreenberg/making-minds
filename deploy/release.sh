#!/usr/bin/env bash
# deploy/release.sh — put the commit that is on GitHub `main` onto the pilot.
#
#   1. preflight  — you are on main, nothing uncommitted, and HEAD == origin/main
#                   (the box pulls from GitHub, so what you deploy must be pushed)
#   2. the box    — the Lightsail API server backs up its database, pulls that
#                   commit, refreshes the daily backup job from it
#                   (deploy/backup-install.sh), syncs HW1–HW7 from the repo into
#                   its database (npm run homeworks -- sync: untouched copies
#                   refresh, instructor-edited ones are left alone and listed)
#                   and restarts
#                   (needs a key in ssh/; without one the commands to paste into the
#                   Lightsail browser terminal are printed instead)
#   3. the site   — the frontend is built in remote mode and uploaded to Cloudflare
#                   Pages (needs secrets/cloudflare.env)
#   4. proof      — the API answers /api/health and the site serves the new build
#   5. smoke      — the site's script loads and the API's sign-in config answers
#
# Usage:  deploy/release.sh [--dry-run] [--frontend-only] [--box-only]
#         deploy/release.sh --unattended | --check
#   --dry-run        preflight + build, but no ssh and no upload
#   --frontend-only  skip the box (ONLY when server/ and app/src/engine/ did not change)
#   --box-only       skip the site
#   --unattended     for the robot (task 042): ask deploy/release-gate.mjs first and
#                    release only on its "release"; a hold or a wait exits 3 or 4, "nothing
#                    new" exits 0. Prints one `note: …` line for Gabriel (released, held,
#                    or a failed smoke test). A hand run never asks the gate.
#   --check          print the gate's verdict and reasons; release nothing
#
# Knobs (hostnames) live here and in deploy/README.md; the domain swap edits them.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_BASE="https://100-22-69-95.sslip.io"
BOX_HOST="100.22.69.95"
BOX_USER="ubuntu"
PAGES_PROJECT="making-minds"
SITE="https://making-minds.pages.dev"

DRY_RUN=0; DO_BOX=1; DO_SITE=1; UNATTENDED=0; CHECK=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --frontend-only) DO_BOX=0 ;;
    --box-only) DO_SITE=0 ;;
    --unattended) UNATTENDED=1 ;;
    --check) CHECK=1 ;;
    -h|--help) sed -n '2,29p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done
if [ "$UNATTENDED" = 1 ] && { [ "$DRY_RUN" = 1 ] || [ "$DO_BOX" = 0 ] || [ "$DO_SITE" = 0 ] || [ "$CHECK" = 1 ]; }; then
  echo "--unattended releases everything or nothing; it takes no other option" >&2; exit 2
fi

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
fail() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

# --check: the gate's verdict on this checkout's HEAD, and nothing else.
[ "$CHECK" = 1 ] && exec node "$ROOT/deploy/release-gate.mjs"

# ---------------------------------------------------------------- 1. preflight
say "Preflight"
cd "$ROOT"
branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$branch" = "main" ] || fail "You are on '$branch'. Releases come from main: git switch main"
[ -z "$(git status --porcelain --untracked-files=no)" ] \
  || fail "Uncommitted changes. Commit (or stash) them first — the box pulls from GitHub."
git fetch -q origin main
local_sha="$(git rev-parse HEAD)"
remote_sha="$(git rev-parse origin/main)"
[ "$local_sha" = "$remote_sha" ] \
  || fail "Local main ($(git rev-parse --short HEAD)) is not what is on GitHub ($(git rev-parse --short origin/main)). Push first: git push"
short="$(git rev-parse --short HEAD)"
subject="$(git log -1 --format=%s)"
echo "Releasing $short — $subject"

# ---------------------------------------------------------------- the gate (--unattended)
gate_summary=""; gate_last=""
if [ "$UNATTENDED" = 1 ]; then
  say "Release gate"
  mkdir -p "$ROOT/.claude"   # gitignored: remembers the last hold note, so it isn't repeated hourly
  gate_code=0
  gate_json="$(node "$ROOT/deploy/release-gate.mjs" --json --note-state "$ROOT/.claude/release-gate.last")" || gate_code=$?
  case "$gate_code" in
    0) ;;
    5) echo "nothing new to release"; exit 0 ;;
    3|4) exit "$gate_code" ;;   # the gate printed its reasons (and a hold's note)
    *) fail "the release gate failed (exit $gate_code); not releasing" ;;
  esac
  gate_field() { node -e 'const j = JSON.parse(process.argv[1]); console.log(j[process.argv[2]] ?? "")' "$gate_json" "$1"; }
  gate_summary="$(gate_field summary)"
  gate_last="$(gate_field lastReleased)"
fi

# ---------------------------------------------------------------- 2. the box
# Runs on the box as `ubuntu` (passwordless sudo). The repo is owned by the
# service user `makingminds`, whose home ubuntu cannot even read, so every git
# and npm step runs as that user. The backup is a consistent online copy made
# through node:sqlite (`VACUUM INTO`) — the box has node but no sqlite3 CLI.
BOX_SCRIPT=$(cat <<'REMOTE'
set -euo pipefail
DB=/srv/making-minds/data/making-minds.sqlite
BK=/srv/making-minds/data/backup-$(date +%F-%H%M%S).sqlite
REPO=/srv/making-minds/repo
sudo node -e "const {DatabaseSync}=require('node:sqlite');const [db,bk]=process.argv.slice(1);new DatabaseSync(db).exec(\"VACUUM INTO '\"+bk+\"'\")" "$DB" "$BK" \
  || { sudo cp "$DB" "$BK"; sudo cp "$DB-wal" "$BK-wal" 2>/dev/null || true; }
# Owner-only: a backup holds password hashes. (These are the last 7 releases'
# snapshots; the daily ones, kept 35 days, live in /srv/making-minds/backups/.)
sudo bash -c 'chmod 600 /srv/making-minds/data/backup-*.sqlite* 2>/dev/null || true'
sudo bash -c 'ls -t /srv/making-minds/data/backup-*.sqlite 2>/dev/null | tail -n +8 | xargs -r rm -f'
echo "backup: $BK"
before=$(sudo -u makingminds -H git -C "$REPO" rev-parse --short HEAD)
# npm's output is never a hand edit: a lockfile npm rewrote in this clone (npm run
# in the wrong folder, or the box's npm differing) is restored, so it can never block
# the pull (task 060). Any other edit is kept and reported, below.
for f in $(sudo -u makingminds -H git -C "$REPO" diff --name-only HEAD -- '*package-lock.json'); do
  sudo -u makingminds -H git -C "$REPO" checkout HEAD -- "$f"
  echo "discarded npm's rewrite of $f"
done
dirty=$(sudo -u makingminds -H git -C "$REPO" status --porcelain)
[ -z "$dirty" ] || printf 'note: uncommitted edits on the box (kept; the pull fails if they collide):\n%s\n' "$dirty"
sudo -u makingminds -H git -C "$REPO" pull --ff-only -q
after=$(sudo -u makingminds -H git -C "$REPO" rev-parse HEAD)
if [ -n "${EXPECT:-}" ] && [ "$after" != "$EXPECT" ]; then
  echo "warning: box pulled ${after:0:7}, the release is ${EXPECT:0:7} (GitHub main moved?)" >&2
fi
sudo -u makingminds -H bash -c "cd '$REPO/server' && npm install --no-audit --no-fund --silent"
# The daily backup job (task 041) follows the repo like the code does. A
# failure stops the release before the restart: no release without backups.
sudo bash "$REPO/deploy/backup-install.sh"
# Homework content follows the repo like code does (server/src/homeworks.ts).
# A failure stops the release before the restart; the old server keeps running.
echo "homeworks:"
sudo -u makingminds -H bash -c "cd '$REPO/server' && NODE_NO_WARNINGS=1 MM_DB_PATH='$DB' npm run --silent homeworks -- sync"
sudo systemctl restart makingminds-api
for i in $(seq 1 30); do
  curl -fsS http://127.0.0.1:8133/api/health >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS http://127.0.0.1:8133/api/health; echo
echo "box: $before -> ${after:0:7}"
REMOTE
)
BOX_RUN="EXPECT=$local_sha"$'\n'"$BOX_SCRIPT"

if [ "$DO_BOX" = 1 ]; then
  say "The API box ($BOX_HOST)"
  key="$(ls "$ROOT"/ssh/*.pem 2>/dev/null | head -1 || true)"
  [ -n "$key" ] || key="$(find "$ROOT/ssh" -maxdepth 1 -type f 2>/dev/null | head -1 || true)"
  if [ -z "$key" ]; then
    cat <<EOF
No key in $ROOT/ssh/ — update the box by hand this time:
  Bruin Cloud (https://bruincloud.awsapps.com/start) → Lightsail → the instance →
  "Connect using SSH", then paste:

$BOX_RUN

(One-time fix: on that same instance page, "Download default key" into
$ROOT/ssh/ and this script does it for you next time.)
EOF
    [ "$DRY_RUN" = 1 ] || fail "Box not updated. Re-run with --frontend-only after pasting the above, or add the key."
  elif [ "$DRY_RUN" = 1 ]; then
    echo "dry run: would ssh -i $key $BOX_USER@$BOX_HOST and run the update"
  else
    chmod 600 "$key"
    ssh -i "$key" -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o LogLevel=ERROR \
      -o ConnectTimeout=15 "$BOX_USER@$BOX_HOST" 'bash -s' <<<"$BOX_RUN"
    curl -fsS "$API_BASE/api/health" >/dev/null || fail "API not healthy at $API_BASE after restart"
    echo "public API healthy: $API_BASE/api/health"
  fi
fi

# ---------------------------------------------------------------- 3. the site
if [ "$DO_SITE" = 1 ]; then
  say "The site ($SITE)"
  [ -f "$ROOT/secrets/cloudflare.env" ] \
    || fail "Missing $ROOT/secrets/cloudflare.env (CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID)"
  set -a; # shellcheck disable=SC1091
  source "$ROOT/secrets/cloudflare.env"; set +a
  [ -n "${CLOUDFLARE_API_TOKEN:-}" ] && [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] \
    || fail "secrets/cloudflare.env must set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID"

  cd "$ROOT/app"
  echo "building in remote mode against $API_BASE ..."
  VITE_BASE_PATH=/ VITE_API_BASE="$API_BASE" npm run build --silent
  if [ "$DRY_RUN" = 1 ]; then
    echo "dry run: built app/dist ($(du -sh dist | cut -f1)); not uploading"
  else
    npx --yes wrangler@4 pages deploy dist --project-name "$PAGES_PROJECT" --branch main \
      --commit-hash "$local_sha" --commit-message "$subject" --commit-dirty=false
    # The production alias follows the new deployment within seconds; prove it.
    for i in $(seq 1 12); do
      if curl -fsS "$SITE/" | cmp -s - dist/index.html; then
        echo "live: $SITE serves build $short"; break
      fi
      [ "$i" = 12 ] && echo "warning: $SITE not serving the new index.html yet (the deployment URL above is)"
      sleep 5
    done
  fi
fi

# ---------------------------------------------------------------- 5. smoke
# Past "it answers": the page's own script loads, and the API answers the call
# the sign-in screen makes first.
if [ "$DRY_RUN" = 0 ] && [ "$DO_SITE" = 1 ] && [ "$DO_BOX" = 1 ]; then
  say "Smoke test"
  smoke_fail=""
  index="$(curl -fsS "$SITE/")" || smoke_fail="the site did not answer"
  js="$(printf '%s' "$index" | grep -o '/assets/[^"]*\.js' | head -1 || true)"
  [ -n "$smoke_fail" ] || [ -n "$js" ] || smoke_fail="the site's page names no script"
  [ -n "$smoke_fail" ] || curl -fsS -o /dev/null "$SITE$js" || smoke_fail="the site's script $js did not load"
  config="$(curl -fsS "$API_BASE/api/auth/config" 2>/dev/null || true)"
  [ -n "$smoke_fail" ] || [[ "$config" == *'"mode"'* ]] || smoke_fail="the API's sign-in configuration did not answer"
  if [ -n "$smoke_fail" ]; then
    if [ "$UNATTENDED" = 1 ]; then
      echo "note: Released $short, but the smoke test FAILED: $smoke_fail. The last good release was ${gate_last:0:7}; revert to it and release by hand."
    fi
    fail "smoke test failed: $smoke_fail"
  fi
  echo "smoke: the site's script loads and the API's sign-in configuration answers"
fi

say "Done"
[ "$DRY_RUN" = 1 ] && echo "(dry run — nothing was deployed)"
[ "$UNATTENDED" = 1 ] && echo "note: Released $short — ${gate_summary:-$subject}."
exit 0
