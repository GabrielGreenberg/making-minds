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

# Seed the database (roster + bundled assignment)
sudo -u makingminds MM_DB_PATH=/srv/making-minds/data/making-minds.sqlite npm run seed

# Services — EDIT the env values (domain, CORS origin) first
sudo cp ../deploy/makingminds-api.service /etc/systemd/system/   # fix WorkingDirectory to the repo path
sudo systemctl daemon-reload && sudo systemctl enable --now makingminds-api
sudo cp ../deploy/Caddyfile /etc/caddy/Caddyfile                 # fix the hostname
sudo systemctl reload caddy

curl -s https://api.<domain>/api/health    # → {"ok":true}
```

Updates: `git pull && npm install && sudo systemctl restart makingminds-api`.

**Backups**: the entire state is one SQLite file. A nightly cron
(`sqlite3 .../making-minds.sqlite ".backup /srv/making-minds/data/backup-$(date +%a).sqlite"`)
plus Lightsail's instance snapshots is enough.

## 2. Cloudflare Pages (frontend)

Create a Pages project connected to the repo:

| Setting                  | Value                                   |
| ------------------------ | --------------------------------------- |
| Root directory           | `app`                                   |
| Build command            | `npm run build`                         |
| Build output directory   | `dist`                                  |
| Env var `VITE_API_BASE`  | `https://api.<domain>` (no trailing slash) |

`VITE_API_BASE` is read by `app/src/api/client.ts` at build time. The app uses
hash routing, so no `_redirects` file is needed.

Then set the Pages URL (and any custom domain) in the API's
`MM_CORS_ORIGINS` env (systemd unit) and restart the service.

## 3. What's intentionally NOT done yet

- **UCLA SSO** — the server runs `MM_AUTH_MODE=dev` (passwordless roster-email
  login, same trust level as the current mockup login). The seam for SSO is
  `server/src/auth.ts` (`AuthProvider`); implementing it is config + one class.
- **Frontend cutover** — the app still uses the Local* (localStorage) stores.
  `app/src/api/client.ts` provides the typed calls for the Remote* store
  implementations; wiring them in (and making the store seams async) is the
  remaining frontend task, independent of AWS access.
- **Roster** — `npm run seed` loads the toy accounts. For the real class,
  extend `server/src/seed.ts` to ingest the enrollment list (email, name,
  role), or rely on SSO to upsert users on first login.
