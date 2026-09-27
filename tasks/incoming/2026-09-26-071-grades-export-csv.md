---
id: 2026-09-26-071
type: feature
title: Export problem-set grades as a CSV — one row per student, HW1–HW6 out of 100 and their average
priority: normal
size: large
requires: browser
area: server
source: chat
created: 2026-09-26T21:34:00-07:00
status: ready
after: 2026-09-26-068
branch:
merged_into:
---

## Description
Filed from task 031's accepted design (Gabriel approved 2026-09-26, with its three proposed defaults). Authority: the memo `docs/buildout/designs/grading-interface.md` — its §3 table records every decision; read it before starting. Slice 11 of 11 (memo §12). HW1 is due Oct 4 and is returned about a week later, so slices 1–8 carry the schedule.

Memo §3 decisions 12/12b, §7.5. Problem sets only; exams and participation stay outside
the app.

## Done when
- `GET /api/grading/export.csv` (instructor-only, logged as an `export` event): `UID, name,
  email, section, HW1…HW6` (final grade out of 100 incl. late deduction; Missing = 0 after the
  effective due date, blank before), `average` (mean of counted sets due so far).
  `countsTowardGrade: false` assignments excluded. Buttons on the Grading tab and each
  Overview (that one exports the single assignment's column).
- Pinned: CSV shape and values on a fixture equal the summary's grades; students get 403.
- The file is a download; nothing writes it into the repo (PROFILE §8.9).

## Design
- **deepFix:** the export is a rendering of the 064 summary — no third grade computation.

## Verify
Gates; open the CSV from local mode in a spreadsheet.

## Progress log
