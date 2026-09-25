---
id: 2026-09-21-008
type: chore
title: Give the pilot box a real domain and a SQLite backup cron
priority: normal
size: large
requires: ssh, human
area: deploy
source: claude-md
created: 2026-09-21T15:30:00-07:00
status: ready
after:
branch:
merged_into:
---

## Description
The pilot API runs at the placeholder hostname `https://100-22-69-95.sslip.io`; the domain
swap is three edits (`deploy/README.md` §2). There is no backup of the SQLite file.

**Found 2026-09-24 (release of 018): some networks block the placeholder outright.** On the
Wi-Fi Gabriel's Mac was on, every HTTPS connection naming `100-22-69-95.sslip.io` got a
5-byte non-TLS reply injected (`openssl s_client`: "wrong version number"), while the same
IP with any other SNI (or none) reached Caddy normally, and plain HTTP worked. So the
filter matches the hostname (wildcard-DNS services like sslip.io are a common block
category). From the box itself the URL is healthy. Anyone on such a network can load the
site (pages.dev) but never reach the API: sign-in fails. The network was United in-flight
Wi-Fi (heavily filtered), so this is a known risk, not a live outage. Still worth one check
from UCLA campus Wi-Fi before students arrive; a real domain retires the risk entirely.

## Done when
- The API answers on the chosen domain with a valid cert; the Pages build points at it;
  `MM_CORS_ORIGINS` updated; the old hostname documented as retired.
- A daily cron on the box copies the SQLite file (WAL-safe: `sqlite3 .backup` or a
  checkpoint first) to a dated file with rotation, and the recipe is in `deploy/README.md`.

## Design
Human decides the domain (Gabriel). Everything else is `deploy/README.md` procedure; the
repo change is the docs + the Pages env value.

## Verify
`curl` the health probe on the new domain; a restored backup boots the server.

## Progress log
