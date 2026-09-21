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
