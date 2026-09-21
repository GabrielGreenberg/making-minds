---
id: 2026-09-21-007
type: chore
title: Seed HW1–HW7 into the server database for remote mode
priority: high
size: small
requires:
area: server
source: claude-md
created: 2026-09-21T15:30:00-07:00
status: ready
after:
branch:
merged_into:
---

## Description
HW1–HW7 exist as `AssignmentData` JSON in `app/src/devData/homeworks/hw{1..7}.json` and can
be seeded in local mode (dashboard "Load HW1–HW7" → `devData/homeworks.ts seedHomeworks`).
The server's `server/src/seed.ts` still loads only the toy roster + `cc-basics`, so the pilot
box has no real content.

## Done when
- `npm run seed` (server) ingests the seven homework JSONs fill-empty (existing ids skipped,
  instructor edits never clobbered), unpublished (`student_visible` 0), without the local
  sample submissions.
- `serverCheck` pins: after seeding, an instructor lists 7 more assignments, a student lists
  0 until published, and a published one arrives with `test_cases`/`fill_in_answers` stripped.
- Running it on the Lightsail box is noted as owed (ssh) in the progress log, not claimed.

## Design
Import the JSON files directly (the server already imports `app/src/...` across packages);
reuse the assignment insert path the CRUD route uses so validation is identical.
**surgicalFix** = the same thing; this is a mechanical chore.

## Verify
`server: npm run typecheck && npm run check`.

## Progress log
