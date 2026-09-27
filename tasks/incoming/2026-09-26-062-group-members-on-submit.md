---
id: 2026-09-26-062
type: feature
title: Let a student name up to two group members at submit, picked from the roster — before HW1 submissions arrive
priority: urgent
size: large
requires: browser
area: app
source: chat
created: 2026-09-26T21:34:00-07:00
status: ready
after: 
branch:
merged_into:
---

## Description
Filed from task 031's accepted design (Gabriel approved 2026-09-26, with its three proposed defaults). Authority: the memo `docs/buildout/designs/grading-interface.md` — its §3 table records every decision; read it before starting. Slice 2 of 11 (memo §12). HW1 is due Oct 4 and is returned about a week later, so slices 1–8 carry the schedule.

The policy requires group members to be listed on each submission, reciprocally, groups
≤ 3 (memo §3 decision 8, §6.7). There is no field for it. It must ship before HW1 submissions
(due **Oct 4**) or HW1's groups go unrecorded. The reciprocity flag itself comes later
(2026-09-26-070); this slice records the data.

## Done when
- The submit dialog gains an optional **Group members** picker: up to 2 classmates, from the
  roster's students (names only — never emails or UIDs, like Bruin Learn's People page), type
  to filter, self excluded. The confirm text keeps "only your most recent submission is
  graded" (`provenance/notice.ts:28`).
- `SubmissionData.group?: string[]` (account keys). The server validates: ≤ 2, distinct, each a
  roster student, not the submitter; the student-facing list endpoint returns names + an
  opaque key only, to signed-in students of the course.
- Local mode: the toy accounts are the roster. Remote: `remoteStores`/`api/client.ts` carry it;
  the grader ignores it.
- Instructors see the listed members in today's gradebook detail (`GradebookView`
  `SubmissionDetail`).
- Pinned: `pipelineCheck` (submit with a group → stored, both modes), a server test for the
  validation (reject self, > 2, non-roster), `remoteStoreCheck` stays green.

## Design
- **deepFix:** group membership is submission data at the source (who submitted with whom,
  per attempt), so reciprocity, integrity context ("same group") and the export read one
  field.
- **surgicalFix (rejected):** a free-text line — uncheckable, and names drift.
- Pointers: `components/EditorTopBar.tsx:40-50` (the submit path, `confirm`), `store.ts
  submitAssignment`, `types.ts:470` `SubmissionData`, `server/src/app.ts:581-620` (submit),
  `server/src/roster.ts` / `identity.ts` (roster students), `storage/submissionStore.ts`.
- The picker is not typed assignment content, so the provenance seam doesn't apply; the
  dialog must still not use a clipboard API (pasteCheck gate).

## Verify
Gates; browser: submit HW1 as a toy student with one member, see it in the instructor's
gradebook detail; remote mode against the local server (Vite Remote Mode).

## Progress log
