#!/usr/bin/env bash
# deploy/release.sh — put the commit that is on GitHub `main` onto the pilot.
#
#   1. preflight  — you are on main, nothing uncommitted, and HEAD == origin/main
#                   (the box pulls from GitHub, so what you deploy must be pushed)
#   2. the box    — the Lightsail API server pulls that commit and restarts
#                   (needs a key in ssh/; without one the commands to paste into the
#                   Lightsail browser terminal are printed instead)
#   3. the site   — the frontend is built in remote mode and uploaded to Cloudflare
#                   Pages (needs secrets/cloudflare.env)
#   4. proof      — the API answers /api/health and the site serves the new build
#
# Usage:  deploy/release.sh [--dry-run] [--frontend-only] [--box-only]
#   --dry-run        preflight + build, but no ssh and no upload
#   --frontend-only  skip the box (ONLY when server/ and app/src/engine/ did not change)
#   --box-only       skip the site
#
# Knobs (hostnames) live here and in deploy/README.md; the domain swap edits them.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_BASE="https://100-22-69-95.sslip.io"
BOX_HOST="100.22.69.95"
BOX_USER="ubuntu"
PAGES_PROJECT="making-minds"
SITE="https://making-minds.pages.dev"

DRY_RUN=0; DO_BOX=1; DO_SITE=1
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --frontend-only) DO_BOX=0 ;;
    --box-only) DO_SITE=0 ;;
    -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
fail() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

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
sudo bash -c 'ls -t /srv/making-minds/data/backup-*.sqlite 2>/dev/null | tail -n +8 | xargs -r rm -f'
echo "backup: $BK"
before=$(sudo -u makingminds -H git -C "$REPO" rev-parse --short HEAD)
dirty=$(sudo -u makingminds -H git -C "$REPO" status --porcelain)
[ -z "$dirty" ] || printf 'note: uncommitted edits on the box (kept; the pull fails if they collide):\n%s\n' "$dirty"
sudo -u makingminds -H git -C "$REPO" pull --ff-only -q
after=$(sudo -u makingminds -H git -C "$REPO" rev-parse HEAD)
if [ -n "${EXPECT:-}" ] && [ "$after" != "$EXPECT" ]; then
  echo "warning: box pulled ${after:0:7}, the release is ${EXPECT:0:7} (GitHub main moved?)" >&2
fi
sudo -u makingminds -H bash -c "cd '$REPO/server' && npm install --no-audit --no-fund --silent"
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

say "Done"
[ "$DRY_RUN" = 1 ] && echo "(dry run — nothing was deployed)"
exit 0
