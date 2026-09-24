---
id: 2026-09-22-028
type: feature
title: Save and load a sandbox worksheet as a file (visitor-mode bells and whistles)
priority: normal
size: large
requires: browser
area: app
source: chat
created: 2026-09-22T10:30:00-07:00
status: in-progress
after: 2026-09-22-027
branch: task/028-sandbox-save-load-file
merged_into:
---

## Description
Gabriel, filing visitor mode (027): "we may want to add some bells and whistles to visitor
mode eventually, like being able to save and load a worksheet locally." Provenance: chat,
catch session 2026-09-22.
Raised to normal (catch 2026-09-23): Gabriel asked for it again: "add a save/load worksheet option
to visitor mode". Visitor mode (027) has landed, so nothing blocks it.

Most of this exists headless already: the store has `newWorkbook`, `exportWorkbook`,
`importWorkbook` and `openWorkbook` (`app/src/store.ts:891, 913, 917, 967`) with NO UI callers,
and `app/src/fileHandle.ts` (`saveToFile` / `saveToFileAs` / `openFile`, File System Access API
with a download fallback) is imported nowhere — git history says a menu using them was
removed in the menu overhaul (`de82edc`). The sandbox otherwise persists only as the one
per-browser autosave blob `making-minds-autosave` (`store.ts:3760`).

## Done when
- The sandbox chrome (`TabBar`'s sandbox menu, or `MenuBar` when a workbook is open and no
  assignment is) offers **New worksheet · Open… · Save · Save as…** for visitors and signed-in
  users alike; Save writes the workbook JSON (`exportWorkbook`) via `fileHandle.ts`, Open
  reads one (`importWorkbook`, which already calls `resetAllSimState`).
- A visitor who signs in keeps their sandbox (unchanged, per-browser blob); a signed-in user's
  sandbox is NOT uploaded anywhere (out of scope — the blob stays local).
- Unsaved-changes prompt on New/Open when the current worksheet differs from its last save.

## Design
- **deepFix:** wire the existing store actions and `fileHandle.ts` into one sandbox menu;
  keep the file format = `exportWorkbook`'s JSON (already round-trips through
  `importWorkbook`; pin it in `boxScopeCheck` or a new `workbookFileCheck`: export → import ≡).
- **surgicalFix:** none needed — the store side is done.
- Constraint (catch 2026-09-23, task 2026-09-23-033): a file import must NEVER write into an
  assignment; it opens only as sandbox tabs (as `importWorkbook` does today). Content loaded this
  way is sandbox-scoped and cannot be pasted into an assignment.
- Assumption: file only (no cloud/per-account sandbox storage) for now.
- Pointers: `store.ts:888–970`, `fileHandle.ts`, `components/TabBar.tsx:98–150` (the one
  existing sandbox menu, the "+ New worksheet" machine picker), `components/MenuBar.tsx:35–85`.

## Verify
- Gates: `tsc`, build, the round-trip pin. Browser: build a CC + FSM worksheet → Save →
  New → Open the file → identical tabs; visitor and John Doe alike.

## Progress log
