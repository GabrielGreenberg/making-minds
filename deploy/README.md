# Deployment — AWS Lightsail (API) + Cloudflare Pages (frontend)

Everything here is ready to go the day the UCLA AWS account lands. The
architecture:

```
student browser
   ├── https://<pages-domain>            Cloudflare Pages — static frontend (app/dist)
   └── https://api.<domain>              Caddy (TLS) → Node API on :8133 (Lightsail)
                                            └── SQLite at /srv/making-minds/data/
```

The frontend is a static SPA (hash routing — no redirect rules needed). The API
holds the test cases and does all grading; CORS restricts it to the Pages
origin.

## 0. Routine release — what to run after every push to `main`

```sh
deploy/release.sh              # box (backup + git pull + backup job + homework sync + restart) → site (build + upload) → proof → smoke
deploy/release.sh --dry-run    # preflight + build only, nothing deployed
deploy/release.sh --check      # the release gate's verdict on HEAD, with every reason; releases nothing
deploy/release.sh --unattended # the robot's release: only if the gate says so (task 042)
```

**The release gate** (`deploy/release-gate.mjs`, task 042) decides whether an
*unattended* release may go out now: **release**, **hold** (the new commits
touch the hold list — grading, homework content and answer keys, what students
may see, sign-in, passwords, the database schema, `deploy/` itself — the daily
backups aren't running, or CI failed on the commit; Gabriel releases by hand),
**wait** (outside 07:00–22:00 Pacific, within 24 h before a published assignment
is due, CI still running or not yet run on the commit, or the box / the pilot
API / GitHub can't be asked; a later run releases), or **current** (nothing new,
or only the task queue, docs or session config changed — the robot pushes those
hourly). The strictest reason wins; every rule is data at the top of the file,
with a comment. It reads what the box runs and whether its backups are alive over
ssh, the due dates from the pilot API as an instructor (`secrets/feedback.env`,
the same sign-in as `tasks/tools/feedback.mjs`), and HEAD's CI run with `gh`. `--unattended` ends with one
`note: …` line for Gabriel: what was released, what is held and why (said once,
not every hour — `.claude/release-gate.last` remembers), or a failed smoke test
with the last good commit. A hand run never asks the gate: Gabriel's release is
the override.

**Homework content ships with every release.** The box step runs
`npm run homeworks -- sync` (server/src/homeworks.ts): HW1–HW7 in
`app/src/devData/homeworks/` are copied into the database — a missing one is added
(unpublished), a copy nobody has edited on the pilot is refreshed to the repo's
version (keeping its order, due date, publish/release flags and submissions), and a
copy an instructor edited in the dashboard is left alone and listed in the release
output. "Nobody has edited it" means its content equals a committed version of its
file or a version an earlier sync wrote. To overwrite an edited copy on purpose, on
the box: `cd /srv/making-minds/repo/server && sudo -u makingminds -H
MM_DB_PATH=/srv/making-minds/data/making-minds.sqlite npm run homeworks -- sync
--force=hw3` (`-- status` previews without writing).

It refuses to run unless local `main` is clean and identical to GitHub's, because
the box pulls from GitHub — so the site can never be built from a commit the box
cannot reach. It needs two gitignored things: `secrets/cloudflare.env`
(`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) for the site, and a private key
in `ssh/` for the box. **One-time setup for the key:** Bruin Cloud
(https://bruincloud.awsapps.com/start) → Lightsail → the instance → Connect tab →
"Download default key" (`LightsailDefaultKey-us-west-2.pem`) into `ssh/`. Until then the script prints the update
commands to paste into Lightsail's browser terminal ("Connect using SSH") and
stops before the site, so the site is never newer than the API; re-run with
`--frontend-only` once the box is done. `--frontend-only` is also fine on its
own when neither `server/` nor `app/src/engine/` changed.

## 1. Lightsail instance (API)

1. Create an instance: **Ubuntu 24.04 LTS**, smallest plan is fine to start
   (512 MB / $3.50 works for ~80 students; the $5 1 GB plan gives headroom).
2. Attach a **static IP** and open ports **80 + 443** in the Lightsail firewall
   (22 is open by default; close 8133 — it stays loopback-only behind Caddy).
3. Create a DNS record for the API hostname (e.g. `api.<domain>`) → the static IP.

On the box:

```sh
# Node 24 (>= 22.5 required for the built-in node:sqlite)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs git caddy

# App user + directories
sudo useradd -r -m -d /srv/making-minds -s /usr/sbin/nologin makingminds
sudo mkdir -p /srv/making-minds/data

# Code
sudo -u makingminds git clone <repo-url> /srv/making-minds/repo
cd /srv/making-minds/repo/server && sudo -u makingminds npm install

# Seed the database (the toy roster; assignments are authored in the instructor UI)
sudo -u makingminds MM_DB_PATH=/srv/making-minds/data/making-minds.sqlite npm run seed

# Load the real class roster and give yourself an account (see section 3).
# The class list is a student record: copy it to the box OUTSIDE the repo.
sudo -u makingminds MM_DB_PATH=/srv/making-minds/data/making-minds.sqlite \
  npm run roster -- import /srv/making-minds/rosters/class-list.csv
sudo -u makingminds MM_DB_PATH=/srv/making-minds/data/making-minds.sqlite \
  npm run roster -- add you@ucla.edu --name "Your Name" --role instructor
sudo -u makingminds MM_DB_PATH=/srv/making-minds/data/making-minds.sqlite \
  npm run roster -- set-password you@ucla.edu

# Services — EDIT the env values (domain, CORS origin) first
sudo cp ../deploy/makingminds-api.service /etc/systemd/system/   # paths already match the clone above
sudo systemctl daemon-reload && sudo systemctl enable --now makingminds-api
sudo cp ../deploy/Caddyfile /etc/caddy/Caddyfile                 # fix the hostname
sudo systemctl reload caddy

curl -s https://api.<domain>/api/health    # → {"ok":true}
```

Updates: `deploy/release.sh` (section 0). By hand, as the `makingminds` user, in the
repo: `git pull && (cd server && npm install) && sudo systemctl restart makingminds-api`
— npm only ever in `server/` (run at the root, it writes a stray lockfile; task 060).

**Backups** (task 041): the entire state is one SQLite file, copied two ways, each
with its own folder and rotation so neither can prune the other's files. Both are
consistent online copies (`VACUUM INTO` through `node:sqlite`; the box has no
`sqlite3` CLI) and owner-only, since they hold password hashes.

| Copy | Where | Kept | Made by |
| --- | --- | --- | --- |
| Daily | `/srv/making-minds/backups/daily/daily-YYYY-MM-DD.sqlite` | 35 days | `makingminds-backup.timer`, 03:30 Pacific (`deploy/backup-daily.sh`; integrity-checked before it counts) |
| Pre-release | `/srv/making-minds/data/backup-YYYY-MM-DD-HHMMSS.sqlite` | the last 7 | `deploy/release.sh`, before each pull |

The daily job is installed and refreshed by `deploy/backup-install.sh`, which
every release runs (so the box always carries the repo's version, and a new box
gets it on its first release); by hand: `sudo bash
/srv/making-minds/repo/deploy/backup-install.sh`. Check it: `systemctl list-timers
makingminds-backup.timer`; run it now: `sudo systemctl start makingminds-backup`;
its log: `journalctl -u makingminds-backup`.

**Restore** a copy (as `ubuntu`): `sudo systemctl stop makingminds-api`, then
`sudo -u makingminds cp <backup> /srv/making-minds/data/making-minds.sqlite` and
`sudo rm -f /srv/making-minds/data/making-minds.sqlite-wal
/srv/making-minds/data/making-minds.sqlite-shm` (the copy is self-contained; a
stale WAL must not be replayed onto it), then `sudo systemctl start
makingminds-api` and `curl -s http://127.0.0.1:8133/api/health`. Keep the file you
replaced until you're sure. Not yet: an off-box copy (S3 or Lightsail snapshots);
everything above lives on the one instance.

**`MM_MINT_SECRET`** (optional; task 034, the provenance watermark): the secret
every student's per-assignment mint key is derived from — the key that binds
the ids of their circuits and signs their editing records, checked at submit.
Leave it unset and the server generates one on first boot and keeps it in the
database (`server_meta`), so restarts never change keys and a forgotten env var
never causes an outage. If you set it (a long random string in the systemd
unit's `Environment=`), keep it secret and **never rotate it mid-term**: every
id minted before the change would read as nobody's. The backup of the SQLite
file carries the generated one; the client's dev secret is never used here.

## 2. Cloudflare Pages (frontend)

Create a Pages project connected to the repo:

| Setting                    | Value                                      |
| -------------------------- | ------------------------------------------ |
| Root directory             | `app`                                      |
| Build command              | `npm run build`                            |
| Build output directory     | `dist`                                     |
| Env var `VITE_BASE_PATH`   | `/`                                        |
| Env var `VITE_API_BASE`    | `https://100-22-69-95.sslip.io` (no trailing slash) |

`VITE_API_BASE` is read by `app/src/api/client.ts` at build time; setting it is
what selects **remote** mode (`storage/backend.ts`). Leave it unset and the
Pages build is the browser-only **local** prototype (localStorage, answers in
the bundle) — fine for a demo, not for students.

`VITE_BASE_PATH` overrides Vite's `base`, which defaults to `/making-minds/`
for the GitHub Pages deploy (`.github/workflows/deploy.yml`). Cloudflare Pages
serves at the domain root, so it **must** be set to `/` or every asset 404s.

The app uses hash routing, so no `_redirects` file is needed.

**Current API hostname is a placeholder.** There is no domain yet, so the box
answers on `https://100-22-69-95.sslip.io` — wildcard DNS that resolves to the
Lightsail static IP (100.22.69.95), with a real Let's Encrypt cert Caddy
obtained over HTTP-01. Students never see it (the frontend calls it in the
background). To swap in a real domain later, three edits and nothing else:

1. DNS `A` record `api.<domain>` → 100.22.69.95.
2. On the box: replace the hostname in `/etc/caddy/Caddyfile`,
   `sudo systemctl reload caddy` (Caddy fetches the new cert automatically).
3. Cloudflare Pages: set `VITE_API_BASE=https://api.<domain>` and redeploy
   (it is baked in at build time).

The Pages project must be named **`making-minds`** so its default origin is
`https://making-minds.pages.dev` — the value already in the systemd unit's
`MM_CORS_ORIGINS`. A different name means updating that env and restarting
`makingminds-api`.

The pilot project **is** a direct upload (no Git integration) — `deploy/release.sh`
does it. By hand, from `app/`:
`VITE_BASE_PATH=/ VITE_API_BASE=... npm run build && npx wrangler pages deploy dist --project-name making-minds`.

Then set the Pages URL (and any custom domain) in the API's
`MM_CORS_ORIGINS` env (systemd unit) and restart the service.

## 3. Accounts and the roster

`MM_AUTH_MODE` picks the whole sign-in system (`server/src/auth.ts` is the one
swap point; the frontend asks the server what it offers via
`GET /api/auth/config` and renders accordingly, so switching modes needs no
rebuild):

| `MM_AUTH_MODE`        | What students see                                              |
| --------------------- | -------------------------------------------------------------- |
| `password` *(default)* | Email + password against the roster; account creation; access requests |
| `dev`                  | Email only, **no password** — development and closed demos only |
| `sso`                  | "Sign in with UCLA" — not implemented yet (see below)           |

**The roster is the gate.** Nobody can create an account for an email the
roster does not carry. Import it with the admin CLI on the box (or from the
instructor's **Roster & accounts** screen in the web UI, which does the same
thing through `POST /api/roster/import`):

```sh
cd /srv/making-minds/repo/server
export MM_DB_PATH=/srv/making-minds/data/making-minds.sqlite

npm run roster -- import /srv/making-minds/rosters/class-list.csv
                                           # the registrar's export as-is, or any
                                           # export with an email column
npm run roster -- list --unregistered      # who hasn't created an account yet
npm run roster -- reset student@ucla.edu   # forgotten password → they re-register
npm run roster -- requests                 # pending "I'm not on the roster" requests
```

**The registrar's class-list export is imported unedited.** Its preamble
(`Term:`, `Class:`, … and blank lines) is skipped — the header is the first row
with an email column; `"LAST, FIRST MIDDLE"` names become `First Middle Last`
(sorted by surname); `UID` is the student ID and `Section` is stored. Major,
Classification and Grade Type are deliberately not read. The `Status` column
decides who is imported: `E` enrolled, `W` wait list and `H` held are; `D`
dropped (and cancelled / withdrawn) are not, and the report counts each
(`1 dropped — not imported`). An unfamiliar status code is imported with a
warning.

Importing only **adds and updates**. It never removes anyone and never touches
a password, so re-importing an updated enrollment list mid-quarter is safe.
Instead, a re-import of a class list (a file with a `Status` column) lists the
students already on the platform whose row is now dropped or who are missing
from the file under **"no longer on the class list — review"**; remove them by
hand once you have checked.

**Class lists never go in git.** They are student records (FERPA). Keep them
outside the repo — on the box, `/srv/making-minds/rosters/`; locally, anywhere
outside the checkout or in the repo's ignored `rosters/` folder. `.gitignore`
also ignores the registrar's download name, `*-csv.csv`.

**Bootstrapping the first instructor** is the one thing that must happen on the
box, because the web UI needs an instructor to sign in before it can be used:

```sh
npm run roster -- add you@ucla.edu --name "Your Name" --role instructor
npm run roster -- set-password you@ucla.edu        # prompts, or --password ...
```

After that, everything else — importing the class, resetting passwords,
approving access requests — is available in the instructor UI.

**Forgotten passwords** have no email loop (there is no mail server): the
instructor resets the credential and the student sets their account up again
with their student ID. Their saved work and submissions are untouched.

**Student registration** is student ID + an email + a password. The ID finds
the roster seat (it is the only evidence we have that the person claiming it
owns it); the email may be the one on the class list — often a personal
address — or any UCLA one, and both then sign in to the same account. A
re-import that changes a student's email updates the same person (matched by
ID) and the new email joins their sign-in addresses. A roster row without an ID
(an instructor, a manual add) registers by its email alone.

### What's intentionally NOT done yet

- **UCLA SSO** — `SsoAuthProvider` in `server/src/auth.ts` reports its
  capabilities (the frontend already renders a single "Sign in with UCLA"
  button for it) but refuses to authenticate. Implementing it is one method:
  validate the assertion, map its attributes to `{email, name}`, take the role
  from the roster, `upsertUser`, return the row. Set `MM_AUTH_MODE=sso` and
  `MM_SSO_LOGIN_URL`. Nothing else in the codebase changes.
- **Rate limiting is in-process** — the failed-login throttle
  (`LoginThrottle`) lives in memory on the single server process and resets on
  restart. Fine for one box and ~80 students; revisit if the deployment grows.
- **Session tokens live in `localStorage`** — the standard bearer-token
  trade-off, in line with this app's threat model (see `app/src/api/client.ts`).
- **Real assignment content** — HW1–HW7 exist as seedable JSON in local mode;
  the server's DB still needs them ingested (extend `server/src/seed.ts`).
