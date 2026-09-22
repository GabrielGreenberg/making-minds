---
id: 2026-09-21-022
type: chore
title: Retire the bundled assignment mechanism (drop cc-basics)
priority: normal
size: small
requires:
area: app
source: chat
created: 2026-09-21T21:39:44:z
status: in-progress
after:
branch: task/022-retire-bundled-assignment
merged_into:
---

## Description
The instructor dashboard shows "CC basics · bundled · hidden" with no Edit or Delete button.
Gabriel asked why it can't be deleted, then decided: drop it. It can't be deleted because it
isn't a row in the `AssignmentStore`: `app/src/assignments/cc-basics.json` is imported at
build time by the registry (`app/src/assignments/index.ts`), which merges a read-only
"bundled" list with the instructor-authored store and treats bundled ids specially — no
Edit/Delete, pinned at the top of drag-reorder, excluded from renumbering, a refusal screen
in the editor, an extra id-collision check. It is the pre-authoring prototype's demo
assignment, local-mode only (its JSON carries the answer key, so remote builds already ship
an empty bundled list), and `server/src/seed.ts` loads it as the one assignment on a fresh
box. Provenance: chat, 2026-09-21.

## Done when
1. `cc-basics.json` and every "bundled" code path are gone: the registry is a thin layer
   over the `AssignmentStore` seam (`listAssignments` = the store's list, sorted;
   `getAssignment` = the store's get; `createAssignment` checks uniqueness against the
   store only); `isBundledAssignment` no longer exists; the dashboard shows Edit and Delete
   on every row with no "bundled"/"custom" tag and no pinned drag handle; the editor has no
   bundled refusal; `useDragReorder` loses its pinned concept and `pages.css` its
   `--pinned` rules.
2. `server/src/seed.ts` seeds the toy roster (plus `--sample`) only; `server/README.md`
   and `deploy/README.md` say so.
3. `CLAUDE.md`, `tasks/PROFILE.md` §8 and the store/registry comments no longer describe a
   bundled set.
4. Gates green: both `tsc`s, app build, app check, server check. Browser: the local
   dashboard lists only what was loaded (no CC basics row) and every row has Delete.

## Design
Root cause: an assignment source that lives outside the store. **deepFix** (chosen): delete
the source; the registry collapses onto the seam and every special case built for it — the
read-only flag, drag pinning, the bundled-first sort, the id-collision check, the editor
refusal, the `--pinned` CSS — goes with it. **surgicalFix**: give bundled rows a Delete
that writes a tombstone key in localStorage — more state, for a demo nobody uses.
Seams: `AssignmentStore` (interface unchanged; comments updated). Remote mode is untouched
by construction (its bundled list was already empty). Pointers: `assignments/index.ts:17–24,
53–91, 112`; `InstructorDashboard.tsx:5, 41–58, 158–224`; `AssignmentEditor.tsx:4, 66–76`;
`dragReorder.ts:10–12, 44, 61–73`; `server/src/seed.ts:15, 41–43`.

## Verify
`app: npx tsc -p tsconfig.app.json --noEmit && npm run build && npm run check`;
`server: npm run typecheck && npm run check`. Browser: "Vite Dev Server" → `#/instructor`:
no CC basics row; Delete on every row. Nothing owed: no remote or deploy behaviour changes
(a fresh box simply seeds no assignment until 007 lands).

## Progress log
- 2026-09-21 — filed from chat and claimed in one step (Gabriel: "Drop it — I don't think we
  need it anymore"). Next: delete the JSON, collapse the registry, strip the dashboard /
  editor / drag-hook branches and the pinned CSS, fix the server seed and the docs, run the
  gates, eyeball the dashboard.
